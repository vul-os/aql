# 🏗️ Bot Tracking System Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      BOT TRACKING SYSTEM                        │
└─────────────────────────────────────────────────────────────────┘

   ESP8266 → Backend API → Supabase DB → Frontend Dashboard
   (Bot)     (Python)      (PostgreSQL)   (React)
```

---

## Complete Data Flow

```
┌──────────────────┐
│   ESP8266 Bot    │  Sensors: IMU, GPS, Temp, Humidity, Rain
│  (Mow Bot)       │  
└────────┬─────────┘
         │ WiFi/HTTP POST every 5-10 seconds
         │ {battery: 85, temp: 28.5, rpm: 3200, ...}
         ↓
┌────────────────────┐
│  Backend API       │
│  (FastAPI/Python)  │  POST /api/bots/{id}/sensor-reading
│                    │  - Validates data
│  Endpoints:        │  - Checks for alerts (low battery, rain)
│  • sensor-reading  │  - Creates events if needed
│  • events          │  - Updates bot status
│  • location        │
│  • dashboard       │
└────────┬───────────┘
         │ Insert data
         ↓
┌────────────────────────────────────────────────┐
│            Supabase Database                   │
│            (PostgreSQL)                        │
│                                                │
│  ┌──────────────────────────────────────────┐ │
│  │ bot_sensor_readings                      │ │
│  │ • All sensor data                        │ │
│  │ • Battery, RPM, orientation, etc.       │ │
│  │ • Timestamped records                   │ │
│  └──────────────────────────────────────────┘ │
│                                                │
│  ┌──────────────────────────────────────────┐ │
│  │ bot_location_history                     │ │
│  │ • GPS coordinates over time             │ │
│  │ • Creates trail/path on map             │ │
│  └──────────────────────────────────────────┘ │
│                                                │
│  ┌──────────────────────────────────────────┐ │
│  │ bot_events                               │ │
│  │ • Important moments logged              │ │
│  │ • Started, stopped, errors, warnings    │ │
│  └──────────────────────────────────────────┘ │
│                                                │
│  ┌──────────────────────────────────────────┐ │
│  │ bot_daily_statistics                     │ │
│  │ • Aggregated daily summaries            │ │
│  │ • Runtime, distance, battery, errors    │ │
│  └──────────────────────────────────────────┘ │
│                                                │
│  ┌──────────────────────────────────────────┐ │
│  │ Existing Tables:                         │ │
│  │ • bots, bot_telemetry, bot_commands     │ │
│  │ • bot_alerts, locations, organizations  │ │
│  └──────────────────────────────────────────┘ │
└────────┬───────────────────────────────────────┘
         │ Realtime subscriptions
         │ (automatic updates)
         ↓
┌────────────────────┐
│  Frontend          │  GET /api/bots/{id}/dashboard
│  (React)           │  
│                    │  Real-time subscriptions via Supabase
│  Components:       │  
│  • Bot Dashboard   │  Shows:
│  • Sensor Cards    │  • Current battery, temp, RPM
│  • Event Log       │  • 3D orientation visualization
│  • Location Map    │  • GPS trail on map
│  • Statistics      │  • Event timeline
│  • Graphs/Charts   │  • Daily statistics
└────────┬───────────┘
         │
         ↓
┌────────────────────┐
│   User Browser     │  URL: /admin/bot/{bot-id}
│   (Chrome/Safari)  │  Auto-updates every few seconds
└────────────────────┘
```

---

## Database Schema Relationships

```
organizations
    ↓ (has many)
locations
    ↓ (has many)
bots ←──────────────────────┐
    ↓ (has many)            │
    ├─→ bot_sensor_readings │ (references bot_id)
    ├─→ bot_location_history│ (references bot_id)
    ├─→ bot_events          │ (references bot_id)
    ├─→ bot_daily_statistics│ (references bot_id)
    ├─→ bot_commands        │ (existing)
    ├─→ bot_telemetry       │ (existing)
    └─→ bot_alerts          │ (existing)
```

---

## Sensor Data Structure

### Option 1: Structured Table (bot_sensor_readings)
```
┌─────────────────────────────────────────────────────────────┐
│ bot_sensor_readings                                         │
├─────────────────────────────────────────────────────────────┤
│ id: uuid                                                    │
│ bot_id: uuid → references bots(id)                         │
│ recorded_at: timestamp                                      │
│                                                             │
│ ┌─────────────── POWER ───────────────┐                   │
│ │ is_on: bool                          │                   │
│ │ battery_percentage: int (0-100)      │                   │
│ │ battery_voltage: decimal             │                   │
│ │ is_charging: bool                    │                   │
│ └──────────────────────────────────────┘                   │
│                                                             │
│ ┌─────────────── MOVEMENT ────────────┐                   │
│ │ direction_degrees: decimal (0-360)   │                   │
│ │ rpm: int                             │                   │
│ │ distance_traveled_cm: decimal        │                   │
│ │ speed_cm_per_sec: decimal            │                   │
│ └──────────────────────────────────────┘                   │
│                                                             │
│ ┌─────────── 3D ORIENTATION ──────────┐                   │
│ │ pitch: decimal (-180 to 180)         │                   │
│ │ roll: decimal (-180 to 180)          │                   │
│ │ yaw: decimal (0 to 360)              │                   │
│ └──────────────────────────────────────┘                   │
│                                                             │
│ ┌───────── 3D ACCELERATION ───────────┐                   │
│ │ acceleration_x: decimal (m/s²)       │                   │
│ │ acceleration_y: decimal (m/s²)       │                   │
│ │ acceleration_z: decimal (m/s²)       │                   │
│ └──────────────────────────────────────┘                   │
│                                                             │
│ ┌────────── 3D ROTATION ──────────────┐                   │
│ │ rotation_x: decimal (deg/sec)        │                   │
│ │ rotation_y: decimal (deg/sec)        │                   │
│ │ rotation_z: decimal (deg/sec)        │                   │
│ └──────────────────────────────────────┘                   │
│                                                             │
│ ┌────────── ENVIRONMENT ──────────────┐                   │
│ │ temperature_celsius: decimal         │                   │
│ │ humidity_percentage: decimal (0-100) │                   │
│ │ is_raining: bool                     │                   │
│ │ rain_intensity: int (0-1023)         │                   │
│ └──────────────────────────────────────┘                   │
│                                                             │
│ ┌─────────────── GPS ─────────────────┐                   │
│ │ latitude: decimal(10,8)              │                   │
│ │ longitude: decimal(11,8)             │                   │
│ │ gps_accuracy_meters: decimal         │                   │
│ └──────────────────────────────────────┘                   │
│                                                             │
│ ┌────────── BOT-SPECIFIC ─────────────┐                   │
│ │ bot_specific_data: JSONB             │                   │
│ │ {                                    │                   │
│ │   "blade_rpm": 3400,                 │                   │
│ │   "emf_sensor_1": 512,               │                   │
│ │   "boundary_wire_detected": true     │                   │
│ │ }                                    │                   │
│ └──────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

### Option 2: Flexible JSONB (bot_telemetry - existing)
```
┌─────────────────────────────────────────┐
│ bot_telemetry                           │
├─────────────────────────────────────────┤
│ id: uuid                                │
│ bot_id: uuid                            │
│ timestamp: timestamp                    │
│ telemetry_type: text                    │
│   • sensors_snapshot                    │
│   • movement                            │
│   • environmental                       │
│   • ...                                 │
│ data: JSONB (flexible)                  │
│   {                                     │
│     "battery": 85,                      │
│     "temp": 28.5,                       │
│     "anything": "you want"              │
│   }                                     │
└─────────────────────────────────────────┘
```

**Use both!**
- `bot_sensor_readings` for structured queries (graphs, statistics)
- `bot_telemetry` for flexible/custom data

---

## Event Types & Severity

```
┌──────────────────────────────────────────────────────┐
│                    BOT EVENTS                        │
├──────────────────────────────────────────────────────┤
│                                                      │
│  INFO (Blue)                                         │
│  • Bot started                                       │
│  • Bot stopped                                       │
│  • Route completed                                   │
│  • Charging started                                  │
│                                                      │
│  WARNING (Yellow)                                    │
│  • Low battery (< 20%)                              │
│  • Rain detected                                     │
│  • Obstacle detected                                 │
│  • High temperature                                  │
│                                                      │
│  ERROR (Red)                                         │
│  • Motor stall                                       │
│  • Sensor failure                                    │
│  • Connection lost                                   │
│                                                      │
│  CRITICAL (Dark Red)                                 │
│  • Bot tipped over                                   │
│  • Emergency stop                                    │
│  • Critical battery (< 5%)                          │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## Frontend Component Architecture

```
BotDashboardPage
├── Header
│   ├── Bot Name & Serial
│   └── Status Badge (online/offline/charging)
│
├── Quick Stats Grid (4 cards)
│   ├── Battery Card
│   ├── Temperature Card
│   ├── RPM Card
│   └── Location Card
│
├── Main Content Grid
│   ├── Sensor Details Card
│   │   ├── 3D Orientation (pitch, roll, yaw)
│   │   ├── 3D Acceleration (x, y, z)
│   │   ├── Movement (speed, distance)
│   │   └── Environment (rain, humidity)
│   │
│   └── Today's Statistics Card
│       ├── Runtime
│       ├── Distance
│       ├── Battery Average
│       └── Event Counts
│
├── Recent Events Card
│   └── Event Timeline (last 20)
│       ├── Icon (✓ or ⚠)
│       ├── Title & Description
│       ├── Severity Badge
│       └── Timestamp
│
└── Location Map Card
    └── Interactive Map (to be implemented)
        ├── Current Position Marker
        ├── GPS Trail/Path
        └── Heatmap of Coverage
```

---

## Data Update Frequency

```
Sensor Readings:     Every 5-10 seconds
Location Updates:    When bot moves > 1 meter
Events:              When they occur (rare)
Daily Statistics:    End of day (aggregated)
Frontend Updates:    Real-time (Supabase subscriptions)
```

---

## Bot-Specific Data Examples

### Mow Bot
```json
{
  "blade_rpm": 3400,              // Blade motor speed
  "emf_sensor_1": 512,            // EMF sensor readings
  "emf_sensor_2": 480,
  "emf_sensor_3": 495,
  "boundary_wire_detected": true, // Perimeter wire
  "trimmer_motor_on": false,      // Edge trimmer
  "grass_height_detected": 8.5    // Ultrasonic sensor
}
```

### Pool Bot
```json
{
  "water_temperature": 24.5,      // Water temp (°C)
  "water_ph": 7.2,                // pH level
  "chlorine_level": 3.0,          // Chlorine (ppm)
  "pump_rpm": 1200,               // Water pump
  "filter_pressure": 15.5,        // Filter pressure (PSI)
  "cleaning_mode": "floor_only"   // Current mode
}
```

### Weather Station
```json
{
  "wind_speed": 12.5,             // Wind speed (km/h)
  "wind_direction": 270,          // Direction (degrees)
  "barometric_pressure": 1013.25, // Pressure (hPa)
  "uv_index": 7,                  // UV index
  "rainfall_mm": 2.5,             // Rain (mm)
  "soil_moisture": 45             // Soil moisture (%)
}
```

---

## Performance & Scale

```
Data Volume Estimate:
  • 1 bot sending data every 10 seconds
  • = 8,640 sensor readings per day
  • = ~260,000 readings per month
  • = ~3.1 million readings per year

Storage per reading: ~1 KB
Annual storage: ~3 GB per bot

With indexes: Fast queries for:
  • Last 24 hours: < 50ms
  • Daily statistics: < 10ms
  • Event log: < 20ms
```

**Optimization tips:**
1. Delete readings > 90 days old
2. Keep daily_statistics forever (small)
3. Archive location_history > 6 months
4. Use indexes (already created)

---

## Security & Access

```
┌────────────────────────────────────┐
│         ESP8266 (Bot)              │
│  Auth: API Key or Bot Token        │
│  POST /api/bots/{id}/sensor-data   │
└────────────────────────────────────┘
              ↓
┌────────────────────────────────────┐
│         Backend API                │
│  • Validates bot ID                │
│  • Checks auth token               │
│  • Rate limiting                   │
└────────────────────────────────────┘
              ↓
┌────────────────────────────────────┐
│      Supabase Database             │
│  RLS (Row Level Security)          │
│  • Users see only their org's bots │
│  • Admins see all                  │
└────────────────────────────────────┘
              ↓
┌────────────────────────────────────┐
│         Frontend                   │
│  Auth: Supabase Session            │
│  Admin route: /admin/bot/{id}      │
└────────────────────────────────────┘
```

---

## System Benefits

✅ **Real-time** - Updates automatically via WebSocket subscriptions
✅ **Flexible** - JSONB allows any custom sensor without schema changes
✅ **Scalable** - Works for 1 bot or 1000 bots
✅ **Generic** - Same system for mow bots, pool bots, weather stations
✅ **Complete** - Sensors + Events + Location + Statistics
✅ **Production-ready** - Proper indexes, constraints, foreign keys
✅ **Historical** - All data stored for analysis and graphs

---

## Next: Building Backend API

See `/backend/BOT_DATA_TRACKING_GUIDE.md` for:
- Complete API endpoint examples
- Request/response formats
- Alert generation logic
- Error handling
- ESP8266 integration code

---

This architecture supports your complete bot tracking requirements! 🎉


