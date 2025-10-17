-- =====================================================
-- Add HTTP triggers to cron jobs for Edge Functions
-- Calls charge-payment and send-billing-email functions
-- =====================================================

-- Enable http extension for making HTTP requests
CREATE EXTENSION IF NOT EXISTS http;

-- Update auto_collect_payments to call charge-payment edge function
CREATE OR REPLACE FUNCTION auto_collect_payments()
RETURNS JSON AS $$
DECLARE
    v_result JSON;
    v_http_response http_response;
    v_supabase_url TEXT;
    v_service_role_key TEXT;
BEGIN
    -- Get Supabase URL and service role key from secrets
    v_supabase_url := current_setting('app.supabase_url', true);
    v_service_role_key := current_setting('app.supabase_service_role_key', true);
    
    -- First, create payment attempts (same as before)
    SELECT auto_collect_payments_internal() INTO v_result;
    
    -- Then trigger the edge function to actually charge them
    IF v_supabase_url IS NOT NULL AND v_service_role_key IS NOT NULL THEN
        SELECT * INTO v_http_response FROM http((
            'POST',
            v_supabase_url || '/functions/v1/charge-payment',
            ARRAY[http_header('Authorization', 'Bearer ' || v_service_role_key)],
            'application/json',
            '{}'
        )::http_request);
        
        RAISE NOTICE 'Charge payment function response: % %', v_http_response.status, v_http_response.content;
    END IF;
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Rename old function
ALTER FUNCTION auto_collect_payments() RENAME TO auto_collect_payments_internal;

-- Create new wrapper that calls edge function
CREATE OR REPLACE FUNCTION auto_collect_payments()
RETURNS JSON AS $$
DECLARE
    v_result JSON;
BEGIN
    -- Create payment attempts
    SELECT auto_collect_payments_internal() INTO v_result;
    
    -- Trigger edge function via pg_net (non-blocking)
    -- Note: pg_net must be enabled: CREATE EXTENSION pg_net;
    PERFORM net.http_post(
        url := current_setting('app.supabase_url', true) || '/functions/v1/charge-payment',
        headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key', true)),
        body := '{}'::jsonb
    );
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to send pending billing emails
CREATE OR REPLACE FUNCTION send_pending_billing_emails()
RETURNS JSON AS $$
DECLARE
    v_result JSON;
BEGIN
    -- Trigger edge function to send emails
    PERFORM net.http_post(
        url := current_setting('app.supabase_url', true) || '/functions/v1/send-billing-email',
        headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key', true)),
        body := '{}'::jsonb
    );
    
    RETURN json_build_object(
        'success', true,
        'message', 'Email sending triggered',
        'timestamp', NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update cron job to include email sending
SELECT cron.schedule(
    'send-billing-emails',
    '*/15 * * * *', -- Every 15 minutes
    $$SELECT send_pending_billing_emails()$$
);

-- Add detailed logging table
CREATE TABLE IF NOT EXISTS cron_job_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_name TEXT NOT NULL,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status TEXT CHECK (status IN ('running', 'success', 'failed')),
    result JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cron_job_logs_job_name ON cron_job_logs(job_name, started_at DESC);

-- Wrap cron functions with logging
CREATE OR REPLACE FUNCTION auto_generate_monthly_invoices_logged()
RETURNS JSON AS $$
DECLARE
    v_log_id UUID;
    v_result JSON;
    v_error TEXT;
BEGIN
    INSERT INTO cron_job_logs (job_name, status) 
    VALUES ('generate-monthly-invoices', 'running')
    RETURNING id INTO v_log_id;
    
    BEGIN
        SELECT auto_generate_monthly_invoices() INTO v_result;
        
        UPDATE cron_job_logs
        SET 
            status = 'success',
            result = v_result,
            completed_at = NOW()
        WHERE id = v_log_id;
        
        RETURN v_result;
    EXCEPTION
        WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
            
            UPDATE cron_job_logs
            SET 
                status = 'failed',
                error_message = v_error,
                completed_at = NOW()
            WHERE id = v_log_id;
            
            RAISE;
    END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update cron schedules to use logged versions
SELECT cron.unschedule('generate-monthly-invoices');
SELECT cron.schedule(
    'generate-monthly-invoices',
    '0 2 26 * *',
    $$SELECT auto_generate_monthly_invoices_logged()$$
);

-- Grant permissions
GRANT EXECUTE ON FUNCTION send_pending_billing_emails TO postgres;

-- Comments
COMMENT ON FUNCTION send_pending_billing_emails IS 'Triggers send-billing-email edge function to process notification queue';
COMMENT ON TABLE cron_job_logs IS 'Logs all cron job executions with results and errors';

-- Success message
DO $$
BEGIN
    RAISE NOTICE '=== CRON HTTP TRIGGERS CONFIGURED ===';
    RAISE NOTICE 'Edge Functions:';
    RAISE NOTICE '  - charge-payment: Charges Paystack authorizations';
    RAISE NOTICE '  - send-billing-email: Sends emails via Resend';
    RAISE NOTICE '';
    RAISE NOTICE 'New Cron Job:';
    RAISE NOTICE '  - Send emails: Every 15 minutes';
    RAISE NOTICE '';
    RAISE NOTICE 'Setup Required:';
    RAISE NOTICE '  1. Deploy edge functions: supabase functions deploy charge-payment';
    RAISE NOTICE '  2. Deploy edge functions: supabase functions deploy send-billing-email';
    RAISE NOTICE '  3. Set secrets: supabase secrets set PAYSTACK_SECRET_KEY=...';
    RAISE NOTICE '  4. Set secrets: supabase secrets set RESEND_API_KEY=...';
    RAISE NOTICE '  5. Set pg settings: ALTER DATABASE postgres SET app.supabase_url = ''...''';
    RAISE NOTICE '  6. Set pg settings: ALTER DATABASE postgres SET app.supabase_service_role_key = ''...''';
END $$;

