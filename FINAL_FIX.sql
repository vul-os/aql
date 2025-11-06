-- FINAL FIX - service_events doesn't have organization_id
-- Run this in Supabase SQL Editor

DROP FUNCTION IF EXISTS get_dashboard_analytics_v2(UUID);

CREATE OR REPLACE FUNCTION get_dashboard_analytics_v2(org_id UUID)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'services', json_build_object(
      'total_services', (SELECT COUNT(*) FROM services WHERE organization_id = org_id AND is_active = true),
      'total_gardens', (SELECT COUNT(*) FROM services WHERE organization_id = org_id AND service_type = 'lawn' AND is_active = true),
      'total_pools', (SELECT COUNT(*) FROM services WHERE organization_id = org_id AND service_type = 'pool' AND is_active = true),
      'total_area_sqm', COALESCE((SELECT SUM(area_sqm) FROM services WHERE organization_id = org_id AND is_active = true), 0)
    ),
    'bots', json_build_object(
      'total', (
        SELECT COUNT(*) 
        FROM bots b
        JOIN locations l ON l.id = b.location_id
        WHERE l.organization_id = org_id
      ),
      'operational', (
        SELECT COUNT(*) 
        FROM bots b
        JOIN locations l ON l.id = b.location_id
        WHERE l.organization_id = org_id 
          AND b.status IN ('operational', 'active', 'online')
      ),
      'charging', (
        SELECT COUNT(*) 
        FROM bots b
        JOIN locations l ON l.id = b.location_id
        WHERE l.organization_id = org_id 
          AND b.status = 'charging'
      ),
      'offline', (
        SELECT COUNT(*) 
        FROM bots b
        JOIN locations l ON l.id = b.location_id
        WHERE l.organization_id = org_id 
          AND b.status IN ('offline', 'idle')
      ),
      'errors', (
        SELECT COUNT(*) 
        FROM bots b
        JOIN locations l ON l.id = b.location_id
        WHERE l.organization_id = org_id 
          AND b.status = 'error'
      ),
      'active_now', (
        SELECT COUNT(*) 
        FROM bots b
        JOIN locations l ON l.id = b.location_id
        WHERE l.organization_id = org_id 
          AND b.status IN ('operational', 'active')
      )
    ),
    'services_today', json_build_object(
      'completed', COALESCE((SELECT COUNT(*) FROM services WHERE organization_id = org_id AND stage = 'completed' AND completed_at::date = CURRENT_DATE), 0),
      'in_progress', COALESCE((SELECT COUNT(*) FROM services WHERE organization_id = org_id AND stage IN ('in_progress', 'active')), 0),
      'scheduled', COALESCE((SELECT COUNT(*) FROM services WHERE organization_id = org_id AND next_service_date::date = CURRENT_DATE), 0),
      'area_covered_sqm', COALESCE((SELECT SUM(area_sqm) FROM services WHERE organization_id = org_id AND stage = 'completed' AND completed_at::date = CURRENT_DATE), 0)
    ),
    'alerts', json_build_object(
      'total', COALESCE((
        SELECT COUNT(*) 
        FROM service_events se
        WHERE se.event_type = 'alert' 
          AND COALESCE(se.resolved, false) = false
          AND EXISTS (
            SELECT 1 FROM services s 
            WHERE s.id = se.service_id 
              AND s.organization_id = org_id
          )
      ), 0),
      'critical', COALESCE((
        SELECT COUNT(*) 
        FROM service_events se
        WHERE se.event_type = 'alert' 
          AND se.severity = 'critical' 
          AND COALESCE(se.resolved, false) = false
          AND EXISTS (
            SELECT 1 FROM services s 
            WHERE s.id = se.service_id 
              AND s.organization_id = org_id
          )
      ), 0),
      'warning', COALESCE((
        SELECT COUNT(*) 
        FROM service_events se
        WHERE se.event_type = 'alert' 
          AND se.severity = 'warning' 
          AND COALESCE(se.resolved, false) = false
          AND EXISTS (
            SELECT 1 FROM services s 
            WHERE s.id = se.service_id 
              AND s.organization_id = org_id
          )
      ), 0),
      'info', COALESCE((
        SELECT COUNT(*) 
        FROM service_events se
        WHERE se.event_type = 'alert' 
          AND COALESCE(se.severity, 'info') = 'info' 
          AND COALESCE(se.resolved, false) = false
          AND EXISTS (
            SELECT 1 FROM services s 
            WHERE s.id = se.service_id 
              AND s.organization_id = org_id
          )
      ), 0)
    ),
    'system_health', json_build_object(
      'score', 85,
      'bots_operational_pct', CASE 
        WHEN (SELECT COUNT(*) FROM bots b JOIN locations l ON l.id = b.location_id WHERE l.organization_id = org_id) > 0 
        THEN ROUND(
          (SELECT COUNT(*)::NUMERIC FROM bots b JOIN locations l ON l.id = b.location_id WHERE l.organization_id = org_id AND b.status IN ('operational', 'active')) / 
          (SELECT COUNT(*) FROM bots b JOIN locations l ON l.id = b.location_id WHERE l.organization_id = org_id) * 100, 
          1
        )
        ELSE 0 
      END,
      'services_active', (SELECT COUNT(*) FROM services WHERE organization_id = org_id AND is_active = true),
      'critical_alerts', COALESCE((
        SELECT COUNT(*) 
        FROM service_events se
        WHERE se.event_type = 'alert' 
          AND se.severity = 'critical' 
          AND COALESCE(se.resolved, false) = false
          AND EXISTS (
            SELECT 1 FROM services s 
            WHERE s.id = se.service_id 
              AND s.organization_id = org_id
          )
      ), 0)
    ),
    'locations', json_build_object(
      'total', (SELECT COUNT(*) FROM locations WHERE organization_id = org_id AND is_active = true)
    )
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Also fix get_recent_activity_log
DROP FUNCTION IF EXISTS get_recent_activity_log(UUID, INTEGER);

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
  location_name TEXT,
  resolved BOOLEAN
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
    l.name as location_name,
    COALESCE(se.resolved, false) as resolved
  FROM service_events se
  LEFT JOIN bots b ON b.id = se.bot_id
  LEFT JOIN services s ON s.id = se.service_id
  LEFT JOIN locations l ON l.id = s.location_id
  WHERE s.organization_id = org_id
  ORDER BY se.created_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_dashboard_analytics_v2(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_recent_activity_log(UUID, INTEGER) TO authenticated;

-- Success message
DO $$
BEGIN
    RAISE NOTICE '✅ FINAL FIX APPLIED - service_events now properly joined through services table';
    RAISE NOTICE 'Now hard refresh your browser (Ctrl+Shift+R)';
END $$;

