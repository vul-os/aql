# Migration Fix & Bot Data Generator - Summary

## ✅ What Was Fixed

### 1. Migration: `20251021100001_bot_data_tracking_system.sql`

**Problem**: 
- Migration tried to `DROP CONSTRAINT IF EXISTS` on first run
- This could fail on fresh databases where the constraint doesn't exist yet

**Solution**:
- Wrapped constraint modification in a proper `DO $$ ... END $$` block
- Added explicit check using `information_schema.table_constraints`
- Now safely handles both fresh databases and updates

**Changed Lines**: 8-35

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

### 2. Other Migrations

**Status**: ✅ No issues found
- `20251021100002_bot_tracking_rpc_functions.sql` - OK
- `20251021100003_bot_tracking_rls_policies.sql` - OK

## ✅ What Was Created

### Bot Data Generator: `seed/bot_data.py`

**Location**: `/home/exo/botkorp-mono/seed/bot_data.py`

**Features**:
- ✅ Uses hardcoded Supabase credentials (from `main.py`)
- ✅ No external dependencies (uses standard library + urllib)
- ✅ Finds first available service automatically
- ✅ Generates data for all bots at that service's location
- ✅ Creates realistic, time-series data

**Credentials Used**:
```python
SUPABASE_URL = 'https://kyoowsarfopltjwmhksi.supabase.co'
SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
```

## 📊 Generated Data Summary

For each bot, the script generates:

| Data Type | Quantity | Time Span | Description |
|-----------|----------|-----------|-------------|
| **Location History** | 720 points | 6 hours | GPS coordinates in lawn mowing pattern |
| **Sensor Readings** | 360 readings | 6 hours | Battery, temp, humidity, RPM, IMU data |
| **Bot Events** | 8-9 events | 6 hours | Power, charging, obstacles, warnings |
| **Daily Statistics** | 7 records | 7 days | Aggregated performance metrics |

### Location History Details
- Realistic back-and-forth mowing pattern
- Points every 30 seconds
- Includes speed, heading, altitude, GPS accuracy
- Natural position variations

### Sensor Readings Details
- One reading per minute
- Battery drains from 95% → 20%
- Temperature varies with time of day (18-28°C)
- Humidity inversely related to temperature
- Motor RPM: 800-1200 when active, 0 when idle
- 3D orientation (pitch, roll, yaw)
- 3D acceleration (x, y, z) - includes gravity
- 3D rotation rates
- Rain detection (5% probability per reading)

### Bot Events Details
1. `powered_on` - Bot initialization
2. `started` - Mowing routine begins
3. `obstacle_detected` - Path adjustment (halfway)
4. `low_battery_warning` - Battery below 30%
5. `route_completed` - Mowing finished
6. `returned_home` - Back at charging station
7. `charging_started` - Connected to power
8. `charging_completed` - Fully charged
9. `rain_detected` - (20% chance of occurrence)

### Daily Statistics Details
- Runtime: 180-300 minutes (weekdays), 120-180 minutes (weekends)
- Distance: 2-5 km per day
- Area covered: 800-1500 m² per day
- Battery: Average 50-80%, min 15-30%, max 95-100%
- Events: 5-15 per day, 0-2 errors, 1-5 warnings

## 🚀 How to Use

### Step 1: Reset Database

```bash
supabase db reset
```

Or manually drop and recreate tables in Supabase dashboard.

### Step 2: Run Migrations

Migrations should run automatically on database reset, or manually run them in order:

1. `20251021100001_bot_data_tracking_system.sql`
2. `20251021100002_bot_tracking_rpc_functions.sql`
3. `20251021100003_bot_tracking_rls_policies.sql`

### Step 3: Create Test Data

Create (via UI or SQL):
- ✅ Organization
- ✅ Location (linked to organization)
- ✅ Service (linked to location)
- ✅ Bot (linked to location)

### Step 4: Generate Bot Data

```bash
cd seed
python bot_data.py
```

Expected output:
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

### Step 5: View in Frontend

Navigate to:
- `/services` → Click service → "Bot Status" tab
- `/locations/{id}` → "Bot Status" section
- Dashboard widgets showing bot metrics

## 📁 File Structure

```
botkorp-mono/
├── supabase/
│   └── migrations/
│       ├── 20251021100001_bot_data_tracking_system.sql    ← FIXED
│       ├── 20251021100002_bot_tracking_rpc_functions.sql  ← OK
│       └── 20251021100003_bot_tracking_rls_policies.sql   ← OK
├── seed/
│   ├── main.py              ← Base seeder (user + coverage)
│   ├── bot_data.py          ← NEW: Bot data generator
│   ├── upload_coverage.py
│   ├── coverage.kml
│   └── README.md            ← UPDATED
├── BOT_DATA_GENERATION.md      ← NEW: Detailed guide
└── MIGRATION_FIX_SUMMARY.md    ← NEW: This file
```

## 🔒 Security & Permissions

### RLS Policies
- ✅ All bot tracking tables have RLS enabled
- ✅ Users can only see bots at their organization's locations
- ✅ Admins can see all bot data
- ✅ Service role can insert data (for bot API and seeders)

### RPC Functions
All functions use `SECURITY DEFINER` and check permissions:
- `get_service_bot_data(service_id)` - Get bot data for a service
- `get_location_bot_data(location_id)` - Get bot data for a location
- `get_bot_sensor_history(location_id, hours_back)` - Time-series sensor data
- `get_location_bot_statistics(location_id, days_back)` - Daily aggregates
- `get_my_locations_with_bots()` - All locations with bot status

## 🎯 Next Steps

1. ✅ Reset your database
2. ✅ Verify migrations run successfully
3. ✅ Create test organization, location, service, and bot
4. ✅ Run `python seed/bot_data.py`
5. ✅ Test the frontend pages to see bot data
6. ✅ Verify graphs, maps, and statistics display correctly

## 🐛 Troubleshooting

### Migration fails with constraint error
- Make sure you're running the FIXED version of `20251021100001_bot_data_tracking_system.sql`
- The file should have the `DO $$ BEGIN ... END $$` block

### "No services found"
- Create a service record first
- Make sure it has a valid `location_id`

### "No bots found for this location"
- Create a bot record with `location_id` matching the service's location

### Data not visible in frontend
- Check that user's organization matches location's organization
- Verify RLS policies are enabled
- Check browser console for API errors

### HTTP errors in bot_data.py
- Verify `SUPABASE_URL` is correct
- Verify `SUPABASE_SERVICE_KEY` is the service role key (not anon key)
- Check network connectivity

## ✨ Success Criteria

You should see:
- ✅ Bot location trail on map (720 points in mowing pattern)
- ✅ Battery graph showing drain from 95% to 20%
- ✅ Temperature/humidity graphs with daily variations
- ✅ Event timeline with 8-9 events
- ✅ Daily statistics table with 7 days of data
- ✅ Current bot status (battery, temperature, on/off state)

## 📚 Additional Documentation

- `BOT_DATA_GENERATION.md` - Detailed guide and technical info
- `seed/README.md` - Seed scripts documentation
- `BOT_TRACKING_SETUP_COMPLETE.md` - Original setup guide
- `BOT_DATA_TRACKING_GUIDE.md` - Backend implementation guide

