-- Insert some sample coverage areas for South Africa
INSERT INTO coverage_areas (name, city, state, country, latitude, longitude, radius_km) VALUES
('Cape Town Central', 'Cape Town', 'Western Cape', 'South Africa', -33.9249, 18.4241, 10.0),
('Johannesburg Central', 'Johannesburg', 'Gauteng', 'South Africa', -26.2041, 28.0473, 15.0),
('Durban Central', 'Durban', 'KwaZulu-Natal', 'South Africa', -29.8587, 31.0218, 12.0),
('Pretoria Central', 'Pretoria', 'Gauteng', 'South Africa', -25.7479, 28.2293, 8.0),
('Port Elizabeth Central', 'Port Elizabeth', 'Eastern Cape', 'South Africa', -33.9608, 25.6022, 10.0),
('Bloemfontein Central', 'Bloemfontein', 'Free State', 'South Africa', -29.0852, 26.1596, 8.0),
('Nelspruit Central', 'Nelspruit', 'Mpumalanga', 'South Africa', -25.4745, 30.9703, 6.0),
('Polokwane Central', 'Polokwane', 'Limpopo', 'South Africa', -23.9008, 29.4512, 6.0);

-- Insert some sample places (these will be created by users, but we can add some examples)
INSERT INTO places (name, address, city, state, country, latitude, longitude) VALUES
('Sample Home Cape Town', '123 Main Street', 'Cape Town', 'Western Cape', 'South Africa', -33.9249, 18.4241),
('Sample Office Johannesburg', '456 Business Ave', 'Johannesburg', 'Gauteng', 'South Africa', -26.2041, 28.0473);

-- Insert some sample bots
INSERT INTO bots (place_id, name, type, model, serial_number, status) VALUES
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 'MowBot Alpha', 'mowbot', 'MowBot Pro 2024', 'MB001', 'online'),
((SELECT id FROM places WHERE name = 'Sample Home Cape Town'), 'PoolBot Beta', 'poolbot', 'PoolBot Clean 2024', 'PB001', 'offline'),
((SELECT id FROM places WHERE name = 'Sample Office Johannesburg'), 'Weather Station Gamma', 'weather_station', 'WeatherPro 2024', 'WS001', 'online');

-- Insert some sample schedules
INSERT INTO bot_schedules (bot_id, name, schedule_type, schedule_data) VALUES
((SELECT id FROM bots WHERE name = 'MowBot Alpha'), 'Daily Morning Mow', 'daily', '{"time": "08:00", "days": ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]}'),
((SELECT id FROM bots WHERE name = 'PoolBot Beta'), 'Weekly Pool Clean', 'weekly', '{"time": "10:00", "days": ["monday", "wednesday", "friday"]}');

-- Insert some sample sensor data
INSERT INTO bot_sensors (bot_id, sensor_type, sensor_name, value, unit, metadata) VALUES
((SELECT id FROM bots WHERE name = 'Weather Station Gamma'), 'temperature', 'Outdoor Temperature', 25.5, '°C', '{"location": "outdoor", "accuracy": "±0.1°C"}'),
((SELECT id FROM bots WHERE name = 'Weather Station Gamma'), 'humidity', 'Outdoor Humidity', 65.2, '%', '{"location": "outdoor", "accuracy": "±2%"}'),
((SELECT id FROM bots WHERE name = 'MowBot Alpha'), 'soil_moisture', 'Soil Moisture Sensor', 45.8, '%', '{"depth": "5cm", "location": "front_lawn"}');
