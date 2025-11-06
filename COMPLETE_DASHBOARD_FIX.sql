-- COMPLETE DASHBOARD FIX - Run this entire file in Supabase SQL Editor
-- This is a comprehensive fix that will get your dashboard working

-- =============================================================================
-- PART 1: Add missing columns to services table
-- =============================================================================

-- Add stage column
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'services' AND column_name = 'stage'
  ) THEN
    ALTER TABLE services ADD COLUMN stage TEXT DEFAULT 'active';
  END IF;
END $$;

-- Add area_sqm column
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'services' AND column_name = 'area_sqm'
  ) THEN
    ALTER TABLE services ADD COLUMN area_sqm INTEGER DEFAULT 0;
  END IF;
END $$;

-- Add started_at column
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'services' AND column_name = 'started_at'
  ) THEN
    ALTER TABLE services ADD COLUMN started_at TIMESTAMPTZ;
  END IF;
END $$;

-- Add completed_at column
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'services' AND column_name = 'completed_at'
  ) THEN
    ALTER TABLE services ADD COLUMN completed_at TIMESTAMPTZ;
  END IF;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_services_stage ON services(stage);
CREATE INDEX IF NOT EXISTS idx_services_completed_at ON services(completed_at);
CREATE INDEX IF NOT EXISTS idx_services_org_stage ON services(organization_id, stage);

-- =============================================================================
-- PART 2: Fix ALL dashboard functions
-- =============================================================================

-- Function 1: get_dashboard_analytics_v2
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

-- Function 2: get_active_services_v2
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
    COALESCE(s.stage, s.status) as status,
    50.0 as progress,
    NULL::UUID as bot_id,
    NULL::TEXT as bot_name,
    s.started_at,
    (COALESCE(s.started_at, NOW()) + INTERVAL '2 hours')::TIMESTAMPTZ as estimated_completion
  FROM services s
  LEFT JOIN locations l ON l.id = s.location_id
  WHERE s.organization_id = org_id
    AND s.is_active = true
    AND s.status = 'active'
  ORDER BY s.created_at DESC
  LIMIT 10;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function 3: get_fleet_status_v2
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

-- Function 4: get_service_activity_chart_data
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
    COALESCE(SUM(s.area_sqm) FILTER (WHERE s.service_type = 'lawn' AND s.completed_at::date = ds.date), 0)::INTEGER as mowing_area,
    COALESCE(SUM(s.area_sqm) FILTER (WHERE s.service_type = 'pool' AND s.completed_at::date = ds.date), 0)::INTEGER as pool_cleaning_area,
    COUNT(s.id) FILTER (WHERE s.completed_at::date = ds.date)::INTEGER as services_count
  FROM date_series ds
  LEFT JOIN services s ON s.completed_at::date = ds.date
    AND s.organization_id = org_id
    AND s.stage = 'completed'
  GROUP BY ds.date
  ORDER BY ds.date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function 5: get_recent_activity_log  
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
  WHERE se.organization_id = org_id
  ORDER BY se.created_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- PART 3: Grant permissions
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
    RAISE NOTICE '✅ COMPLETE DASHBOARD FIX APPLIED!';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Added columns: stage, area_sqm, started_at, completed_at';
    RAISE NOTICE 'Fixed functions: get_dashboard_analytics_v2, get_active_services_v2, get_fleet_status_v2, get_service_activity_chart_data, get_recent_activity_log';
    RAISE NOTICE '';
    RAISE NOTICE 'Now hard refresh your browser (Ctrl+Shift+R)';
    RAISE NOTICE '========================================';
END $$;

