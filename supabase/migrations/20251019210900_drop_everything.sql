-- =====================================================
-- DROP EVERYTHING - Clean Slate Migration
-- This migration drops all existing tables, functions, 
-- triggers, and policies to start fresh
-- =====================================================

-- Disable triggers temporarily
SET session_replication_role = replica;

-- Drop all cron jobs (only if extension exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.unschedule(jobname) 
        FROM cron.job 
        WHERE jobname IN (
            'generate-monthly-invoices',
            'collect-monthly-payments',
            'retry-failed-payments',
            'pause-failed-subscriptions'
        );
    END IF;
END $$;

-- Drop all policies (wrapped in DO block to handle non-existent tables)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'payment_authorizations') THEN
        DROP POLICY IF EXISTS "Users can view own authorizations" ON payment_authorizations;
        DROP POLICY IF EXISTS "Users can delete own authorizations" ON payment_authorizations;
    END IF;
    
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'payment_transaction_logs') THEN
        DROP POLICY IF EXISTS "Users can view own transaction logs" ON payment_transaction_logs;
    END IF;
END $$;

-- Drop all views
DROP VIEW IF EXISTS profile_legal_info CASCADE;

-- Drop all tables (in reverse dependency order)
DROP TABLE IF EXISTS billing_notifications CASCADE;
DROP TABLE IF EXISTS payment_attempts CASCADE;
DROP TABLE IF EXISTS payment_transaction_logs CASCADE;
DROP TABLE IF EXISTS payment_authorizations CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS rental_agreements CASCADE;
DROP TABLE IF EXISTS service_tier_pricing CASCADE;  -- Old table, being removed
DROP TABLE IF EXISTS pricing_structure CASCADE;
DROP TABLE IF EXISTS activity_logs CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS organization_members CASCADE;
DROP TABLE IF EXISTS service_fees CASCADE;
DROP TABLE IF EXISTS bot_pricing CASCADE;
DROP TABLE IF EXISTS coverage_areas CASCADE;
DROP TABLE IF EXISTS pool_cleaning_sessions CASCADE;
DROP TABLE IF EXISTS mowing_sessions CASCADE;
DROP TABLE IF EXISTS service_records CASCADE;
DROP TABLE IF EXISTS bot_alerts CASCADE;
DROP TABLE IF EXISTS bot_schedules CASCADE;
DROP TABLE IF EXISTS bot_telemetry CASCADE;
DROP TABLE IF EXISTS bot_commands CASCADE;
DROP TABLE IF EXISTS bot_pool_assignments CASCADE;
DROP TABLE IF EXISTS bot_garden_assignments CASCADE;
DROP TABLE IF EXISTS pools CASCADE;
DROP TABLE IF EXISTS gardens CASCADE;
DROP TABLE IF EXISTS bots CASCADE;
DROP TABLE IF EXISTS locations CASCADE;
DROP TABLE IF EXISTS organizations CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

-- Drop all functions
DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
DROP FUNCTION IF EXISTS update_updated_at CASCADE;
DROP FUNCTION IF EXISTS generate_invoice_number CASCADE;
DROP FUNCTION IF EXISTS create_monthly_invoice CASCADE;
DROP FUNCTION IF EXISTS mark_invoice_paid CASCADE;
DROP FUNCTION IF EXISTS get_user_invoices CASCADE;
DROP FUNCTION IF EXISTS generate_agreement_number CASCADE;
DROP FUNCTION IF EXISTS create_rental_agreement CASCADE;
DROP FUNCTION IF EXISTS pause_rental_agreement CASCADE;
DROP FUNCTION IF EXISTS resume_rental_agreement CASCADE;
DROP FUNCTION IF EXISTS cancel_rental_agreement CASCADE;
DROP FUNCTION IF EXISTS auto_generate_monthly_invoices CASCADE;
DROP FUNCTION IF EXISTS auto_collect_payments CASCADE;
DROP FUNCTION IF EXISTS retry_failed_payments CASCADE;
DROP FUNCTION IF EXISTS pause_failed_subscriptions CASCADE;
DROP FUNCTION IF EXISTS calculate_monthly_cost CASCADE;
DROP FUNCTION IF EXISTS get_tier_pricing CASCADE;
DROP FUNCTION IF EXISTS is_legal_profile_complete CASCADE;
DROP FUNCTION IF EXISTS update_legal_profile CASCADE;
DROP FUNCTION IF EXISTS update_full_name_trigger CASCADE;
DROP FUNCTION IF EXISTS delete_payment_authorization CASCADE;
DROP FUNCTION IF EXISTS set_default_authorization CASCADE;
DROP FUNCTION IF EXISTS get_user_authorizations CASCADE;
DROP FUNCTION IF EXISTS update_authorization_usage CASCADE;

-- Re-enable triggers
SET session_replication_role = DEFAULT;

-- Success message
DO $$
BEGIN
    RAISE NOTICE '=== ALL TABLES, FUNCTIONS, AND POLICIES DROPPED ===';
    RAISE NOTICE 'Database is now clean and ready for fresh schema';
END $$;

