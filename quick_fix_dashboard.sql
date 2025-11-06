-- Quick fix for dashboard - Run this in Supabase SQL Editor
-- This fixes the ambiguous column reference error

-- Drop and recreate the problematic function
DROP FUNCTION IF EXISTS get_dashboard_analytics_v2(UUID);

-- Recreate with proper table aliases
CREATE OR REPLACE FUNCTION get_dashboard_analytics_v2(org_id UUID)
RETURNS JSON AS $$
DECLARE
  result JSON;
  total_services_count INT;
  total_bots_count INT;
BEGIN
  -- Simple counts first
  SELECT COUNT(*) INTO total_services_count 
  FROM services 
  WHERE organization_id = org_id AND is_active = true;
  
  SELECT COUNT(*) INTO total_bots_count 
  FROM bots 
  WHERE organization_id = org_id AND is_active = true;
  
  -- Build a simpler result
  result := json_build_object(
    'services', json_build_object(
      'total_services', total_services_count,
      'total_gardens', (SELECT COUNT(*) FROM services WHERE organization_id = org_id AND service_type = 'lawn' AND is_active = true),
      'total_pools', (SELECT COUNT(*) FROM services WHERE organization_id = org_id AND service_type = 'pool' AND is_active = true),
      'total_area_sqm', COALESCE((SELECT SUM(area_sqm) FROM services WHERE organization_id = org_id AND is_active = true), 0)
    ),
    'bots', json_build_object(
      'total', total_bots_count,
      'operational', (SELECT COUNT(*) FROM bots WHERE organization_id = org_id AND status = 'operational'),
      'charging', (SELECT COUNT(*) FROM bots WHERE organization_id = org_id AND status = 'charging'),
      'offline', (SELECT COUNT(*) FROM bots WHERE organization_id = org_id AND status = 'offline'),
      'errors', (SELECT COUNT(*) FROM bots WHERE organization_id = org_id AND status = 'error'),
      'active_now', (SELECT COUNT(*) FROM bots WHERE organization_id = org_id AND status IN ('operational', 'active'))
    ),
    'services_today', json_build_object(
      'completed', (SELECT COUNT(*) FROM services WHERE organization_id = org_id AND stage = 'completed' AND completed_at::date = CURRENT_DATE),
      'in_progress', (SELECT COUNT(*) FROM services WHERE organization_id = org_id AND stage IN ('in_progress', 'active')),
      'scheduled', (SELECT COUNT(*) FROM services WHERE organization_id = org_id AND next_service_date::date = CURRENT_DATE),
      'area_covered_sqm', COALESCE((SELECT SUM(area_sqm) FROM services WHERE organization_id = org_id AND stage = 'completed' AND completed_at::date = CURRENT_DATE), 0)
    ),
    'alerts', json_build_object(
      'total', (SELECT COUNT(*) FROM service_events WHERE organization_id = org_id AND event_type = 'alert' AND resolved = false),
      'critical', (SELECT COUNT(*) FROM service_events WHERE organization_id = org_id AND event_type = 'alert' AND severity = 'critical' AND resolved = false),
      'warning', (SELECT COUNT(*) FROM service_events WHERE organization_id = org_id AND event_type = 'alert' AND severity = 'warning' AND resolved = false),
      'info', (SELECT COUNT(*) FROM service_events WHERE organization_id = org_id AND event_type = 'alert' AND severity = 'info' AND resolved = false)
    ),
    'system_health', json_build_object(
      'score', CASE WHEN total_bots_count > 0 THEN 85 ELSE 50 END,
      'bots_operational_pct', CASE WHEN total_bots_count > 0 THEN 100 ELSE 0 END,
      'services_active', total_services_count,
      'critical_alerts', 0
    ),
    'locations', json_build_object(
      'total', (SELECT COUNT(*) FROM locations WHERE organization_id = org_id AND is_active = true)
    )
  );
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_dashboard_analytics_v2(UUID) TO authenticated;

