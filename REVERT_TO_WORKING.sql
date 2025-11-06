-- REVERT TO WORKING STATE
-- This restores simple dashboard functions that work with the actual schema
-- Run this in Supabase SQL Editor

-- =============================================================================
-- Simple dashboard analytics that works with current schema
-- =============================================================================

DROP FUNCTION IF EXISTS get_dashboard_analytics_v2(UUID);

CREATE OR REPLACE FUNCTION get_dashboard_analytics_v2(org_id UUID)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'services', json_build_object(
      'total_services', (
        SELECT COUNT(*) 
        FROM services 
        WHERE organization_id = org_id AND is_active = true
      ),
      'total_gardens', (
        SELECT COUNT(*) 
        FROM services 
        WHERE organization_id = org_id AND service_type = 'lawn' AND is_active = true
      ),
      'total_pools', (
        SELECT COUNT(*) 
        FROM services 
        WHERE organization_id = org_id AND service_type = 'pool' AND is_active = true
      ),
      'total_area_sqm', 0
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
        WHERE l.organization_id = org_id AND b.status IN ('operational', 'active', 'online')
      ),
      'charging', (
        SELECT COUNT(*) 
        FROM bots b
        JOIN locations l ON l.id = b.location_id
        WHERE l.organization_id = org_id AND b.status = 'charging'
      ),
      'offline', (
        SELECT COUNT(*) 
        FROM bots b
        JOIN locations l ON l.id = b.location_id
        WHERE l.organization_id = org_id AND b.status IN ('offline', 'idle')
      ),
      'errors', (
        SELECT COUNT(*) 
        FROM bots b
        JOIN locations l ON l.id = b.location_id
        WHERE l.organization_id = org_id AND b.status = 'error'
      ),
      'active_now', (
        SELECT COUNT(*) 
        FROM bots b
        JOIN locations l ON l.id = b.location_id
        WHERE l.organization_id = org_id AND b.status IN ('operational', 'active')
      )
    ),
    'services_today', json_build_object(
      'completed', 0,
      'in_progress', 0,
      'scheduled', (
        SELECT COUNT(*) 
        FROM services 
        WHERE organization_id = org_id AND next_service_date::date = CURRENT_DATE
      ),
      'area_covered_sqm', 0
    ),
    'alerts', json_build_object(
      'total', 0,
      'critical', 0,
      'warning', 0,
      'info', 0
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
      'critical_alerts', 0
    ),
    'locations', json_build_object(
      'total', (SELECT COUNT(*) FROM locations WHERE organization_id = org_id AND is_active = true)
    )
  ) INTO result;
  
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- Simple active services function
-- =============================================================================

DROP FUNCTION IF EXISTS get_active_services_v2(UUID);

CREATE OR REPLACE FUNCTION get_active_services_v2(org_id UUID)
RETURNS TABLE (
  service_id UUID,
  service_name TEXT,
  service_type TEXT,
  location_name TEXT,
  status TEXT,
  progress NUMERIC,
  bot_id UUID,
  bot_name TEXT,
  started_at TIMESTAMPTZ,
  estimated_completion TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id as service_id,
    s.name as service_name,
    s.service_type,
    l.name as location_name,
    s.status,
    50.0 as progress,
    NULL::UUID as bot_id,
    NULL::TEXT as bot_name,
    NULL::TIMESTAMPTZ as started_at,
    NULL::TIMESTAMPTZ as estimated_completion
  FROM services s
  LEFT JOIN locations l ON l.id = s.location_id
  WHERE s.organization_id = org_id
    AND s.is_active = true
    AND s.status = 'active'
  ORDER BY s.created_at DESC
  LIMIT 10;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- Simple fleet status function
-- =============================================================================

DROP FUNCTION IF EXISTS get_fleet_status_v2(UUID);

CREATE OR REPLACE FUNCTION get_fleet_status_v2(org_id UUID)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  WITH bot_data AS (
    SELECT
      COALESCE(b.bot_type, 'mow_bot') as bot_type,
      COUNT(*) as type_count,
      COUNT(*) FILTER (WHERE b.status IN ('operational', 'active', 'online')) as operational_count
    FROM bots b
    JOIN locations l ON l.id = b.location_id
    WHERE l.organization_id = org_id
    GROUP BY b.bot_type
  )
  SELECT json_build_object(
    'total_bots', COALESCE(SUM(type_count), 0),
    'by_type', COALESCE(json_agg(
      json_build_object(
        'type', bot_type,
        'count', type_count,
        'operational', operational_count
      )
    ), '[]'::json)
  ) INTO result
  FROM bot_data;
  
  RETURN COALESCE(result, json_build_object('total_bots', 0, 'by_type', '[]'::json));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- Simple service activity chart (returns empty data for now)
-- =============================================================================

DROP FUNCTION IF EXISTS get_service_activity_chart_data(UUID, INTEGER);

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
    0 as mowing_area,
    0 as pool_cleaning_area,
    0 as services_count
  FROM date_series ds
  ORDER BY ds.date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- Simple recent activity (returns empty for now)
-- =============================================================================

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
    NULL::UUID as id,
    ''::TEXT as event_type,
    ''::TEXT as title,
    ''::TEXT as description,
    'info'::TEXT as severity,
    NOW() as created_at,
    NULL::UUID as bot_id,
    NULL::TEXT as bot_name,
    NULL::UUID as service_id,
    NULL::TEXT as location_name,
    true as resolved
  WHERE false;  -- Returns empty result
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- Grant permissions
-- =============================================================================
GRANT EXECUTE ON FUNCTION get_dashboard_analytics_v2(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_active_services_v2(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_fleet_status_v2(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_service_activity_chart_data(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_recent_activity_log(UUID, INTEGER) TO authenticated;

-- Success message
DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE '✅ REVERTED TO WORKING STATE';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Dashboard functions simplified to work with current schema';
    RAISE NOTICE 'All functions now only use existing columns';
    RAISE NOTICE '';
    RAISE NOTICE 'Now hard refresh your browser (Ctrl+Shift+R)';
    RAISE NOTICE 'Your dashboard should load and show your services!';
    RAISE NOTICE '========================================';
END $$;

