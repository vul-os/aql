# Quick Start - Bot Status with Map & Graphs

## What Changed

✅ **Removed Bots from sidebar** - Access bots through services only  
✅ **Bot Status is now the default tab** when viewing a service  
✅ **Interactive map** showing live bot location and movement trail  
✅ **Real-time graphs** for battery and temperature  
✅ **Cleaner interface** - removed cluttered "Current Status" section  
✅ **Auto-refresh** every 30 seconds

## How to Test

### 1. Start the Backend

```bash
cd backend
python main.py
```

The backend should be running on `http://localhost:8080`

### 2. Start the Bot Simulator

```bash
cd backend/simulator
./quick-start-test-bot.sh
```

This will send real-time data to **Test Mow Bot #1** every 5 seconds.

### 3. View Bot Status

1. Open your app: `http://localhost:5173`
2. Navigate to **Services**
3. Click on your service
4. You'll see the **Bot Status** tab (default view)
5. Watch the data update in real-time! 🎉

## What You Should See

### Top Section
- **4 stat cards**: Battery, Temperature, Activity, Weather
- All updating with real sensor data

### Map & Performance
- **Interactive map** (left) - Shows bot location with green marker and blue movement trail
- **Today's Performance** (right) - Runtime, distance, area covered stats

### Charts
- **Battery Chart** - 24-hour battery level trend
- **Temperature Chart** - Temperature & humidity over time

### Events  
- Recent bot activities and alerts

## Troubleshooting

### Map not showing?
1. Check browser console for errors
2. Verify internet connection (needed for map tiles)
3. Wait a few seconds for Leaflet to load
4. Check that bot has GPS coordinates in latest_sensor_reading

### No location trail?
The trail requires multiple GPS points. The simulator sends a new point every 5 seconds, so wait 30-60 seconds to see the trail build up.

### Graphs empty?
- Graphs need at least 1-2 minutes of data
- Keep the simulator running  
- Refresh the page

### "No bot assigned yet"?
Run this in Supabase SQL editor:

```sql
-- Get your location ID first
SELECT id, name FROM locations LIMIT 5;

-- Create/update the test bot (replace location-id-here)
INSERT INTO bots (
  id, 
  location_id, 
  name, 
  bot_type, 
  status,
  battery_level,
  is_enabled
)
VALUES (
  '550e8400-e29b-41d4-a716-446655440000',
  'location-id-here', -- Replace with actual location ID
  'Test Mow Bot #1',
  'mow_bot',
  'online',
  95,
  true
)
ON CONFLICT (id) DO UPDATE
SET location_id = EXCLUDED.location_id;
```

## Debug Console Messages

When you navigate to the Bot Status tab, check the browser console. You should see:

```
✅ Bot data loaded: {bot_id: "...", bot_name: "Test Mow Bot #1", ...}
📍 Location trail points: 15
📊 Today stats: {total_runtime_minutes: 45, ...}
```

If location trail points = 0, the simulator hasn't sent enough data yet. Wait a minute!

## Features

### Interactive Map
- **Green marker** = Current position
- **Blue line** = Movement trail
- **Arrow** = Direction bot is facing
- Click marker for bot info popup
- Zoom and pan like Google Maps

### Charts
- **Hover** over charts to see exact values
- **Responsive** - works on mobile/tablet/desktop
- **Auto-updating** - Refreshes every 30 seconds

### Performance Stats
- Real-time calculation
- Distance in meters
- Area covered in square meters
- Runtime tracking

## Tips

1. **Let simulator run** for 2-3 minutes to build up trail data
2. **Refresh page** if data seems stale
3. **Check browser console** for debug info
4. **Backend logs** show when data is received

## Files Changed

- `src/components/layout/portal-layout.jsx` - Removed Bots from sidebar
- `src/routes.jsx` - Removed Bots route  
- `src/pages/services/service-detail-page.jsx` - Added Bot Status tab, made it default
- `backend/simulator/quick-start-test-bot.sh` - Quick start script

## Next Steps

- Add more bots to test multiple bot tracking
- Customize the map markers
- Add real-time alerts/notifications
- Create daily/weekly statistics views

Enjoy your professional bot monitoring system! 🚀

