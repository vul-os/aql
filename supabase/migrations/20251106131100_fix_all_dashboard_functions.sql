-- Fix all dashboard RPC functions to use correct schema
-- Issues fixed:
-- 1. service_events doesn't have organization_id (join through services)
-- 2. bots doesn't have organization_id (join through locations)
-- 3. services uses 'status' not 'stage'
-- 4. bot_tracking_data might not exist (use bot_sensor_readings or bot_telemetry instead)

-- ============================================================================
-- Function: get_recent_activity_log - FIXED
-- ============================================================================
CREATE OR REPLACE FUNCTION get_recent_activity_log(org_id UUID, limit_count INTEGER DEFAULT 20)
RETURNS TABLE (
  id UUID,
  event_type TEXT,
  title TEXT,
  description TEXT,
  severity TEXT,
  created_at TIMESTAMPTZ,
  bot_id UUID,
  bot_name TEXT,
  service_id UUID,
  location_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    se.id,
    se.event_type,
    se.title,
    se.description,
    COALESCE(se.severity, 'info')::TEXT,
    se.created_at,
    se.bot_id,
    b.name as bot_name,
    se.service_id,
    l.name as location_name
  FROM service_events se
  LEFT JOIN bots b ON b.id = se.bot_id
  LEFT JOIN services s ON s.id = se.service_id
  LEFT JOIN locations l ON l.id = s.location_id
  WHERE s.organization_id = org_id  -- FIXED: filter through services table
  ORDER BY se.created_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Function: get_fleet_status_v2 - FIXED
-- ============================================================================
CREATE OR REPLACE FUNCTION get_fleet_status_v2(org_id UUID)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  WITH fleet_breakdown AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE b.status IN ('active', 'idle')) as active_now,
      COUNT(*) FILTER (WHERE b.status = 'charging') as charging,
      COUNT(*) FILTER (WHERE b.status = 'idle') as idle,
      COUNT(*) FILTER (WHERE b.status IN ('error', 'offline')) as needs_attention,
      -- Count bots currently running services
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM services 
        WHERE services.bot_id = b.id 
          AND services.status = 'active'  -- FIXED: use status not stage
      )) as running_services
    FROM bots b
    JOIN locations l ON l.id = b.location_id  -- FIXED: join through locations
    WHERE l.organization_id = org_id
      AND b.is_enabled = true
  )
  
  SELECT json_build_object(
    'total', COALESCE(total, 0),
    'active_now', COALESCE(active_now, 0),
    'charging', COALESCE(charging, 0),
    'idle', COALESCE(idle, 0),
    'needs_attention', COALESCE(needs_attention, 0),
    'active_services', COALESCE(running_services, 0)
  ) INTO result
  FROM fleet_breakdown;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Function: get_active_services_v2 - FIXED
-- ============================================================================
CREATE OR REPLACE FUNCTION get_active_services_v2(org_id UUID)
RETURNS TABLE (
  service_id UUID,
  service_name TEXT,
  service_type TEXT,
  bot_id UUID,
  bot_name TEXT,
  location_id UUID,
  location_name TEXT,
  started_at TIMESTAMPTZ,
  progress_percentage INTEGER,
  area_covered_sqm INTEGER,
  total_area_sqm INTEGER,
  battery_percentage INTEGER,
  estimated_completion_time TIMESTAMPTZ,
  runtime_minutes INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id as service_id,
    COALESCE(g.name, p.name, s.service_type::text) as service_name,
    s.service_type::text,
    b.id as bot_id,
    b.name as bot_name,
    l.id as location_id,
    l.name as location_name,
    s.started_at,
    
    -- Calculate progress based on service status
    CASE 
      WHEN s.status = 'active' THEN 50
      WHEN s.status = 'pending_installation' THEN 25
      ELSE 0
    END::INTEGER as progress_percentage,
    
    0::INTEGER as area_covered_sqm,  -- Not tracked yet
    COALESCE(g.area_sqm, 0)::INTEGER as total_area_sqm,
    
    -- Get battery from bot (simplified - use a default or latest value)
    COALESCE(b.battery_level, 100)::INTEGER as battery_percentage,
    
    -- Estimate completion time
    CASE
      WHEN s.started_at IS NOT NULL THEN
        s.started_at + INTERVAL '1 hour'
      ELSE NOW() + INTERVAL '1 hour'
    END as estimated_completion_time,
    
    -- Runtime in minutes (simplified)
    CASE
      WHEN s.started_at IS NOT NULL THEN
        EXTRACT(EPOCH FROM (NOW() - s.started_at))::INTEGER / 60
      ELSE 0
    END::INTEGER as runtime_minutes
    
  FROM services s
  LEFT JOIN gardens g ON g.service_id = s.id
  LEFT JOIN pools p ON p.service_id = s.id
  LEFT JOIN bots b ON b.id = s.bot_id
  LEFT JOIN locations l ON l.id = s.location_id
  WHERE s.organization_id = org_id
    AND s.status = 'active'  -- Only active services
    AND s.is_active = true
  ORDER BY s.started_at DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_recent_activity_log(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_fleet_status_v2(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_services_v2(UUID) TO authenticated;

COMMENT ON FUNCTION get_recent_activity_log IS 'Returns recent activity log - FIXED to join through services table';
COMMENT ON FUNCTION get_fleet_status_v2 IS 'Returns fleet status - FIXED to join bots through locations';
COMMENT ON FUNCTION get_active_services_v2 IS 'Returns active services - FIXED schema and removed non-existent tables';

