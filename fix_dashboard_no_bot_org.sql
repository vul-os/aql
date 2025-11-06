-- Fix dashboard functions WITHOUT requiring organization_id on bots
-- Run this in Supabase SQL Editor

-- =============================================================================
-- 1. Fix get_dashboard_analytics_v2 (without bots.organization_id)
-- =============================================================================
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
      'total', COALESCE((SELECT COUNT(*) FROM service_events WHERE organization_id = org_id AND event_type = 'alert' AND COALESCE(resolved, false) = false), 0),
      'critical', COALESCE((SELECT COUNT(*) FROM service_events WHERE organization_id = org_id AND event_type = 'alert' AND severity = 'critical' AND COALESCE(resolved, false) = false), 0),
      'warning', COALESCE((SELECT COUNT(*) FROM service_events WHERE organization_id = org_id AND event_type = 'alert' AND severity = 'warning' AND COALESCE(resolved, false) = false), 0),
      'info', COALESCE((SELECT COUNT(*) FROM service_events WHERE organization_id = org_id AND event_type = 'alert' AND COALESCE(severity, 'info') = 'info' AND COALESCE(resolved, false) = false), 0)
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
      'critical_alerts', COALESCE((SELECT COUNT(*) FROM service_events WHERE organization_id = org_id AND event_type = 'alert' AND severity = 'critical' AND COALESCE(resolved, false) = false), 0)
    ),
    'locations', json_build_object(
      'total', (SELECT COUNT(*) FROM locations WHERE organization_id = org_id AND is_active = true)
    )
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- 2. Fix get_fleet_status_v2 (without bots.organization_id)
-- =============================================================================
DROP FUNCTION IF EXISTS get_fleet_status_v2(UUID);

CREATE OR REPLACE FUNCTION get_fleet_status_v2(org_id UUID)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'total_bots', COUNT(*),
    'by_type', json_agg(
      json_build_object(
        'type', bot_type,
        'count', type_count,
        'operational', operational_count
      )
    )
  ) INTO result
  FROM (
    SELECT
      COALESCE(b.bot_type, 'mow_bot') as bot_type,
      COUNT(*) as type_count,
      COUNT(*) FILTER (WHERE b.status IN ('operational', 'active', 'online')) as operational_count
    FROM bots b
    JOIN locations l ON l.id = b.location_id
    WHERE l.organization_id = org_id
    GROUP BY b.bot_type
  ) bot_types;
  
  RETURN COALESCE(result, json_build_object('total_bots', 0, 'by_type', '[]'::json));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- Grant permissions
-- =============================================================================
GRANT EXECUTE ON FUNCTION get_dashboard_analytics_v2(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_fleet_status_v2(UUID) TO authenticated;

-- Success message
DO $$
BEGIN
    RAISE NOTICE '✅ Dashboard functions fixed (using location join for bots)!';
END $$;

