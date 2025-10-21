-- =====================================================
-- Database Functions and Triggers
-- =====================================================

-- =====================================================
-- SERVICE FUNCTIONS
-- =====================================================

-- Function to check if service already exists at location
CREATE OR REPLACE FUNCTION check_service_exists_at_location(
    p_location_id UUID,
    p_service_type TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM services
        WHERE location_id = p_location_id
        AND service_type = p_service_type
        AND is_active = true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- UTILITY FUNCTIONS
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to update full_name when first_name or surname changes
CREATE OR REPLACE FUNCTION update_full_name_trigger()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.first_name IS NOT NULL AND NEW.surname IS NOT NULL THEN
        NEW.full_name := NEW.first_name || ' ' || NEW.surname;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- LEGAL PROFILE FUNCTIONS
-- =====================================================

-- Function to check if legal profile is complete (now checks organization_legal_profiles)
CREATE OR REPLACE FUNCTION is_legal_profile_complete(p_organization_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_complete BOOLEAN;
BEGIN
    SELECT 
        first_name IS NOT NULL AND
        surname IS NOT NULL AND
        id_number IS NOT NULL AND
        physical_address IS NOT NULL AND
        cell_phone IS NOT NULL
    INTO v_complete
    FROM organization_legal_profiles
    WHERE organization_id = p_organization_id;
    
    RETURN COALESCE(v_complete, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update legal profile (now updates organization_legal_profiles)
CREATE OR REPLACE FUNCTION update_legal_profile(
    p_organization_id UUID,
    p_first_name TEXT,
    p_surname TEXT,
    p_id_number TEXT,
    p_physical_address TEXT,
    p_physical_city TEXT,
    p_physical_province TEXT,
    p_physical_postal_code TEXT,
    p_cell_phone TEXT
)
RETURNS JSON AS $$
DECLARE
    v_result JSON;
BEGIN
    -- Validate ID number format (South African - 13 digits)
    IF p_id_number IS NOT NULL AND LENGTH(p_id_number) != 13 THEN
        RETURN json_build_object(
            'success', false,
            'error', 'ID number must be exactly 13 digits'
        );
    END IF;
    
    -- Validate phone number (10 digits starting with 0, or with country code)
    IF p_cell_phone IS NOT NULL AND LENGTH(p_cell_phone) < 10 THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Cell phone number must be at least 10 digits'
        );
    END IF;
    
    -- Update or insert the organization legal profile
    INSERT INTO organization_legal_profiles (
        organization_id,
        first_name,
        surname,
        id_number,
        physical_address,
        physical_city,
        physical_province,
        physical_postal_code,
        cell_phone
    ) VALUES (
        p_organization_id,
        p_first_name,
        p_surname,
        p_id_number,
        p_physical_address,
        p_physical_city,
        p_physical_province,
        p_physical_postal_code,
        p_cell_phone
    )
    ON CONFLICT (organization_id) DO UPDATE
    SET 
        first_name = EXCLUDED.first_name,
        surname = EXCLUDED.surname,
        id_number = EXCLUDED.id_number,
        physical_address = EXCLUDED.physical_address,
        physical_city = EXCLUDED.physical_city,
        physical_province = EXCLUDED.physical_province,
        physical_postal_code = EXCLUDED.physical_postal_code,
        cell_phone = EXCLUDED.cell_phone,
        updated_at = NOW();
    
    -- Return success with updated data
    SELECT json_build_object(
        'success', true,
        'legal_profile', row_to_json(olp.*)
    ) INTO v_result
    FROM organization_legal_profiles olp
    WHERE olp.organization_id = p_organization_id;
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- PRICING FUNCTIONS
-- =====================================================

-- Function to calculate monthly cost
CREATE OR REPLACE FUNCTION calculate_monthly_cost(
    p_bot_type TEXT,
    p_number_of_bots INTEGER,
    p_services_per_month INTEGER DEFAULT 1
)
RETURNS JSON AS $$
BEGIN
    -- Simply call get_tier_pricing which already handles the new pricing structure
    RETURN get_tier_pricing(p_bot_type, p_number_of_bots, p_services_per_month);
END;
$$ LANGUAGE plpgsql;

-- Function to get tier pricing (updated for new flexible pricing structure)
-- NOTE: Service fee is PER LOCATION, not per bot/garden
-- Use include_service_fee parameter to control whether service fee is added
CREATE OR REPLACE FUNCTION get_tier_pricing(
    p_bot_type TEXT,
    p_number_of_bots INTEGER,
    p_services_per_month INTEGER,
    p_include_service_fee BOOLEAN DEFAULT true
)
RETURNS JSON AS $$
DECLARE
    v_plan RECORD;
    v_line_item RECORD;
    v_bot_rental DECIMAL;
    v_line_items_total DECIMAL := 0;
    v_service_price_per_visit DECIMAL;
BEGIN
    -- Get pricing plan
    SELECT * INTO v_plan
    FROM pricing_plans
    WHERE bot_type = p_bot_type
    AND is_active = true
    AND is_default = true
    LIMIT 1;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No pricing plan found for bot type: %', p_bot_type;
    END IF;
    
    -- Calculate bot rental (always per bot)
    v_bot_rental := v_plan.bot_rental_monthly * p_number_of_bots;
    
    -- Sum up all required line items (non-optional)
    -- Service fee is PER LOCATION (R400/month), not per bot or per visit
    -- Only include if p_include_service_fee is true
    IF p_include_service_fee THEN
        FOR v_line_item IN 
            SELECT price_per_unit
            FROM pricing_line_items
            WHERE pricing_plan_id = v_plan.id
            AND is_active = true
            AND is_optional = false
        LOOP
            v_line_items_total := v_line_items_total + v_line_item.price_per_unit;
        END LOOP;
    END IF;
    
    -- For backward compatibility, show service price
    v_service_price_per_visit := v_line_items_total;
    
    RETURN json_build_object(
        'monthly_total', v_bot_rental + v_line_items_total,
        'bot_rental_total', v_bot_rental,
        'service_total', v_line_items_total,
        'bot_rental_per_bot', v_plan.bot_rental_monthly,
        'service_price_per_visit', v_service_price_per_visit, -- Legacy field, now equals monthly service fee
        'monthly_service_fee', v_line_items_total,
        'number_of_bots', p_number_of_bots,
        'services_per_month', p_services_per_month, -- Still tracked for scheduling
        'setup_fee', v_plan.setup_fee * p_number_of_bots,
        'pricing_type', 'calculated',
        'tier_name', v_plan.name,
        'include_service_fee', p_include_service_fee
    );
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- RENTAL AGREEMENT FUNCTIONS
-- =====================================================

-- Function to generate agreement number
CREATE OR REPLACE FUNCTION generate_agreement_number()
RETURNS TEXT AS $$
DECLARE
    v_year TEXT;
    v_count INTEGER;
    v_number TEXT;
BEGIN
    v_year := TO_CHAR(NOW(), 'YYYY');
    
    -- Get count of agreements this year
    SELECT COUNT(*) + 1 INTO v_count
    FROM rental_agreements
    WHERE agreement_number LIKE 'RA-' || v_year || '-%';
    
    -- Format: RA-2025-001234
    v_number := 'RA-' || v_year || '-' || LPAD(v_count::TEXT, 6, '0');
    
    RETURN v_number;
END;
$$ LANGUAGE plpgsql;

-- Function to create rental agreement
CREATE OR REPLACE FUNCTION create_rental_agreement(
    p_user_id UUID,
    p_organization_id UUID,
    p_location_id UUID,
    p_bot_type TEXT,
    p_number_of_bots INTEGER,
    p_services_per_month INTEGER,
    p_signature_image_url TEXT DEFAULT NULL,
    p_signature_ip_address INET DEFAULT NULL,
    p_signature_user_agent TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_agreement_id UUID;
    v_agreement_number TEXT;
    v_legal_profile RECORD;
    v_profile RECORD;
    v_pricing JSON;
BEGIN
    -- Get user profile
    SELECT * INTO v_profile
    FROM profiles
    WHERE id = p_user_id;
    
    IF v_profile IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Profile not found');
    END IF;
    
    -- Get organization legal profile
    SELECT * INTO v_legal_profile
    FROM organization_legal_profiles
    WHERE organization_id = p_organization_id;
    
    IF v_legal_profile IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Organization legal profile must be completed before signing agreement');
    END IF;
    
    -- Get pricing
    v_pricing := get_tier_pricing(p_bot_type, p_number_of_bots, p_services_per_month);
    
    -- Generate agreement number
    v_agreement_number := generate_agreement_number();
    
    -- Create agreement
    INSERT INTO rental_agreements (
        user_id,
        organization_id,
        location_id,
        agreement_number,
        bot_type,
        number_of_bots,
        services_per_month,
        monthly_total,
        bot_rental_total,
        service_total,
        setup_fee,
        signer_first_name,
        signer_surname,
        signer_id_number,
        signer_address,
        signer_city,
        signer_province,
        signer_phone,
        signer_email,
        signature_image_url,
        signature_ip_address,
        signature_user_agent,
        signed_at,
        status,
        started_at
    ) VALUES (
        p_user_id,
        p_organization_id,
        p_location_id,
        v_agreement_number,
        p_bot_type,
        p_number_of_bots,
        p_services_per_month,
        (v_pricing->>'monthly_total')::DECIMAL,
        (v_pricing->>'bot_rental_total')::DECIMAL,
        (v_pricing->>'service_total')::DECIMAL,
        COALESCE((v_pricing->>'setup_fee')::DECIMAL, 0),
        v_legal_profile.first_name,
        v_legal_profile.surname,
        v_legal_profile.id_number,
        v_legal_profile.physical_address,
        v_legal_profile.physical_city,
        v_legal_profile.physical_province,
        v_legal_profile.cell_phone,
        v_profile.email,
        p_signature_image_url,
        p_signature_ip_address,
        p_signature_user_agent,
        CASE WHEN p_signature_image_url IS NOT NULL THEN NOW() ELSE NULL END,
        CASE WHEN p_signature_image_url IS NOT NULL THEN 'active' ELSE 'draft' END,
        CASE WHEN p_signature_image_url IS NOT NULL THEN NOW() ELSE NULL END
    )
    RETURNING id INTO v_agreement_id;
    
    RETURN json_build_object(
        'success', true,
        'agreement_id', v_agreement_id,
        'agreement_number', v_agreement_number,
        'status', CASE WHEN p_signature_image_url IS NOT NULL THEN 'active' ELSE 'draft' END
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to pause agreement
CREATE OR REPLACE FUNCTION pause_rental_agreement(
    p_agreement_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSON AS $$
BEGIN
    UPDATE rental_agreements
    SET 
        status = 'paused',
        paused_at = NOW(),
        pause_reason = p_reason,
        updated_at = NOW()
    WHERE id = p_agreement_id
    AND status = 'active';
    
    IF FOUND THEN
        RETURN json_build_object('success', true, 'message', 'Agreement paused successfully');
    ELSE
        RETURN json_build_object('success', false, 'error', 'Agreement not found or not active');
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to resume agreement
CREATE OR REPLACE FUNCTION resume_rental_agreement(
    p_agreement_id UUID
)
RETURNS JSON AS $$
BEGIN
    UPDATE rental_agreements
    SET 
        status = 'active',
        paused_at = NULL,
        pause_reason = NULL,
        updated_at = NOW()
    WHERE id = p_agreement_id
    AND status = 'paused';
    
    IF FOUND THEN
        RETURN json_build_object('success', true, 'message', 'Agreement resumed successfully');
    ELSE
        RETURN json_build_object('success', false, 'error', 'Agreement not found or not paused');
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to cancel agreement
CREATE OR REPLACE FUNCTION cancel_rental_agreement(
    p_agreement_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSON AS $$
BEGIN
    UPDATE rental_agreements
    SET 
        status = 'cancelled',
        cancelled_at = NOW(),
        cancellation_reason = p_reason,
        updated_at = NOW()
    WHERE id = p_agreement_id
    AND status IN ('active', 'paused');
    
    IF FOUND THEN
        RETURN json_build_object('success', true, 'message', 'Agreement cancelled successfully');
    ELSE
        RETURN json_build_object('success', false, 'error', 'Agreement not found or already cancelled');
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- INVOICE FUNCTIONS
-- =====================================================

-- Function to generate invoice number
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TEXT AS $$
DECLARE
    v_year TEXT;
    v_month TEXT;
    v_count INTEGER;
    v_number TEXT;
BEGIN
    v_year := TO_CHAR(NOW(), 'YYYY');
    v_month := TO_CHAR(NOW(), 'MM');
    
    -- Get count of invoices this month
    SELECT COUNT(*) + 1 INTO v_count
    FROM invoices
    WHERE invoice_number LIKE 'INV-' || v_year || v_month || '-%';
    
    -- Format: INV-YYYYMM-NNNN
    v_number := 'INV-' || v_year || v_month || '-' || LPAD(v_count::TEXT, 4, '0');
    
    RETURN v_number;
END;
$$ LANGUAGE plpgsql;

-- Function to create monthly invoice from rental agreement
CREATE OR REPLACE FUNCTION create_monthly_invoice(
    p_rental_agreement_id UUID,
    p_period_start DATE,
    p_period_end DATE,
    p_bot_rental_days INTEGER DEFAULT 30,
    p_service_visits INTEGER DEFAULT 0
)
RETURNS JSON AS $$
DECLARE
    v_invoice_id UUID;
    v_invoice_number TEXT;
    v_agreement RECORD;
    v_profile RECORD;
    v_bot_rental_total DECIMAL;
    v_service_total DECIMAL;
    v_subtotal DECIMAL;
    v_tax_amount DECIMAL;
    v_total DECIMAL;
    v_line_items JSONB;
BEGIN
    -- Get rental agreement
    SELECT * INTO v_agreement
    FROM rental_agreements
    WHERE id = p_rental_agreement_id;
    
    IF v_agreement IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Rental agreement not found');
    END IF;
    
    -- Get organization legal profile for billing info
    SELECT * INTO v_profile
    FROM organization_legal_profiles
    WHERE organization_id = v_agreement.organization_id;
    
    -- Calculate prorated bot rental if not full month
    IF p_bot_rental_days < 30 THEN
        v_bot_rental_total := ROUND((v_agreement.bot_rental_total / 30.0) * p_bot_rental_days, 2);
    ELSE
        v_bot_rental_total := v_agreement.bot_rental_total;
    END IF;
    
    -- Calculate service visits cost
    IF p_service_visits > 0 THEN
        v_service_total := ROUND((v_agreement.service_total / v_agreement.services_per_month::DECIMAL) * p_service_visits, 2);
    ELSE
        v_service_total := 0;
    END IF;
    
    -- Calculate totals
    v_subtotal := v_bot_rental_total + v_service_total;
    v_tax_amount := ROUND(v_subtotal * 0.15, 2); -- 15% VAT
    v_total := v_subtotal + v_tax_amount;
    
    -- Build line items
    v_line_items := jsonb_build_array(
        jsonb_build_object(
            'description', 'Bot Rental (' || v_agreement.number_of_bots || ' bot' || CASE WHEN v_agreement.number_of_bots > 1 THEN 's' ELSE '' END || ' × ' || p_bot_rental_days || ' days)',
            'quantity', v_agreement.number_of_bots,
            'unit_price', ROUND(v_bot_rental_total / v_agreement.number_of_bots, 2),
            'total', v_bot_rental_total
        ),
        jsonb_build_object(
            'description', 'Service Visits (edge trimming + bot swap)',
            'quantity', p_service_visits,
            'unit_price', CASE WHEN p_service_visits > 0 THEN ROUND(v_service_total / p_service_visits, 2) ELSE 0 END,
            'total', v_service_total
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
        p_period_start,
        p_period_end,
        v_bot_rental_total,
        v_service_total,
        v_subtotal,
        15.00,
        v_tax_amount,
        v_total,
        v_total, -- Initially unpaid
        v_line_items,
        'sent',
        CURRENT_DATE,
        CURRENT_DATE + INTERVAL '14 days', -- Due in 14 days
        COALESCE(v_profile.first_name || ' ' || v_profile.surname, 'N/A'),
        COALESCE(v_profile.physical_address, 'N/A'),
        COALESCE(v_profile.physical_city, 'N/A'),
        COALESCE(v_profile.physical_province, 'N/A'),
        COALESCE(v_profile.physical_postal_code, 'N/A'),
        (SELECT email FROM profiles WHERE id = v_agreement.user_id)
    )
    RETURNING id INTO v_invoice_id;
    
    RETURN json_build_object(
        'success', true,
        'invoice_id', v_invoice_id,
        'invoice_number', v_invoice_number,
        'total_amount', v_total,
        'due_date', CURRENT_DATE + INTERVAL '14 days'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to mark invoice as paid
CREATE OR REPLACE FUNCTION mark_invoice_paid(
    p_invoice_id UUID,
    p_amount DECIMAL,
    p_payment_method TEXT DEFAULT NULL,
    p_payment_reference TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_invoice RECORD;
    v_new_amount_paid DECIMAL;
    v_new_amount_due DECIMAL;
    v_new_status TEXT;
BEGIN
    -- Get current invoice
    SELECT * INTO v_invoice
    FROM invoices
    WHERE id = p_invoice_id;
    
    IF v_invoice IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Invoice not found');
    END IF;
    
    -- Calculate new amounts
    v_new_amount_paid := v_invoice.amount_paid + p_amount;
    v_new_amount_due := v_invoice.total_amount - v_new_amount_paid;
    
    -- Determine new status
    IF v_new_amount_due <= 0 THEN
        v_new_status := 'paid';
    ELSE
        v_new_status := 'sent'; -- Partially paid, keep as sent
    END IF;
    
    -- Update invoice
    UPDATE invoices
    SET 
        amount_paid = v_new_amount_paid,
        amount_due = v_new_amount_due,
        status = v_new_status,
        paid_date = CASE WHEN v_new_status = 'paid' THEN CURRENT_DATE ELSE paid_date END,
        payment_method = COALESCE(p_payment_method, payment_method),
        payment_reference = COALESCE(p_payment_reference, payment_reference),
        updated_at = NOW()
    WHERE id = p_invoice_id;
    
    RETURN json_build_object(
        'success', true,
        'invoice_id', p_invoice_id,
        'amount_paid', v_new_amount_paid,
        'amount_due', v_new_amount_due,
        'status', v_new_status
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user invoices
CREATE OR REPLACE FUNCTION get_user_invoices(
    p_user_id UUID,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
    invoice_id UUID,
    invoice_number TEXT,
    period_start DATE,
    period_end DATE,
    total_amount DECIMAL,
    amount_paid DECIMAL,
    amount_due DECIMAL,
    status TEXT,
    issue_date DATE,
    due_date DATE,
    paid_date DATE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        i.id,
        i.invoice_number,
        i.period_start,
        i.period_end,
        i.total_amount,
        i.amount_paid,
        i.amount_due,
        i.status,
        i.issue_date,
        i.due_date,
        i.paid_date
    FROM invoices i
    WHERE i.user_id = p_user_id
    ORDER BY i.issue_date DESC, i.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- PAYMENT AUTHORIZATION FUNCTIONS
-- =====================================================

-- Function to soft delete authorization
CREATE OR REPLACE FUNCTION delete_payment_authorization(
    p_authorization_id UUID,
    p_user_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
    v_affected INTEGER;
BEGIN
    UPDATE payment_authorizations
    SET 
        is_active = false,
        deleted_at = NOW(),
        updated_at = NOW()
    WHERE id = p_authorization_id
        AND user_id = p_user_id
        AND deleted_at IS NULL;
    
    GET DIAGNOSTICS v_affected = ROW_COUNT;
    
    RETURN v_affected > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to set default authorization
CREATE OR REPLACE FUNCTION set_default_authorization(
    p_authorization_id UUID,
    p_user_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Remove default from all other authorizations
    UPDATE payment_authorizations
    SET is_default = false, updated_at = NOW()
    WHERE user_id = p_user_id
        AND id != p_authorization_id;
    
    -- Set the selected one as default
    UPDATE payment_authorizations
    SET is_default = true, updated_at = NOW()
    WHERE id = p_authorization_id
        AND user_id = p_user_id
        AND is_active = true
        AND deleted_at IS NULL;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get active authorizations for user
CREATE OR REPLACE FUNCTION get_user_authorizations(p_user_id UUID)
RETURNS TABLE (
    id UUID,
    authorization_code TEXT,
    card_type TEXT,
    last4 TEXT,
    exp_month TEXT,
    exp_year TEXT,
    bank TEXT,
    is_default BOOLEAN,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pa.id,
        pa.authorization_code,
        pa.card_type,
        pa.last4,
        pa.exp_month,
        pa.exp_year,
        pa.bank,
        pa.is_default,
        pa.last_used_at,
        pa.created_at
    FROM payment_authorizations pa
    WHERE pa.user_id = p_user_id
        AND pa.is_active = true
        AND pa.deleted_at IS NULL
    ORDER BY pa.is_default DESC, pa.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update authorization usage
CREATE OR REPLACE FUNCTION update_authorization_usage(
    p_authorization_id UUID,
    p_success BOOLEAN
)
RETURNS VOID AS $$
BEGIN
    IF p_success THEN
        UPDATE payment_authorizations
        SET 
            last_used_at = NOW(),
            usage_count = usage_count + 1,
            updated_at = NOW()
        WHERE id = p_authorization_id;
    ELSE
        UPDATE payment_authorizations
        SET 
            failed_attempts = failed_attempts + 1,
            updated_at = NOW()
        WHERE id = p_authorization_id;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- AUTOMATED BILLING FUNCTIONS
-- =====================================================

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
    v_active_services INTEGER;
    v_total_bots INTEGER;
    v_paused_count INTEGER;
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
            -- Count active (non-paused) gardens for this location
            SELECT COUNT(*) INTO v_active_services
            FROM gardens
            WHERE location_id = v_agreement.location_id
            AND is_active = true
            AND (is_paused = false OR is_paused IS NULL)
            AND stage IN ('installed', 'active');
            
            -- Count active (non-paused) pools for this location
            SELECT v_active_services + COUNT(*) INTO v_active_services
            FROM pools
            WHERE location_id = v_agreement.location_id
            AND is_active = true
            AND (is_paused = false OR is_paused IS NULL)
            AND stage IN ('installed', 'active');
            
            -- Only create invoice if there are active services
            IF v_active_services > 0 THEN
                -- Note: Actual invoice creation would happen here via create_monthly_invoice()
                -- For now, we just log that we would create an invoice
                v_count := v_count + 1;
                
                RAISE NOTICE 'Would generate invoice for agreement % with % active services', v_agreement.id, v_active_services;
                
                -- TODO: When implementing full invoice creation:
                -- 1. Call create_monthly_invoice() with v_active_services count
                -- 2. Calculate bot rental: v_active_services * 150
                -- 3. Calculate service visits based on schedule
                -- 4. Create billing_notifications entry
            ELSE
                RAISE NOTICE 'Skipping invoice for agreement % - all services paused', v_agreement.id;
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

-- =====================================================
-- TRIGGERS
-- =====================================================

-- Triggers for updated_at
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_locations_updated_at BEFORE UPDATE ON locations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_bots_updated_at BEFORE UPDATE ON bots
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_gardens_updated_at BEFORE UPDATE ON gardens
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_pools_updated_at BEFORE UPDATE ON pools
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_bot_garden_assignments_updated_at BEFORE UPDATE ON bot_garden_assignments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_bot_pool_assignments_updated_at BEFORE UPDATE ON bot_pool_assignments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_bot_schedules_updated_at BEFORE UPDATE ON bot_schedules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_coverage_areas_updated_at BEFORE UPDATE ON coverage_areas
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_pricing_plans_updated_at BEFORE UPDATE ON pricing_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_pricing_line_items_updated_at BEFORE UPDATE ON pricing_line_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_customer_pricing_overrides_updated_at BEFORE UPDATE ON customer_pricing_overrides
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_customer_line_item_overrides_updated_at BEFORE UPDATE ON customer_line_item_overrides
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_organization_members_updated_at BEFORE UPDATE ON organization_members
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_service_records_updated_at BEFORE UPDATE ON service_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_rental_agreements_updated_at BEFORE UPDATE ON rental_agreements
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_payment_attempts_updated_at BEFORE UPDATE ON payment_attempts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_billing_notifications_updated_at BEFORE UPDATE ON billing_notifications
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_payment_authorizations_updated_at BEFORE UPDATE ON payment_authorizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_notification_preferences_updated_at BEFORE UPDATE ON notification_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_notifications_updated_at BEFORE UPDATE ON notifications
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_push_subscriptions_updated_at BEFORE UPDATE ON push_subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- NOTE: update_deposits_updated_at trigger moved to 20251019211000_referral_system.sql
-- (created after deposits table exists)

-- Trigger to update full_name when first_name or surname changes
CREATE TRIGGER trigger_update_full_name
BEFORE INSERT OR UPDATE OF first_name, surname ON profiles
FOR EACH ROW
EXECUTE FUNCTION update_full_name_trigger();

-- =====================================================
-- GRANT PERMISSIONS
-- =====================================================

-- Grant permissions for legal profile functions
GRANT EXECUTE ON FUNCTION is_legal_profile_complete TO authenticated;
GRANT EXECUTE ON FUNCTION update_legal_profile TO authenticated;

-- Grant permissions for pricing functions
GRANT EXECUTE ON FUNCTION calculate_monthly_cost TO authenticated;
GRANT EXECUTE ON FUNCTION get_tier_pricing TO authenticated;

-- Grant permissions for rental agreement functions
GRANT EXECUTE ON FUNCTION generate_agreement_number TO authenticated;
GRANT EXECUTE ON FUNCTION create_rental_agreement TO authenticated;
GRANT EXECUTE ON FUNCTION pause_rental_agreement TO authenticated;
GRANT EXECUTE ON FUNCTION resume_rental_agreement TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_rental_agreement TO authenticated;

-- Grant permissions for invoice functions
GRANT EXECUTE ON FUNCTION generate_invoice_number TO authenticated;
GRANT EXECUTE ON FUNCTION create_monthly_invoice TO authenticated;
GRANT EXECUTE ON FUNCTION mark_invoice_paid TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_invoices TO authenticated;

-- Grant permissions for payment authorization functions
GRANT EXECUTE ON FUNCTION delete_payment_authorization TO authenticated;
GRANT EXECUTE ON FUNCTION set_default_authorization TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_authorizations TO authenticated;

-- Grant permissions for automated billing functions (postgres only)
GRANT EXECUTE ON FUNCTION auto_generate_monthly_invoices TO postgres;
GRANT EXECUTE ON FUNCTION auto_collect_payments TO postgres;
GRANT EXECUTE ON FUNCTION retry_failed_payments TO postgres;
GRANT EXECUTE ON FUNCTION pause_failed_subscriptions TO postgres;

-- =====================================================
-- ORGANIZATION MANAGEMENT FUNCTIONS
-- =====================================================

-- Get user organizations
CREATE OR REPLACE FUNCTION get_user_organizations(user_uuid UUID)
RETURNS TABLE (
    organization_id UUID,
    organization_name TEXT,
    organization_slug TEXT,
    organization_description TEXT,
    organization_logo_url TEXT,
    subscription_tier TEXT,
    is_active BOOLEAN,
    member_role TEXT,
    member_status TEXT,
    joined_at TIMESTAMPTZ,
    is_owner BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        o.id AS organization_id,
        o.name AS organization_name,
        o.slug AS organization_slug,
        o.description AS organization_description,
        o.logo_url AS organization_logo_url,
        o.subscription_tier,
        o.is_active,
        om.role AS member_role,
        om.status AS member_status,
        om.joined_at,
        (om.role = 'owner') AS is_owner
    FROM organizations o
    INNER JOIN organization_members om ON om.organization_id = o.id
    WHERE om.user_id = user_uuid
        AND om.status = 'active'
        AND o.is_active = true
    ORDER BY o.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create organization
CREATE OR REPLACE FUNCTION create_organization(
    p_user_id UUID,
    p_organization_name TEXT,
    p_organization_type TEXT DEFAULT 'residential'
)
RETURNS TABLE (
    organization_id UUID,
    organization_name TEXT,
    organization_slug TEXT,
    subscription_tier TEXT,
    member_role TEXT
) AS $$
DECLARE
    v_organization_id UUID;
    v_slug TEXT;
    v_slug_base TEXT;
    v_counter INTEGER := 0;
    v_slug_exists BOOLEAN;
    v_user_email TEXT;
    v_full_name TEXT;
BEGIN
    -- Validate organization name
    IF p_organization_name IS NULL OR trim(p_organization_name) = '' THEN
        RAISE EXCEPTION 'Organization name cannot be empty';
    END IF;
    
    -- Check if profile exists, if not create it
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id) THEN
        -- Get user email from auth.users
        SELECT email INTO v_user_email
        FROM auth.users
        WHERE id = p_user_id;
        
        IF v_user_email IS NULL THEN
            RAISE EXCEPTION 'User not found in authentication system';
        END IF;
        
        -- Extract name from email if no full name available
        v_full_name := SPLIT_PART(v_user_email, '@', 1);
        
        -- Create the missing profile
        INSERT INTO profiles (id, email, full_name, first_name, role)
        VALUES (
            p_user_id,
            v_user_email,
            v_full_name,
            v_full_name,
            'user'
        );
        
        RAISE NOTICE 'Created missing profile for user %', p_user_id;
    END IF;
    
    -- Generate unique slug
    v_slug_base := lower(trim(regexp_replace(p_organization_name, '[^a-zA-Z0-9\s-]', '', 'g')));
    v_slug_base := regexp_replace(v_slug_base, '\s+', '-', 'g');
    v_slug_base := regexp_replace(v_slug_base, '-+', '-', 'g');
    v_slug_base := trim(both '-' from v_slug_base);
    
    IF v_slug_base = '' THEN
        v_slug_base := 'org';
    END IF;
    
    v_slug := v_slug_base;
    LOOP
        SELECT EXISTS(SELECT 1 FROM organizations WHERE slug = v_slug) INTO v_slug_exists;
        EXIT WHEN NOT v_slug_exists;
        v_counter := v_counter + 1;
        v_slug := v_slug_base || '-' || v_counter;
    END LOOP;
    
    -- Create organization
    INSERT INTO organizations (
        name, slug, subscription_tier, is_active
    ) VALUES (
        trim(p_organization_name), v_slug, 'free', true
    ) RETURNING id INTO v_organization_id;
    
    -- Add user as owner
    INSERT INTO organization_members (
        organization_id, user_id, role, status, joined_at
    ) VALUES (
        v_organization_id, p_user_id, 'owner', 'active', NOW()
    );
    
    -- Update user's profile with organization_id
    UPDATE profiles
    SET organization_id = v_organization_id
    WHERE id = p_user_id AND profiles.organization_id IS NULL;
    
    -- Log activity
    INSERT INTO activity_logs (
        user_id, organization_id, action, resource_type, resource_id, details
    ) VALUES (
        p_user_id, v_organization_id, 'create', 'organization', v_organization_id,
        jsonb_build_object('organization_name', trim(p_organization_name), 'organization_type', p_organization_type)
    );
    
    -- Return organization details
    RETURN QUERY
    SELECT 
        v_organization_id, trim(p_organization_name), v_slug, 'free'::TEXT, 'owner'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update organization
CREATE OR REPLACE FUNCTION update_organization(
    p_user_id UUID,
    p_organization_id UUID,
    p_organization_name TEXT
)
RETURNS TABLE (
    organization_id UUID,
    organization_name TEXT,
    organization_slug TEXT,
    success BOOLEAN,
    message TEXT
) AS $$
DECLARE
    v_member_role TEXT;
    v_slug TEXT;
    v_slug_base TEXT;
    v_counter INTEGER := 0;
    v_slug_exists BOOLEAN;
    v_current_slug TEXT;
BEGIN
    SELECT role INTO v_member_role
    FROM organization_members
    WHERE organization_members.organization_id = p_organization_id 
        AND user_id = p_user_id
        AND status = 'active';
    
    IF v_member_role IS NULL THEN
        RAISE EXCEPTION 'You are not a member of this organization';
    END IF;
    
    IF v_member_role NOT IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'Only owners and admins can update organization details';
    END IF;
    
    IF p_organization_name IS NULL OR trim(p_organization_name) = '' THEN
        RAISE EXCEPTION 'Organization name cannot be empty';
    END IF;
    
    SELECT slug INTO v_current_slug FROM organizations WHERE id = p_organization_id;
    
    v_slug_base := lower(trim(regexp_replace(p_organization_name, '[^a-zA-Z0-9\s-]', '', 'g')));
    v_slug_base := regexp_replace(v_slug_base, '\s+', '-', 'g');
    v_slug_base := regexp_replace(v_slug_base, '-+', '-', 'g');
    v_slug_base := trim(both '-' from v_slug_base);
    
    IF v_slug_base = '' THEN
        v_slug_base := 'org';
    END IF;
    
    v_slug := v_slug_base;
    LOOP
        SELECT EXISTS(
            SELECT 1 FROM organizations WHERE slug = v_slug AND id != p_organization_id
        ) INTO v_slug_exists;
        EXIT WHEN NOT v_slug_exists;
        v_counter := v_counter + 1;
        v_slug := v_slug_base || '-' || v_counter;
    END LOOP;
    
    UPDATE organizations
    SET name = trim(p_organization_name), slug = v_slug, updated_at = NOW()
    WHERE id = p_organization_id;
    
    INSERT INTO activity_logs (
        user_id, organization_id, action, resource_type, resource_id, details
    ) VALUES (
        p_user_id, p_organization_id, 'update', 'organization', p_organization_id,
        jsonb_build_object('organization_name', trim(p_organization_name), 'old_slug', v_current_slug, 'new_slug', v_slug)
    );
    
    RETURN QUERY
    SELECT p_organization_id, trim(p_organization_name), v_slug, true, 'Organization updated successfully'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Service reminders function
CREATE OR REPLACE FUNCTION send_service_reminders()
RETURNS void AS $$
DECLARE
    v_service RECORD;
    v_member RECORD;
BEGIN
    FOR v_service IN 
        SELECT s.*, l.name AS location_name, l.city AS location_city, 
               o.id AS organization_id, o.name AS organization_name
        FROM services s
        JOIN locations l ON l.id = s.location_id
        JOIN organizations o ON o.id = s.organization_id
        WHERE s.next_service_date = CURRENT_DATE + INTERVAL '1 day'
            AND s.is_active = true
            AND s.status = 'active'
    LOOP
        FOR v_member IN
            SELECT p.id, p.email, COALESCE(p.full_name, p.first_name) as name
            FROM organization_members om
            JOIN profiles p ON p.id = om.user_id
            WHERE om.organization_id = v_service.organization_id
                AND om.status = 'active'
        LOOP
            INSERT INTO notifications (
                user_id, title, message, type, related_type, related_id, data, is_read
            ) VALUES (
                v_member.id,
                'Service Reminder',
                format('Your %s service at %s is scheduled for tomorrow', 
                    v_service.service_type, v_service.location_name),
                'reminder',
                'service',
                v_service.id,
                jsonb_build_object(
                    'service_id', v_service.id,
                    'service_name', v_service.name,
                    'service_date', v_service.next_service_date,
                    'location_name', v_service.location_name
                ),
                false
            );
        END LOOP;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_user_organizations(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION create_organization(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION update_organization(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION send_service_reminders() TO authenticated;

-- =====================================================
-- DASHBOARD ANALYTICS FUNCTIONS
-- =====================================================

-- Get organization dashboard analytics
CREATE OR REPLACE FUNCTION get_organization_dashboard_analytics(org_id UUID)
RETURNS TABLE (
    total_services INTEGER,
    total_gardens INTEGER,
    total_pools INTEGER,
    total_locations INTEGER,
    total_bots INTEGER,
    active_bots INTEGER,
    pending_installations INTEGER,
    pending_invoices INTEGER,
    total_amount_due DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        -- Total services
        (SELECT COUNT(*)::INTEGER 
         FROM services s 
         JOIN locations l ON l.id = s.location_id 
         WHERE l.organization_id = org_id AND s.is_active = true),
        
        -- Total gardens
        (SELECT COUNT(*)::INTEGER 
         FROM gardens g 
         JOIN locations l ON l.id = g.location_id 
         WHERE l.organization_id = org_id),
        
        -- Total pools
        (SELECT COUNT(*)::INTEGER 
         FROM pools p 
         JOIN locations l ON l.id = p.location_id 
         WHERE l.organization_id = org_id),
        
        -- Total locations
        (SELECT COUNT(*)::INTEGER 
         FROM locations 
         WHERE organization_id = org_id AND is_active = true),
        
        -- Total bots
        (SELECT COUNT(*)::INTEGER 
         FROM bots b
         JOIN locations l ON l.id = b.location_id 
         WHERE l.organization_id = org_id),
        
        -- Active bots (status not offline/error and is_enabled = true)
        (SELECT COUNT(*)::INTEGER 
         FROM bots b
         JOIN locations l ON l.id = b.location_id 
         WHERE l.organization_id = org_id 
         AND b.is_enabled = true
         AND b.status NOT IN ('offline', 'error')),
        
        -- Pending installations (services not yet active)
        (SELECT COUNT(*)::INTEGER 
         FROM services s 
         JOIN locations l ON l.id = s.location_id 
         WHERE l.organization_id = org_id 
         AND s.status IN ('pending_setup', 'pending_installation', 'installation_scheduled')),
        
        -- Pending invoices (unpaid invoices: sent or overdue)
        (SELECT COUNT(*)::INTEGER
         FROM invoices i
         WHERE i.organization_id = org_id
         AND i.status IN ('sent', 'overdue')),
        
        -- Total amount due (what the client needs to pay)
        (SELECT COALESCE(SUM(amount_due), 0)::DECIMAL
         FROM invoices i
         WHERE i.organization_id = org_id
         AND i.status IN ('sent', 'overdue'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get bot status distribution
CREATE OR REPLACE FUNCTION get_bot_status_distribution(org_id UUID)
RETURNS TABLE (
    status TEXT,
    count INTEGER
) AS $$
BEGIN
    -- Placeholder until bots table is populated
    RETURN QUERY
    SELECT 
        s.status::TEXT,
        COUNT(*)::INTEGER as count
    FROM services s
    JOIN locations l ON l.id = s.location_id
    WHERE l.organization_id = org_id
    GROUP BY s.status
    ORDER BY count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get bot type distribution
CREATE OR REPLACE FUNCTION get_bot_type_distribution(org_id UUID)
RETURNS TABLE (
    bot_type TEXT,
    count INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.service_type::TEXT as bot_type,
        COUNT(*)::INTEGER as count
    FROM services s
    JOIN locations l ON l.id = s.location_id
    WHERE l.organization_id = org_id AND s.is_active = true
    GROUP BY s.service_type
    ORDER BY count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get mowing activity for last 30 days
CREATE OR REPLACE FUNCTION get_mowing_activity_last_30_days(org_id UUID)
RETURNS TABLE (
    date DATE,
    mowing_count INTEGER
) AS $$
BEGIN
    -- Returns service records from last 30 days
    RETURN QUERY
    SELECT 
        sr.service_date::DATE as date,
        COUNT(*)::INTEGER as mowing_count
    FROM service_records sr
    JOIN services s ON s.id = sr.service_id
    JOIN locations l ON l.id = s.location_id
    WHERE l.organization_id = org_id
    AND sr.service_date >= CURRENT_DATE - INTERVAL '30 days'
    AND sr.status = 'completed'
    GROUP BY sr.service_date::DATE
    ORDER BY date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get upcoming services
CREATE OR REPLACE FUNCTION get_upcoming_services(org_id UUID, days_ahead INTEGER DEFAULT 30)
RETURNS TABLE (
    service_id UUID,
    service_name TEXT,
    service_type TEXT,
    scheduled_date DATE,
    location_name TEXT
) AS $$
BEGIN
    -- Returns upcoming service appointments
    RETURN QUERY
    SELECT 
        s.id as service_id,
        COALESCE(g.name, p.name, 'Service') as service_name,
        s.service_type::TEXT,
        s.next_service_date as scheduled_date,
        l.name as location_name
    FROM services s
    JOIN locations l ON l.id = s.location_id
    LEFT JOIN gardens g ON g.service_id = s.id
    LEFT JOIN pools p ON p.service_id = s.id
    WHERE l.organization_id = org_id
    AND s.is_active = true
    AND s.next_service_date IS NOT NULL
    AND s.next_service_date <= CURRENT_DATE + days_ahead
    ORDER BY s.next_service_date ASC
    LIMIT 10;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get recent alerts (placeholder)
CREATE OR REPLACE FUNCTION get_recent_alerts(org_id UUID, limit_count INTEGER DEFAULT 5)
RETURNS TABLE (
    id UUID,
    severity TEXT,
    title TEXT,
    message TEXT,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    -- Placeholder - returns empty for now
    -- Will be populated when alert system is implemented
    RETURN QUERY
    SELECT 
        uuid_generate_v4() as id,
        'info'::TEXT as severity,
        'System Status'::TEXT as title,
        'All systems operational'::TEXT as message,
        NOW() as created_at
    LIMIT 0; -- Returns no rows
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions for dashboard analytics functions
GRANT EXECUTE ON FUNCTION get_organization_dashboard_analytics(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_bot_status_distribution(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_bot_type_distribution(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_mowing_activity_last_30_days(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_upcoming_services(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_recent_alerts(UUID, INTEGER) TO authenticated;

-- Success message
DO $$
BEGIN
    RAISE NOTICE '=== ALL FUNCTIONS AND TRIGGERS CREATED ===';
    RAISE NOTICE 'Legal profile, pricing, rental agreements, invoices, payments, billing automation, org management';
    RAISE NOTICE 'Dashboard analytics functions created';
END $$;

