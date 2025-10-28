# Database Seeder & Simulators

This directory contains scripts to seed the BotKorp database with test data and simulate bot operations.

## What it contains

### Data Seeders

#### main.py - Base Data Seeder

1. **Test User**
   - Email: `botkorpza@gmail.com`
   - Password: `happy135`

2. **Coverage Areas**
   - Parses `coverage.kml` and uploads coverage areas to the database
   - Includes cities like Durban, Montclair, Westville, Durban North, etc.

#### bot_data.py - Bot Tracking Data Generator

Generates realistic bot tracking data for testing the bot monitoring system:

1. **Location History** - GPS tracking data showing bot movement patterns (lawn mowing patterns)
2. **Sensor Readings** - Battery, temperature, humidity, RPM, orientation, acceleration data
3. **Bot Events** - Powered on/off, charging, obstacles, battery warnings, etc.
4. **Daily Statistics** - Aggregated daily performance metrics

### Bot Simulators

#### bot_simulator.py - Single Bot Simulator
Simulates a single bot sending real-time sensor data to the backend API. Generates continuous telemetry data including movement, battery drain/charging cycles, environmental sensors, and events.

#### service_bot_simulator.py - Service-Centric Bot Simulator
Simulates a bot performing mowing service work with:
- Mowing session creation and completion
- Environmental data monitoring (temperature, humidity, rain)
- Detailed sensor data during mowing (blade RPM, GPS tracking, battery usage)
- Session metrics (area covered, distance traveled)

### Helper Scripts

- **create-test-bot.py** - Creates a test bot in the database ready for simulation
- **create-bots-for-location.py** - Creates multiple bots for a location/service
- **quick-start-test-bot.sh** - Quick start script to run the bot simulator

## Prerequisites

1. **Python 3** - Already available on most systems (no additional packages needed!)

That's it! The script uses only Python standard library with the Supabase REST API.

## Usage

### Run the base seeder (user + coverage)

```bash
cd seed
python main.py
```

Or make it executable and run directly:

```bash
cd seed
chmod +x main.py
./main.py
```

### Run the bot data generator

After you have services and bots created, generate realistic bot tracking data:

```bash
cd seed
python bot_data.py
```

Or:

```bash
cd seed
chmod +x bot_data.py
./bot_data.py
```

This will:
- Find the first available service in the database
- Get all bots assigned to that service's location
- Generate 6 hours of location history, sensor readings, and events
- Generate 7 days of daily statistics

### Run from project root

```bash
python seed/main.py         # Seed users and coverage
python seed/bot_data.py     # Generate bot data
```

### Run Bot Simulators

#### Create test bot first

```bash
cd seed
python create-test-bot.py
```

#### Run single bot simulator (legacy)

```bash
cd seed
export BOT_ID="550e8400-e29b-41d4-a716-446655440000"
export BACKEND_URL="http://localhost:8080"
python bot_simulator.py
```

Or use the quick-start script:

```bash
cd seed
./quick-start-test-bot.sh
```

#### Run service bot simulator (recommended)

```bash
cd seed
export GARDEN_ID="your-garden-uuid"
export SERVICE_ID="your-service-uuid"
export BOT_ID="550e8400-e29b-41d4-a716-446655440000"  # Optional
export BACKEND_URL="http://localhost:8080"
python service_bot_simulator.py
```

This will:
- Start a mowing session automatically
- Send environmental data (temperature, humidity, rain sensors)
- Send detailed mowing sensor data (blade RPM, GPS tracking, etc.)
- Track session metrics (area covered, distance traveled)
- Handle battery drain and session completion
- Restart sessions when battery is recharged

## What happens

1. **User Creation**
   - Uses Supabase Admin API to create a test user
   - Email is automatically confirmed
   - If user already exists, updates the password instead
   - Uses service role key for full admin access

2. **Coverage Upload**
   - Parses the `coverage.kml` file
   - Extracts polygon boundaries and center points
   - Uploads each coverage area to the `coverage_areas` table via REST API
   - Includes metadata like country, province, city, and service types

## Files

### Seeders
- `main.py` - Main seeder script that orchestrates user and coverage seeding
- `bot_data.py` - Bot tracking data generator (location history, sensors, events, stats)
- `seed_service_data.py` - Service data seeder
- `upload_coverage.py` - KML parser and coverage uploader
- `coverage.kml` - KML file containing coverage area boundaries

### Simulators
- `bot_simulator.py` - Legacy single bot real-time simulator
- `service_bot_simulator.py` - Service-centric bot simulator with mowing sessions
- `create-test-bot.py` - Helper to create test bot in database
- `create-bots-for-location.py` - Helper to create multiple bots for a location
- `quick-start-test-bot.sh` - Quick start script for bot simulator

### Database Migrations
Service data migrations are in `supabase/migrations/`:
- `20251024120001_create_service_data_tables.sql` - Create new service-centric tables

Note: Old bot-centric tables are already dropped by the initial `drop_everything.sql` migration.

### Utilities
- `verify_tables.py` - Verify database tables exist

## Troubleshooting

### Connection errors

If you get connection errors, verify:
- The Supabase URL is correct
- The service role key is valid
- Your network can reach Supabase

### User already exists

The script handles duplicate users gracefully by updating the password instead of failing.

### Coverage.kml not found

Ensure the `coverage.kml` file exists in the seed directory.

### Import errors

If you get `ModuleNotFoundError: No module named 'upload_coverage'`, make sure you're running the script from the seed directory or the project root.

## Development

To modify the seeded user credentials, edit these variables in `main.py`:

```python
USER_EMAIL = "botkorpza@gmail.com"
USER_PASSWORD = "happy135"
```

To modify coverage data, edit the `coverage.kml` file with your preferred KML editor.

