#!/usr/bin/env python3
"""
Service-Centric Bot Simulator
Simulates a bot performing service work (mowing) with environmental monitoring
The bot now creates sessions and sends data related to the service, not just bot telemetry
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
GARDEN_ID = os.environ.get('GARDEN_ID', None)  # Required
SERVICE_ID = os.environ.get('SERVICE_ID', None)  # Required
UPDATE_INTERVAL_SECONDS = int(os.environ.get('UPDATE_INTERVAL', '5'))

# Supabase credentials for fetching garden/service info
SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://kyoowsarfopltjwmhksi.supabase.co')
SUPABASE_SERVICE_KEY = os.environ.get(
    'SUPABASE_SERVICE_KEY',
    'REDACTED_JWT'
)

# Base location (will be overridden by garden location)
BASE_LATITUDE = -29.8587
BASE_LONGITUDE = 31.0218

class ServiceBotSimulator:
    def __init__(self, bot_id, garden_id, service_id, backend_url):
        self.bot_id = bot_id
        self.garden_id = garden_id
        self.service_id = service_id
        self.backend_url = backend_url
        
        # Bot state
        self.battery = 95
        self.angle = 0  # Direction in degrees
        self.position_offset = 0
        
        # Session state
        self.current_session_id = None
        self.session_start_battery = 95
        self.session_distance = 0
        self.session_area = 0
        
        # Environmental state
        self.temperature = 22.0
        self.humidity = 60.0
        self.is_raining = False
        
        # Location
        self.base_lat = BASE_LATITUDE
        self.base_lng = BASE_LONGITUDE
        
        # Stats
        self.readings_sent = 0
        self.env_readings_sent = 0
        self.errors = 0
        
        print(f"🤖 Service Bot Simulator initialized")
        print(f"   Bot ID: {bot_id}")
        print(f"   Garden ID: {garden_id}")
        print(f"   Service ID: {service_id}")
        print(f"   Backend: {backend_url}")
        print()
        
        # Try to get garden location
        self._load_garden_location()
    
    def _load_garden_location(self):
        """Load garden location from database"""
        try:
            url = f"{SUPABASE_URL}/rest/v1/gardens?id=eq.{self.garden_id}"
            headers = {
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}'
            }
            response = requests.get(url, headers=headers)
            if response.status_code == 200 and response.json():
                garden = response.json()[0]
                # If garden has location data, use it
                if 'latitude' in garden and 'longitude' in garden:
                    self.base_lat = garden['latitude']
                    self.base_lng = garden['longitude']
                    print(f"✅ Loaded garden location: {self.base_lat}, {self.base_lng}")
        except Exception as e:
            print(f"⚠️  Could not load garden location: {e}")
    
    def update_state(self):
        """Update bot state for next reading"""
        
        # Battery drains while mowing
        if self.current_session_id:
            self.battery -= random.uniform(0.1, 0.3)
            
            # Low battery stops session
            if self.battery <= 15:
                print("⚠️  Low battery! Ending session...")
                self.end_mowing_session('low_battery')
                return
        
        # Clamp battery
        self.battery = max(0, min(100, self.battery))
        
        # Update movement
        if self.current_session_id:
            self.angle = (self.angle + random.uniform(5, 15)) % 360
            self.position_offset += 1
            self.session_distance += random.uniform(0.5, 2.0)  # meters
            self.session_area += random.uniform(0.2, 0.5)  # square meters
        
        # Temperature varies throughout the day
        hour = datetime.now().hour
        base_temp = 18 + (hour - 6) * 1.2 if 6 <= hour <= 18 else 18
        self.temperature = base_temp + random.uniform(-2, 2)
        
        # Humidity varies inversely with temperature
        self.humidity = 70 - (self.temperature - 20) * 2 + random.uniform(-5, 5)
        self.humidity = max(30, min(90, self.humidity))
        
        # Random chance of rain
        if not self.is_raining:
            self.is_raining = random.random() < 0.01  # 1% chance
            if self.is_raining and self.current_session_id:
                print("🌧️  Rain detected! Ending session...")
                self.end_mowing_session('rain')
        else:
            self.is_raining = random.random() < 0.2  # 20% chance to stop
    
    def generate_current_location(self):
        """Generate current GPS location based on movement"""
        # Simulate circular/spiral movement pattern
        radius = 0.0001 * (self.position_offset % 50)
        lat = self.base_lat + (radius * math.cos(math.radians(self.angle)))
        lng = self.base_lng + (radius * math.sin(math.radians(self.angle)))
        return round(lat, 8), round(lng, 8)
    
    def start_mowing_session(self):
        """Start a new mowing session"""
        try:
            url = f"{self.backend_url}/api/gardens/{self.garden_id}/mowing-sessions"
            data = {
                "bot_id": self.bot_id,
                "battery_start_percentage": int(self.battery)
            }
            
            response = requests.post(url, json=data, timeout=10)
            response.raise_for_status()
            result = response.json()
            
            self.current_session_id = result['session_id']
            self.session_start_battery = int(self.battery)
            self.session_distance = 0
            self.session_area = 0
            
            print(f"🚀 Started mowing session: {self.current_session_id}")
            return True
            
        except requests.exceptions.RequestException as e:
            print(f"❌ Error starting session: {e}")
            self.errors += 1
            return False
    
    def end_mowing_session(self, status='completed'):
        """End the current mowing session"""
        if not self.current_session_id:
            return
        
        try:
            url = f"{self.backend_url}/api/gardens/{self.garden_id}/mowing-sessions/{self.current_session_id}"
            data = {
                "battery_end_percentage": int(self.battery),
                "area_covered_sqm": round(self.session_area, 2),
                "distance_traveled_meters": round(self.session_distance, 2),
                "completion_status": status,
                "notes": f"Simulated session ({status})"
            }
            
            response = requests.patch(url, json=data, timeout=10)
            response.raise_for_status()
            
            battery_used = self.session_start_battery - int(self.battery)
            print(f"✅ Ended mowing session: {status}")
            print(f"   Area: {self.session_area:.1f} m², Distance: {self.session_distance:.1f} m, Battery used: {battery_used}%")
            
            self.current_session_id = None
            
        except requests.exceptions.RequestException as e:
            print(f"❌ Error ending session: {e}")
            self.errors += 1
    
    def send_environmental_data(self):
        """Send environmental sensor data"""
        try:
            lat, lng = self.generate_current_location()
            
            url = f"{self.backend_url}/api/services/{self.service_id}/environmental-data"
            data = {
                "bot_id": self.bot_id,
                "garden_id": self.garden_id,
                "temperature_celsius": round(self.temperature, 2),
                "humidity_percentage": round(self.humidity, 2),
                "is_raining": self.is_raining,
                "soil_moisture_percentage": round(random.uniform(35, 65), 2),
                "latitude": lat,
                "longitude": lng,
                "sensor_data": {
                    "emf_sensor_1": random.randint(450, 550),
                    "emf_sensor_2": random.randint(450, 550),
                    "emf_sensor_3": random.randint(450, 550)
                }
            }
            
            response = requests.post(url, json=data, timeout=10)
            response.raise_for_status()
            
            self.env_readings_sent += 1
            
            return True
            
        except requests.exceptions.RequestException as e:
            print(f"❌ Error sending environmental data: {e}")
            self.errors += 1
            return False
    
    def send_mowing_sensor_data(self):
        """Send detailed sensor data during mowing session"""
        if not self.current_session_id:
            return False
        
        try:
            lat, lng = self.generate_current_location()
            
            # Battery voltage (11V at 0%, 12.6V at 100%)
            battery_voltage = 11.0 + (self.battery / 100) * 1.6
            
            # Blade and drive RPM
            blade_rpm = 3400 + random.randint(-100, 100)
            drive_rpm = 150 + random.randint(-10, 10)
            
            # Orientation (pitch and roll vary on uneven ground)
            pitch = round(random.uniform(-5, 5), 2)
            roll = round(random.uniform(-5, 5), 2)
            yaw = round(self.angle, 2)
            
            # 3D Acceleration
            accel_x = round(random.uniform(-0.5, 0.5), 4)
            accel_y = round(random.uniform(-0.5, 0.5), 4)
            accel_z = round(9.81 + random.uniform(-0.2, 0.2), 4)
            
            # 3D Rotation rates
            gyro_x = round(random.uniform(-1, 1), 4)
            gyro_y = round(random.uniform(-1, 1), 4)
            gyro_z = round(random.uniform(-5, 5), 4)
            
            url = f"{self.backend_url}/api/services/{self.service_id}/mowing-sessions/{self.current_session_id}/sensor-data"
            data = {
                "blade_rpm": blade_rpm,
                "drive_rpm": drive_rpm,
                "direction_degrees": yaw,
                "pitch": pitch,
                "roll": roll,
                "yaw": yaw,
                "accel_x": accel_x,
                "accel_y": accel_y,
                "accel_z": accel_z,
                "gyro_x": gyro_x,
                "gyro_y": gyro_y,
                "gyro_z": gyro_z,
                "battery_percentage": int(self.battery),
                "battery_voltage": round(battery_voltage, 2),
                "current_draw_amps": round(random.uniform(2, 5), 2),
                "temperature_celsius": round(self.temperature, 2),
                "humidity_percentage": round(self.humidity, 2),
                "latitude": lat,
                "longitude": lng,
                "gps_accuracy_meters": round(random.uniform(2, 5), 2),
                "sensor_data": {
                    "grass_height_cm": round(random.uniform(3, 12), 1),
                    "blade_sharpness": round(random.uniform(70, 100), 1)
                }
            }
            
            response = requests.post(url, json=data, timeout=10)
            response.raise_for_status()
            
            self.readings_sent += 1
            
            # Print status every 10 readings
            if self.readings_sent % 10 == 0:
                print(f"📊 {self.readings_sent} sensor readings | Battery: {int(self.battery)}% | Area: {self.session_area:.1f} m²")
            
            return True
            
        except requests.exceptions.RequestException as e:
            print(f"❌ Error sending mowing sensor data: {e}")
            self.errors += 1
            return False
    
    def run(self):
        """Main simulation loop"""
        print("🚀 Starting service bot simulation...")
        print("   Press Ctrl+C to stop\n")
        
        # Start initial mowing session
        self.start_mowing_session()
        
        env_counter = 0
        
        try:
            while True:
                # Update bot state
                self.update_state()
                
                # Send environmental data every 5th update (less frequently)
                env_counter += 1
                if env_counter >= 5:
                    self.send_environmental_data()
                    env_counter = 0
                
                # Send mowing sensor data if session is active
                if self.current_session_id:
                    self.send_mowing_sensor_data()
                else:
                    # No active session, maybe start a new one
                    if self.battery > 30 and not self.is_raining:
                        print("💤 Idle - recharging...")
                        self.battery += random.uniform(1, 2)
                        self.battery = min(95, self.battery)
                        
                        # Start new session when battery is good
                        if self.battery >= 90:
                            self.start_mowing_session()
                
                # Random chance to complete session successfully
                if self.current_session_id and random.random() < 0.01:  # 1% chance per update
                    self.end_mowing_session('completed')
                
                # Wait for next update
                time.sleep(UPDATE_INTERVAL_SECONDS)
                
        except KeyboardInterrupt:
            print("\n\n⏹️  Stopping bot simulation...")
            
            # End active session
            if self.current_session_id:
                self.end_mowing_session('manual_stop')
            
            print(f"\n📈 Session Stats:")
            print(f"   Mowing sensor readings: {self.readings_sent}")
            print(f"   Environmental readings: {self.env_readings_sent}")
            print(f"   Errors: {self.errors}")
            print(f"   Success rate: {((self.readings_sent + self.env_readings_sent - self.errors) / max(1, self.readings_sent + self.env_readings_sent) * 100):.1f}%")
            print("\n✅ Goodbye!\n")
            sys.exit(0)


def main():
    """Entry point"""
    print("\n" + "="*60)
    print("  🤖 BotKorp Service-Centric Bot Simulator")
    print("="*60 + "\n")
    
    # Validate required environment variables
    if not GARDEN_ID:
        print("❌ GARDEN_ID environment variable is required")
        print("   export GARDEN_ID=\"your-garden-uuid\"")
        sys.exit(1)
    
    if not SERVICE_ID:
        print("❌ SERVICE_ID environment variable is required")
        print("   export SERVICE_ID=\"your-service-uuid\"")
        sys.exit(1)
    
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
    simulator = ServiceBotSimulator(BOT_ID, GARDEN_ID, SERVICE_ID, BACKEND_URL)
    simulator.run()


if __name__ == '__main__':
    main()


