-- Fix type mismatch in bot data functions
-- Change JSON to JSONB to match function signatures

-- =====================================================
-- 1. Fix get_service_bot_data
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
    
    -- Return bot data with proper JSONB casting
    RETURN QUERY
    SELECT 
        b.id,
        b.name,
        b.bot_type,
        b.status,
        (SELECT to_jsonb(sr.*) 
         FROM bot_sensor_readings sr 
         WHERE sr.bot_id = b.id 
         ORDER BY sr.recorded_at DESC 
         LIMIT 1),
        (SELECT jsonb_agg(e.* ORDER BY e.event_timestamp DESC)
         FROM (
             SELECT * FROM bot_events be
             WHERE be.bot_id = b.id 
             ORDER BY be.event_timestamp DESC 
             LIMIT 20
         ) e),
        (SELECT jsonb_agg(lh.* ORDER BY lh.recorded_at DESC)
         FROM (
             SELECT * FROM bot_location_history blh
             WHERE blh.bot_id = b.id 
             ORDER BY blh.recorded_at DESC 
             LIMIT 100
         ) lh),
        (SELECT to_jsonb(ds.*)
         FROM bot_daily_statistics ds
         WHERE ds.bot_id = b.id 
         AND ds.date = CURRENT_DATE)
    FROM bots b
    WHERE b.id = v_bot_id;
END;
$$;

-- =====================================================
-- 2. Fix get_location_bot_data
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
    
    -- Return data for all bots at this location (with proper JSONB casting)
    RETURN QUERY
    SELECT 
        b.id,
        b.name,
        b.bot_type,
        b.status,
        (SELECT to_jsonb(sr.*) 
         FROM bot_sensor_readings sr 
         WHERE sr.bot_id = b.id 
         ORDER BY sr.recorded_at DESC 
         LIMIT 1),
        (SELECT jsonb_agg(e.* ORDER BY e.event_timestamp DESC)
         FROM (
             SELECT * FROM bot_events be
             WHERE be.bot_id = b.id 
             ORDER BY be.event_timestamp DESC 
             LIMIT 20
         ) e),
        (SELECT jsonb_agg(lh.* ORDER BY lh.recorded_at DESC)
         FROM (
             SELECT * FROM bot_location_history blh
             WHERE blh.bot_id = b.id 
             ORDER BY blh.recorded_at DESC 
             LIMIT 100
         ) lh),
        (SELECT to_jsonb(ds.*)
         FROM bot_daily_statistics ds
         WHERE ds.bot_id = b.id 
         AND ds.date = CURRENT_DATE)
    FROM bots b
    WHERE b.location_id = location_id_input;
END;
$$;

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Fixed bot data functions type mismatch (JSON -> JSONB): get_service_bot_data, get_location_bot_data';
END $$;

