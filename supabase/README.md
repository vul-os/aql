# BotKorp Database Schema

## Overview

This directory contains all database migrations and seed data for the BotKorp platform. The schema is designed to manage multiple types of bots (Mow Bot, Weather Station, Pool Bot, Security Bot) across different organizations and locations.

## Database Tables

### Core Tables

- **`profiles`** - User profiles extending Supabase auth.users
  - Auto-created on signup via trigger
  - Syncs email, name, and avatar from auth metadata
- **`organizations`** - Companies/groups owning bots and locations
- **`locations`** - Physical locations where bots are deployed

### Bot Management

- **`bots`** - Individual bot instances with status, connection info, and configuration
  - Bot Types: `mow_bot`, `weather_station`, `pool_bot`, `security_bot`
  - Status: `online`, `offline`, `active`, `idle`, `charging`, `error`, `maintenance`

### Gardens & Pools

- **`gardens`** - Individual gardens/lawns at locations
  - Tracks: area (m²), perimeter (m), grass type, terrain, mowing preferences
  - Images stored as CDN URLs (array)
  
- **`pools`** - Individual pools at locations
  - Tracks: dimensions, volume, depth, pool type, water quality targets
  - Images stored as CDN URLs (array)

- **`bot_garden_assignments`** - Many-to-many: bots ↔ gardens
- **`bot_pool_assignments`** - Many-to-many: bots ↔ pools

### Bot Operations

- **`bot_commands`** - Commands to control bots (on/off, start/stop, etc.)
  - Commands: `power_on`, `power_off`, `start`, `stop`, `pause`, `resume`, `return_home`, `emergency_stop`, `start_recording`, `stop_recording`, `arm_security`, etc.
  
- **`bot_telemetry`** - Sensor data and real-time telemetry from bots
  - Types: `status`, `location`, `battery`, `temperature`, `humidity`, `weather_data`, `water_quality`, `motion_detected`, etc.

- **`bot_schedules`** - Automated schedules for bot operations
  - Schedule Types: `one_time`, `daily`, `weekly`, `monthly`, `cron`

- **`bot_alerts`** - Alerts and notifications from bots
  - Severity: `info`, `warning`, `error`, `critical`

### Coverage & Pricing

- **`coverage_areas`** - Geographic areas where services are available (provinces, cities, postal codes)
- **`bot_pricing`** - Monthly rates per bot type and coverage area (in ZAR)
- **`service_fees`** - Additional service fees for easy calculation
- **`subscriptions`** - Bot subscription management and billing cycles
- **`invoices`** - Generated invoices with VAT (15%)
- **`payments`** - Payment transactions with Ozow Pay integration

### Organization Management

- **`organization_members`** - Team members with roles and permissions
  - Roles: `owner`, `admin`, `manager`, `operator`, `viewer`, `member`

### Audit

- **`activity_logs`** - Complete audit trail of all system activities

## Authentication

When a user signs up via Supabase Auth, a profile is automatically created through a database trigger:

```sql
-- The trigger handles:
- Creating profile with user's email
- Copying full_name from auth metadata
- Copying avatar_url from auth metadata
- Setting default role to 'user'
```

**Signup Example:**
```javascript
const { data, error } = await supabase.auth.signUp({
  email: 'user@example.com',
  password: 'password',
  options: {
    data: {
      full_name: 'John Doe',
      avatar_url: 'https://example.com/avatar.jpg'
    }
  }
});
// Profile automatically created in profiles table
```

## Migration Commands

### Local Development

```bash
# Create a new migration
supabase migration new <migration_name>

# Example: Add a new feature
supabase migration new add_notification_preferences

# Apply all migrations locally
supabase db reset

# Apply only new migrations
supabase migration up

# Generate migration from Studio changes
supabase db diff -f <migration_name>
```

### View Database

```bash
# Open Supabase Studio
supabase start
# Then visit: http://localhost:54323

# Connect with psql
psql postgresql://postgres:postgres@localhost:54322/postgres
```

### Deploy to Production

```bash
# Link to your Supabase project
supabase link --project-ref <your-project-ref>

# Push migrations to production
supabase db push

# Or push specific migration
supabase db push --dry-run  # Preview changes first
supabase db push
```

## Schema Design Patterns

### 1. Multi-Tenancy
- Organizations → Locations → Bots
- All data scoped to organization level
- Row Level Security (RLS) enabled on all tables

### 2. Time-Series Data
- `bot_telemetry` indexed by timestamp for efficient queries
- Consider partitioning for high-volume deployments

### 3. Command Pattern
- Commands tracked from creation → sent → acknowledged → completed
- Full audit trail of bot operations

### 4. Flexible Configuration
- JSONB fields (`config`, `metadata`) for extensibility
- No schema changes needed for new bot features

## Common Queries

### Check if location is in coverage area
```sql
-- By coordinates
SELECT * FROM is_in_coverage_area(-29.8587, 31.0218);

-- By postal code
SELECT * FROM is_in_coverage_area(-29.8587, 31.0218, '4001');

-- Get all coverage areas in KZN
SELECT * FROM coverage_areas 
WHERE province = 'KwaZulu-Natal' 
AND is_active = true;
```

### Get pricing for a bot in an area
```sql
SELECT 
    bp.*,
    ca.area_name,
    ca.city,
    ca.province
FROM bot_pricing bp
JOIN coverage_areas ca ON bp.coverage_area_id = ca.id
WHERE bp.bot_type = 'mow_bot'
AND ca.city = 'Durban'
AND bp.is_active = true;
```

### Calculate total monthly cost for organization
```sql
SELECT 
    o.name as organization,
    COUNT(s.id) as active_subscriptions,
    SUM(s.amount) as monthly_total,
    ROUND(SUM(s.amount) * 1.15, 2) as total_with_vat
FROM organizations o
JOIN subscriptions s ON o.id = s.organization_id
WHERE s.status = 'active'
AND s.billing_cycle = 'monthly'
GROUP BY o.id, o.name;
```

### Get organization members with permissions
```sql
SELECT 
    p.full_name,
    p.email,
    om.role,
    om.can_manage_bots,
    om.can_manage_billing,
    om.status
FROM organization_members om
JOIN profiles p ON om.user_id = p.id
WHERE om.organization_id = '<org-id>'
AND om.status = 'active';
```

### Get all bots for an organization
```sql
SELECT b.* 
FROM bots b
JOIN locations l ON b.location_id = l.id
WHERE l.organization_id = '<org-id>';
```

### Get recent telemetry for a bot
```sql
SELECT * 
FROM bot_telemetry
WHERE bot_id = '<bot-id>'
ORDER BY timestamp DESC
LIMIT 100;
```

### Get unresolved alerts
```sql
SELECT ba.*, b.name as bot_name, l.name as location_name
FROM bot_alerts ba
JOIN bots b ON ba.bot_id = b.id
JOIN locations l ON ba.location_id = l.id
WHERE ba.is_resolved = false
ORDER BY ba.created_at DESC;
```

### Send command to bot
```sql
INSERT INTO bot_commands (bot_id, issued_by, command_type, command_payload, status)
VALUES ('<bot-id>', '<user-id>', 'start', '{"mode": "auto"}', 'pending')
RETURNING *;
```

## Best Practices

### Migrations

1. **Never edit applied migrations** - Create new migrations to fix issues
2. **Test locally first** - Use `supabase db reset` before deploying
3. **Use transactions** - Wrap related changes in `BEGIN` / `COMMIT`
4. **Add indexes** - For foreign keys and commonly queried fields
5. **Document changes** - Add comments explaining complex logic

### Data Management

1. **Use seed.sql for defaults** - Not for user data
2. **Backup before migrations** - Especially in production
3. **Archive old data** - Move old telemetry/logs to cold storage
4. **Monitor table sizes** - Partition large tables as needed

## File Structure

```
supabase/
├── README.md                    # This file
├── config.toml                  # Supabase configuration
├── seed.sql                     # Initial/default data
└── migrations/
    ├── 20241212000001_initial_schema.sql
    ├── 20241212000002_rls_policies.sql  (next)
    └── ...
```

## Geographic Coverage (South Africa)

BotKorp currently operates in:
- **KwaZulu-Natal**: Durban (Central, Umhlanga), Pietermaritzburg
- **Gauteng**: Johannesburg (Sandton)
- **Western Cape**: Cape Town (CBD)

Default location settings:
- Country: South Africa (ZA)
- Province: KwaZulu-Natal (KZN)
- City: Durban
- Timezone: Africa/Johannesburg
- Currency: ZAR (South African Rand)
- VAT Rate: 15%

## Pricing Structure

All pricing in ZAR (South African Rand):

| Bot Type | Monthly | Quarterly | Annual | Setup Fee |
|----------|---------|-----------|--------|-----------|
| Mow Bot | R899 | R2,550 | R9,600 | R500 |
| Weather Station | R299 | R850 | R3,200 | R200 |
| Pool Bot | R799 | R2,250 | R8,500 | R400 |
| Security Bot | R1,299 | R3,700 | R14,000 | R800 |

*Premium areas (e.g., Umhlanga) have higher rates*

## Payment Integration (Paystack)

The `payments` table supports Paystack integration with fields for:
- `paystack_reference` - Unique transaction reference from Paystack
- `paystack_authorization_code` - Authorization code for recurring charges
- `paystack_transaction_id` - Transaction ID from Paystack
- `paystack_customer_code` - Customer code for user
- `paystack_response` - Full response JSON from Paystack API

The `payment_authorizations` table stores saved cards:
- Card details (last4, exp_month, exp_year, card_type, bank)
- Authorization codes for charging
- Default payment method flag
- Soft delete support (users can remove cards)

## Next Steps

1. ✅ Create initial schema (complete)
2. ✅ Add coverage areas, pricing, payments (complete)
3. ✅ Paystack payment integration (complete)
4. ✅ Service fees from database (complete)
5. ⬜ Add Row Level Security (RLS) policies
6. ⬜ Add database functions for common operations
7. ⬜ Set up real-time subscriptions
8. ⬜ Add storage buckets for images and documents
9. ⬜ Create database views for complex queries

## Resources

- [Supabase CLI Documentation](https://supabase.com/docs/guides/cli)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Supabase Database Guide](https://supabase.com/docs/guides/database)

