-- Insert device types
INSERT INTO device_types (name, category, description, icon, capabilities) VALUES
-- Lighting
('smart_bulb', 'lighting', 'Smart LED Bulb', 'lightbulb', '["on_off", "brightness", "color", "color_temperature"]'),
('smart_strip', 'lighting', 'Smart LED Strip', 'zap', '["on_off", "brightness", "color", "effects"]'),
('smart_switch', 'lighting', 'Smart Light Switch', 'toggle-left', '["on_off", "brightness"]'),
('smart_dimmer', 'lighting', 'Smart Dimmer Switch', 'sun', '["brightness"]'),

-- Power & Outlets
('smart_plug', 'power', 'Smart Power Plug', 'plug', '["on_off", "power_monitoring", "timer"]'),
('smart_outlet', 'power', 'Smart Wall Outlet', 'socket', '["on_off", "power_monitoring"]'),
('smart_power_strip', 'power', 'Smart Power Strip', 'layers', '["on_off", "individual_control", "power_monitoring"]'),

-- Climate Control
('smart_aircon', 'climate', 'Smart Air Conditioner', 'thermometer', '["on_off", "temperature", "mode", "fan_speed", "timer"]'),
('smart_heater', 'climate', 'Smart Heater', 'flame', '["on_off", "temperature", "timer"]'),
('smart_fan', 'climate', 'Smart Fan', 'wind', '["on_off", "speed", "oscillation", "timer"]'),
('smart_thermostat', 'climate', 'Smart Thermostat', 'thermometer-sun', '["temperature", "schedule", "mode"]'),

-- Entertainment
('smart_tv', 'entertainment', 'Smart TV', 'tv', '["on_off", "volume", "channel", "input", "apps"]'),
('smart_soundbar', 'entertainment', 'Smart Soundbar', 'volume-2', '["on_off", "volume", "input", "equalizer"]'),
('smart_projector', 'entertainment', 'Smart Projector', 'monitor', '["on_off", "brightness", "input", "focus"]'),
('smart_streaming', 'entertainment', 'Streaming Device', 'play-circle', '["on_off", "apps", "volume"]'),

-- Security & Cameras
('smart_camera', 'security', 'Smart Security Camera', 'camera', '["on_off", "recording", "night_vision", "motion_detection", "pan_tilt"]'),
('smart_doorbell', 'security', 'Smart Doorbell', 'door-open', '["on_off", "recording", "motion_detection", "two_way_audio"]'),
('smart_door_lock', 'security', 'Smart Door Lock', 'lock', '["lock_unlock", "auto_lock", "access_codes"]'),
('smart_sensor', 'security', 'Motion/Door Sensor', 'activity', '["motion_detection", "door_status", "battery_level"]'),

-- Appliances
('smart_washing_machine', 'appliance', 'Smart Washing Machine', 'washing-machine', '["on_off", "programs", "timer", "status"]'),
('smart_dryer', 'appliance', 'Smart Dryer', 'wind', '["on_off", "programs", "timer", "status"]'),
('smart_dishwasher', 'appliance', 'Smart Dishwasher', 'utensils', '["on_off", "programs", "timer", "status"]'),
('smart_refrigerator', 'appliance', 'Smart Refrigerator', 'refrigerator', '["temperature", "door_status", "ice_maker"]'),
('smart_oven', 'appliance', 'Smart Oven', 'flame', '["on_off", "temperature", "timer", "programs"]'),
('smart_coffee_maker', 'appliance', 'Smart Coffee Maker', 'coffee', '["on_off", "timer", "programs", "grind_settings"]'),

-- Garden & Outdoor
('smart_sprinkler', 'garden', 'Smart Sprinkler System', 'droplets', '["on_off", "zones", "timer", "weather_skip"]'),
('smart_gate', 'garden', 'Smart Gate Controller', 'gate', '["open_close", "auto_close", "access_codes"]'),
('smart_pool_heater', 'garden', 'Smart Pool Heater', 'thermometer', '["on_off", "temperature", "timer"]'),

-- Window & Blinds
('smart_blinds', 'window', 'Smart Blinds/Shades', 'blinds', '["open_close", "position", "timer"]'),
('smart_curtains', 'window', 'Smart Curtains', 'curtains', '["open_close", "position", "timer"]'),
('smart_window', 'window', 'Smart Window Opener', 'window', '["open_close", "position", "timer"]'),

-- Air Quality & Sensors
('air_purifier', 'air_quality', 'Smart Air Purifier', 'wind', '["on_off", "fan_speed", "timer", "air_quality"]'),
('humidifier', 'air_quality', 'Smart Humidifier', 'droplets', '["on_off", "humidity_level", "timer"]'),
('dehumidifier', 'air_quality', 'Smart Dehumidifier', 'droplets', '["on_off", "humidity_level", "timer"]'),
('co2_monitor', 'air_quality', 'CO2 Monitor', 'activity', '["co2_level", "temperature", "humidity"]'),

-- Other
('smart_speaker', 'other', 'Smart Speaker', 'speaker', '["volume", "music_control", "voice_assistant"]'),
('smart_display', 'other', 'Smart Display', 'monitor', '["on_off", "brightness", "apps", "voice_assistant"]'),
('smart_charger', 'other', 'Smart Charger', 'battery', '["on_off", "charging_status", "timer"]'),
('smart_vacuum', 'other', 'Smart Vacuum', 'vacuum', '["on_off", "cleaning_mode", "schedule", "battery_level"]');

-- Insert some sample smart devices
INSERT INTO smart_devices (place_id, device_type_id, name, room, brand, model, status) VALUES
-- Lighting devices
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 
 (SELECT id FROM device_types WHERE name = 'smart_bulb'), 
 'Living Room Light', 'living_room', 'Philips', 'Hue White and Color', 'online'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 
 (SELECT id FROM device_types WHERE name = 'smart_strip'), 
 'TV Backlight', 'living_room', 'Govee', 'H6159', 'online'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 
 (SELECT id FROM device_types WHERE name = 'smart_switch'), 
 'Bedroom Light Switch', 'bedroom', 'TP-Link', 'HS200', 'online'),

-- Power devices
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 
 (SELECT id FROM device_types WHERE name = 'smart_plug'), 
 'Coffee Maker Plug', 'kitchen', 'TP-Link', 'HS100', 'online'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 
 (SELECT id FROM device_types WHERE name = 'smart_outlet'), 
 'Kitchen Outlet', 'kitchen', 'Leviton', 'DW6HD', 'online'),

-- Climate devices
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 
 (SELECT id FROM device_types WHERE name = 'smart_aircon'), 
 'Living Room AC', 'living_room', 'Daikin', 'FTXM35R', 'online'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 
 (SELECT id FROM device_types WHERE name = 'smart_fan'), 
 'Bedroom Fan', 'bedroom', 'Hunter', 'Signal', 'online'),

-- Entertainment devices
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 
 (SELECT id FROM device_types WHERE name = 'smart_tv'), 
 'Living Room TV', 'living_room', 'Samsung', 'QN90A', 'online'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 
 (SELECT id FROM device_types WHERE name = 'smart_soundbar'), 
 'TV Soundbar', 'living_room', 'Sonos', 'Beam', 'online'),

-- Security devices
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 
 (SELECT id FROM device_types WHERE name = 'smart_camera'), 
 'Front Door Camera', 'outdoor', 'Ring', 'Video Doorbell Pro', 'online'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 
 (SELECT id FROM device_types WHERE name = 'smart_door_lock'), 
 'Front Door Lock', 'outdoor', 'August', 'Smart Lock Pro', 'online'),

-- Garden devices
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 
 (SELECT id FROM device_types WHERE name = 'smart_sprinkler'), 
 'Garden Sprinkler', 'garden', 'Rachio', 'Smart Sprinkler Controller', 'online');

-- Insert some sample device states
INSERT INTO device_states (device_id, state_data) VALUES
((SELECT id FROM smart_devices WHERE name = 'Living Room Light'), 
 '{"power": true, "brightness": 80, "color": "#ffffff", "color_temperature": 4000}'),
((SELECT id FROM smart_devices WHERE name = 'TV Backlight'), 
 '{"power": true, "brightness": 60, "color": "#00ff00", "effect": "rainbow"}'),
((SELECT id FROM smart_devices WHERE name = 'Coffee Maker Plug'), 
 '{"power": false, "power_consumption": 0, "voltage": 220}'),
((SELECT id FROM smart_devices WHERE name = 'Living Room AC'), 
 '{"power": true, "temperature": 22, "mode": "cool", "fan_speed": "medium"}'),
((SELECT id FROM smart_devices WHERE name = 'Living Room TV'), 
 '{"power": true, "volume": 45, "channel": "HDMI1", "input": "HDMI1"}');

-- Insert some sample scenes
INSERT INTO scenes (place_id, name, description, scene_data, icon) VALUES
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 
 'Movie Night', 'Perfect lighting for watching movies',
 '{"devices": {"Living Room Light": {"brightness": 20, "color": "#ff6600"}, "TV Backlight": {"brightness": 30, "color": "#0066ff"}}}',
 'film'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 
 'Good Morning', 'Bright and energizing morning scene',
 '{"devices": {"Living Room Light": {"brightness": 100, "color": "#ffffff", "color_temperature": 5000}, "Coffee Maker Plug": {"power": true}}}',
 'sunrise'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 
 'Sleep Mode', 'Dim lights for bedtime',
 '{"devices": {"Living Room Light": {"brightness": 10, "color": "#ff6600"}, "TV Backlight": {"power": false}}}',
 'moon');

-- Insert some sample device groups
INSERT INTO device_groups (place_id, name, description, group_type) VALUES
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 
 'Living Room', 'All devices in the living room', 'room'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 
 'Kitchen', 'All kitchen appliances and devices', 'room'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 
 'Security', 'All security and camera devices', 'zone'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 
 'Entertainment', 'TV, soundbar, and related devices', 'zone');

-- Add devices to groups
INSERT INTO device_group_members (group_id, device_id) VALUES
-- Living Room group
((SELECT id FROM device_groups WHERE name = 'Living Room'), 
 (SELECT id FROM smart_devices WHERE name = 'Living Room Light')),
((SELECT id FROM device_groups WHERE name = 'Living Room'), 
 (SELECT id FROM smart_devices WHERE name = 'TV Backlight')),
((SELECT id FROM device_groups WHERE name = 'Living Room'), 
 (SELECT id FROM smart_devices WHERE name = 'Living Room AC')),
((SELECT id FROM device_groups WHERE name = 'Living Room'), 
 (SELECT id FROM smart_devices WHERE name = 'Living Room TV')),
((SELECT id FROM device_groups WHERE name = 'Living Room'), 
 (SELECT id FROM smart_devices WHERE name = 'TV Soundbar')),

-- Kitchen group
((SELECT id FROM device_groups WHERE name = 'Kitchen'), 
 (SELECT id FROM smart_devices WHERE name = 'Coffee Maker Plug')),
((SELECT id FROM device_groups WHERE name = 'Kitchen'), 
 (SELECT id FROM smart_devices WHERE name = 'Kitchen Outlet')),

-- Security group
((SELECT id FROM device_groups WHERE name = 'Security'), 
 (SELECT id FROM smart_devices WHERE name = 'Front Door Camera')),
((SELECT id FROM device_groups WHERE name = 'Security'), 
 (SELECT id FROM smart_devices WHERE name = 'Front Door Lock')),

-- Entertainment group
((SELECT id FROM device_groups WHERE name = 'Entertainment'), 
 (SELECT id FROM smart_devices WHERE name = 'Living Room TV')),
((SELECT id FROM device_groups WHERE name = 'Entertainment'), 
 (SELECT id FROM smart_devices WHERE name = 'TV Soundbar')),
((SELECT id FROM device_groups WHERE name = 'Entertainment'), 
 (SELECT id FROM smart_devices WHERE name = 'TV Backlight'));
