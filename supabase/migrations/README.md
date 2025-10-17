# BotKorp Database Migrations

This directory contains the complete database schema organized into 17 clean, logical migration files.

## Migration Structure

All migrations are timestamped: `20251017134600` (October 17, 2025 at 13:46:00)

### 00 - Drop Everything
**`20251017134600_drop_everything.sql`**
- Drops all existing tables, functions, triggers, and cron jobs
- Provides a clean slate for fresh deployments
- **WARNING**: Only run this on fresh databases or when resetting

### 01 - Enable Extensions
**`20251017134601_enable_extensions.sql`**
- PostgreSQL extensions: `uuid-ossp`, `postgis`, `pg_cron`
- Required for UUID generation, geographic data, and automated billing

### 02 - Core Tables
**`20251017134602_core_tables.sql`**
- `profiles` - User accounts with legal information for contracts
- `organizations` - Companies/organizations owning bots
- `locations` - Physical locations where bots are deployed

### 03 - Auth Triggers
**`20251017134603_auth_triggers.sql`**
- Auto-creates profile, organization, and membership on user signup
- Users automatically become owners of their own organization
- Handles slug generation and duplicate prevention

### 04 - Bots and Operations
**`20251017134604_bots_and_operations.sql`**
- `bots` - Individual bot instances (mow, weather, pool, security)
- `bot_commands` - Commands sent to bots
- `bot_telemetry` - Sensor data and telemetry
- `bot_schedules` - Automated schedules
- `bot_alerts` - Alerts and notifications

### 05 - Gardens and Pools
**`20251017134605_gardens_and_pools.sql`**
- `gardens` - Individual gardens/lawns with measurements
- `pools` - Individual pools with water quality targets
- `bot_garden_assignments` - Many-to-many bot-garden assignments
- `bot_pool_assignments` - Many-to-many bot-pool assignments
- `mowing_sessions` - Individual mowing session tracking
- `pool_cleaning_sessions` - Individual pool cleaning tracking
- **Pause/Resume functionality** for winter or temporary service suspension

### 06 - Coverage and Pricing
**`20251017134606_coverage_and_pricing.sql`**
- `coverage_areas` - Geographic service areas (KZN, Gauteng, etc.) with PostGIS geometry
- `is_point_in_coverage()` - Function to check if a location is in service area
- `get_coverage_areas_near()` - Function to find nearby coverage areas
- Automatic GeoJSON to Geometry sync trigger
- `pricing_structure` - Bot rental + service fee pricing
- `service_tier_pricing` - Pre-calculated pricing tiers

### 07 - Payment System
**`20251017134607_payment_system.sql`**
- `payments` - Payment transactions with Paystack integration
- `payment_authorizations` - Stored card authorizations for recurring payments
- `payment_transaction_logs` - Detailed payment attempt logs
- `deposits` - R500 deposit tracking per bot

### 08 - Rental Agreements
**`20251017134608_rental_agreements.sql`**
- `rental_agreements` - Flexible agreements (no long-term contracts)
- Pause/cancel anytime, winter pause support
- Custom billing dates (1-28 of month)
- Digital signature tracking

### 09 - Invoices
**`20251017134609_invoices.sql`**
- `invoices` - Monthly invoices for bot rental and service visits
- Line item breakdown
- Invoice branding with company details:
  - **Company:** Exolution Technologies (Pty) Ltd
  - **Trading As:** BotKorp
  - **Address:** MAP HOUSE, Umbilo, Durban, 4061
  - **Registration:** 2024/567890/07
  - **VAT:** 4123456789
- PDF generation support (see INVOICE_PDF_SETUP.md)

### 10 - Billing Automation
**`20251017134610_billing_automation.sql`**
- `payment_attempts` - Track payment collection attempts with retry logic
- `billing_notifications` - Email notification queue via Resend

### 11 - Service Records
**`20251017134611_service_records.sql`**
- `service_records` - Complete maintenance and service history
- Tracks costs, parts replaced, technician info
- Service photos and documentation

### 12 - Members and Activity
**`20251017134612_members_and_activity.sql`**
- `organization_members` - Team members with roles and permissions
- `activity_logs` - Audit trail for all system activities

### 13 - Functions and Triggers
**`20251017134613_functions_and_triggers.sql`**
- All database functions (legal profile, pricing, agreements, invoices, etc.)
- All triggers for `updated_at` timestamps
- Automated billing functions (invoice generation, payment collection, retries)

### 14 - Cron Jobs
**`20251017134614_cron_jobs.sql`**
- Cron job logging table
- 4 scheduled jobs:
  - Generate invoices (26th @ 2am)
  - Collect payments (1st @ 3am)
  - Retry failures (daily @ 4am)
  - Pause failed subscriptions (daily @ 5am)

### 15 - RLS Policies
**`20251017134615_rls_policies.sql`**
- Row Level Security policies for payment system
- Users can only view/manage their own data

### 16 - Seed Data
**`20251017134616_seed_data.sql`**
- Default pricing structure (4 bot types)
- Service tier pricing (13 tiers)
- Coverage areas (5 locations in South Africa)

### 17 - Disable RLS (Development Only)
**`20251017134617_disable_rls.sql`**
- Disables Row Level Security on all tables
- Drops all security policies
- ⚠️ **WARNING:** For development/testing only!
- Remove this migration for production deployments

## Key Features

### 🔐 Security
- ⚠️ **RLS Currently Disabled for Development** (Migration 17)
- Row Level Security available but disabled for easier development
- User isolation at organization level (ready for production)
- Audit logging for all activities
- **For Production:** Remove migration 17 and configure RLS policies

### 💰 Flexible Pricing
- Separate bot rental + service fees
- Pre-calculated tiers for common configurations
- Custom billing dates (1-28 of month)
- Prorated charges for partial months

### 📅 Automated Billing
- Auto-generate invoices 5 days before billing
- Auto-collect payments on billing date
- 3-day retry logic for failed payments
- Auto-pause service after final failure
- Email notifications via Resend

### 🤖 Bot Management
- Multiple bot types: mow, weather, pool, security
- Telemetry and command tracking
- Automated schedules with cron expressions
- Many-to-many assignments (1 bot → many gardens)

### 🏡 Service Management
- Winter pause/resume for gardens and pools
- Service visit tracking and scheduling
- Detailed session analytics
- Maintenance history

### 💳 Payment Processing
- Paystack integration for South African payments
- Stored card authorizations for recurring billing
- R500 refundable deposit per bot
- Detailed transaction logging

### 📄 Legal & Compliance
- Digital signature capture
- SA ID number validation (13 digits)
- Legal profile information for contracts
- Invoice branding with company details

## Running Migrations

```bash
# Fresh database (includes drop everything)
supabase db reset

# Apply migrations only (without dropping)
supabase db push

# Generate TypeScript types
supabase gen types typescript --local > src/types/database.types.ts
```

## ⚠️ Development vs Production

### Current Setup (Development)
- Migration 17 **disables RLS** on all tables
- No security policies enforced
- Easy database access for development

### For Production Deployment
1. **Remove migration 17:** `rm supabase/migrations/20251017000017_disable_rls.sql`
2. **Keep RLS enabled** (tables already have RLS enabled in earlier migrations)
3. **Configure proper policies** in migration 15 (`20251017000015_rls_policies.sql`)
4. **Add organization-level policies** for proper multi-tenancy

## Database Functions

### Pricing
- `calculate_monthly_cost(bot_type, num_bots, services_per_month)`
- `get_tier_pricing(bot_type, num_bots, services_per_month)`

### Rental Agreements
- `create_rental_agreement(...)`
- `pause_rental_agreement(agreement_id, reason)`
- `resume_rental_agreement(agreement_id)`
- `cancel_rental_agreement(agreement_id, reason)`

### Invoices
- `create_monthly_invoice(agreement_id, period_start, period_end, ...)`
- `mark_invoice_paid(invoice_id, amount, payment_method, reference)`
- `get_user_invoices(user_id, limit, offset)`

### Services
- `pause_garden_service(garden_id, user_id, reason)`
- `resume_garden_service(garden_id, user_id)`
- `pause_pool_service(pool_id, user_id, reason)`
- `resume_pool_service(pool_id, user_id)`

### Deposits
- `create_bot_deposit(bot_id, organization_id, amount)`

### Automated Billing (postgres only)
- `auto_generate_monthly_invoices()` - Run by cron
- `auto_collect_payments()` - Run by cron
- `retry_failed_payments()` - Run by cron
- `pause_failed_subscriptions()` - Run by cron

## Edge Functions

These functions need to be deployed separately:

```bash
supabase functions deploy charge-payment
supabase functions deploy send-billing-email
```

Required secrets:
```bash
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_xxx
supabase secrets set RESEND_API_KEY=re_xxx
```

## Testing

```sql
-- Test pricing calculation
SELECT get_tier_pricing('mow_bot', 2, 1);  -- Should return R500/month

-- Test invoice generation (manual)
SELECT auto_generate_monthly_invoices();

-- View cron job logs
SELECT * FROM cron_job_logs ORDER BY started_at DESC LIMIT 10;
```

## Notes

- All timestamps use `Africa/Johannesburg` timezone
- Currency is `ZAR` (South African Rand)
- VAT rate is 15% (South African standard)
- Billing days are 1-28 to avoid month-end issues
- Deposits are R500 per bot (refundable)

## Old Migrations

The previous 28 migration files have been consolidated into these 17 organized files. The old files are preserved in `migrations_old/` for reference.

