-- =====================================================
-- Ensure Service Fees are in Database
-- Migration to populate and update service fees table
-- =====================================================

-- Clear existing service fees to avoid conflicts
TRUNCATE TABLE service_fees CASCADE;

-- =====================================================
-- INSERT ALL SERVICE FEES
-- =====================================================

INSERT INTO service_fees (
    id,
    fee_type,
    fee_name,
    description,
    amount,
    currency,
    billing_type,
    applies_to,
    bot_type,
    is_taxable,
    tax_rate,
    is_active,
    valid_from,
    metadata
) VALUES
    -- Maintenance Fees
    (
        gen_random_uuid(),
        'maintenance',
        'Standard Maintenance',
        'Quarterly maintenance service including inspection, cleaning, and minor adjustments',
        250.00,
        'ZAR',
        'per_incident',
        'all',
        NULL,
        true,
        15.00,
        true,
        CURRENT_DATE,
        '{"recommended_frequency": "quarterly"}'::jsonb
    ),
    -- Repair Fees
    (
        gen_random_uuid(),
        'repair',
        'Standard Repair',
        'Basic repair service for minor issues and part adjustments',
        450.00,
        'ZAR',
        'per_incident',
        'all',
        NULL,
        true,
        15.00,
        true,
        CURRENT_DATE,
        '{"includes": ["diagnosis", "minor_parts", "labor"]}'::jsonb
    ),
    (
        gen_random_uuid(),
        'repair',
        'Major Repair',
        'Comprehensive repair for significant issues',
        850.00,
        'ZAR',
        'per_incident',
        'all',
        NULL,
        true,
        15.00,
        true,
        CURRENT_DATE,
        '{"includes": ["diagnosis", "major_parts", "labor"]}'::jsonb
    ),
    -- Emergency Fees
    (
        gen_random_uuid(),
        'emergency_callout',
        'Emergency Callout',
        '24/7 emergency response service with priority support',
        850.00,
        'ZAR',
        'per_incident',
        'all',
        NULL,
        true,
        15.00,
        true,
        CURRENT_DATE,
        '{"response_time": "2_hours", "availability": "24/7"}'::jsonb
    ),
    -- Installation Fees
    (
        gen_random_uuid(),
        'installation',
        'Standard Installation',
        'Professional installation and setup service',
        500.00,
        'ZAR',
        'one_time',
        'all',
        NULL,
        true,
        15.00,
        true,
        CURRENT_DATE,
        '{"includes": ["setup", "configuration", "training"]}'::jsonb
    ),
    -- Late Payment Fee
    (
        gen_random_uuid(),
        'late_payment',
        'Late Payment Fee',
        'Fee applied to overdue invoices after grace period',
        150.00,
        'ZAR',
        'per_incident',
        'all',
        NULL,
        true,
        15.00,
        true,
        CURRENT_DATE,
        '{"grace_period_days": 7}'::jsonb
    ),
    -- Storage Fees
    (
        gen_random_uuid(),
        'data_storage',
        'Data Storage',
        'Monthly data storage for telemetry, logs, and analytics (per GB)',
        2.50,
        'ZAR',
        'per_unit',
        'all',
        NULL,
        true,
        15.00,
        true,
        CURRENT_DATE,
        '{"unit": "GB", "billing_cycle": "monthly"}'::jsonb
    ),
    -- Relocation Fee
    (
        gen_random_uuid(),
        'relocation',
        'Bot Relocation',
        'Service to move bot to a new location including transport and setup',
        350.00,
        'ZAR',
        'per_incident',
        'all',
        NULL,
        true,
        15.00,
        true,
        CURRENT_DATE,
        '{"includes": ["transport", "reinstallation", "testing"]}'::jsonb
    ),
    -- Training Fee
    (
        gen_random_uuid(),
        'training',
        'On-site Training',
        'Comprehensive staff training session on bot operation and maintenance',
        650.00,
        'ZAR',
        'per_incident',
        'all',
        NULL,
        true,
        15.00,
        true,
        CURRENT_DATE,
        '{"duration": "2_hours", "max_attendees": 10}'::jsonb
    ),
    -- Upgrade Fee
    (
        gen_random_uuid(),
        'upgrade',
        'Hardware Upgrade',
        'Hardware component upgrade or replacement',
        500.00,
        'ZAR',
        'per_incident',
        'all',
        NULL,
        true,
        15.00,
        true,
        CURRENT_DATE,
        '{"excludes_parts": true}'::jsonb
    ),
    -- Cancellation Fee
    (
        gen_random_uuid(),
        'cancellation',
        'Early Cancellation Fee',
        'Fee for cancelling subscription before minimum contract term',
        1000.00,
        'ZAR',
        'one_time',
        'all',
        NULL,
        true,
        15.00,
        true,
        CURRENT_DATE,
        '{"applies_if_less_than_months": 6}'::jsonb
    ),
    -- API Access Fee
    (
        gen_random_uuid(),
        'api_access',
        'API Access',
        'Monthly fee for API access to bot data and control',
        199.00,
        'ZAR',
        'monthly',
        'all',
        NULL,
        true,
        15.00,
        true,
        CURRENT_DATE,
        '{"rate_limit": "10000_requests_per_month"}'::jsonb
    );

-- =====================================================
-- CREATE VIEW FOR ACTIVE FEES
-- =====================================================

CREATE OR REPLACE VIEW active_service_fees AS
SELECT 
    id,
    fee_type,
    fee_name,
    description,
    amount,
    currency,
    billing_type,
    applies_to,
    bot_type,
    is_taxable,
    tax_rate,
    ROUND(amount * (1 + tax_rate / 100), 2) as amount_with_tax,
    metadata
FROM service_fees
WHERE is_active = true
    AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
    AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
ORDER BY fee_type, amount;

-- =====================================================
-- FUNCTION TO GET FEE BY TYPE
-- =====================================================

CREATE OR REPLACE FUNCTION get_service_fee(
    p_fee_type TEXT,
    p_bot_type TEXT DEFAULT NULL
)
RETURNS TABLE (
    fee_id UUID,
    fee_name TEXT,
    description TEXT,
    amount DECIMAL,
    amount_with_tax DECIMAL,
    currency TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        sf.id,
        sf.fee_name,
        sf.description,
        sf.amount,
        ROUND(sf.amount * (1 + sf.tax_rate / 100), 2) as amount_with_tax,
        sf.currency
    FROM service_fees sf
    WHERE sf.fee_type = p_fee_type
        AND sf.is_active = true
        AND (sf.valid_from IS NULL OR sf.valid_from <= CURRENT_DATE)
        AND (sf.valid_until IS NULL OR sf.valid_until >= CURRENT_DATE)
        AND (
            p_bot_type IS NULL 
            OR sf.applies_to = 'all' 
            OR (sf.applies_to = 'specific_bot_type' AND sf.bot_type = p_bot_type)
        )
    ORDER BY sf.amount
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- FUNCTION TO CALCULATE TOTAL WITH FEES
-- =====================================================

CREATE OR REPLACE FUNCTION calculate_invoice_with_fees(
    p_subtotal DECIMAL,
    p_fee_types TEXT[]
)
RETURNS TABLE (
    subtotal DECIMAL,
    fees_total DECIMAL,
    tax_total DECIMAL,
    grand_total DECIMAL
) AS $$
DECLARE
    v_fees_total DECIMAL := 0;
    v_tax_total DECIMAL := 0;
    v_fee_type TEXT;
BEGIN
    -- Calculate fees
    IF p_fee_types IS NOT NULL THEN
        FOR v_fee_type IN SELECT unnest(p_fee_types)
        LOOP
            SELECT COALESCE(SUM(sf.amount), 0)
            INTO v_fees_total
            FROM service_fees sf
            WHERE sf.fee_type = v_fee_type
                AND sf.is_active = true;
        END LOOP;
    END IF;

    -- Calculate tax on subtotal + fees
    SELECT ROUND((p_subtotal + v_fees_total) * 0.15, 2)
    INTO v_tax_total;

    RETURN QUERY
    SELECT 
        p_subtotal,
        v_fees_total,
        v_tax_total,
        p_subtotal + v_fees_total + v_tax_total;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON VIEW active_service_fees IS 'View of currently active service fees with tax calculations';
COMMENT ON FUNCTION get_service_fee IS 'Get a specific service fee by type and optional bot type';
COMMENT ON FUNCTION calculate_invoice_with_fees IS 'Calculate invoice total including selected fees and tax';

-- =====================================================
-- GRANT PERMISSIONS (for authenticated users)
-- =====================================================

-- Allow authenticated users to view fees
GRANT SELECT ON active_service_fees TO authenticated;
GRANT SELECT ON service_fees TO authenticated;

-- Allow calling the fee functions
GRANT EXECUTE ON FUNCTION get_service_fee TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_invoice_with_fees TO authenticated;

