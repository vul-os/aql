-- Fix the dashboard analytics function - there's an ambiguous column reference
-- Run this in Supabase SQL Editor

CREATE OR REPLACE FUNCTION get_dashboard_analytics_v2(org_id UUID)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  WITH 
  -- Bot statistics
  bot_stats AS (
    SELECT 
      COUNT(*) as total_bots,
      COUNT(*) FILTER (WHERE status = 'operational') as operational_bots,
      COUNT(*) FILTER (WHERE status = 'charging') as charging_bots,
      COUNT(*) FILTER (WHERE status = 'offline') as offline_bots,
      COUNT(*) FILTER (WHERE status = 'error') as error_bots,
      COUNT(*) FILTER (WHERE status IN ('operational', 'active')) as active_now
    FROM bots
    WHERE organization_id = org_id
      AND is_active = true
  ),
  
  -- Service statistics (today)
  today_services AS (
    SELECT
      COUNT(*) FILTER (WHERE stage = 'completed' AND completed_at::date = CURRENT_DATE) as completed_today,
      COUNT(*) FILTER (WHERE stage IN ('in_progress', 'active')) as in_progress,
      COUNT(*) FILTER (WHERE next_service_date::date = CURRENT_DATE) as scheduled_today,
      COALESCE(SUM(area_sqm) FILTER (WHERE stage = 'completed' AND completed_at::date = CURRENT_DATE), 0) as area_covered_today,
      COUNT(*) as total_services
    FROM services
    WHERE organization_id = org_id
      AND is_active = true
  ),
  
  -- Service completion rate (last 30 days)
  completion_rate AS (
    SELECT
      COUNT(*) FILTER (WHERE completed_at >= NOW() - INTERVAL '30 days') as completed,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as total,
      COALESCE(
        ROUND(
          (COUNT(*) FILTER (WHERE completed_at >= NOW() - INTERVAL '30 days')::DECIMAL / 
          NULLIF(COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'), 0)) * 100,
          1
        ),
        0
      ) as completion_percentage
    FROM services
    WHERE organization_id = org_id
  ),
  
  -- Active alerts
  alert_stats AS (
    SELECT
      COUNT(*) as total_alerts,
      COUNT(*) FILTER (WHERE severity = 'critical') as critical_alerts,
      COUNT(*) FILTER (WHERE severity = 'warning') as warning_alerts,
      COUNT(*) FILTER (WHERE severity = 'info') as info_alerts
    FROM service_events
    WHERE organization_id = org_id
      AND event_type = 'alert'
      AND resolved = false
      AND created_at >= NOW() - INTERVAL '7 days'
  ),
  
  -- Service area and counts
  service_stats AS (
    SELECT
      COALESCE(SUM(area_sqm), 0) as total_area_sqm,
      COUNT(*) FILTER (WHERE service_type = 'lawn') as total_gardens,
      COUNT(*) FILTER (WHERE service_type = 'pool') as total_pools,
      COUNT(*) as total_services
    FROM services
    WHERE organization_id = org_id
      AND is_active = true
  ),
  
  -- Location count
  location_stats AS (
    SELECT COUNT(*) as total_locations
    FROM locations
    WHERE organization_id = org_id
      AND is_active = true
  ),
  
  -- Services completed this month
  monthly_stats AS (
    SELECT
      COUNT(*) FILTER (WHERE stage = 'completed' AND completed_at >= date_trunc('month', CURRENT_DATE)) as services_this_month,
      COALESCE(SUM(EXTRACT(EPOCH FROM (completed_at - started_at)) / 3600) FILTER (WHERE stage = 'completed'), 0) as total_runtime_hours
    FROM services
    WHERE organization_id = org_id
  ),
  
  -- System health calculation
  health_calc AS (
    SELECT
      CASE 
        WHEN bs.total_bots = 0 THEN 50
        ELSE LEAST(100, GREATEST(0,
          (bs.operational_bots::DECIMAL / NULLIF(bs.total_bots, 0) * 40) +
          (CASE WHEN ss.total_services > 0 THEN 30 ELSE 0 END) +
          (CASE WHEN bs.error_bots = 0 THEN 20 ELSE GREATEST(0, 20 - (bs.error_bots * 5)) END) +
          (CASE WHEN al.critical_alerts = 0 THEN 10 ELSE GREATEST(0, 10 - (al.critical_alerts * 2)) END)
        ))
      END as health_score
    FROM bot_stats bs
    CROSS JOIN service_stats ss
    CROSS JOIN alert_stats al
  )
  
  SELECT json_build_object(
    'bots', json_build_object(
      'total', COALESCE(bs.total_bots, 0),
      'operational', COALESCE(bs.operational_bots, 0),
      'charging', COALESCE(bs.charging_bots, 0),
      'offline', COALESCE(bs.offline_bots, 0),
      'errors', COALESCE(bs.error_bots, 0),
      'active_now', COALESCE(bs.active_now, 0)
    ),
    'services', json_build_object(
      'total_services', COALESCE(ss.total_services, 0),
      'total_gardens', COALESCE(ss.total_gardens, 0),
      'total_pools', COALESCE(ss.total_pools, 0),
      'total_area_sqm', COALESCE(ss.total_area_sqm, 0)
    ),
    'services_today', json_build_object(
      'completed', COALESCE(ts.completed_today, 0),
      'in_progress', COALESCE(ts.in_progress, 0),
      'scheduled', COALESCE(ts.scheduled_today, 0),
      'area_covered_sqm', COALESCE(ts.area_covered_today, 0)
    ),
    'alerts', json_build_object(
      'total', COALESCE(al.total_alerts, 0),
      'critical', COALESCE(al.critical_alerts, 0),
      'warning', COALESCE(al.warning_alerts, 0),
      'info', COALESCE(al.info_alerts, 0)
    ),
    'completion_rate', json_build_object(
      'completed', COALESCE(cr.completed, 0),
      'total', COALESCE(cr.total, 0),
      'percentage', COALESCE(cr.completion_percentage, 0)
    ),
    'system_health', json_build_object(
      'score', COALESCE(hc.health_score, 0),
      'bots_operational_pct', CASE WHEN bs.total_bots > 0 THEN ROUND((bs.operational_bots::DECIMAL / bs.total_bots * 100), 1) ELSE 0 END,
      'services_active', COALESCE(ss.total_services, 0),
      'critical_alerts', COALESCE(al.critical_alerts, 0)
    ),
    'locations', json_build_object(
      'total', COALESCE(ls.total_locations, 0)
    ),
    'monthly', json_build_object(
      'services_completed', COALESCE(ms.services_this_month, 0),
      'runtime_hours', COALESCE(ms.total_runtime_hours, 0)
    )
  ) INTO result
  FROM bot_stats bs
  CROSS JOIN today_services ts
  CROSS JOIN completion_rate cr
  CROSS JOIN alert_stats al
  CROSS JOIN service_stats ss
  CROSS JOIN location_stats ls
  CROSS JOIN monthly_stats ms
  CROSS JOIN health_calc hc;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

