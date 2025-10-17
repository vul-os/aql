-- =====================================================
-- Flexible Service Pricing Structure
-- Handles any number of services per month with tiered pricing
-- =====================================================

-- Add service pricing tiers table
CREATE TABLE IF NOT EXISTS service_pricing_tiers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_type TEXT NOT NULL CHECK (bot_type IN ('mow_bot', 'pool_bot', 'security_bot', 'weather_station')),
    min_services INTEGER NOT NULL,
    max_services INTEGER NOT NULL,
    base_price DECIMAL(10, 2) NOT NULL,
    price_per_service DECIMAL(10, 2) NOT NULL,
    discount_percentage DECIMAL(5, 2) DEFAULT 0,
    tier_name TEXT,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT unique_bot_type_service_range UNIQUE (bot_type, min_services, max_services),
    CONSTRAINT valid_service_range CHECK (min_services <= max_services)
);

CREATE INDEX idx_service_pricing_bot_type ON service_pricing_tiers(bot_type);
CREATE INDEX idx_service_pricing_active ON service_pricing_tiers(is_active);

-- Insert default pricing tiers for mow_bot
-- Pricing strategy: More services = better value per service
INSERT INTO service_pricing_tiers (bot_type, min_services, max_services, base_price, price_per_service, discount_percentage, tier_name, description) VALUES
    -- Light Usage (1-3 services/month) - Higher per-service cost
    ('mow_bot', 1, 1, 350.00, 350.00, 0, 'Pay-As-You-Go', 'Single service per month'),
    ('mow_bot', 2, 3, 250.00, 250.00, 0, 'Light', 'Occasional service (2-3 times monthly)'),
    
    -- Standard (4 services/month) - Base pricing - WEEKLY
    ('mow_bot', 4, 4, 899.00, 224.75, 0, 'Standard', 'Weekly service (4 times monthly)'),
    
    -- Value (5-7 services) - Slight discount
    ('mow_bot', 5, 7, 210.00, 210.00, 7, 'Value', 'More than weekly (5-7 times monthly)'),
    
    -- Premium (8 services/month) - Best value - BI-WEEKLY (2x per week)
    ('mow_bot', 8, 8, 1575.00, 196.88, 12, 'Premium', 'Bi-weekly service (8 times monthly - twice per week)');

-- Add pool bot pricing
INSERT INTO service_pricing_tiers (bot_type, min_services, max_services, base_price, price_per_service, discount_percentage, tier_name, description) VALUES
    ('pool_bot', 1, 1, 300.00, 300.00, 0, 'Pay-As-You-Go', 'Single service per month'),
    ('pool_bot', 2, 3, 220.00, 220.00, 0, 'Light', 'Occasional service'),
    ('pool_bot', 4, 4, 799.00, 199.75, 0, 'Standard', 'Weekly service'),
    ('pool_bot', 5, 7, 185.00, 185.00, 7, 'Value', 'More than weekly'),
    ('pool_bot', 8, 8, 1399.00, 174.88, 12, 'Premium', 'Bi-weekly service (8 times monthly)');

-- Function to calculate price for any number of services
CREATE OR REPLACE FUNCTION calculate_service_price(
    p_bot_type TEXT,
    p_services_count INTEGER
)
RETURNS JSON AS $$
DECLARE
    v_pricing RECORD;
    v_total_price DECIMAL;
    v_price_per_service DECIMAL;
BEGIN
    -- Find the pricing tier for this service count
    SELECT * INTO v_pricing
    FROM service_pricing_tiers
    WHERE bot_type = p_bot_type
    AND p_services_count >= min_services
    AND p_services_count <= max_services
    AND is_active = true
    LIMIT 1;
    
    -- If no tier found, use the closest higher tier or highest tier
    IF v_pricing IS NULL THEN
        SELECT * INTO v_pricing
        FROM service_pricing_tiers
        WHERE bot_type = p_bot_type
        AND is_active = true
        ORDER BY max_services DESC
        LIMIT 1;
    END IF;
    
    -- Calculate total price
    IF v_pricing IS NOT NULL THEN
        -- For range tiers, multiply services by per-service price
        IF v_pricing.min_services < v_pricing.max_services THEN
            v_total_price := v_pricing.price_per_service * p_services_count;
            v_price_per_service := v_pricing.price_per_service;
        ELSE
            -- For fixed tiers, use base price
            v_total_price := v_pricing.base_price;
            v_price_per_service := v_pricing.price_per_service;
        END IF;
        
        RETURN json_build_object(
            'total_price', ROUND(v_total_price, 2),
            'price_per_service', ROUND(v_price_per_service, 2),
            'services_count', p_services_count,
            'tier_name', v_pricing.tier_name,
            'description', v_pricing.description,
            'discount_percentage', v_pricing.discount_percentage,
            'base_price', v_pricing.base_price
        );
    ELSE
        -- Fallback if no pricing found
        RETURN json_build_object(
            'error', 'No pricing found for this service count',
            'total_price', 0,
            'price_per_service', 0,
            'services_count', p_services_count
        );
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to get all available pricing tiers for a bot type
CREATE OR REPLACE FUNCTION get_pricing_tiers(
    p_bot_type TEXT
)
RETURNS TABLE(
    tier_name TEXT,
    services TEXT,
    base_price DECIMAL,
    price_per_service DECIMAL,
    discount_percentage DECIMAL,
    description TEXT,
    savings_vs_payg DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        spt.tier_name,
        CASE 
            WHEN spt.min_services = spt.max_services THEN spt.min_services::TEXT
            ELSE spt.min_services::TEXT || '-' || spt.max_services::TEXT
        END as services,
        spt.base_price,
        spt.price_per_service,
        spt.discount_percentage,
        spt.description,
        CASE 
            WHEN spt.min_services = 1 THEN 0
            ELSE ROUND(((SELECT price_per_service FROM service_pricing_tiers WHERE bot_type = p_bot_type AND min_services = 1 LIMIT 1) - spt.price_per_service) * spt.min_services, 2)
        END as savings_vs_payg
    FROM service_pricing_tiers spt
    WHERE spt.bot_type = p_bot_type
    AND spt.is_active = true
    ORDER BY spt.min_services ASC;
END;
$$ LANGUAGE plpgsql;

-- Comments
COMMENT ON TABLE service_pricing_tiers IS 'Flexible pricing structure for services - supports any number of services per month';
COMMENT ON FUNCTION calculate_service_price IS 'Calculate total price for any number of services based on tiered pricing';
COMMENT ON FUNCTION get_pricing_tiers IS 'Get all available pricing tiers for a bot type with savings comparison';

-- Grant permissions
GRANT SELECT ON service_pricing_tiers TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_service_price TO authenticated;
GRANT EXECUTE ON FUNCTION get_pricing_tiers TO authenticated;

-- Test the functions
DO $$
DECLARE
    v_result JSON;
BEGIN
    -- Test pricing for 3 services (Light tier)
    RAISE NOTICE 'Pricing for 3 services: %', (SELECT calculate_service_price('mow_bot', 3));
    
    -- Test pricing for 4 services (Standard tier)
    RAISE NOTICE 'Pricing for 4 services: %', (SELECT calculate_service_price('mow_bot', 4));
    
    -- Test pricing for 8 services (Premium tier - MAX)
    RAISE NOTICE 'Pricing for 8 services: %', (SELECT calculate_service_price('mow_bot', 8));
    
    -- Show all tiers
    RAISE NOTICE 'All pricing tiers available (1-8 services per month)';
END;
$$;

