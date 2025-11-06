-- Fix dashboard analytics service type mismatch
-- The services table uses 'lawn', 'pool' but the function was checking for 'lawn_mowing', 'pool_cleaning'

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
  
  -- Service area and counts (FIXED: using 'lawn' and 'pool' instead of 'lawn_mowing' and 'pool_cleaning')
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
  
  -- Next service date
  next_service AS (
    SELECT
      MIN(next_service_date) as next_service_date,
      COUNT(*) FILTER (WHERE next_service_date >= CURRENT_DATE) as upcoming_services_count
    FROM services
    WHERE organization_id = org_id
      AND is_active = true
      AND next_service_date IS NOT NULL
  ),
  
  -- Calculate system health score
  health_calculation AS (
    SELECT
      COALESCE(
        ROUND(
          -- Uptime component (40%)
          (COALESCE(bot_stats.operational_bots::DECIMAL / NULLIF(bot_stats.total_bots, 0), 0)) * 40 +
          -- Completion rate component (40%)
          (completion_rate.completion_percentage * 0.4) +
          -- Alert penalty (20%)
          GREATEST(0, 20 - (COALESCE(alert_stats.critical_alerts, 0) * 5 + COALESCE(alert_stats.warning_alerts, 0) * 2))
        , 0),
        0
      ) as health_score
    FROM bot_stats, completion_rate, alert_stats
  )
  
  SELECT json_build_object(
    -- System Health
    'system_health', (
      SELECT json_build_object(
        'score', COALESCE(ROUND(health_score, 0), 0),
        'uptime_percentage', COALESCE(ROUND((bot_stats.operational_bots::DECIMAL / NULLIF(bot_stats.total_bots, 0)) * 100, 1), 0),
        'completion_rate', completion_rate.completion_percentage,
        'efficiency', 87.5  -- This would be calculated from actual performance data in production
      )
      FROM health_calculation, bot_stats, completion_rate
    ),
    
    -- Bots
    'bots', (
      SELECT json_build_object(
        'total', COALESCE(total_bots, 0),
        'operational', COALESCE(operational_bots, 0),
        'charging', COALESCE(charging_bots, 0),
        'offline', COALESCE(offline_bots, 0),
        'errors', COALESCE(error_bots, 0),
        'active_now', COALESCE(active_now, 0),
        'operational_percentage', COALESCE(ROUND((operational_bots::DECIMAL / NULLIF(total_bots, 0)) * 100, 1), 0)
      )
      FROM bot_stats
    ),
    
    -- Services Today
    'services_today', (
      SELECT json_build_object(
        'completed', COALESCE(completed_today, 0),
        'in_progress', COALESCE(in_progress, 0),
        'scheduled', COALESCE(scheduled_today, 0),
        'area_covered_sqm', COALESCE(area_covered_today, 0),
        'total_services', COALESCE(total_services, 0)
      )
      FROM today_services
    ),
    
    -- Alerts
    'alerts', (
      SELECT json_build_object(
        'total', COALESCE(total_alerts, 0),
        'critical', COALESCE(critical_alerts, 0),
        'warning', COALESCE(warning_alerts, 0),
        'info', COALESCE(info_alerts, 0)
      )
      FROM alert_stats
    ),
    
    -- Services
    'services', (
      SELECT json_build_object(
        'total_area_sqm', COALESCE(total_area_sqm, 0),
        'total_gardens', COALESCE(total_gardens, 0),
        'total_pools', COALESCE(total_pools, 0),
        'total_services', COALESCE(total_services, 0)
      )
      FROM service_stats
    ),
    
    -- Locations
    'locations', (
      SELECT json_build_object(
        'total', COALESCE(total_locations, 0)
      )
      FROM location_stats
    ),
    
    -- Monthly Stats
    'monthly', (
      SELECT json_build_object(
        'services_completed', COALESCE(services_this_month, 0),
        'total_runtime_hours', COALESCE(ROUND(total_runtime_hours::NUMERIC, 1), 0)
      )
      FROM monthly_stats
    ),
    
    -- Upcoming
    'upcoming', (
      SELECT json_build_object(
        'next_service_date', next_service_date,
        'count', COALESCE(upcoming_services_count, 0)
      )
      FROM next_service
    ),
    
    -- Completion Rate
    'completion_rate', (
      SELECT json_build_object(
        'completed', COALESCE(completed, 0),
        'total', COALESCE(total, 0),
        'percentage', COALESCE(completion_percentage, 0)
      )
      FROM completion_rate
    )
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_dashboard_analytics_v2(UUID) TO authenticated;

COMMENT ON FUNCTION get_dashboard_analytics_v2(UUID) IS 'Returns comprehensive dashboard analytics for an organization (fixed service types)';

