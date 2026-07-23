import pybullet as p
import pybullet_data
import numpy as np
import time
import math
import random
import os

# --- Constants ---
PATCH_SIZE = 15.0
GRASS_SPACING = 0.25  # Reasonable spacing for PyBullet
CUT_RADIUS = 0.3
CAMERA_DISTANCE = 4.0
CAMERA_YAW = 45.0
CAMERA_PITCH = 30.0

class MowbotSimulation:
    def __init__(self):
        self.physics_client = p.connect(p.GUI)
        p.setAdditionalSearchPath(pybullet_data.getDataPath())
        p.setGravity(0, 0, -9.81)
        
        # Clean UI
        p.configureDebugVisualizer(p.COV_ENABLE_GUI, 0)
        p.configureDebugVisualizer(p.COV_ENABLE_SEGMENTATION_MARK_PREVIEW, 0)
        p.configureDebugVisualizer(p.COV_ENABLE_DEPTH_BUFFER_PREVIEW, 0)
        p.configureDebugVisualizer(p.COV_ENABLE_RGB_BUFFER_PREVIEW, 0)
        
        self.grass_blades = []  # Store (position, height, phase, cut, visual_id)
        self.grass_visuals = []  # Store visual shape IDs
        self.time_elapsed = 0.0
        self.mowbot_body = None
        
    def setup(self):
        print("Setting up simulation...")
        
        # Ground
        ground_shape = p.createCollisionShape(p.GEOM_BOX, halfExtents=[PATCH_SIZE/2, PATCH_SIZE/2, 0.01])
        self.ground_body = p.createMultiBody(0, ground_shape, basePosition=[0, 0, -0.01])
        p.changeVisualShape(self.ground_body, -1, rgbaColor=[0.05, 0.15, 0.05, 1])

        # Mowbot - Load STL
        stl_path = "mowbot.stl"
        scale = 0.002
        if os.path.exists(stl_path):
            vis_id = p.createVisualShape(p.GEOM_MESH, fileName=stl_path, meshScale=[scale]*3, rgbaColor=[0.8, 0.1, 0.1, 1])
            col_id = p.createCollisionShape(p.GEOM_MESH, fileName=stl_path, meshScale=[scale]*3)
            self.mowbot_body = p.createMultiBody(2.0, col_id, vis_id, basePosition=[0, 0, 0.2])
            print("Successfully loaded mowbot.stl")
        else:
            print("mowbot.stl not found, using fallback box")
            col_id = p.createCollisionShape(p.GEOM_BOX, halfExtents=[0.4, 0.3, 0.2])
            self.mowbot_body = p.createMultiBody(2.0, col_id, basePosition=[0, 0, 0.2])
            p.changeVisualShape(self.mowbot_body, -1, rgbaColor=[0.8, 0.1, 0.1, 1])

        # Physics settings
        p.changeDynamics(self.mowbot_body, -1, 
                        linearDamping=0.3, 
                        angularDamping=0.5, 
                        activationState=p.ACTIVATION_STATE_DISABLE_SLEEPING)

        # Create grass as visual shapes (cylinders for performance)
        num_steps = int(PATCH_SIZE / GRASS_SPACING)
        start = -PATCH_SIZE/2 + GRASS_SPACING/2
        
        print("Creating grass field...")
        for i in range(num_steps):
            for j in range(num_steps):
                x = start + i * GRASS_SPACING + random.uniform(-0.1, 0.1)
                y = start + j * GRASS_SPACING + random.uniform(-0.1, 0.1)
                h = random.uniform(0.2, 0.35)
                phase = random.random() * 2 * math.pi
                
                # Create a thin cylinder for each grass blade
                grass_color = [0.1, random.uniform(0.4, 0.65), 0.1, 1]
                vis_shape = p.createVisualShape(
                    p.GEOM_CYLINDER,
                    radius=0.005,
                    length=h,
                    rgbaColor=grass_color
                )
                
                # Create visual-only body (no collision)
                grass_body = p.createMultiBody(
                    baseMass=0,
                    baseVisualShapeIndex=vis_shape,
                    basePosition=[x, y, h/2]
                )
                
                self.grass_blades.append({
                    'pos': np.array([x, y]),
                    'height': h,
                    'phase': phase,
                    'cut': False,
                    'body_id': grass_body,
                    'base_pos': np.array([x, y, h/2])
                })
        
        print(f"Generated {len(self.grass_blades)} grass blades")

    def update(self, dt):
        if not p.isConnected(): return
        self.time_elapsed += dt
        
        # Keyboard Movement
        keys = p.getKeyboardEvents()
        
        # Get orientation first
        pos, orn = p.getBasePositionAndOrientation(self.mowbot_body)
        euler = p.getEulerFromQuaternion(orn)
        yaw = euler[2]
        
        # Movement speeds
        move_speed = 1.2
        turn_speed = 2.0
        move, turn = 0, 0
        
        # WASD / Arrow keys
        if (ord('w') in keys and keys[ord('w')] & p.KEY_IS_DOWN) or \
           (p.B3G_UP_ARROW in keys and keys[p.B3G_UP_ARROW] & p.KEY_IS_DOWN):
            move = move_speed
        if (ord('s') in keys and keys[ord('s')] & p.KEY_IS_DOWN) or \
           (p.B3G_DOWN_ARROW in keys and keys[p.B3G_DOWN_ARROW] & p.KEY_IS_DOWN):
            move = -move_speed
        if (ord('a') in keys and keys[ord('a')] & p.KEY_IS_DOWN) or \
           (p.B3G_LEFT_ARROW in keys and keys[p.B3G_LEFT_ARROW] & p.KEY_IS_DOWN):
            turn = turn_speed
        if (ord('d') in keys and keys[ord('d')] & p.KEY_IS_DOWN) or \
           (p.B3G_RIGHT_ARROW in keys and keys[p.B3G_RIGHT_ARROW] & p.KEY_IS_DOWN):
            turn = -turn_speed
        
        # Apply velocity
        vel_x = move * math.cos(yaw)
        vel_y = move * math.sin(yaw)
        
        # Get current velocity to preserve Z component
        current_vel, _ = p.getBaseVelocity(self.mowbot_body)
        
        p.resetBaseVelocity(self.mowbot_body, 
                           linearVelocity=[vel_x, vel_y, current_vel[2]], 
                           angularVelocity=[0, 0, turn])
        p.stepSimulation()

        # Cutting Logic
        m_pos = np.array(pos[:2])
        for blade in self.grass_blades:
            if not blade['cut']:
                dist = np.linalg.norm(m_pos - blade['pos'])
                if dist < CUT_RADIUS:
                    blade['cut'] = True
                    # Hide the grass blade by moving it underground
                    p.resetBasePositionAndOrientation(
                        blade['body_id'],
                        [blade['pos'][0], blade['pos'][1], -10],
                        [0, 0, 0, 1]
                    )

        # Animate grass with wind
        wind_speed = 1.5
        wind_strength = 0.05
        
        for blade in self.grass_blades:
            if blade['cut']:
                continue
                
            # Wind sway
            wave = math.sin(self.time_elapsed * wind_speed + 
                          (blade['pos'][0] + blade['pos'][1]) * 0.4 + blade['phase'])
            sway_x = wave * wind_strength
            sway_y = wave * wind_strength * 0.5
            
            # Update position with sway
            new_x = blade['base_pos'][0] + sway_x
            new_y = blade['base_pos'][1] + sway_y
            new_z = blade['base_pos'][2]
            
            # Tilt the grass with orientation
            tilt_angle = wave * 0.1
            quat = p.getQuaternionFromEuler([tilt_angle, tilt_angle * 0.5, 0])
            
            p.resetBasePositionAndOrientation(
                blade['body_id'],
                [new_x, new_y, new_z],
                quat
            )

def main():
    sim = MowbotSimulation()
    sim.setup()
    
    # Instructions
    p.addUserDebugText("Use WASD or Arrow Keys to Move", [-2, 0, 1.5], [1,1,1], textSize=1.5)
    
    dt = 1./60.
    print("Simulation running...")
    
    try:
        while p.isConnected():
            start_time = time.time()
            
            sim.update(dt)
            
            # Camera Follow Mowbot
            pos, _ = p.getBasePositionAndOrientation(sim.mowbot_body)
            p.resetDebugVisualizerCamera(CAMERA_DISTANCE, CAMERA_YAW, -CAMERA_PITCH, pos)
            
            # Throttle loop
            elapsed = time.time() - start_time
            if elapsed < dt:
                time.sleep(dt - elapsed)
                
    except Exception as e:
        print(f"Simulation stopped: {e}")
    finally:
        if p.isConnected():
            p.disconnect()
        print("Simulation ended.")

if __name__ == "__main__":
    main()
