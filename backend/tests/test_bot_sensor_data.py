"""
Test script to insert mock bot sensor data
Run this to populate your database with sample data for frontend development
"""

import os
import sys
from datetime import datetime, timedelta
import random
import math

# Add parent directory to path to import config
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from supabase import create_client
import config

# Initialize Supabase client
supabase = create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY)

# Test bot ID - replace with your actual bot ID
TEST_BOT_ID = None
TEST_LOCATION_ID = None


def get_or_create_test_bot():
    """Get existing test bot or create one"""
    global TEST_BOT_ID, TEST_LOCATION_ID
    
    # First, get or create a location
    locations = supabase.table("locations").select("id, organization_id").limit(1).execute()
    
    if not locations.data:
        print("❌ No locations found. Please create a location first.")
        print("You can do this through your app or run:")
        print("  INSERT INTO locations (organization_id, name) VALUES ('org-id', 'Test Location');")
        sys.exit(1)
    
    TEST_LOCATION_ID = locations.data[0]["id"]
    print(f"✅ Using location: {TEST_LOCATION_ID}")
    
    # Check for existing test bot
    bots = supabase.table("bots").select("id").eq("serial_number", "TEST-MOW-001").execute()
    
    if bots.data:
        TEST_BOT_ID = bots.data[0]["id"]
        print(f"✅ Found existing test bot: {TEST_BOT_ID}")
    else:
        # Create test bot
        new_bot = {
            "location_id": TEST_LOCATION_ID,
            "name": "Test Mow Bot #1",
            "bot_type": "mow_bot",
            "serial_number": "TEST-MOW-001",
            "identifier": "mowbot-test-001",
            "hardware_version": "v1.0",
            "firmware_version": "1.2.3",
            "status": "online",
            "is_enabled": True,
            "battery_level": 85,
            "connection_type": "wifi",
            "config": {
                "max_speed": 20,
                "blade_rpm_target": 3400,
                "return_battery_threshold": 20
            },
            "metadata": {
                "test_data": True
            }
        }
        
        result = supabase.table("bots").insert(new_bot).execute()
        TEST_BOT_ID = result.data[0]["id"]
        print(f"✅ Created test bot: {TEST_BOT_ID}")


def generate_sensor_readings(hours_back=24, interval_seconds=300):
    """
    Generate realistic sensor readings over time
    Default: 24 hours of data, one reading every 5 minutes
    """
    print(f"\n📊 Generating sensor readings for last {hours_back} hours...")
    
    readings = []
    start_time = datetime.utcnow() - timedelta(hours=hours_back)
    
    # Starting position (Durban coordinates as example)
    base_lat = -29.8587
    base_lng = 31.0218
    
    # Simulate bot movement in a lawn pattern
    num_readings = int((hours_back * 3600) / interval_seconds)
    
    for i in range(num_readings):
        timestamp = start_time + timedelta(seconds=i * interval_seconds)
        
        # Simulate battery drain over time
        battery_drain_per_hour = 10
        hours_elapsed = (timestamp - start_time).total_seconds() / 3600
        battery = max(20, 100 - int(hours_elapsed * battery_drain_per_hour))
        
        # Simulate bot turning off at 20% battery
        is_on = battery > 20
        
        # Simulate movement (circular/spiral pattern)
        angle = (i * 10) % 360
        radius = 0.0001 * (i % 50)  # Small movements
        lat = base_lat + (radius * math.cos(math.radians(angle)))
        lng = base_lng + (radius * math.sin(math.radians(angle)))
        
        # Simulate temperature varying by time of day
        hour_of_day = timestamp.hour
        temp_base = 20 + (hour_of_day - 6) * 1.2  # Warmer during day
        temperature = round(temp_base + random.uniform(-2, 2), 2)
        
        # Simulate humidity
        humidity = round(60 + random.uniform(-10, 10), 2)
        
        # Random chance of rain (5%)
        is_raining = random.random() < 0.05
        rain_intensity = random.randint(300, 800) if is_raining else 0
        
        # Simulate pitch and roll (slight variations as bot moves on uneven ground)
        pitch = round(random.uniform(-5, 5), 2)
        roll = round(random.uniform(-5, 5), 2)
        yaw = angle
        
        # Simulate acceleration (mostly gravity on z-axis)
        accel_x = round(random.uniform(-0.5, 0.5), 4)
        accel_y = round(random.uniform(-0.5, 0.5), 4)
        accel_z = round(9.81 + random.uniform(-0.2, 0.2), 4)
        
        # Simulate rotation rates
        rot_x = round(random.uniform(-1, 1), 4)
        rot_y = round(random.uniform(-1, 1), 4)
        rot_z = round(random.uniform(-5, 5), 4)
        
        reading = {
            "bot_id": TEST_BOT_ID,
            "recorded_at": timestamp.isoformat(),
            "is_on": is_on,
            "battery_percentage": battery,
            "battery_voltage": round(11.0 + (battery / 100) * 1.6, 2),
            "is_charging": not is_on and battery < 100,
            "direction_degrees": angle,
            "rpm": 3200 + random.randint(-200, 200) if is_on else 0,
            "distance_traveled_cm": round(random.uniform(10, 30), 2) if is_on else 0,
            "speed_cm_per_sec": round(random.uniform(10, 20), 2) if is_on else 0,
            "pitch": pitch,
            "roll": roll,
            "yaw": yaw,
            "acceleration_x": accel_x,
            "acceleration_y": accel_y,
            "acceleration_z": accel_z,
            "rotation_x": rot_x,
            "rotation_y": rot_y,
            "rotation_z": rot_z,
            "temperature_celsius": temperature,
            "humidity_percentage": humidity,
            "is_raining": is_raining,
            "rain_intensity": rain_intensity,
            "latitude": lat,
            "longitude": lng,
            "gps_accuracy_meters": round(random.uniform(2, 5), 2),
            "bot_specific_data": {
                "blade_rpm": 3400 + random.randint(-100, 100) if is_on else 0,
                "emf_sensor_1": random.randint(450, 550),
                "emf_sensor_2": random.randint(450, 550),
                "emf_sensor_3": random.randint(450, 550),
                "boundary_wire_detected": True,
                "trimmer_motor_on": False
            }
        }
        
        readings.append(reading)
    
    # Insert in batches
    batch_size = 100
    for i in range(0, len(readings), batch_size):
        batch = readings[i:i+batch_size]
        supabase.table("bot_sensor_readings").insert(batch).execute()
        print(f"  ✅ Inserted batch {i//batch_size + 1}/{math.ceil(len(readings)/batch_size)}")
    
    print(f"✅ Inserted {len(readings)} sensor readings")


def generate_location_history():
    """Generate location history based on sensor readings"""
    print(f"\n📍 Generating location history...")
    
    # Get all sensor readings with GPS data
    readings = supabase.table("bot_sensor_readings")\
        .select("id, recorded_at, latitude, longitude, direction_degrees, speed_cm_per_sec")\
        .eq("bot_id", TEST_BOT_ID)\
        .not_.is_("latitude", "null")\
        .order("recorded_at")\
        .execute()
    
    locations = []
    for reading in readings.data:
        location = {
            "bot_id": TEST_BOT_ID,
            "latitude": reading["latitude"],
            "longitude": reading["longitude"],
            "altitude": round(random.uniform(40, 50), 2),
            "accuracy": round(random.uniform(2, 5), 2),
            "heading": reading["direction_degrees"],
            "speed": reading["speed_cm_per_sec"] / 100 if reading["speed_cm_per_sec"] else 0,
            "is_moving": reading["speed_cm_per_sec"] > 1 if reading["speed_cm_per_sec"] else False,
            "recorded_at": reading["recorded_at"]
            # telemetry_id is optional and references bot_telemetry (not used in our new system)
        }
        locations.append(location)
    
    # Insert in batches
    batch_size = 100
    for i in range(0, len(locations), batch_size):
        batch = locations[i:i+batch_size]
        supabase.table("bot_location_history").insert(batch).execute()
    
    print(f"✅ Inserted {len(locations)} location history points")


def generate_events():
    """Generate realistic bot events"""
    print(f"\n📅 Generating bot events...")
    
    events = []
    start_time = datetime.utcnow() - timedelta(hours=24)
    
    # Bot started
    events.append({
        "bot_id": TEST_BOT_ID,
        "event_type": "started",
        "severity": "info",
        "title": "Mowing Operation Started",
        "description": "Bot began scheduled mowing operation",
        "event_timestamp": start_time.isoformat(),
        "data": {"scheduled": True, "reason": "daily_schedule"}
    })
    
    # Random events throughout the day
    event_types = [
        ("obstacle_detected", "warning", "Obstacle Detected", "Small obstacle in path, navigating around"),
        ("boundary_crossed", "warning", "Boundary Warning", "Approaching boundary wire"),
        ("route_completed", "info", "Route Segment Completed", "Finished mowing grid section A3"),
    ]
    
    for i in range(5):
        event = random.choice(event_types)
        events.append({
            "bot_id": TEST_BOT_ID,
            "event_type": event[0],
            "severity": event[1],
            "title": event[2],
            "description": event[3],
            "event_timestamp": (start_time + timedelta(hours=random.randint(1, 20))).isoformat(),
            "data": {}
        })
    
    # Low battery warning
    events.append({
        "bot_id": TEST_BOT_ID,
        "event_type": "low_battery_warning",
        "severity": "warning",
        "title": "Low Battery - 25%",
        "description": "Battery level below threshold, completing current section",
        "event_timestamp": (start_time + timedelta(hours=22)).isoformat(),
        "data": {"battery_percentage": 25}
    })
    
    # Bot stopped
    events.append({
        "bot_id": TEST_BOT_ID,
        "event_type": "stopped",
        "severity": "info",
        "title": "Mowing Operation Stopped",
        "description": "Bot stopped and returning home",
        "event_timestamp": (start_time + timedelta(hours=23)).isoformat(),
        "data": {"reason": "low_battery"}
    })
    
    # Charging started
    events.append({
        "bot_id": TEST_BOT_ID,
        "event_type": "charging_started",
        "severity": "info",
        "title": "Charging Started",
        "description": "Bot docked and charging",
        "event_timestamp": (start_time + timedelta(hours=23, minutes=15)).isoformat(),
        "data": {"battery_percentage": 20}
    })
    
    supabase.table("bot_events").insert(events).execute()
    print(f"✅ Inserted {len(events)} events")


def generate_daily_stats():
    """Generate daily statistics"""
    print(f"\n📈 Generating daily statistics...")
    
    # Generate stats for last 7 days
    stats = []
    for days_ago in range(7):
        date = (datetime.utcnow() - timedelta(days=days_ago)).date()
        
        stat = {
            "bot_id": TEST_BOT_ID,
            "date": date.isoformat(),
            "total_runtime_minutes": random.randint(180, 360),
            "active_time_minutes": random.randint(150, 300),
            "idle_time_minutes": random.randint(20, 50),
            "charging_time_minutes": random.randint(60, 120),
            "total_distance_meters": round(random.uniform(500, 1500), 2),
            "area_covered_sqm": round(random.uniform(300, 800), 2),
            "average_battery_level": round(random.uniform(50, 70), 2),
            "min_battery_level": random.randint(15, 25),
            "max_battery_level": 100,
            "charge_cycles": 1,
            "total_events": random.randint(5, 15),
            "error_count": random.randint(0, 2),
            "warning_count": random.randint(1, 5),
            "average_temperature": round(random.uniform(24, 30), 2),
            "max_temperature": round(random.uniform(32, 38), 2),
            "min_temperature": round(random.uniform(18, 22), 2),
            "rain_detected_count": random.randint(0, 2),
            "metadata": {}
        }
        
        stats.append(stat)
    
    supabase.table("bot_daily_statistics").insert(stats).execute()
    print(f"✅ Inserted {len(stats)} daily statistics records")


def main():
    """Main function to generate all test data"""
    print("=" * 60)
    print("🤖 Bot Sensor Data Test Generator")
    print("=" * 60)
    
    try:
        # Step 1: Get or create test bot
        get_or_create_test_bot()
        
        # Step 2: Generate sensor readings
        generate_sensor_readings(hours_back=24, interval_seconds=300)
        
        # Step 3: Generate location history
        generate_location_history()
        
        # Step 4: Generate events
        generate_events()
        
        # Step 5: Generate daily stats
        generate_daily_stats()
        
        print("\n" + "=" * 60)
        print("✅ SUCCESS! Test data generated")
        print("=" * 60)
        print(f"\n🤖 Test Bot ID: {TEST_BOT_ID}")
        print(f"📍 Location ID: {TEST_LOCATION_ID}")
        print("\nYou can now use this bot to test your frontend!")
        print(f"\nView bot dashboard: /bots/{TEST_BOT_ID}")
        
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()


