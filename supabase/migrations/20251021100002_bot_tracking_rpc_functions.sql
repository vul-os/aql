-- =====================================================
-- Bot Tracking RPC Functions
-- Allow users to view bot data through services/gardens/pools
-- =====================================================

-- =====================================================
-- 1. Get bot sensor data for a service
-- =====================================================
CREATE OR REPLACE FUNCTION get_service_bot_data(service_id_input UUID)
RETURNS TABLE (
    bot_id UUID,
    bot_name TEXT,
    bot_type TEXT,
    bot_status TEXT,
    latest_sensor_reading JSONB,
    recent_events JSONB,
    location_trail JSONB,
    today_stats JSONB
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_bot_id UUID;
    v_location_id UUID;
    v_org_id UUID;
    v_user_org_id UUID;
BEGIN
    -- Get the user's organization
    SELECT organization_id INTO v_user_org_id
    FROM profiles
    WHERE id = auth.uid();
    
    -- Get the bot and location for this service
    SELECT s.location_id INTO v_location_id
    FROM service_records s
    WHERE s.id = service_id_input;
    
    -- Get organization for this location
    SELECT l.organization_id INTO v_org_id
    FROM locations l
    WHERE l.id = v_location_id;
    
    -- Check if user has access (same organization or admin)
    IF v_user_org_id != v_org_id AND NOT EXISTS (
        SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true
    ) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;
    
    -- Get the bot for this location
    SELECT b.id INTO v_bot_id
    FROM bots b
    WHERE b.location_id = v_location_id
    LIMIT 1;
    
    -- Return bot data
    RETURN QUERY
    SELECT 
        b.id,
        b.name,
        b.bot_type,
        b.status,
        -- Latest sensor reading
        (SELECT row_to_json(sr.*) 
         FROM bot_sensor_readings sr 
         WHERE sr.bot_id = b.id 
         ORDER BY sr.recorded_at DESC 
         LIMIT 1),
        -- Recent events (last 20)
        (SELECT json_agg(e.* ORDER BY e.event_timestamp DESC)
         FROM (
             SELECT * FROM bot_events be
             WHERE be.bot_id = b.id 
             ORDER BY be.event_timestamp DESC 
             LIMIT 20
         ) e),
        -- Location trail (last 100 points)
        (SELECT json_agg(lh.* ORDER BY lh.recorded_at DESC)
         FROM (
             SELECT * FROM bot_location_history blh
             WHERE blh.bot_id = b.id 
             ORDER BY blh.recorded_at DESC 
             LIMIT 100
         ) lh),
        -- Today's statistics
        (SELECT row_to_json(ds.*)
         FROM bot_daily_statistics ds
         WHERE ds.bot_id = b.id 
         AND ds.date = CURRENT_DATE)
    FROM bots b
    WHERE b.id = v_bot_id;
END;
$$;

-- =====================================================
-- 2. Get bot data for a location (garden/pool)
-- =====================================================
CREATE OR REPLACE FUNCTION get_location_bot_data(location_id_input UUID)
RETURNS TABLE (
    bot_id UUID,
    bot_name TEXT,
    bot_type TEXT,
    bot_status TEXT,
    latest_sensor_reading JSONB,
    recent_events JSONB,
    location_trail JSONB,
    today_stats JSONB
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_org_id UUID;
    v_user_org_id UUID;
BEGIN
    -- Get the user's organization
    SELECT organization_id INTO v_user_org_id
    FROM profiles
    WHERE id = auth.uid();
    
    -- Get organization for this location
    SELECT organization_id INTO v_org_id
    FROM locations
    WHERE id = location_id_input;
    
    -- Check if user has access
    IF v_user_org_id != v_org_id AND NOT EXISTS (
        SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true
    ) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;
    
    -- Return data for all bots at this location (FIXED: added table aliases)
    RETURN QUERY
    SELECT 
        b.id,
        b.name,
        b.bot_type,
        b.status,
        (SELECT row_to_json(sr.*) 
         FROM bot_sensor_readings sr 
         WHERE sr.bot_id = b.id 
         ORDER BY sr.recorded_at DESC 
         LIMIT 1),
        (SELECT json_agg(e.* ORDER BY e.event_timestamp DESC)
         FROM (
             SELECT * FROM bot_events be
             WHERE be.bot_id = b.id 
             ORDER BY be.event_timestamp DESC 
             LIMIT 20
         ) e),
        (SELECT json_agg(lh.* ORDER BY lh.recorded_at DESC)
         FROM (
             SELECT * FROM bot_location_history blh
             WHERE blh.bot_id = b.id 
             ORDER BY blh.recorded_at DESC 
             LIMIT 100
         ) lh),
        (SELECT row_to_json(ds.*)
         FROM bot_daily_statistics ds
         WHERE ds.bot_id = b.id 
         AND ds.date = CURRENT_DATE)
    FROM bots b
    WHERE b.location_id = location_id_input;
END;
$$;

-- =====================================================
-- 3. Get bot sensor history (for graphs)
-- =====================================================
CREATE OR REPLACE FUNCTION get_bot_sensor_history(
    location_id_input UUID,
    hours_back INTEGER DEFAULT 24
)
RETURNS TABLE (
    recorded_at TIMESTAMPTZ,
    battery_percentage INTEGER,
    temperature_celsius DECIMAL,
    humidity_percentage DECIMAL,
    rpm INTEGER,
    is_on BOOLEAN,
    is_raining BOOLEAN
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_org_id UUID;
    v_user_org_id UUID;
BEGIN
    -- Get the user's organization
    SELECT organization_id INTO v_user_org_id
    FROM profiles
    WHERE id = auth.uid();
    
    -- Get organization for this location
    SELECT organization_id INTO v_org_id
    FROM locations
    WHERE id = location_id_input;
    
    -- Check access
    IF v_user_org_id != v_org_id AND NOT EXISTS (
        SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true
    ) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;
    
    -- Return sensor history
    RETURN QUERY
    SELECT 
        sr.recorded_at,
        sr.battery_percentage,
        sr.temperature_celsius,
        sr.humidity_percentage,
        sr.rpm,
        sr.is_on,
        sr.is_raining
    FROM bot_sensor_readings sr
    JOIN bots b ON b.id = sr.bot_id
    WHERE b.location_id = location_id_input
      AND sr.recorded_at > NOW() - (hours_back || ' hours')::INTERVAL
    ORDER BY sr.recorded_at ASC;
END;
$$;

-- =====================================================
-- 4. Get garden/pool statistics summary
-- =====================================================
CREATE OR REPLACE FUNCTION get_location_bot_statistics(
    location_id_input UUID,
    days_back INTEGER DEFAULT 7
)
RETURNS TABLE (
    date DATE,
    total_runtime_minutes INTEGER,
    total_distance_meters DECIMAL,
    average_battery_level DECIMAL,
    error_count INTEGER,
    warning_count INTEGER,
    average_temperature DECIMAL
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_org_id UUID;
    v_user_org_id UUID;
BEGIN
    -- Get the user's organization
    SELECT organization_id INTO v_user_org_id
    FROM profiles
    WHERE id = auth.uid();
    
    -- Get organization for this location
    SELECT organization_id INTO v_org_id
    FROM locations
    WHERE id = location_id_input;
    
    -- Check access
    IF v_user_org_id != v_org_id AND NOT EXISTS (
        SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true
    ) THEN
        RAISE EXCEPTION 'Access denied';
    END IF;
    
    -- Return statistics
    RETURN QUERY
    SELECT 
        ds.date,
        ds.total_runtime_minutes,
        ds.total_distance_meters,
        ds.average_battery_level,
        ds.error_count,
        ds.warning_count,
        ds.average_temperature
    FROM bot_daily_statistics ds
    JOIN bots b ON b.id = ds.bot_id
    WHERE b.location_id = location_id_input
      AND ds.date >= CURRENT_DATE - days_back
    ORDER BY ds.date DESC;
END;
$$;

-- =====================================================
-- 5. Get all my locations with bot status
-- =====================================================
CREATE OR REPLACE FUNCTION get_my_locations_with_bots()
RETURNS TABLE (
    location_id UUID,
    location_name TEXT,
    location_address TEXT,
    bot_id UUID,
    bot_name TEXT,
    bot_type TEXT,
    bot_status TEXT,
    battery_level INTEGER,
    last_online_at TIMESTAMPTZ,
    is_on BOOLEAN,
    current_temperature DECIMAL
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_org_id UUID;
BEGIN
    -- Get the user's organization
    SELECT organization_id INTO v_user_org_id
    FROM profiles
    WHERE id = auth.uid();
    
    IF v_user_org_id IS NULL THEN
        RAISE EXCEPTION 'User not associated with an organization';
    END IF;
    
    -- Return locations with bot data
    RETURN QUERY
    SELECT 
        l.id,
        l.name,
        l.address,
        b.id,
        b.name,
        b.bot_type,
        b.status,
        b.battery_level,
        b.last_online_at,
        sr.is_on,
        sr.temperature_celsius
    FROM locations l
    LEFT JOIN bots b ON b.location_id = l.id
    LEFT JOIN LATERAL (
        SELECT bot_sensor_readings.is_on, bot_sensor_readings.temperature_celsius
        FROM bot_sensor_readings
        WHERE bot_sensor_readings.bot_id = b.id
        ORDER BY recorded_at DESC
        LIMIT 1
    ) sr ON true
    WHERE l.organization_id = v_user_org_id
      AND l.is_active = true
    ORDER BY l.name;
END;
$$;

-- =====================================================
-- Grant permissions
-- =====================================================
GRANT EXECUTE ON FUNCTION get_service_bot_data(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_location_bot_data(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_bot_sensor_history(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_location_bot_statistics(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_my_locations_with_bots() TO authenticated;

-- =====================================================
-- Comments
-- =====================================================
COMMENT ON FUNCTION get_service_bot_data IS 'Get bot data for a specific service (checks user permissions)';
COMMENT ON FUNCTION get_location_bot_data IS 'Get bot data for a location/garden/pool (checks user permissions)';
COMMENT ON FUNCTION get_bot_sensor_history IS 'Get sensor history for graphs (with RLS)';
COMMENT ON FUNCTION get_location_bot_statistics IS 'Get daily statistics for a location (with RLS)';
COMMENT ON FUNCTION get_my_locations_with_bots IS 'Get all user locations with current bot status';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Bot tracking RPC functions created with RLS security';
END $$;


