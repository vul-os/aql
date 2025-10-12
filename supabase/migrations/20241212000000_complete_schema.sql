-- =====================================================
-- BotKorp Complete Database Schema
-- All tables, indexes, and essential triggers
-- =====================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- CORE TABLES
-- =====================================================

-- PROFILES TABLE
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    phone TEXT,
    role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin', 'staff', 'owner')),
    organization_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_profiles_organization_id ON profiles(organization_id);
CREATE INDEX idx_profiles_email ON profiles(email);
CREATE INDEX idx_profiles_role ON profiles(role);

-- ORGANIZATIONS TABLE
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    logo_url TEXT,
    owner_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    subscription_tier TEXT DEFAULT 'free' CHECK (subscription_tier IN ('free', 'basic', 'premium', 'enterprise')),
    is_active BOOLEAN DEFAULT true,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_organizations_owner_id ON organizations(owner_id);
CREATE INDEX idx_organizations_slug ON organizations(slug);
CREATE INDEX idx_organizations_is_active ON organizations(is_active);

ALTER TABLE profiles ADD CONSTRAINT fk_profiles_organization 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;

-- LOCATIONS TABLE
CREATE TABLE IF NOT EXISTS locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    address TEXT,
    city TEXT,
    state TEXT,
    country TEXT DEFAULT 'South Africa',
    province TEXT DEFAULT 'KwaZulu-Natal',
    suburb TEXT,
    postal_code TEXT,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    timezone TEXT DEFAULT 'Africa/Johannesburg',
    location_type TEXT CHECK (location_type IN ('residential', 'commercial', 'industrial', 'agricultural')),
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_locations_organization_id ON locations(organization_id);
CREATE INDEX idx_locations_is_active ON locations(is_active);
CREATE INDEX idx_locations_coordinates ON locations(latitude, longitude);

-- BOTS TABLE
CREATE TABLE IF NOT EXISTS bots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    bot_type TEXT NOT NULL CHECK (bot_type IN ('mow_bot', 'weather_station', 'pool_bot', 'security_bot')),
    serial_number TEXT UNIQUE,
    identifier TEXT,
    hardware_version TEXT,
    firmware_version TEXT,
    status TEXT DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'active', 'idle', 'charging', 'error', 'maintenance')),
    is_enabled BOOLEAN DEFAULT true,
    last_online_at TIMESTAMPTZ,
    last_command_at TIMESTAMPTZ,
    battery_level INTEGER CHECK (battery_level >= 0 AND battery_level <= 100),
    connection_type TEXT CHECK (connection_type IN ('wifi', 'cellular', 'ethernet', 'lora')),
    ip_address TEXT,
    mac_address TEXT,
    date_installed TIMESTAMPTZ,
    last_service_date TIMESTAMPTZ,
    next_service_date TIMESTAMPTZ,
    service_interval_days INTEGER DEFAULT 90,
    total_runtime_hours DECIMAL(10, 2) DEFAULT 0,
    total_operations INTEGER DEFAULT 0,
    warranty_expires_at DATE,
    qr_code_url TEXT,
    config JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bots_location_id ON bots(location_id);
CREATE INDEX idx_bots_bot_type ON bots(bot_type);
CREATE INDEX idx_bots_status ON bots(status);
CREATE INDEX idx_bots_serial_number ON bots(serial_number);
CREATE INDEX idx_bots_identifier ON bots(identifier);
CREATE INDEX idx_bots_is_enabled ON bots(is_enabled);
CREATE INDEX idx_bots_next_service_date ON bots(next_service_date);
CREATE INDEX idx_bots_warranty_expires_at ON bots(warranty_expires_at);

-- =====================================================
-- GARDENS & POOLS
-- =====================================================

-- GARDENS TABLE
CREATE TABLE IF NOT EXISTS gardens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    area_sqm DECIMAL(10, 2),
    perimeter_m DECIMAL(10, 2),
    grass_type TEXT,
    terrain_type TEXT CHECK (terrain_type IN ('flat', 'sloped', 'mixed', 'hilly')),
    difficulty_level TEXT CHECK (difficulty_level IN ('easy', 'moderate', 'difficult')),
    has_obstacles BOOLEAN DEFAULT false,
    obstacle_description TEXT,
    images TEXT[] DEFAULT ARRAY[]::TEXT[],
    thumbnail_url TEXT,
    preferred_cut_height_mm INTEGER,
    preferred_pattern TEXT CHECK (preferred_pattern IN ('stripe', 'random', 'spiral', 'checkerboard')),
    mowing_frequency_days INTEGER DEFAULT 7,
    is_active BOOLEAN DEFAULT true,
    requires_maintenance BOOLEAN DEFAULT false,
    last_mowed_at TIMESTAMPTZ,
    next_scheduled_mow TIMESTAMPTZ,
    boundary_geojson JSONB,
    metadata JSONB DEFAULT '{}',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_gardens_location_id ON gardens(location_id);
CREATE INDEX idx_gardens_is_active ON gardens(is_active);
CREATE INDEX idx_gardens_next_scheduled_mow ON gardens(next_scheduled_mow);
CREATE INDEX idx_gardens_requires_maintenance ON gardens(requires_maintenance);

-- POOLS TABLE
CREATE TABLE IF NOT EXISTS pools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    pool_type TEXT CHECK (pool_type IN ('inground', 'above_ground', 'infinity', 'lap', 'plunge', 'natural')),
    length_m DECIMAL(6, 2),
    width_m DECIMAL(6, 2),
    depth_shallow_m DECIMAL(4, 2),
    depth_deep_m DECIMAL(4, 2),
    volume_liters DECIMAL(10, 2),
    surface_area_sqm DECIMAL(10, 2),
    has_heater BOOLEAN DEFAULT false,
    has_cover BOOLEAN DEFAULT false,
    has_salt_system BOOLEAN DEFAULT false,
    filtration_type TEXT,
    images TEXT[] DEFAULT ARRAY[]::TEXT[],
    thumbnail_url TEXT,
    target_ph_min DECIMAL(3, 2) DEFAULT 7.2,
    target_ph_max DECIMAL(3, 2) DEFAULT 7.6,
    target_chlorine_min DECIMAL(4, 2) DEFAULT 1.0,
    target_chlorine_max DECIMAL(4, 2) DEFAULT 3.0,
    target_temperature_min DECIMAL(4, 1),
    target_temperature_max DECIMAL(4, 1),
    cleaning_frequency_days INTEGER DEFAULT 7,
    last_cleaned_at TIMESTAMPTZ,
    next_scheduled_clean TIMESTAMPTZ,
    last_water_test_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    requires_maintenance BOOLEAN DEFAULT false,
    is_winterized BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pools_location_id ON pools(location_id);
CREATE INDEX idx_pools_is_active ON pools(is_active);
CREATE INDEX idx_pools_next_scheduled_clean ON pools(next_scheduled_clean);
CREATE INDEX idx_pools_requires_maintenance ON pools(requires_maintenance);
CREATE INDEX idx_pools_pool_type ON pools(pool_type);

-- BOT_GARDEN_ASSIGNMENTS TABLE
CREATE TABLE IF NOT EXISTS bot_garden_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    garden_id UUID NOT NULL REFERENCES gardens(id) ON DELETE CASCADE,
    is_primary BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    assigned_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    unassigned_at TIMESTAMPTZ,
    total_mows INTEGER DEFAULT 0,
    total_runtime_minutes INTEGER DEFAULT 0,
    last_mowed_at TIMESTAMPTZ,
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(bot_id, garden_id)
);

CREATE INDEX idx_bot_garden_bot_id ON bot_garden_assignments(bot_id);
CREATE INDEX idx_bot_garden_garden_id ON bot_garden_assignments(garden_id);
CREATE INDEX idx_bot_garden_is_active ON bot_garden_assignments(is_active);
CREATE INDEX idx_bot_garden_is_primary ON bot_garden_assignments(is_primary);

-- BOT_POOL_ASSIGNMENTS TABLE
CREATE TABLE IF NOT EXISTS bot_pool_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    pool_id UUID NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    is_primary BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    assigned_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    unassigned_at TIMESTAMPTZ,
    total_cleanings INTEGER DEFAULT 0,
    total_runtime_minutes INTEGER DEFAULT 0,
    last_cleaned_at TIMESTAMPTZ,
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(bot_id, pool_id)
);

CREATE INDEX idx_bot_pool_bot_id ON bot_pool_assignments(bot_id);
CREATE INDEX idx_bot_pool_pool_id ON bot_pool_assignments(pool_id);
CREATE INDEX idx_bot_pool_is_active ON bot_pool_assignments(is_active);
CREATE INDEX idx_bot_pool_is_primary ON bot_pool_assignments(is_primary);

-- =====================================================
-- BOT OPERATIONS
-- =====================================================

-- BOT_COMMANDS TABLE
CREATE TABLE IF NOT EXISTS bot_commands (
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

CREATE INDEX idx_bot_commands_bot_id ON bot_commands(bot_id);
CREATE INDEX idx_bot_commands_issued_by ON bot_commands(issued_by);
CREATE INDEX idx_bot_commands_status ON bot_commands(status);
CREATE INDEX idx_bot_commands_created_at ON bot_commands(created_at DESC);

-- BOT_TELEMETRY TABLE
CREATE TABLE IF NOT EXISTS bot_telemetry (
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

CREATE INDEX idx_bot_telemetry_bot_id ON bot_telemetry(bot_id);
CREATE INDEX idx_bot_telemetry_timestamp ON bot_telemetry(timestamp DESC);
CREATE INDEX idx_bot_telemetry_type ON bot_telemetry(telemetry_type);

-- BOT_SCHEDULES TABLE
CREATE TABLE IF NOT EXISTS bot_schedules (
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

CREATE INDEX idx_bot_schedules_bot_id ON bot_schedules(bot_id);
CREATE INDEX idx_bot_schedules_is_enabled ON bot_schedules(is_enabled);
CREATE INDEX idx_bot_schedules_next_run_at ON bot_schedules(next_run_at);

-- BOT_ALERTS TABLE
CREATE TABLE IF NOT EXISTS bot_alerts (
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

CREATE INDEX idx_bot_alerts_bot_id ON bot_alerts(bot_id);
CREATE INDEX idx_bot_alerts_location_id ON bot_alerts(location_id);
CREATE INDEX idx_bot_alerts_alert_type ON bot_alerts(alert_type);
CREATE INDEX idx_bot_alerts_severity ON bot_alerts(severity);
CREATE INDEX idx_bot_alerts_is_read ON bot_alerts(is_read);
CREATE INDEX idx_bot_alerts_is_resolved ON bot_alerts(is_resolved);
CREATE INDEX idx_bot_alerts_created_at ON bot_alerts(created_at DESC);

-- =====================================================
-- SERVICE & SESSIONS
-- =====================================================

-- SERVICE_RECORDS TABLE
CREATE TABLE IF NOT EXISTS service_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    service_type TEXT NOT NULL CHECK (service_type IN (
        'routine_maintenance', 'repair', 'inspection', 'installation',
        'firmware_update', 'part_replacement', 'emergency', 'recall',
        'warranty', 'calibration', 'cleaning', 'other'
    )),
    title TEXT NOT NULL,
    description TEXT,
    performed_by_name TEXT,
    performed_by_company TEXT,
    technician_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    scheduled_date DATE,
    service_start TIMESTAMPTZ,
    service_end TIMESTAMPTZ,
    duration_minutes INTEGER,
    status TEXT DEFAULT 'scheduled' CHECK (status IN (
        'scheduled', 'in_progress', 'completed', 'cancelled', 'failed'
    )),
    parts_replaced TEXT[],
    parts_cost DECIMAL(10, 2),
    labor_cost DECIMAL(10, 2),
    total_cost DECIMAL(10, 2),
    currency TEXT DEFAULT 'ZAR',
    issues_found TEXT[],
    actions_taken TEXT[],
    recommendations TEXT[],
    follow_up_required BOOLEAN DEFAULT false,
    follow_up_date DATE,
    photos TEXT[],
    documents TEXT[],
    warranty_valid_until DATE,
    related_alert_id UUID REFERENCES bot_alerts(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_service_records_bot_id ON service_records(bot_id);
CREATE INDEX idx_service_records_location_id ON service_records(location_id);
CREATE INDEX idx_service_records_service_type ON service_records(service_type);
CREATE INDEX idx_service_records_status ON service_records(status);
CREATE INDEX idx_service_records_scheduled_date ON service_records(scheduled_date);
CREATE INDEX idx_service_records_follow_up_required ON service_records(follow_up_required);
CREATE INDEX idx_service_records_created_at ON service_records(created_at DESC);

-- MOWING_SESSIONS TABLE
CREATE TABLE IF NOT EXISTS mowing_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    garden_id UUID NOT NULL REFERENCES gardens(id) ON DELETE CASCADE,
    assignment_id UUID REFERENCES bot_garden_assignments(id) ON DELETE SET NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    duration_minutes INTEGER,
    area_mowed_sqm DECIMAL(10, 2),
    distance_traveled_m DECIMAL(10, 2),
    battery_start INTEGER,
    battery_end INTEGER,
    battery_used INTEGER,
    charging_time_minutes INTEGER,
    weather_temp_c DECIMAL(4, 1),
    weather_conditions TEXT,
    pattern_used TEXT,
    cut_height_mm INTEGER,
    quality_rating INTEGER CHECK (quality_rating >= 1 AND quality_rating <= 5),
    obstacles_detected INTEGER DEFAULT 0,
    pauses_count INTEGER DEFAULT 0,
    errors_count INTEGER DEFAULT 0,
    emergency_stops INTEGER DEFAULT 0,
    completed_successfully BOOLEAN DEFAULT true,
    path_geojson JSONB,
    metadata JSONB DEFAULT '{}',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mowing_sessions_bot_id ON mowing_sessions(bot_id);
CREATE INDEX idx_mowing_sessions_garden_id ON mowing_sessions(garden_id);
CREATE INDEX idx_mowing_sessions_start_time ON mowing_sessions(start_time DESC);
CREATE INDEX idx_mowing_sessions_completed ON mowing_sessions(completed_successfully);

-- POOL_CLEANING_SESSIONS TABLE
CREATE TABLE IF NOT EXISTS pool_cleaning_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    pool_id UUID NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    assignment_id UUID REFERENCES bot_pool_assignments(id) ON DELETE SET NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    duration_minutes INTEGER,
    area_cleaned_sqm DECIMAL(10, 2),
    battery_start INTEGER,
    battery_end INTEGER,
    battery_used INTEGER,
    charging_time_minutes INTEGER,
    ph_before DECIMAL(3, 2),
    ph_after DECIMAL(3, 2),
    chlorine_before DECIMAL(4, 2),
    chlorine_after DECIMAL(4, 2),
    temperature_before DECIMAL(4, 1),
    temperature_after DECIMAL(4, 1),
    debris_removed_g INTEGER,
    quality_rating INTEGER CHECK (quality_rating >= 1 AND quality_rating <= 5),
    filter_cleaned BOOLEAN DEFAULT false,
    walls_scrubbed BOOLEAN DEFAULT false,
    floor_vacuumed BOOLEAN DEFAULT false,
    errors_count INTEGER DEFAULT 0,
    completed_successfully BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pool_cleaning_bot_id ON pool_cleaning_sessions(bot_id);
CREATE INDEX idx_pool_cleaning_pool_id ON pool_cleaning_sessions(pool_id);
CREATE INDEX idx_pool_cleaning_start_time ON pool_cleaning_sessions(start_time DESC);
CREATE INDEX idx_pool_cleaning_completed ON pool_cleaning_sessions(completed_successfully);

-- =====================================================
-- COVERAGE, PRICING & PAYMENTS
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

CREATE INDEX idx_coverage_areas_country ON coverage_areas(country);
CREATE INDEX idx_coverage_areas_province ON coverage_areas(province);
CREATE INDEX idx_coverage_areas_city ON coverage_areas(city);
CREATE INDEX idx_coverage_areas_is_active ON coverage_areas(is_active);
CREATE INDEX idx_coverage_areas_postal_codes ON coverage_areas USING GIN(postal_codes);
CREATE INDEX idx_coverage_areas_coordinates ON coverage_areas(center_latitude, center_longitude);

-- BOT_PRICING TABLE
CREATE TABLE IF NOT EXISTS bot_pricing (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_type TEXT NOT NULL CHECK (bot_type IN ('mow_bot', 'weather_station', 'pool_bot', 'security_bot')),
    coverage_area_id UUID REFERENCES coverage_areas(id) ON DELETE CASCADE,
    monthly_rate DECIMAL(10, 2) NOT NULL,
    currency TEXT DEFAULT 'ZAR' NOT NULL,
    quarterly_rate DECIMAL(10, 2),
    annual_rate DECIMAL(10, 2),
    setup_fee DECIMAL(10, 2) DEFAULT 0,
    min_contract_months INTEGER DEFAULT 1,
    tier TEXT DEFAULT 'standard',
    is_active BOOLEAN DEFAULT true,
    valid_from DATE DEFAULT CURRENT_DATE,
    valid_until DATE,
    description TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bot_pricing_bot_type ON bot_pricing(bot_type);
CREATE INDEX idx_bot_pricing_coverage_area ON bot_pricing(coverage_area_id);
CREATE INDEX idx_bot_pricing_is_active ON bot_pricing(is_active);
CREATE INDEX idx_bot_pricing_valid_dates ON bot_pricing(valid_from, valid_until);

-- SERVICE_FEES TABLE
CREATE TABLE IF NOT EXISTS service_fees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fee_type TEXT NOT NULL CHECK (fee_type IN (
        'maintenance', 'repair', 'emergency_callout', 'installation',
        'training', 'upgrade', 'relocation', 'late_payment',
        'cancellation', 'data_storage', 'api_access',
        'custom'
    )),
    fee_name TEXT NOT NULL,
    description TEXT,
    amount DECIMAL(10, 2) NOT NULL,
    currency TEXT DEFAULT 'ZAR' NOT NULL,
    billing_type TEXT CHECK (billing_type IN ('one_time', 'monthly', 'per_incident', 'per_unit', 'hourly')),
    applies_to TEXT CHECK (applies_to IN ('all', 'specific_bot_type', 'specific_area', 'specific_org')),
    bot_type TEXT CHECK (bot_type IN ('mow_bot', 'weather_station', 'pool_bot', 'security_bot')),
    coverage_area_id UUID REFERENCES coverage_areas(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    is_taxable BOOLEAN DEFAULT true,
    tax_rate DECIMAL(5, 2) DEFAULT 15.00,
    is_active BOOLEAN DEFAULT true,
    valid_from DATE DEFAULT CURRENT_DATE,
    valid_until DATE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_service_fees_fee_type ON service_fees(fee_type);
CREATE INDEX idx_service_fees_is_active ON service_fees(is_active);
CREATE INDEX idx_service_fees_applies_to ON service_fees(applies_to);
CREATE INDEX idx_service_fees_valid_dates ON service_fees(valid_from, valid_until);

-- ORGANIZATION_MEMBERS TABLE
CREATE TABLE IF NOT EXISTS organization_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN (
        'owner', 'admin', 'manager', 'operator', 'viewer', 'member'
    )),
    can_manage_bots BOOLEAN DEFAULT false,
    can_manage_locations BOOLEAN DEFAULT false,
    can_view_billing BOOLEAN DEFAULT false,
    can_manage_billing BOOLEAN DEFAULT false,
    can_manage_members BOOLEAN DEFAULT false,
    can_view_analytics BOOLEAN DEFAULT true,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended', 'removed')),
    invited_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    invited_at TIMESTAMPTZ,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    last_active_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, user_id)
);

CREATE INDEX idx_org_members_organization_id ON organization_members(organization_id);
CREATE INDEX idx_org_members_user_id ON organization_members(user_id);
CREATE INDEX idx_org_members_role ON organization_members(role);
CREATE INDEX idx_org_members_status ON organization_members(status);

-- PAYMENTS TABLE
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    amount DECIMAL(10, 2) NOT NULL,
    currency TEXT DEFAULT 'ZAR' NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'processing', 'completed', 'failed', 
        'cancelled', 'refunded', 'disputed'
    )),
    ozow_transaction_id TEXT UNIQUE,
    ozow_site_code TEXT,
    ozow_payment_status TEXT,
    ozow_reference TEXT,
    ozow_response JSONB,
    payment_method TEXT DEFAULT 'ozow' CHECK (payment_method IN ('ozow', 'bank_transfer', 'credit_card', 'cash', 'other')),
    payment_type TEXT CHECK (payment_type IN (
        'subscription', 'setup_fee', 'service_fee', 'top_up', 'other'
    )),
    description TEXT,
    invoice_number TEXT,
    bot_id UUID REFERENCES bots(id) ON DELETE SET NULL,
    subscription_id UUID,
    paid_at TIMESTAMPTZ,
    due_date DATE,
    refunded_at TIMESTAMPTZ,
    payer_name TEXT,
    payer_email TEXT,
    payer_phone TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_payments_organization_id ON payments(organization_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_ozow_transaction_id ON payments(ozow_transaction_id);
CREATE INDEX idx_payments_bot_id ON payments(bot_id);
CREATE INDEX idx_payments_created_at ON payments(created_at DESC);
CREATE INDEX idx_payments_due_date ON payments(due_date);

-- SUBSCRIPTIONS TABLE
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    pricing_id UUID REFERENCES bot_pricing(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
        'trial', 'active', 'past_due', 'cancelled', 'expired', 'suspended'
    )),
    billing_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'quarterly', 'annual')),
    amount DECIMAL(10, 2) NOT NULL,
    currency TEXT DEFAULT 'ZAR' NOT NULL,
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date DATE,
    next_billing_date DATE,
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    cancellation_reason TEXT,
    auto_renew BOOLEAN DEFAULT true,
    trial_ends_at DATE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_organization_id ON subscriptions(organization_id);
CREATE INDEX idx_subscriptions_bot_id ON subscriptions(bot_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_next_billing_date ON subscriptions(next_billing_date);
CREATE INDEX idx_subscriptions_end_date ON subscriptions(end_date);

-- INVOICES TABLE
CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    invoice_number TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft', 'sent', 'paid', 'overdue', 'cancelled', 'refunded'
    )),
    subtotal DECIMAL(10, 2) NOT NULL,
    tax_amount DECIMAL(10, 2) DEFAULT 0,
    total_amount DECIMAL(10, 2) NOT NULL,
    amount_paid DECIMAL(10, 2) DEFAULT 0,
    currency TEXT DEFAULT 'ZAR' NOT NULL,
    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date DATE NOT NULL,
    paid_at TIMESTAMPTZ,
    line_items JSONB NOT NULL DEFAULT '[]',
    payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
    notes TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invoices_organization_id ON invoices(organization_id);
CREATE INDEX idx_invoices_invoice_number ON invoices(invoice_number);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_due_date ON invoices(due_date);
CREATE INDEX idx_invoices_created_at ON invoices(created_at DESC);

-- ACTIVITY_LOGS TABLE
CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id UUID,
    details JSONB,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX idx_activity_logs_organization_id ON activity_logs(organization_id);
CREATE INDEX idx_activity_logs_resource ON activity_logs(resource_type, resource_id);
CREATE INDEX idx_activity_logs_created_at ON activity_logs(created_at DESC);

-- =====================================================
-- TRIGGERS FOR UPDATED_AT
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_locations_updated_at BEFORE UPDATE ON locations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bots_updated_at BEFORE UPDATE ON bots
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_gardens_updated_at BEFORE UPDATE ON gardens
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_pools_updated_at BEFORE UPDATE ON pools
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bot_garden_assignments_updated_at BEFORE UPDATE ON bot_garden_assignments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bot_pool_assignments_updated_at BEFORE UPDATE ON bot_pool_assignments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bot_schedules_updated_at BEFORE UPDATE ON bot_schedules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_coverage_areas_updated_at BEFORE UPDATE ON coverage_areas
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bot_pricing_updated_at BEFORE UPDATE ON bot_pricing
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_service_fees_updated_at BEFORE UPDATE ON service_fees
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_organization_members_updated_at BEFORE UPDATE ON organization_members
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payments_updated_at BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_service_records_updated_at BEFORE UPDATE ON service_records
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE gardens ENABLE ROW LEVEL SECURITY;
ALTER TABLE pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_garden_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_pool_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE mowing_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pool_cleaning_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE coverage_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE profiles IS 'User profiles extending Supabase auth.users';
COMMENT ON TABLE organizations IS 'Organizations/companies owning bots and locations';
COMMENT ON TABLE locations IS 'Physical locations where bots are deployed';
COMMENT ON TABLE bots IS 'Individual bot instances (mow, weather, pool, security)';
COMMENT ON TABLE gardens IS 'Individual gardens/lawns at locations with measurements and preferences';
COMMENT ON TABLE pools IS 'Individual pools at locations with measurements and water quality targets';
COMMENT ON TABLE bot_garden_assignments IS 'Many-to-many: assigns bots to gardens they service';
COMMENT ON TABLE bot_pool_assignments IS 'Many-to-many: assigns bots to pools they service';
COMMENT ON TABLE bot_commands IS 'Commands sent to bots for control (on/off, start/stop)';
COMMENT ON TABLE bot_telemetry IS 'Sensor data and telemetry from bots';
COMMENT ON TABLE bot_schedules IS 'Automated schedules for bot operations';
COMMENT ON TABLE bot_alerts IS 'Alerts and notifications from bots';
COMMENT ON TABLE service_records IS 'Complete service and maintenance history for all bots';
COMMENT ON TABLE mowing_sessions IS 'Individual mowing sessions for analytics and tracking';
COMMENT ON TABLE pool_cleaning_sessions IS 'Individual pool cleaning sessions for analytics';
COMMENT ON TABLE coverage_areas IS 'Geographic areas where BotKorp services are available';
COMMENT ON TABLE bot_pricing IS 'Monthly rates per bot type and coverage area';
COMMENT ON TABLE service_fees IS 'Additional service fees for easy calculation';
COMMENT ON TABLE organization_members IS 'Team members within organizations with roles and permissions';
COMMENT ON TABLE payments IS 'Payment transactions with Ozow Pay integration';
COMMENT ON TABLE subscriptions IS 'Bot subscription management and billing cycles';
COMMENT ON TABLE invoices IS 'Generated invoices for subscriptions and fees';
COMMENT ON TABLE activity_logs IS 'Audit trail for all system activities';

