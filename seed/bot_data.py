#!/usr/bin/env python3
"""
Generate realistic bot tracking data for testing
Finds first available service and generates sensor data, location history, and events
"""
import sys
import json
from datetime import datetime, timedelta
import random
import math
from typing import List, Dict, Any
import urllib.request
import urllib.error

# Supabase configuration (from main.py)
SUPABASE_URL = 'https://kyoowsarfopltjwmhksi.supabase.co'
SUPABASE_SERVICE_KEY = 'REDACTED_JWT'

def make_request(method, endpoint, data=None):
    """Make HTTP request to Supabase"""
    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
    headers = {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
    }
    
    request_data = json.dumps(data).encode('utf-8') if data else None
    req = urllib.request.Request(url, data=request_data, headers=headers, method=method)
    
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        print(f"HTTP Error {e.code}: {error_body}")
        raise

def get_first_service():
    """Find the first available service record"""
    result = make_request('GET', 'service_records?limit=1')
    if result and len(result) > 0:
        return result[0]
    return None

def get_bots_for_location(location_id: str):
    """Get all bots for a location"""
    result = make_request('GET', f'bots?location_id=eq.{location_id}')
    return result

def generate_gps_path(center_lat: float, center_lon: float, num_points: int = 100, radius: float = 0.0005):
    """
    Generate a realistic lawn mowing pattern (back and forth)
    radius in degrees (0.0005 is roughly 50 meters)
    """
    points = []
    
    # Create a lawn mowing pattern (parallel lines)
    rows = 10
    points_per_row = num_points // rows
    
    for row in range(rows):
        y_offset = (row / rows - 0.5) * radius * 2
        
        # Alternate direction for each row
        if row % 2 == 0:
            x_range = range(points_per_row)
        else:
            x_range = range(points_per_row - 1, -1, -1)
        
        for i in x_range:
            x_offset = (i / points_per_row - 0.5) * radius * 2
            
            # Add some natural variation
            x_offset += random.uniform(-0.00002, 0.00002)
            y_offset += random.uniform(-0.00002, 0.00002)
            
            points.append({
                'latitude': center_lat + y_offset,
                'longitude': center_lon + x_offset
            })
    
    return points

def generate_location_history(bot_id: str, hours_back: int = 6):
    """Generate location history for a bot (lawn mowing pattern)"""
    print(f"  📍 Generating location history ({hours_back} hours)...")
    
    # Random center point (adjust these to match your area)
    center_lat = -26.0 + random.uniform(-0.5, 0.5)  # Johannesburg area
    center_lon = 28.0 + random.uniform(-0.5, 0.5)
    
    # Generate points (one every 30 seconds = 120 points per hour)
    num_points = hours_back * 120
    gps_path = generate_gps_path(center_lat, center_lon, num_points)
    
    now = datetime.utcnow()
    records = []
    
    for i, point in enumerate(gps_path):
        recorded_at = now - timedelta(seconds=(len(gps_path) - i) * 30)
        
        # Calculate movement data
        speed = random.uniform(0.2, 0.8)  # m/s (slow lawn mower speed)
        heading = random.uniform(0, 360)
        
        records.append({
            'bot_id': bot_id,
            'latitude': str(point['latitude']),
            'longitude': str(point['longitude']),
            'altitude': str(random.uniform(1500, 1520)),  # Johannesburg altitude
            'accuracy': str(random.uniform(2, 8)),
            'heading': str(heading),
            'speed': str(speed),
            'is_moving': speed > 0.1,
            'recorded_at': recorded_at.isoformat() + 'Z'
        })
    
    # Batch insert
    batch_size = 100
    for i in range(0, len(records), batch_size):
        batch = records[i:i+batch_size]
        make_request('POST', 'bot_location_history', batch)
    
    print(f"    ✓ Created {len(records)} location points")
    return records

def generate_sensor_readings(bot_id: str, hours_back: int = 6):
    """Generate realistic sensor readings"""
    print(f"  📊 Generating sensor readings ({hours_back} hours)...")
    
    now = datetime.utcnow()
    readings = []
    
    # Generate one reading per minute
    num_readings = hours_back * 60
    
    # Base values that change gradually over time
    base_battery = 95
    base_temp = 22
    base_humidity = 60
    
    for i in range(num_readings):
        recorded_at = now - timedelta(minutes=(num_readings - i))
        
        # Battery drains gradually
        battery = max(20, base_battery - (i / num_readings) * 30)
        
        # Temperature varies throughout the day
        temp_variation = 5 * math.sin((i / num_readings) * math.pi)
        temp = base_temp + temp_variation + random.uniform(-1, 1)
        
        # Humidity varies inversely with temperature
        humidity = base_humidity - temp_variation * 2 + random.uniform(-5, 5)
        
        # Bot is on for first 70% of time, then charging
        is_on = i < (num_readings * 0.7)
        is_charging = not is_on
        
        reading = {
            'bot_id': bot_id,
            'recorded_at': recorded_at.isoformat() + 'Z',
            'is_on': is_on,
            'battery_percentage': int(battery),
            'battery_voltage': round(12.0 + (battery / 100) * 4, 2),
            'is_charging': is_charging,
            'direction_degrees': str(random.uniform(0, 360)) if is_on else None,
            'rpm': random.randint(800, 1200) if is_on else 0,
            'distance_traveled_cm': str(random.uniform(20, 50)) if is_on else str(0),
            'speed_cm_per_sec': str(random.uniform(30, 80)) if is_on else str(0),
            'pitch': str(random.uniform(-5, 5)),
            'roll': str(random.uniform(-5, 5)),
            'yaw': str(random.uniform(0, 360)),
            'acceleration_x': str(random.uniform(-0.5, 0.5)),
            'acceleration_y': str(random.uniform(-0.5, 0.5)),
            'acceleration_z': str(random.uniform(9.5, 10.5)),  # Gravity
            'rotation_x': str(random.uniform(-2, 2)),
            'rotation_y': str(random.uniform(-2, 2)),
            'rotation_z': str(random.uniform(-2, 2)),
            'temperature_celsius': str(round(temp, 2)),
            'humidity_percentage': str(round(max(0, min(100, humidity)), 2)),
            'is_raining': random.random() < 0.05,  # 5% chance of rain
            'rain_intensity': random.randint(0, 100) if random.random() < 0.05 else 0,
            'latitude': str(-26.0 + random.uniform(-0.001, 0.001)),
            'longitude': str(28.0 + random.uniform(-0.001, 0.001)),
            'gps_accuracy_meters': str(random.uniform(2, 8))
        }
        
        readings.append(reading)
    
    # Batch insert
    batch_size = 100
    for i in range(0, len(readings), batch_size):
        batch = readings[i:i+batch_size]
        make_request('POST', 'bot_sensor_readings', batch)
    
    print(f"    ✓ Created {len(readings)} sensor readings")
    return readings

def generate_events(bot_id: str, hours_back: int = 6):
    """Generate realistic bot events"""
    print(f"  🎯 Generating bot events...")
    
    now = datetime.utcnow()
    events = []
    
    # Define event sequence
    event_sequence = [
        {
            'time_offset': hours_back * 60 - 5,  # 5 min before end
            'event_type': 'powered_on',
            'severity': 'info',
            'title': 'Bot Powered On',
            'description': 'Bot successfully powered on and initialized'
        },
        {
            'time_offset': hours_back * 60 - 4,
            'event_type': 'started',
            'severity': 'info',
            'title': 'Mowing Started',
            'description': 'Bot started lawn mowing routine'
        },
        {
            'time_offset': hours_back * 30,  # Halfway through
            'event_type': 'obstacle_detected',
            'severity': 'warning',
            'title': 'Obstacle Detected',
            'description': 'Bot detected obstacle and adjusted path'
        },
        {
            'time_offset': hours_back * 15,  # 75% through
            'event_type': 'low_battery_warning',
            'severity': 'warning',
            'title': 'Low Battery Warning',
            'description': 'Battery level below 30%, returning to base soon'
        },
        {
            'time_offset': hours_back * 12,
            'event_type': 'route_completed',
            'severity': 'info',
            'title': 'Route Completed',
            'description': 'Successfully completed mowing route'
        },
        {
            'time_offset': hours_back * 10,
            'event_type': 'returned_home',
            'severity': 'info',
            'title': 'Returned to Base',
            'description': 'Bot returned to charging station'
        },
        {
            'time_offset': hours_back * 9,
            'event_type': 'charging_started',
            'severity': 'info',
            'title': 'Charging Started',
            'description': 'Bot connected to charging station'
        },
        {
            'time_offset': 10,  # 10 minutes ago
            'event_type': 'charging_completed',
            'severity': 'info',
            'title': 'Charging Completed',
            'description': 'Battery fully charged'
        }
    ]
    
    # Add random rain detection if applicable
    if random.random() < 0.2:  # 20% chance
        event_sequence.insert(3, {
            'time_offset': hours_back * 40,
            'event_type': 'rain_detected',
            'severity': 'warning',
            'title': 'Rain Detected',
            'description': 'Rain sensor detected precipitation, pausing operation'
        })
    
    for event_def in event_sequence:
        event_time = now - timedelta(minutes=event_def['time_offset'])
        
        event = {
            'bot_id': bot_id,
            'event_type': event_def['event_type'],
            'severity': event_def['severity'],
            'title': event_def['title'],
            'description': event_def['description'],
            'event_timestamp': event_time.isoformat() + 'Z',
            'latitude': str(-26.0 + random.uniform(-0.001, 0.001)),
            'longitude': str(28.0 + random.uniform(-0.001, 0.001)),
            'data': {
                'source': 'automated_test_data',
                'details': f"Generated event for {event_def['event_type']}"
            }
        }
        
        events.append(event)
    
    # Insert all events
    make_request('POST', 'bot_events', events)
    print(f"    ✓ Created {len(events)} events")
    return events

def generate_daily_statistics(bot_id: str, days_back: int = 7):
    """Generate daily statistics for the past N days"""
    print(f"  📈 Generating daily statistics ({days_back} days)...")
    
    stats = []
    now = datetime.utcnow().date()
    
    for i in range(days_back):
        date = now - timedelta(days=i)
        
        # Vary stats day by day
        is_weekend = date.weekday() >= 5
        runtime = random.randint(180, 300) if not is_weekend else random.randint(120, 180)
        
        stat = {
            'bot_id': bot_id,
            'date': date.isoformat(),
            'total_runtime_minutes': runtime,
            'active_time_minutes': int(runtime * 0.7),
            'idle_time_minutes': int(runtime * 0.2),
            'charging_time_minutes': int(runtime * 0.1),
            'total_distance_meters': str(round(random.uniform(2000, 5000), 2)),
            'area_covered_sqm': str(round(random.uniform(800, 1500), 2)),
            'average_battery_level': str(round(random.uniform(50, 80), 2)),
            'min_battery_level': random.randint(15, 30),
            'max_battery_level': random.randint(95, 100),
            'charge_cycles': random.randint(1, 3),
            'total_events': random.randint(5, 15),
            'error_count': random.randint(0, 2),
            'warning_count': random.randint(1, 5),
            'average_temperature': str(round(random.uniform(18, 28), 2)),
            'max_temperature': str(round(random.uniform(28, 35), 2)),
            'min_temperature': str(round(random.uniform(12, 18), 2)),
            'rain_detected_count': random.randint(0, 3)
        }
        
        stats.append(stat)
    
    # Insert all stats
    make_request('POST', 'bot_daily_statistics', stats)
    print(f"    ✓ Created {len(stats)} daily statistics")
    return stats

def main():
    print("🤖 Bot Data Generator")
    print("=" * 50)
    
    # Find first service
    print("\n📋 Finding first available service...")
    service = get_first_service()
    
    if not service:
        print("❌ No services found in database")
        return 1
    
    print(f"✓ Found service: {service.get('id')}")
    location_id = service.get('location_id')
    
    if not location_id:
        print("❌ Service has no location_id")
        return 1
    
    # Find bots for this location
    print(f"\n🤖 Finding bots for location: {location_id}")
    bots = get_bots_for_location(location_id)
    
    if not bots:
        print("❌ No bots found for this location")
        return 1
    
    print(f"✓ Found {len(bots)} bot(s)")
    
    # Generate data for each bot
    for bot in bots:
        bot_id = bot['id']
        bot_name = bot.get('name', 'Unnamed Bot')
        bot_type = bot.get('bot_type', 'unknown')
        
        print(f"\n{'='*50}")
        print(f"🤖 Generating data for: {bot_name} ({bot_type})")
        print(f"   Bot ID: {bot_id}")
        print(f"{'='*50}")
        
        try:
            # Generate location history (last 6 hours)
            generate_location_history(bot_id, hours_back=6)
            
            # Generate sensor readings (last 6 hours)
            generate_sensor_readings(bot_id, hours_back=6)
            
            # Generate events
            generate_events(bot_id, hours_back=6)
            
            # Generate daily statistics (last 7 days)
            generate_daily_statistics(bot_id, days_back=7)
            
            print(f"\n✅ Successfully generated data for {bot_name}")
            
        except Exception as e:
            print(f"\n❌ Error generating data for {bot_name}: {str(e)}")
            import traceback
            traceback.print_exc()
    
    print("\n" + "="*50)
    print("✅ Data generation complete!")
    print("="*50)
    return 0

if __name__ == "__main__":
    sys.exit(main())

