-- Core home management tables

-- Homes table (central tenant table)
CREATE TABLE homes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT,
    timezone TEXT DEFAULT 'UTC',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Home members with roles for RLS
CREATE TABLE home_members (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    home_id UUID REFERENCES homes(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    invited_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    joined_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(home_id, user_id)
);

-- Device categories for organization
CREATE TABLE device_categories (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    icon TEXT,
    description TEXT
);

-- Insert default categories
INSERT INTO device_categories (name, icon, description) VALUES
('lawn_care', '🌱', 'Lawn mowers and garden equipment'),
('weather', '🌤️', 'Weather monitoring stations'),
('pool', '🏊', 'Pool sensors and equipment'),
('security', '🔒', 'Security cameras and sensors'),
('energy', '⚡', 'Energy monitoring and solar panels'),
('hvac', '🌡️', 'Heating, ventilation, and air conditioning');

-- Generic devices table (can be extended for specific device types)
CREATE TABLE devices (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    home_id UUID REFERENCES homes(id) ON DELETE CASCADE,
    category_id UUID REFERENCES device_categories(id),
    name TEXT NOT NULL,
    model TEXT,
    manufacturer TEXT,
    serial_number TEXT,
    mac_address TEXT,
    ip_address INET,
    location_description TEXT,
    is_active BOOLEAN DEFAULT true,
    last_seen TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Lawn mowers table
CREATE TABLE mowers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    device_id UUID REFERENCES devices(id) ON DELETE CASCADE UNIQUE,
    battery_level INTEGER CHECK (battery_level >= 0 AND battery_level <= 100),
    cutting_height_mm INTEGER,
    area_covered_sqm DECIMAL,
    current_status TEXT CHECK (current_status IN ('mowing', 'charging', 'idle', 'error', 'maintenance')),
    schedule_enabled BOOLEAN DEFAULT false,
    schedule_config JSONB DEFAULT '{}',
    last_maintenance TIMESTAMP WITH TIME ZONE,
    total_runtime_hours DECIMAL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Weather stations table
CREATE TABLE weather_stations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    device_id UUID REFERENCES devices(id) ON DELETE CASCADE UNIQUE,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    elevation_meters DECIMAL,
    station_type TEXT,
    calibration_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Weather readings table
CREATE TABLE weather_readings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    weather_station_id UUID REFERENCES weather_stations(id) ON DELETE CASCADE,
    temperature_celsius DECIMAL(5,2),
    humidity_percent DECIMAL(5,2),
    pressure_hpa DECIMAL(7,2),
    wind_speed_kmh DECIMAL(5,2),
    wind_direction_degrees INTEGER CHECK (wind_direction_degrees >= 0 AND wind_direction_degrees < 360),
    rainfall_mm DECIMAL(6,2),
    uv_index DECIMAL(3,1),
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Pool sensors table
CREATE TABLE pool_sensors (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    device_id UUID REFERENCES devices(id) ON DELETE CASCADE UNIQUE,
    pool_volume_liters INTEGER,
    sensor_depth_cm INTEGER,
    calibration_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Pool readings table
CREATE TABLE pool_readings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    pool_sensor_id UUID REFERENCES pool_sensors(id) ON DELETE CASCADE,
    water_temperature_celsius DECIMAL(4,1),
    ph_level DECIMAL(3,1),
    chlorine_ppm DECIMAL(4,1),
    alkalinity_ppm INTEGER,
    water_level_cm DECIMAL(5,1),
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Generic sensor readings for extensibility
CREATE TABLE sensor_readings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
    sensor_type TEXT NOT NULL,
    value DECIMAL,
    unit TEXT,
    metadata JSONB DEFAULT '{}',
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Device alerts/notifications
CREATE TABLE device_alerts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
    alert_type TEXT NOT NULL,
    severity TEXT CHECK (severity IN ('info', 'warning', 'error', 'critical')),
    title TEXT NOT NULL,
    message TEXT,
    is_resolved BOOLEAN DEFAULT false,
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolved_by UUID REFERENCES auth.users(id),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX idx_home_members_home_id ON home_members(home_id);
CREATE INDEX idx_home_members_user_id ON home_members(user_id);
CREATE INDEX idx_devices_home_id ON devices(home_id);
CREATE INDEX idx_devices_category_id ON devices(category_id);
CREATE INDEX idx_weather_readings_station_recorded ON weather_readings(weather_station_id, recorded_at DESC);
CREATE INDEX idx_pool_readings_sensor_recorded ON pool_readings(pool_sensor_id, recorded_at DESC);
CREATE INDEX idx_sensor_readings_device_recorded ON sensor_readings(device_id, recorded_at DESC);
CREATE INDEX idx_device_alerts_device_unresolved ON device_alerts(device_id) WHERE NOT is_resolved;

-- Enable RLS on all tables
ALTER TABLE homes ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE mowers ENABLE ROW LEVEL SECURITY;
ALTER TABLE weather_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE weather_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pool_sensors ENABLE ROW LEVEL SECURITY;
ALTER TABLE pool_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensor_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_alerts ENABLE ROW LEVEL SECURITY;

-- Basic RLS policies (you'll need to customize these based on your needs)

-- Home members can view homes they belong to
CREATE POLICY "Users can view homes they are members of" ON homes
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM home_members 
            WHERE home_members.home_id = homes.id 
            AND home_members.user_id = auth.uid()
        )
    );

-- Only owners and admins can modify homes
CREATE POLICY "Owners and admins can modify homes" ON homes
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM home_members 
            WHERE home_members.home_id = homes.id 
            AND home_members.user_id = auth.uid()
            AND home_members.role IN ('owner', 'admin')
        )
    );

-- Home members policies
CREATE POLICY "Users can view home members of their homes" ON home_members
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM home_members hm 
            WHERE hm.home_id = home_members.home_id 
            AND hm.user_id = auth.uid()
        )
    );

-- Devices policies - members can view, admins+ can modify
CREATE POLICY "Home members can view devices" ON devices
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM home_members 
            WHERE home_members.home_id = devices.home_id 
            AND home_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Home admins can modify devices" ON devices
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM home_members 
            WHERE home_members.home_id = devices.home_id 
            AND home_members.user_id = auth.uid()
            AND home_members.role IN ('owner', 'admin', 'member')
        )
    );

-- Subscription and billing tables

-- Service packages available
CREATE TABLE service_packages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    base_price_cents INTEGER NOT NULL,
    billing_cycle TEXT CHECK (billing_cycle IN ('monthly', 'quarterly', 'yearly')),
    max_mowers INTEGER DEFAULT 1,
    includes_pool_maintenance BOOLEAN DEFAULT false,
    includes_weather_monitoring BOOLEAN DEFAULT true,
    features JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default packages
INSERT INTO service_packages (name, description, base_price_cents, billing_cycle, max_mowers, includes_pool_maintenance, includes_weather_monitoring, features) VALUES
('Basic', 'Single mower with weather monitoring', 9900, 'monthly', 1, false, true, '{"support": "email", "alerts": true}'),
('Premium', 'Up to 3 mowers with pool maintenance', 19900, 'monthly', 3, true, true, '{"support": "priority", "alerts": true, "advanced_scheduling": true}'),
('Enterprise', 'Unlimited mowers and full maintenance', 39900, 'monthly', 999, true, true, '{"support": "phone", "alerts": true, "advanced_scheduling": true, "custom_integrations": true}');

-- Add-on services
CREATE TABLE service_addons (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    price_cents INTEGER NOT NULL,
    addon_type TEXT CHECK (addon_type IN ('extra_mower', 'pool_maintenance', 'premium_support', 'extended_warranty')),
    is_recurring BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default add-ons
INSERT INTO service_addons (name, description, price_cents, addon_type, is_recurring) VALUES
('Additional Mower', 'Add another mower to your plan', 4900, 'extra_mower', true),
('Pool Maintenance', 'Pool sensor monitoring and maintenance alerts', 7900, 'pool_maintenance', true),
('Premium Support', 'Priority phone and chat support', 2900, 'premium_support', true),
('Extended Warranty', '2-year extended warranty on all devices', 9900, 'extended_warranty', false);

-- Home subscriptions
CREATE TABLE home_subscriptions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    home_id UUID REFERENCES homes(id) ON DELETE CASCADE,
    package_id UUID REFERENCES service_packages(id),
    status TEXT CHECK (status IN ('active', 'inactive', 'suspended', 'cancelled', 'trial')) DEFAULT 'trial',
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    trial_ends_at TIMESTAMP WITH TIME ZONE,
    next_billing_date TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE,
    cancellation_reason TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Home subscription add-ons
CREATE TABLE home_subscription_addons (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    subscription_id UUID REFERENCES home_subscriptions(id) ON DELETE CASCADE,
    addon_id UUID REFERENCES service_addons(id),
    quantity INTEGER DEFAULT 1,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    removed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Maintenance scheduling tables

-- Service technicians/teams
CREATE TABLE service_technicians (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    phone TEXT,
    specialties TEXT[] DEFAULT '{}', -- ['mower', 'pool', 'weather', 'general']
    service_areas JSONB DEFAULT '{}', -- geographical areas they cover
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Available maintenance time slots
CREATE TABLE maintenance_slots (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    technician_id UUID REFERENCES service_technicians(id),
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    slot_type TEXT CHECK (slot_type IN ('routine', 'emergency', 'installation')) DEFAULT 'routine',
    max_bookings INTEGER DEFAULT 1,
    is_available BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT valid_time_range CHECK (end_time > start_time)
);

-- Maintenance service types
CREATE TABLE maintenance_service_types (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    estimated_duration_minutes INTEGER,
    service_category TEXT CHECK (service_category IN ('mower', 'pool', 'weather', 'general', 'emergency')),
    requires_parts BOOLEAN DEFAULT false,
    price_cents INTEGER,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default maintenance services
INSERT INTO maintenance_service_types (name, description, estimated_duration_minutes, service_category, requires_parts, price_cents) VALUES
('Mower Blade Sharpening', 'Sharpen and balance mower blades', 30, 'mower', false, 4900),
('Mower Full Service', 'Complete mower maintenance check', 90, 'mower', true, 12900),
('Pool Sensor Calibration', 'Calibrate all pool sensors', 45, 'pool', false, 7900),
('Pool Equipment Cleaning', 'Clean pool sensors and equipment', 60, 'pool', false, 9900),
('Weather Station Calibration', 'Calibrate weather monitoring equipment', 30, 'weather', false, 5900),
('Emergency Repair', 'Emergency device repair service', 120, 'emergency', true, 19900),
('Annual System Check', 'Comprehensive system health check', 180, 'general', false, 24900);

-- Scheduled maintenance bookings
CREATE TABLE maintenance_bookings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    home_id UUID REFERENCES homes(id) ON DELETE CASCADE,
    slot_id UUID REFERENCES maintenance_slots(id),
    service_type_id UUID REFERENCES maintenance_service_types(id),
    technician_id UUID REFERENCES service_technicians(id),
    
    -- Booking details
    scheduled_date TIMESTAMP WITH TIME ZONE NOT NULL,
    estimated_duration_minutes INTEGER,
    priority TEXT CHECK (priority IN ('low', 'normal', 'high', 'emergency')) DEFAULT 'normal',
    
    -- Status tracking
    status TEXT CHECK (status IN ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'rescheduled')) DEFAULT 'scheduled',
    
    -- Contact and access info
    contact_name TEXT,
    contact_phone TEXT,
    special_instructions TEXT,
    access_instructions TEXT,
    
    -- Completion tracking
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    work_performed TEXT,
    parts_used JSONB DEFAULT '{}',
    next_service_due TIMESTAMP WITH TIME ZONE,
    
    -- Billing
    total_cost_cents INTEGER,
    is_covered_by_subscription BOOLEAN DEFAULT false,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Requested by which home member
    requested_by UUID REFERENCES auth.users(id)
);

-- Device-specific maintenance history
CREATE TABLE device_maintenance_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    device_id UUID REFERENCES devices(id) ON DELETE CASCADE,
    booking_id UUID REFERENCES maintenance_bookings(id),
    maintenance_type TEXT NOT NULL,
    description TEXT,
    parts_replaced JSONB DEFAULT '{}',
    issues_found TEXT[],
    recommendations TEXT[],
    next_service_due TIMESTAMP WITH TIME ZONE,
    cost_cents INTEGER,
    performed_by UUID REFERENCES service_technicians(id),
    performed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Recurring maintenance schedules
CREATE TABLE maintenance_schedules (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    home_id UUID REFERENCES homes(id) ON DELETE CASCADE,
    service_type_id UUID REFERENCES maintenance_service_types(id),
    device_id UUID REFERENCES devices(id), -- optional, for device-specific maintenance
    
    -- Schedule configuration
    frequency_type TEXT CHECK (frequency_type IN ('weekly', 'monthly', 'quarterly', 'yearly', 'usage_based')) NOT NULL,
    frequency_value INTEGER DEFAULT 1, -- every X weeks/months/etc
    preferred_time_of_day TIME,
    preferred_day_of_week INTEGER CHECK (preferred_day_of_week BETWEEN 1 AND 7), -- 1=Monday
    preferred_week_of_month INTEGER CHECK (preferred_week_of_month BETWEEN 1 AND 4),
    
    -- Usage-based triggers (for mowers, etc.)
    trigger_hours_usage INTEGER,
    trigger_area_covered_sqm DECIMAL,
    
    -- Schedule status
    is_active BOOLEAN DEFAULT true,
    last_scheduled TIMESTAMP WITH TIME ZONE,
    next_due TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

-- Create indexes for maintenance tables
CREATE INDEX idx_home_subscriptions_home_id ON home_subscriptions(home_id);
CREATE INDEX idx_home_subscriptions_status ON home_subscriptions(status);
CREATE INDEX idx_maintenance_slots_technician_time ON maintenance_slots(technician_id, start_time);
CREATE INDEX idx_maintenance_bookings_home_date ON maintenance_bookings(home_id, scheduled_date);
CREATE INDEX idx_maintenance_bookings_status ON maintenance_bookings(status);
CREATE INDEX idx_device_maintenance_history_device ON device_maintenance_history(device_id, performed_at DESC);
CREATE INDEX idx_maintenance_schedules_next_due ON maintenance_schedules(next_due) WHERE is_active = true;

-- Enable RLS on new tables
ALTER TABLE service_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_subscription_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_technicians ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_service_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_maintenance_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_schedules ENABLE ROW LEVEL SECURITY;

-- RLS policies for subscription tables

-- Anyone can view available packages and add-ons
CREATE POLICY "Anyone can view service packages" ON service_packages
    FOR SELECT USING (is_active = true);

CREATE POLICY "Anyone can view service addons" ON service_addons
    FOR SELECT USING (is_active = true);

-- Home members can view their subscription
CREATE POLICY "Home members can view subscriptions" ON home_subscriptions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM home_members 
            WHERE home_members.home_id = home_subscriptions.home_id 
            AND home_members.user_id = auth.uid()
        )
    );

-- Only owners can modify subscriptions
CREATE POLICY "Home owners can manage subscriptions" ON home_subscriptions
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM home_members 
            WHERE home_members.home_id = home_subscriptions.home_id 
            AND home_members.user_id = auth.uid()
            AND home_members.role = 'owner'
        )
    );

-- Maintenance booking policies
CREATE POLICY "Home members can view maintenance bookings" ON maintenance_bookings
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM home_members 
            WHERE home_members.home_id = maintenance_bookings.home_id 
            AND home_members.user_id = auth.uid()
        )
    );

CREATE POLICY "Home members can create maintenance bookings" ON maintenance_bookings
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM home_members 
            WHERE home_members.home_id = maintenance_bookings.home_id 
            AND home_members.user_id = auth.uid()
            AND home_members.role IN ('owner', 'admin', 'member')
        )
    );

-- Anyone can view available maintenance slots and service types
CREATE POLICY "Anyone can view maintenance slots" ON maintenance_slots
    FOR SELECT USING (is_available = true);

CREATE POLICY "Anyone can view maintenance service types" ON maintenance_service_types
    FOR SELECT USING (is_active = true);