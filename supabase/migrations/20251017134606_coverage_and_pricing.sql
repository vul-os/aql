-- =====================================================
-- Coverage Areas and Pricing Structure
-- =====================================================

-- COVERAGE_AREAS TABLE
CREATE TABLE IF NOT EXISTS coverage_areas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    country TEXT NOT NULL DEFAULT 'South Africa',
    country_code TEXT NOT NULL DEFAULT 'ZA',
    province TEXT,
    city TEXT,
    area_name TEXT,
    postal_codes TEXT[],
    boundary_geojson JSONB,
    boundary_geometry GEOMETRY(POLYGON, 4326), -- PostGIS geometry for spatial queries
    center_latitude DECIMAL(10, 8),
    center_longitude DECIMAL(11, 8),
    radius_km DECIMAL(8, 2),
    is_active BOOLEAN DEFAULT true,
    service_types TEXT[] DEFAULT ARRAY['mow_bot', 'weather_station', 'pool_bot', 'security_bot'],
    priority INTEGER DEFAULT 0,
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- PRICING_STRUCTURE TABLE
-- New pricing: Bot Rental (R150/bot/month) + Service Fees (per visit)
CREATE TABLE pricing_structure (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_type TEXT NOT NULL CHECK (bot_type IN ('mow_bot', 'pool_bot', 'security_bot', 'weather_station')),
    
    -- Bot rental pricing (per bot per month)
    bot_rental_monthly DECIMAL(10, 2) NOT NULL,
    
    -- Service pricing (per service visit)
    service_price_per_visit DECIMAL(10, 2) NOT NULL,
    
    -- Setup/installation fee (one-time)
    setup_fee DECIMAL(10, 2) DEFAULT 0,
    
    -- Metadata
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    effective_from DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- SERVICE_TIER_PRICING TABLE
-- Pre-calculated pricing tiers for common configurations
CREATE TABLE service_tier_pricing (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_type TEXT NOT NULL,
    number_of_bots INTEGER NOT NULL,
    services_per_month INTEGER NOT NULL,
    monthly_total DECIMAL(10, 2) NOT NULL,
    tier_name TEXT,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for coverage_areas
CREATE INDEX IF NOT EXISTS idx_coverage_areas_country ON coverage_areas(country);
CREATE INDEX IF NOT EXISTS idx_coverage_areas_province ON coverage_areas(province);
CREATE INDEX IF NOT EXISTS idx_coverage_areas_city ON coverage_areas(city);
CREATE INDEX IF NOT EXISTS idx_coverage_areas_is_active ON coverage_areas(is_active);
CREATE INDEX IF NOT EXISTS idx_coverage_areas_postal_codes ON coverage_areas USING GIN(postal_codes);
CREATE INDEX IF NOT EXISTS idx_coverage_areas_coordinates ON coverage_areas(center_latitude, center_longitude);
CREATE INDEX IF NOT EXISTS idx_coverage_areas_boundary_geometry ON coverage_areas USING GIST (boundary_geometry);

-- Indexes for pricing_structure
CREATE INDEX IF NOT EXISTS idx_pricing_structure_bot_type ON pricing_structure(bot_type, is_active);

-- Enable RLS
ALTER TABLE coverage_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_structure ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_tier_pricing ENABLE ROW LEVEL SECURITY;

-- Comments
COMMENT ON TABLE coverage_areas IS 'Geographic areas where BotKorp services are available';
COMMENT ON TABLE pricing_structure IS 'New pricing structure: bot rental + service fees separate';
COMMENT ON TABLE service_tier_pricing IS 'Pre-calculated pricing tiers for common bot + service configurations';

COMMENT ON COLUMN pricing_structure.bot_rental_monthly IS 'Monthly rental fee per bot (e.g., R150)';
COMMENT ON COLUMN pricing_structure.service_price_per_visit IS 'Price per service visit (edge trimming + bot swap)';

-- =====================================================
-- COVERAGE FUNCTIONS (PostGIS)
-- =====================================================

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

-- Trigger to sync boundary_geojson to boundary_geometry
CREATE OR REPLACE FUNCTION sync_coverage_boundary()
RETURNS TRIGGER AS $$
BEGIN
    -- When boundary_geojson is updated, sync to boundary_geometry
    IF NEW.boundary_geojson IS NOT NULL THEN
        BEGIN
            NEW.boundary_geometry := ST_SetSRID(
                ST_GeomFromGeoJSON(NEW.boundary_geojson::text),
                4326
            );
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Failed to convert GeoJSON to geometry: %', SQLERRM;
        END;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_coverage_boundary_trigger
    BEFORE INSERT OR UPDATE ON coverage_areas
    FOR EACH ROW
    EXECUTE FUNCTION sync_coverage_boundary();

-- Function comments
COMMENT ON FUNCTION is_point_in_coverage IS 'Check if a latitude/longitude point is within any coverage area (with 2km buffer leeway by default). Returns is_inside flag and distance from boundary.';
COMMENT ON FUNCTION get_coverage_areas_near IS 'Find coverage areas near a point within specified distance (default 50km). Returns distance_km from the boundary.';
COMMENT ON COLUMN coverage_areas.boundary_geometry IS 'PostGIS geometry for efficient spatial queries (auto-synced from boundary_geojson)';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Coverage and pricing tables created with PostGIS functions';
END $$;

