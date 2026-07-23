-- =====================================================
-- Cron Jobs for Automated Billing
-- =====================================================

-- =====================================================
-- CRON JOB LOGGING TABLE
-- =====================================================

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

CREATE INDEX IF NOT EXISTS idx_cron_job_logs_job_name ON cron_job_logs(job_name, started_at DESC);

COMMENT ON TABLE cron_job_logs IS 'Logs all cron job executions with results and errors';

-- =====================================================
-- SCHEDULE CRON JOBS
-- =====================================================

-- Schedule cron jobs
-- Note: These use postgres timezone, adjust as needed for Africa/Johannesburg

-- 1. Generate invoices on 26th of each month at 2am
SELECT cron.schedule(
    'generate-monthly-invoices',
    '0 2 26 * *', -- 2am on 26th of every month
    $$SELECT auto_generate_monthly_invoices()$$
);

-- 2. Collect payments on 1st of each month at 3am
SELECT cron.schedule(
    'collect-monthly-payments',
    '0 3 1 * *', -- 3am on 1st of every month
    $$SELECT auto_collect_payments()$$
);

-- 3. Retry failed payments daily at 4am
SELECT cron.schedule(
    'retry-failed-payments',
    '0 4 * * *', -- 4am every day
    $$SELECT retry_failed_payments()$$
);

-- 4. Pause failed subscriptions daily at 5am (after retries)
SELECT cron.schedule(
    'pause-failed-subscriptions',
    '0 5 * * *', -- 5am every day
    $$SELECT pause_failed_subscriptions()$$
);

-- Success message
DO $$
BEGIN
    RAISE NOTICE '=== AUTOMATED BILLING CRON JOBS SCHEDULED ===';
    RAISE NOTICE 'Cron Jobs Scheduled:';
    RAISE NOTICE '  1. Generate invoices: 26th of month @ 2am';
    RAISE NOTICE '  2. Collect payments: 1st of month @ 3am';
    RAISE NOTICE '  3. Retry failures: Daily @ 4am';
    RAISE NOTICE '  4. Pause services: Daily @ 5am';
    RAISE NOTICE '';
    RAISE NOTICE 'Next Steps:';
    RAISE NOTICE '  - Create Supabase Edge Function: charge-payment';
    RAISE NOTICE '  - Create Supabase Edge Function: send-billing-email';
    RAISE NOTICE '  - Configure Resend API key';
    RAISE NOTICE '  - Test with: SELECT auto_generate_monthly_invoices();';
END $$;

