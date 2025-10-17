-- =====================================================
-- Automated Billing System with pg_cron
-- Invoice generation, payment collection, retry logic
-- =====================================================

-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create payment attempts tracking table
CREATE TABLE IF NOT EXISTS payment_attempts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- References
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    rental_agreement_id UUID REFERENCES rental_agreements(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Payment details
    authorization_code TEXT, -- Paystack authorization code
    amount DECIMAL(10, 2) NOT NULL,
    
    -- Attempt info
    attempt_number INTEGER NOT NULL DEFAULT 1,
    attempted_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Result
    status TEXT NOT NULL CHECK (status IN ('pending', 'success', 'failed', 'retry')),
    paystack_reference TEXT,
    paystack_response JSONB,
    error_message TEXT,
    
    -- Next retry
    next_retry_at TIMESTAMPTZ,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_payment_attempts_invoice ON payment_attempts(invoice_id);
CREATE INDEX idx_payment_attempts_user ON payment_attempts(user_id);
CREATE INDEX idx_payment_attempts_status ON payment_attempts(status);
CREATE INDEX idx_payment_attempts_next_retry ON payment_attempts(next_retry_at) WHERE next_retry_at IS NOT NULL;

-- Create billing notifications table
CREATE TABLE IF NOT EXISTS billing_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- References
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    payment_attempt_id UUID REFERENCES payment_attempts(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Notification details
    notification_type TEXT NOT NULL CHECK (notification_type IN (
        'invoice_generated',
        'payment_success',
        'payment_failed',
        'payment_retry',
        'subscription_paused',
        'payment_overdue'
    )),
    
    -- Recipients (JSON array of email addresses)
    recipients JSONB NOT NULL DEFAULT '[]',
    
    -- Email details
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    html_body TEXT,
    
    -- Sending status
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
    sent_at TIMESTAMPTZ,
    error_message TEXT,
    
    -- Resend details
    resend_email_id TEXT,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_billing_notifications_invoice ON billing_notifications(invoice_id);
CREATE INDEX idx_billing_notifications_user ON billing_notifications(user_id);
CREATE INDEX idx_billing_notifications_status ON billing_notifications(status);
CREATE INDEX idx_billing_notifications_type ON billing_notifications(notification_type);

-- Function to generate invoices automatically (run on 26th of each month)
CREATE OR REPLACE FUNCTION auto_generate_monthly_invoices()
RETURNS JSON AS $$
DECLARE
    v_agreement RECORD;
    v_result JSON;
    v_count INTEGER := 0;
    v_errors INTEGER := 0;
    v_period_start DATE;
    v_period_end DATE;
BEGIN
    -- Calculate next month's period
    v_period_start := DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month');
    v_period_end := (DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month') + INTERVAL '1 month - 1 day')::DATE;
    
    -- Loop through all active rental agreements
    FOR v_agreement IN
        SELECT * FROM rental_agreements
        WHERE status = 'active'
        AND started_at IS NOT NULL
    LOOP
        BEGIN
            -- Create invoice for this agreement
            SELECT create_monthly_invoice(
                v_agreement.id,
                v_period_start,
                v_period_end,
                30, -- Full month
                v_agreement.services_per_month
            ) INTO v_result;
            
            IF (v_result->>'success')::BOOLEAN = true THEN
                v_count := v_count + 1;
                
                -- Create notification
                INSERT INTO billing_notifications (
                    invoice_id,
                    user_id,
                    organization_id,
                    notification_type,
                    recipients,
                    subject,
                    body
                )
                SELECT 
                    (v_result->>'invoice_id')::UUID,
                    v_agreement.user_id,
                    v_agreement.organization_id,
                    'invoice_generated',
                    jsonb_build_array(v_agreement.signer_email),
                    'Your Bot Korp Invoice for ' || TO_CHAR(v_period_start, 'Month YYYY'),
                    'Your invoice ' || (v_result->>'invoice_number') || ' for R' || (v_result->>'total_amount') || ' is ready. Payment will be collected on ' || TO_CHAR(v_period_start, 'YYYY-MM-DD') || '.'
                ;
            ELSE
                v_errors := v_errors + 1;
            END IF;
        EXCEPTION
            WHEN OTHERS THEN
                v_errors := v_errors + 1;
                RAISE NOTICE 'Error generating invoice for agreement %: %', v_agreement.id, SQLERRM;
        END;
    END LOOP;
    
    RETURN json_build_object(
        'success', true,
        'generated', v_count,
        'errors', v_errors,
        'period_start', v_period_start,
        'period_end', v_period_end,
        'timestamp', NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to collect payments automatically (run on 1st of each month)
CREATE OR REPLACE FUNCTION auto_collect_payments()
RETURNS JSON AS $$
DECLARE
    v_invoice RECORD;
    v_authorization RECORD;
    v_attempt_id UUID;
    v_count INTEGER := 0;
    v_errors INTEGER := 0;
BEGIN
    -- Get all unpaid invoices that are due
    FOR v_invoice IN
        SELECT i.*
        FROM invoices i
        WHERE i.status = 'sent'
        AND i.amount_due > 0
        AND i.due_date <= CURRENT_DATE
        ORDER BY i.due_date ASC
    LOOP
        BEGIN
            -- Get default payment authorization for this user
            SELECT * INTO v_authorization
            FROM payment_authorizations
            WHERE user_id = v_invoice.user_id
            AND is_default = true
            AND is_active = true
            LIMIT 1;
            
            IF v_authorization IS NOT NULL THEN
                -- Create payment attempt
                INSERT INTO payment_attempts (
                    invoice_id,
                    rental_agreement_id,
                    user_id,
                    organization_id,
                    authorization_code,
                    amount,
                    attempt_number,
                    status,
                    next_retry_at
                )
                VALUES (
                    v_invoice.id,
                    v_invoice.rental_agreement_id,
                    v_invoice.user_id,
                    v_invoice.organization_id,
                    v_authorization.authorization_code,
                    v_invoice.amount_due,
                    1,
                    'pending',
                    CURRENT_TIMESTAMP + INTERVAL '1 day' -- Retry tomorrow if fails
                )
                RETURNING id INTO v_attempt_id;
                
                v_count := v_count + 1;
                
                RAISE NOTICE 'Created payment attempt % for invoice %', v_attempt_id, v_invoice.invoice_number;
            ELSE
                -- No payment method, mark invoice as overdue and notify
                UPDATE invoices
                SET status = 'overdue'
                WHERE id = v_invoice.id;
                
                INSERT INTO billing_notifications (
                    invoice_id,
                    user_id,
                    organization_id,
                    notification_type,
                    recipients,
                    subject,
                    body
                )
                VALUES (
                    v_invoice.id,
                    v_invoice.user_id,
                    v_invoice.organization_id,
                    'payment_failed',
                    jsonb_build_array(v_invoice.billing_email),
                    'Payment Method Required - Invoice ' || v_invoice.invoice_number,
                    'We couldn''t collect payment for invoice ' || v_invoice.invoice_number || ' because no payment method is on file. Please add a payment method to avoid service interruption.'
                );
            END IF;
        EXCEPTION
            WHEN OTHERS THEN
                v_errors := v_errors + 1;
                RAISE NOTICE 'Error creating payment attempt for invoice %: %', v_invoice.invoice_number, SQLERRM;
        END;
    END LOOP;
    
    RETURN json_build_object(
        'success', true,
        'attempts_created', v_count,
        'errors', v_errors,
        'timestamp', NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to retry failed payments (run daily)
CREATE OR REPLACE FUNCTION retry_failed_payments()
RETURNS JSON AS $$
DECLARE
    v_attempt RECORD;
    v_count INTEGER := 0;
    v_paused INTEGER := 0;
BEGIN
    -- Get payment attempts that need retry
    FOR v_attempt IN
        SELECT pa.*
        FROM payment_attempts pa
        WHERE pa.status IN ('failed', 'retry')
        AND pa.next_retry_at <= NOW()
        AND pa.retry_count < pa.max_retries
        ORDER BY pa.next_retry_at ASC
    LOOP
        -- Update attempt for new retry
        UPDATE payment_attempts
        SET 
            status = 'pending',
            retry_count = retry_count + 1,
            attempt_number = attempt_number + 1,
            next_retry_at = CASE 
                WHEN retry_count + 1 >= max_retries THEN NULL
                ELSE CURRENT_TIMESTAMP + INTERVAL '1 day'
            END,
            updated_at = NOW()
        WHERE id = v_attempt.id;
        
        v_count := v_count + 1;
        
        -- Create retry notification
        INSERT INTO billing_notifications (
            invoice_id,
            payment_attempt_id,
            user_id,
            organization_id,
            notification_type,
            recipients,
            subject,
            body
        )
        SELECT 
            v_attempt.invoice_id,
            v_attempt.id,
            v_attempt.user_id,
            v_attempt.organization_id,
            'payment_retry',
            jsonb_build_array(i.billing_email),
            'Payment Retry Attempt ' || (v_attempt.retry_count + 1) || ' - Invoice ' || i.invoice_number,
            'We''re retrying payment for invoice ' || i.invoice_number || '. This is attempt ' || (v_attempt.retry_count + 1) || ' of ' || v_attempt.max_retries || '.'
        FROM invoices i
        WHERE i.id = v_attempt.invoice_id;
        
        -- If this is the last retry and it fails, pause subscription
        IF v_attempt.retry_count + 1 >= v_attempt.max_retries THEN
            -- Mark for pausing after final attempt
            -- (actual pausing will happen in another cron job after verifying failure)
        END IF;
    END LOOP;
    
    RETURN json_build_object(
        'success', true,
        'retries_scheduled', v_count,
        'subscriptions_paused', v_paused,
        'timestamp', NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to pause subscriptions after final payment failure
CREATE OR REPLACE FUNCTION pause_failed_subscriptions()
RETURNS JSON AS $$
DECLARE
    v_attempt RECORD;
    v_count INTEGER := 0;
    v_org_members JSONB;
BEGIN
    -- Get payment attempts that exhausted retries and still failed
    FOR v_attempt IN
        SELECT pa.*, i.invoice_number
        FROM payment_attempts pa
        JOIN invoices i ON i.id = pa.invoice_id
        WHERE pa.status = 'failed'
        AND pa.retry_count >= pa.max_retries
        AND pa.rental_agreement_id IS NOT NULL
    LOOP
        -- Pause the rental agreement
        PERFORM pause_rental_agreement(
            v_attempt.rental_agreement_id,
            'Payment failed after ' || v_attempt.max_retries || ' attempts'
        );
        
        -- Get all organization members' emails
        SELECT jsonb_agg(p.email) INTO v_org_members
        FROM organization_members om
        JOIN profiles p ON p.id = om.user_id
        WHERE om.organization_id = v_attempt.organization_id
        AND om.status = 'active';
        
        -- Create notification to ALL members
        INSERT INTO billing_notifications (
            invoice_id,
            payment_attempt_id,
            user_id,
            organization_id,
            notification_type,
            recipients,
            subject,
            body
        )
        VALUES (
            v_attempt.invoice_id,
            v_attempt.id,
            v_attempt.user_id,
            v_attempt.organization_id,
            'subscription_paused',
            COALESCE(v_org_members, '[]'::jsonb),
            'Service Paused - Payment Failed for Invoice ' || v_attempt.invoice_number,
            'We''ve paused your Bot Korp service due to failed payment for invoice ' || v_attempt.invoice_number || '. We attempted to collect payment ' || v_attempt.max_retries || ' times without success. Please update your payment method and contact us to resume service.'
        );
        
        v_count := v_count + 1;
    END LOOP;
    
    RETURN json_build_object(
        'success', true,
        'subscriptions_paused', v_count,
        'timestamp', NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION auto_generate_monthly_invoices TO postgres;
GRANT EXECUTE ON FUNCTION auto_collect_payments TO postgres;
GRANT EXECUTE ON FUNCTION retry_failed_payments TO postgres;
GRANT EXECUTE ON FUNCTION pause_failed_subscriptions TO postgres;

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

-- Add comments
COMMENT ON TABLE payment_attempts IS 'Track all payment collection attempts with retry logic';
COMMENT ON TABLE billing_notifications IS 'Queue for billing-related email notifications via Resend';

COMMENT ON FUNCTION auto_generate_monthly_invoices IS 'Cron job: Generate invoices 5 days before billing date (26th of month)';
COMMENT ON FUNCTION auto_collect_payments IS 'Cron job: Collect payments on 1st of month via Supabase Edge Function';
COMMENT ON FUNCTION retry_failed_payments IS 'Cron job: Retry failed payments daily for up to 3 days';
COMMENT ON FUNCTION pause_failed_subscriptions IS 'Cron job: Pause subscriptions after final payment failure';

-- Create trigger to update updated_at
CREATE TRIGGER update_payment_attempts_updated_at
BEFORE UPDATE ON payment_attempts
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_billing_notifications_updated_at
BEFORE UPDATE ON billing_notifications
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

-- Success message
DO $$
BEGIN
    RAISE NOTICE '=== AUTOMATED BILLING SYSTEM CREATED ===';
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

