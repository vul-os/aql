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

-- =====================================================
-- FLEXIBLE PRICING SYSTEM
-- =====================================================

-- PRICING_PLANS TABLE
-- Base pricing plans per bot type
CREATE TABLE pricing_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_type TEXT NOT NULL CHECK (bot_type IN ('mow_bot', 'pool_bot', 'security_bot', 'weather_station')),
    
    -- Core pricing
    name TEXT NOT NULL,
    bot_rental_monthly DECIMAL(10, 2) NOT NULL,
    setup_fee DECIMAL(10, 2) DEFAULT 0,
    
    -- Area-based defaults (for gardens/pools)
    base_area_included_sqm INTEGER DEFAULT 100,
    price_per_sqm_after_base DECIMAL(10, 4) DEFAULT 0,
    
    -- Plan info
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    is_default BOOLEAN DEFAULT true,
    effective_from DATE DEFAULT CURRENT_DATE,
    effective_until DATE,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- PRICING_LINE_ITEMS TABLE
-- Flexible line items (per-visit charges, add-ons, etc.)
CREATE TABLE pricing_line_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pricing_plan_id UUID NOT NULL REFERENCES pricing_plans(id) ON DELETE CASCADE,
    
    -- Line item details
    item_type TEXT NOT NULL CHECK (item_type IN (
        'service_fee',
        'edge_trimming',
        'bot_swap',
        'bot_maintenance',
        'water_testing',
        'chemical_treatment',
        'equipment_check',
        'seasonal_preparation',
        'debris_removal',
        'filter_cleaning',
        'custom'
    )),
    name TEXT NOT NULL,
    description TEXT,
    
    -- Pricing
    price_per_unit DECIMAL(10, 2) NOT NULL,
    unit_type TEXT DEFAULT 'visit' CHECK (unit_type IN ('visit', 'month', 'hour', 'sqm', 'item', 'flat')),
    
    -- Applicability
    is_optional BOOLEAN DEFAULT false,
    is_recurring BOOLEAN DEFAULT true,  -- Charged every visit or one-time
    
    -- Ordering
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- CUSTOMER_PRICING_OVERRIDES TABLE
-- Customer-specific pricing overrides (for custom deals)
CREATE TABLE customer_pricing_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    bot_type TEXT NOT NULL,
    
    -- Override values (NULL = use default)
    bot_rental_monthly DECIMAL(10, 2),
    setup_fee DECIMAL(10, 2),
    base_area_included_sqm INTEGER,
    price_per_sqm_after_base DECIMAL(10, 4),
    
    -- Reason/notes
    override_reason TEXT,
    approved_by UUID REFERENCES profiles(id),
    approved_at TIMESTAMPTZ,
    
    -- Validity
    effective_from DATE DEFAULT CURRENT_DATE,
    effective_until DATE,
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(organization_id, bot_type, effective_from)
);

-- Customer-specific line item overrides (override prices for individual line items)
CREATE TABLE customer_line_item_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    pricing_line_item_id UUID NOT NULL REFERENCES pricing_line_items(id) ON DELETE CASCADE,
    
    -- Override values
    override_price DECIMAL(10, 2) NOT NULL,
    override_reason TEXT,
    approved_by UUID REFERENCES profiles(id),
    approved_at TIMESTAMPTZ,
    
    -- Validity
    effective_from DATE DEFAULT CURRENT_DATE,
    effective_until DATE,
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(organization_id, pricing_line_item_id, effective_from)
);

-- DISCOUNTS TABLE
-- Promotional discounts and special offers
CREATE TABLE discounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    discount_type TEXT NOT NULL CHECK (discount_type IN (
        'percentage',           -- % off total
        'fixed_amount',         -- Fixed R amount off
        'free_months',          -- X months free
        'free_service_visits'   -- X service visits free
    )),
    
    -- Discount value
    discount_value DECIMAL(10, 2) NOT NULL,  -- Percentage (e.g., 10 for 10%) or amount
    free_months INTEGER DEFAULT 0,  -- Number of months free
    free_service_visits INTEGER DEFAULT 0,  -- Number of service visits free
    
    -- Conditions
    min_bots INTEGER DEFAULT 0,
    min_services_per_month INTEGER DEFAULT 0,
    applies_to_bot_types TEXT[],  -- NULL = all types
    first_time_customers_only BOOLEAN DEFAULT false,
    
    -- Usage limits
    max_uses INTEGER,  -- NULL = unlimited
    uses_count INTEGER DEFAULT 0,
    max_uses_per_customer INTEGER DEFAULT 1,
    
    -- Validity
    valid_from DATE DEFAULT CURRENT_DATE,
    valid_until DATE,
    is_active BOOLEAN DEFAULT true,
    
    -- Metadata
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- DISCOUNT_USAGE TABLE
-- Track discount usage per customer
CREATE TABLE discount_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    discount_id UUID NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    service_id UUID REFERENCES services(id) ON DELETE SET NULL,
    rental_agreement_id UUID,  -- Foreign key added in later migration after rental_agreements table exists
    
    -- Usage details
    discount_applied_amount DECIMAL(10, 2) NOT NULL,  -- Actual amount saved
    months_free_applied INTEGER DEFAULT 0,
    service_visits_free_applied INTEGER DEFAULT 0,
    
    -- Status
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
    expires_at DATE,
    
    -- Metadata
    applied_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(discount_id, user_id, service_id)
);

-- Indexes for coverage_areas
CREATE INDEX IF NOT EXISTS idx_coverage_areas_country ON coverage_areas(country);
CREATE INDEX IF NOT EXISTS idx_coverage_areas_province ON coverage_areas(province);
CREATE INDEX IF NOT EXISTS idx_coverage_areas_city ON coverage_areas(city);
CREATE INDEX IF NOT EXISTS idx_coverage_areas_is_active ON coverage_areas(is_active);
CREATE INDEX IF NOT EXISTS idx_coverage_areas_postal_codes ON coverage_areas USING GIN(postal_codes);
CREATE INDEX IF NOT EXISTS idx_coverage_areas_coordinates ON coverage_areas(center_latitude, center_longitude);
CREATE INDEX IF NOT EXISTS idx_coverage_areas_boundary_geometry ON coverage_areas USING GIST (boundary_geometry);

-- Indexes for pricing_plans
CREATE INDEX IF NOT EXISTS idx_pricing_plans_bot_type ON pricing_plans(bot_type);
CREATE INDEX IF NOT EXISTS idx_pricing_plans_is_active ON pricing_plans(is_active);
CREATE INDEX IF NOT EXISTS idx_pricing_plans_is_default ON pricing_plans(is_default) WHERE is_default = true;
-- Partial unique index to ensure only one default plan per bot_type
CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_plans_unique_default ON pricing_plans(bot_type, is_default) WHERE is_default = true;

-- Indexes for pricing_line_items
CREATE INDEX IF NOT EXISTS idx_pricing_line_items_plan_id ON pricing_line_items(pricing_plan_id);
CREATE INDEX IF NOT EXISTS idx_pricing_line_items_item_type ON pricing_line_items(item_type);
CREATE INDEX IF NOT EXISTS idx_pricing_line_items_is_active ON pricing_line_items(is_active);

-- Indexes for customer_pricing_overrides
CREATE INDEX IF NOT EXISTS idx_customer_overrides_org_id ON customer_pricing_overrides(organization_id);
CREATE INDEX IF NOT EXISTS idx_customer_overrides_bot_type ON customer_pricing_overrides(bot_type);
CREATE INDEX IF NOT EXISTS idx_customer_overrides_is_active ON customer_pricing_overrides(is_active);

-- Indexes for customer_line_item_overrides
CREATE INDEX IF NOT EXISTS idx_customer_line_overrides_org_id ON customer_line_item_overrides(organization_id);
CREATE INDEX IF NOT EXISTS idx_customer_line_overrides_item_id ON customer_line_item_overrides(pricing_line_item_id);
CREATE INDEX IF NOT EXISTS idx_customer_line_overrides_is_active ON customer_line_item_overrides(is_active);

-- Indexes for discounts
CREATE INDEX IF NOT EXISTS idx_discounts_code ON discounts(code) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_discounts_valid ON discounts(valid_from, valid_until) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_discounts_type ON discounts(discount_type);

-- Indexes for discount_usage
CREATE INDEX IF NOT EXISTS idx_discount_usage_discount_id ON discount_usage(discount_id);
CREATE INDEX IF NOT EXISTS idx_discount_usage_user_id ON discount_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_discount_usage_organization_id ON discount_usage(organization_id);
CREATE INDEX IF NOT EXISTS idx_discount_usage_status ON discount_usage(status) WHERE status = 'active';

-- Enable RLS
-- ALTER TABLE coverage_areas ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE pricing_structure ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE discounts ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE discount_usage ENABLE ROW LEVEL SECURITY;

-- Comments
COMMENT ON TABLE coverage_areas IS 'Geographic areas where BotKorp services are available';
COMMENT ON TABLE pricing_plans IS 'Base pricing plans per bot type with core rental and setup fees';
COMMENT ON TABLE pricing_line_items IS 'Flexible line items: per-visit charges, add-ons, and custom services';
COMMENT ON TABLE customer_pricing_overrides IS 'Customer-specific pricing overrides for custom deals';
COMMENT ON TABLE customer_line_item_overrides IS 'Customer-specific line item price overrides';
COMMENT ON TABLE discounts IS 'Promotional discounts, free months, and special offers';
COMMENT ON TABLE discount_usage IS 'Track discount usage per customer';

COMMENT ON COLUMN pricing_plans.bot_rental_monthly IS 'Monthly rental fee per bot (e.g., R150)';
COMMENT ON COLUMN pricing_plans.base_area_included_sqm IS 'Base area included in price (default 100m²)';
COMMENT ON COLUMN pricing_plans.price_per_sqm_after_base IS 'Additional price per m² after base area';
COMMENT ON COLUMN pricing_line_items.item_type IS 'Type of line item: edge_trimming, bot_swap, bot_maintenance, etc.';
COMMENT ON COLUMN pricing_line_items.is_optional IS 'If true, customer can opt-in/out of this line item';
COMMENT ON COLUMN pricing_line_items.is_recurring IS 'If true, charged every visit; if false, one-time charge';

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

-- Helper function to validate and apply discount
CREATE OR REPLACE FUNCTION validate_discount(
    p_discount_code TEXT,
    p_user_id UUID,
    p_organization_id UUID,
    p_bot_type TEXT,
    p_number_of_bots INTEGER,
    p_services_per_month INTEGER
)
RETURNS TABLE(
    is_valid BOOLEAN,
    discount_id UUID,
    discount_type TEXT,
    discount_value DECIMAL,
    free_months INTEGER,
    free_service_visits INTEGER,
    message TEXT
) AS $$
DECLARE
    v_discount RECORD;
    v_usage_count INTEGER;
    v_is_first_time BOOLEAN;
BEGIN
    -- Get discount
    SELECT * INTO v_discount
    FROM discounts
    WHERE code = UPPER(p_discount_code)
        AND is_active = true
        AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
        AND (valid_until IS NULL OR valid_until >= CURRENT_DATE);
    
    IF NOT FOUND THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::DECIMAL, 0, 0, 'Invalid or expired discount code';
        RETURN;
    END IF;
    
    -- Check max uses
    IF v_discount.max_uses IS NOT NULL AND v_discount.uses_count >= v_discount.max_uses THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::DECIMAL, 0, 0, 'Discount code has reached maximum uses';
        RETURN;
    END IF;
    
    -- Check if user already used this discount
    SELECT COUNT(*) INTO v_usage_count
    FROM discount_usage
    WHERE discount_id = v_discount.id
        AND user_id = p_user_id;
    
    IF v_usage_count >= v_discount.max_uses_per_customer THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::DECIMAL, 0, 0, 'You have already used this discount code';
        RETURN;
    END IF;
    
    -- Check if first time customer requirement
    IF v_discount.first_time_customers_only THEN
        SELECT NOT EXISTS (
            SELECT 1 FROM rental_agreements
            WHERE user_id = p_user_id
                AND status IN ('active', 'completed')
        ) INTO v_is_first_time;
        
        IF NOT v_is_first_time THEN
            RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::DECIMAL, 0, 0, 'This discount is only for first-time customers';
            RETURN;
        END IF;
    END IF;
    
    -- Check min requirements
    IF p_number_of_bots < v_discount.min_bots THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::DECIMAL, 0, 0, 
            format('Minimum %s bots required', v_discount.min_bots);
        RETURN;
    END IF;
    
    IF p_services_per_month < v_discount.min_services_per_month THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::DECIMAL, 0, 0,
            format('Minimum %s services per month required', v_discount.min_services_per_month);
        RETURN;
    END IF;
    
    -- Check bot type restriction
    IF v_discount.applies_to_bot_types IS NOT NULL 
       AND NOT (p_bot_type = ANY(v_discount.applies_to_bot_types)) THEN
        RETURN QUERY SELECT false, NULL::UUID, NULL::TEXT, NULL::DECIMAL, 0, 0,
            'This discount does not apply to this bot type';
        RETURN;
    END IF;
    
    -- Discount is valid!
    RETURN QUERY SELECT 
        true,
        v_discount.id,
        v_discount.discount_type,
        v_discount.discount_value,
        v_discount.free_months,
        v_discount.free_service_visits,
        'Discount code is valid!'::TEXT;
END;
$$ LANGUAGE plpgsql;

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Coverage and pricing tables created with PostGIS functions';
    RAISE NOTICE 'Flexible pricing system with line items and discounts';
END $$;

