#!/usr/bin/env python3

"""
Seed Service Data

This script seeds the database with service-related data:
1. Garden environmental data (temperature, humidity, soil moisture)
2. Mowing sessions with detailed sensor data
3. Service events

Usage:
    python seed_service_data.py [--user-email EMAIL]
"""

import sys
import json
import random
import math
from pathlib import Path
from datetime import datetime, timedelta
import urllib.request
import urllib.error

# Supabase configuration
SUPABASE_URL = 'https://kyoowsarfopltjwmhksi.supabase.co'
SUPABASE_SERVICE_KEY = 'REDACTED_JWT'

# Default user
DEFAULT_USER_EMAIL = "botkorpza@gmail.com"

# Data generation configuration
DAYS_OF_HISTORY = 30  # Generate 30 days of historical data
ENV_DATA_INTERVAL_MINUTES = 30  # Environmental data every 30 minutes
SESSIONS_PER_WEEK = 3  # Average mowing sessions per week
SENSOR_DATA_INTERVAL_SECONDS = 5  # Sensor data every 5 seconds during session


def supabase_request(endpoint, method='GET', data=None, params=None):
    """Make a request to Supabase REST API."""
    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
    
    if params:
        query = '&'.join([f"{k}={v}" for k, v in params.items()])
        url = f"{url}?{query}"
    
    headers = {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
    }
    
    req_data = json.dumps(data).encode('utf-8') if data else None
    
    req = urllib.request.Request(url, data=req_data, headers=headers, method=method)
    
    try:
        with urllib.request.urlopen(req) as response:
            result = response.read().decode('utf-8')
            return json.loads(result) if result else None
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        print(f"❌ HTTP Error {e.code}: {error_body}")
        raise


def get_user_by_email(email):
    """Get user ID by email."""
    try:
        users = supabase_request('profiles', params={'email': f'eq.{email}', 'select': 'id,email'})
        if users and len(users) > 0:
            return users[0]
        return None
    except Exception as e:
        print(f"❌ Error fetching user: {e}")
        return None


def get_user_services(user_id):
    """Get all services for a user (via their organizations)."""
    try:
        # First get user's organizations
        memberships = supabase_request('organization_members', params={
            'user_id': f'eq.{user_id}',
            'select': 'organization_id'
        })
        
        if not memberships:
            return []
        
        org_ids = [m['organization_id'] for m in memberships]
        
        # Get services for these organizations
        services = []
        for org_id in org_ids:
            org_services = supabase_request('services', params={
                'organization_id': f'eq.{org_id}',
                'service_type': 'eq.lawn',
                'select': '*'
            })
            if org_services:
                services.extend(org_services)
        
        return services
    except Exception as e:
        print(f"❌ Error fetching services: {e}")
        return []


def get_service_gardens(service_id):
    """Get all gardens for a service."""
    try:
        gardens = supabase_request('gardens', params={
            'service_id': f'eq.{service_id}',
            'select': '*'
        })
        return gardens or []
    except Exception as e:
        print(f"❌ Error fetching gardens: {e}")
        return []


def get_location_bots(location_id):
    """Get all bots for a location."""
    try:
        bots = supabase_request('bots', params={
            'location_id': f'eq.{location_id}',
            'bot_type': 'eq.mow_bot',
            'select': '*'
        })
        return bots or []
    except Exception as e:
        print(f"❌ Error fetching bots: {e}")
        return []


def generate_environmental_data(garden, bot_id, start_time, end_time):
    """Generate environmental data for a garden over a time period."""
    data_points = []
    current_time = start_time
    
    # Get garden location or use default
    base_lat = garden.get('latitude', -29.8587)
    base_lng = garden.get('longitude', 31.0218)
    
    while current_time <= end_time:
        # Time-based temperature simulation (warmer during day)
        hour = current_time.hour
        if 6 <= hour <= 18:
            base_temp = 18 + (hour - 6) * 1.2
        else:
            base_temp = 18
        
        temperature = base_temp + random.uniform(-3, 3)
        
        # Humidity inversely related to temperature
        humidity = 70 - (temperature - 20) * 2 + random.uniform(-10, 10)
        humidity = max(30, min(95, humidity))
        
        # Soil moisture varies more slowly
        soil_moisture = 45 + random.uniform(-15, 15)
        soil_moisture = max(20, min(80, soil_moisture))
        
        # Random chance of rain (5% during day, 10% at night)
        is_raining = random.random() < (0.05 if 6 <= hour <= 18 else 0.1)
        rain_intensity = random.randint(200, 800) if is_raining else 0
        
        # Small random location variation
        lat = base_lat + random.uniform(-0.0001, 0.0001)
        lng = base_lng + random.uniform(-0.0001, 0.0001)
        
        data_points.append({
            'garden_id': garden['id'],
            'bot_id': bot_id,
            'temperature_celsius': round(temperature, 2),
            'humidity_percentage': round(humidity, 2),
            'soil_moisture_percentage': round(soil_moisture, 2),
            'is_raining': is_raining,
            'rain_intensity': rain_intensity if is_raining else None,
            'latitude': round(lat, 8),
            'longitude': round(lng, 8),
            'sensor_data': json.dumps({
                'emf_sensor_1': random.randint(450, 550),
                'emf_sensor_2': random.randint(450, 550),
                'emf_sensor_3': random.randint(450, 550),
            }),
            'recorded_at': current_time.isoformat(),
        })
        
        current_time += timedelta(minutes=ENV_DATA_INTERVAL_MINUTES)
    
    return data_points


def generate_mowing_session(garden, bot_id, session_start):
    """Generate a complete mowing session with sensor data."""
    
    # Session duration: 20-60 minutes
    duration_minutes = random.randint(20, 60)
    session_end = session_start + timedelta(minutes=duration_minutes)
    
    # Battery usage
    battery_start = random.randint(85, 100)
    battery_consumed = random.randint(15, 40)
    battery_end = max(10, battery_start - battery_consumed)
    
    # Performance metrics
    area_covered = garden.get('area_sqm', 200) * random.uniform(0.8, 1.0)
    distance_traveled = area_covered * random.uniform(3, 5)  # meters
    avg_speed = distance_traveled / (duration_minutes * 60)  # m/s
    
    # Completion status
    if battery_end < 15:
        status = 'low_battery'
    elif random.random() < 0.1:
        status = random.choice(['interrupted', 'rain', 'manual_stop'])
    else:
        status = 'completed'
    
    # Location trail (simplified - just a few waypoints)
    base_lat = garden.get('latitude', -29.8587)
    base_lng = garden.get('longitude', 31.0218)
    
    trail = []
    for i in range(10):  # 10 waypoints
        timestamp = session_start + timedelta(minutes=i * (duration_minutes / 10))
        angle = (i * 36) % 360  # Rotate around
        radius = 0.0001 * (i % 5)
        lat = base_lat + (radius * math.cos(math.radians(angle)))
        lng = base_lng + (radius * math.sin(math.radians(angle)))
        trail.append({
            'lat': round(lat, 8),
            'lon': round(lng, 8),
            'timestamp': timestamp.isoformat()
        })
    
    session = {
        'garden_id': garden['id'],
        'bot_id': bot_id,
        'session_start': session_start.isoformat(),
        'session_end': session_end.isoformat(),
        'duration_minutes': duration_minutes,
        'area_covered_sqm': round(area_covered, 2),
        'distance_traveled_meters': round(distance_traveled, 2),
        'average_speed_mps': round(avg_speed, 2),
        'battery_start_percentage': battery_start,
        'battery_end_percentage': battery_end,
        'battery_consumed_percentage': battery_consumed,
        'completion_status': status,
        'location_trail': json.dumps(trail),
        'notes': f'Simulated mowing session - {status}'
    }
    
    return session, duration_minutes


def generate_sensor_data_for_session(session_id, session_start, duration_minutes, bot_id, garden):
    """Generate detailed sensor data during a mowing session."""
    sensor_data = []
    
    base_lat = garden.get('latitude', -29.8587)
    base_lng = garden.get('longitude', 31.0218)
    
    # Generate sensor readings throughout the session
    total_seconds = duration_minutes * 60
    num_readings = total_seconds // SENSOR_DATA_INTERVAL_SECONDS
    
    # Limit to reasonable number of readings
    num_readings = min(num_readings, 500)
    
    current_time = session_start
    angle = 0
    position_offset = 0
    battery = session_start.hour  # Use hour as seed for battery variation
    
    for i in range(num_readings):
        # Update position
        angle = (angle + random.uniform(5, 15)) % 360
        position_offset += 1
        radius = 0.0001 * (position_offset % 50)
        lat = base_lat + (radius * math.cos(math.radians(angle)))
        lng = base_lng + (radius * math.sin(math.radians(angle)))
        
        # Battery drains
        battery_pct = 100 - (i / num_readings) * 30  # Drains 30% over session
        battery_voltage = 11.0 + (battery_pct / 100) * 1.6
        
        # Motor RPMs
        blade_rpm = 3400 + random.randint(-100, 100)
        drive_rpm = 150 + random.randint(-10, 10)
        
        # Orientation (varies on uneven terrain)
        pitch = round(random.uniform(-5, 5), 2)
        roll = round(random.uniform(-5, 5), 2)
        yaw = round(angle, 2)
        if yaw >= 360:  # Safety check after rounding
            yaw = 0.0
        
        # 3D Acceleration
        accel_x = round(random.uniform(-0.5, 0.5), 4)
        accel_y = round(random.uniform(-0.5, 0.5), 4)
        accel_z = round(9.81 + random.uniform(-0.2, 0.2), 4)
        
        # 3D Rotation rates
        gyro_x = round(random.uniform(-1, 1), 4)
        gyro_y = round(random.uniform(-1, 1), 4)
        gyro_z = round(random.uniform(-5, 5), 4)
        
        # Environmental
        temperature = 22 + random.uniform(-2, 8)
        humidity = 60 + random.uniform(-10, 10)
        
        sensor_data.append({
            'session_id': session_id,
            'recorded_at': current_time.isoformat(),
            'blade_rpm': blade_rpm,
            'drive_rpm': drive_rpm,
            'direction_degrees': yaw,
            'pitch': pitch,
            'roll': roll,
            'yaw': yaw,
            'accel_x': accel_x,
            'accel_y': accel_y,
            'accel_z': accel_z,
            'gyro_x': gyro_x,
            'gyro_y': gyro_y,
            'gyro_z': gyro_z,
            'battery_percentage': int(battery_pct),
            'battery_voltage': round(battery_voltage, 2),
            'current_draw_amps': round(random.uniform(2, 5), 2),
            'temperature_celsius': round(temperature, 2),
            'humidity_percentage': round(humidity, 2),
            'latitude': round(lat, 8),
            'longitude': round(lng, 8),
            'gps_accuracy_meters': round(random.uniform(2, 5), 2),
            'sensor_data': json.dumps({
                'grass_height_cm': round(random.uniform(3, 12), 1),
                'blade_sharpness': round(random.uniform(70, 100), 1)
            })
        })
        
        current_time += timedelta(seconds=SENSOR_DATA_INTERVAL_SECONDS)
    
    return sensor_data


def batch_insert(table, data, batch_size=100):
    """Insert data in batches."""
    total = len(data)
    inserted = 0
    
    for i in range(0, total, batch_size):
        batch = data[i:i + batch_size]
        try:
            supabase_request(table, method='POST', data=batch)
            inserted += len(batch)
            print(f"   Inserted {inserted}/{total} records...", end='\r')
        except Exception as e:
            print(f"\n❌ Error inserting batch: {e}")
            raise
    
    print(f"   Inserted {inserted}/{total} records... Done!")
    return inserted


def seed_garden_data(garden, bot_id, service_id):
    """Seed all data for a garden."""
    print(f"\n📊 Seeding data for garden: {garden['name']}")
    print(f"   Garden ID: {garden['id']}")
    print(f"   Bot ID: {bot_id}")
    
    end_time = datetime.now()
    start_time = end_time - timedelta(days=DAYS_OF_HISTORY)
    
    # 1. Generate environmental data
    print(f"\n🌡️  Generating environmental data...")
    env_data = generate_environmental_data(garden, bot_id, start_time, end_time)
    print(f"   Generated {len(env_data)} environmental readings")
    
    print(f"   Inserting into database...")
    batch_insert('garden_environmental_data', env_data)
    
    # 2. Generate mowing sessions
    print(f"\n✂️  Generating mowing sessions...")
    
    # Generate sessions randomly throughout the period
    total_sessions = int((DAYS_OF_HISTORY / 7) * SESSIONS_PER_WEEK)
    sessions = []
    all_sensor_data = []
    
    for i in range(total_sessions):
        # Random time during the period (between 7 AM and 5 PM)
        random_day = start_time + timedelta(days=random.randint(0, DAYS_OF_HISTORY - 1))
        session_hour = random.randint(7, 17)
        session_start = random_day.replace(hour=session_hour, minute=random.randint(0, 59), second=0, microsecond=0)
        
        # Skip if too recent (within last hour)
        if session_start > end_time - timedelta(hours=1):
            continue
        
        session_data, duration = generate_mowing_session(garden, bot_id, session_start)
        sessions.append(session_data)
    
    print(f"   Generated {len(sessions)} mowing sessions")
    print(f"   Inserting sessions into database...")
    
    # Insert sessions and collect IDs
    inserted_sessions = []
    for session in sessions:
        try:
            result = supabase_request('garden_mowing_sessions', method='POST', data=[session])
            if result and len(result) > 0:
                inserted_sessions.append(result[0])
        except Exception as e:
            print(f"\n❌ Error inserting session: {e}")
    
    print(f"   Inserted {len(inserted_sessions)} sessions")
    
    # 3. Generate sensor data for each session
    print(f"\n🔧 Generating sensor data for sessions...")
    total_sensor_data = 0
    
    for idx, session in enumerate(inserted_sessions):
        session_id = session['id']
        session_start = datetime.fromisoformat(session['session_start'].replace('Z', '+00:00'))
        duration = session['duration_minutes']
        
        sensor_data = generate_sensor_data_for_session(session_id, session_start, duration, bot_id, garden)
        all_sensor_data.extend(sensor_data)
        total_sensor_data += len(sensor_data)
        
        if (idx + 1) % 5 == 0:
            print(f"   Generated sensor data for {idx + 1}/{len(inserted_sessions)} sessions...")
    
    print(f"   Generated {total_sensor_data} sensor readings total")
    print(f"   Inserting sensor data into database...")
    batch_insert('garden_mowing_sensor_data', all_sensor_data)
    
    print(f"\n✅ Garden data seeding complete!")
    print(f"   Environmental readings: {len(env_data)}")
    print(f"   Mowing sessions: {len(inserted_sessions)}")
    print(f"   Sensor readings: {total_sensor_data}")


def main():
    """Main execution function."""
    try:
        print("\n" + "="*60)
        print("🌱 BOTKORP SERVICE DATA SEEDER")
        print("="*60 + "\n")
        
        # Get user email from args or use default
        user_email = DEFAULT_USER_EMAIL
        if len(sys.argv) > 1:
            user_email = sys.argv[1]
        
        print(f"👤 User: {user_email}\n")
        
        # Get user
        user = get_user_by_email(user_email)
        if not user:
            print(f"❌ User not found: {user_email}")
            return 1
        
        user_id = user['id']
        print(f"✅ Found user: {user['email']} (ID: {user_id})\n")
        
        # Get user's services
        print(f"📋 Fetching services...")
        services = get_user_services(user_id)
        
        if not services:
            print(f"❌ No lawn services found for user")
            return 1
        
        print(f"✅ Found {len(services)} lawn service(s)\n")
        
        # Process each service
        for service in services:
            print(f"\n" + "="*60)
            print(f"🏡 Processing Service: {service['name']}")
            print(f"   Service ID: {service['id']}")
            print(f"   Location ID: {service['location_id']}")
            print("="*60)
            
            # Get gardens for this service
            gardens = get_service_gardens(service['id'])
            if not gardens:
                print(f"⚠️  No gardens found for this service")
                continue
            
            print(f"\n✅ Found {len(gardens)} garden(s)")
            for g in gardens:
                print(f"   - {g['name']} ({g.get('area_sqm', '?')} m²)")
            
            # Get bots for this location
            bots = get_location_bots(service['location_id'])
            if not bots:
                print(f"\n⚠️  No bots found for this location")
                print(f"   You may need to create bots first")
                continue
            
            print(f"\n✅ Found {len(bots)} bot(s)")
            for b in bots:
                print(f"   - {b['name']} ({b.get('serial_number', 'no serial')})")
            
            # Seed data for each garden
            for garden in gardens:
                # Use first available bot for simplicity
                # In production, you might want to assign bots more intelligently
                bot_id = bots[0]['id']
                
                try:
                    seed_garden_data(garden, bot_id, service['id'])
                except Exception as e:
                    print(f"\n❌ Error seeding garden data: {e}")
                    import traceback
                    traceback.print_exc()
                    continue
        
        print("\n" + "="*60)
        print("✅ SERVICE DATA SEEDING COMPLETE!")
        print("="*60 + "\n")
        
        print("You can now view the data in the frontend:")
        print("  1. Log in with your account")
        print("  2. Navigate to Services")
        print("  3. View environmental data and mowing sessions")
        print()
        
        return 0
        
    except KeyboardInterrupt:
        print('\n\n⚠️  Seeding cancelled by user\n')
        return 1
    except Exception as e:
        print(f'❌ Fatal error: {str(e)}')
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    sys.exit(main())

