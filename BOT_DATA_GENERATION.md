# Bot Data Generation Guide

## Overview

This guide explains how to generate realistic bot tracking data for testing the bot monitoring system.

## Migration Fixes

### Fixed: `20251021100001_bot_data_tracking_system.sql`

**Issue**: The migration was trying to drop a constraint that might not exist on first run.

**Fix**: Wrapped the constraint modification in a `DO $$` block that checks if the constraint exists before dropping it:

```sql
DO $$ 
BEGIN
    -- Drop the old constraint if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'bot_telemetry_telemetry_type_check' 
        AND table_name = 'bot_telemetry'
    ) THEN
        ALTER TABLE bot_telemetry DROP CONSTRAINT bot_telemetry_telemetry_type_check;
    END IF;
    
    -- Add the new constraint with extended types
    ALTER TABLE bot_telemetry 
        ADD CONSTRAINT bot_telemetry_telemetry_type_check 
        CHECK (telemetry_type IN (...));
END $$;
```

This ensures the migration can run successfully on both fresh databases and existing ones.

## Bot Data Generator Script

### Location

```
/home/exo/botkorp-mono/seed/bot_data.py
```

### What It Does

The script generates realistic bot tracking data:

1. **Location History** (720 points over 6 hours)
   - Realistic lawn mowing GPS patterns
   - Back-and-forth parallel lines
   - Natural variations in position
   - Movement speed and heading data

2. **Sensor Readings** (360 readings over 6 hours, 1 per minute)
   - Battery level (drains from 95% to 20%)
   - Temperature and humidity (varies throughout day)
   - Motor RPM (800-1200 when active)
   - 3D orientation (pitch, roll, yaw)
   - 3D acceleration (x, y, z)
   - 3D rotation rates
   - Rain detection (5% probability)
   - GPS coordinates

3. **Bot Events** (8-9 events)
   - powered_on
   - started (mowing)
   - obstacle_detected
   - low_battery_warning
   - route_completed
   - returned_home
   - charging_started
   - charging_completed
   - rain_detected (20% chance)

4. **Daily Statistics** (7 days)
   - Runtime, active time, idle time, charging time
   - Distance traveled, area covered
   - Battery statistics (avg, min, max, charge cycles)
   - Event counts (errors, warnings)
   - Temperature statistics
   - Rain detection count

### How It Works

1. Finds the first service record in the database
2. Gets the location_id from that service
3. Finds all bots assigned to that location
4. For each bot, generates all 4 types of data
5. Uses Supabase REST API with service role key (no external dependencies)

### Usage

#### Prerequisites

- Database must have at least one service record
- That service must have a location_id
- That location must have at least one bot assigned

#### Run the script

```bash
cd seed
python bot_data.py
```

Or make it executable:

```bash
chmod +x seed/bot_data.py
./seed/bot_data.py
```

### Example Output

```
🤖 Bot Data Generator
==================================================

📋 Finding first available service...
✓ Found service: a1b2c3d4-...

🤖 Finding bots for location: e5f6g7h8-...
✓ Found 1 bot(s)

==================================================
🤖 Generating data for: MowBot Alpha (mow_bot)
   Bot ID: i9j0k1l2-...
==================================================
  📍 Generating location history (6 hours)...
    ✓ Created 720 location points
  📊 Generating sensor readings (6 hours)...
    ✓ Created 360 sensor readings
  🎯 Generating bot events...
    ✓ Created 8 events
  📈 Generating daily statistics (7 days)...
    ✓ Created 7 daily statistics

✅ Successfully generated data for MowBot Alpha

==================================================
✅ Data generation complete!
==================================================
```

## Database Reset Instructions

After fixing the migrations, you can reset your database:

### Option 1: Supabase Dashboard

1. Go to Database → Migrations
2. Delete/rollback problematic migrations
3. Re-run migrations in order

### Option 2: Complete Reset

```bash
# Back up important data first!
supabase db reset
```

### Option 3: Manual SQL

```sql
-- Drop the bot tracking tables
DROP TABLE IF EXISTS bot_daily_statistics CASCADE;
DROP TABLE IF EXISTS bot_sensor_readings CASCADE;
DROP TABLE IF EXISTS bot_events CASCADE;
DROP TABLE IF EXISTS bot_location_history CASCADE;

-- Re-run the migrations
```

## Testing the System

### 1. Reset Database
```bash
supabase db reset
```

### 2. Seed Base Data
```bash
cd seed
python main.py
```

### 3. Create Service & Bot Manually

Via Supabase Dashboard or API:
- Create an organization
- Create a location
- Create a service for that location
- Create a bot for that location

### 4. Generate Bot Data
```bash
cd seed
python bot_data.py
```

### 5. View Data in Frontend

Navigate to:
- Services page → Select service → View Bot Status
- Location page → View Bot Status
- Dashboard with bot statistics

## RPC Functions Available

The system provides these functions for querying bot data:

1. `get_service_bot_data(service_id)` - Get all bot data for a service
2. `get_location_bot_data(location_id)` - Get bot data for a location
3. `get_bot_sensor_history(location_id, hours_back)` - Get sensor history for graphs
4. `get_location_bot_statistics(location_id, days_back)` - Get daily stats
5. `get_my_locations_with_bots()` - Get all locations with bot status

## Security Notes

- All bot tracking tables have RLS enabled
- Direct table access is restricted
- Users can only see bots at their organization's locations
- Admins can see all bot data
- RPC functions use SECURITY DEFINER and enforce permissions
- Service role can insert data (for bot API)

## Data Visualization

The generated data is designed to work with:

- **Location trails**: Map showing bot movement over time
- **Sensor graphs**: Battery, temperature, humidity over time
- **Event timeline**: Chronological list of bot events
- **Daily statistics**: Performance metrics by day
- **Real-time status**: Current bot state (on/off, battery, charging)

## Troubleshooting

### "No services found"
Create a service record first via the UI or SQL.

### "No bots found for this location"
Assign a bot to the location that has the service.

### HTTP errors
Check that SUPABASE_URL and SUPABASE_SERVICE_KEY are correct in bot_data.py.

### Data not showing in frontend
Check RLS policies and ensure user's organization matches location's organization.

