import os
import sys

# CRITICAL: Set these BEFORE importing numpy to prevent deadlocks in multiprocessing
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["VECLIB_MAXIMUM_THREADS"] = "1"
os.environ["NUMEXPR_NUM_THREADS"] = "1"

import numpy as np
import math
import random
import json
import time
import multiprocessing
from concurrent.futures import ProcessPoolExecutor
from shapely.geometry import Polygon, Point, LineString
from maps import get_garden_maps

# Constants
WHEEL_DIAMETER = 0.20
RPM = 40
BLADE_DIAMETER = 0.15
SPEED = (math.pi * WHEEL_DIAMETER * RPM) / 60.0
TARGET_COVERAGE = 95.0

class SimpleNN:
    def __init__(self, weights=None):
        self.input_size = 12 # 10DOF (10) + 1 Boundary + 1 Prev Steering
        self.hidden_size1 = 32
        self.hidden_size2 = 32
        self.output_size = 1 # Direction (Steering)
        
        if weights is not None:
            self.weights = weights
        else:
            # Xavier/Glorot initialization for deeper net
            self.weights = {
                'w1': np.random.randn(self.input_size, self.hidden_size1) * np.sqrt(2/self.input_size),
                'b1': np.zeros(self.hidden_size1),
                'w2': np.random.randn(self.hidden_size1, self.hidden_size2) * np.sqrt(2/self.hidden_size1),
                'b2': np.zeros(self.hidden_size2),
                'w3': np.random.randn(self.hidden_size2, self.output_size) * np.sqrt(2/self.hidden_size2),
                'b3': np.zeros(self.output_size)
            }

    def forward(self, x):
        # Layer 1: ReLU
        z1 = np.dot(x, self.weights['w1']) + self.weights['b1']
        a1 = np.maximum(0, z1)
        # Layer 2: ReLU
        z2 = np.dot(a1, self.weights['w2']) + self.weights['b2']
        a2 = np.maximum(0, z2)
        # Layer 3: Output
        z3 = np.dot(a2, self.weights['w3']) + self.weights['b3']
        # Steering (-1 to 1)
        steering = np.clip(z3[0], -1, 1)
        return steering

    def get_weights_vector(self):
        return np.concatenate([w.flatten() for w in self.weights.values()])

    def set_weights_from_vector(self, vector):
        idx = 0
        for key in ['w1', 'b1', 'w2', 'b2', 'w3', 'b3']:
            shape = self.weights[key].shape
            size = np.prod(shape)
            self.weights[key] = vector[idx:idx+size].reshape(shape)
            idx += size

class GardenContext:
    def __init__(self, poly, grid_res=0.4):
        self.poly = poly
        self.grid_res = grid_res
        minx, miny, maxx, maxy = poly.bounds
        self.grid_offset = (minx, miny)
        self.grid_cols = int((maxx - minx) / grid_res) + 1
        self.grid_rows = int((maxy - miny) / grid_res) + 1
        self.inside_mask = np.zeros((self.grid_rows, self.grid_cols), dtype=bool)
        self.total_cells_in_garden = 0
        for r in range(self.grid_rows):
            gy = miny + r * grid_res
            for c in range(self.grid_cols):
                gx = minx + c * grid_res
                if poly.contains(Point(gx, gy)):
                    self.inside_mask[r, c] = True
                    self.total_cells_in_garden += 1
        
        self.start_pos = poly.centroid
        if not poly.contains(self.start_pos):
            for r in range(self.grid_rows):
                for c in range(self.grid_cols):
                    if self.inside_mask[r, c]:
                        self.start_pos = Point(minx + c * grid_res, miny + r * grid_res)
                        break
                else: continue
                break

class NNMower:
    def __init__(self, start_pos, ctx, nn=None):
        self.x, self.y = start_pos
        self.ctx = ctx
        self.nn = nn
        self.angle = 0.0
        self.prev_angle = 0.0
        self.prev_steering = 0.0
        self.distance_travelled = 0
        self.grid = np.zeros((ctx.grid_rows, ctx.grid_cols), dtype=bool)
        self.valid_cells_cut = 0

    def cast_ray(self, angle, max_dist=5.0):
        low = 0.0
        high = max_dist
        for _ in range(5): # Binary search for boundary
            mid = (low + high) / 2
            test_x = self.x + math.cos(angle) * mid
            test_y = self.y + math.sin(angle) * mid
            c = int((test_x - self.ctx.grid_offset[0]) / self.ctx.grid_res)
            r = int((test_y - self.ctx.grid_offset[1]) / self.ctx.grid_res)
            if 0 <= r < self.ctx.grid_rows and 0 <= c < self.ctx.grid_cols and self.ctx.inside_mask[r, c]:
                low = mid
            else:
                high = mid
        return low

    def get_sensor_data(self, dt):
        # 10DOF (Acc, Gyro, Mag, Alt)
        # Acc (3) - Simplified: gravity + noise
        ax = random.gauss(0, 0.1)
        ay = random.gauss(0, 0.1)
        az = 9.81 + random.gauss(0, 0.1)
        
        # Gyro (3) - Angular velocity
        gz = (self.angle - self.prev_angle) / dt if dt > 0 else 0
        gz += random.gauss(0, 0.01) # Gyro noise
        gx, gy = random.gauss(0, 0.01), random.gauss(0, 0.01)
        
        # Mag (3) - Heading
        mx = math.cos(self.angle) + random.gauss(0, 0.05)
        my = math.sin(self.angle) + random.gauss(0, 0.05)
        mz = random.gauss(0, 0.05)
        
        # Alt (1)
        alt = random.gauss(0, 0.1)
        
        # Boundary (1) - Distance to boundary in front
        boundary_dist = self.cast_ray(self.angle, max_dist=2.0)
        boundary_dist = max(0, min(2.0, boundary_dist + random.gauss(0, 0.05)))
        
        # Combined vector (12 inputs)
        return np.array([ax, ay, az, gx, gy, gz, mx, my, mz, alt, boundary_dist / 2.0, self.prev_steering])

    def update(self, dt, mode="NN"):
        current_speed = SPEED
        if mode == "NN":
            inputs = self.get_sensor_data(dt)
            steering = self.nn.forward(inputs)
            self.prev_angle = self.angle
            self.angle += steering * 0.5
            self.prev_steering = steering
        else:
            self.prev_angle = self.angle

        dx = math.cos(self.angle) * current_speed * dt
        dy = math.sin(self.angle) * current_speed * dt
        
        new_x, new_y = self.x + dx, self.y + dy
        c = int((new_x - self.ctx.grid_offset[0]) / self.ctx.grid_res)
        r = int((new_y - self.ctx.grid_offset[1]) / self.ctx.grid_res)
        
        if 0 <= r < self.ctx.grid_rows and 0 <= c < self.ctx.grid_cols and self.ctx.inside_mask[r, c]:
            self.x, self.y = new_x, new_y
            self.distance_travelled += math.sqrt(dx**2 + dy**2)
            self.mark_cut()
        else:
            if mode == "NN":
                self.angle += math.pi + random.uniform(-0.5, 0.5)
            else:
                self.angle = random.uniform(0, 2 * math.pi)

    def mark_cut(self):
        c = int((self.x - self.ctx.grid_offset[0]) / self.ctx.grid_res)
        r = int((self.y - self.ctx.grid_offset[1]) / self.ctx.grid_res)
        if 0 <= r < self.ctx.grid_rows and 0 <= c < self.ctx.grid_cols:
            if not self.grid[r, c]:
                self.grid[r, c] = True
                self.valid_cells_cut += 1

    def get_coverage(self):
        if self.ctx.total_cells_in_garden == 0: return 0
        return (self.valid_cells_cut / self.ctx.total_cells_in_garden) * 100

GARDEN_CONTEXTS = None

def init_worker(contexts):
    global GARDEN_CONTEXTS
    GARDEN_CONTEXTS = contexts

def evaluate_single_map(args):
    weights_vector, map_idx, max_dist, mode = args
    nn = None
    if mode == "NN":
        nn = SimpleNN()
        nn.set_weights_from_vector(weights_vector)
    
    dt = 1.0
    ctx = GARDEN_CONTEXTS[map_idx]
    mower = NNMower((ctx.start_pos.x, ctx.start_pos.y), ctx, nn)
    target_cells = ctx.total_cells_in_garden * (TARGET_COVERAGE / 100.0)
    
    max_steps = 20000 # Safety limit
    steps = 0
    while mower.valid_cells_cut < target_cells and mower.distance_travelled < max_dist and steps < max_steps:
        mower.update(dt, mode=mode)
        steps += 1
    
    return mower.distance_travelled

def run_evolution():
    LOG_FILE = "evolution.log"
    BEST_MODEL_FILE = "best_nn_weights.npy"
    BENCHMARK_FILE = "benchmark_results.json"
    
    def log(msg):
        print(msg)
        sys.stdout.flush()
        with open(LOG_FILE, "a") as f:
            f.write(f"[{time.strftime('%H:%M:%S')}] {msg}\n")

    gardens = get_garden_maps()
    all_map_indices = list(range(len(gardens)))
    all_contexts = [GardenContext(g, grid_res=0.5) for g in gardens]
    
    global GARDEN_CONTEXTS
    GARDEN_CONTEXTS = all_contexts

    pop_size = 16 # Increased for better gradient estimation
    max_dist = 5000 # Max distance per map
    
    # Use 'spawn' to avoid deadlock issues with numpy/OpenBLAS
    try:
        multiprocessing.set_start_method('spawn', force=True)
    except RuntimeError:
        pass

    # 1. Run Benchmark (Sum of all maps)
    if not os.path.exists(BENCHMARK_FILE):
        log("--- Running Random Baseline Benchmark (Sum of All Maps) ---")
        with ProcessPoolExecutor(max_workers=8, initializer=init_worker, initargs=(all_contexts,)) as executor:
            trials = 3
            total_baseline_dist = 0
            for trial in range(trials):
                tasks = [(None, m_idx, max_dist, "RANDOM") for m_idx in all_map_indices]
                results = list(executor.map(evaluate_single_map, tasks))
                total_baseline_dist += sum(results)
            
            avg_sum_baseline = total_baseline_dist / trials
            
            benchmark_data = {
                "random_baseline_sum_m": avg_sum_baseline,
                "target_coverage": TARGET_COVERAGE,
                "num_maps": len(gardens)
            }
            with open(BENCHMARK_FILE, "w") as f:
                json.dump(benchmark_data, f, indent=4)
            log(f"Benchmark Complete: Random Baseline Sum = {avg_sum_baseline:.1f}m")
    else:
        with open(BENCHMARK_FILE, "r") as f:
            bench = json.load(f)
            avg_sum_baseline = bench["random_baseline_sum_m"]
            log(f"Loaded Benchmark: Random Baseline Sum = {avg_sum_baseline:.1f}m")
 
    # 2. Initialize ES Parameters
    nn_template = SimpleNN()
    weight_dim = len(nn_template.get_weights_vector())
    
    mu = np.zeros(weight_dim)
    if os.path.exists(BEST_MODEL_FILE):
        try:
            loaded_weights = np.load(BEST_MODEL_FILE)
            if len(loaded_weights) == weight_dim:
                mu = loaded_weights
                log("Seeded with previous best NN.")
            else:
                log(f"Previous weights incompatible. Starting fresh.")
        except: pass

    # ES Hyperparameters
    learning_rate = 0.05
    sigma = 0.1
    decay = 0.995
    
    log(f"--- Starting OpenAI-ES (Rank-based, Pop: {pop_size}) ---")
    
    gen = 0
    with ProcessPoolExecutor(max_workers=8, initializer=init_worker, initargs=(all_contexts,)) as executor:
        while True:
            start_time = time.time()
            
            num_pairs = pop_size // 2
            epsilons = [np.random.randn(weight_dim) for _ in range(num_pairs)]
            
            all_tasks = []
            for eps in epsilons:
                for m_idx in all_map_indices:
                    all_tasks.append((mu + eps * sigma, m_idx, max_dist, "NN"))
                for m_idx in all_map_indices:
                    all_tasks.append((mu - eps * sigma, m_idx, max_dist, "NN"))
            
            all_results = list(executor.map(evaluate_single_map, all_tasks))
            
            # Extract raw distances
            raw_sums = []
            map_count = len(all_map_indices)
            for i in range(pop_size):
                start = i * map_count
                raw_sums.append(sum(all_results[start : start + map_count]))
            
            # Rank-based fitness shaping
            # We want to MINIMIZE distance, so smaller distance = higher rank
            # Ranks will be from 0 to pop_size-1
            ranks = np.argsort(np.argsort(raw_sums)) # This gives the rank of each element
            # Map ranks to [-0.5, 0.5]
            shaped_fitness = (ranks / (pop_size - 1)) - 0.5
            # Invert because smaller distance is better (higher fitness)
            shaped_fitness = -shaped_fitness 
            
            # Gradient estimate
            grad = np.zeros(weight_dim)
            for i in range(num_pairs):
                # fitness_pos is at 2*i, fitness_neg is at 2*i + 1
                f_pos = shaped_fitness[2*i]
                f_neg = shaped_fitness[2*i + 1]
                grad += (f_pos - f_neg) * epsilons[i]
            grad /= (num_pairs * sigma)
            
            # Update weights
            mu += learning_rate * grad
            learning_rate *= decay
            
            best_gen_dist = min(raw_sums)
            improvement = ((avg_sum_baseline - best_gen_dist) / avg_sum_baseline) * 100
            log(f"Gen {gen}: Best Sum {best_gen_dist:.1f}m ({improvement:+.1f}% vs Random) [LR: {learning_rate:.4f}] [Time: {time.time()-start_time:.1f}s]")
            
            if gen % 5 == 0:
                np.save(BEST_MODEL_FILE, mu)
            
            gen += 1

if __name__ == "__main__":
    run_evolution()
