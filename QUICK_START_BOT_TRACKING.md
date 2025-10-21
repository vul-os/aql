# 🚀 Quick Start - Bot Data Tracking

## What This Does

Tracks everything about your robot: battery, sensors, location, events, statistics.

---

## ⚡ 3-Step Quick Start

### Step 1: Apply Database Migration
```bash
cd /home/exo/botkorp-mono
supabase db reset
```
This creates 4 new tables for tracking bot data.

### Step 2: Generate Test Data
```bash
cd backend
python tests/test_bot_sensor_data.py
```
**Output:**
```
✅ SUCCESS! Test data generated
🤖 Test Bot ID: 550e8400-e29b-41d4-a716-446655440000
```
Copy this bot ID!

### Step 3: View Dashboard
```bash
npm run dev
```
Go to: `http://localhost:5173/admin/bot/YOUR-BOT-ID-HERE`

**Done!** You'll see a full dashboard with sensor data, maps, events, and statistics.

---

## 📊 What You'll See

### Dashboard Shows:
- ⚡ **Battery level** (real-time)
- 🌡️ **Temperature & humidity**
- ⚙️ **Motor RPM** 
- 📍 **GPS location**
- 🧭 **3D orientation** (pitch, roll, yaw)
- 📈 **Today's statistics**
- 📋 **Recent events** (started, stopped, warnings)
- 🗺️ **Map placeholder** (ready for integration)

---

## 🎯 Understanding Your Data

### Sensor Reading = What bot feels right now
```json
{
  "battery": 85,
  "temperature": 28.5,
  "rpm": 3200,
  "pitch": -2.3,
  "roll": 1.5,
  "is_raining": false
}
```

### Event = Something important happened
```
"Bot Started" → "Obstacle Detected" → "Low Battery Warning" → "Bot Stopped"
```

### Location History = Where bot has been
```
GPS Trail: (lat, lng) → (lat, lng) → (lat, lng) ...
Shows path on map
```

### Daily Stats = Summary of the day
```
Runtime: 3h 45m
Distance: 850 meters
Battery: 65% average
Errors: 0
```

---

## 📝 Full Documentation

- **Complete guide:** `/backend/BOT_DATA_TRACKING_GUIDE.md`
- **Summary:** `/BOT_DATA_TRACKING_SUMMARY.md`

---

## 🤖 Bot-Specific Sensors

Each bot type can have custom sensors in `bot_specific_data`:

**Mow Bot:**
```json
{
  "blade_rpm": 3400,
  "emf_sensor_1": 512,
  "boundary_wire_detected": true
}
```

**Pool Bot:**
```json
{
  "water_ph": 7.2,
  "chlorine_level": 3.0,
  "pump_rpm": 1200
}
```

---

## 🔌 ESP8266 Integration (Later)

When hardware is ready:

```cpp
// Send sensor data via WiFi
POST https://api.botkorp.com/api/bots/{bot_id}/sensor-reading
{
  "battery_percentage": 75,
  "temperature_celsius": 28.5,
  "rpm": 3200,
  "pitch": imu.pitch,
  "roll": imu.roll,
  "yaw": imu.yaw,
  ...
}
```

---

## ✅ What's Working Now

- ✅ Database schema (4 tables created)
- ✅ Test data generator (24 hours of mock data)
- ✅ Frontend dashboard (real-time updates)
- ✅ Event logging system
- ✅ Daily statistics tracking

## 🔜 What to Build Next

- ⬜ Backend API endpoints (FastAPI)
- ⬜ Interactive map with GPS trail
- ⬜ Sensor data graphs (charts)
- ⬜ 3D orientation visualizer
- ⬜ ESP8266 integration

---

## 💡 Key Concepts

### 1. Real-time Updates
Frontend automatically updates when new sensor data arrives (via Supabase subscriptions).

### 2. JSONB Flexibility
`bot_specific_data` can store ANY custom sensor without changing database schema.

### 3. Multiple Bot Types
Same system works for mow bots, pool bots, weather stations, security bots, etc.

### 4. Historical Data
All sensor readings stored forever (or delete old data after 90 days for performance).

### 5. Event-Driven
Important moments logged as events (started, error, warning) separate from continuous sensor readings.

---

## 🎓 Beginner Tips

1. **Use test data first** - Don't wait for hardware
2. **Start simple** - Just battery and on/off status initially
3. **JSONB is your friend** - Store custom data without migrations
4. **Events ≠ Readings** - Events are rare, readings are frequent
5. **Real-time is built-in** - No need for polling/refreshing

---

## 🆘 Need Help?

1. Check `/backend/BOT_DATA_TRACKING_GUIDE.md`
2. Look at test data script for examples
3. Frontend component shows how to fetch/display data
4. Migration file has all table structures with comments

---

## 🎉 That's It!

You have a complete professional bot tracking system.

**Run the 3 steps above and see it working in minutes!** 🚀


