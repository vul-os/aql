-- =====================================================
-- TESTING: Scaled Billing (1 Day = 1 Month)
-- =====================================================
-- **REMOVE THIS FILE FOR PRODUCTION!**
-- 
-- This migration overrides billing functions to use scaled time for testing:
-- - 1 day = 1 month
-- - Invoices due immediately
-- - Retries every hour instead of daily
--
-- To disable: rm supabase/migrations/20251019240002_scaled_billing_testing.sql && supabase db reset

-- =====================================================
-- SCALED TIME CONFIGURATION
-- =====================================================

-- Create a settings table for scaled time
CREATE TABLE IF NOT EXISTS billing_test_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert scaled time settings
INSERT INTO billing_test_settings (key, value, description) VALUES
    ('time_scale_enabled', 'true', 'Enable scaled time for testing'),
    ('days_per_month', '1', '1 day = 1 month for testing'),
    ('hours_per_day', '1', '1 hour = 1 day for retry intervals')
ON CONFLICT (key) DO UPDATE 
    SET value = EXCLUDED.value,
        updated_at = NOW();

-- Helper function to check if scaled billing is enabled
CREATE OR REPLACE FUNCTION is_scaled_billing_enabled()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN (
        SELECT value::BOOLEAN 
        FROM billing_test_settings 
        WHERE key = 'time_scale_enabled'
    ) IS TRUE;
EXCEPTION
    WHEN OTHERS THEN
        RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE;

-- =====================================================
-- OVERRIDE: create_deposit_invoice (Immediate Due Date)
-- =====================================================

CREATE OR REPLACE FUNCTION create_deposit_invoice(
    p_rental_agreement_id UUID
)
RETURNS JSON AS $$
DECLARE
    v_invoice_id UUID;
    v_invoice_number TEXT;
    v_agreement RECORD;
    v_profile RECORD;
    v_setup_fee DECIMAL;
    v_setup_fee_per_bot DECIMAL;
    v_tax_amount DECIMAL;
    v_total DECIMAL;
    v_line_items JSONB;
    v_total_bots_in_service INT;
    v_charged_bot_count INT;
    v_new_bots_count INT;
    v_is_amendment BOOLEAN := FALSE;
    v_due_date DATE;
BEGIN
    -- Get rental agreement
    SELECT * INTO v_agreement
    FROM rental_agreements
    WHERE id = p_rental_agreement_id;
    
    IF v_agreement IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Rental agreement not found');
    END IF;
    
    -- Get organization legal profile
    SELECT * INTO v_profile
    FROM organization_legal_profiles
    WHERE organization_id = v_agreement.organization_id;
    
    -- Get setup fee from pricing
    SELECT setup_fee INTO v_setup_fee_per_bot
    FROM pricing_plans
    WHERE bot_type = COALESCE(v_agreement.bot_type, 'mow_bot')
    AND is_active = true
    AND is_default = true
    LIMIT 1;
    
    IF v_setup_fee_per_bot IS NULL THEN
        v_setup_fee_per_bot := 299.00;
    END IF;
    
    -- Count bots
    SELECT COUNT(*) INTO v_total_bots_in_service
    FROM rental_agreements
    WHERE service_id = v_agreement.service_id
    AND status = 'active';
    
    SELECT COALESCE(SUM((line_items->0->>'quantity')::INTEGER), 0) INTO v_charged_bot_count
    FROM invoices i
    JOIN rental_agreements ra ON i.rental_agreement_id = ra.id
    WHERE ra.service_id = v_agreement.service_id
    AND i.notes LIKE '%Deposit%'
    AND i.status != 'cancelled';
    
    v_new_bots_count := v_total_bots_in_service - v_charged_bot_count;
    
    IF v_charged_bot_count > 0 THEN
        v_is_amendment := TRUE;
        IF v_new_bots_count <= 0 THEN
            RETURN json_build_object('success', false, 'error', 'All bots already have deposit invoices');
        END IF;
    ELSE
        v_new_bots_count := v_total_bots_in_service;
    END IF;
    
    v_setup_fee := v_setup_fee_per_bot * v_new_bots_count;
    v_tax_amount := ROUND(v_setup_fee * 0.15, 2);
    v_total := v_setup_fee + v_tax_amount;
    
    v_line_items := jsonb_build_array(
        jsonb_build_object(
            'description', CASE WHEN v_is_amendment THEN 'Bot Setup Fee - Amendment (Refundable Deposit)' ELSE 'Bot Setup Fee (Refundable Deposit)' END,
            'details', 'Per bot: R' || v_setup_fee_per_bot || ' × ' || v_new_bots_count || ' bot' || CASE WHEN v_new_bots_count > 1 THEN 's' ELSE '' END,
            'quantity', v_new_bots_count,
            'unit_price', v_setup_fee_per_bot,
            'total', v_setup_fee
        )
    );
    
    v_invoice_number := generate_invoice_number();
    
    -- *** SCALED BILLING: Always use immediate due date in testing ***
    v_due_date := CURRENT_DATE;
    
    INSERT INTO invoices (
        invoice_number, user_id, organization_id, rental_agreement_id,
        period_start, period_end, bot_rental_total, service_visits_total,
        subtotal, tax_rate, tax_amount, total_amount, amount_due,
        line_items, status, issue_date, due_date,
        billing_name, billing_address, billing_city, billing_province,
        billing_postal_code, billing_email, notes
    ) VALUES (
        v_invoice_number, v_agreement.user_id, v_agreement.organization_id, p_rental_agreement_id,
        CURRENT_DATE, CURRENT_DATE, 0, 0,
        v_setup_fee, 15.00, v_tax_amount, v_total, v_total,
        v_line_items, 'sent', CURRENT_DATE, v_due_date,
        COALESCE(v_profile.first_name || ' ' || v_profile.surname, 'N/A'),
        COALESCE(v_profile.physical_address, 'N/A'),
        COALESCE(v_profile.physical_city, 'N/A'),
        COALESCE(v_profile.physical_province, 'N/A'),
        COALESCE(v_profile.physical_postal_code, 'N/A'),
        (SELECT email FROM profiles WHERE id = v_agreement.user_id),
        CASE WHEN v_is_amendment THEN 'Deposit Invoice - Amendment Setup Fee for ' || v_new_bots_count || ' Additional Bot' || CASE WHEN v_new_bots_count > 1 THEN 's' ELSE '' END || ' (Agreement: ' || v_agreement.agreement_number || ')' ELSE 'Deposit Invoice - Setup Fee for Bot Installation (Agreement: ' || v_agreement.agreement_number || ')' END
    )
    RETURNING id INTO v_invoice_id;
    
    RAISE NOTICE '[SCALED BILLING] Deposit invoice % created - creating payment attempt', v_invoice_number;
    
    -- Create payment attempt immediately for deposit invoices
    DECLARE
        v_authorization_rec RECORD;
        v_attempt_id UUID;
    BEGIN
        -- Get user's default payment authorization
        SELECT * INTO v_authorization_rec
        FROM payment_authorizations
        WHERE user_id = v_agreement.user_id
        AND is_default = true
        AND is_active = true
        LIMIT 1;
        
        IF v_authorization_rec IS NOT NULL THEN
            -- Create payment attempt with status='pending'
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
                v_invoice_id,
                p_rental_agreement_id,
                v_agreement.user_id,
                v_agreement.organization_id,
                v_authorization_rec.authorization_code,
                v_total,
                1,
                'pending',
                CURRENT_TIMESTAMP + INTERVAL '1 hour'
            )
            RETURNING id INTO v_attempt_id;
            
            RAISE NOTICE '[SCALED BILLING] Payment attempt % created - trigger will process immediately', v_attempt_id;
        END IF;
    EXCEPTION
        WHEN OTHERS THEN
            RAISE WARNING '[SCALED BILLING] Failed to create payment attempt: %', SQLERRM;
    END;
    
    RETURN json_build_object(
        'success', true,
        'invoice_id', v_invoice_id,
        'invoice_number', v_invoice_number,
        'total_amount', v_total,
        'due_date', v_due_date,
        'scaled_billing', true,
        'payment_attempt_created', true
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- OVERRIDE: auto_collect_payments (1 Hour Retry)
-- =====================================================
-- Note: Edge function is triggered automatically by database trigger,
-- so we don't need to call it manually here!

CREATE OR REPLACE FUNCTION auto_collect_payments()
RETURNS JSON AS $$
DECLARE
    v_invoice RECORD;
    v_authorization RECORD;
    v_attempt_id UUID;
    v_count INTEGER := 0;
    v_errors INTEGER := 0;
    v_retry_interval INTERVAL;
BEGIN
    -- *** SCALED BILLING: 1 hour retry instead of 1 day ***
    v_retry_interval := CASE 
        WHEN is_scaled_billing_enabled() THEN INTERVAL '1 hour'
        ELSE INTERVAL '1 day'
    END;
    
    RAISE NOTICE '[SCALED BILLING] Retry interval: %', v_retry_interval;
    
    FOR v_invoice IN
        SELECT i.*
        FROM invoices i
        WHERE i.status = 'sent'
        AND i.amount_due > 0
        AND i.due_date <= CURRENT_DATE
        ORDER BY i.due_date ASC
    LOOP
        BEGIN
            SELECT * INTO v_authorization
            FROM payment_authorizations
            WHERE user_id = v_invoice.user_id
            AND is_default = true
            AND is_active = true
            LIMIT 1;
            
            IF v_authorization IS NOT NULL THEN
                -- Create payment attempt (trigger will automatically call edge function!)
                INSERT INTO payment_attempts (
                    invoice_id, rental_agreement_id, user_id, organization_id,
                    authorization_code, amount, attempt_number, status, next_retry_at
                )
                VALUES (
                    v_invoice.id, v_invoice.rental_agreement_id, v_invoice.user_id, v_invoice.organization_id,
                    v_authorization.authorization_code, v_invoice.amount_due, 1, 'pending',
                    CURRENT_TIMESTAMP + v_retry_interval
                )
                RETURNING id INTO v_attempt_id;
                
                v_count := v_count + 1;
                RAISE NOTICE 'Created payment attempt % for invoice % (trigger will process it)', v_attempt_id, v_invoice.invoice_number;
            ELSE
                UPDATE invoices SET status = 'overdue' WHERE id = v_invoice.id;
                INSERT INTO billing_notifications (invoice_id, user_id, organization_id, notification_type, recipients, subject, body)
                VALUES (v_invoice.id, v_invoice.user_id, v_invoice.organization_id, 'payment_failed',
                        jsonb_build_array(v_invoice.billing_email),
                        'Payment Method Required - Invoice ' || v_invoice.invoice_number,
                        'No payment method on file.');
            END IF;
        EXCEPTION
            WHEN OTHERS THEN
                v_errors := v_errors + 1;
        END;
    END LOOP;
    
    RETURN json_build_object(
        'success', true, 
        'attempts_created', v_count, 
        'errors', v_errors, 
        'scaled_billing', is_scaled_billing_enabled(),
        'note', 'Database trigger will automatically process payment attempts',
        'timestamp', NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- SUCCESS NOTIFICATION
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=================================================================';
    RAISE NOTICE '   ⚠️  SCALED BILLING TESTING MODE ENABLED';
    RAISE NOTICE '=================================================================';
    RAISE NOTICE '';
    RAISE NOTICE '⏱️  TIME SCALE:';
    RAISE NOTICE '  • 1 day = 1 month (test a year in 12 days!)';
    RAISE NOTICE '  • 1 hour = 1 day (for retries)';
    RAISE NOTICE '  • Invoices due IMMEDIATELY';
    RAISE NOTICE '';
    RAISE NOTICE '🔧 OVERRIDDEN FUNCTIONS:';
    RAISE NOTICE '  • create_deposit_invoice() - immediate due dates';
    RAISE NOTICE '  • auto_collect_payments() - 1 hour retry interval';
    RAISE NOTICE '';
    RAISE NOTICE '⚠️  TO REMOVE THIS FOR PRODUCTION:';
    RAISE NOTICE '  rm supabase/migrations/20251019240002_scaled_billing_testing.sql';
    RAISE NOTICE '  supabase db reset';
    RAISE NOTICE '';
    RAISE NOTICE '=================================================================';
    RAISE NOTICE '';
END $$;

