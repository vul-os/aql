-- =====================================================
-- Bots and Operations Tables
-- =====================================================

-- BOTS TABLE
CREATE TABLE bots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    bot_type TEXT NOT NULL CHECK (bot_type IN ('mow_bot', 'weather_station', 'pool_bot', 'security_bot')),
    
    -- Hardware identification
    serial_number TEXT UNIQUE,
    identifier TEXT,
    hardware_version TEXT,
    firmware_version TEXT,
    
    -- Status
    status TEXT DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'active', 'idle', 'charging', 'error', 'maintenance')),
    is_enabled BOOLEAN DEFAULT true,
    last_online_at TIMESTAMPTZ,
    last_command_at TIMESTAMPTZ,
    battery_level INTEGER CHECK (battery_level >= 0 AND battery_level <= 100),
    
    -- Network
    connection_type TEXT CHECK (connection_type IN ('wifi', 'cellular', 'ethernet', 'lora')),
    ip_address TEXT,
    mac_address TEXT,
    
    -- Service tracking
    date_installed TIMESTAMPTZ,
    last_service_date TIMESTAMPTZ,
    next_service_date TIMESTAMPTZ,
    service_interval_days INTEGER DEFAULT 90,
    warranty_expires_at DATE,
    
    -- Operations tracking
    total_runtime_hours DECIMAL(10, 2) DEFAULT 0,
    total_operations INTEGER DEFAULT 0,
    
    -- QR code for identification
    qr_code_url TEXT,
    
    -- Configuration and metadata
    config JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- BOT_COMMANDS TABLE
CREATE TABLE bot_commands (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    issued_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    command_type TEXT NOT NULL CHECK (command_type IN (
        'power_on', 'power_off', 'start', 'stop', 'pause', 'resume',
        'return_home', 'emergency_stop', 'reboot', 'update_firmware',
        'start_recording', 'stop_recording', 'arm_security', 'disarm_security',
        'custom'
    )),
    command_payload JSONB DEFAULT '{}',
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'acknowledged', 'completed', 'failed', 'timeout')),
    sent_at TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    response JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- BOT_TELEMETRY TABLE
CREATE TABLE bot_telemetry (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    telemetry_type TEXT NOT NULL CHECK (telemetry_type IN (
        'status', 'location', 'battery', 'temperature', 'humidity',
        'soil_moisture', 'water_quality', 'motion_detected', 'obstacle_detected',
        'weather_data', 'system_health', 'custom'
    )),
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- BOT_SCHEDULES TABLE
CREATE TABLE bot_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    schedule_type TEXT NOT NULL CHECK (schedule_type IN ('one_time', 'daily', 'weekly', 'monthly', 'cron')),
    cron_expression TEXT,
    start_date DATE,
    end_date DATE,
    time_of_day TIME,
    days_of_week INTEGER[] CHECK (days_of_week <@ ARRAY[0,1,2,3,4,5,6]),
    command_type TEXT NOT NULL,
    command_payload JSONB DEFAULT '{}',
    is_enabled BOOLEAN DEFAULT true,
    last_run_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- BOT_ALERTS TABLE
CREATE TABLE bot_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    alert_type TEXT NOT NULL CHECK (alert_type IN (
        'low_battery', 'offline', 'error', 'maintenance_required',
        'motion_detected', 'security_breach', 'obstacle', 'weather_alert',
        'water_quality_issue', 'sensor_failure', 'custom'
    )),
    severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
    title TEXT NOT NULL,
    message TEXT,
    data JSONB,
    is_read BOOLEAN DEFAULT false,
    is_resolved BOOLEAN DEFAULT false,
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for bots
CREATE INDEX IF NOT EXISTS idx_bots_location_id ON bots(location_id);
CREATE INDEX IF NOT EXISTS idx_bots_bot_type ON bots(bot_type);
CREATE INDEX IF NOT EXISTS idx_bots_status ON bots(status);
CREATE INDEX IF NOT EXISTS idx_bots_serial_number ON bots(serial_number);
CREATE INDEX IF NOT EXISTS idx_bots_identifier ON bots(identifier);
CREATE INDEX IF NOT EXISTS idx_bots_is_enabled ON bots(is_enabled);
CREATE INDEX IF NOT EXISTS idx_bots_next_service_date ON bots(next_service_date);
CREATE INDEX IF NOT EXISTS idx_bots_warranty_expires_at ON bots(warranty_expires_at);

-- Indexes for bot_commands
CREATE INDEX IF NOT EXISTS idx_bot_commands_bot_id ON bot_commands(bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_commands_issued_by ON bot_commands(issued_by);
CREATE INDEX IF NOT EXISTS idx_bot_commands_status ON bot_commands(status);
CREATE INDEX IF NOT EXISTS idx_bot_commands_created_at ON bot_commands(created_at DESC);

-- Indexes for bot_telemetry
CREATE INDEX IF NOT EXISTS idx_bot_telemetry_bot_id ON bot_telemetry(bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_telemetry_timestamp ON bot_telemetry(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_bot_telemetry_type ON bot_telemetry(telemetry_type);

-- Indexes for bot_schedules
CREATE INDEX IF NOT EXISTS idx_bot_schedules_bot_id ON bot_schedules(bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_schedules_is_enabled ON bot_schedules(is_enabled);
CREATE INDEX IF NOT EXISTS idx_bot_schedules_next_run_at ON bot_schedules(next_run_at);

-- Indexes for bot_alerts
CREATE INDEX IF NOT EXISTS idx_bot_alerts_bot_id ON bot_alerts(bot_id);
CREATE INDEX IF NOT EXISTS idx_bot_alerts_location_id ON bot_alerts(location_id);
CREATE INDEX IF NOT EXISTS idx_bot_alerts_alert_type ON bot_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_bot_alerts_severity ON bot_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_bot_alerts_is_read ON bot_alerts(is_read);
CREATE INDEX IF NOT EXISTS idx_bot_alerts_is_resolved ON bot_alerts(is_resolved);
CREATE INDEX IF NOT EXISTS idx_bot_alerts_created_at ON bot_alerts(created_at DESC);

-- Enable RLS
ALTER TABLE bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_alerts ENABLE ROW LEVEL SECURITY;

-- Comments
COMMENT ON TABLE bots IS 'Individual bot instances (mow, weather, pool, security)';
COMMENT ON TABLE bot_commands IS 'Commands sent to bots for control (on/off, start/stop)';
COMMENT ON TABLE bot_telemetry IS 'Sensor data and telemetry from bots';
COMMENT ON TABLE bot_schedules IS 'Automated schedules for bot operations';
COMMENT ON TABLE bot_alerts IS 'Alerts and notifications from bots';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Bot and operations tables created: bots, bot_commands, bot_telemetry, bot_schedules, bot_alerts';
END $$;

