-- Botserv combined SQL: extensions, schema, functions, smart-home schema, and seeds

-- =====================
-- 1) Extensions
-- =====================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

-- =====================
-- 2) Core schema (initial)
-- =====================
-- Profiles table (extends auth.users)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  phone TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Places table
CREATE TABLE places (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  country TEXT DEFAULT 'South Africa',
  postal_code TEXT,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Place members with roles
CREATE TABLE place_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  place_id UUID REFERENCES places(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member', -- 'owner', 'admin', 'member'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(place_id, user_id)
);

-- Coverage areas
CREATE TABLE coverage_areas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  country TEXT DEFAULT 'South Africa',
  postal_code TEXT,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  radius_km DECIMAL(5, 2) DEFAULT 5.0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bots table
CREATE TABLE bots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  place_id UUID REFERENCES places(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'mowbot', 'poolbot', 'weather_station'
  model TEXT,
  serial_number TEXT UNIQUE,
  status TEXT DEFAULT 'offline', -- 'online', 'offline', 'maintenance', 'error'
  last_seen TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bot schedules
CREATE TABLE bot_schedules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bot_id UUID REFERENCES bots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  schedule_type TEXT NOT NULL, -- 'daily', 'weekly', 'monthly', 'custom'
  schedule_data JSONB NOT NULL, -- Flexible schedule configuration
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bot sensors
CREATE TABLE bot_sensors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bot_id UUID REFERENCES bots(id) ON DELETE CASCADE,
  sensor_type TEXT NOT NULL, -- 'temperature', 'humidity', 'soil_moisture', 'weather'
  sensor_name TEXT NOT NULL,
  value DECIMAL(10, 4),
  unit TEXT,
  metadata JSONB,
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Bot commands
CREATE TABLE bot_commands (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bot_id UUID REFERENCES bots(id) ON DELETE CASCADE,
  command_type TEXT NOT NULL, -- 'start', 'stop', 'pause', 'resume', 'schedule'
  command_data JSONB,
  status TEXT DEFAULT 'pending', -- 'pending', 'sent', 'acknowledged', 'failed'
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  created_by UUID REFERENCES profiles(id)
);

-- Indexes
CREATE INDEX idx_place_members_user_id ON place_members(user_id);
CREATE INDEX idx_place_members_place_id ON place_members(place_id);
CREATE INDEX idx_bots_place_id ON bots(place_id);
CREATE INDEX idx_bot_schedules_bot_id ON bot_schedules(bot_id);
CREATE INDEX idx_bot_sensors_bot_id ON bot_sensors(bot_id);
CREATE INDEX idx_bot_sensors_recorded_at ON bot_sensors(recorded_at);
CREATE INDEX idx_bot_commands_bot_id ON bot_commands(bot_id);
CREATE INDEX idx_coverage_areas_location ON coverage_areas(latitude, longitude);

-- =====================
-- 3) Functions & triggers
-- =====================
-- Function to create user profile when user signs up
CREATE OR REPLACE FUNCTION create_user_profile()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  PERFORM create_default_place(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to automatically create profile when user signs up
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION create_user_profile();

-- Function to create a default place and add user as owner
CREATE OR REPLACE FUNCTION create_default_place(user_id UUID)
RETURNS UUID AS $$
DECLARE
  place_id UUID;
BEGIN
  INSERT INTO places (name, address, city, state, country)
  VALUES ('My Home', 'Address not set', 'City not set', 'Province not set', 'South Africa')
  RETURNING id INTO place_id;
  INSERT INTO place_members (place_id, user_id, role)
  VALUES (place_id, user_id, 'owner');
  RETURN place_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if a location is covered (uses PostGIS)
CREATE OR REPLACE FUNCTION check_coverage(
  lat DECIMAL(10, 8),
  lng DECIMAL(11, 8),
  city TEXT DEFAULT NULL,
  state TEXT DEFAULT NULL,
  postal_code TEXT DEFAULT NULL
)
RETURNS TABLE(
  is_covered BOOLEAN,
  coverage_area_id UUID,
  coverage_area_name TEXT,
  distance_km DECIMAL(5, 2)
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    CASE WHEN ca.id IS NOT NULL THEN true ELSE false END as is_covered,
    ca.id as coverage_area_id,
    ca.name as coverage_area_name,
    CASE 
      WHEN ca.id IS NOT NULL THEN 
        ST_Distance(
          ST_Point(lng, lat)::geography,
          ST_Point(ca.longitude, ca.latitude)::geography
        ) / 1000
      ELSE NULL
    END as distance_km
  FROM coverage_areas ca
  WHERE ca.is_active = true
    AND (
      (lat IS NOT NULL AND lng IS NOT NULL AND 
       ST_DWithin(
         ST_Point(lng, lat)::geography,
         ST_Point(ca.longitude, ca.latitude)::geography,
         ca.radius_km * 1000
       ))
      OR
      (lat IS NULL AND lng IS NULL AND 
       ca.city ILIKE '%' || COALESCE(city, '') || '%' AND
       ca.state ILIKE '%' || COALESCE(state, '') || '%')
      OR
      (postal_code IS NOT NULL AND ca.postal_code = postal_code)
    )
  ORDER BY distance_km ASC NULLS LAST
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add updated_at triggers
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_places_updated_at BEFORE UPDATE ON places FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_bots_updated_at BEFORE UPDATE ON bots FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_bot_schedules_updated_at BEFORE UPDATE ON bot_schedules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================
-- 4) Smart home schema
-- =====================
CREATE TABLE device_types (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  capabilities JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE smart_devices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  place_id UUID REFERENCES places(id) ON DELETE CASCADE,
  device_type_id UUID REFERENCES device_types(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  room TEXT,
  brand TEXT,
  model TEXT,
  serial_number TEXT UNIQUE,
  mac_address TEXT,
  ip_address INET,
  status TEXT DEFAULT 'offline',
  last_seen TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE device_states (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id UUID REFERENCES smart_devices(id) ON DELETE CASCADE,
  state_data JSONB NOT NULL,
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE device_commands (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id UUID REFERENCES smart_devices(id) ON DELETE CASCADE,
  command_type TEXT NOT NULL,
  command_data JSONB,
  status TEXT DEFAULT 'pending',
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  created_by UUID REFERENCES profiles(id),
  response_data JSONB
);

CREATE TABLE device_schedules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id UUID REFERENCES smart_devices(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  schedule_type TEXT NOT NULL,
  schedule_data JSONB NOT NULL,
  action_data JSONB NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE device_groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  place_id UUID REFERENCES places(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  group_type TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE device_group_members (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id UUID REFERENCES device_groups(id) ON DELETE CASCADE,
  device_id UUID REFERENCES smart_devices(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(group_id, device_id)
);

CREATE TABLE scenes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  place_id UUID REFERENCES places(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  scene_data JSONB NOT NULL,
  icon TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Smart home indexes
CREATE INDEX idx_smart_devices_place_id ON smart_devices(place_id);
CREATE INDEX idx_smart_devices_device_type_id ON smart_devices(device_type_id);
CREATE INDEX idx_smart_devices_room ON smart_devices(room);
CREATE INDEX idx_device_states_device_id ON device_states(device_id);
CREATE INDEX idx_device_states_recorded_at ON device_states(recorded_at);
CREATE INDEX idx_device_commands_device_id ON device_commands(device_id);
CREATE INDEX idx_device_commands_status ON device_commands(status);
CREATE INDEX idx_device_schedules_device_id ON device_schedules(device_id);
CREATE INDEX idx_device_groups_place_id ON device_groups(place_id);
CREATE INDEX idx_device_group_members_group_id ON device_group_members(group_id);
CREATE INDEX idx_device_group_members_device_id ON device_group_members(device_id);
CREATE INDEX idx_scenes_place_id ON scenes(place_id);

-- Smart home updated_at triggers
CREATE TRIGGER update_smart_devices_updated_at BEFORE UPDATE ON smart_devices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_device_schedules_updated_at BEFORE UPDATE ON device_schedules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_device_groups_updated_at BEFORE UPDATE ON device_groups FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_scenes_updated_at BEFORE UPDATE ON scenes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================
-- 5) Seeds (core)
-- =====================
INSERT INTO coverage_areas (name, city, state, country, latitude, longitude, radius_km) VALUES
('Cape Town Central', 'Cape Town', 'Western Cape', 'South Africa', -33.9249, 18.4241, 10.0),
('Johannesburg Central', 'Johannesburg', 'Gauteng', 'South Africa', -26.2041, 28.0473, 15.0),
('Durban Central', 'Durban', 'KwaZulu-Natal', 'South Africa', -29.8587, 31.0218, 12.0),
('Pretoria Central', 'Pretoria', 'Gauteng', 'South Africa', -25.7479, 28.2293, 8.0),
('Port Elizabeth Central', 'Port Elizabeth', 'Eastern Cape', 'South Africa', -33.9608, 25.6022, 10.0),
('Bloemfontein Central', 'Bloemfontein', 'Free State', 'South Africa', -29.0852, 26.1596, 8.0),
('Nelspruit Central', 'Nelspruit', 'Mpumalanga', 'South Africa', -25.4745, 30.9703, 6.0),
('Polokwane Central', 'Polokwane', 'Limpopo', 'South Africa', -23.9008, 29.4512, 6.0);

INSERT INTO places (name, address, city, state, country, latitude, longitude) VALUES
('Sample Home Cape Town', '123 Main Street', 'Cape Town', 'Western Cape', 'South Africa', -33.9249, 18.4241),
('Sample Office Johannesburg', '456 Business Ave', 'Johannesburg', 'Gauteng', 'South Africa', -26.2041, 28.0473);

INSERT INTO bots (place_id, name, type, model, serial_number, status) VALUES
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 'MowBot Alpha', 'mowbot', 'MowBot Pro 2024', 'MB001', 'online'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 'PoolBot Beta', 'poolbot', 'PoolBot Clean 2024', 'PB001', 'offline'),
((SELECT id FROM places WHERE name = 'Sample Office Johannesburg'), 'Weather Station Gamma', 'weather_station', 'WeatherPro 2024', 'WS001', 'online');

INSERT INTO bot_schedules (bot_id, name, schedule_type, schedule_data) VALUES
((SELECT id FROM bots WHERE name = 'MowBot Alpha'), 'Daily Morning Mow', 'daily', '{"time": "08:00", "days": ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]}'),
((SELECT id FROM bots WHERE name = 'PoolBot Beta'), 'Weekly Pool Clean', 'weekly', '{"time": "10:00", "days": ["monday", "wednesday", "friday"]}');

INSERT INTO bot_sensors (bot_id, sensor_type, sensor_name, value, unit, metadata) VALUES
((SELECT id FROM bots WHERE name = 'Weather Station Gamma'), 'temperature', 'Outdoor Temperature', 25.5, '°C', '{"location": "outdoor", "accuracy": "±0.1°C"}'),
((SELECT id FROM bots WHERE name = 'Weather Station Gamma'), 'humidity', 'Outdoor Humidity', 65.2, '%', '{"location": "outdoor", "accuracy": "±2%"}'),
((SELECT id FROM bots WHERE name = 'MowBot Alpha'), 'soil_moisture', 'Soil Moisture Sensor', 45.8, '%', '{"depth": "5cm", "location": "front_lawn"}');

-- =====================
-- 6) Seeds (smart home)
-- =====================
INSERT INTO device_types (name, category, description, icon, capabilities) VALUES
('smart_bulb', 'lighting', 'Smart LED Bulb', 'lightbulb', '["on_off", "brightness", "color", "color_temperature"]'),
('smart_strip', 'lighting', 'Smart LED Strip', 'zap', '["on_off", "brightness", "color", "effects"]'),
('smart_switch', 'lighting', 'Smart Light Switch', 'toggle-left', '["on_off", "brightness"]'),
('smart_dimmer', 'lighting', 'Smart Dimmer Switch', 'sun', '["brightness"]'),
('smart_plug', 'power', 'Smart Power Plug', 'plug', '["on_off", "power_monitoring", "timer"]'),
('smart_outlet', 'power', 'Smart Wall Outlet', 'socket', '["on_off", "power_monitoring"]'),
('smart_power_strip', 'power', 'Smart Power Strip', 'layers', '["on_off", "individual_control", "power_monitoring"]'),
('smart_aircon', 'climate', 'Smart Air Conditioner', 'thermometer', '["on_off", "temperature", "mode", "fan_speed", "timer"]'),
('smart_heater', 'climate', 'Smart Heater', 'flame', '["on_off", "temperature", "timer"]'),
('smart_fan', 'climate', 'Smart Fan', 'wind', '["on_off", "speed", "oscillation", "timer"]'),
('smart_thermostat', 'climate', 'Smart Thermostat', 'thermometer-sun', '["temperature", "schedule", "mode"]'),
('smart_tv', 'entertainment', 'Smart TV', 'tv', '["on_off", "volume", "channel", "input", "apps"]'),
('smart_soundbar', 'entertainment', 'Smart Soundbar', 'volume-2', '["on_off", "volume", "input", "equalizer"]'),
('smart_projector', 'entertainment', 'Smart Projector', 'monitor', '["on_off", "brightness", "input", "focus"]'),
('smart_streaming', 'entertainment', 'Streaming Device', 'play-circle', '["on_off", "apps", "volume"]'),
('smart_camera', 'security', 'Smart Security Camera', 'camera', '["on_off", "recording", "night_vision", "motion_detection", "pan_tilt"]'),
('smart_doorbell', 'security', 'Smart Doorbell', 'door-open', '["on_off", "recording", "motion_detection", "two_way_audio"]'),
('smart_door_lock', 'security', 'Smart Door Lock', 'lock', '["lock_unlock", "auto_lock", "access_codes"]'),
('smart_sensor', 'security', 'Motion/Door Sensor', 'activity', '["motion_detection", "door_status", "battery_level"]'),
('smart_washing_machine', 'appliance', 'Smart Washing Machine', 'washing-machine', '["on_off", "programs", "timer", "status"]'),
('smart_dryer', 'appliance', 'Smart Dryer', 'wind', '["on_off", "programs", "timer", "status"]'),
('smart_dishwasher', 'appliance', 'Smart Dishwasher', 'utensils', '["on_off", "programs", "timer", "status"]'),
('smart_refrigerator', 'appliance', 'Smart Refrigerator', 'refrigerator', '["temperature", "door_status", "ice_maker"]'),
('smart_oven', 'appliance', 'Smart Oven', 'flame', '["on_off", "temperature", "timer", "programs"]'),
('smart_coffee_maker', 'appliance', 'Smart Coffee Maker', 'coffee', '["on_off", "timer", "programs", "grind_settings"]'),
('smart_sprinkler', 'garden', 'Smart Sprinkler System', 'droplets', '["on_off", "zones", "timer", "weather_skip"]'),
('smart_gate', 'garden', 'Smart Gate Controller', 'gate', '["open_close", "auto_close", "access_codes"]'),
('smart_pool_heater', 'garden', 'Smart Pool Heater', 'thermometer', '["on_off", "temperature", "timer"]'),
('smart_blinds', 'window', 'Smart Blinds/Shades', 'blinds', '["open_close", "position", "timer"]'),
('smart_curtains', 'window', 'Smart Curtains', 'curtains', '["open_close", "position", "timer"]'),
('smart_window', 'window', 'Smart Window Opener', 'window', '["open_close", "position", "timer"]'),
('air_purifier', 'air_quality', 'Smart Air Purifier', 'wind', '["on_off", "fan_speed", "timer", "air_quality"]'),
('humidifier', 'air_quality', 'Smart Humidifier', 'droplets', '["on_off", "humidity_level", "timer"]'),
('dehumidifier', 'air_quality', 'Smart Dehumidifier', 'droplets', '["on_off", "humidity_level", "timer"]'),
('co2_monitor', 'air_quality', 'CO2 Monitor', 'activity', '["co2_level", "temperature", "humidity"]'),
('smart_speaker', 'other', 'Smart Speaker', 'speaker', '["volume", "music_control", "voice_assistant"]'),
('smart_display', 'other', 'Smart Display', 'monitor', '["on_off", "brightness", "apps", "voice_assistant"]'),
('smart_charger', 'other', 'Smart Charger', 'battery', '["on_off", "charging_status", "timer"]'),
('smart_vacuum', 'other', 'Smart Vacuum', 'vacuum', '["on_off", "cleaning_mode", "schedule", "battery_level"]');

INSERT INTO smart_devices (place_id, device_type_id, name, room, brand, model, status) VALUES
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), (SELECT id FROM device_types WHERE name = 'smart_bulb'), 'Living Room Light', 'living_room', 'Philips', 'Hue White and Color', 'online'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), (SELECT id FROM device_types WHERE name = 'smart_strip'), 'TV Backlight', 'living_room', 'Govee', 'H6159', 'online'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), (SELECT id FROM device_types WHERE name = 'smart_switch'), 'Bedroom Light Switch', 'bedroom', 'TP-Link', 'HS200', 'online'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), (SELECT id FROM device_types WHERE name = 'smart_plug'), 'Coffee Maker Plug', 'kitchen', 'TP-Link', 'HS100', 'online'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), (SELECT id FROM device_types WHERE name = 'smart_outlet'), 'Kitchen Outlet', 'kitchen', 'Leviton', 'DW6HD', 'online'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), (SELECT id FROM device_types WHERE name = 'smart_aircon'), 'Living Room AC', 'living_room', 'Daikin', 'FTXM35R', 'online'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), (SELECT id FROM device_types WHERE name = 'smart_fan'), 'Bedroom Fan', 'bedroom', 'Hunter', 'Signal', 'online'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), (SELECT id FROM device_types WHERE name = 'smart_tv'), 'Living Room TV', 'living_room', 'Samsung', 'QN90A', 'online'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), (SELECT id FROM device_types WHERE name = 'smart_soundbar'), 'TV Soundbar', 'living_room', 'Sonos', 'Beam', 'online'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), (SELECT id FROM device_types WHERE name = 'smart_camera'), 'Front Door Camera', 'outdoor', 'Ring', 'Video Doorbell Pro', 'online'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), (SELECT id FROM device_types WHERE name = 'smart_door_lock'), 'Front Door Lock', 'outdoor', 'August', 'Smart Lock Pro', 'online'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), (SELECT id FROM device_types WHERE name = 'smart_sprinkler'), 'Garden Sprinkler', 'garden', 'Rachio', 'Smart Sprinkler Controller', 'online');

INSERT INTO device_states (device_id, state_data) VALUES
((SELECT id FROM smart_devices WHERE name = 'Living Room Light'), '{"power": true, "brightness": 80, "color": "#ffffff", "color_temperature": 4000}'),
((SELECT id FROM smart_devices WHERE name = 'TV Backlight'), '{"power": true, "brightness": 60, "color": "#00ff00", "effect": "rainbow"}'),
((SELECT id FROM smart_devices WHERE name = 'Coffee Maker Plug'), '{"power": false, "power_consumption": 0, "voltage": 220}'),
((SELECT id FROM smart_devices WHERE name = 'Living Room AC'), '{"power": true, "temperature": 22, "mode": "cool", "fan_speed": "medium"}'),
((SELECT id FROM smart_devices WHERE name = 'Living Room TV'), '{"power": true, "volume": 45, "channel": "HDMI1", "input": "HDMI1"}');

INSERT INTO scenes (place_id, name, description, scene_data, icon) VALUES
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 'Movie Night', 'Perfect lighting for watching movies', '{"devices": {"Living Room Light": {"brightness": 20, "color": "#ff6600"}, "TV Backlight": {"brightness": 30, "color": "#0066ff"}}}', 'film'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 'Good Morning', 'Bright and energizing morning scene', '{"devices": {"Living Room Light": {"brightness": 100, "color": "#ffffff", "color_temperature": 5000}, "Coffee Maker Plug": {"power": true}}}', 'sunrise'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 'Sleep Mode', 'Dim lights for bedtime', '{"devices": {"Living Room Light": {"brightness": 10, "color": "#ff6600"}, "TV Backlight": {"power": false}}}', 'moon');

INSERT INTO device_groups (place_id, name, description, group_type) VALUES
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 'Living Room', 'All devices in the living room', 'room'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 'Kitchen', 'All kitchen appliances and devices', 'room'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 'Security', 'All security and camera devices', 'zone'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 'Entertainment', 'TV, soundbar, and related devices', 'zone');

INSERT INTO device_group_members (group_id, device_id) VALUES
((SELECT id FROM device_groups WHERE name = 'Living Room'), (SELECT id FROM smart_devices WHERE name = 'Living Room Light')),
((SELECT id FROM device_groups WHERE name = 'Living Room'), (SELECT id FROM smart_devices WHERE name = 'TV Backlight')),
((SELECT id FROM device_groups WHERE name = 'Living Room'), (SELECT id FROM smart_devices WHERE name = 'Living Room AC')),
((SELECT id FROM device_groups WHERE name = 'Living Room'), (SELECT id FROM smart_devices WHERE name = 'Living Room TV')),
((SELECT id FROM device_groups WHERE name = 'Living Room'), (SELECT id FROM smart_devices WHERE name = 'TV Soundbar')),
((SELECT id FROM device_groups WHERE name = 'Kitchen'), (SELECT id FROM smart_devices WHERE name = 'Coffee Maker Plug')),
((SELECT id FROM device_groups WHERE name = 'Kitchen'), (SELECT id FROM smart_devices WHERE name = 'Kitchen Outlet')),
((SELECT id FROM device_groups WHERE name = 'Security'), (SELECT id FROM smart_devices WHERE name = 'Front Door Camera')),
((SELECT id FROM device_groups WHERE name = 'Security'), (SELECT id FROM smart_devices WHERE name = 'Front Door Lock')),
((SELECT id FROM device_groups WHERE name = 'Entertainment'), (SELECT id FROM smart_devices WHERE name = 'Living Room TV')),
((SELECT id FROM device_groups WHERE name = 'Entertainment'), (SELECT id FROM smart_devices WHERE name = 'TV Soundbar')),
((SELECT id FROM device_groups WHERE name = 'Entertainment'), (SELECT id FROM smart_devices WHERE name = 'TV Backlight'));

-- =====================
-- 7) Row Level Security (minimal safe-by-default)
-- =====================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow users to view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY IF NOT EXISTS "Allow users to update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

ALTER TABLE places ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow members to view places" ON places
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM place_members pm WHERE pm.place_id = places.id AND pm.user_id = auth.uid()
  ));

ALTER TABLE place_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow members to view memberships" ON place_members
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM place_members pm WHERE pm.place_id = place_members.place_id AND pm.user_id = auth.uid()
  ));

ALTER TABLE coverage_areas ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Public read coverage" ON coverage_areas
  FOR SELECT USING (true);

ALTER TABLE bots ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow members to read bots" ON bots
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM place_members pm WHERE pm.place_id = bots.place_id AND pm.user_id = auth.uid()
  ));

ALTER TABLE bot_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow members to read schedules" ON bot_schedules
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM bots b JOIN place_members pm ON pm.place_id = b.place_id
    WHERE b.id = bot_schedules.bot_id AND pm.user_id = auth.uid()
  ));

ALTER TABLE bot_sensors ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow members to read sensors" ON bot_sensors
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM bots b JOIN place_members pm ON pm.place_id = b.place_id
    WHERE b.id = bot_sensors.bot_id AND pm.user_id = auth.uid()
  ));

ALTER TABLE bot_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow members to read commands" ON bot_commands
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM bots b JOIN place_members pm ON pm.place_id = b.place_id
    WHERE b.id = bot_commands.bot_id AND pm.user_id = auth.uid()
  ));

ALTER TABLE device_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Public read device types" ON device_types
  FOR SELECT USING (true);

ALTER TABLE smart_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow members to read devices" ON smart_devices
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM place_members pm WHERE pm.place_id = smart_devices.place_id AND pm.user_id = auth.uid()
  ));

ALTER TABLE device_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow members to read device states" ON device_states
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM smart_devices d JOIN place_members pm ON pm.place_id = d.place_id
    WHERE d.id = device_states.device_id AND pm.user_id = auth.uid()
  ));

ALTER TABLE device_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow members to read device commands" ON device_commands
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM smart_devices d JOIN place_members pm ON pm.place_id = d.place_id
    WHERE d.id = device_commands.device_id AND pm.user_id = auth.uid()
  ));

ALTER TABLE device_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow members to read device schedules" ON device_schedules
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM smart_devices d JOIN place_members pm ON pm.place_id = d.place_id
    WHERE d.id = device_schedules.device_id AND pm.user_id = auth.uid()
  ));

ALTER TABLE device_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow members to read device groups" ON device_groups
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM place_members pm WHERE pm.place_id = device_groups.place_id AND pm.user_id = auth.uid()
  ));

ALTER TABLE device_group_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow members to read device group members" ON device_group_members
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM device_groups g JOIN place_members pm ON pm.place_id = g.place_id
    WHERE g.id = device_group_members.group_id AND pm.user_id = auth.uid()
  ));


