# Bot Simulator

Real-time bot data simulator that sends sensor readings to the backend API every 5-10 seconds.

## Quick Start

### 1. Make sure backend is running:
```bash
cd backend
python main.py
```

### 2. Run the simulator:
```bash
cd backend/simulator
python bot_simulator.py
```

The simulator will start sending data immediately and will continue until you press `Ctrl+C`.

## Configuration

Set environment variables to customize behavior:

```bash
# Backend URL (default: http://localhost:8080)
export BACKEND_URL=http://localhost:8080

# Bot ID to simulate (use an existing bot ID from your database)
export BOT_ID=550e8400-e29b-41d4-a716-446655440000

# Update interval in seconds (default: 5)
export UPDATE_INTERVAL=5

# Run simulator
python bot_simulator.py
```

## Example with custom settings:

```bash
BACKEND_URL=https://your-backend.com BOT_ID=your-bot-id UPDATE_INTERVAL=10 python bot_simulator.py
```

## What it simulates:

- ✅ **Battery drain and charging cycles**
- ✅ **Movement in circular/spiral patterns (like mowing)**
- ✅ **GPS coordinates with realistic movement**
- ✅ **3D orientation (pitch, roll, yaw)**
- ✅ **3D acceleration and rotation rates**
- ✅ **Temperature variations by time of day**
- ✅ **Humidity levels**
- ✅ **Random rain events**
- ✅ **Motor RPM**
- ✅ **Bot-specific data (blade RPM, EMF sensors, etc.)**
- ✅ **Events (started, stopped, rain detected, low battery)**
- ✅ **Automatic low battery charging behavior**

## Simulated Bot Behavior:

1. **Normal Operation (Battery > 15%)**
   - Bot is ON and moving
   - Battery drains slowly (0.1-0.3% per reading)
   - Sends sensor data every 5 seconds
   - Moves in circular pattern

2. **Low Battery (< 15%)**
   - Bot automatically stops
   - Enters charging mode
   - Battery charges faster (0.5-1.0% per reading)
   - Sends low battery event

3. **Fully Charged (≥ 95%)**
   - Bot resumes operation
   - Exits charging mode
   - Continues movement

4. **Rain Detection (Random 2% chance)**
   - Rain sensor triggers
   - Sends rain detected event
   - Rain eventually stops (random)

## Output Example:

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
📊 20 readings sent | 🟢 ON | Battery: 88% | Temp: 26.1°C
🌧️  Rain detected! Bot may pause operation...
📊 30 readings sent | 🟢 ON | Battery: 84% | Temp: 25.8°C
☀️  Rain stopped.
⚠️  Low battery! Bot stopping to charge...
📊 40 readings sent | 🔴 OFF 🔌 CHARGING | Battery: 18% | Temp: 23.2°C
📊 50 readings sent | 🔴 OFF 🔌 CHARGING | Battery: 25% | Temp: 22.8°C
...
```

## Endpoints Used:

- `POST /api/bots/{bot_id}/sensor-reading` - Send sensor data
- `POST /api/bots/{bot_id}/events` - Log events
- `GET /health` - Check backend health

## Tips:

- Run multiple simulators with different BOT_IDs to simulate multiple bots
- Adjust UPDATE_INTERVAL for faster/slower data generation
- Use `screen` or `tmux` to run simulator in background
- Check backend logs to see incoming data

## Running in Background:

```bash
# Using nohup
nohup python bot_simulator.py > simulator.log 2>&1 &

# Using screen
screen -S bot-sim
python bot_simulator.py
# Detach with Ctrl+A, D

# Reattach later
screen -r bot-sim
```

## Troubleshooting:

**Cannot reach backend:**
- Make sure backend is running
- Check BACKEND_URL is correct
- Verify firewall/network settings

**Bot ID not found:**
- Make sure bot exists in database
- Check BOT_ID environment variable
- Create a test bot if needed

**High error rate:**
- Check backend logs for errors
- Verify database connection
- Check Supabase credentials




