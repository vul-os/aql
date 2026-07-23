-- =====================================================
-- Seed Pricing Data
-- Default pricing for Bot Korp services
-- =====================================================

-- Clear existing pricing data (in case of re-run)
DELETE FROM service_fees;
DELETE FROM bot_pricing;

-- =====================================================
-- BOT PRICING (Monthly Rates by Area)
-- =====================================================

-- Mow Bot Pricing Tiers (based on garden area)
-- Small gardens (0-100 m²)
INSERT INTO bot_pricing (bot_type, monthly_rate, quarterly_rate, annual_rate, setup_fee, tier, description, metadata) VALUES
('mow_bot', 299, 850, 3050, 450, 'small', 'For gardens up to 100 m²', '{"min_area_sqm": 0, "max_area_sqm": 100}');

-- Medium gardens (101-250 m²)
INSERT INTO bot_pricing (bot_type, monthly_rate, quarterly_rate, annual_rate, setup_fee, tier, description, metadata) VALUES
('mow_bot', 499, 1420, 5090, 450, 'medium', 'For gardens 101-250 m²', '{"min_area_sqm": 101, "max_area_sqm": 250}');

-- Large gardens (251-500 m²)
INSERT INTO bot_pricing (bot_type, monthly_rate, quarterly_rate, annual_rate, setup_fee, tier, description, metadata) VALUES
('mow_bot', 799, 2275, 8155, 450, 'large', 'For gardens 251-500 m²', '{"min_area_sqm": 251, "max_area_sqm": 500}');

-- Extra Large gardens (501-1000 m²)
INSERT INTO bot_pricing (bot_type, monthly_rate, quarterly_rate, annual_rate, setup_fee, tier, description, metadata) VALUES
('mow_bot', 1299, 3695, 13245, 450, 'xlarge', 'For gardens 501-1000 m²', '{"min_area_sqm": 501, "max_area_sqm": 1000}');

-- XXL gardens (1001+ m²) - base rate, additional area charged separately
INSERT INTO bot_pricing (bot_type, monthly_rate, quarterly_rate, annual_rate, setup_fee, tier, description, metadata) VALUES
('mow_bot', 1299, 3695, 13245, 450, 'xxlarge', 'For gardens over 1000 m² (base rate)', '{"min_area_sqm": 1001, "max_area_sqm": null, "extra_per_500sqm": 300}');

-- Pool Bot Pricing (Coming Soon)
INSERT INTO bot_pricing (bot_type, monthly_rate, quarterly_rate, annual_rate, setup_fee, tier, description, is_active) VALUES
('pool_bot', 599, 1705, 6115, 450, 'standard', 'Pool cleaning and maintenance', false);

-- Security Bot Pricing (Coming Soon)
INSERT INTO bot_pricing (bot_type, monthly_rate, quarterly_rate, annual_rate, setup_fee, tier, description, is_active) VALUES
('security_bot', 899, 2560, 9170, 450, 'standard', 'Security monitoring and alerts', false);

-- Weather Station Pricing
INSERT INTO bot_pricing (bot_type, monthly_rate, quarterly_rate, annual_rate, setup_fee, tier, description) VALUES
('weather_station', 199, 565, 2030, 250, 'standard', 'Weather monitoring and data collection');

-- =====================================================
-- SERVICE FEES
-- =====================================================

-- Setup & Installation Fees
INSERT INTO service_fees (fee_type, fee_name, description, amount, billing_type, applies_to) VALUES
('installation', 'Standard Installation', 'Initial bot installation and setup', 450, 'one_time', 'all'),
('installation', 'Additional Garden Setup', 'Setup fee for each additional garden at same location', 200, 'per_unit', 'specific_bot_type');

UPDATE service_fees SET bot_type = 'mow_bot' WHERE fee_name = 'Additional Garden Setup';

-- Maintenance Fees
INSERT INTO service_fees (fee_type, fee_name, description, amount, billing_type, applies_to) VALUES
('maintenance', 'Routine Maintenance Visit', 'Scheduled maintenance and inspection', 350, 'per_incident', 'all'),
('maintenance', 'Blade Replacement', 'Mowing blade replacement', 150, 'per_incident', 'specific_bot_type');

UPDATE service_fees SET bot_type = 'mow_bot' WHERE fee_name = 'Blade Replacement';

-- Emergency & Repair Fees
INSERT INTO service_fees (fee_type, fee_name, description, amount, billing_type, applies_to) VALUES
('emergency_callout', 'Emergency Callout Fee', 'Emergency service visit', 500, 'per_incident', 'all'),
('repair', 'Standard Repair', 'Parts and labor for standard repairs', 0, 'hourly', 'all');

UPDATE service_fees SET amount = 250 WHERE fee_name = 'Standard Repair';

-- Relocation Fees
INSERT INTO service_fees (fee_type, fee_name, description, amount, billing_type, applies_to) VALUES
('relocation', 'Bot Relocation Service', 'Moving bot to new location', 300, 'per_incident', 'all');

-- Late Payment Fee
INSERT INTO service_fees (fee_type, fee_name, description, amount, billing_type, applies_to, is_taxable, tax_rate) VALUES
('late_payment', 'Late Payment Fee', 'Fee for overdue payments', 150, 'per_incident', 'all', false, 0);

-- Cancellation Fee
INSERT INTO service_fees (fee_type, fee_name, description, amount, billing_type, applies_to, is_taxable) VALUES
('cancellation', 'Early Termination Fee', 'Fee for cancelling before contract end (within first 6 months)', 500, 'one_time', 'all', false);

-- =====================================================
-- HELPER FUNCTION: Get Pricing for Area
-- =====================================================

CREATE OR REPLACE FUNCTION get_pricing_for_area(
    p_bot_type TEXT,
    p_area_sqm DECIMAL
)
RETURNS TABLE(
    pricing_id UUID,
    tier TEXT,
    monthly_rate DECIMAL,
    quarterly_rate DECIMAL,
    annual_rate DECIMAL,
    setup_fee DECIMAL,
    description TEXT,
    metadata JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        bp.id as pricing_id,
        bp.tier,
        bp.monthly_rate,
        bp.quarterly_rate,
        bp.annual_rate,
        bp.setup_fee,
        bp.description,
        bp.metadata
    FROM bot_pricing bp
    WHERE bp.bot_type = p_bot_type
    AND bp.is_active = true
    AND (
        (bp.metadata->>'min_area_sqm')::DECIMAL <= p_area_sqm
        AND (
            bp.metadata->>'max_area_sqm' IS NULL 
            OR (bp.metadata->>'max_area_sqm')::DECIMAL >= p_area_sqm
        )
    )
    ORDER BY bp.monthly_rate ASC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- HELPER FUNCTION: Calculate Total Price with Extras
-- =====================================================

CREATE OR REPLACE FUNCTION calculate_total_pricing(
    p_bot_type TEXT,
    p_total_area_sqm DECIMAL,
    p_garden_count INTEGER DEFAULT 1
)
RETURNS JSON AS $$
DECLARE
    v_base_pricing RECORD;
    v_monthly DECIMAL;
    v_quarterly DECIMAL;
    v_annual DECIMAL;
    v_setup_fee DECIMAL;
    v_extra_area DECIMAL;
    v_extra_charge DECIMAL;
    v_additional_garden_fee DECIMAL;
BEGIN
    -- Get base pricing for area
    SELECT * INTO v_base_pricing FROM get_pricing_for_area(p_bot_type, p_total_area_sqm);
    
    IF v_base_pricing IS NULL THEN
        RETURN json_build_object(
            'error', 'No pricing found for specified area',
            'monthly', 0,
            'quarterly', 0,
            'annual', 0,
            'setupFee', 0
        );
    END IF;
    
    v_monthly := v_base_pricing.monthly_rate;
    v_quarterly := v_base_pricing.quarterly_rate;
    v_annual := v_base_pricing.annual_rate;
    v_setup_fee := v_base_pricing.setup_fee;
    
    -- Handle extra large areas (over 1000 m²)
    IF p_total_area_sqm > 1000 AND v_base_pricing.metadata ? 'extra_per_500sqm' THEN
        v_extra_area := p_total_area_sqm - 1000;
        v_extra_charge := CEIL(v_extra_area / 500) * (v_base_pricing.metadata->>'extra_per_500sqm')::DECIMAL;
        
        v_monthly := v_monthly + v_extra_charge;
        v_quarterly := ROUND(v_monthly * 3 * 0.95, 2);
        v_annual := ROUND(v_monthly * 12 * 0.85, 2);
    END IF;
    
    -- Add additional garden setup fees
    IF p_garden_count > 1 THEN
        SELECT amount INTO v_additional_garden_fee
        FROM service_fees
        WHERE fee_name = 'Additional Garden Setup'
        AND is_active = true
        LIMIT 1;
        
        IF v_additional_garden_fee IS NOT NULL THEN
            v_setup_fee := v_setup_fee + (v_additional_garden_fee * (p_garden_count - 1));
        END IF;
    END IF;
    
    RETURN json_build_object(
        'monthly', v_monthly,
        'quarterly', v_quarterly,
        'annual', v_annual,
        'setupFee', v_setup_fee,
        'tier', v_base_pricing.tier,
        'description', v_base_pricing.description
    );
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- Comments
-- =====================================================

COMMENT ON FUNCTION get_pricing_for_area IS 'Get the appropriate pricing tier for a given bot type and area size';
COMMENT ON FUNCTION calculate_total_pricing IS 'Calculate total pricing including extra area charges and multiple garden fees';

-- =====================================================
-- Verify Seeded Data
-- =====================================================

DO $$
DECLARE
    pricing_count INTEGER;
    fees_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO pricing_count FROM bot_pricing WHERE is_active = true;
    SELECT COUNT(*) INTO fees_count FROM service_fees WHERE is_active = true;
    
    RAISE NOTICE '✅ Seeded % active pricing tiers', pricing_count;
    RAISE NOTICE '✅ Seeded % active service fees', fees_count;
    
    -- Test the pricing function
    RAISE NOTICE '';
    RAISE NOTICE 'Testing pricing calculation for 250 m² garden:';
    RAISE NOTICE '%', (SELECT calculate_total_pricing('mow_bot', 250, 1));
    
    RAISE NOTICE '';
    RAISE NOTICE 'Testing pricing calculation for 3 gardens totaling 750 m²:';
    RAISE NOTICE '%', (SELECT calculate_total_pricing('mow_bot', 750, 3));
END $$;

