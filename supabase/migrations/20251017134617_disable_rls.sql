-- =====================================================
-- Disable Row Level Security (RLS) for Development
-- =====================================================
-- WARNING: This disables all security policies!
-- Use this for development/testing only.
-- For production, remove this migration and configure proper RLS policies.
-- =====================================================

-- Disable RLS on core tables
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE organizations DISABLE ROW LEVEL SECURITY;
ALTER TABLE locations DISABLE ROW LEVEL SECURITY;

-- Disable RLS on bot tables
ALTER TABLE bots DISABLE ROW LEVEL SECURITY;
ALTER TABLE bot_commands DISABLE ROW LEVEL SECURITY;
ALTER TABLE bot_telemetry DISABLE ROW LEVEL SECURITY;
ALTER TABLE bot_schedules DISABLE ROW LEVEL SECURITY;
ALTER TABLE bot_alerts DISABLE ROW LEVEL SECURITY;

-- Disable RLS on gardens and pools
ALTER TABLE gardens DISABLE ROW LEVEL SECURITY;
ALTER TABLE pools DISABLE ROW LEVEL SECURITY;
ALTER TABLE bot_garden_assignments DISABLE ROW LEVEL SECURITY;
ALTER TABLE bot_pool_assignments DISABLE ROW LEVEL SECURITY;
ALTER TABLE mowing_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE pool_cleaning_sessions DISABLE ROW LEVEL SECURITY;

-- Disable RLS on coverage and pricing
ALTER TABLE coverage_areas DISABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_structure DISABLE ROW LEVEL SECURITY;
ALTER TABLE service_tier_pricing DISABLE ROW LEVEL SECURITY;

-- Disable RLS on payment system
ALTER TABLE payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE payment_authorizations DISABLE ROW LEVEL SECURITY;
ALTER TABLE payment_transaction_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE deposits DISABLE ROW LEVEL SECURITY;

-- Disable RLS on rental and billing
ALTER TABLE rental_agreements DISABLE ROW LEVEL SECURITY;
ALTER TABLE invoices DISABLE ROW LEVEL SECURITY;
ALTER TABLE payment_attempts DISABLE ROW LEVEL SECURITY;
ALTER TABLE billing_notifications DISABLE ROW LEVEL SECURITY;

-- Disable RLS on service records
ALTER TABLE service_records DISABLE ROW LEVEL SECURITY;

-- Disable RLS on organization members and activity
ALTER TABLE organization_members DISABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs DISABLE ROW LEVEL SECURITY;

-- Drop all existing policies (they're ineffective with RLS disabled anyway)
DROP POLICY IF EXISTS "Users can view own authorizations" ON payment_authorizations;
DROP POLICY IF EXISTS "Users can delete own authorizations" ON payment_authorizations;
DROP POLICY IF EXISTS "Users can view own transaction logs" ON payment_transaction_logs;

-- Success message
DO $$
BEGIN
    RAISE NOTICE '=== ROW LEVEL SECURITY DISABLED ON ALL TABLES ===';
    RAISE NOTICE 'WARNING: All security policies are now disabled!';
    RAISE NOTICE 'This is suitable for development only.';
    RAISE NOTICE '';
    RAISE NOTICE 'For production:';
    RAISE NOTICE '  1. Remove this migration file';
    RAISE NOTICE '  2. Configure proper RLS policies in migration 15';
    RAISE NOTICE '  3. Enable RLS on all tables';
END $$;

