-- =====================================================
-- Fix Coverage Functions - ROUND() Type Casting
-- This fixes the "function round(double precision, integer) does not exist" error
-- =====================================================

-- Drop existing functions
DROP FUNCTION IF EXISTS is_point_in_coverage(DECIMAL, DECIMAL, DECIMAL);
DROP FUNCTION IF EXISTS get_coverage_areas_near(DECIMAL, DECIMAL, DECIMAL);

-- Recreate is_point_in_coverage with proper type casting
CREATE OR REPLACE FUNCTION is_point_in_coverage(
    p_latitude DECIMAL,
    p_longitude DECIMAL,
    p_buffer_km DECIMAL DEFAULT 2.0
)
RETURNS TABLE(
    coverage_id UUID,
    area_name TEXT,
    city TEXT,
    province TEXT,
    is_inside BOOLEAN,
    distance_from_boundary_km DECIMAL
) AS $$
DECLARE
    v_point GEOGRAPHY;
BEGIN
    v_point := ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography;
    
    RETURN QUERY
    SELECT 
        ca.id as coverage_id,
        ca.area_name,
        ca.city,
        ca.province,
        ST_Contains(
            ca.boundary_geometry,
            ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)
        ) as is_inside,
        CASE 
            WHEN ST_Contains(ca.boundary_geometry, ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)) THEN 
                0::DECIMAL
            ELSE 
                ROUND(
                    (ST_Distance(
                        ca.boundary_geometry::geography,
                        v_point
                    ) / 1000)::numeric,
                    2
                )
        END as distance_from_boundary_km
    FROM coverage_areas ca
    WHERE ca.is_active = true
    AND ca.boundary_geometry IS NOT NULL
    AND (
        -- Either point is inside the polygon
        ST_Contains(
            ca.boundary_geometry,
            ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)
        )
        OR 
        -- Or point is within buffer distance (leeway)
        ST_DWithin(
            ca.boundary_geometry::geography,
            v_point,
            p_buffer_km * 1000
        )
    )
    ORDER BY 
        is_inside DESC,  -- Inside areas first
        distance_from_boundary_km ASC,  -- Then by distance
        ca.priority DESC;
END;
$$ LANGUAGE plpgsql;

-- Recreate get_coverage_areas_near with proper type casting
CREATE OR REPLACE FUNCTION get_coverage_areas_near(
    p_latitude DECIMAL,
    p_longitude DECIMAL,
    p_distance_km DECIMAL DEFAULT 50
)
RETURNS TABLE(
    coverage_id UUID,
    area_name TEXT,
    city TEXT,
    province TEXT,
    distance_km DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ca.id as coverage_id,
        ca.area_name,
        ca.city,
        ca.province,
        ROUND(
            (ST_Distance(
                ca.boundary_geometry::geography,
                ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography
            ) / 1000)::numeric,
            2
        ) as distance_km
    FROM coverage_areas ca
    WHERE ca.is_active = true
    AND ca.boundary_geometry IS NOT NULL
    AND ST_DWithin(
        ca.boundary_geometry::geography,
        ST_SetSRID(ST_MakePoint(p_longitude, p_latitude), 4326)::geography,
        p_distance_km * 1000
    )
    ORDER BY distance_km ASC;
END;
$$ LANGUAGE plpgsql;

-- Update comments
COMMENT ON FUNCTION is_point_in_coverage IS 'Check if a latitude/longitude point is within any coverage area (with 2km buffer leeway by default). Returns is_inside flag and distance from boundary. FIXED: Proper numeric casting for ROUND().';
COMMENT ON FUNCTION get_coverage_areas_near IS 'Find coverage areas near a point within specified distance (default 50km). Returns distance_km from the boundary. FIXED: Proper numeric casting for ROUND().';

-- Test the functions
DO $$
DECLARE
    test_result RECORD;
BEGIN
    -- Test is_point_in_coverage
    SELECT * INTO test_result FROM is_point_in_coverage(-29.916304, 30.966505, 2.0) LIMIT 1;
    IF test_result IS NOT NULL THEN
        RAISE NOTICE 'SUCCESS: is_point_in_coverage() working correctly';
    ELSE
        RAISE NOTICE 'INFO: is_point_in_coverage() returned no results (may need to upload coverage data)';
    END IF;
    
    -- Test get_coverage_areas_near
    SELECT * INTO test_result FROM get_coverage_areas_near(-29.916304, 30.966505, 50) LIMIT 1;
    IF test_result IS NOT NULL THEN
        RAISE NOTICE 'SUCCESS: get_coverage_areas_near() working correctly';
    ELSE
        RAISE NOTICE 'INFO: get_coverage_areas_near() returned no results (may need to upload coverage data)';
    END IF;
END $$;

