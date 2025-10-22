# Database Seeder

This directory contains scripts to seed the BotKorp database with test data.

## What it seeds

### main.py - Base Data Seeder

1. **Test User**
   - Email: `botkorpza@gmail.com`
   - Password: `happy135`

2. **Coverage Areas**
   - Parses `coverage.kml` and uploads coverage areas to the database
   - Includes cities like Durban, Montclair, Westville, Durban North, etc.

### bot_data.py - Bot Tracking Data Generator

Generates realistic bot tracking data for testing the bot monitoring system:

1. **Location History** - GPS tracking data showing bot movement patterns (lawn mowing patterns)
2. **Sensor Readings** - Battery, temperature, humidity, RPM, orientation, acceleration data
3. **Bot Events** - Powered on/off, charging, obstacles, battery warnings, etc.
4. **Daily Statistics** - Aggregated daily performance metrics

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

- `main.py` - Main seeder script that orchestrates user and coverage seeding
- `bot_data.py` - Bot tracking data generator (location history, sensors, events, stats)
- `upload_coverage.py` - KML parser and coverage uploader
- `coverage.kml` - KML file containing coverage area boundaries
- `test-coverage-query.sql` - SQL queries for testing coverage data
- `debug-coverage.md` - Debug notes for coverage functionality

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

