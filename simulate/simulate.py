import pygame
import numpy as np
import math
import random
import time
import json
import os
from shapely.geometry import Polygon, Point, LineString
from maps import get_garden_maps

# --- Configuration ---
WHEEL_DIAMETER = 0.20  # meters
RPM = 40
BLADE_DIAMETER = 0.15  # meters
SPEED = (math.pi * WHEEL_DIAMETER * RPM) / 60.0  # m/s (~0.418 m/s)

# Visual scaling
PIXELS_PER_METER = 40
SCREEN_WIDTH = 800
SCREEN_HEIGHT = 600
FPS = 60

# Colors
COLOR_UNTOUCHED = (34, 139, 34)  # Forest Green
COLOR_CUT = (124, 252, 0)       # Lawn Green
COLOR_MOWER = (255, 0, 0)        # Red
COLOR_BOUNDARY = (100, 100, 100) # Grey
COLOR_TEXT = (255, 255, 255)

class SimpleNN:
    def __init__(self, weights_path="best_nn_weights.npy"):
        self.input_size = 12
        self.hidden_size1 = 32
        self.hidden_size2 = 32
        self.output_size = 1
        if os.path.exists(weights_path):
            try:
                vector = np.load(weights_path)
                expected_size = (12 * 32) + 32 + (32 * 32) + 32 + (32 * 1) + 1
                if len(vector) == expected_size:
                    self.weights = {}
                    idx = 0
                    for key, shape in [('w1', (12, 32)), ('b1', (32,)), ('w2', (32, 32)), ('b2', (32,)), ('w3', (32, 1)), ('b3', (1,))]:
                        size = np.prod(shape)
                        self.weights[key] = vector[idx:idx+size].reshape(shape)
                        idx += size
                else:
                    print(f"Weights file {weights_path} has wrong size. Initializing random.")
                    self.init_random()
            except Exception as e:
                print(f"Error loading weights: {e}. Initializing random.")
                self.init_random()
        else:
            self.init_random()

    def init_random(self):
        self.weights = {
            'w1': np.random.randn(12, 32) * np.sqrt(2/12),
            'b1': np.zeros(32),
            'w2': np.random.randn(32, 32) * np.sqrt(2/32),
            'b2': np.zeros(32),
            'w3': np.random.randn(32, 1) * np.sqrt(2/32),
            'b3': np.zeros(1)
        }

    def forward(self, x):
        z1 = np.dot(x, self.weights['w1']) + self.weights['b1']
        a1 = np.maximum(0, z1)
        z2 = np.dot(a1, self.weights['w2']) + self.weights['b2']
        a2 = np.maximum(0, z2)
        z3 = np.dot(a2, self.weights['w3']) + self.weights['b3']
        # Steering
        steering = np.clip(z3[0], -1, 1)
        return steering

class Mower:
    def __init__(self, start_pos, garden_poly, mode="STRATEGIC", params=None):
        self.x, self.y = start_pos
        self.garden_poly = garden_poly
        self.mode = mode
        
        if params is None:
            params = {'sweep_angle': 0.0, 'overlap': 0.85, 'angle_dither': 0.05}
        self.nn = SimpleNN()
        self.angle = 0.0
        self.prev_angle = 0.0
        self.prev_steering = 0.0
        self.speed = SPEED
        self.distance_travelled = 0
        self.blade_radius = BLADE_DIAMETER / 2
        
        # Sensor Error
        self.drift = 0.0
        self.gyro_drift_std = 0.00005
        self.compass_noise = 0.005

        # Grid for coverage
        minx, miny, maxx, maxy = garden_poly.bounds
        self.grid_res = 0.1
        self.grid_cols = int((maxx - minx) / self.grid_res) + 1
        self.grid_rows = int((maxy - miny) / self.grid_res) + 1
        self.grid = np.zeros((self.grid_rows, self.grid_cols), dtype=bool)
        self.grid_offset = (minx, miny)
        self.valid_cells_cut = 0
        self.total_cells_in_garden = 0
        for r in range(self.grid_rows):
            for c in range(self.grid_cols):
                gx = minx + c * self.grid_res
                gy = miny + r * self.grid_res
                if garden_poly.contains(Point(gx, gy)):
                    self.total_cells_in_garden += 1

    def cast_ray(self, angle, max_dist=5.0):
        dist = max_dist
        # Iterate backwards from max_dist to find the first point inside the garden
        # This is more robust than iterating outwards from the mower
        for step in [2.0, 1.0, 0.5, 0.2, 0.1, 0.05, 0.01]: # Smaller steps for precision
            while dist > 0:
                test_x = self.x + math.cos(angle) * dist
                test_y = self.y + math.sin(angle) * dist
                if self.garden_poly.contains(Point(test_x, test_y)):
                    break # Found a point inside, this is the max distance
                dist -= step
            if dist <= 0: # If we couldn't find any point inside, it means we're outside or very close to boundary
                return 0.0
            # Now refine the distance by checking smaller steps
            dist += step # Go back one step
        return max(0, dist)


    def get_sensor_data(self, dt):
        # 10DOF (Accelerometer, Gyroscope, Magnetometer, Altimeter)
        # For simulation, these are simplified or derived from mower state
        ax = random.gauss(0, 0.1)
        ay = random.gauss(0, 0.1)
        az = 9.81 + random.gauss(0, 0.1)
        
        gz = (self.angle - self.prev_angle) / dt if dt > 0 else 0
        gz += random.gauss(0, 0.01) # Gyro noise
        gx, gy = random.gauss(0, 0.01), random.gauss(0, 0.01)
        
        mx = math.cos(self.angle) + random.gauss(0, 0.05)
        my = math.sin(self.angle) + random.gauss(0, 0.05)
        mz = random.gauss(0, 0.05)
        
        alt = random.gauss(0, 0.1)
        
        # Boundary sensor (distance to closest boundary in current direction)
        boundary_dist = self.cast_ray(self.angle, max_dist=2.0)
        boundary_dist = max(0, min(2.0, boundary_dist + random.gauss(0, 0.05)))
        
        # Combine all sensor data into a single input vector (12 inputs)
        return np.array([ax, ay, az, gx, gy, gz, mx, my, mz, alt, boundary_dist / 2.0, self.prev_steering])

    def update(self, dt):
        self.drift += random.gauss(0, self.gyro_drift_std)
        
        current_speed = self.speed
        if self.mode == "RANDOM":
            effective_angle = self.angle + self.drift + random.gauss(0, self.compass_noise)
            dx = math.cos(effective_angle) * current_speed * dt
            dy = math.sin(effective_angle) * current_speed * dt
            if self.garden_poly.contains(Point(self.x + dx, self.y + dy)):
                self.x += dx
                self.y += dy
                self.distance_travelled += math.sqrt(dx**2 + dy**2)
            else:
                self.angle = random.uniform(0, 2 * math.pi)
            self.mark_cut()
            return

        if self.mode == "NEURAL_NET":
            # Neural Network Control
            inputs = self.get_sensor_data(dt)
            steering = self.nn.forward(inputs)
            
            self.prev_angle = self.angle
            self.angle += steering * 0.5 # Apply steering
            self.prev_steering = steering
            
            dx = math.cos(self.angle) * current_speed * dt
            dy = math.sin(self.angle) * current_speed * dt
            
            if self.garden_poly.contains(Point(self.x + dx, self.y + dy)):
                self.x += dx
                self.y += dy
                self.distance_travelled += math.sqrt(dx**2 + dy**2)
            else:
                self.angle += math.pi + random.uniform(-0.5, 0.5)

        self.mark_cut()

    def mark_cut(self):
        # Mark grid cells within blade radius as cut
        r_cells = int(self.blade_radius / self.grid_res) + 1
        c_idx = int((self.x - self.grid_offset[0]) / self.grid_res)
        r_idx = int((self.y - self.grid_offset[1]) / self.grid_res)
        
        for dr in range(-r_cells, r_cells + 1):
            for dc in range(-r_cells, r_cells + 1):
                nr, nc = r_idx + dr, c_idx + dc
                if 0 <= nr < self.grid_rows and 0 <= nc < self.grid_cols:
                    if not self.grid[nr, nc]:
                        gx = self.grid_offset[0] + nc * self.grid_res
                        gy = self.grid_offset[1] + nr * self.grid_res
                        if math.sqrt((gx - self.x)**2 + (gy - self.y)**2) <= self.blade_radius:
                            self.grid[nr, nc] = True
                            self.valid_cells_cut += 1

    def get_coverage(self):
        if self.total_cells_in_garden == 0: return 0
        return (self.valid_cells_cut / self.total_cells_in_garden) * 100

    def draw(self, screen, offset_x, offset_y):
        px = int(self.x * PIXELS_PER_METER) + offset_x
        py = int(self.y * PIXELS_PER_METER) + offset_y
        radius = int((BLADE_DIAMETER / 2) * PIXELS_PER_METER)
        pygame.draw.circle(screen, COLOR_MOWER, (px, py), max(radius, 4))
        
        # Draw intended direction (Black)
        end_x = px + math.cos(self.angle) * 20
        end_y = py + math.sin(self.angle) * 20
        pygame.draw.line(screen, (0,0,0), (px, py), (end_x, end_y), 2)
        
        # Draw actual direction (White) - showing the drift
        actual_angle = self.angle + self.drift
        ax = px + math.cos(actual_angle) * 20
        ay = py + math.sin(actual_angle) * 20
        pygame.draw.line(screen, (255,255,255), (px, py), (ax, ay), 1)

def main():
    pygame.init()
    screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
    pygame.display.set_caption("Robot Lawnmower Simulator")
    clock = pygame.time.Clock()
    font = pygame.font.SysFont("Arial", 18)

    gardens = get_garden_maps()
    garden_idx = 0
    current_mode = "NEURAL_NET"
    
    def init_garden(idx, mode):
        poly = gardens[idx]
        
        # Find a valid starting point (centroid or random inside)
        start_pt = poly.centroid
        if not poly.contains(start_pt):
            minx, miny, maxx, maxy = poly.bounds
            while True:
                p = Point(random.uniform(minx, maxx), random.uniform(miny, maxy))
                if poly.contains(p):
                    start_pt = p
                    break
        
        mower = Mower((start_pt.x, start_pt.y), poly, mode=mode)
        grass_surf = pygame.Surface((SCREEN_WIDTH, SCREEN_HEIGHT))
        grass_surf.fill((0, 0, 0)) 
        grass_surf.set_colorkey((0, 0, 0))
        
        return mower, poly, grass_surf, time.time()

    mower, current_poly, grass_surf, start_time = init_garden(garden_idx, current_mode)
    
    running = True
    paused = False
    
    while running:
        dt = clock.tick(FPS) / 1000.0
        if dt > 0.1: dt = 0.1 

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            if event.type == pygame.KEYDOWN:
                if event.key == pygame.K_SPACE:
                    paused = not paused
                if event.key == pygame.K_n:
                    garden_idx = (garden_idx + 1) % len(gardens)
                    mower, current_poly, grass_surf, start_time = init_garden(garden_idx, current_mode)
                if event.key == pygame.K_r:
                    mower, current_poly, grass_surf, start_time = init_garden(garden_idx, current_mode)
                if event.key == pygame.K_m:
                    modes = ["RANDOM", "NEURAL_NET"]
                    current_mode = modes[(modes.index(current_mode) + 1) % len(modes)]
                    mower, current_poly, grass_surf, start_time = init_garden(garden_idx, current_mode)

        if not paused:
            for _ in range(200):
                mower.update(dt)
                mx = int(mower.x * PIXELS_PER_METER) + 50
                my = int(mower.y * PIXELS_PER_METER) + 50
                m_radius = int((BLADE_DIAMETER / 2) * PIXELS_PER_METER)
                pygame.draw.circle(grass_surf, COLOR_CUT, (mx, my), m_radius)

        screen.fill((50, 50, 50))
        offset_x, offset_y = 50, 50
        points = [(int(x * PIXELS_PER_METER) + offset_x, int(y * PIXELS_PER_METER) + offset_y) 
                  for x, y in current_poly.exterior.coords]
        pygame.draw.polygon(screen, COLOR_UNTOUCHED, points)
        for interior in current_poly.interiors:
            hole_points = [(int(x * PIXELS_PER_METER) + offset_x, int(y * PIXELS_PER_METER) + offset_y) 
                           for x, y in interior.coords]
            pygame.draw.polygon(screen, (50, 50, 50), hole_points)

        screen.blit(grass_surf, (0, 0))
        for interior in current_poly.interiors:
            hole_points = [(int(x * PIXELS_PER_METER) + offset_x, int(y * PIXELS_PER_METER) + offset_y) 
                           for x, y in interior.coords]
            pygame.draw.polygon(screen, (50, 50, 50), hole_points)
            pygame.draw.lines(screen, COLOR_BOUNDARY, True, hole_points, 2)

        pygame.draw.lines(screen, COLOR_BOUNDARY, True, points, 3)
        mower.draw(screen, offset_x, offset_y)

        sim_seconds = mower.distance_travelled / SPEED
        sim_time_str = time.strftime("%H:%M:%S", time.gmtime(sim_seconds))
        coverage_val = mower.get_coverage()
        
        # Load Benchmark KPI
        kpi_str = "KPI: Benchmarking..."
        if os.path.exists("benchmark_results.json"):
            try:
                with open("benchmark_results.json", "r") as f:
                    bench = json.load(f)
                    kpi_str = f"KPI (98%): {bench['strategic_best_m']:.0f}m (vs {bench['random_baseline_m']:.0f}m)"
            except:
                pass

        info_lines = [
            f"Garden: {garden_idx + 1} / 10",
            f"Strategy: {mower.mode}",
            f"Area: {current_poly.area:.2f} m2",
            f"Coverage: {coverage_val:.1f}%",
            kpi_str,
            f"Simulated Time: {sim_time_str}",
            f"Sensor Drift: {mower.drift:.3f} rad",
            "Speed: 200x (Accelerated)",
            "",
            "Controls:",
            "SPACE: Pause",
            "M: Toggle Strategy",
            "N: Next Garden",
            "R: Reset"
        ]
        
        for i, line in enumerate(info_lines):
            img = font.render(line, True, COLOR_TEXT)
            screen.blit(img, (SCREEN_WIDTH - 220, 20 + i * 20))

        pygame.display.flip()
    pygame.quit()

if __name__ == "__main__":
    main()
