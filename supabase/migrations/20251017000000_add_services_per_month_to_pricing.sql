-- =====================================================
-- Add services_per_month to pricing calculation
-- This helps frontend show how many services are included
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
    v_services_per_month INTEGER;
BEGIN
    -- Get base pricing for area
    SELECT * INTO v_base_pricing FROM get_pricing_for_area(p_bot_type, p_total_area_sqm);
    
    IF v_base_pricing IS NULL THEN
        RETURN json_build_object(
            'error', 'No pricing found for specified area',
            'monthly', 0,
            'quarterly', 0,
            'annual', 0,
            'setupFee', 0,
            'services_per_month', 4
        );
    END IF;
    
    v_monthly := v_base_pricing.monthly_rate;
    v_quarterly := v_base_pricing.quarterly_rate;
    v_annual := v_base_pricing.annual_rate;
    v_setup_fee := v_base_pricing.setup_fee;
    
    -- Calculate services per month based on tier
    -- Standard tier: 4 services/month (weekly)
    -- Premium tier: 8 services/month (bi-weekly)
    -- Pro tier: 12 services/month (3x per week)
    v_services_per_month := CASE 
        WHEN v_base_pricing.tier = 'pro' THEN 12
        WHEN v_base_pricing.tier = 'premium' THEN 8
        ELSE 4
    END;
    
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
        'description', v_base_pricing.description,
        'services_per_month', v_services_per_month
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_total_pricing IS 'Calculate total pricing including extra area charges, multiple garden fees, and services per month based on tier';

