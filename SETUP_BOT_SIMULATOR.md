# Bot Simulator Setup Guide

This guide will help you set up and run the bot simulator to see live bot data in your application.

## Overview

The bot simulator sends realistic sensor data to "Test Mow Bot #1" which can be viewed in your service's **Bot Status** tab.

## Features

✅ **Bots removed from sidebar** - Access bots through the service page  
✅ **Professional Bot Status tab** - Shows real-time bot data with:
- Live sensor readings (battery, temperature, humidity, activity)
- Interactive map with bot location and movement trail
- Battery level chart (last 24 hours)
- Temperature & humidity chart (last 24 hours)
- Today's performance stats
- Recent events/alerts

## Prerequisites

1. **Backend must be running**:
   ```bash
   cd backend
   python main.py
   ```

2. **Create Test Bot #1 in database**:
   - Go to your Supabase SQL editor
   - Run the SQL file: `backend/simulator/create-test-bot.sql`
   - This creates "Test Mow Bot #1" with ID: `550e8400-e29b-41d4-a716-446655440000`

3. **Python dependencies** (if not already installed):
   ```bash
   cd backend/simulator
   pip install requests
   ```

## Running the Simulator

### Quick Start (Recommended)

```bash
cd backend/simulator
./quick-start-test-bot.sh
```

This will:
- Check if the backend is running
- Start the simulator sending data every 5 seconds
- Send data to "Test Mow Bot #1"

### Manual Start

If you want to customize the configuration:

```bash
cd backend/simulator

# Set environment variables
export BOT_ID="550e8400-e29b-41d4-a716-446655440000"  # Test Mow Bot #1
export BACKEND_URL="http://localhost:8080"
export UPDATE_INTERVAL="5"  # seconds between updates

# Run simulator
python bot_simulator.py
```

## Viewing Bot Data in the App

1. **Navigate to your service**:
   - Go to the Services page
   - Click on a service

2. **Open Bot Status tab**:
   - Click the "Bot Status" tab
   - You'll see real-time data updating every 30 seconds

3. **Features to explore**:
   - **Live Stats**: Battery, temperature, activity, weather
   - **Map**: See the bot's current location and movement trail
   - **Graphs**: Battery and temperature trends over 24 hours
   - **Performance**: Today's runtime, distance, area covered
   - **Events**: Recent bot activities and alerts

## Simulator Behavior

The simulator creates realistic bot behavior:

- **Battery Management**:
  - Drains when active (0.1-0.3% per reading)
  - Charges when low (<15%)
  - Full at 95%+

- **Movement**:
  - Moves in spiral/circular patterns
  - Updates GPS coordinates
  - Tracks direction and speed

- **Environment**:
  - Temperature varies throughout the day
  - Humidity inversely related to temperature
  - Random rain events (2% chance per reading)

- **Events**:
  - Sends startup/shutdown events
  - Alerts when rain is detected
  - Low battery warnings

## Stopping the Simulator

Press `Ctrl+C` in the terminal running the simulator.

The simulator will:
- Send a shutdown event
- Display session statistics
- Stop gracefully

## Troubleshooting

### "Backend is not running"
```bash
cd backend
python main.py
```

### "No bot assigned yet"
Run the SQL file to create the test bot:
```bash
# In Supabase SQL editor
-- Run: backend/simulator/create-test-bot.sql
```

### "Bot not found"
Make sure the bot ID in the simulator matches the bot in your database:
- Bot ID: `550e8400-e29b-41d4-a716-446655440000`
- Bot Name: "Test Mow Bot #1"

### Map not showing
The map uses Leaflet which loads dynamically. If the map doesn't appear:
- Check browser console for errors
- Ensure you have internet connection (for map tiles)
- Wait a few seconds for Leaflet to load

### Graphs not showing data
- Ensure the simulator has been running for at least a minute
- Check that sensor readings are being saved to the database
- Verify the bot ID matches in both simulator and database

## Technical Details

### Database Tables Used

- `bots` - Bot information
- `bot_sensor_readings` - Real-time sensor data
- `bot_events` - Bot events and alerts

### API Endpoints

The simulator sends data to:
- `POST /api/bots/{bot_id}/sensor-reading` - Sensor data
- `POST /api/bots/{bot_id}/events` - Events

### Sensor Data Fields

```json
{
  "recorded_at": "2025-10-23T10:30:00Z",
  "is_on": true,
  "battery_percentage": 85,
  "battery_voltage": 12.4,
  "is_charging": false,
  "direction_degrees": 45.2,
  "rpm": 3200,
  "temperature_celsius": 24.5,
  "humidity_percentage": 65.2,
  "is_raining": false,
  "latitude": -29.8587,
  "longitude": 31.0218,
  "pitch": 2.1,
  "roll": -1.3,
  "yaw": 45.2
}
```

## Next Steps

1. **Start the backend**: `cd backend && python main.py`
2. **Create the test bot**: Run `create-test-bot.sql` in Supabase
3. **Start the simulator**: `./quick-start-test-bot.sh`
4. **View bot data**: Navigate to Services → [Your Service] → Bot Status

Enjoy exploring your bot's real-time data! 🤖

