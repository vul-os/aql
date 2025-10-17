-- =====================================================
-- Seed Data
-- =====================================================

-- =====================================================
-- PRICING STRUCTURE SEED DATA
-- =====================================================

-- Insert default pricing
INSERT INTO pricing_structure (bot_type, bot_rental_monthly, service_price_per_visit, setup_fee, description) VALUES
    ('mow_bot', 150.00, 143.75, 299.00, 'Lawn mowing bot rental + service (edge trimming & bot swap)'),
    ('pool_bot', 150.00, 45.00, 299.00, 'Pool cleaning bot rental + service'),
    ('security_bot', 200.00, 0.00, 399.00, 'Security bot rental (no service visits)'),
    ('weather_station', 100.00, 0.00, 199.00, 'Weather station rental (no service visits)');

-- =====================================================
-- SERVICE TIER PRICING SEED DATA
-- =====================================================

-- Insert tier pricing to match common configurations
INSERT INTO service_tier_pricing (bot_type, number_of_bots, services_per_month, monthly_total, tier_name, description) VALUES
    -- Small gardens (1 bot)
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

-- =====================================================
-- COVERAGE AREAS SEED DATA (South Africa)
-- =====================================================

-- KwaZulu-Natal coverage
INSERT INTO coverage_areas (
    country, country_code, province, city, 
    center_latitude, center_longitude, 
    is_active, notes
) VALUES
    ('South Africa', 'ZA', 'KwaZulu-Natal', 'Durban', -29.8587, 31.0218, true, 'Main service area'),
    ('South Africa', 'ZA', 'KwaZulu-Natal', 'Pietermaritzburg', -29.6100, 30.3925, true, 'Secondary service area'),
    ('South Africa', 'ZA', 'Gauteng', 'Johannesburg', -26.2041, 28.0473, false, 'Future expansion area'),
    ('South Africa', 'ZA', 'Gauteng', 'Pretoria', -25.7479, 28.2293, false, 'Future expansion area'),
    ('South Africa', 'ZA', 'Western Cape', 'Cape Town', -33.9249, 18.4241, false, 'Future expansion area');

-- Success message
DO $$
BEGIN
    RAISE NOTICE '=== SEED DATA INSERTED ===';
    RAISE NOTICE 'Pricing structure: 4 bot types';
    RAISE NOTICE 'Service tiers: 13 pricing tiers';
    RAISE NOTICE 'Coverage areas: 5 locations (2 active in KZN, 3 future expansion)';
    RAISE NOTICE '';
    RAISE NOTICE 'Test pricing with: SELECT get_tier_pricing(''mow_bot'', 2, 1);';
END $$;

