# Bot Data Tracking System Guide

## Overview
This guide explains how to track all sensor data from your bots (mow bots, pool bots, etc.) including movement, orientation, environmental sensors, and more.

---

## 📊 Database Tables

### 1. **bot_sensor_readings** (Main Sensor Data)
Stores all sensor readings with specific columns for each sensor type.

**Key Fields:**
- **Power**: `is_on`, `battery_percentage`, `battery_voltage`, `is_charging`
- **Movement**: `direction_degrees`, `rpm`, `distance_traveled_cm`, `speed_cm_per_sec`
- **3D Orientation**: `pitch`, `roll`, `yaw` (from IMU gyroscope)
- **3D Acceleration**: `acceleration_x`, `acceleration_y`, `acceleration_z` (from IMU accelerometer)
- **3D Rotation**: `rotation_x`, `rotation_y`, `rotation_z` (rotation rates in deg/sec)
- **Environment**: `temperature_celsius`, `humidity_percentage`, `is_raining`, `rain_intensity`
- **GPS**: `latitude`, `longitude`, `gps_accuracy_meters`
- **Bot-Specific**: `bot_specific_data` (JSONB for custom fields per bot type)

### 2. **bot_location_history** (GPS Tracking)
Tracks where the bot has been over time - creates a path/trail on a map.

### 3. **bot_events** (Activity Log)
Logs important events like: started, stopped, error occurred, rain detected, battery low, etc.

### 4. **bot_daily_statistics** (Aggregated Stats)
Daily summary: total runtime, distance covered, average battery, error count, etc.

---

## 🤖 Bot-Specific Data (JSONB Field)

Different bot types have different sensors. Use `bot_specific_data` JSONB field:

### Mow Bot Example:
```json
{
  "blade_rpm": 3400,
  "grass_height_detected": 8.5,
  "blade_motor_current": 2.3,
  "emf_sensor_1": 512,
  "emf_sensor_2": 480,
  "emf_sensor_3": 495,
  "trimmer_motor_on": false,
  "boundary_wire_detected": true
}
```

### Pool Bot Example:
```json
{
  "water_temperature": 24.5,
  "water_ph": 7.2,
  "chlorine_level": 3.0,
  "pump_rpm": 1200,
  "filter_pressure": 15.5,
  "cleaning_mode": "floor_only"
}
```

### Weather Station Example:
```json
{
  "wind_speed": 12.5,
  "wind_direction": 270,
  "barometric_pressure": 1013.25,
  "uv_index": 7,
  "rainfall_mm": 2.5,
  "soil_moisture": 45
}
```

---

## 📝 How to Insert Data (ESP8266 → Backend API)

### Option 1: Complete Sensor Snapshot (Recommended)
Send all sensor data at once (e.g., every 5-10 seconds).

**POST** `/api/bots/{bot_id}/sensor-reading`

```json
{
  "recorded_at": "2025-10-21T10:30:45Z",
  "is_on": true,
  "battery_percentage": 87,
  "battery_voltage": 12.4,
  "is_charging": false,
  
  "direction_degrees": 135.5,
  "rpm": 3200,
  "distance_traveled_cm": 25.3,
  "speed_cm_per_sec": 15.8,
  
  "pitch": -2.3,
  "roll": 1.5,
  "yaw": 135.5,
  
  "acceleration_x": 0.15,
  "acceleration_y": -0.05,
  "acceleration_z": 9.81,
  
  "rotation_x": 0.2,
  "rotation_y": -0.1,
  "rotation_z": 5.5,
  
  "temperature_celsius": 28.5,
  "humidity_percentage": 65.0,
  "is_raining": false,
  "rain_intensity": 0,
  
  "latitude": -29.8587,
  "longitude": 31.0218,
  "gps_accuracy_meters": 3.5,
  
  "bot_specific_data": {
    "blade_rpm": 3400,
    "emf_sensor_1": 512,
    "emf_sensor_2": 480,
    "boundary_wire_detected": true
  }
}
```

### Option 2: Individual Telemetry Events
For specific events or less frequent updates, use the existing `bot_telemetry` table.

**POST** `/api/bots/{bot_id}/telemetry`

```json
{
  "telemetry_type": "environmental",
  "data": {
    "temperature": 28.5,
    "humidity": 65.0,
    "is_raining": false,
    "rain_intensity": 0
  }
}
```

---

## 🎯 How to Log Events

When important things happen, create an event:

**POST** `/api/bots/{bot_id}/events`

### Example: Bot Started
```json
{
  "event_type": "started",
  "severity": "info",
  "title": "Mowing Operation Started",
  "description": "Bot began mowing scheduled area",
  "data": {
    "scheduled": true,
    "schedule_id": "abc-123"
  }
}
```

### Example: Rain Detected
```json
{
  "event_type": "rain_detected",
  "severity": "warning",
  "title": "Rain Detected - Returning Home",
  "description": "Rain sensor triggered, bot returning to charging station",
  "latitude": -29.8587,
  "longitude": 31.0218,
  "data": {
    "rain_intensity": 450,
    "action_taken": "return_home"
  }
}
```

### Example: Low Battery
```json
{
  "event_type": "low_battery_warning",
  "severity": "warning",
  "title": "Low Battery - 15%",
  "description": "Battery level below threshold, returning to charge",
  "data": {
    "battery_percentage": 15,
    "estimated_time_remaining_minutes": 8
  }
}
```

---

## 📍 Track Location History

Every time the bot moves significantly, log its position:

**POST** `/api/bots/{bot_id}/location`

```json
{
  "latitude": -29.8587,
  "longitude": 31.0218,
  "altitude": 45.2,
  "accuracy": 3.5,
  "heading": 135.5,
  "speed": 0.15,
  "is_moving": true
}
```

**Tip:** Only log location when:
- Bot moves > 1 meter from last position
- Direction changes significantly
- Every N seconds while moving
- When important events occur

---

## 🔍 How to Query Data (Frontend)

### Get Current Bot Status
```sql
SELECT 
  b.id,
  b.name,
  b.status,
  b.battery_level,
  b.last_online_at,
  sr.temperature_celsius,
  sr.is_on,
  sr.rpm,
  sr.latitude,
  sr.longitude
FROM bots b
LEFT JOIN LATERAL (
  SELECT * FROM bot_sensor_readings
  WHERE bot_id = b.id
  ORDER BY recorded_at DESC
  LIMIT 1
) sr ON true
WHERE b.id = 'bot-uuid-here';
```

### Get Location History (Last 24 Hours)
```sql
SELECT 
  latitude,
  longitude,
  heading,
  speed,
  recorded_at
FROM bot_location_history
WHERE bot_id = 'bot-uuid-here'
  AND recorded_at > NOW() - INTERVAL '24 hours'
ORDER BY recorded_at ASC;
```

### Get Recent Events
```sql
SELECT 
  event_type,
  severity,
  title,
  description,
  data,
  event_timestamp
FROM bot_events
WHERE bot_id = 'bot-uuid-here'
ORDER BY event_timestamp DESC
LIMIT 50;
```

### Get Battery History (Last 7 Days)
```sql
SELECT 
  DATE(recorded_at) as date,
  AVG(battery_percentage) as avg_battery,
  MIN(battery_percentage) as min_battery,
  MAX(battery_percentage) as max_battery
FROM bot_sensor_readings
WHERE bot_id = 'bot-uuid-here'
  AND recorded_at > NOW() - INTERVAL '7 days'
GROUP BY DATE(recorded_at)
ORDER BY date DESC;
```

### Get Temperature & Humidity Over Time
```sql
SELECT 
  recorded_at,
  temperature_celsius,
  humidity_percentage,
  is_raining
FROM bot_sensor_readings
WHERE bot_id = 'bot-uuid-here'
  AND recorded_at > NOW() - INTERVAL '6 hours'
ORDER BY recorded_at ASC;
```

### Get Daily Statistics
```sql
SELECT 
  date,
  total_runtime_minutes,
  total_distance_meters,
  average_battery_level,
  error_count,
  warning_count
FROM bot_daily_statistics
WHERE bot_id = 'bot-uuid-here'
ORDER BY date DESC
LIMIT 30;
```

---

## 🔧 Backend API Implementation (Python FastAPI)

### Example Endpoint: Insert Sensor Reading

```python
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from datetime import datetime
from typing import Optional, Dict, Any

router = APIRouter()

class SensorReadingCreate(BaseModel):
    recorded_at: Optional[datetime] = None
    is_on: Optional[bool] = None
    battery_percentage: Optional[int] = None
    battery_voltage: Optional[float] = None
    is_charging: Optional[bool] = None
    direction_degrees: Optional[float] = None
    rpm: Optional[int] = None
    distance_traveled_cm: Optional[float] = None
    speed_cm_per_sec: Optional[float] = None
    pitch: Optional[float] = None
    roll: Optional[float] = None
    yaw: Optional[float] = None
    acceleration_x: Optional[float] = None
    acceleration_y: Optional[float] = None
    acceleration_z: Optional[float] = None
    rotation_x: Optional[float] = None
    rotation_y: Optional[float] = None
    rotation_z: Optional[float] = None
    temperature_celsius: Optional[float] = None
    humidity_percentage: Optional[float] = None
    is_raining: Optional[bool] = None
    rain_intensity: Optional[int] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    gps_accuracy_meters: Optional[float] = None
    bot_specific_data: Optional[Dict[str, Any]] = None

@router.post("/bots/{bot_id}/sensor-reading")
async def create_sensor_reading(bot_id: str, reading: SensorReadingCreate, supabase=None):
    """
    Receive sensor data from ESP8266 and store it
    """
    try:
        # Insert into bot_sensor_readings
        result = supabase.table("bot_sensor_readings").insert({
            "bot_id": bot_id,
            **reading.dict(exclude_none=True)
        }).execute()
        
        # Update bot's battery level and last_online_at
        if reading.battery_percentage is not None:
            supabase.table("bots").update({
                "battery_level": reading.battery_percentage,
                "last_online_at": datetime.utcnow().isoformat(),
                "status": "online" if reading.is_on else "offline"
            }).eq("id", bot_id).execute()
        
        # If GPS coordinates provided, add to location history
        if reading.latitude and reading.longitude:
            supabase.table("bot_location_history").insert({
                "bot_id": bot_id,
                "latitude": reading.latitude,
                "longitude": reading.longitude,
                "accuracy": reading.gps_accuracy_meters,
                "heading": reading.direction_degrees,
                "speed": reading.speed_cm_per_sec / 100 if reading.speed_cm_per_sec else None,
                "is_moving": reading.speed_cm_per_sec > 1 if reading.speed_cm_per_sec else False
            }).execute()
        
        # Check for alerts (low battery, high temp, etc.)
        await check_and_create_alerts(supabase, bot_id, reading)
        
        return {"success": True, "id": result.data[0]["id"]}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

async def check_and_create_alerts(supabase, bot_id: str, reading: SensorReadingCreate):
    """
    Check sensor readings and create alerts if needed
    """
    # Low battery alert
    if reading.battery_percentage and reading.battery_percentage < 20:
        # Create bot event
        supabase.table("bot_events").insert({
            "bot_id": bot_id,
            "event_type": "low_battery_warning",
            "severity": "warning",
            "title": f"Low Battery - {reading.battery_percentage}%",
            "description": "Battery level below 20%",
            "data": {"battery_percentage": reading.battery_percentage}
        }).execute()
    
    # Rain detected
    if reading.is_raining:
        supabase.table("bot_events").insert({
            "bot_id": bot_id,
            "event_type": "rain_detected",
            "severity": "info",
            "title": "Rain Detected",
            "description": "Rain sensor triggered",
            "data": {"rain_intensity": reading.rain_intensity}
        }).execute()
    
    # High temperature
    if reading.temperature_celsius and reading.temperature_celsius > 45:
        supabase.table("bot_events").insert({
            "bot_id": bot_id,
            "event_type": "temperature_threshold_exceeded",
            "severity": "warning",
            "title": f"High Temperature - {reading.temperature_celsius}°C",
            "description": "Temperature above safe threshold",
            "data": {"temperature": reading.temperature_celsius}
        }).execute()
```

### Example Endpoint: Get Bot Dashboard Data

```python
@router.get("/bots/{bot_id}/dashboard")
async def get_bot_dashboard(bot_id: str, supabase=None):
    """
    Get all data needed for bot dashboard page
    """
    # Get bot info
    bot = supabase.table("bots").select("*").eq("id", bot_id).single().execute()
    
    # Get latest sensor reading
    latest_sensor = supabase.table("bot_sensor_readings")\
        .select("*")\
        .eq("bot_id", bot_id)\
        .order("recorded_at", desc=True)\
        .limit(1)\
        .execute()
    
    # Get recent events (last 20)
    recent_events = supabase.table("bot_events")\
        .select("*")\
        .eq("bot_id", bot_id)\
        .order("event_timestamp", desc=True)\
        .limit(20)\
        .execute()
    
    # Get location history (last 100 points)
    location_history = supabase.table("bot_location_history")\
        .select("*")\
        .eq("bot_id", bot_id)\
        .order("recorded_at", desc=True)\
        .limit(100)\
        .execute()
    
    # Get today's statistics
    from datetime import date
    today_stats = supabase.table("bot_daily_statistics")\
        .select("*")\
        .eq("bot_id", bot_id)\
        .eq("date", date.today())\
        .single()\
        .execute()
    
    return {
        "bot": bot.data,
        "latest_sensor": latest_sensor.data[0] if latest_sensor.data else None,
        "recent_events": recent_events.data,
        "location_history": location_history.data,
        "today_stats": today_stats.data if today_stats.data else None
    }
```

---

## 🎨 Frontend Components to Build

1. **Bot Dashboard Page**
   - Current status card (on/off, battery, location)
   - Real-time sensor readings (temp, humidity, RPM)
   - Map with current position and path history
   - Event timeline

2. **Bot Map View**
   - Interactive map showing bot location
   - Trail/path of where bot has been
   - Heatmap of coverage area

3. **Sensor Graphs**
   - Battery level over time (line chart)
   - Temperature & humidity (dual-axis line chart)
   - Distance traveled (bar chart per day)
   - RPM over time

4. **Event Log**
   - Filterable table of all events
   - Color-coded by severity
   - Expandable for details

5. **Statistics Page**
   - Daily/weekly/monthly stats
   - Total distance covered
   - Average battery life
   - Uptime percentage

---

## 🚀 Next Steps

1. ✅ **Run the migration** to create these tables
2. ⬜ **Create backend API endpoints** (see examples above)
3. ⬜ **Build frontend components** to display data
4. ⬜ **Test with mock data** before hardware is ready
5. ⬜ **Integrate ESP8266** when hardware is complete

---

## 💡 Tips

- **Start simple**: Log just battery and on/off status first
- **Test with curl**: Insert test data manually before ESP8266 is ready
- **Use mock data**: Create seed data to build frontend with
- **Optimize queries**: Add indexes if queries are slow
- **Consider data retention**: Maybe delete sensor readings > 90 days old
- **Real-time updates**: Consider using Supabase Realtime subscriptions for live dashboard

---

## 🧪 Insert Test Data (SQL)

```sql
-- Insert a test bot if you don't have one
INSERT INTO bots (id, location_id, name, bot_type, serial_number, status)
VALUES (
  '550e8400-e29b-41d4-a716-446655440000',
  'your-location-id-here',
  'Test Mow Bot #1',
  'mow_bot',
  'MOWBOT-001',
  'online'
);

-- Insert test sensor reading
INSERT INTO bot_sensor_readings (
  bot_id, is_on, battery_percentage, temperature_celsius, 
  humidity_percentage, rpm, direction_degrees
) VALUES (
  '550e8400-e29b-41d4-a716-446655440000',
  true, 85, 28.5, 65.0, 3200, 135.5
);

-- Insert test event
INSERT INTO bot_events (
  bot_id, event_type, severity, title, description
) VALUES (
  '550e8400-e29b-41d4-a716-446655440000',
  'started',
  'info',
  'Mowing Started',
  'Bot began routine mowing operation'
);

-- Insert test location
INSERT INTO bot_location_history (
  bot_id, latitude, longitude, is_moving
) VALUES (
  '550e8400-e29b-41d4-a716-446655440000',
  -29.8587, 31.0218, true
);
```

---

Good luck building your bot tracking system! 🤖🚀


