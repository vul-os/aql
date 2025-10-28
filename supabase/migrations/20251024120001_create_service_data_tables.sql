-- =====================================================
-- Service-Centric Data Tables
-- Data is organized by service type (garden, pool, etc.)
-- with bot_id tracking which bot generated the data
-- =====================================================

-- =====================================================
-- DROP OLD SESSION TABLES
-- Remove old bot-centric session tables before creating new ones
-- =====================================================

DROP TABLE IF EXISTS mowing_sessions CASCADE;
DROP TABLE IF EXISTS pool_cleaning_sessions CASCADE;

-- =====================================================
-- ENVIRONMENTAL DATA TABLES
-- Temperature, humidity, and other environmental sensors
-- =====================================================

-- Garden Environmental Data
CREATE TABLE garden_environmental_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    garden_id UUID NOT NULL REFERENCES gardens(id) ON DELETE CASCADE,
    bot_id UUID REFERENCES bots(id) ON DELETE SET NULL, -- Which bot collected this data
    
    -- Environmental measurements
    temperature_celsius DECIMAL(5, 2),
    humidity_percentage DECIMAL(5, 2) CHECK (humidity_percentage >= 0 AND humidity_percentage <= 100),
    soil_moisture_percentage DECIMAL(5, 2) CHECK (soil_moisture_percentage >= 0 AND soil_moisture_percentage <= 100),
    
    -- Weather conditions
    is_raining BOOLEAN DEFAULT false,
    rain_intensity INTEGER CHECK (rain_intensity >= 0 AND rain_intensity <= 1023), -- Sensor reading
    
    -- Location where reading was taken
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    
    -- Additional sensor data (flexible)
    sensor_data JSONB DEFAULT '{}',
    
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pool Environmental Data
CREATE TABLE pool_environmental_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pool_id UUID NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    bot_id UUID REFERENCES bots(id) ON DELETE SET NULL,
    
    -- Environmental measurements
    air_temperature_celsius DECIMAL(5, 2),
    water_temperature_celsius DECIMAL(5, 2),
    humidity_percentage DECIMAL(5, 2) CHECK (humidity_percentage >= 0 AND humidity_percentage <= 100),
    
    -- Water quality (if bot has sensors)
    water_ph DECIMAL(4, 2) CHECK (water_ph >= 0 AND water_ph <= 14),
    chlorine_level DECIMAL(5, 2), -- in ppm
    turbidity DECIMAL(6, 2), -- NTU units
    
    -- Additional sensor data
    sensor_data JSONB DEFAULT '{}',
    
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- OPERATIONAL SESSION TABLES
-- Track actual work sessions with detailed sensor data
-- =====================================================

-- Garden Mowing Sessions
CREATE TABLE garden_mowing_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    garden_id UUID NOT NULL REFERENCES gardens(id) ON DELETE CASCADE,
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    
    -- Session metadata
    session_start TIMESTAMPTZ NOT NULL,
    session_end TIMESTAMPTZ,
    duration_minutes INTEGER, -- Calculated on session end
    
    -- Performance metrics
    area_covered_sqm DECIMAL(10, 2),
    distance_traveled_meters DECIMAL(10, 2),
    average_speed_mps DECIMAL(6, 2), -- meters per second
    
    -- Battery usage
    battery_start_percentage INTEGER CHECK (battery_start_percentage >= 0 AND battery_start_percentage <= 100),
    battery_end_percentage INTEGER CHECK (battery_end_percentage >= 0 AND battery_end_percentage <= 100),
    battery_consumed_percentage INTEGER,
    
    -- Session outcome
    completion_status TEXT CHECK (completion_status IN ('completed', 'interrupted', 'low_battery', 'rain', 'error', 'manual_stop')),
    
    -- GPS trail (array of location points)
    location_trail JSONB DEFAULT '[]', -- [{lat, lon, timestamp}, ...]
    
    -- Session notes/errors
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Mowing Session Sensor Data
-- Detailed sensor readings during mowing sessions
CREATE TABLE garden_mowing_sensor_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES garden_mowing_sessions(id) ON DELETE CASCADE,
    
    -- Timestamp
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Motor & Movement
    blade_rpm INTEGER, -- Cutting blade RPM
    drive_rpm INTEGER, -- Drive motor RPM
    direction_degrees DECIMAL(5, 2) CHECK (direction_degrees >= 0 AND direction_degrees < 360),
    
    -- 3D Orientation (from IMU)
    pitch DECIMAL(6, 2), -- Forward/backward tilt (-180 to 180)
    roll DECIMAL(6, 2),  -- Left/right tilt (-180 to 180)
    yaw DECIMAL(6, 2),   -- Compass heading (0-360)
    
    -- 3D Acceleration (m/s²)
    accel_x DECIMAL(8, 4),
    accel_y DECIMAL(8, 4),
    accel_z DECIMAL(8, 4),
    
    -- 3D Rotation rates (degrees/second)
    gyro_x DECIMAL(8, 4),
    gyro_y DECIMAL(8, 4),
    gyro_z DECIMAL(8, 4),
    
    -- Battery
    battery_percentage INTEGER CHECK (battery_percentage >= 0 AND battery_percentage <= 100),
    battery_voltage DECIMAL(5, 2),
    current_draw_amps DECIMAL(6, 2),
    
    -- Environmental
    temperature_celsius DECIMAL(5, 2),
    humidity_percentage DECIMAL(5, 2),
    
    -- Location
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    gps_accuracy_meters DECIMAL(6, 2),
    
    -- Additional sensor data (flexible JSONB)
    sensor_data JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pool Cleaning Sessions
CREATE TABLE pool_cleaning_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    pool_id UUID NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    
    -- Session metadata
    session_start TIMESTAMPTZ NOT NULL,
    session_end TIMESTAMPTZ,
    duration_minutes INTEGER,
    
    -- Performance metrics
    area_cleaned_sqm DECIMAL(10, 2),
    distance_traveled_meters DECIMAL(10, 2),
    
    -- Battery usage
    battery_start_percentage INTEGER CHECK (battery_start_percentage >= 0 AND battery_start_percentage <= 100),
    battery_end_percentage INTEGER CHECK (battery_end_percentage >= 0 AND battery_end_percentage <= 100),
    
    -- Water quality measurements during session
    water_quality_start JSONB DEFAULT '{}', -- {ph, chlorine, turbidity}
    water_quality_end JSONB DEFAULT '{}',
    
    -- Session outcome
    completion_status TEXT CHECK (completion_status IN ('completed', 'interrupted', 'low_battery', 'error', 'manual_stop')),
    
    -- Notes
    notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pool Cleaning Sensor Data
CREATE TABLE pool_cleaning_sensor_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES pool_cleaning_sessions(id) ON DELETE CASCADE,
    
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Motor & Movement
    pump_rpm INTEGER,
    brush_rpm INTEGER,
    
    -- 3D Orientation
    pitch DECIMAL(6, 2),
    roll DECIMAL(6, 2),
    yaw DECIMAL(6, 2),
    
    -- 3D Acceleration
    accel_x DECIMAL(8, 4),
    accel_y DECIMAL(8, 4),
    accel_z DECIMAL(8, 4),
    
    -- Battery
    battery_percentage INTEGER CHECK (battery_percentage >= 0 AND battery_percentage <= 100),
    battery_voltage DECIMAL(5, 2),
    
    -- Water quality (if measured continuously)
    water_temperature_celsius DECIMAL(5, 2),
    water_ph DECIMAL(4, 2),
    
    -- Additional sensors
    sensor_data JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- SERVICE EVENTS TABLE
-- Events related to service operations
-- =====================================================

CREATE TABLE service_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    bot_id UUID REFERENCES bots(id) ON DELETE SET NULL,
    
    -- Related session (if applicable)
    mowing_session_id UUID REFERENCES garden_mowing_sessions(id) ON DELETE SET NULL,
    cleaning_session_id UUID REFERENCES pool_cleaning_sessions(id) ON DELETE SET NULL,
    
    -- Event classification
    event_type TEXT NOT NULL CHECK (event_type IN (
        -- Session events
        'session_started', 'session_completed', 'session_paused', 'session_interrupted',
        
        -- Operational events
        'obstacle_detected', 'boundary_crossed', 'returned_to_dock',
        
        -- Environmental events
        'rain_detected', 'rain_stopped', 'temperature_alert',
        
        -- Alerts
        'low_battery', 'error_occurred', 'maintenance_required',
        
        -- Quality events (pool)
        'water_quality_alert', 'chemical_imbalance',
        
        -- Custom
        'custom'
    )),
    
    severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
    
    title TEXT NOT NULL,
    description TEXT,
    
    -- Event data
    data JSONB DEFAULT '{}',
    
    -- Location (if applicable)
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    
    event_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- INDEXES
-- =====================================================

-- Garden Environmental Data
CREATE INDEX idx_garden_env_garden_id ON garden_environmental_data(garden_id);
CREATE INDEX idx_garden_env_bot_id ON garden_environmental_data(bot_id) WHERE bot_id IS NOT NULL;
CREATE INDEX idx_garden_env_recorded_at ON garden_environmental_data(recorded_at DESC);
CREATE INDEX idx_garden_env_garden_time ON garden_environmental_data(garden_id, recorded_at DESC);

-- Pool Environmental Data
CREATE INDEX idx_pool_env_pool_id ON pool_environmental_data(pool_id);
CREATE INDEX idx_pool_env_bot_id ON pool_environmental_data(bot_id) WHERE bot_id IS NOT NULL;
CREATE INDEX idx_pool_env_recorded_at ON pool_environmental_data(recorded_at DESC);
CREATE INDEX idx_pool_env_pool_time ON pool_environmental_data(pool_id, recorded_at DESC);

-- Mowing Sessions
CREATE INDEX idx_mowing_sessions_garden_id ON garden_mowing_sessions(garden_id);
CREATE INDEX idx_mowing_sessions_bot_id ON garden_mowing_sessions(bot_id);
CREATE INDEX idx_mowing_sessions_start ON garden_mowing_sessions(session_start DESC);
CREATE INDEX idx_mowing_sessions_status ON garden_mowing_sessions(completion_status);
CREATE INDEX idx_mowing_sessions_garden_start ON garden_mowing_sessions(garden_id, session_start DESC);

-- Mowing Sensor Data
CREATE INDEX idx_mowing_sensor_session_id ON garden_mowing_sensor_data(session_id);
CREATE INDEX idx_mowing_sensor_recorded_at ON garden_mowing_sensor_data(recorded_at DESC);
CREATE INDEX idx_mowing_sensor_session_time ON garden_mowing_sensor_data(session_id, recorded_at DESC);

-- Pool Cleaning Sessions
CREATE INDEX idx_cleaning_sessions_pool_id ON pool_cleaning_sessions(pool_id);
CREATE INDEX idx_cleaning_sessions_bot_id ON pool_cleaning_sessions(bot_id);
CREATE INDEX idx_cleaning_sessions_start ON pool_cleaning_sessions(session_start DESC);
CREATE INDEX idx_cleaning_sessions_pool_start ON pool_cleaning_sessions(pool_id, session_start DESC);

-- Pool Cleaning Sensor Data
CREATE INDEX idx_cleaning_sensor_session_id ON pool_cleaning_sensor_data(session_id);
CREATE INDEX idx_cleaning_sensor_recorded_at ON pool_cleaning_sensor_data(recorded_at DESC);
CREATE INDEX idx_cleaning_sensor_session_time ON pool_cleaning_sensor_data(session_id, recorded_at DESC);

-- Service Events
CREATE INDEX idx_service_events_service_id ON service_events(service_id);
CREATE INDEX idx_service_events_bot_id ON service_events(bot_id) WHERE bot_id IS NOT NULL;
CREATE INDEX idx_service_events_event_type ON service_events(event_type);
CREATE INDEX idx_service_events_severity ON service_events(severity);
CREATE INDEX idx_service_events_timestamp ON service_events(event_timestamp DESC);
CREATE INDEX idx_service_events_mowing_session ON service_events(mowing_session_id) WHERE mowing_session_id IS NOT NULL;
CREATE INDEX idx_service_events_cleaning_session ON service_events(cleaning_session_id) WHERE cleaning_session_id IS NOT NULL;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE garden_environmental_data IS 'Environmental sensor data for gardens (temperature, humidity, soil moisture)';
COMMENT ON TABLE pool_environmental_data IS 'Environmental and water quality data for pools';
COMMENT ON TABLE garden_mowing_sessions IS 'Mowing work sessions with performance metrics';
COMMENT ON TABLE garden_mowing_sensor_data IS 'Detailed sensor data during mowing (RPM, orientation, acceleration)';
COMMENT ON TABLE pool_cleaning_sessions IS 'Pool cleaning work sessions';
COMMENT ON TABLE pool_cleaning_sensor_data IS 'Detailed sensor data during pool cleaning';
COMMENT ON TABLE service_events IS 'Events related to service operations';

COMMENT ON COLUMN garden_environmental_data.bot_id IS 'Which bot collected this data (nullable for manual entries)';
COMMENT ON COLUMN garden_mowing_sensor_data.pitch IS 'Forward/backward tilt angle';
COMMENT ON COLUMN garden_mowing_sensor_data.roll IS 'Left/right tilt angle';
COMMENT ON COLUMN garden_mowing_sensor_data.yaw IS 'Compass heading direction';
COMMENT ON COLUMN garden_mowing_sensor_data.sensor_data IS 'Additional sensor data as JSON';

-- =====================================================
-- DISABLE RLS ON ALL SERVICE DATA TABLES
-- =====================================================

ALTER TABLE garden_environmental_data DISABLE ROW LEVEL SECURITY;
ALTER TABLE pool_environmental_data DISABLE ROW LEVEL SECURITY;
ALTER TABLE garden_mowing_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE garden_mowing_sensor_data DISABLE ROW LEVEL SECURITY;
ALTER TABLE pool_cleaning_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE pool_cleaning_sensor_data DISABLE ROW LEVEL SECURITY;
ALTER TABLE service_events DISABLE ROW LEVEL SECURITY;

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Service-centric data tables created successfully';
    RAISE NOTICE '  - garden_environmental_data';
    RAISE NOTICE '  - pool_environmental_data';
    RAISE NOTICE '  - garden_mowing_sessions';
    RAISE NOTICE '  - garden_mowing_sensor_data';
    RAISE NOTICE '  - pool_cleaning_sessions';
    RAISE NOTICE '  - pool_cleaning_sensor_data';
    RAISE NOTICE '  - service_events';
    RAISE NOTICE '';
    RAISE NOTICE 'RLS disabled on all service data tables';
END $$;


