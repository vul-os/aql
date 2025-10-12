# BotKorp Database Schema Diagram

## Entity Relationship Overview

```
┌─────────────────┐
│  Organizations  │
│  - id           │
│  - name         │
│  - slug         │
│  - owner_id     │
└────────┬────────┘
         │
         │ 1:N
         │
┌────────▼────────┐
│   Locations     │
│  - id           │
│  - org_id       │
│  - name         │
│  - address      │
│  - coordinates  │
└────────┬────────┘
         │
         │ 1:N
         │
┌────────▼────────┐        ┌──────────────────┐
│      Bots       │───────►│  Bot Commands    │
│  - id           │   1:N  │  - id            │
│  - location_id  │        │  - bot_id        │
│  - name         │        │  - command_type  │
│  - bot_type     │        │  - status        │
│  - status       │        │  - issued_by     │
│  - battery      │        └──────────────────┘
└────────┬────────┘
         │
         │ 1:N
         │
┌────────▼────────┐
│ Bot Telemetry   │
│  - id           │
│  - bot_id       │
│  - timestamp    │
│  - type         │
│  - data (JSON)  │
└─────────────────┘
         │
         │ 1:N
         ├────────────────────┐
         │                    │
┌────────▼────────┐  ┌────────▼────────────┐
│  Bot Schedules  │  │   Bot Alerts        │
│  - id           │  │  - id               │
│  - bot_id       │  │  - bot_id           │
│  - name         │  │  - alert_type       │
│  - schedule_type│  │  - severity         │
│  - cron_expr    │  │  - is_resolved      │
│  - command_type │  └─────────────────────┘
└─────────────────┘

┌─────────────────┐
│    Profiles     │
│  - id           │
│  - email        │
│  - full_name    │
│  - role         │
│  - org_id       │
└─────────────────┘
         │
         │ (Referenced by)
         │
    ┌────┴────┬──────────┬─────────────┐
    │         │          │             │
Organizations │     Commands      Schedules
   (owner)   Alerts  (issued_by) (created_by)
```

## Locations, Gardens & Pools

Each **location** can have:
- Multiple **gardens** (lawns, yards) - tracked with area, perimeter, grass type, mowing preferences
- Multiple **pools** - tracked with dimensions, volume, water quality targets
- Multiple **bots** assigned to service them

**Many-to-Many Relationships:**
- One garden can be serviced by multiple mow bots (primary + backup)
- One mow bot can service multiple gardens
- One pool can be cleaned by multiple pool bots
- One pool bot can service multiple pools

Each assignment tracks performance metrics (total sessions, runtime, last serviced date).

## Bot Types & Their Specific Features

### 🌱 Mow Bot (`mow_bot`)
- **Operations**: Start, Stop, Return Home, Emergency Stop
- **Telemetry**: Battery level, Location (GPS), Temperature, Runtime
- **Schedules**: Daily/weekly mowing patterns
- **Commands**: Power on/off, Start, Pause, Resume, Return home

### 🌤️ Weather Station (`weather_station`)
- **Operations**: Continuous monitoring
- **Telemetry**: Temperature, Humidity, Pressure, Wind speed, Rainfall
- **Schedules**: Data collection intervals
- **No battery** (always powered)

### 🏊 Pool Bot (`pool_bot`)
- **Operations**: Cleaning, Water testing
- **Telemetry**: Water quality (pH, chlorine), Temperature, Battery
- **Schedules**: Regular cleaning cycles
- **Commands**: Start cleaning, Stop, Return to dock

### 🔒 Security Bot (`security_bot`)
- **Operations**: Motion detection, Patrol (if mobile), Alerts
- **Telemetry**: Motion events, System health, Storage usage
- **Commands**: Arm/disarm, Patrol mode, Alert triggers

## Table Details

### Core Tables (10)
| Table | Purpose | Key Fields | Relations |
|-------|---------|------------|-----------|
| `profiles` | User accounts | id, email, role | → organizations |
| `organizations` | Companies | id, name, slug | ← profiles (owner) |
| `locations` | Physical sites | id, org_id, coords | → organizations |
| `bots` | Bot instances | id, location_id, type, status | → locations |
| `bot_commands` | Control commands | id, bot_id, command, status | → bots, profiles |
| `bot_telemetry` | Sensor data | id, bot_id, type, data | → bots |
| `gardens` | Individual gardens/lawns | id, location_id, area, perimeter | → locations |
| `pools` | Individual pools | id, location_id, dimensions, volume | → locations |
| `bot_garden_assignments` | Bot-to-garden assignments | bot_id, garden_id, metrics | → bots, gardens |

### Supporting Tables (9)
| Table | Purpose | Key Fields |
|-------|---------|------------|
| `bot_pool_assignments` | Bot-to-pool assignments | bot_id, pool_id, metrics |
| `service_records` | Service history | id, bot_id, service_type, cost |
| `mowing_sessions` | Individual mowing sessions | bot_id, garden_id, duration, area |
| `pool_cleaning_sessions` | Individual cleaning sessions | bot_id, pool_id, water_quality |
| `bot_schedules` | Automation | id, bot_id, cron, command |
| `bot_alerts` | Notifications | id, bot_id, type, severity |
| `activity_logs` | Audit trail | id, user_id, action, resource |
| `coverage_areas` | Service coverage | province, city, postal_codes |
| `organization_members` | Team members | org_id, user_id, role, permissions |

## Data Flow

### Command Flow
```
User Interface
    ↓
bot_commands (status: pending)
    ↓
Message Queue / API
    ↓
Bot receives command
    ↓
bot_commands (status: acknowledged)
    ↓
Bot executes
    ↓
bot_commands (status: completed)
```

### Telemetry Flow
```
Bot sensors
    ↓
Data collected
    ↓
bot_telemetry (inserted)
    ↓
Real-time subscriptions notify UI
    ↓
User sees live data
```

### Alert Flow
```
Bot detects condition
    ↓
bot_alerts (created)
    ↓
Notification service
    ↓
Email/SMS/Push to users
```

## Indexes Strategy

### High-Traffic Queries
- `bot_telemetry(bot_id, timestamp DESC)` - For real-time dashboards
- `bot_alerts(is_resolved, created_at DESC)` - For alert center
- `bot_commands(bot_id, created_at DESC)` - For command history
- `mowing_sessions(bot_id, start_time DESC)` - For session history

### Optimization
- Foreign keys automatically indexed
- Composite indexes on common filters
- Partial indexes on active records only (where is_active = true)

## Scalability Considerations

### For High Volume
1. **Partition `bot_telemetry` by time** (monthly/weekly)
2. **Archive old session data** to cold storage
3. **Use materialized views** for dashboard aggregations
4. **Consider TimescaleDB extension** for time-series data

### Real-time Features
- Supabase Realtime enabled on all tables
- Subscribe to specific bot updates
- Live dashboards with minimal latency

## Security (RLS)

Each table has Row Level Security enabled. Next migration will add policies:

```sql
-- Example: Users can only see bots in their organization
CREATE POLICY "Users see own org bots"
ON bots FOR SELECT
USING (
  location_id IN (
    SELECT id FROM locations 
    WHERE organization_id IN (
      SELECT organization_id FROM profiles 
      WHERE id = auth.uid()
    )
  )
);
```

## Storage

### File Storage
- Garden/pool images stored as CDN URLs
- Service photos/documents stored as CDN URLs
- Bot QR codes stored as URLs
- Consider Supabase Storage or external CDN (Cloudflare, AWS S3)

## Next Steps

1. ✅ Initial schema created
2. ⬜ Add RLS policies (security)
3. ⬜ Add database functions (business logic)
4. ⬜ Add views (reporting)
5. ⬜ Set up storage buckets (images/documents)
6. ⬜ Configure real-time subscriptions

