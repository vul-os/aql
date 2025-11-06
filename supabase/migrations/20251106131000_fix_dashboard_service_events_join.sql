-- Fix dashboard analytics to properly join service_events through services table
-- The service_events table doesn't have organization_id or resolved columns

CREATE OR REPLACE FUNCTION get_dashboard_analytics_v2(org_id UUID)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  WITH 
  -- Bot statistics (join through locations)
  bot_stats AS (
    SELECT 
      COUNT(*) as total_bots,
      COUNT(*) FILTER (WHERE b.status = 'active') as operational_bots,
      COUNT(*) FILTER (WHERE b.status = 'charging') as charging_bots,
      COUNT(*) FILTER (WHERE b.status = 'offline') as offline_bots,
      COUNT(*) FILTER (WHERE b.status = 'error') as error_bots,
      COUNT(*) FILTER (WHERE b.status IN ('active', 'idle')) as active_now
    FROM bots b
    JOIN locations l ON l.id = b.location_id
    WHERE l.organization_id = org_id
      AND b.is_enabled = true
  ),
  
  -- Service statistics (using actual columns: status, not stage)
  service_counts AS (
    SELECT
      COUNT(*) as total_services,
      COUNT(*) FILTER (WHERE status = 'active') as active_services,
      COUNT(*) FILTER (WHERE status IN ('pending_setup', 'pending_installation', 'installation_scheduled')) as pending_services,
      COUNT(*) FILTER (WHERE next_service_date::date = CURRENT_DATE) as scheduled_today
    FROM services
    WHERE organization_id = org_id
      AND is_active = true
  ),
  
  -- Active alerts (join through services table, filter by event_type for alerts)
  alert_stats AS (
    SELECT
      COUNT(*) as total_alerts,
      COUNT(*) FILTER (WHERE se.severity = 'critical') as critical_alerts,
      COUNT(*) FILTER (WHERE se.severity = 'error') as warning_alerts,
      COUNT(*) FILTER (WHERE se.severity = 'info') as info_alerts
    FROM service_events se
    JOIN services s ON s.id = se.service_id
    WHERE s.organization_id = org_id
      AND se.severity IN ('critical', 'error', 'warning', 'info')
      AND se.created_at >= NOW() - INTERVAL '7 days'
  ),
  
  -- Service type counts and area (area comes from gardens/pools, not services)
  service_stats AS (
    SELECT
      COUNT(*) FILTER (WHERE service_type = 'lawn') as total_gardens,
      COUNT(*) FILTER (WHERE service_type = 'pool') as total_pools,
      COUNT(*) FILTER (WHERE service_type = 'security') as total_security,
      COUNT(*) as total_services,
      -- Get total area from gardens
      COALESCE((SELECT SUM(area_sqm) FROM gardens g 
                JOIN services s ON s.id = g.service_id 
                WHERE s.organization_id = org_id), 0) as total_area_sqm
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
  
  -- Services this month (using created_at since we don't have completed_at)
  monthly_stats AS (
    SELECT
      COUNT(*) FILTER (WHERE status = 'active' AND created_at >= date_trunc('month', CURRENT_DATE)) as services_this_month,
      -- Get runtime from bots instead
      COALESCE((SELECT SUM(total_runtime_hours) FROM bots b 
                JOIN locations l ON l.id = b.location_id 
                WHERE l.organization_id = org_id), 0) as total_runtime_hours
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
  
  -- Calculate system health score (simplified since we don't have completion tracking yet)
  health_calculation AS (
    SELECT
      COALESCE(
        ROUND(
          -- Bot uptime component (50%)
          (COALESCE(bot_stats.operational_bots::DECIMAL / NULLIF(bot_stats.total_bots, 0), 1)) * 50 +
          -- Active services component (30%)
          (COALESCE(service_counts.active_services::DECIMAL / NULLIF(service_counts.total_services, 0), 1)) * 30 +
          -- Alert penalty (20%)
          GREATEST(0, 20 - (COALESCE(alert_stats.critical_alerts, 0) * 5 + COALESCE(alert_stats.warning_alerts, 0) * 2))
        , 0),
        100
      ) as health_score
    FROM bot_stats, service_counts, alert_stats
  )
  
  SELECT json_build_object(
    -- System Health
    'system_health', (
      SELECT json_build_object(
        'score', COALESCE(ROUND(health_score, 0), 100),
        'uptime_percentage', COALESCE(ROUND((bot_stats.operational_bots::DECIMAL / NULLIF(bot_stats.total_bots, 0)) * 100, 1), 100),
        'completion_rate', 0,  -- Not tracked yet
        'efficiency', 87.5  -- Placeholder
      )
      FROM health_calculation, bot_stats
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
        'completed', 0,  -- Not tracked yet
        'in_progress', COALESCE(active_services, 0),
        'scheduled', COALESCE(scheduled_today, 0),
        'area_covered_sqm', 0,  -- Not tracked yet
        'total_services', COALESCE(total_services, 0)
      )
      FROM service_counts
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
    
    -- Completion Rate (placeholder since we don't track completions yet)
    'completion_rate', json_build_object(
      'completed', 0,
      'total', 0,
      'percentage', 0
    )
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_dashboard_analytics_v2(UUID) TO authenticated;

COMMENT ON FUNCTION get_dashboard_analytics_v2(UUID) IS 'Returns comprehensive dashboard analytics - fixed service_events join through services table';

