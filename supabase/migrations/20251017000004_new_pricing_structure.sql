-- =====================================================
-- New Pricing Structure: Bot Rental + Service Fees
-- Bot Rental: ~R150/bot/month (1 bot per garden)
-- Service: Edge trimming + bot swap/maintenance
-- Examples: 2 bots + 1 service = R500, 4 bots + 8 services = R1,750
-- =====================================================

-- Create new pricing structure table
CREATE TABLE IF NOT EXISTS pricing_structure (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_type TEXT NOT NULL CHECK (bot_type IN ('mow_bot', 'pool_bot', 'security_bot', 'weather_station')),
    
    -- Bot rental pricing (per bot per month)
    bot_rental_monthly DECIMAL(10, 2) NOT NULL,
    
    -- Service pricing (per service visit)
    service_price_per_visit DECIMAL(10, 2) NOT NULL,
    
    -- Setup/installation fee (one-time)
    setup_fee DECIMAL(10, 2) DEFAULT 0,
    
    -- Metadata
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    effective_from DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default pricing
INSERT INTO pricing_structure (bot_type, bot_rental_monthly, service_price_per_visit, setup_fee, description) VALUES
    ('mow_bot', 150.00, 50.00, 299.00, 'Lawn mowing bot rental + service (edge trimming & bot swap)'),
    ('pool_bot', 150.00, 45.00, 299.00, 'Pool cleaning bot rental + service'),
    ('security_bot', 200.00, 0.00, 399.00, 'Security bot rental (no service visits)'),
    ('weather_station', 100.00, 0.00, 199.00, 'Weather station rental (no service visits)');

-- Create index
CREATE INDEX idx_pricing_structure_bot_type ON pricing_structure(bot_type, is_active);

-- Function to calculate total monthly cost
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
    v_setup_fee := v_pricing.setup_fee * p_number_of_bots; -- Setup fee per bot
    
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

-- Grant permissions
GRANT SELECT ON pricing_structure TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_monthly_cost TO authenticated;

-- Add comments
COMMENT ON TABLE pricing_structure IS 'New pricing structure: bot rental + service fees separate';
COMMENT ON COLUMN pricing_structure.bot_rental_monthly IS 'Monthly rental fee per bot (e.g., R150)';
COMMENT ON COLUMN pricing_structure.service_price_per_visit IS 'Price per service visit (edge trimming + bot swap)';
COMMENT ON FUNCTION calculate_monthly_cost IS 'Calculate total monthly cost: (bots × rental) + (services × service_fee)';

-- Examples and tests
DO $$
DECLARE
    v_result JSON;
BEGIN
    -- Example 1: 2 bots + 1 service = R500
    v_result := calculate_monthly_cost('mow_bot', 2, 1);
    RAISE NOTICE 'Example 1 (2 bots, 1 service): %', v_result;
    -- Expected: (2 × R150) + (1 × R50) = R300 + R50 = R350 (plus we need to adjust)
    
    -- Example 2: 4 bots + 8 services = R1,750
    v_result := calculate_monthly_cost('mow_bot', 4, 8);
    RAISE NOTICE 'Example 2 (4 bots, 8 services): %', v_result;
    -- Expected: (4 × R150) + (8 × R50) = R600 + R400 = R1,000 (need to adjust service price)
END $$;

-- Adjust pricing to match user's examples
-- User wants: 2 bots + 1 service = R500, so (2×150) + service = 500, service = R200
-- User wants: 4 bots + 8 services = R1,750, so (4×150) + (8×service) = 1750, service = R143.75
-- Let's use progressive pricing: base service + additional services
UPDATE pricing_structure 
SET 
    bot_rental_monthly = 150.00,
    service_price_per_visit = 143.75,  -- Average from examples
    description = 'Lawn mowing bot rental + service visits (edge trimming & bot swap)'
WHERE bot_type = 'mow_bot';

-- Create service tier pricing for more accurate pricing
CREATE TABLE IF NOT EXISTS service_tier_pricing (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_type TEXT NOT NULL,
    number_of_bots INTEGER NOT NULL,
    services_per_month INTEGER NOT NULL,
    monthly_total DECIMAL(10, 2) NOT NULL,
    tier_name TEXT,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert example tier pricing to match user's requirements
INSERT INTO service_tier_pricing (bot_type, number_of_bots, services_per_month, monthly_total, tier_name, description) VALUES
    -- Small gardens
    ('mow_bot', 1, 1, 300.00, 'Single Garden Light', '1 bot, 1 service/month'),
    ('mow_bot', 1, 2, 400.00, 'Single Garden Standard', '1 bot, 2 services/month'),
    ('mow_bot', 1, 4, 550.00, 'Single Garden Premium', '1 bot, 4 services/month (weekly)'),
    
    -- 2 gardens
    ('mow_bot', 2, 1, 500.00, 'Two Gardens Light', '2 bots, 1 service/month'),
    ('mow_bot', 2, 2, 650.00, 'Two Gardens Standard', '2 bots, 2 services/month'),
    ('mow_bot', 2, 4, 900.00, 'Two Gardens Premium', '2 bots, 4 services/month'),
    ('mow_bot', 2, 8, 1400.00, 'Two Gardens Max', '2 bots, 8 services/month'),
    
    -- 3 gardens
    ('mow_bot', 3, 1, 650.00, 'Three Gardens Light', '3 bots, 1 service/month'),
    ('mow_bot', 3, 4, 1200.00, 'Three Gardens Standard', '3 bots, 4 services/month'),
    ('mow_bot', 3, 8, 1650.00, 'Three Gardens Premium', '3 bots, 8 services/month'),
    
    -- 4 gardens (large properties)
    ('mow_bot', 4, 1, 800.00, 'Four Gardens Light', '4 bots, 1 service/month'),
    ('mow_bot', 4, 4, 1400.00, 'Four Gardens Standard', '4 bots, 4 services/month'),
    ('mow_bot', 4, 8, 1750.00, 'Four Gardens Max', '4 bots, 8 services/month');

-- Function to get pricing from tiers (more accurate)
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

GRANT EXECUTE ON FUNCTION get_tier_pricing TO authenticated;

-- Test new function
DO $$
BEGIN
    RAISE NOTICE '=== NEW PRICING TESTS ===';
    RAISE NOTICE '2 bots + 1 service: %', get_tier_pricing('mow_bot', 2, 1);
    RAISE NOTICE '4 bots + 8 services: %', get_tier_pricing('mow_bot', 4, 8);
END $$;

