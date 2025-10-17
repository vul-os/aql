-- =====================================================
-- Rental Agreements Table
-- Flexible agreements (no long-term contracts)
-- Can pause/cancel anytime
-- =====================================================

CREATE TABLE IF NOT EXISTS rental_agreements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- User and organization
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    
    -- Agreement details
    agreement_number TEXT UNIQUE NOT NULL, -- e.g., "RA-2025-001234"
    
    -- Rental details
    bot_type TEXT NOT NULL CHECK (bot_type IN ('mow_bot', 'pool_bot', 'security_bot', 'weather_station')),
    number_of_bots INTEGER NOT NULL DEFAULT 1,
    services_per_month INTEGER NOT NULL DEFAULT 1,
    
    -- Pricing at time of agreement
    monthly_total DECIMAL(10, 2) NOT NULL,
    bot_rental_total DECIMAL(10, 2) NOT NULL,
    service_total DECIMAL(10, 2) NOT NULL,
    setup_fee DECIMAL(10, 2) DEFAULT 0,
    
    -- Legal information (from profile at time of signing)
    signer_first_name TEXT NOT NULL,
    signer_surname TEXT NOT NULL,
    signer_id_number TEXT NOT NULL,
    signer_address TEXT NOT NULL,
    signer_city TEXT NOT NULL,
    signer_province TEXT,
    signer_phone TEXT NOT NULL,
    signer_email TEXT NOT NULL,
    
    -- Signature
    signature_image_url TEXT, -- CDN URL to signature image
    signature_ip_address INET, -- IP address when signed
    signature_user_agent TEXT, -- Browser/device info
    signed_at TIMESTAMPTZ, -- When they signed
    
    -- Agreement document
    agreement_pdf_url TEXT, -- CDN URL to generated PDF
    
    -- Status
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'cancelled')),
    
    -- Flexibility tracking
    started_at TIMESTAMPTZ,
    paused_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    pause_reason TEXT,
    cancellation_reason TEXT,
    
    -- Metadata
    terms_version TEXT DEFAULT 'v1.0',
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_rental_agreements_user ON rental_agreements(user_id);
CREATE INDEX idx_rental_agreements_org ON rental_agreements(organization_id);
CREATE INDEX idx_rental_agreements_location ON rental_agreements(location_id);
CREATE INDEX idx_rental_agreements_status ON rental_agreements(status);
CREATE INDEX idx_rental_agreements_number ON rental_agreements(agreement_number);

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

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON rental_agreements TO authenticated;
GRANT EXECUTE ON FUNCTION generate_agreement_number TO authenticated;
GRANT EXECUTE ON FUNCTION create_rental_agreement TO authenticated;
GRANT EXECUTE ON FUNCTION pause_rental_agreement TO authenticated;
GRANT EXECUTE ON FUNCTION resume_rental_agreement TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_rental_agreement TO authenticated;

-- Add comments
COMMENT ON TABLE rental_agreements IS 'Flexible rental agreements - no long-term contracts, pause/cancel anytime';
COMMENT ON COLUMN rental_agreements.status IS 'draft: not signed, active: running, paused: temporarily stopped (winter), cancelled: terminated';
COMMENT ON COLUMN rental_agreements.signature_image_url IS 'CDN URL to user signature image';
COMMENT ON COLUMN rental_agreements.agreement_pdf_url IS 'CDN URL to generated agreement PDF';

-- Trigger to update updated_at
CREATE TRIGGER update_rental_agreements_updated_at
BEFORE UPDATE ON rental_agreements
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Rental agreements table created successfully';
    RAISE NOTICE 'Features: No long-term contracts, pause/cancel anytime, winter pause support';
    RAISE NOTICE 'Functions: create, pause, resume, cancel';
END $$;

