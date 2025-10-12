-- =====================================================
-- Enable PostGIS for Geographic Coverage Areas
-- =====================================================

-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Add geometry column for proper geographic queries
ALTER TABLE coverage_areas 
ADD COLUMN IF NOT EXISTS boundary_geometry GEOMETRY(POLYGON, 4326);

-- Create spatial index for fast geographic lookups
CREATE INDEX IF NOT EXISTS idx_coverage_areas_boundary_geometry 
ON coverage_areas USING GIST (boundary_geometry);

-- Function to check if a point is within coverage area (with optional buffer)
-- Default buffer is 2km leeway to allow for nearby areas
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

-- Function to get coverage areas within distance
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

-- Function to sync geometry from GeoJSON
CREATE OR REPLACE FUNCTION sync_coverage_geometry()
RETURNS TRIGGER AS $$
BEGIN
    -- If boundary_geojson exists but geometry doesn't, create it
    IF NEW.boundary_geojson IS NOT NULL AND NEW.boundary_geometry IS NULL THEN
        NEW.boundary_geometry := ST_GeomFromGeoJSON(NEW.boundary_geojson::TEXT);
    END IF;
    
    -- Calculate center point if not set
    IF NEW.boundary_geometry IS NOT NULL THEN
        IF NEW.center_latitude IS NULL OR NEW.center_longitude IS NULL THEN
            NEW.center_longitude := ST_X(ST_Centroid(NEW.boundary_geometry));
            NEW.center_latitude := ST_Y(ST_Centroid(NEW.boundary_geometry));
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-sync geometry
DROP TRIGGER IF EXISTS sync_coverage_geometry_trigger ON coverage_areas;
CREATE TRIGGER sync_coverage_geometry_trigger
    BEFORE INSERT OR UPDATE ON coverage_areas
    FOR EACH ROW
    EXECUTE FUNCTION sync_coverage_geometry();

COMMENT ON COLUMN coverage_areas.boundary_geometry IS 'PostGIS geometry for efficient spatial queries';
COMMENT ON FUNCTION is_point_in_coverage IS 'Check if a latitude/longitude point is within any coverage area (with 2km buffer leeway by default). Returns is_inside flag and distance from boundary.';
COMMENT ON FUNCTION get_coverage_areas_near IS 'Find coverage areas near a point within specified distance (default 50km). Returns distance_km from the boundary.';

