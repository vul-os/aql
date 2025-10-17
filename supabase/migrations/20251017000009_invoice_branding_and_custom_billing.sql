-- =====================================================
-- Invoice Branding & Custom Billing Dates
-- Add company details, custom billing dates, prorated charges
-- =====================================================

-- =====================================================
-- 1. ADD COMPANY DETAILS TO INVOICES
-- =====================================================

-- Add company/vendor information columns to invoices
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS vendor_name TEXT DEFAULT 'BotKorp (Pty) Ltd',
ADD COLUMN IF NOT EXISTS vendor_parent_company TEXT DEFAULT 'A member of Exolution Technologies (Pty) Ltd',
ADD COLUMN IF NOT EXISTS vendor_registration_number TEXT DEFAULT '2024/123456/07',
ADD COLUMN IF NOT EXISTS vendor_vat_number TEXT DEFAULT '4567891234',
ADD COLUMN IF NOT EXISTS vendor_address_line1 TEXT DEFAULT 'Map House',
ADD COLUMN IF NOT EXISTS vendor_address_line2 TEXT DEFAULT 'Umbilo',
ADD COLUMN IF NOT EXISTS vendor_city TEXT DEFAULT 'Durban',
ADD COLUMN IF NOT EXISTS vendor_postal_code TEXT DEFAULT '4013',
ADD COLUMN IF NOT EXISTS vendor_province TEXT DEFAULT 'KwaZulu-Natal',
ADD COLUMN IF NOT EXISTS vendor_country TEXT DEFAULT 'South Africa',
ADD COLUMN IF NOT EXISTS vendor_phone TEXT DEFAULT '+27 31 123 4567',
ADD COLUMN IF NOT EXISTS vendor_email TEXT DEFAULT 'billing@botkorp.co.za',
ADD COLUMN IF NOT EXISTS vendor_website TEXT DEFAULT 'www.botkorp.co.za';

-- =====================================================
-- 2. ADD CUSTOM BILLING DATE TO RENTAL AGREEMENTS
-- =====================================================

-- Add billing_day column (1-28, to avoid month-end issues)
ALTER TABLE rental_agreements
ADD COLUMN IF NOT EXISTS billing_day INTEGER DEFAULT 1 CHECK (billing_day >= 1 AND billing_day <= 28),
ADD COLUMN IF NOT EXISTS next_billing_date DATE,
ADD COLUMN IF NOT EXISTS prorated_first_charge DECIMAL(10, 2) DEFAULT 0;

-- Add comment
COMMENT ON COLUMN rental_agreements.billing_day IS 'Day of month to charge (1-28). Default 1st.';
COMMENT ON COLUMN rental_agreements.next_billing_date IS 'Next scheduled billing date';
COMMENT ON COLUMN rental_agreements.prorated_first_charge IS 'Prorated amount for first partial month';

-- Create index on billing dates for efficient cron queries
CREATE INDEX IF NOT EXISTS idx_rental_agreements_next_billing 
ON rental_agreements(next_billing_date) 
WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_rental_agreements_billing_day 
ON rental_agreements(billing_day);

-- =====================================================
-- 3. FUNCTION TO CALCULATE PRORATED CHARGE
-- =====================================================

CREATE OR REPLACE FUNCTION calculate_prorated_charge(
    p_monthly_amount DECIMAL,
    p_start_date DATE,
    p_billing_day INTEGER
)
RETURNS DECIMAL AS $$
DECLARE
    v_days_in_month INTEGER;
    v_days_to_bill INTEGER;
    v_next_billing_date DATE;
    v_prorated_amount DECIMAL;
BEGIN
    -- Get days in the current month
    v_days_in_month := EXTRACT(DAY FROM (DATE_TRUNC('month', p_start_date) + INTERVAL '1 month - 1 day'))::INTEGER;
    
    -- Calculate next billing date
    v_next_billing_date := DATE_TRUNC('month', p_start_date) + INTERVAL '1 month - 1 day';
    v_next_billing_date := DATE_TRUNC('month', v_next_billing_date) + (p_billing_day - 1) * INTERVAL '1 day';
    
    -- If start date is after the billing day this month, bill until next month's billing day
    IF EXTRACT(DAY FROM p_start_date)::INTEGER > p_billing_day THEN
        v_next_billing_date := v_next_billing_date + INTERVAL '1 month';
    END IF;
    
    -- Calculate days to bill
    v_days_to_bill := v_next_billing_date - p_start_date;
    
    -- If it's a full month or more, return full amount
    IF v_days_to_bill >= 30 THEN
        RETURN p_monthly_amount;
    END IF;
    
    -- Calculate prorated amount (based on 30-day month for consistency)
    v_prorated_amount := ROUND((p_monthly_amount / 30.0) * v_days_to_bill, 2);
    
    RETURN v_prorated_amount;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =====================================================
-- 4. FUNCTION TO GET NEXT BILLING DATE
-- =====================================================

CREATE OR REPLACE FUNCTION get_next_billing_date(
    p_current_date DATE,
    p_billing_day INTEGER
)
RETURNS DATE AS $$
DECLARE
    v_next_billing_date DATE;
    v_current_day INTEGER;
BEGIN
    v_current_day := EXTRACT(DAY FROM p_current_date)::INTEGER;
    
    -- If we're before the billing day this month, use this month
    IF v_current_day < p_billing_day THEN
        v_next_billing_date := DATE_TRUNC('month', p_current_date) + (p_billing_day - 1) * INTERVAL '1 day';
    ELSE
        -- Otherwise, use next month
        v_next_billing_date := DATE_TRUNC('month', p_current_date + INTERVAL '1 month') + (p_billing_day - 1) * INTERVAL '1 day';
    END IF;
    
    RETURN v_next_billing_date;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =====================================================
-- 5. UPDATE CREATE_RENTAL_AGREEMENT TO SUPPORT CUSTOM BILLING DAY
-- =====================================================

CREATE OR REPLACE FUNCTION create_rental_agreement(
    p_user_id UUID,
    p_organization_id UUID,
    p_location_id UUID,
    p_bot_type TEXT,
    p_number_of_bots INTEGER,
    p_services_per_month INTEGER,
    p_signature_image_url TEXT DEFAULT NULL,
    p_signature_ip_address INET DEFAULT NULL,
    p_signature_user_agent TEXT DEFAULT NULL,
    p_billing_day INTEGER DEFAULT 1 -- NEW PARAMETER
)
RETURNS JSON AS $$
DECLARE
    v_agreement_id UUID;
    v_agreement_number TEXT;
    v_pricing RECORD;
    v_next_billing_date DATE;
    v_prorated_first_charge DECIMAL;
    v_profile RECORD;
BEGIN
    -- Validate billing day (1-28)
    IF p_billing_day < 1 OR p_billing_day > 28 THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Billing day must be between 1 and 28'
        );
    END IF;
    
    -- Get pricing
    SELECT * INTO v_pricing
    FROM get_tier_pricing(p_bot_type, p_number_of_bots, p_services_per_month);
    
    IF v_pricing IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Unable to calculate pricing'
        );
    END IF;
    
    -- Get user profile for signer details
    SELECT * INTO v_profile
    FROM profiles
    WHERE id = p_user_id;
    
    -- Generate agreement number
    v_agreement_number := generate_agreement_number();
    
    -- Calculate next billing date
    v_next_billing_date := get_next_billing_date(CURRENT_DATE, p_billing_day);
    
    -- Calculate prorated first charge if starting mid-cycle
    v_prorated_first_charge := calculate_prorated_charge(
        (v_pricing->'monthly_total')::DECIMAL,
        CURRENT_DATE,
        p_billing_day
    );
    
    -- Create agreement
    INSERT INTO rental_agreements (
        agreement_number,
        user_id,
        organization_id,
        location_id,
        bot_type,
        number_of_bots,
        services_per_month,
        monthly_total,
        bot_rental_total,
        service_total,
        setup_fee,
        status,
        start_date,
        billing_day,
        next_billing_date,
        prorated_first_charge,
        signer_name,
        signer_email,
        signer_id_number,
        signer_phone,
        signature_image_url,
        signature_ip_address,
        signature_user_agent,
        signed_at,
        started_at
    ) VALUES (
        v_agreement_number,
        p_user_id,
        p_organization_id,
        p_location_id,
        p_bot_type,
        p_number_of_bots,
        p_services_per_month,
        (v_pricing->'monthly_total')::DECIMAL,
        (v_pricing->'bot_rental_total')::DECIMAL,
        (v_pricing->'service_total')::DECIMAL,
        (v_pricing->'setup_fee')::DECIMAL,
        CASE 
            WHEN p_signature_image_url IS NOT NULL THEN 'active'
            ELSE 'draft'
        END,
        CURRENT_DATE,
        p_billing_day,
        v_next_billing_date,
        v_prorated_first_charge,
        v_profile.first_name || ' ' || v_profile.surname,
        v_profile.email,
        v_profile.id_number,
        v_profile.cell_phone,
        p_signature_image_url,
        p_signature_ip_address,
        p_signature_user_agent,
        CASE WHEN p_signature_image_url IS NOT NULL THEN NOW() ELSE NULL END,
        CASE WHEN p_signature_image_url IS NOT NULL THEN NOW() ELSE NULL END
    )
    RETURNING id INTO v_agreement_id;
    
    RETURN json_build_object(
        'success', true,
        'agreement_id', v_agreement_id,
        'agreement_number', v_agreement_number,
        'monthly_total', (v_pricing->'monthly_total')::DECIMAL,
        'billing_day', p_billing_day,
        'next_billing_date', v_next_billing_date,
        'prorated_first_charge', v_prorated_first_charge,
        'setup_fee', (v_pricing->'setup_fee')::DECIMAL
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 6. UPDATE AUTO_GENERATE_MONTHLY_INVOICES FOR CUSTOM BILLING DATES
-- =====================================================

CREATE OR REPLACE FUNCTION auto_generate_monthly_invoices()
RETURNS JSON AS $$
DECLARE
    v_agreement RECORD;
    v_result JSON;
    v_count INTEGER := 0;
    v_errors INTEGER := 0;
    v_target_date DATE;
BEGIN
    -- Generate invoices for agreements with billing dates in 5 days
    v_target_date := CURRENT_DATE + INTERVAL '5 days';
    
    -- Loop through active agreements with upcoming billing dates
    FOR v_agreement IN
        SELECT * FROM rental_agreements
        WHERE status = 'active'
        AND started_at IS NOT NULL
        AND next_billing_date = v_target_date::DATE
    LOOP
        BEGIN
            -- Calculate period (from last billing date to next)
            DECLARE
                v_period_start DATE;
                v_period_end DATE;
            BEGIN
                v_period_start := v_agreement.next_billing_date;
                v_period_end := get_next_billing_date(v_period_start, v_agreement.billing_day) - INTERVAL '1 day';
                
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
                    
                    -- Update next billing date
                    UPDATE rental_agreements
                    SET next_billing_date = get_next_billing_date(v_period_end, billing_day)
                    WHERE id = v_agreement.id;
                    
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
                        jsonb_build_array((SELECT email FROM profiles WHERE id = v_agreement.user_id)),
                        'Your Bot Korp Invoice for ' || TO_CHAR(v_period_start, 'Month YYYY'),
                        'Your invoice ' || (v_result->>'invoice_number') || ' for R' || (v_result->>'total_amount') || ' is ready. Payment will be collected on ' || TO_CHAR(v_period_start, 'YYYY-MM-DD') || '.'
                    ;
                ELSE
                    v_errors := v_errors + 1;
                END IF;
            END;
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
        'target_date', v_target_date,
        'timestamp', NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 7. UPDATE AUTO_COLLECT_PAYMENTS FOR CUSTOM BILLING DATES
-- =====================================================

CREATE OR REPLACE FUNCTION auto_collect_payments_internal()
RETURNS JSON AS $$
DECLARE
    v_invoice RECORD;
    v_authorization RECORD;
    v_attempt_id UUID;
    v_count INTEGER := 0;
    v_errors INTEGER := 0;
BEGIN
    -- Get all unpaid invoices that are due today
    FOR v_invoice IN
        SELECT i.*
        FROM invoices i
        JOIN rental_agreements ra ON ra.id = i.rental_agreement_id
        WHERE i.status = 'sent'
        AND i.amount_due > 0
        AND ra.next_billing_date = CURRENT_DATE -- Use agreement's billing date
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
                    CURRENT_TIMESTAMP + INTERVAL '1 day'
                )
                RETURNING id INTO v_attempt_id;
                
                v_count := v_count + 1;
                
                RAISE NOTICE 'Created payment attempt % for invoice %', v_attempt_id, v_invoice.invoice_number;
            ELSE
                -- No payment method
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
                    'We couldn''t collect payment for invoice ' || v_invoice.invoice_number || ' because no payment method is on file.'
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

-- =====================================================
-- 8. CREATE INVOICE FOR FIRST PRORATED CHARGE
-- =====================================================

CREATE OR REPLACE FUNCTION create_prorated_first_invoice(
    p_rental_agreement_id UUID
)
RETURNS JSON AS $$
DECLARE
    v_invoice_id UUID;
    v_invoice_number TEXT;
    v_agreement RECORD;
    v_profile RECORD;
    v_line_items JSONB;
    v_subtotal DECIMAL;
    v_tax_amount DECIMAL;
    v_total DECIMAL;
BEGIN
    -- Get rental agreement
    SELECT * INTO v_agreement
    FROM rental_agreements
    WHERE id = p_rental_agreement_id;
    
    IF v_agreement IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Agreement not found');
    END IF;
    
    -- Only create if there's a prorated charge
    IF v_agreement.prorated_first_charge <= 0 THEN
        RETURN json_build_object('success', false, 'error', 'No prorated charge needed');
    END IF;
    
    -- Get user profile
    SELECT * INTO v_profile
    FROM profiles
    WHERE id = v_agreement.user_id;
    
    -- Calculate amounts
    v_subtotal := v_agreement.prorated_first_charge;
    v_tax_amount := ROUND(v_subtotal * 0.15, 2);
    v_total := v_subtotal + v_tax_amount;
    
    -- Build line items
    v_line_items := jsonb_build_array(
        jsonb_build_object(
            'description', 'Prorated service (partial month)',
            'quantity', 1,
            'unit_price', v_subtotal,
            'total', v_subtotal
        )
    );
    
    -- Generate invoice number
    v_invoice_number := generate_invoice_number();
    
    -- Create invoice
    INSERT INTO invoices (
        invoice_number,
        user_id,
        organization_id,
        rental_agreement_id,
        period_start,
        period_end,
        bot_rental_total,
        service_visits_total,
        subtotal,
        tax_rate,
        tax_amount,
        total_amount,
        amount_due,
        line_items,
        status,
        issue_date,
        due_date,
        billing_name,
        billing_address,
        billing_city,
        billing_province,
        billing_postal_code,
        billing_email
    ) VALUES (
        v_invoice_number,
        v_agreement.user_id,
        v_agreement.organization_id,
        p_rental_agreement_id,
        v_agreement.start_date,
        v_agreement.next_billing_date - INTERVAL '1 day',
        0,
        v_subtotal,
        v_subtotal,
        15.00,
        v_tax_amount,
        v_total,
        v_total,
        v_line_items,
        'sent',
        CURRENT_DATE,
        CURRENT_DATE + INTERVAL '3 days', -- Due in 3 days for first charge
        v_profile.first_name || ' ' || v_profile.surname,
        v_profile.physical_address,
        v_profile.physical_city,
        v_profile.physical_province,
        v_profile.physical_postal_code,
        v_profile.email
    )
    RETURNING id INTO v_invoice_id;
    
    RETURN json_build_object(
        'success', true,
        'invoice_id', v_invoice_id,
        'invoice_number', v_invoice_number,
        'total_amount', v_total
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- GRANTS
-- =====================================================

GRANT EXECUTE ON FUNCTION calculate_prorated_charge TO authenticated;
GRANT EXECUTE ON FUNCTION get_next_billing_date TO authenticated;
GRANT EXECUTE ON FUNCTION create_prorated_first_invoice TO authenticated;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON FUNCTION calculate_prorated_charge IS 'Calculate prorated charge for partial month based on billing day';
COMMENT ON FUNCTION get_next_billing_date IS 'Calculate next billing date based on current date and billing day';
COMMENT ON FUNCTION create_prorated_first_invoice IS 'Create invoice for prorated first charge when starting mid-cycle';

-- Success message
DO $$
BEGIN
    RAISE NOTICE '=== INVOICE BRANDING & CUSTOM BILLING COMPLETE ===';
    RAISE NOTICE '';
    RAISE NOTICE 'Company Details Added:';
    RAISE NOTICE '  - Vendor: BotKorp (Pty) Ltd';
    RAISE NOTICE '  - Parent: Exolution Technologies (Pty) Ltd';
    RAISE NOTICE '  - VAT: 4567891234';
    RAISE NOTICE '  - Address: Map House, Umbilo, Durban, 4013';
    RAISE NOTICE '';
    RAISE NOTICE 'Custom Billing Dates:';
    RAISE NOTICE '  - billing_day column added (1-28)';
    RAISE NOTICE '  - next_billing_date tracking';
    RAISE NOTICE '  - Prorated first charge calculation';
    RAISE NOTICE '';
    RAISE NOTICE 'NOTE: Update VAT and registration numbers with real values!';
END $$;

