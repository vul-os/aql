-- =====================================================
-- Seed Data
-- =====================================================

-- =====================================================
-- PRICING STRUCTURE SEED DATA
-- =====================================================

-- Insert pricing plans (simplified - just mow_bot)
INSERT INTO pricing_plans (bot_type, name, bot_rental_monthly, setup_fee, base_area_included_sqm, price_per_sqm_after_base, description) VALUES
    ('mow_bot', 'MowBot Rental', 150.00, 299.00, 100, 0.50, 'Automated lawn mowing with monthly service');

-- Insert line items for mow_bot (monthly service fee)
INSERT INTO pricing_line_items (pricing_plan_id, item_type, name, description, price_per_unit, unit_type, is_optional, display_order) 
SELECT 
    id, 'service_fee', 'Monthly Service Fee', 'Includes edge trimming, bot servicing, and maintenance', 400.00, 'month', false, 1
FROM pricing_plans WHERE bot_type = 'mow_bot';

-- =====================================================
-- COVERAGE AREAS SEED DATA (South Africa)
-- =====================================================

-- Insert sample promotional discounts
INSERT INTO discounts (code, name, description, discount_type, discount_value, free_months, first_time_customers_only, max_uses_per_customer, valid_until) VALUES
    ('FIRST2FREE', 'First 2 Months Free', 'New customers get first 2 months free', 'free_months', 0, 2, true, 1, NULL),
    ('FIRSTMONTH', 'First Month Free', 'New customers get first month free', 'free_months', 0, 1, true, 1, NULL),
    ('SUMMER20', 'Summer 20% Off', '20% off first 3 months', 'percentage', 20.00, 0, false, 1, '2025-03-31'),
    ('LAUNCH50', 'Launch Special 50% Off', '50% off setup fee', 'percentage', 50.00, 0, true, 1, '2025-12-31');

-- Success message
DO $$
BEGIN
    RAISE NOTICE '=== SEED DATA INSERTED ===';
    RAISE NOTICE 'Pricing: mow_bot';
    RAISE NOTICE '  - Bot Rental: R150/month per bot';
    RAISE NOTICE '  - Service Fee: R400/month (includes edge trimming & bot servicing)';
    RAISE NOTICE '  - Setup Fee: R299 per bot';
    RAISE NOTICE 'Sample discounts: 4 promotional codes';
    RAISE NOTICE '';
    RAISE NOTICE 'Example: 2 bots = R150×2 + R400 = R700/month + R598 setup';
    RAISE NOTICE '';
    RAISE NOTICE 'Test pricing:';
    RAISE NOTICE '  SELECT * FROM get_tier_pricing(''mow_bot'', 2, 1);';
END $$;
