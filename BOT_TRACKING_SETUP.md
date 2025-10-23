# Bot Data Tracking System - Setup Guide

Complete implementation of real-time bot data tracking from backend to frontend.

## ✅ What's Been Implemented

### 1. **Backend API Endpoints** (backend/main.py)
- ✅ POST `/api/bots/{bot_id}/sensor-reading` - Receive sensor data
- ✅ GET `/api/bots/{bot_id}/sensor-readings` - Get sensor history
- ✅ GET `/api/bots/{bot_id}/latest-reading` - Get latest reading
- ✅ POST `/api/bots/{bot_id}/location` - Log GPS point
- ✅ GET `/api/bots/{bot_id}/location-history` - Get location trail
- ✅ POST `/api/bots/{bot_id}/events` - Log events
- ✅ GET `/api/bots/{bot_id}/events` - Get events
- ✅ GET `/api/bots/{bot_id}/dashboard` - Get all dashboard data
- ✅ GET `/api/bots/{bot_id}/statistics/daily` - Get daily stats
- ✅ Auto-alert creation for low battery, rain, high temp

### 2. **Real-time Simulator** (backend/simulator/bot_simulator.py)
- ✅ Sends sensor data every 5-10 seconds
- ✅ Simulates realistic bot behavior
- ✅ Battery drain/charging cycles
- ✅ Movement patterns (circular mowing)
- ✅ GPS coordinates with movement
- ✅ 3D orientation & acceleration
- ✅ Temperature/humidity variations
- ✅ Random rain events
- ✅ Bot-specific data (blade RPM, EMF sensors)

### 3. **Frontend Components** (src/components/bots/)
- ✅ BotMap - Interactive map with location trail (Leaflet)
- ✅ BotBatteryChart - Battery level over time (Recharts)
- ✅ BotTemperatureChart - Temp & humidity chart (Recharts)

### 4. **Bot Dashboard Page** (src/pages/admin/bot-dashboard-page.jsx)
- ✅ Real-time sensor data display
- ✅ Quick stats cards (battery, temp, RPM, location)
- ✅ 3D orientation display
- ✅ Movement metrics
- ✅ Environmental conditions
- ✅ Today's statistics
- ✅ Recent events timeline
- ✅ Charts tab (battery, temperature)
- ✅ Map tab (location trail)
- ✅ Real-time Supabase subscriptions
- ✅ Auto-refresh every 30 seconds

## 📦 Required Dependencies

### Install Missing Dependencies

```bash
npm install leaflet
```

That's it! `recharts` is already installed.

## 🚀 Getting Started

### Step 1: Make sure migrations are applied

The bot data tracking tables should already exist in your Supabase database:
- `bot_sensor_readings`
- `bot_location_history`
- `bot_events`
- `bot_daily_statistics`

If not, run the migration:
```sql
-- Migration file: supabase/migrations/20251021100001_bot_data_tracking_system.sql
```

### Step 2: Create a test bot

If you don't have a bot in your database, create one:

```sql
INSERT INTO bots (id, location_id, name, bot_type, serial_number, status, battery_level)
VALUES (
  '550e8400-e29b-41d4-a716-446655440000',
  'your-location-id-here',
  'Test Mow Bot #1',
  'mow_bot',
  'MOWBOT-001',
  'online',
  95
);
```

Replace `your-location-id-here` with an actual location ID from your `locations` table.

### Step 3: Start the backend

```bash
cd backend
python main.py
```

The backend should start on http://localhost:8080

### Step 4: Start the bot simulator

In a new terminal:

```bash
cd backend/simulator
python bot_simulator.py
```

You should see:
```
============================================================
  🤖 BotKorp Real-time Bot Simulator
============================================================

✅ Backend is accessible: http://localhost:8080

🤖 Bot Simulator initialized
   Bot ID: 550e8400-e29b-41d4-a716-446655440000
   Backend: http://localhost:8080
   Update Interval: 5s

🚀 Starting bot simulation...
   Press Ctrl+C to stop

📊 10 readings sent | 🟢 ON | Battery: 92% | Temp: 24.5°C
```

### Step 5: Start the frontend

In a new terminal:

```bash
npm install   # Install the leaflet dependency
npm run dev
```

### Step 6: View the dashboard

1. Open http://localhost:5173
2. Sign in as admin
3. Navigate to: `/admin/bot/550e8400-e29b-41d4-a716-446655440000`
4. You should see:
   - Real-time sensor data updating
   - Battery, temperature, RPM cards
   - Charts showing battery and temperature over time
   - Map with bot location and movement trail
   - Recent events

## 🎯 Testing the System

### Test Real-time Updates

1. Open the bot dashboard
2. Keep the simulator running
3. Watch the dashboard update automatically:
   - Battery percentage changes
   - Temperature varies
   - Map marker moves
   - Events appear

### Test Alerts

The system automatically creates alerts for:

1. **Low Battery (< 20%)**
   - Wait for simulator to drain battery
   - Alert will appear in events
   - Bot will stop and start charging

2. **Rain Detection (Random 2%)**
   - System randomly triggers rain
   - Event: "Rain Detected"
   - Will clear after some time

3. **High Temperature (> 45°C)**
   - Unlikely with default simulator
   - Can modify simulator to test

### Test Different Time Ranges

Modify the charts to show different time periods by running the simulator longer:

- 1 hour of data: Run for 1 hour
- 24 hours: Run for 24 hours (or use batch insert script)
- 7 days: Generate historical data

## 📊 Database Queries for Testing

### Check sensor readings

```sql
SELECT 
  recorded_at,
  battery_percentage,
  temperature_celsius,
  is_on,
  latitude,
  longitude
FROM bot_sensor_readings
WHERE bot_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY recorded_at DESC
LIMIT 10;
```

### Check events

```sql
SELECT 
  event_timestamp,
  event_type,
  severity,
  title,
  description
FROM bot_events
WHERE bot_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY event_timestamp DESC
LIMIT 10;
```

### Check location history

```sql
SELECT 
  recorded_at,
  latitude,
  longitude,
  heading,
  is_moving
FROM bot_location_history
WHERE bot_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY recorded_at DESC
LIMIT 10;
```

## 🔧 Customization

### Change Simulator Settings

```bash
# Different bot
export BOT_ID=your-bot-id

# Faster updates (every 2 seconds)
export UPDATE_INTERVAL=2

# Different backend URL
export BACKEND_URL=https://your-backend.com

python bot_simulator.py
```

### Change Chart Time Ranges

Modify the components to accept a `timeRange` prop:

```jsx
<BotBatteryChart botId={botId} timeRange="7d" />
<BotTemperatureChart botId={botId} timeRange="7d" />
```

Options: `'24h'`, `'7d'`, `'30d'`

### Add More Sensor Types

1. Update database: Add columns to `bot_sensor_readings`
2. Update simulator: Add sensor data to reading object
3. Update backend: Include in API response
4. Update frontend: Display new sensor data

## 🐛 Troubleshooting

### Backend errors

**Error: Cannot connect to Supabase**
- Check `backend/config.py` for correct credentials
- Verify `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`

**Error: Table does not exist**
- Run the migration: `20251021100001_bot_data_tracking_system.sql`

### Simulator errors

**Error: Cannot reach backend**
- Make sure backend is running on port 8080
- Check firewall settings

**Error: Bot not found**
- Create bot in database using SQL above
- Check BOT_ID environment variable

### Frontend errors

**Error: Module not found: leaflet**
- Run `npm install leaflet`

**Map not showing**
- Check browser console for errors
- Leaflet CSS should load from CDN
- Check internet connection

**Charts not showing data**
- Make sure simulator has been running for at least 5 minutes
- Check browser console for API errors
- Verify sensor readings exist in database

**Real-time updates not working**
- Check Supabase Realtime is enabled
- Check browser console for subscription errors
- Verify bot_id matches in URL

## 📱 Mobile Responsiveness

The dashboard is responsive:
- Cards stack vertically on mobile
- Charts adjust to screen size
- Map is scrollable
- Events are compact

## 🔒 Security & RLS

Make sure Row Level Security (RLS) is configured for:
- `bot_sensor_readings`
- `bot_location_history`
- `bot_events`
- `bot_daily_statistics`

Users should only see data for bots at their locations/organization.

## 🚀 Next Steps

### Production Deployment

1. **Backend**: Deploy to Google Cloud Run or similar
2. **Simulator**: Not needed in production (real bots will send data)
3. **Frontend**: Build and deploy
4. **ESP8266**: Configure with production backend URL

### Additional Features to Build

- [ ] Historical playback (replay bot movement)
- [ ] Heatmap of mowed areas
- [ ] Service zones and boundaries
- [ ] Battery life predictions
- [ ] Maintenance scheduling based on runtime
- [ ] Multi-bot comparison view
- [ ] Export data to CSV/PDF
- [ ] Push notifications for critical alerts
- [ ] Bot firmware update tracking
- [ ] Weather integration

## 📚 Documentation

- Backend API: See inline comments in `backend/main.py`
- Simulator: See `backend/simulator/README.md`
- Database: See `backend/BOT_DATA_TRACKING_GUIDE.md`

## 🎉 Success Criteria

You'll know it's working when:

1. ✅ Simulator runs without errors
2. ✅ Backend receives sensor readings
3. ✅ Database has new records every 5 seconds
4. ✅ Dashboard loads and shows data
5. ✅ Dashboard updates in real-time
6. ✅ Charts show data trends
7. ✅ Map shows bot movement trail
8. ✅ Events appear in timeline

---

**Made with 🤖 by BotKorp**

