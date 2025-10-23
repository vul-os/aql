-- Fix duplicate locations in get_my_locations_with_bots function
-- This prevents React duplicate key errors

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
    
    -- Return locations with bot data (DISTINCT ON to prevent duplicates)
    RETURN QUERY
    SELECT DISTINCT ON (l.id)
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
    ORDER BY l.id, l.name;
END;
$$;

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Fixed get_my_locations_with_bots to prevent duplicate locations';
END $$;

