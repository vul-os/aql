-- Create Test Bot for Simulator
-- Run this in your Supabase SQL editor

-- First, get a location_id (use an existing location or create one)
-- Option 1: Use an existing location
-- SELECT id FROM locations LIMIT 1;

-- Option 2: Create a test location first (if you don't have any)
-- INSERT INTO locations (organization_id, name, address, latitude, longitude)
-- SELECT 
--   id as organization_id,
--   'Test Location' as name,
--   '123 Test Street, Durban' as address,
--   -29.8587 as latitude,
--   31.0218 as longitude
-- FROM organizations 
-- LIMIT 1
-- RETURNING id;

-- Now create the bot (replace 'your-location-id' with actual location ID)
INSERT INTO bots (
  id, 
  location_id, 
  name, 
  bot_type, 
  serial_number, 
  status,
  battery_level,
  is_enabled
)
VALUES (
  '550e8400-e29b-41d4-a716-446655440000',
  (SELECT id FROM locations LIMIT 1), -- Uses first location in your database
  'Test Mow Bot #1',
  'mow_bot',
  'MOWBOT-TEST-001',
  'online',
  95,
  true
)
ON CONFLICT (id) DO UPDATE
SET 
  location_id = EXCLUDED.location_id,
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  battery_level = EXCLUDED.battery_level,
  is_enabled = EXCLUDED.is_enabled;

-- Verify the bot was created
SELECT 
  id, 
  name, 
  bot_type, 
  location_id, 
  status 
FROM bots 
WHERE id = '550e8400-e29b-41d4-a716-446655440000';

