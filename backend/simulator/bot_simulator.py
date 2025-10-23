#!/usr/bin/env python3
"""
Real-time Bot Simulator
Simulates a bot sending sensor data continuously to the backend API
Run this script to generate realistic bot data every 5-10 seconds
"""

import os
import sys
import time
import math
import random
import requests
from datetime import datetime, timedelta

# Configuration
BACKEND_URL = os.environ.get('BACKEND_URL', 'http://localhost:8080')
BOT_ID = os.environ.get('BOT_ID', '550e8400-e29b-41d4-a716-446655440000')
UPDATE_INTERVAL_SECONDS = int(os.environ.get('UPDATE_INTERVAL', '5'))  # How often to send data

# Base location (Durban coordinates as example)
BASE_LATITUDE = -29.8587
BASE_LONGITUDE = 31.0218

# Simulation state
class BotSimulator:
    def __init__(self, bot_id, backend_url):
        self.bot_id = bot_id
        self.backend_url = backend_url
        
        # Bot state
        self.is_on = True
        self.battery = 95
        self.is_charging = False
        self.angle = 0  # Direction in degrees
        self.position_offset = 0  # For movement simulation
        
        # Environmental state
        self.temperature = 22.0
        self.humidity = 60.0
        self.is_raining = False
        
        # Stats
        self.readings_sent = 0
        self.errors = 0
        
        print(f"🤖 Bot Simulator initialized")
        print(f"   Bot ID: {bot_id}")
        print(f"   Backend: {backend_url}")
        print(f"   Update Interval: {UPDATE_INTERVAL_SECONDS}s")
        print()
    
    def update_state(self):
        """Update bot state for next reading"""
        
        # Battery drains when on, charges when off
        if self.is_on and not self.is_charging:
            self.battery -= random.uniform(0.1, 0.3)  # Drain
            if self.battery <= 15:
                print("⚠️  Low battery! Bot stopping to charge...")
                self.is_on = False
                self.is_charging = True
        elif self.is_charging:
            self.battery += random.uniform(0.5, 1.0)  # Charge
            if self.battery >= 95:
                print("✅ Battery charged! Bot resuming operation...")
                self.is_on = True
                self.is_charging = False
        
        # Clamp battery
        self.battery = max(0, min(100, self.battery))
        
        # Update angle (bot turns while mowing)
        if self.is_on:
            self.angle = (self.angle + random.uniform(5, 15)) % 360
            self.position_offset += 1
        
        # Temperature varies throughout the day
        hour = datetime.now().hour
        base_temp = 18 + (hour - 6) * 1.2 if 6 <= hour <= 18 else 18
        self.temperature = base_temp + random.uniform(-2, 2)
        
        # Humidity varies inversely with temperature
        self.humidity = 70 - (self.temperature - 20) * 2 + random.uniform(-5, 5)
        self.humidity = max(30, min(90, self.humidity))
        
        # Random chance of rain (2% per reading)
        if not self.is_raining:
            self.is_raining = random.random() < 0.02
            if self.is_raining:
                print("🌧️  Rain detected! Bot may pause operation...")
                self.send_event('rain_detected', 'info', 'Rain Detected', 'Rain sensor triggered')
        else:
            # Rain stops eventually
            self.is_raining = random.random() < 0.1  # 10% chance to stop
            if not self.is_raining:
                print("☀️  Rain stopped.")
                self.send_event('rain_stopped', 'info', 'Rain Stopped', 'Rain sensor cleared')
    
    def generate_sensor_reading(self):
        """Generate realistic sensor reading"""
        
        # Simulate circular/spiral movement pattern
        radius = 0.0001 * (self.position_offset % 50)
        lat = BASE_LATITUDE + (radius * math.cos(math.radians(self.angle)))
        lng = BASE_LONGITUDE + (radius * math.sin(math.radians(self.angle)))
        
        # Battery voltage (11V at 0%, 12.6V at 100%)
        battery_voltage = 11.0 + (self.battery / 100) * 1.6
        
        # RPM varies slightly
        rpm = 3200 + random.randint(-200, 200) if self.is_on else 0
        
        # Speed
        speed_cm_per_sec = random.uniform(10, 20) if self.is_on else 0
        distance_traveled_cm = speed_cm_per_sec * UPDATE_INTERVAL_SECONDS if self.is_on else 0
        
        # Orientation (pitch and roll vary as bot moves on uneven ground)
        pitch = round(random.uniform(-5, 5), 2)
        roll = round(random.uniform(-5, 5), 2)
        yaw = self.angle
        
        # Acceleration (mostly gravity on z-axis, with some noise)
        accel_x = round(random.uniform(-0.5, 0.5), 4)
        accel_y = round(random.uniform(-0.5, 0.5), 4)
        accel_z = round(9.81 + random.uniform(-0.2, 0.2), 4)
        
        # Rotation rates (gyroscope)
        rot_x = round(random.uniform(-1, 1), 4)
        rot_y = round(random.uniform(-1, 1), 4)
        rot_z = round(random.uniform(-5, 5), 4) if self.is_on else 0
        
        # Rain intensity (analog value 0-1023, or 0-100%)
        rain_intensity = random.randint(300, 800) if self.is_raining else 0
        
        # Bot-specific data (mow bot)
        bot_specific_data = {
            "blade_rpm": 3400 + random.randint(-100, 100) if self.is_on else 0,
            "emf_sensor_1": random.randint(450, 550),
            "emf_sensor_2": random.randint(450, 550),
            "emf_sensor_3": random.randint(450, 550),
            "boundary_wire_detected": True,
            "trimmer_motor_on": False,
            "grass_height_detected": round(random.uniform(3, 12), 1)
        }
        
        reading = {
            "recorded_at": datetime.utcnow().isoformat() + 'Z',
            "is_on": self.is_on,
            "battery_percentage": int(self.battery),
            "battery_voltage": round(battery_voltage, 2),
            "is_charging": self.is_charging,
            
            "direction_degrees": round(self.angle, 2),
            "rpm": rpm,
            "distance_traveled_cm": round(distance_traveled_cm, 2),
            "speed_cm_per_sec": round(speed_cm_per_sec, 2),
            
            "pitch": pitch,
            "roll": roll,
            "yaw": round(yaw, 2),
            
            "acceleration_x": accel_x,
            "acceleration_y": accel_y,
            "acceleration_z": accel_z,
            
            "rotation_x": rot_x,
            "rotation_y": rot_y,
            "rotation_z": rot_z,
            
            "temperature_celsius": round(self.temperature, 2),
            "humidity_percentage": round(self.humidity, 2),
            "is_raining": self.is_raining,
            "rain_intensity": rain_intensity,
            
            "latitude": round(lat, 8),
            "longitude": round(lng, 8),
            "gps_accuracy_meters": round(random.uniform(2, 5), 2),
            
            "bot_specific_data": bot_specific_data
        }
        
        return reading
    
    def send_sensor_reading(self, reading):
        """Send sensor reading to backend API"""
        try:
            url = f"{self.backend_url}/api/bots/{self.bot_id}/sensor-reading"
            response = requests.post(url, json=reading, timeout=10)
            response.raise_for_status()
            
            self.readings_sent += 1
            
            # Print status every 10 readings
            if self.readings_sent % 10 == 0:
                status = "🟢 ON" if self.is_on else "🔴 OFF"
                charge = "🔌 CHARGING" if self.is_charging else ""
                print(f"📊 {self.readings_sent} readings sent | {status} {charge} | Battery: {int(self.battery)}% | Temp: {reading['temperature_celsius']}°C")
            
            return True
            
        except requests.exceptions.RequestException as e:
            self.errors += 1
            print(f"❌ Error sending reading: {e}")
            return False
    
    def send_event(self, event_type, severity, title, description, data=None):
        """Send an event to backend API"""
        try:
            url = f"{self.backend_url}/api/bots/{self.bot_id}/events"
            
            event = {
                "event_type": event_type,
                "severity": severity,
                "title": title,
                "description": description,
                "data": data or {}
            }
            
            response = requests.post(url, json=event, timeout=10)
            response.raise_for_status()
            
        except requests.exceptions.RequestException as e:
            print(f"⚠️  Error sending event: {e}")
    
    def run(self):
        """Main simulation loop"""
        print("🚀 Starting bot simulation...")
        print("   Press Ctrl+C to stop\n")
        
        # Send startup event
        self.send_event('started', 'info', 'Bot Started', 'Simulator started bot operation')
        
        try:
            while True:
                # Update bot state
                self.update_state()
                
                # Generate and send sensor reading
                reading = self.generate_sensor_reading()
                self.send_sensor_reading(reading)
                
                # Wait for next update
                time.sleep(UPDATE_INTERVAL_SECONDS)
                
        except KeyboardInterrupt:
            print("\n\n⏹️  Stopping bot simulation...")
            
            # Send shutdown event
            self.send_event('stopped', 'info', 'Bot Stopped', 'Simulator stopped bot operation')
            
            print(f"\n📈 Session Stats:")
            print(f"   Readings sent: {self.readings_sent}")
            print(f"   Errors: {self.errors}")
            print(f"   Success rate: {((self.readings_sent - self.errors) / max(1, self.readings_sent) * 100):.1f}%")
            print("\n✅ Goodbye!\n")
            sys.exit(0)


def main():
    """Entry point"""
    print("\n" + "="*60)
    print("  🤖 BotKorp Real-time Bot Simulator")
    print("="*60 + "\n")
    
    # Check if backend is accessible
    try:
        response = requests.get(f"{BACKEND_URL}/health", timeout=5)
        if response.status_code == 200:
            print(f"✅ Backend is accessible: {BACKEND_URL}")
        else:
            print(f"⚠️  Backend responded with status {response.status_code}")
    except requests.exceptions.RequestException as e:
        print(f"❌ Cannot reach backend at {BACKEND_URL}")
        print(f"   Error: {e}")
        print(f"\n   Please make sure the backend is running:")
        print(f"   cd backend && python main.py")
        sys.exit(1)
    
    print()
    
    # Create and run simulator
    simulator = BotSimulator(BOT_ID, BACKEND_URL)
    simulator.run()


if __name__ == '__main__':
    main()

