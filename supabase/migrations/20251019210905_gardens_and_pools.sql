-- =====================================================
-- Services, Gardens, Pools, and Bot Assignments
-- =====================================================
-- NEW ARCHITECTURE:
-- SERVICE (container) → Multiple GARDENS → Multiple BOTS
-- User signs ONCE (Master Agreement) → Multiple Bot Rental Agreements
-- =====================================================

-- =====================================================
-- SERVICES TABLE
-- =====================================================
-- Container for multiple gardens/pools at a location

CREATE TABLE IF NOT EXISTS services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL,
    location_id UUID NOT NULL,
    
    -- Service identification
    name TEXT NOT NULL,
    service_type TEXT NOT NULL CHECK (service_type IN ('lawn', 'pool', 'security', 'weather')),
    description TEXT,
    
    -- Service configuration
    service_frequency TEXT CHECK (service_frequency IN ('weekly', 'bi-weekly', 'monthly', 'custom')),
    services_per_month INTEGER DEFAULT 4,
    
    -- Status
    status TEXT DEFAULT 'pending_setup' CHECK (status IN (
        'pending_setup', 'pending_installation', 'installation_scheduled',
        'installing', 'active', 'paused', 'cancelled'
    )),
    is_active BOOLEAN DEFAULT true,
    
    -- Stage tracking
    installation_scheduled_date TIMESTAMPTZ,
    installation_completed_date TIMESTAMPTZ,
    activation_date TIMESTAMPTZ,
    
    -- Pause/Cancel tracking
    is_paused BOOLEAN DEFAULT false,
    paused_at TIMESTAMPTZ,
    paused_by UUID REFERENCES profiles(id),
    paused_reason TEXT,
    resumed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID REFERENCES profiles(id),
    cancellation_reason TEXT,
    
    -- Service scheduling
    next_service_date DATE,
    
    -- Metadata
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(organization_id, location_id, service_type),
    
    CONSTRAINT services_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    CONSTRAINT services_location_id_fkey FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE
);

-- GARDENS TABLE
CREATE TABLE gardens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    
    -- Measurements
    area_sqm DECIMAL(10, 2),
    perimeter_m DECIMAL(10, 2),
    
    -- Garden characteristics
    grass_type TEXT,
    terrain_type TEXT CHECK (terrain_type IN ('flat', 'sloped', 'mixed', 'hilly')),
    difficulty_level TEXT CHECK (difficulty_level IN ('easy', 'moderate', 'difficult')),
    has_obstacles BOOLEAN DEFAULT false,
    obstacle_description TEXT,
    
    -- Images
    images TEXT[] DEFAULT ARRAY[]::TEXT[],
    thumbnail_url TEXT,
    
    -- Mowing preferences
    preferred_cut_height_mm INTEGER,
    preferred_pattern TEXT CHECK (preferred_pattern IN ('stripe', 'random', 'spiral', 'checkerboard')),
    mowing_frequency_days INTEGER DEFAULT 7,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    requires_maintenance BOOLEAN DEFAULT false,
    last_mowed_at TIMESTAMPTZ,
    next_scheduled_mow TIMESTAMPTZ,
    
    -- Cancellation tracking
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    cancellation_reason TEXT,
    
    -- Geographic data
    boundary_geojson JSONB,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- POOLS TABLE
CREATE TABLE pools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    
    -- Pool type and dimensions
    pool_type TEXT CHECK (pool_type IN ('inground', 'above_ground', 'infinity', 'lap', 'plunge', 'natural')),
    length_m DECIMAL(6, 2),
    width_m DECIMAL(6, 2),
    depth_shallow_m DECIMAL(4, 2),
    depth_deep_m DECIMAL(4, 2),
    volume_liters DECIMAL(10, 2),
    surface_area_sqm DECIMAL(10, 2),
    
    -- Pool features
    has_heater BOOLEAN DEFAULT false,
    has_cover BOOLEAN DEFAULT false,
    has_salt_system BOOLEAN DEFAULT false,
    filtration_type TEXT,
    
    -- Images
    images TEXT[] DEFAULT ARRAY[]::TEXT[],
    thumbnail_url TEXT,
    
    -- Water quality targets
    target_ph_min DECIMAL(3, 2) DEFAULT 7.2,
    target_ph_max DECIMAL(3, 2) DEFAULT 7.6,
    target_chlorine_min DECIMAL(4, 2) DEFAULT 1.0,
    target_chlorine_max DECIMAL(4, 2) DEFAULT 3.0,
    target_temperature_min DECIMAL(4, 1),
    target_temperature_max DECIMAL(4, 1),
    
    -- Cleaning schedule
    cleaning_frequency_days INTEGER DEFAULT 7,
    last_cleaned_at TIMESTAMPTZ,
    next_scheduled_clean TIMESTAMPTZ,
    last_water_test_at TIMESTAMPTZ,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    requires_maintenance BOOLEAN DEFAULT false,
    is_winterized BOOLEAN DEFAULT false,
    
    -- Cancellation tracking
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    cancellation_reason TEXT,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- BOT_GARDEN_ASSIGNMENTS TABLE (Many-to-Many)
CREATE TABLE bot_garden_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    garden_id UUID NOT NULL REFERENCES gardens(id) ON DELETE CASCADE,
    is_primary BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    assigned_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    unassigned_at TIMESTAMPTZ,
    
    -- Performance metrics
    total_mows INTEGER DEFAULT 0,
    total_runtime_minutes INTEGER DEFAULT 0,
    last_mowed_at TIMESTAMPTZ,
    
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(bot_id, garden_id)
);

-- BOT_POOL_ASSIGNMENTS TABLE (Many-to-Many)
CREATE TABLE bot_pool_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    pool_id UUID NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    is_primary BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    assigned_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    unassigned_at TIMESTAMPTZ,
    
    -- Performance metrics
    total_cleanings INTEGER DEFAULT 0,
    total_runtime_minutes INTEGER DEFAULT 0,
    last_cleaned_at TIMESTAMPTZ,
    
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(bot_id, pool_id)
);

-- MOWING_SESSIONS TABLE
CREATE TABLE mowing_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    garden_id UUID NOT NULL REFERENCES gardens(id) ON DELETE CASCADE,
    assignment_id UUID REFERENCES bot_garden_assignments(id) ON DELETE SET NULL,
    
    -- Session timing
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    duration_minutes INTEGER,
    
    -- Performance metrics
    area_mowed_sqm DECIMAL(10, 2),
    distance_traveled_m DECIMAL(10, 2),
    
    -- Battery usage
    battery_start INTEGER,
    battery_end INTEGER,
    battery_used INTEGER,
    charging_time_minutes INTEGER,
    
    -- Weather conditions
    weather_temp_c DECIMAL(4, 1),
    weather_conditions TEXT,
    
    -- Mowing details
    pattern_used TEXT,
    cut_height_mm INTEGER,
    quality_rating INTEGER CHECK (quality_rating >= 1 AND quality_rating <= 5),
    
    -- Issues
    obstacles_detected INTEGER DEFAULT 0,
    pauses_count INTEGER DEFAULT 0,
    errors_count INTEGER DEFAULT 0,
    emergency_stops INTEGER DEFAULT 0,
    completed_successfully BOOLEAN DEFAULT true,
    
    -- Path tracking
    path_geojson JSONB,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- POOL_CLEANING_SESSIONS TABLE
CREATE TABLE pool_cleaning_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    pool_id UUID NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    assignment_id UUID REFERENCES bot_pool_assignments(id) ON DELETE SET NULL,
    
    -- Session timing
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    duration_minutes INTEGER,
    area_cleaned_sqm DECIMAL(10, 2),
    
    -- Battery usage
    battery_start INTEGER,
    battery_end INTEGER,
    battery_used INTEGER,
    charging_time_minutes INTEGER,
    
    -- Water quality measurements
    ph_before DECIMAL(3, 2),
    ph_after DECIMAL(3, 2),
    chlorine_before DECIMAL(4, 2),
    chlorine_after DECIMAL(4, 2),
    temperature_before DECIMAL(4, 1),
    temperature_after DECIMAL(4, 1),
    
    -- Cleaning details
    debris_removed_g INTEGER,
    quality_rating INTEGER CHECK (quality_rating >= 1 AND quality_rating <= 5),
    filter_cleaned BOOLEAN DEFAULT false,
    walls_scrubbed BOOLEAN DEFAULT false,
    floor_vacuumed BOOLEAN DEFAULT false,
    
    -- Issues
    errors_count INTEGER DEFAULT 0,
    completed_successfully BOOLEAN DEFAULT true,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for services
CREATE INDEX IF NOT EXISTS idx_services_location_id ON services(location_id);
CREATE INDEX IF NOT EXISTS idx_services_organization_id ON services(organization_id);
CREATE INDEX IF NOT EXISTS idx_services_service_type ON services(service_type);
CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);
CREATE INDEX IF NOT EXISTS idx_services_is_active ON services(is_active);

-- Indexes for gardens
CREATE INDEX IF NOT EXISTS idx_gardens_location_id ON gardens(location_id);
CREATE INDEX IF NOT EXISTS idx_gardens_service_id ON gardens(service_id);
CREATE INDEX IF NOT EXISTS idx_gardens_is_active ON gardens(is_active);
CREATE INDEX IF NOT EXISTS idx_gardens_next_scheduled_mow ON gardens(next_scheduled_mow);
CREATE INDEX IF NOT EXISTS idx_gardens_requires_maintenance ON gardens(requires_maintenance);

-- Indexes for pools
CREATE INDEX IF NOT EXISTS idx_pools_location_id ON pools(location_id);
CREATE INDEX IF NOT EXISTS idx_pools_service_id ON pools(service_id);
CREATE INDEX IF NOT EXISTS idx_pools_is_active ON pools(is_active);
CREATE INDEX IF NOT EXISTS idx_pools_next_scheduled_clean ON pools(next_scheduled_clean);
CREATE INDEX IF NOT EXISTS idx_pools_requires_maintenance ON pools(requires_maintenance);
CREATE INDEX IF NOT EXISTS idx_pools_pool_type ON pools(pool_type);

-- Indexes for bot_garden_assignments
CREATE INDEX IF NOT EXISTS idx_bot_garden_bot_id ON bot_garden_assignments(bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_garden_garden_id ON bot_garden_assignments(garden_id);
CREATE INDEX IF NOT EXISTS idx_bot_garden_is_active ON bot_garden_assignments(is_active);
CREATE INDEX IF NOT EXISTS idx_bot_garden_is_primary ON bot_garden_assignments(is_primary);

-- Indexes for bot_pool_assignments
CREATE INDEX IF NOT EXISTS idx_bot_pool_bot_id ON bot_pool_assignments(bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_pool_pool_id ON bot_pool_assignments(pool_id);
CREATE INDEX IF NOT EXISTS idx_bot_pool_is_active ON bot_pool_assignments(is_active);
CREATE INDEX IF NOT EXISTS idx_bot_pool_is_primary ON bot_pool_assignments(is_primary);

-- Indexes for mowing_sessions
CREATE INDEX IF NOT EXISTS idx_mowing_sessions_bot_id ON mowing_sessions(bot_id);
CREATE INDEX IF NOT EXISTS idx_mowing_sessions_garden_id ON mowing_sessions(garden_id);
CREATE INDEX IF NOT EXISTS idx_mowing_sessions_start_time ON mowing_sessions(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_mowing_sessions_completed ON mowing_sessions(completed_successfully);

-- Indexes for pool_cleaning_sessions
CREATE INDEX IF NOT EXISTS idx_pool_cleaning_bot_id ON pool_cleaning_sessions(bot_id);
CREATE INDEX IF NOT EXISTS idx_pool_cleaning_pool_id ON pool_cleaning_sessions(pool_id);
CREATE INDEX IF NOT EXISTS idx_pool_cleaning_start_time ON pool_cleaning_sessions(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_pool_cleaning_completed ON pool_cleaning_sessions(completed_successfully);

-- =====================================================
-- PAUSE/RESUME FUNCTIONALITY
-- =====================================================

-- Add pause functionality to gardens
ALTER TABLE gardens
    ADD COLUMN IF NOT EXISTS is_paused BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS paused_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS pause_reason TEXT,
    ADD COLUMN IF NOT EXISTS resumed_at TIMESTAMPTZ;

-- Add pause functionality to pools
ALTER TABLE pools
    ADD COLUMN IF NOT EXISTS is_paused BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS paused_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS pause_reason TEXT,
    ADD COLUMN IF NOT EXISTS resumed_at TIMESTAMPTZ;

-- Create indexes for pause status
CREATE INDEX IF NOT EXISTS idx_gardens_is_paused ON gardens(is_paused);
CREATE INDEX IF NOT EXISTS idx_pools_is_paused ON pools(is_paused);

-- Function to pause a garden service
CREATE OR REPLACE FUNCTION pause_garden_service(
    p_garden_id UUID,
    p_user_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE gardens
    SET 
        is_paused = true,
        paused_at = NOW(),
        paused_by = p_user_id,
        pause_reason = p_reason,
        updated_at = NOW()
    WHERE id = p_garden_id
        AND is_paused = false;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to resume a garden service
CREATE OR REPLACE FUNCTION resume_garden_service(
    p_garden_id UUID,
    p_user_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE gardens
    SET 
        is_paused = false,
        resumed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_garden_id
        AND is_paused = true;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to pause a pool service
CREATE OR REPLACE FUNCTION pause_pool_service(
    p_pool_id UUID,
    p_user_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE pools
    SET 
        is_paused = true,
        paused_at = NOW(),
        paused_by = p_user_id,
        pause_reason = p_reason,
        updated_at = NOW()
    WHERE id = p_pool_id
        AND is_paused = false;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to resume a pool service
CREATE OR REPLACE FUNCTION resume_pool_service(
    p_pool_id UUID,
    p_user_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE pools
    SET 
        is_paused = false,
        resumed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_pool_id
        AND is_paused = true;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION pause_garden_service TO authenticated;
GRANT EXECUTE ON FUNCTION resume_garden_service TO authenticated;
GRANT EXECUTE ON FUNCTION pause_pool_service TO authenticated;
GRANT EXECUTE ON FUNCTION resume_pool_service TO authenticated;

-- Enable RLS
-- ALTER TABLE gardens ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE pools ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE bot_garden_assignments ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE bot_pool_assignments ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE mowing_sessions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE pool_cleaning_sessions ENABLE ROW LEVEL SECURITY;

-- Comments
COMMENT ON TABLE gardens IS 'Individual gardens/lawns at locations with measurements and preferences';
COMMENT ON TABLE pools IS 'Individual pools at locations with measurements and water quality targets';
COMMENT ON TABLE bot_garden_assignments IS 'Many-to-many: assigns bots to gardens they service';
COMMENT ON TABLE bot_pool_assignments IS 'Many-to-many: assigns bots to pools they service';
COMMENT ON TABLE mowing_sessions IS 'Individual mowing sessions for analytics and tracking';
COMMENT ON TABLE pool_cleaning_sessions IS 'Individual pool cleaning sessions for analytics';

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Gardens, pools, and sessions tables created';
    RAISE NOTICE 'PostgREST schema cache refreshed';
END $$;

