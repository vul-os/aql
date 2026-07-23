-- =====================================================
-- Database Functions and Triggers
-- =====================================================

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

-- Function to check if legal profile is complete
CREATE OR REPLACE FUNCTION is_legal_profile_complete(p_user_id UUID)
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
    FROM profiles
    WHERE id = p_user_id;
    
    RETURN COALESCE(v_complete, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update legal profile
CREATE OR REPLACE FUNCTION update_legal_profile(
    p_user_id UUID,
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
    
    -- Update the profile
    UPDATE profiles
    SET 
        first_name = p_first_name,
        surname = p_surname,
        full_name = p_first_name || ' ' || p_surname,
        id_number = p_id_number,
        physical_address = p_physical_address,
        physical_city = p_physical_city,
        physical_province = p_physical_province,
        physical_postal_code = p_physical_postal_code,
        cell_phone = p_cell_phone,
        phone = COALESCE(phone, p_cell_phone),
        legal_profile_completed = true,
        legal_profile_completed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_user_id;
    
    -- Return success with updated data
    SELECT json_build_object(
        'success', true,
        'profile', row_to_json(p.*)
    ) INTO v_result
    FROM profiles p
    WHERE p.id = p_user_id;
    
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
DECLARE
    v_pricing RECORD;
    v_bot_rental_total DECIMAL;
    v_service_total DECIMAL;
    v_monthly_total DECIMAL;
    v_setup_fee DECIMAL;
BEGIN
    -- Get pricing for bot type
    SELECT * INTO v_pricing
    FROM pricing_structure
    WHERE bot_type = p_bot_type
    AND is_active = true
    ORDER BY effective_from DESC
    LIMIT 1;
    
    IF v_pricing IS NULL THEN
        RETURN json_build_object(
            'error', 'No pricing found for bot type: ' || p_bot_type
        );
    END IF;
    
    -- Calculate costs
    v_bot_rental_total := v_pricing.bot_rental_monthly * p_number_of_bots;
    v_service_total := v_pricing.service_price_per_visit * p_services_per_month;
    v_monthly_total := v_bot_rental_total + v_service_total;
    v_setup_fee := v_pricing.setup_fee * p_number_of_bots;
    
    RETURN json_build_object(
        'bot_rental_per_bot', v_pricing.bot_rental_monthly,
        'bot_rental_total', v_bot_rental_total,
        'service_price_per_visit', v_pricing.service_price_per_visit,
        'service_total', v_service_total,
        'services_per_month', p_services_per_month,
        'number_of_bots', p_number_of_bots,
        'monthly_total', v_monthly_total,
        'setup_fee_per_bot', v_pricing.setup_fee,
        'setup_fee_total', v_setup_fee,
        'bot_type', p_bot_type,
        'description', v_pricing.description
    );
END;
$$ LANGUAGE plpgsql;

-- Function to get tier pricing
CREATE OR REPLACE FUNCTION get_tier_pricing(
    p_bot_type TEXT,
    p_number_of_bots INTEGER,
    p_services_per_month INTEGER
)
RETURNS JSON AS $$
DECLARE
    v_tier RECORD;
    v_base_pricing RECORD;
    v_bot_rental DECIMAL;
    v_service_cost DECIMAL;
BEGIN
    -- Try to find exact tier match
    SELECT * INTO v_tier
    FROM service_tier_pricing
    WHERE bot_type = p_bot_type
    AND number_of_bots = p_number_of_bots
    AND services_per_month = p_services_per_month
    AND is_active = true
    LIMIT 1;
    
    IF v_tier IS NOT NULL THEN
        -- Found exact tier
        v_bot_rental := 150.00 * p_number_of_bots;
        v_service_cost := v_tier.monthly_total - v_bot_rental;
        
        RETURN json_build_object(
            'monthly_total', v_tier.monthly_total,
            'bot_rental_total', v_bot_rental,
            'service_total', v_service_cost,
            'bot_rental_per_bot', 150.00,
            'service_price_per_visit', CASE WHEN p_services_per_month > 0 THEN ROUND(v_service_cost / p_services_per_month, 2) ELSE 0 END,
            'number_of_bots', p_number_of_bots,
            'services_per_month', p_services_per_month,
            'tier_name', v_tier.tier_name,
            'description', v_tier.description,
            'pricing_type', 'tier'
        );
    ELSE
        -- Calculate from base pricing
        SELECT * INTO v_base_pricing
        FROM pricing_structure
        WHERE bot_type = p_bot_type AND is_active = true
        LIMIT 1;
        
        v_bot_rental := v_base_pricing.bot_rental_monthly * p_number_of_bots;
        v_service_cost := v_base_pricing.service_price_per_visit * p_services_per_month;
        
        RETURN json_build_object(
            'monthly_total', v_bot_rental + v_service_cost,
            'bot_rental_total', v_bot_rental,
            'service_total', v_service_cost,
            'bot_rental_per_bot', v_base_pricing.bot_rental_monthly,
            'service_price_per_visit', v_base_pricing.service_price_per_visit,
            'number_of_bots', p_number_of_bots,
            'services_per_month', p_services_per_month,
            'setup_fee', v_base_pricing.setup_fee * p_number_of_bots,
            'pricing_type', 'calculated'
        );
    END IF;
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
    v_profile RECORD;
    v_pricing JSON;
BEGIN
    -- Get user profile for legal info
    SELECT * INTO v_profile
    FROM profiles
    WHERE id = p_user_id;
    
    IF v_profile IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Profile not found');
    END IF;
    
    -- Check legal profile is complete
    IF v_profile.legal_profile_completed != true THEN
        RETURN json_build_object('success', false, 'error', 'Legal profile must be completed before signing agreement');
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
        v_profile.first_name,
        v_profile.surname,
        v_profile.id_number,
        v_profile.physical_address,
        v_profile.physical_city,
        v_profile.physical_province,
        v_profile.cell_phone,
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
    
    -- Get user profile for billing info
    SELECT * INTO v_profile
    FROM profiles
    WHERE id = v_agreement.user_id;
    
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

CREATE TRIGGER update_pricing_structure_updated_at BEFORE UPDATE ON pricing_structure
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

CREATE TRIGGER update_deposits_updated_at BEFORE UPDATE ON deposits
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

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

-- Success message
DO $$
BEGIN
    RAISE NOTICE '=== ALL FUNCTIONS AND TRIGGERS CREATED ===';
    RAISE NOTICE 'Legal profile, pricing, rental agreements, invoices, payments, billing automation';
END $$;

