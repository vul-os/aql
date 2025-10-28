# Database Reset Guide

## Quick Reset

```bash
cd supabase
supabase db reset
```

This will:
1. Drop all tables, functions, and policies
2. Apply all migrations in order (42 migrations total)
3. Set up fresh database with new service-centric data architecture

## What Changed

### Removed Migration
- ❌ `20251024120000_drop_old_bot_data_tables.sql` - Redundant (drop_everything already handles this)

### Updated Migration
- ✅ `20251024120001_create_service_data_tables.sql` - Now drops old session tables before creating new ones

### The Fix
The migration now includes:
```sql
DROP TABLE IF EXISTS mowing_sessions CASCADE;
DROP TABLE IF EXISTS pool_cleaning_sessions CASCADE;
```

This ensures the old tables (created by `20251019210905_gardens_and_pools.sql`) are removed before creating the new service-centric session tables.

## New Service Data Tables

All created with **RLS DISABLED**:

### Environmental Data
- `garden_environmental_data` - Temperature, humidity, soil moisture, rain sensors
- `pool_environmental_data` - Air/water temperature, water quality

### Session Tables
- `garden_mowing_sessions` - Mowing work sessions (replaces old `mowing_sessions`)
- `garden_mowing_sensor_data` - Detailed sensor data during mowing
- `pool_cleaning_sessions` - Pool cleaning work sessions (replaces old `pool_cleaning_sessions`)
- `pool_cleaning_sensor_data` - Detailed sensor data during pool cleaning

### Events
- `service_events` - Service-related events (sessions, alerts, environmental)

## Migration Order

The migrations run in this order:
1. `20251019210900_drop_everything.sql` - Drop all existing tables
2. `20251019210901_enable_extensions.sql` - Enable PostgreSQL extensions
3. `20251019210902_core_tables.sql` - Create profiles, organizations, locations
4. ... (38 more migrations)
5. `20251024120001_create_service_data_tables.sql` - Create new service data tables

## Verify Tables

After reset, verify all service data tables exist:

```bash
cd seed
python3 verify_tables.py
```

## Troubleshooting

### If `supabase db reset` fails

Use the manual reset script:

1. Open Supabase SQL Editor
2. Run `supabase/manual_reset.sql` (drops everything safely)
3. Then run `supabase db push` to apply all migrations

### Extension function errors

If you see errors about extension functions (like `uuid_nil`), it's because Supabase CLI tries to drop extension-owned functions. Use the manual reset script instead.

## Next Steps

After database reset:

1. **Seed data:**
   ```bash
   cd seed
   python3 main.py
   python3 seed_service_data.py
   ```

2. **Run simulator:**
   ```bash
   cd seed
   export GARDEN_ID="your-garden-uuid"
   export SERVICE_ID="your-service-uuid"
   python3 service_bot_simulator.py
   ```

