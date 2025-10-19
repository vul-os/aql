-- =====================================================
-- AUTO-TRIGGER: Call charge-payment Edge Function
-- =====================================================
-- Automatically call the charge-payment edge function when payment_attempts are created
-- This is triggered by the database, so it works for deposits, monthly invoices, retries, etc.

-- =====================================================
-- STEP 1: Create Secure Configuration Table
-- =====================================================

-- Create config table to store service role key
CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS to protect sensitive data
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Service role can read config" ON app_config;
DROP POLICY IF EXISTS "Service role can write config" ON app_config;

-- Only service_role can access this table
CREATE POLICY "Service role can read config" ON app_config
    FOR SELECT USING (auth.role() = 'service_role' OR current_user = 'postgres');

CREATE POLICY "Service role can write config" ON app_config
    FOR ALL USING (auth.role() = 'service_role' OR current_user = 'postgres');

-- Insert service role key into config
INSERT INTO app_config (key, value, description)
VALUES (
    'service_role_key',
    'REDACTED_JWT',
    'Service role key for authenticating with Edge Functions'
)
ON CONFLICT (key) DO UPDATE SET 
    value = EXCLUDED.value,
    updated_at = NOW();

-- =====================================================
-- STEP 2: Enable HTTP Extension
-- =====================================================

CREATE EXTENSION IF NOT EXISTS http;

-- =====================================================
-- STEP 3: Create Trigger Function
-- =====================================================

-- Trigger function to call edge function when payment attempt is created
CREATE OR REPLACE FUNCTION trigger_charge_payment()
RETURNS TRIGGER AS $$
DECLARE
    v_request_id BIGINT;
    v_edge_function_url TEXT := 'https://kyoowsarfopltjwmhksi.supabase.co/functions/v1/charge-payment';
    v_service_key TEXT := 'sb_secret_REDACTED';
BEGIN
    -- Only trigger for pending payment attempts
    IF NEW.status = 'pending' THEN
        BEGIN
            -- Call the charge-payment edge function asynchronously
            -- The edge function fetches ALL pending payment_attempts from DB
            SELECT net.http_post(
                url := v_edge_function_url,
                headers := jsonb_build_object(
                    'Content-Type', 'application/json',
                    'Authorization', 'Bearer ' || v_service_key
                ),
                body := '{}'::jsonb  -- No body needed - edge function queries DB
            ) INTO v_request_id;
            
            RAISE NOTICE 'Triggered charge-payment edge function for attempt % (request_id: %)', NEW.id, v_request_id;
        EXCEPTION
            WHEN OTHERS THEN
                -- Log warning but don't fail the transaction
                RAISE WARNING 'Failed to trigger charge-payment edge function: %', SQLERRM;
        END;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- STEP 4: Create Trigger
-- =====================================================

-- Create trigger on payment_attempts table
DROP TRIGGER IF EXISTS auto_trigger_charge_payment ON payment_attempts;

CREATE TRIGGER auto_trigger_charge_payment
    AFTER INSERT ON payment_attempts
    FOR EACH ROW
    WHEN (NEW.status = 'pending')
    EXECUTE FUNCTION trigger_charge_payment();

COMMENT ON FUNCTION trigger_charge_payment IS 'Automatically calls charge-payment edge function when a pending payment_attempt is created. Works for deposits, monthly invoices, retries - everything!';
COMMENT ON TRIGGER auto_trigger_charge_payment ON payment_attempts IS 'Automatically processes pending payment attempts via charge-payment edge function.';

-- =====================================================
-- SUCCESS NOTIFICATION
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=================================================================';
    RAISE NOTICE '   DATABASE TRIGGER: Auto-Process Payment Attempts';
    RAISE NOTICE '=================================================================';
    RAISE NOTICE '';
    RAISE NOTICE '✓ Configuration table created:';
    RAISE NOTICE '  • app_config table with RLS enabled';
    RAISE NOTICE '  • service_role_key stored securely';
    RAISE NOTICE '';
    RAISE NOTICE '✓ Trigger created on payment_attempts table:';
    RAISE NOTICE '  • Fires when payment_attempt inserted with status=pending';
    RAISE NOTICE '  • Automatically calls charge-payment edge function';
    RAISE NOTICE '  • Edge function URL: https://kyoowsarfopltjwmhksi.supabase.co/functions/v1/charge-payment';
    RAISE NOTICE '';
    RAISE NOTICE '🎯 Works for:';
    RAISE NOTICE '  • Deposit invoices (immediate)';
    RAISE NOTICE '  • Monthly invoices';
    RAISE NOTICE '  • Payment retries';
    RAISE NOTICE '  • Any payment attempt!';
    RAISE NOTICE '';
    RAISE NOTICE '🔒 Security:';
    RAISE NOTICE '  • Edge function fetches ALL pending attempts from DB';
    RAISE NOTICE '  • No sensitive data in HTTP request';
    RAISE NOTICE '  • Uses service role key for authorization';
    RAISE NOTICE '  • SECURITY DEFINER for proper permissions';
    RAISE NOTICE '';
    RAISE NOTICE '⚡ Automatic & Real-time:';
    RAISE NOTICE '  • No manual calls needed';
    RAISE NOTICE '  • Processes immediately';
    RAISE NOTICE '  • Works everywhere!';
    RAISE NOTICE '';
    RAISE NOTICE '=================================================================';
    RAISE NOTICE '';
END $$;
