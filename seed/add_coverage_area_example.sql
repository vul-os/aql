-- ============================================
-- Add Coverage Area Example
-- ============================================
-- This file shows how to add coverage areas to display on the map
-- You can execute these SQL statements in your Supabase SQL editor

-- Example 1: Simple coverage area with center point only
-- This will display as a marker on the map
INSERT INTO coverage_areas (
    area_name,
    city,
    province,
    country,
    country_code,
    center_latitude,
    center_longitude,
    postal_codes,
    service_types,
    is_active,
    priority
) VALUES (
    'Westville',
    'Durban',
    'KwaZulu-Natal',
    'South Africa',
    'ZA',
    -29.8587,
    31.0218,
    ARRAY['3629', '3630'],
    ARRAY['mow_bot', 'weather_station'],
    true,
    10
);

-- Example 2: Coverage area with GeoJSON boundary polygon
-- This will display as a shaded area on the map
-- Use https://geojson.io to draw your coverage area and get coordinates
INSERT INTO coverage_areas (
    area_name,
    city,
    province,
    country,
    country_code,
    center_latitude,
    center_longitude,
    boundary_geojson,
    postal_codes,
    service_types,
    is_active,
    priority,
    notes
) VALUES (
    'Umhlanga',
    'Durban',
    'KwaZulu-Natal',
    'South Africa',
    'ZA',
    -29.7289,
    31.0821,
    '{
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [31.0700, -29.7200],
                    [31.0900, -29.7200],
                    [31.0900, -29.7400],
                    [31.0700, -29.7400],
                    [31.0700, -29.7200]
                ]]
            }
        }]
    }'::jsonb,
    ARRAY['4319', '4320'],
    ARRAY['mow_bot', 'pool_bot', 'weather_station'],
    true,
    10,
    'Pilot program area - high priority'
);

-- Example 3: Multiple coverage areas at once
INSERT INTO coverage_areas (
    area_name, city, province, center_latitude, center_longitude, 
    postal_codes, service_types, is_active, priority
) VALUES 
    ('Sandton', 'Johannesburg', 'Gauteng', -26.1076, 28.0567, 
     ARRAY['2196', '2031'], ARRAY['mow_bot'], true, 5),
    
    ('Constantia', 'Cape Town', 'Western Cape', -34.0153, 18.4630,
     ARRAY['7806', '7800'], ARRAY['mow_bot', 'pool_bot'], true, 8),
    
    ('Ballito', 'KwaDukuza', 'KwaZulu-Natal', -29.5392, 31.2135,
     ARRAY['4420'], ARRAY['mow_bot'], true, 6);

-- ============================================
-- How to get GeoJSON boundaries
-- ============================================
-- 
-- Method 1: Use geojson.io
-- 1. Go to https://geojson.io
-- 2. Use the drawing tools to outline your coverage area
-- 3. Copy the GeoJSON from the right panel
-- 4. Paste into the boundary_geojson column
--
-- Method 2: Use Google Maps KML
-- 1. Draw your area in Google My Maps
-- 2. Export as KML
-- 3. Convert KML to GeoJSON using: https://mapbox.github.io/togeojson/
-- 4. Insert the GeoJSON
--
-- Method 3: Use PostGIS (if you have coordinates)
-- UPDATE coverage_areas 
-- SET boundary_geometry = ST_MakeEnvelope(
--     west_longitude, south_latitude, 
--     east_longitude, north_latitude, 
--     4326
-- )
-- WHERE id = 'your-area-id';

-- ============================================
-- Verify your coverage areas
-- ============================================
SELECT 
    area_name,
    city,
    province,
    center_latitude,
    center_longitude,
    CASE 
        WHEN boundary_geojson IS NOT NULL THEN 'Has boundary'
        ELSE 'Point only'
    END as display_type,
    array_length(service_types, 1) as service_count,
    is_active,
    priority
FROM coverage_areas
ORDER BY priority DESC, city, area_name;

-- ============================================
-- Update existing area with GeoJSON
-- ============================================
-- UPDATE coverage_areas
-- SET boundary_geojson = '{
--     "type": "FeatureCollection",
--     "features": [{
--         "type": "Feature",
--         "geometry": {
--             "type": "Polygon",
--             "coordinates": [[
--                 [31.0700, -29.7200],
--                 [31.0900, -29.7200],
--                 [31.0900, -29.7400],
--                 [31.0700, -29.7400],
--                 [31.0700, -29.7200]
--             ]]
--         }
--     }]
-- }'::jsonb
-- WHERE area_name = 'Your Area Name';

-- ============================================
-- Delete a coverage area
-- ============================================
-- DELETE FROM coverage_areas WHERE area_name = 'Area Name';
-- 
-- Or just deactivate:
-- UPDATE coverage_areas SET is_active = false WHERE area_name = 'Area Name';

-- ============================================
-- Tips for good coverage areas
-- ============================================
-- 
-- 1. Priority: Higher number = more prominent on the map
-- 2. Service Types: Only include services you actually offer
-- 3. Postal Codes: Help users find if you cover their area
-- 4. Center Point: Should be roughly in the middle of the area
-- 5. GeoJSON: Use simplified polygons for better performance
-- 6. Notes: Add internal notes about expansion plans, etc.

