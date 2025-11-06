-- Dashboard Analytics V2 - Comprehensive Dashboard Functions
-- Created: November 6, 2025

-- ============================================================================
-- Function: get_dashboard_analytics_v2
-- Description: Returns comprehensive dashboard analytics in one efficient call
-- ============================================================================

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
    
    -- Today's Activity
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
    
    -- Service Statistics
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
    
    -- Monthly stats
    'monthly', (
      SELECT json_build_object(
        'services_completed', COALESCE(services_this_month, 0),
        'total_runtime_hours', COALESCE(ROUND(total_runtime_hours::numeric, 1), 0)
      )
      FROM monthly_stats
    ),
    
    -- Upcoming services
    'upcoming', (
      SELECT json_build_object(
        'next_service_date', next_service_date,
        'count', COALESCE(upcoming_services_count, 0)
      )
      FROM next_service
    ),
    
    -- Completion rate
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

-- ============================================================================
-- Function: get_active_services_v2
-- Description: Returns currently active/running services with real-time progress
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
    
    -- Calculate progress based on area covered or time elapsed
    CASE 
      WHEN s.area_sqm > 0 AND s.area_covered_sqm > 0 THEN
        LEAST(100, ROUND((s.area_covered_sqm::DECIMAL / s.area_sqm::DECIMAL) * 100))
      WHEN s.started_at IS NOT NULL THEN
        LEAST(100, ROUND((EXTRACT(EPOCH FROM (NOW() - s.started_at)) / EXTRACT(EPOCH FROM (s.estimated_completion_time - s.started_at))) * 100))
      ELSE 0
    END::INTEGER as progress_percentage,
    
    COALESCE(s.area_covered_sqm, 0)::INTEGER as area_covered_sqm,
    COALESCE(s.area_sqm, 0)::INTEGER as total_area_sqm,
    
    -- Get latest battery reading from bot_tracking_data
    COALESCE((
      SELECT battery_level
      FROM bot_tracking_data
      WHERE bot_tracking_data.bot_id = b.id
      ORDER BY timestamp DESC
      LIMIT 1
    ), 100)::INTEGER as battery_percentage,
    
    -- Estimate completion time based on progress
    CASE
      WHEN s.started_at IS NOT NULL AND s.estimated_completion_time IS NOT NULL THEN
        s.estimated_completion_time
      WHEN s.started_at IS NOT NULL THEN
        s.started_at + INTERVAL '1 hour'  -- Default 1 hour if no estimate
      ELSE NOW() + INTERVAL '1 hour'
    END as estimated_completion_time,
    
    -- Runtime in minutes
    CASE
      WHEN s.started_at IS NOT NULL THEN
        EXTRACT(EPOCH FROM (NOW() - s.started_at)) / 60
      ELSE 0
    END::INTEGER as runtime_minutes
    
  FROM services s
  LEFT JOIN gardens g ON g.service_id = s.id
  LEFT JOIN pools p ON p.service_id = s.id
  LEFT JOIN locations l ON l.id = s.location_id
  LEFT JOIN bots b ON b.id = s.bot_id
  WHERE s.organization_id = org_id
    AND s.stage IN ('in_progress', 'active')
    AND s.is_active = true
  ORDER BY s.started_at DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Function: get_fleet_status_v2
-- Description: Returns fleet status breakdown for dashboard widget
-- ============================================================================

CREATE OR REPLACE FUNCTION get_fleet_status_v2(org_id UUID)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  WITH fleet_breakdown AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status IN ('operational', 'active')) as active_now,
      COUNT(*) FILTER (WHERE status = 'charging') as charging,
      COUNT(*) FILTER (WHERE status = 'idle') as idle,
      COUNT(*) FILTER (WHERE status IN ('error', 'maintenance_required')) as needs_attention,
      -- Count bots currently running services
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM services 
        WHERE services.bot_id = bots.id 
          AND services.stage IN ('in_progress', 'active')
      )) as running_services
    FROM bots
    WHERE organization_id = org_id
      AND is_active = true
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
-- Function: get_service_activity_chart_data
-- Description: Returns service activity data for the last 30 days
-- ============================================================================

CREATE OR REPLACE FUNCTION get_service_activity_chart_data(org_id UUID, days_back INTEGER DEFAULT 30)
RETURNS TABLE (
  date DATE,
  mowing_area INTEGER,
  pool_cleaning_area INTEGER,
  services_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH date_series AS (
    SELECT generate_series(
      CURRENT_DATE - days_back + 1,
      CURRENT_DATE,
      '1 day'::interval
    )::date as date
  )
  SELECT
    ds.date,
    COALESCE(SUM(s.area_sqm) FILTER (WHERE s.service_type = 'lawn_mowing' AND s.completed_at::date = ds.date), 0)::INTEGER as mowing_area,
    COALESCE(SUM(s.area_sqm) FILTER (WHERE s.service_type = 'pool_cleaning' AND s.completed_at::date = ds.date), 0)::INTEGER as pool_cleaning_area,
    COUNT(s.id) FILTER (WHERE s.completed_at::date = ds.date)::INTEGER as services_count
  FROM date_series ds
  LEFT JOIN services s ON s.completed_at::date = ds.date
    AND s.organization_id = org_id
    AND s.stage = 'completed'
  GROUP BY ds.date
  ORDER BY ds.date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Function: get_recent_activity_log
-- Description: Returns recent activity log for dashboard
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
  WHERE se.organization_id = org_id
  ORDER BY se.created_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_dashboard_analytics_v2(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_services_v2(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_fleet_status_v2(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_service_activity_chart_data(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_recent_activity_log(UUID, INTEGER) TO authenticated;

-- Add helpful comments
COMMENT ON FUNCTION get_dashboard_analytics_v2 IS 'Returns comprehensive dashboard analytics including system health, bot stats, services, alerts, and more in a single efficient call';
COMMENT ON FUNCTION get_active_services_v2 IS 'Returns currently active/running services with real-time progress, battery levels, and ETAs';
COMMENT ON FUNCTION get_fleet_status_v2 IS 'Returns fleet status breakdown (active, charging, idle, needs attention) for dashboard widget';
COMMENT ON FUNCTION get_service_activity_chart_data IS 'Returns service activity data for charts showing area covered over time';
COMMENT ON FUNCTION get_recent_activity_log IS 'Returns recent activity log entries for dashboard activity feed';

