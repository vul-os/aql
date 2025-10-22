# Quick Start: Bot Data Generation

## TL;DR

1. **Reset database**: `supabase db reset`
2. **Create test data** (via UI or SQL):
   - Organization
   - Location
   - Service 
   - Bot
3. **Generate bot data**: `python seed/bot_data.py`
4. **View in frontend**: Services → Bot Status

## What Was Done

### Fixed Migration

`supabase/migrations/20251021100001_bot_data_tracking_system.sql`
- Fixed constraint modification to work on fresh databases
- Now safely checks if constraint exists before dropping

### Created Bot Data Generator

`seed/bot_data.py` 
- Finds first service automatically
- Generates 6 hours of realistic bot tracking data
- Creates location trails, sensor readings, events, and daily stats
- Uses credentials from `main.py` (no .env needed)

## Generated Data

| Type | Count | Description |
|------|-------|-------------|
| Location points | 720 | GPS trail in mowing pattern |
| Sensor readings | 360 | Battery, temp, humidity, RPM, IMU |
| Events | 8-9 | Power, charging, obstacles, warnings |
| Daily stats | 7 | Performance metrics per day |

## Run It

```bash
# Reset DB
supabase db reset

# Create: organization → location → service → bot (via UI)

# Generate data
cd seed
python bot_data.py

# Output:
# 🤖 Bot Data Generator
# ✓ Found service
# ✓ Found 1 bot(s)
# 🤖 Generating data for: MowBot Alpha
#   ✓ Created 720 location points
#   ✓ Created 360 sensor readings
#   ✓ Created 8 events
#   ✓ Created 7 daily statistics
# ✅ Data generation complete!
```

## Files Changed

- ✅ `supabase/migrations/20251021100001_bot_data_tracking_system.sql` - Fixed
- ✅ `seed/bot_data.py` - New
- ✅ `seed/README.md` - Updated
- ✅ `BOT_DATA_GENERATION.md` - New guide
- ✅ `MIGRATION_FIX_SUMMARY.md` - Detailed summary

## Expected Result

Frontend should show:
- 📍 Map with bot movement trail (lawn mowing pattern)
- 📊 Graphs: Battery (95%→20%), Temperature (18-28°C), Humidity
- 🎯 Event timeline with 8-9 events
- 📈 7 days of daily statistics
- ⚡ Current bot status (battery, temp, on/off)

## Troubleshooting

**"No services found"** → Create a service first
**"No bots found"** → Assign a bot to the service's location
**Data not showing** → Check user's org matches location's org

---

**See `MIGRATION_FIX_SUMMARY.md` for complete details**

