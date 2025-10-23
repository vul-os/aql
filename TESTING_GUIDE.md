# Bot Data Tracking System - Testing Guide

## Quick Start (5 Minutes)

### Terminal 1: Start Backend
```bash
cd backend
python main.py
```

### Terminal 2: Start Simulator
```bash
cd backend/simulator
./quick-start.sh
# OR
python bot_simulator.py
```

### Terminal 3: Start Frontend
```bash
# Install leaflet if not already installed
npm install leaflet

# Start dev server
npm run dev
```

### Browser: View Dashboard
```
http://localhost:5173/admin/bot/550e8400-e29b-41d4-a716-446655440000
```

## What You Should See

### In Terminal 1 (Backend)
```
✅ Supabase client initialized
🚀 Running on revision: local
 * Running on http://0.0.0.0:8080
📊 POST /api/bots/550e8400-e29b-41d4-a716-446655440000/sensor-reading
✅ Sensor reading created
```

### In Terminal 2 (Simulator)
```
🤖 Bot Simulator initialized
   Bot ID: 550e8400-e29b-41d4-a716-446655440000
   Backend: http://localhost:8080
   Update Interval: 5s

🚀 Starting bot simulation...

📊 10 readings sent | 🟢 ON | Battery: 92% | Temp: 24.5°C
📊 20 readings sent | 🟢 ON | Battery: 88% | Temp: 26.1°C
```

### In Browser (Dashboard)
✅ Battery percentage updating in real-time
✅ Temperature showing current value
✅ Map with bot location (green marker with arrow)
✅ Blue trail showing movement path
✅ Charts with data points
✅ Events in timeline

## Verification Checklist

- [ ] Backend starts without errors
- [ ] Simulator connects to backend
- [ ] Sensor readings being sent (check terminal)
- [ ] Dashboard loads (no errors in console)
- [ ] Battery card shows percentage
- [ ] Temperature card shows value
- [ ] Map displays with bot marker
- [ ] Trail visible on map
- [ ] Charts show data lines
- [ ] Events appear in timeline
- [ ] Real-time updates working (watch battery change)

## Common Issues

### Backend won't start
**Problem**: Missing Supabase credentials
**Solution**: Check `backend/config.py` has valid `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`

### Simulator can't connect
**Problem**: Backend not running or wrong URL
**Solution**: Make sure backend is on port 8080, or set `BACKEND_URL` env var

### Dashboard shows "Bot not found"
**Problem**: Bot doesn't exist in database
**Solution**: Create bot in Supabase:
```sql
INSERT INTO bots (id, location_id, name, bot_type, serial_number, status)
VALUES (
  '550e8400-e29b-41d4-a716-446655440000',
  (SELECT id FROM locations LIMIT 1),
  'Test Mow Bot #1',
  'mow_bot',
  'MOWBOT-001',
  'online'
);
```

### Map not showing
**Problem**: Leaflet not installed
**Solution**: `npm install leaflet`

### Charts empty
**Problem**: Not enough data yet
**Solution**: Wait 1-2 minutes for data to accumulate

### No real-time updates
**Problem**: Supabase Realtime not enabled
**Solution**: Enable Realtime in Supabase dashboard for:
- bot_sensor_readings
- bot_events

## Testing Scenarios

### Scenario 1: Battery Drain
1. Start simulator
2. Watch battery decrease over time
3. When battery hits 15%, bot stops and charges
4. Battery starts increasing
5. At 95%, bot resumes operation

### Scenario 2: Rain Detection
1. Run simulator
2. Wait for random rain event (2% chance per reading)
3. See "Rain Detected" in events timeline
4. Rain icon appears in sensor panel

### Scenario 3: Movement Trail
1. Let simulator run for 5-10 minutes
2. Open map tab
3. See blue trail showing circular pattern
4. Zoom in to see individual GPS points
5. Green arrow marker shows current position and heading

### Scenario 4: Historical Charts
1. Run simulator for at least 15-30 minutes
2. Check Charts tab
3. Battery chart shows downward trend
4. Temperature chart shows variation throughout day
5. Both charts have smooth lines with data points

## Performance Testing

### Test 1: Many Readings
Run simulator for 1 hour = 720 readings (at 5s interval)

Check:
- [ ] Database size increase is reasonable
- [ ] Dashboard still loads quickly
- [ ] Charts render smoothly
- [ ] No memory leaks in frontend

### Test 2: Multiple Bots
Run 3 simulators with different BOT_IDs:
```bash
BOT_ID=bot-1 python bot_simulator.py &
BOT_ID=bot-2 python bot_simulator.py &
BOT_ID=bot-3 python bot_simulator.py &
```

Check:
- [ ] Backend handles multiple concurrent requests
- [ ] Data doesn't mix between bots
- [ ] Can view each bot's dashboard separately

### Test 3: Network Interruption
1. Start simulator
2. Stop backend
3. Simulator shows errors (expected)
4. Start backend again
5. Simulator resumes sending data

## Database Verification

### Check Data is Being Saved

```sql
-- Count sensor readings (should increase every 5 seconds)
SELECT COUNT(*) FROM bot_sensor_readings WHERE bot_id = '550e8400-e29b-41d4-a716-446655440000';

-- View latest reading
SELECT * FROM bot_sensor_readings 
WHERE bot_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY recorded_at DESC LIMIT 1;

-- View all events
SELECT event_type, severity, title, event_timestamp 
FROM bot_events 
WHERE bot_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY event_timestamp DESC;

-- Count location points
SELECT COUNT(*) FROM bot_location_history WHERE bot_id = '550e8400-e29b-41d4-a716-446655440000';
```

## API Testing (Manual)

### Test Endpoints with curl

```bash
# Get latest sensor reading
curl http://localhost:8080/api/bots/550e8400-e29b-41d4-a716-446655440000/latest-reading

# Get sensor readings (last 24 hours)
curl http://localhost:8080/api/bots/550e8400-e29b-41d4-a716-446655440000/sensor-readings

# Get location history
curl http://localhost:8080/api/bots/550e8400-e29b-41d4-a716-446655440000/location-history

# Get events
curl http://localhost:8080/api/bots/550e8400-e29b-41d4-a716-446655440000/events

# Get dashboard data (all in one)
curl http://localhost:8080/api/bots/550e8400-e29b-41d4-a716-446655440000/dashboard

# Send manual sensor reading
curl -X POST http://localhost:8080/api/bots/550e8400-e29b-41d4-a716-446655440000/sensor-reading \
  -H "Content-Type: application/json" \
  -d '{
    "battery_percentage": 85,
    "temperature_celsius": 25.5,
    "is_on": true,
    "rpm": 3200
  }'
```

## Success Criteria

✅ **Backend**: Handles 1 request per 5 seconds without errors
✅ **Database**: Stores all readings correctly
✅ **Simulator**: Runs continuously for hours
✅ **Frontend**: Loads in under 2 seconds
✅ **Real-time**: Updates appear within 1 second
✅ **Charts**: Render smoothly with 100+ data points
✅ **Map**: Shows trail with 100+ GPS points

## Next Steps After Testing

1. ✅ Verify everything works locally
2. Create a bot in production database
3. Deploy backend to Cloud Run
4. Configure ESP8266 with production backend URL
5. Test with real bot hardware
6. Set up monitoring and alerts
7. Configure data retention policy

## Cleanup

### Stop All Services
```bash
# Press Ctrl+C in each terminal to stop:
# - Backend
# - Simulator  
# - Frontend dev server
```

### Clear Test Data (Optional)
```sql
-- Delete all test data for a bot
DELETE FROM bot_sensor_readings WHERE bot_id = '550e8400-e29b-41d4-a716-446655440000';
DELETE FROM bot_location_history WHERE bot_id = '550e8400-e29b-41d4-a716-446655440000';
DELETE FROM bot_events WHERE bot_id = '550e8400-e29b-41d4-a716-446655440000';
DELETE FROM bot_daily_statistics WHERE bot_id = '550e8400-e29b-41d4-a716-446655440000';

-- Or delete the test bot entirely
DELETE FROM bots WHERE id = '550e8400-e29b-41d4-a716-446655440000';
```

---

**Happy Testing! 🤖**

