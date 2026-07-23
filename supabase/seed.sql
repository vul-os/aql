-- =====================================================
-- BotKorp Database Seed Data
-- Sample data for development and testing
-- =====================================================

-- Note: In production, this file should only contain initial/default data
-- User accounts will be created through Supabase Auth

-- =====================================================
-- SAMPLE ORGANIZATIONS
-- =====================================================
INSERT INTO organizations (id, name, slug, description, subscription_tier, is_active) VALUES
    ('00000000-0000-0000-0000-000000000001', 'BotKorp Demo', 'botkorp-demo', 'Demo organization for testing', 'premium', true),
    ('00000000-0000-0000-0000-000000000002', 'Green Acres Landscaping', 'green-acres', 'Professional landscaping services', 'basic', true),
    ('00000000-0000-0000-0000-000000000003', 'SmartHome Security Inc', 'smarthome-sec', 'Security and monitoring solutions', 'enterprise', true)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- SAMPLE LOCATIONS
-- =====================================================
INSERT INTO locations (id, organization_id, name, address, city, state, postal_code, latitude, longitude, location_type, is_active) VALUES
    ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Headquarters', '123 Tech Street', 'San Francisco', 'CA', '94102', 37.7749, -122.4194, 'commercial', true),
    ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'Client Site A', '456 Garden Lane', 'Austin', 'TX', '73301', 30.2672, -97.7431, 'residential', true),
    ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003', 'Corporate Campus', '789 Business Blvd', 'Seattle', 'WA', '98101', 47.6062, -122.3321, 'commercial', true)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- SAMPLE BOTS
-- =====================================================
INSERT INTO bots (id, location_id, name, bot_type, serial_number, hardware_version, firmware_version, status, is_enabled, battery_level, connection_type) VALUES
    -- Mow Bots
    ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'MowBot Alpha', 'mow_bot', 'MB-2024-001', 'v2.1', '1.5.2', 'idle', true, 85, 'wifi'),
    ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'MowBot Beta', 'mow_bot', 'MB-2024-002', 'v2.1', '1.5.2', 'charging', true, 45, 'wifi'),
    
    -- Weather Stations
    ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Weather Station HQ', 'weather_station', 'WS-2024-001', 'v1.3', '2.1.0', 'online', true, NULL, 'ethernet'),
    ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'Weather Station Site A', 'weather_station', 'WS-2024-002', 'v1.3', '2.1.0', 'online', true, NULL, 'cellular'),
    
    -- Pool Bots
    ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', 'PoolBot 1', 'pool_bot', 'PB-2024-001', 'v3.0', '1.2.4', 'active', true, 92, 'wifi'),
    
    -- Security Bots
    ('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000003', 'Security Cam Front', 'security_bot', 'SB-2024-001', 'v4.2', '3.1.5', 'online', true, NULL, 'ethernet'),
    ('20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000003', 'Security Cam Rear', 'security_bot', 'SB-2024-002', 'v4.2', '3.1.5', 'online', true, NULL, 'ethernet'),
    ('20000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', 'Security Patrol Bot', 'security_bot', 'SB-2024-003', 'v4.5', '3.2.1', 'idle', true, 78, 'wifi')
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- SAMPLE BOT COMMANDS (Recent History)
-- =====================================================
INSERT INTO bot_commands (bot_id, command_type, command_payload, status, sent_at, acknowledged_at, completed_at) VALUES
    ('20000000-0000-0000-0000-000000000001', 'start', '{"zone": "front_lawn", "pattern": "stripe"}', 'completed', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour'),
    ('20000000-0000-0000-0000-000000000002', 'return_home', '{}', 'completed', NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '20 minutes'),
    ('20000000-0000-0000-0000-000000000006', 'start_recording', '{"duration": 3600, "quality": "high"}', 'completed', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour')
ON CONFLICT DO NOTHING;

-- =====================================================
-- SAMPLE BOT TELEMETRY (Recent Data)
-- =====================================================
INSERT INTO bot_telemetry (bot_id, timestamp, telemetry_type, data) VALUES
    ('20000000-0000-0000-0000-000000000001', NOW() - INTERVAL '5 minutes', 'status', '{"battery": 85, "temperature": 72, "runtime_minutes": 45}'),
    ('20000000-0000-0000-0000-000000000003', NOW() - INTERVAL '10 minutes', 'weather_data', '{"temperature": 68, "humidity": 45, "pressure": 1013.25, "wind_speed": 5.2}'),
    ('20000000-0000-0000-0000-000000000005', NOW() - INTERVAL '3 minutes', 'water_quality', '{"ph": 7.2, "chlorine": 1.5, "temperature": 82}'),
    ('20000000-0000-0000-0000-000000000006', NOW() - INTERVAL '1 minute', 'status', '{"recording": true, "storage_used_gb": 124, "uptime_hours": 720}')
ON CONFLICT DO NOTHING;

-- =====================================================
-- SAMPLE BOT SCHEDULES
-- =====================================================
INSERT INTO bot_schedules (bot_id, name, schedule_type, time_of_day, days_of_week, command_type, command_payload, is_enabled, next_run_at) VALUES
    ('20000000-0000-0000-0000-000000000001', 'Daily Morning Mow', 'daily', '08:00:00', ARRAY[1,2,3,4,5], 'start', '{"zone": "all", "pattern": "random"}', true, NOW() + INTERVAL '1 day'),
    ('20000000-0000-0000-0000-000000000005', 'Pool Cleaning - MWF', 'weekly', '06:00:00', ARRAY[1,3,5], 'start', '{"mode": "deep_clean"}', true, NOW() + INTERVAL '2 days'),
    ('20000000-0000-0000-0000-000000000006', 'Nightly Security Recording', 'daily', '20:00:00', ARRAY[0,1,2,3,4,5,6], 'start_recording', '{"duration": 43200, "quality": "high"}', true, NOW())
ON CONFLICT DO NOTHING;

-- =====================================================
-- SAMPLE BOT ALERTS
-- =====================================================
INSERT INTO bot_alerts (bot_id, location_id, alert_type, severity, title, message, is_read, is_resolved) VALUES
    ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'low_battery', 'warning', 'Low Battery - MowBot Beta', 'Battery level at 45%, returning to charging station', true, true),
    ('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000003', 'motion_detected', 'info', 'Motion Detected - Front Camera', 'Motion detected in Zone A at front entrance', false, false),
    ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'weather_alert', 'warning', 'High Wind Alert', 'Wind speeds exceeding 25 mph detected', false, false)
ON CONFLICT DO NOTHING;

-- =====================================================
-- COVERAGE AREAS (South Africa)
-- =====================================================
INSERT INTO coverage_areas (id, country, country_code, province, city, area_name, postal_codes, center_latitude, center_longitude, radius_km, is_active, service_types) VALUES
    ('30000000-0000-0000-0000-000000000001', 'South Africa', 'ZA', 'KwaZulu-Natal', 'Durban', 'Durban Central', ARRAY['4000', '4001'], -29.8587, 31.0218, 15.0, true, ARRAY['mow_bot', 'weather_station', 'pool_bot', 'security_bot']),
    ('30000000-0000-0000-0000-000000000002', 'South Africa', 'ZA', 'KwaZulu-Natal', 'Durban', 'Umhlanga', ARRAY['4320', '4319'], -29.7280, 31.0828, 10.0, true, ARRAY['mow_bot', 'weather_station', 'pool_bot', 'security_bot']),
    ('30000000-0000-0000-0000-000000000003', 'South Africa', 'ZA', 'KwaZulu-Natal', 'Pietermaritzburg', 'PMB Central', ARRAY['3201', '3200'], -29.6017, 30.3794, 12.0, true, ARRAY['mow_bot', 'weather_station', 'pool_bot', 'security_bot']),
    ('30000000-0000-0000-0000-000000000004', 'South Africa', 'ZA', 'Gauteng', 'Johannesburg', 'Sandton', ARRAY['2196', '2031'], -26.1076, 28.0567, 15.0, true, ARRAY['mow_bot', 'weather_station', 'pool_bot', 'security_bot']),
    ('30000000-0000-0000-0000-000000000005', 'South Africa', 'ZA', 'Western Cape', 'Cape Town', 'CBD', ARRAY['8001', '8000'], -33.9249, 18.4241, 20.0, true, ARRAY['mow_bot', 'weather_station', 'pool_bot', 'security_bot'])
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- BOT PRICING (in ZAR - South African Rand)
-- =====================================================
INSERT INTO bot_pricing (id, bot_type, coverage_area_id, monthly_rate, quarterly_rate, annual_rate, setup_fee, currency, tier, is_active) VALUES
    -- Durban Central pricing
    ('40000000-0000-0000-0000-000000000001', 'mow_bot', '30000000-0000-0000-0000-000000000001', 899.00, 2550.00, 9600.00, 500.00, 'ZAR', 'standard', true),
    ('40000000-0000-0000-0000-000000000002', 'weather_station', '30000000-0000-0000-0000-000000000001', 299.00, 850.00, 3200.00, 200.00, 'ZAR', 'standard', true),
    ('40000000-0000-0000-0000-000000000003', 'pool_bot', '30000000-0000-0000-0000-000000000001', 799.00, 2250.00, 8500.00, 400.00, 'ZAR', 'standard', true),
    ('40000000-0000-0000-0000-000000000004', 'security_bot', '30000000-0000-0000-0000-000000000001', 1299.00, 3700.00, 14000.00, 800.00, 'ZAR', 'standard', true),
    
    -- Umhlanga pricing (Premium area)
    ('40000000-0000-0000-0000-000000000005', 'mow_bot', '30000000-0000-0000-0000-000000000002', 999.00, 2850.00, 10800.00, 600.00, 'ZAR', 'premium', true),
    ('40000000-0000-0000-0000-000000000006', 'pool_bot', '30000000-0000-0000-0000-000000000002', 899.00, 2550.00, 9600.00, 500.00, 'ZAR', 'premium', true),
    ('40000000-0000-0000-0000-000000000007', 'security_bot', '30000000-0000-0000-0000-000000000002', 1499.00, 4250.00, 16000.00, 1000.00, 'ZAR', 'premium', true)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- SERVICE FEES (in ZAR)
-- Note: Service fees are now managed via migration 20251012000010_ensure_service_fees.sql
-- This ensures fees are always in sync with the database
-- =====================================================

-- =====================================================
-- ORGANIZATION MEMBERS
-- =====================================================
-- Note: Actual user_ids will come from Supabase Auth
-- These are examples showing the structure
INSERT INTO organization_members (organization_id, user_id, role, can_manage_bots, can_manage_locations, can_view_billing, can_manage_billing, can_manage_members, status) VALUES
    -- Admin with full permissions
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000099', 'admin', true, true, true, true, true, 'active'),
    -- Manager with limited permissions
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000098', 'manager', true, true, true, false, false, 'active'),
    -- Operator (can only manage bots)
    ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000097', 'operator', true, false, false, false, false, 'active'),
    -- Viewer (read-only)
    ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000096', 'viewer', false, false, false, false, false, 'active')
ON CONFLICT (organization_id, user_id) DO NOTHING;

-- =====================================================
-- SUBSCRIPTIONS (Sample active subscriptions)
-- =====================================================
INSERT INTO subscriptions (id, organization_id, bot_id, pricing_id, status, billing_cycle, amount, currency, start_date, next_billing_date, auto_renew) VALUES
    ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'active', 'monthly', 899.00, 'ZAR', CURRENT_DATE - INTERVAL '15 days', CURRENT_DATE + INTERVAL '15 days', true),
    ('60000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000005', 'active', 'annual', 10800.00, 'ZAR', CURRENT_DATE - INTERVAL '60 days', CURRENT_DATE + INTERVAL '305 days', true),
    ('60000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000002', 'active', 'monthly', 299.00, 'ZAR', CURRENT_DATE - INTERVAL '5 days', CURRENT_DATE + INTERVAL '25 days', true)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- PAYMENTS (Sample payment history)
-- =====================================================
INSERT INTO payments (id, organization_id, amount, currency, status, payment_method, payment_type, description, paid_at, bot_id) VALUES
    ('70000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 899.00, 'ZAR', 'completed', 'ozow', 'subscription', 'Monthly subscription - MowBot Alpha', NOW() - INTERVAL '15 days', '20000000-0000-0000-0000-000000000001'),
    ('70000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 500.00, 'ZAR', 'completed', 'ozow', 'setup_fee', 'Setup fee - MowBot Alpha', NOW() - INTERVAL '45 days', '20000000-0000-0000-0000-000000000001'),
    ('70000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 10800.00, 'ZAR', 'completed', 'ozow', 'subscription', 'Annual subscription - MowBot Beta', NOW() - INTERVAL '60 days', '20000000-0000-0000-0000-000000000002'),
    ('70000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000003', 1499.00, 'ZAR', 'pending', 'ozow', 'subscription', 'Monthly subscription - Security Cam Front', NULL, '20000000-0000-0000-0000-000000000006')
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- INVOICES (Sample invoices)
-- =====================================================
INSERT INTO invoices (id, organization_id, invoice_number, status, subtotal, tax_amount, total_amount, amount_paid, currency, issue_date, due_date, paid_at, payment_id, line_items) VALUES
    ('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'INV-2024-00001', 'paid', 899.00, 134.85, 1033.85, 1033.85, 'ZAR', CURRENT_DATE - INTERVAL '15 days', CURRENT_DATE - INTERVAL '5 days', NOW() - INTERVAL '15 days', '70000000-0000-0000-0000-000000000001', 
        '[{"description": "MowBot Alpha - Monthly Subscription", "quantity": 1, "unit_price": 899.00, "amount": 899.00}]'::jsonb),
    ('80000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'INV-2024-00002', 'paid', 10800.00, 1620.00, 12420.00, 12420.00, 'ZAR', CURRENT_DATE - INTERVAL '60 days', CURRENT_DATE - INTERVAL '50 days', NOW() - INTERVAL '60 days', '70000000-0000-0000-0000-000000000003', 
        '[{"description": "MowBot Beta - Annual Subscription", "quantity": 1, "unit_price": 10800.00, "amount": 10800.00}]'::jsonb),
    ('80000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003', 'INV-2024-00003', 'sent', 1499.00, 224.85, 1723.85, 0, 'ZAR', CURRENT_DATE, CURRENT_DATE + INTERVAL '7 days', NULL, '70000000-0000-0000-0000-000000000004', 
        '[{"description": "Security Cam Front - Monthly Subscription", "quantity": 1, "unit_price": 1499.00, "amount": 1499.00}]'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- GARDENS (Sample lawns/gardens at locations)
-- =====================================================
INSERT INTO gardens (id, location_id, name, description, area_sqm, perimeter_m, grass_type, terrain_type, difficulty_level, has_obstacles, preferred_cut_height_mm, preferred_pattern, mowing_frequency_days, images, is_active) VALUES
    ('90000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Front Lawn', 'Main entrance lawn area', 250.00, 65.00, 'Kikuyu', 'flat', 'easy', false, 40, 'stripe', 7, 
        ARRAY['https://cdn.botkorp.co.za/gardens/front-lawn-1.jpg', 'https://cdn.botkorp.co.za/gardens/front-lawn-2.jpg'], true),
    ('90000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Back Garden', 'Large back garden with trees', 450.00, 95.00, 'LM Grass', 'mixed', 'moderate', true, 45, 'random', 7, 
        ARRAY['https://cdn.botkorp.co.za/gardens/back-garden-1.jpg'], true),
    ('90000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'Main Lawn', 'Primary lawn area', 600.00, 110.00, 'Buffalo', 'flat', 'easy', false, 50, 'stripe', 5, 
        ARRAY['https://cdn.botkorp.co.za/gardens/main-lawn-1.jpg', 'https://cdn.botkorp.co.za/gardens/main-lawn-2.jpg', 'https://cdn.botkorp.co.za/gardens/main-lawn-3.jpg'], true),
    ('90000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'Side Yard', 'Narrow side passage', 80.00, 40.00, 'Kikuyu', 'flat', 'moderate', true, 40, 'stripe', 14, 
        ARRAY['https://cdn.botkorp.co.za/gardens/side-yard-1.jpg'], true),
    ('90000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000003', 'Corporate Grounds', 'Main corporate lawn', 1200.00, 180.00, 'LM Grass', 'flat', 'easy', false, 35, 'checkerboard', 3, 
        ARRAY['https://cdn.botkorp.co.za/gardens/corporate-1.jpg'], true)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- POOLS (Sample pools at locations)
-- =====================================================
INSERT INTO pools (id, location_id, name, description, pool_type, length_m, width_m, depth_shallow_m, depth_deep_m, volume_liters, surface_area_sqm, has_heater, has_cover, has_salt_system, filtration_type, images, cleaning_frequency_days, target_ph_min, target_ph_max, is_active) VALUES
    ('A0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Main Pool', 'Standard residential pool', 'inground', 10.00, 5.00, 1.20, 2.40, 75000, 50.00, true, true, false, 'sand', 
        ARRAY['https://cdn.botkorp.co.za/pools/main-pool-1.jpg', 'https://cdn.botkorp.co.za/pools/main-pool-2.jpg'], 7, 7.2, 7.6, true),
    ('A0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Family Pool', 'Large family pool with shallow end', 'inground', 12.00, 6.00, 1.00, 2.00, 90000, 72.00, true, true, true, 'cartridge', 
        ARRAY['https://cdn.botkorp.co.za/pools/family-pool-1.jpg'], 7, 7.2, 7.6, true),
    ('A0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'Lap Pool', 'Long lap pool for exercise', 'lap', 20.00, 3.00, 1.50, 1.50, 90000, 60.00, false, false, true, 'DE', 
        ARRAY['https://cdn.botkorp.co.za/pools/lap-pool-1.jpg'], 5, 7.2, 7.6, true),
    ('A0000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003', 'Corporate Pool', 'Corporate facility pool', 'inground', 15.00, 8.00, 1.20, 2.50, 150000, 120.00, true, true, true, 'sand', 
        ARRAY['https://cdn.botkorp.co.za/pools/corporate-pool-1.jpg'], 3, 7.2, 7.6, true)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- BOT-GARDEN ASSIGNMENTS
-- =====================================================
INSERT INTO bot_garden_assignments (bot_id, garden_id, is_primary, is_active, assigned_at, total_mows, total_runtime_minutes, last_mowed_at) VALUES
    ('20000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', true, true, NOW() - INTERVAL '60 days', 8, 480, NOW() - INTERVAL '3 days'),
    ('20000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', true, true, NOW() - INTERVAL '60 days', 8, 720, NOW() - INTERVAL '3 days'),
    ('20000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000003', true, true, NOW() - INTERVAL '45 days', 9, 1080, NOW() - INTERVAL '2 days'),
    ('20000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000004', true, true, NOW() - INTERVAL '45 days', 3, 90, NOW() - INTERVAL '10 days')
ON CONFLICT (bot_id, garden_id) DO NOTHING;

-- =====================================================
-- BOT-POOL ASSIGNMENTS
-- =====================================================
INSERT INTO bot_pool_assignments (bot_id, pool_id, is_primary, is_active, assigned_at, total_cleanings, total_runtime_minutes, last_cleaned_at) VALUES
    ('20000000-0000-0000-0000-000000000005', 'A0000000-0000-0000-0000-000000000001', true, true, NOW() - INTERVAL '50 days', 7, 420, NOW() - INTERVAL '4 days'),
    ('20000000-0000-0000-0000-000000000005', 'A0000000-0000-0000-0000-000000000002', false, true, NOW() - INTERVAL '30 days', 4, 320, NOW() - INTERVAL '6 days')
ON CONFLICT (bot_id, pool_id) DO NOTHING;

-- =====================================================
-- UPDATE BOTS WITH SERVICE INFO
-- =====================================================
UPDATE bots SET 
    identifier = 'MB-ALPHA-001',
    date_installed = NOW() - INTERVAL '90 days',
    last_service_date = NOW() - INTERVAL '30 days',
    next_service_date = NOW() + INTERVAL '60 days',
    service_interval_days = 90,
    total_runtime_hours = 24.5,
    total_operations = 16,
    warranty_expires_at = CURRENT_DATE + INTERVAL '2 years'
WHERE id = '20000000-0000-0000-0000-000000000001';

UPDATE bots SET 
    identifier = 'MB-BETA-002',
    date_installed = NOW() - INTERVAL '75 days',
    last_service_date = NOW() - INTERVAL '15 days',
    next_service_date = NOW() + INTERVAL '75 days',
    service_interval_days = 90,
    total_runtime_hours = 32.0,
    total_operations = 12,
    warranty_expires_at = CURRENT_DATE + INTERVAL '2 years'
WHERE id = '20000000-0000-0000-0000-000000000002';

UPDATE bots SET 
    identifier = 'WS-HQ-001',
    date_installed = NOW() - INTERVAL '120 days',
    last_service_date = NOW() - INTERVAL '60 days',
    next_service_date = NOW() + INTERVAL '120 days',
    service_interval_days = 180,
    warranty_expires_at = CURRENT_DATE + INTERVAL '3 years'
WHERE id = '20000000-0000-0000-0000-000000000003';

UPDATE bots SET 
    identifier = 'PB-001',
    date_installed = NOW() - INTERVAL '60 days',
    last_service_date = NOW() - INTERVAL '30 days',
    next_service_date = NOW() + INTERVAL '60 days',
    service_interval_days = 90,
    total_runtime_hours = 18.5,
    total_operations = 11,
    warranty_expires_at = CURRENT_DATE + INTERVAL '2 years'
WHERE id = '20000000-0000-0000-0000-000000000005';

UPDATE bots SET 
    identifier = 'SB-FRONT-001',
    date_installed = NOW() - INTERVAL '180 days',
    last_service_date = NOW() - INTERVAL '90 days',
    next_service_date = NOW() + INTERVAL '90 days',
    service_interval_days = 180,
    warranty_expires_at = CURRENT_DATE + INTERVAL '3 years'
WHERE id = '20000000-0000-0000-0000-000000000006';

-- =====================================================
-- SERVICE RECORDS (Sample service history)
-- =====================================================
INSERT INTO service_records (id, bot_id, location_id, service_type, title, description, performed_by_name, scheduled_date, service_start, service_end, duration_minutes, status, total_cost, currency, actions_taken) VALUES
    ('B0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'installation', 'Initial Installation', 'First installation and setup of MowBot Alpha', 'John Smith', CURRENT_DATE - 90, NOW() - INTERVAL '90 days', NOW() - INTERVAL '90 days' + INTERVAL '2 hours', 120, 'completed', 500.00, 'ZAR', 
        ARRAY['Installed bot', 'Configured settings', 'Mapped garden boundaries', 'Trained customer']),
    ('B0000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'routine_maintenance', 'Quarterly Maintenance', 'Standard 3-month maintenance check', 'Sarah Johnson', CURRENT_DATE - 30, NOW() - INTERVAL '30 days', NOW() - INTERVAL '30 days' + INTERVAL '90 minutes', 90, 'completed', 250.00, 'ZAR', 
        ARRAY['Cleaned sensors', 'Sharpened blades', 'Updated firmware', 'Checked battery health']),
    ('B0000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', 'part_replacement', 'Filter Replacement', 'Replaced pool bot filter', 'Mike Davis', CURRENT_DATE - 30, NOW() - INTERVAL '30 days', NOW() - INTERVAL '30 days' + INTERVAL '45 minutes', 45, 'completed', 450.00, 'ZAR', 
        ARRAY['Replaced filter cartridge', 'Cleaned impeller', 'Tested suction']),
    ('B0000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000003', 'firmware_update', 'Security Update', 'Critical security firmware update', 'Tech Support', CURRENT_DATE - 10, NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days' + INTERVAL '30 minutes', 30, 'completed', 0.00, 'ZAR', 
        ARRAY['Updated firmware to v3.1.5', 'Tested camera functionality', 'Verified connectivity']),
    ('B0000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'routine_maintenance', 'Scheduled Maintenance', 'Upcoming maintenance appointment', 'TBD', CURRENT_DATE + 15, NULL, NULL, NULL, 'scheduled', 250.00, 'ZAR', NULL)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- MOWING SESSIONS (Sample mowing history)
-- =====================================================
INSERT INTO mowing_sessions (bot_id, garden_id, start_time, end_time, duration_minutes, area_mowed_sqm, distance_traveled_m, battery_start, battery_end, battery_used, pattern_used, cut_height_mm, quality_rating, completed_successfully) VALUES
    ('20000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days' + INTERVAL '45 minutes', 45, 250.00, 380.00, 100, 72, 28, 'stripe', 40, 5, true),
    ('20000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days' + INTERVAL '68 minutes', 68, 620.00, 72, 43, 29, 'random', 45, 4, true),
    ('20000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000003', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days' + INTERVAL '95 minutes', 95, 600.00, 890.00, 100, 38, 62, 'stripe', 50, 5, true),
    ('20000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days' + INTERVAL '42 minutes', 42, 250.00, 375.00, 98, 71, 27, 'stripe', 40, 5, true)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- POOL CLEANING SESSIONS (Sample cleaning history)
-- =====================================================
INSERT INTO pool_cleaning_sessions (bot_id, pool_id, start_time, end_time, duration_minutes, area_cleaned_sqm, battery_start, battery_end, battery_used, ph_before, ph_after, chlorine_before, chlorine_after, quality_rating, filter_cleaned, walls_scrubbed, floor_vacuumed, completed_successfully) VALUES
    ('20000000-0000-0000-0000-000000000005', 'A0000000-0000-0000-0000-000000000001', NOW() - INTERVAL '4 days', NOW() - INTERVAL '4 days' + INTERVAL '75 minutes', 75, 50.00, 100, 45, 55, 7.4, 7.3, 1.8, 2.1, 5, true, true, true, true),
    ('20000000-0000-0000-0000-000000000005', 'A0000000-0000-0000-0000-000000000002', NOW() - INTERVAL '6 days', NOW() - INTERVAL '6 days' + INTERVAL '90 minutes', 90, 72.00, 98, 38, 60, 7.6, 7.4, 1.5, 2.0, 4, true, true, true, true),
    ('20000000-0000-0000-0000-000000000005', 'A0000000-0000-0000-0000-000000000001', NOW() - INTERVAL '11 days', NOW() - INTERVAL '11 days' + INTERVAL '72 minutes', 72, 50.00, 100, 47, 53, 7.3, 7.4, 2.2, 2.3, 5, true, true, true, true)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- END OF SEED DATA
-- =====================================================

