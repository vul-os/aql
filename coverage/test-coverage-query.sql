-- Test Coverage Check for Location: -29.916304, 30.966505 (Montclair area)
-- Run these queries in Supabase SQL Editor

-- ============================================
-- 1. Check if coverage areas exist
-- ============================================
SELECT 
    id,
    area_name,
    city,
    province,
    is_active,
    center_latitude,
    center_longitude,
    boundary_geometry IS NOT NULL as has_geometry,
    boundary_geojson IS NOT NULL as has_geojson
FROM coverage_areas
ORDER BY area_name;

-- ============================================
-- 2. Test is_point_in_coverage function
-- ============================================
SELECT * 
FROM is_point_in_coverage(-29.916304, 30.966505, 2.0);

-- ============================================
-- 3. Check if point is inside any polygons (raw PostGIS)
-- ============================================
SELECT 
    id,
    area_name,
    city,
    ST_Contains(
        boundary_geometry,
        ST_SetSRID(ST_MakePoint(30.966505, -29.916304), 4326)
    ) as is_inside,
    ROUND(
        (ST_Distance(
            boundary_geometry::geography,
            ST_SetSRID(ST_MakePoint(30.966505, -29.916304), 4326)::geography
        ) / 1000)::numeric,
        2
    ) as distance_km
FROM coverage_areas
WHERE is_active = true
ORDER BY distance_km;

-- ============================================
-- 4. Check if boundary_geometry was created from geojson
-- ============================================
SELECT 
    id,
    area_name,
    ST_AsText(boundary_geometry) as geometry_wkt,
    ST_GeometryType(boundary_geometry) as geom_type,
    ST_IsValid(boundary_geometry) as is_valid
FROM coverage_areas
WHERE area_name = 'Montclair 1';

-- ============================================
-- 5. Find nearest coverage areas (within 50km)
-- ============================================
SELECT * 
FROM get_coverage_areas_near(-29.916304, 30.966505, 50);

-- ============================================
-- 6. Check if the sync trigger worked
-- ============================================
SELECT 
    area_name,
    boundary_geojson IS NOT NULL as has_geojson,
    boundary_geometry IS NOT NULL as has_geometry,
    center_latitude,
    center_longitude
FROM coverage_areas;

