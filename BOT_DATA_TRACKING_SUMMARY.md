# 🤖 Bot Data Tracking System - Complete Summary

## What We Built

A complete system to track sensor data from your robots (mow bots, pool bots, weather stations, etc.), including:
- Motor RPM and direction
- 3D orientation (pitch, roll, yaw)
- 3D acceleration and rotation
- Temperature, humidity, rain sensors
- Battery level and charging status
- GPS location tracking
- Event logging
- Daily statistics

---

## 📦 What Was Created

### 1. **Database Migration** 
**File:** `/supabase/migrations/20251021100001_bot_data_tracking_system.sql`

Creates 4 new tables:

#### `bot_sensor_readings`
Stores all sensor data with specific columns for each type:
- Power: battery, voltage, on/off, charging status
- Movement: direction, RPM, speed, distance
- 3D Orientation: pitch, roll, yaw (from IMU gyroscope)
- 3D Acceleration: X, Y, Z axes (from IMU accelerometer)  
- 3D Rotation: rotation rates in degrees/second
- Environment: temperature, humidity, rain sensor
- GPS: latitude, longitude, accuracy
- Bot-specific data (JSONB for custom sensors per bot type)

#### `bot_location_history`
GPS tracking - creates a trail/path showing where bot has been:
- Latitude, longitude, altitude
- Heading, speed, movement status
- Links to sensor readings

#### `bot_events`
Activity log for important events:
- Bot started/stopped
- Rain detected
- Low battery warnings
- Errors and alerts
- Maintenance events
- Custom events

#### `bot_daily_statistics`
Aggregated daily stats:
- Total runtime, distance traveled
- Battery usage (avg, min, max)
- Event counts (errors, warnings)
- Environmental data (temp, rain)

### 2. **Backend Guide**
**File:** `/backend/BOT_DATA_TRACKING_GUIDE.md`

Complete documentation with:
- Table explanations
- How to insert data (ESP8266 → API)
- Example API endpoints (Python FastAPI)
- SQL queries for frontend
- Bot-specific JSONB examples (mow bot vs pool bot)
- Real-time alerts (low battery, rain, etc.)

### 3. **Test Data Script**
**File:** `/backend/tests/test_bot_sensor_data.py`

Python script that generates realistic mock data:
- Creates a test bot if you don't have one
- Generates 24 hours of sensor readings (every 5 minutes)
- Simulates realistic data (battery drain, temperature changes, movement patterns)
- Creates GPS location trail
- Generates events (started, stopped, obstacles, warnings)
- Creates daily statistics

**Run it to populate your database for frontend development!**

### 4. **Frontend Component**
**File:** `/src/pages/admin/bot-dashboard-page.jsx`

React component showing:
- **Quick Stats Cards:** Battery, temperature, RPM, location
- **Sensor Details Panel:** 3D orientation, acceleration, movement, environment
- **Today's Statistics:** Runtime, distance, events, battery usage
- **Recent Events Timeline:** Filterable event log with severity colors
- **Location Map Placeholder:** Ready for map integration

**Features:**
- Real-time updates via Supabase subscriptions
- Beautiful UI with shadcn/ui components
- Responsive design
- Auto-refreshing data

### 5. **Route Added**
**File:** `/src/routes.jsx` (updated)

Added route: `/admin/bot/:botId`

Access dashboard at: `http://localhost:5173/admin/bot/YOUR-BOT-ID`

---

## 🚀 How to Use This System

### Step 1: Run the Migration

```bash
# If using Supabase CLI locally
cd /home/exo/botkorp-mono
supabase db reset  # This will run all migrations including the new one

# Or apply this specific migration
psql -h your-db-host -U postgres -d postgres -f supabase/migrations/20251021100001_bot_data_tracking_system.sql
```

### Step 2: Generate Test Data

```bash
cd /home/exo/botkorp-mono/backend
python tests/test_bot_sensor_data.py
```

This will:
1. Create a test bot (or use existing one)
2. Insert 24 hours of sensor data
3. Create location history
4. Generate events and statistics
5. Print the bot ID to use

### Step 3: View the Dashboard

1. Start your frontend: `npm run dev`
2. Login as admin
3. Navigate to: `/admin/bot/YOUR-BOT-ID` (use ID from test script)
4. See all sensor data, events, and stats!

### Step 4: Build Backend API Endpoints

See `/backend/BOT_DATA_TRACKING_GUIDE.md` for:
- Example FastAPI endpoints
- How ESP8266 sends data
- Alert generation logic

Example endpoint structure:
```python
POST /api/bots/{bot_id}/sensor-reading
POST /api/bots/{bot_id}/events  
POST /api/bots/{bot_id}/location
GET /api/bots/{bot_id}/dashboard
```

### Step 5: Integrate ESP8266 (Later)

When your hardware is ready, the ESP8266 will POST sensor data:

```cpp
// ESP8266 Arduino code (example)
#include <ESP8266HTTPClient.h>
#include <ArduinoJson.h>

void sendSensorData() {
  HTTPClient http;
  http.begin("https://your-api.com/api/bots/bot-id/sensor-reading");
  http.addHeader("Content-Type", "application/json");
  
  StaticJsonDocument<512> doc;
  doc["battery_percentage"] = battery;
  doc["temperature_celsius"] = temperature;
  doc["rpm"] = motorRPM;
  doc["pitch"] = imu.pitch;
  doc["roll"] = imu.roll;
  doc["yaw"] = imu.yaw;
  // ... more sensors
  
  String json;
  serializeJson(doc, json);
  http.POST(json);
  http.end();
}
```

---

## 🎨 Frontend Components to Build Next

1. **Interactive Map Component**
   - Show bot's current location
   - Display GPS trail/path
   - Heatmap of mowed areas
   - Use Leaflet or Google Maps

2. **Sensor Graphs (Charts)**
   - Battery level over time (line chart)
   - Temperature & humidity (dual-axis)
   - RPM and speed graphs
   - Use recharts or chart.js

3. **3D Bot Orientation Visualizer**
   - Visual 3D model showing pitch, roll, yaw
   - Use Three.js

4. **Real-time Alerts Banner**
   - Show critical alerts at top
   - Auto-dismiss after reading

5. **Historical Data Comparison**
   - Compare today vs yesterday
   - Weekly/monthly trends

---

## 📊 Understanding the Data Structure

### Bot-Specific Data (JSONB Field)

Different bot types store custom sensor data in `bot_specific_data`:

**Mow Bot:**
```json
{
  "blade_rpm": 3400,
  "emf_sensor_1": 512,
  "emf_sensor_2": 480,
  "emf_sensor_3": 495,
  "boundary_wire_detected": true,
  "trimmer_motor_on": false,
  "grass_height_detected": 8.5
}
```

**Pool Bot:**
```json
{
  "water_temperature": 24.5,
  "water_ph": 7.2,
  "chlorine_level": 3.0,
  "pump_rpm": 1200,
  "filter_pressure": 15.5
}
```

**Weather Station:**
```json
{
  "wind_speed": 12.5,
  "wind_direction": 270,
  "barometric_pressure": 1013.25,
  "uv_index": 7,
  "soil_moisture": 45
}
```

### 3D Orientation Explained

- **Pitch**: Rotation around X-axis (forward/backward tilt) -180° to 180°
- **Roll**: Rotation around Y-axis (left/right tilt) -180° to 180°
- **Yaw**: Rotation around Z-axis (compass direction) 0° to 360°

Example: Bot facing north-east, tilted forward
```json
{
  "pitch": -5.3,   // Tilted 5.3° forward (going uphill)
  "roll": 2.1,     // Tilted 2.1° to the right
  "yaw": 45.0      // Facing north-east (45° from north)
}
```

---

## 🔍 Useful SQL Queries

### Get Latest Reading for All Bots
```sql
SELECT DISTINCT ON (b.id)
  b.id,
  b.name,
  b.bot_type,
  b.status,
  sr.battery_percentage,
  sr.temperature_celsius,
  sr.is_on,
  sr.recorded_at
FROM bots b
LEFT JOIN bot_sensor_readings sr ON sr.bot_id = b.id
ORDER BY b.id, sr.recorded_at DESC;
```

### Find Low Battery Bots
```sql
SELECT b.name, sr.battery_percentage, sr.recorded_at
FROM bots b
JOIN LATERAL (
  SELECT battery_percentage, recorded_at
  FROM bot_sensor_readings
  WHERE bot_id = b.id
  ORDER BY recorded_at DESC
  LIMIT 1
) sr ON true
WHERE sr.battery_percentage < 20;
```

### Get Bot Activity for Last Week
```sql
SELECT 
  date,
  total_runtime_minutes,
  total_distance_meters,
  error_count
FROM bot_daily_statistics
WHERE bot_id = 'your-bot-id'
  AND date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY date DESC;
```

### Most Common Events
```sql
SELECT 
  event_type,
  COUNT(*) as count,
  MAX(event_timestamp) as last_occurrence
FROM bot_events
WHERE bot_id = 'your-bot-id'
  AND event_timestamp > NOW() - INTERVAL '30 days'
GROUP BY event_type
ORDER BY count DESC;
```

---

## 🧪 Testing Without Hardware

### Manual SQL Insert (Quick Test)

```sql
-- Insert a sensor reading manually
INSERT INTO bot_sensor_readings (
  bot_id, 
  battery_percentage, 
  temperature_celsius, 
  rpm, 
  is_on
) VALUES (
  'your-bot-id',
  75,
  28.5,
  3200,
  true
);
```

### Use curl to Test API (Once Backend is Built)

```bash
curl -X POST http://localhost:8000/api/bots/bot-id/sensor-reading \
  -H "Content-Type: application/json" \
  -d '{
    "battery_percentage": 75,
    "temperature_celsius": 28.5,
    "rpm": 3200,
    "is_on": true
  }'
```

---

## 📈 Performance Considerations

### Data Retention
Consider deleting old sensor readings to keep database lean:

```sql
-- Delete sensor readings older than 90 days
DELETE FROM bot_sensor_readings
WHERE recorded_at < NOW() - INTERVAL '90 days';
```

### Indexes
All important indexes are already created in the migration:
- `bot_id` + `recorded_at` for fast time-range queries
- `battery_percentage` for low battery alerts
- `is_raining` for rain detection

### Real-time Updates
The frontend uses Supabase Realtime subscriptions to update automatically when new sensor data arrives - no polling needed!

---

## 🎯 Next Steps

1. ✅ **Migration created** - Ready to apply
2. ✅ **Test data script** - Ready to run
3. ✅ **Frontend component** - Ready to view
4. ⬜ **Run migration** - Apply to your database
5. ⬜ **Generate test data** - Populate with mock data
6. ⬜ **Build backend API** - Create endpoints (see guide)
7. ⬜ **Test with frontend** - View dashboard
8. ⬜ **Add map component** - Show location trail
9. ⬜ **Add graphs** - Visualize sensor data over time
10. ⬜ **Integrate ESP8266** - Connect real hardware

---

## 📚 File Reference

| Purpose | File | Status |
|---------|------|--------|
| Database schema | `/supabase/migrations/20251021100001_bot_data_tracking_system.sql` | ✅ Created |
| Documentation | `/backend/BOT_DATA_TRACKING_GUIDE.md` | ✅ Created |
| Test data script | `/backend/tests/test_bot_sensor_data.py` | ✅ Created |
| Frontend dashboard | `/src/pages/admin/bot-dashboard-page.jsx` | ✅ Created |
| Route config | `/src/routes.jsx` | ✅ Updated |
| Backend API | `/backend/main.py` | ⬜ To be added |

---

## 💡 Tips for Beginners

1. **Start with test data**: Run the Python script to generate mock data before building anything else. This lets you see real data in the frontend immediately.

2. **Use the guide**: The `BOT_DATA_TRACKING_GUIDE.md` has copy-paste examples for everything.

3. **Understand JSONB**: The `bot_specific_data` field is JSON - you can store ANY custom data there without changing the database schema.

4. **Events vs Readings**: 
   - **Sensor readings** = continuous data (every 5 seconds)
   - **Events** = important moments (bot started, error occurred)

5. **Location history**: Only save GPS when bot moves significantly (> 1 meter) to avoid storing millions of identical points.

6. **Real-time updates**: The Supabase subscription in the frontend means users see new data instantly without refreshing!

---

## 🐛 Troubleshooting

### "No bot found"
Run the test data script - it creates a bot for you.

### "Table doesn't exist"
Run the migration: `supabase db reset` or apply SQL file directly.

### "config module not found" (Python)
Create `backend/config.py` with Supabase credentials:
```python
SUPABASE_URL = "https://your-project.supabase.co"
SUPABASE_SERVICE_KEY = "your-service-key"
```

### Frontend shows no data
1. Check bot ID in URL matches database
2. Check browser console for errors
3. Verify Supabase connection in `/src/lib/supabaseClient.js`

---

## 🎉 You're All Set!

You now have a complete, professional bot data tracking system that can:
- Store any sensor data
- Track GPS history
- Log events
- Generate statistics
- Display real-time dashboards
- Work with any bot type (mow, pool, weather, etc.)

The best part? It's all ready to go **before** your hardware is complete! 🚀


