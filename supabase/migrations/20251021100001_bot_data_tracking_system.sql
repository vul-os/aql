-- =====================================================
-- Bot Data Tracking System Extension
-- Adds detailed sensor tracking, location history, and events
-- =====================================================

-- Add new telemetry types for specific sensors
-- Note: We're extending the existing bot_telemetry table's telemetry_type enum
DO $$ 
BEGIN
    -- Drop the old constraint if it exists
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'bot_telemetry_telemetry_type_check' 
        AND table_name = 'bot_telemetry'
    ) THEN
        ALTER TABLE bot_telemetry DROP CONSTRAINT bot_telemetry_telemetry_type_check;
    END IF;
    
    -- Add the new constraint with extended types
    ALTER TABLE bot_telemetry 
        ADD CONSTRAINT bot_telemetry_telemetry_type_check 
        CHECK (telemetry_type IN (
            'status', 'location', 'battery', 'temperature', 'humidity',
            'soil_moisture', 'water_quality', 'motion_detected', 'obstacle_detected',
            'weather_data', 'system_health', 'custom',
            -- New sensor types
            'sensors_snapshot',  -- Complete sensor reading (all sensors at once)
            'movement',          -- Direction, RPM, distance
            'orientation',       -- 3D orientation (pitch, roll, yaw)
            'acceleration',      -- 3D acceleration
            'rotation',          -- 3D rotation rates
            'rain',              -- Rain sensor
            'environmental'      -- Combined temp, humidity, rain
        ));
END $$;

-- BOT_LOCATION_HISTORY TABLE
-- Track GPS positions over time to show where the bot has been
CREATE TABLE bot_location_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    
    -- GPS position
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    altitude DECIMAL(8, 2), -- in meters
    accuracy DECIMAL(6, 2), -- GPS accuracy in meters
    heading DECIMAL(5, 2), -- Compass heading 0-360 degrees
    
    -- Movement data at this position
    speed DECIMAL(6, 2), -- Speed in meters per second
    is_moving BOOLEAN DEFAULT false,
    
    -- Timestamp
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Link to telemetry if this came from a sensor reading
    telemetry_id UUID REFERENCES bot_telemetry(id) ON DELETE SET NULL,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- BOT_EVENTS TABLE
-- Track important events that happen with the bot
CREATE TABLE bot_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    
    -- Event classification
    event_type TEXT NOT NULL CHECK (event_type IN (
        -- Power & operational
        'powered_on', 'powered_off', 'started', 'stopped', 'paused', 'resumed',
        'charging_started', 'charging_completed', 'charging_interrupted',
        
        -- Navigation & movement
        'route_started', 'route_completed', 'route_paused', 'returned_home',
        'obstacle_detected', 'stuck_detected', 'boundary_crossed',
        
        -- Environmental
        'rain_detected', 'rain_stopped', 'temperature_threshold_exceeded',
        'low_battery_warning', 'critical_battery',
        
        -- Errors & alerts
        'error_occurred', 'error_resolved', 'emergency_stop', 'tipped_over',
        'motor_stall', 'sensor_failure', 'connection_lost', 'connection_restored',
        
        -- Maintenance
        'maintenance_mode_entered', 'maintenance_mode_exited',
        'firmware_update_started', 'firmware_update_completed', 'firmware_update_failed',
        
        -- Schedule
        'scheduled_task_started', 'scheduled_task_completed', 'scheduled_task_skipped',
        
        -- Custom
        'custom'
    )),
    
    -- Event severity
    severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
    
    -- Event details
    title TEXT NOT NULL,
    description TEXT,
    
    -- Event data (flexible for different event types)
    data JSONB DEFAULT '{}',
    
    -- Location when event occurred
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    
    -- Related entities
    command_id UUID REFERENCES bot_commands(id) ON DELETE SET NULL,
    alert_id UUID REFERENCES bot_alerts(id) ON DELETE SET NULL,
    
    -- Timestamps
    event_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- BOT_SENSOR_READINGS TABLE
-- Structured table for common sensor readings (alternative to bot_telemetry JSONB)
-- This makes it easier to query specific sensor values over time
CREATE TABLE bot_sensor_readings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    
    -- Timestamp
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Status & Power
    is_on BOOLEAN,
    battery_percentage INTEGER CHECK (battery_percentage >= 0 AND battery_percentage <= 100),
    battery_voltage DECIMAL(5, 2), -- in volts
    is_charging BOOLEAN,
    
    -- Movement & Motors
    direction_degrees DECIMAL(5, 2), -- 0-360 degrees
    rpm INTEGER, -- Motor RPM
    distance_traveled_cm DECIMAL(10, 2), -- Distance in centimeters since last reading
    speed_cm_per_sec DECIMAL(8, 2), -- Current speed
    
    -- 3D Orientation (from IMU - gyroscope)
    pitch DECIMAL(6, 2), -- Rotation around X-axis (-180 to 180)
    roll DECIMAL(6, 2),  -- Rotation around Y-axis (-180 to 180)
    yaw DECIMAL(6, 2),   -- Rotation around Z-axis (0-360, same as compass heading)
    
    -- 3D Acceleration (from IMU - accelerometer, in m/s²)
    acceleration_x DECIMAL(8, 4),
    acceleration_y DECIMAL(8, 4),
    acceleration_z DECIMAL(8, 4),
    
    -- 3D Rotation rates (from IMU - gyroscope, in degrees/second)
    rotation_x DECIMAL(8, 4),
    rotation_y DECIMAL(8, 4),
    rotation_z DECIMAL(8, 4),
    
    -- Environmental sensors
    temperature_celsius DECIMAL(5, 2),
    humidity_percentage DECIMAL(5, 2) CHECK (humidity_percentage >= 0 AND humidity_percentage <= 100),
    is_raining BOOLEAN,
    rain_intensity INTEGER, -- 0-1023 (analog reading, or 0-100 percentage)
    
    -- GPS (if available)
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    gps_accuracy_meters DECIMAL(6, 2),
    
    -- Additional bot-specific data (flexible JSONB for things like water quality, soil moisture, etc.)
    bot_specific_data JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- BOT_DAILY_STATISTICS TABLE
-- Aggregated daily stats for performance tracking
CREATE TABLE bot_daily_statistics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    
    -- Operation time
    total_runtime_minutes INTEGER DEFAULT 0,
    active_time_minutes INTEGER DEFAULT 0,
    idle_time_minutes INTEGER DEFAULT 0,
    charging_time_minutes INTEGER DEFAULT 0,
    
    -- Distance and coverage
    total_distance_meters DECIMAL(10, 2) DEFAULT 0,
    area_covered_sqm DECIMAL(10, 2) DEFAULT 0,
    
    -- Battery stats
    average_battery_level DECIMAL(5, 2),
    min_battery_level INTEGER,
    max_battery_level INTEGER,
    charge_cycles INTEGER DEFAULT 0,
    
    -- Events
    total_events INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    warning_count INTEGER DEFAULT 0,
    
    -- Environmental
    average_temperature DECIMAL(5, 2),
    max_temperature DECIMAL(5, 2),
    min_temperature DECIMAL(5, 2),
    rain_detected_count INTEGER DEFAULT 0,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Unique constraint: one record per bot per day
    UNIQUE(bot_id, date)
);

-- Indexes for bot_location_history
CREATE INDEX IF NOT EXISTS idx_bot_location_history_bot_id ON bot_location_history(bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_location_history_recorded_at ON bot_location_history(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_location_history_coordinates ON bot_location_history(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_bot_location_history_bot_time ON bot_location_history(bot_id, recorded_at DESC);

-- Indexes for bot_events
CREATE INDEX IF NOT EXISTS idx_bot_events_bot_id ON bot_events(bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_events_event_type ON bot_events(event_type);
CREATE INDEX IF NOT EXISTS idx_bot_events_severity ON bot_events(severity);
CREATE INDEX IF NOT EXISTS idx_bot_events_event_timestamp ON bot_events(event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_bot_events_bot_time ON bot_events(bot_id, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_bot_events_command_id ON bot_events(command_id) WHERE command_id IS NOT NULL;

-- Indexes for bot_sensor_readings
CREATE INDEX IF NOT EXISTS idx_bot_sensor_readings_bot_id ON bot_sensor_readings(bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_sensor_readings_recorded_at ON bot_sensor_readings(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_sensor_readings_bot_time ON bot_sensor_readings(bot_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_sensor_readings_battery ON bot_sensor_readings(battery_percentage) WHERE battery_percentage < 20;
CREATE INDEX IF NOT EXISTS idx_bot_sensor_readings_raining ON bot_sensor_readings(is_raining) WHERE is_raining = true;

-- Indexes for bot_daily_statistics
CREATE INDEX IF NOT EXISTS idx_bot_daily_statistics_bot_id ON bot_daily_statistics(bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_daily_statistics_date ON bot_daily_statistics(date DESC);
CREATE INDEX IF NOT EXISTS idx_bot_daily_statistics_bot_date ON bot_daily_statistics(bot_id, date DESC);

-- Comments
COMMENT ON TABLE bot_location_history IS 'GPS tracking history showing where bots have been';
COMMENT ON TABLE bot_events IS 'Log of all important events that happen with bots';
COMMENT ON TABLE bot_sensor_readings IS 'Structured sensor data: RPM, orientation, acceleration, temp, humidity, rain, battery';
COMMENT ON TABLE bot_daily_statistics IS 'Daily aggregated statistics for bot performance tracking';

COMMENT ON COLUMN bot_sensor_readings.pitch IS 'Rotation around X-axis: forward/backward tilt';
COMMENT ON COLUMN bot_sensor_readings.roll IS 'Rotation around Y-axis: left/right tilt';
COMMENT ON COLUMN bot_sensor_readings.yaw IS 'Rotation around Z-axis: compass direction';
COMMENT ON COLUMN bot_sensor_readings.bot_specific_data IS 'JSON field for bot-type specific sensors (e.g., pool: water_ph, chlorine_level; mow: blade_rpm, grass_height)';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Bot data tracking system created: location history, events, sensor readings, daily statistics';
END $$;


