-- =====================================================
-- Bot Korp Analytics Functions
-- SQL functions for dashboard analytics and data aggregation
-- =====================================================

-- =====================================================
-- ANALYTICS FUNCTIONS
-- =====================================================

-- Function: Get organization dashboard analytics
CREATE OR REPLACE FUNCTION get_organization_dashboard_analytics(org_id UUID)
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'operational_bots', (
            SELECT COUNT(*)
            FROM bots b
            INNER JOIN locations l ON b.location_id = l.id
            WHERE l.organization_id = org_id
            AND b.status IN ('online', 'active', 'idle', 'charging')
            AND b.is_enabled = true
        ),
        'total_bots', (
            SELECT COUNT(*)
            FROM bots b
            INNER JOIN locations l ON b.location_id = l.id
            WHERE l.organization_id = org_id
        ),
        'offline_bots', (
            SELECT COUNT(*)
            FROM bots b
            INNER JOIN locations l ON b.location_id = l.id
            WHERE l.organization_id = org_id
            AND b.status = 'offline'
        ),
        'error_bots', (
            SELECT COUNT(*)
            FROM bots b
            INNER JOIN locations l ON b.location_id = l.id
            WHERE l.organization_id = org_id
            AND b.status = 'error'
        ),
        'total_gardens', (
            SELECT COUNT(*)
            FROM gardens g
            INNER JOIN locations l ON g.location_id = l.id
            WHERE l.organization_id = org_id
            AND g.is_active = true
        ),
        'total_pools', (
            SELECT COUNT(*)
            FROM pools p
            INNER JOIN locations l ON p.location_id = l.id
            WHERE l.organization_id = org_id
            AND p.is_active = true
        ),
        'total_locations', (
            SELECT COUNT(*)
            FROM locations
            WHERE organization_id = org_id
            AND is_active = true
        ),
        'gardens_needing_maintenance', (
            SELECT COUNT(*)
            FROM gardens g
            INNER JOIN locations l ON g.location_id = l.id
            WHERE l.organization_id = org_id
            AND g.requires_maintenance = true
        ),
        'pools_needing_maintenance', (
            SELECT COUNT(*)
            FROM pools p
            INNER JOIN locations l ON p.location_id = l.id
            WHERE l.organization_id = org_id
            AND p.requires_maintenance = true
        ),
        'next_service_date', (
            SELECT MIN(next_service_date)
            FROM bots b
            INNER JOIN locations l ON b.location_id = l.id
            WHERE l.organization_id = org_id
            AND next_service_date IS NOT NULL
            AND next_service_date > CURRENT_DATE
        ),
        'upcoming_services_count', (
            SELECT COUNT(*)
            FROM bots b
            INNER JOIN locations l ON b.location_id = l.id
            WHERE l.organization_id = org_id
            AND next_service_date IS NOT NULL
            AND next_service_date <= CURRENT_DATE + INTERVAL '30 days'
        ),
        'unread_alerts_count', (
            SELECT COUNT(*)
            FROM bot_alerts ba
            INNER JOIN locations l ON ba.location_id = l.id
            WHERE l.organization_id = org_id
            AND ba.is_read = false
        ),
        'critical_alerts_count', (
            SELECT COUNT(*)
            FROM bot_alerts ba
            INNER JOIN locations l ON ba.location_id = l.id
            WHERE l.organization_id = org_id
            AND ba.severity = 'critical'
            AND ba.is_resolved = false
        ),
        'total_area_managed_sqm', (
            SELECT COALESCE(SUM(area_sqm), 0)
            FROM gardens g
            INNER JOIN locations l ON g.location_id = l.id
            WHERE l.organization_id = org_id
            AND g.is_active = true
        ),
        'total_runtime_hours', (
            SELECT COALESCE(SUM(total_runtime_hours), 0)
            FROM bots b
            INNER JOIN locations l ON b.location_id = l.id
            WHERE l.organization_id = org_id
        )
    ) INTO result;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get bot status distribution for charts
CREATE OR REPLACE FUNCTION get_bot_status_distribution(org_id UUID)
RETURNS TABLE(status TEXT, count BIGINT) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        b.status,
        COUNT(*) as count
    FROM bots b
    INNER JOIN locations l ON b.location_id = l.id
    WHERE l.organization_id = org_id
    GROUP BY b.status
    ORDER BY count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get bot type distribution for charts
CREATE OR REPLACE FUNCTION get_bot_type_distribution(org_id UUID)
RETURNS TABLE(bot_type TEXT, count BIGINT) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        b.bot_type,
        COUNT(*) as count
    FROM bots b
    INNER JOIN locations l ON b.location_id = l.id
    WHERE l.organization_id = org_id
    GROUP BY b.bot_type
    ORDER BY count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get mowing activity over time (last 30 days)
CREATE OR REPLACE FUNCTION get_mowing_activity_last_30_days(org_id UUID)
RETURNS TABLE(date DATE, sessions_count BIGINT, area_mowed NUMERIC) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ms.start_time::DATE as date,
        COUNT(*) as sessions_count,
        COALESCE(SUM(ms.area_mowed_sqm), 0) as area_mowed
    FROM mowing_sessions ms
    INNER JOIN bots b ON ms.bot_id = b.id
    INNER JOIN locations l ON b.location_id = l.id
    WHERE l.organization_id = org_id
    AND ms.start_time >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY ms.start_time::DATE
    ORDER BY date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get pool cleaning activity over time (last 30 days)
CREATE OR REPLACE FUNCTION get_pool_cleaning_activity_last_30_days(org_id UUID)
RETURNS TABLE(date DATE, sessions_count BIGINT, area_cleaned NUMERIC) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pcs.start_time::DATE as date,
        COUNT(*) as sessions_count,
        COALESCE(SUM(pcs.area_cleaned_sqm), 0) as area_cleaned
    FROM pool_cleaning_sessions pcs
    INNER JOIN bots b ON pcs.bot_id = b.id
    INNER JOIN locations l ON b.location_id = l.id
    WHERE l.organization_id = org_id
    AND pcs.start_time >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY pcs.start_time::DATE
    ORDER BY date DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get upcoming services
CREATE OR REPLACE FUNCTION get_upcoming_services(org_id UUID, days_ahead INTEGER DEFAULT 30)
RETURNS TABLE(
    bot_id UUID,
    bot_name TEXT,
    bot_type TEXT,
    location_name TEXT,
    next_service_date TIMESTAMPTZ,
    days_until_service INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        b.id as bot_id,
        b.name as bot_name,
        b.bot_type,
        l.name as location_name,
        b.next_service_date,
        (b.next_service_date::DATE - CURRENT_DATE)::INTEGER as days_until_service
    FROM bots b
    INNER JOIN locations l ON b.location_id = l.id
    WHERE l.organization_id = org_id
    AND b.next_service_date IS NOT NULL
    AND b.next_service_date <= CURRENT_DATE + (days_ahead || ' days')::INTERVAL
    ORDER BY b.next_service_date ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get recent alerts
CREATE OR REPLACE FUNCTION get_recent_alerts(org_id UUID, limit_count INTEGER DEFAULT 10)
RETURNS TABLE(
    alert_id UUID,
    bot_id UUID,
    bot_name TEXT,
    location_name TEXT,
    alert_type TEXT,
    severity TEXT,
    title TEXT,
    message TEXT,
    is_read BOOLEAN,
    is_resolved BOOLEAN,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ba.id as alert_id,
        ba.bot_id,
        b.name as bot_name,
        l.name as location_name,
        ba.alert_type,
        ba.severity,
        ba.title,
        ba.message,
        ba.is_read,
        ba.is_resolved,
        ba.created_at
    FROM bot_alerts ba
    INNER JOIN bots b ON ba.bot_id = b.id
    INNER JOIN locations l ON ba.location_id = l.id
    WHERE l.organization_id = org_id
    ORDER BY ba.created_at DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get garden details with assignment info
CREATE OR REPLACE FUNCTION get_garden_details(garden_uuid UUID)
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'garden', row_to_json(g.*),
        'location', row_to_json(l.*),
        'assigned_bots', (
            SELECT json_agg(json_build_object(
                'bot', row_to_json(b.*),
                'assignment', row_to_json(bga.*)
            ))
            FROM bot_garden_assignments bga
            INNER JOIN bots b ON bga.bot_id = b.id
            WHERE bga.garden_id = garden_uuid
            AND bga.is_active = true
        ),
        'recent_sessions', (
            SELECT json_agg(row_to_json(ms.*))
            FROM mowing_sessions ms
            WHERE ms.garden_id = garden_uuid
            ORDER BY ms.start_time DESC
            LIMIT 10
        )
    ) INTO result
    FROM gardens g
    INNER JOIN locations l ON g.location_id = l.id
    WHERE g.id = garden_uuid;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get user's organizations
CREATE OR REPLACE FUNCTION get_user_organizations(user_uuid UUID)
RETURNS TABLE(
    organization_id UUID,
    organization_name TEXT,
    organization_slug TEXT,
    organization_logo_url TEXT,
    member_role TEXT,
    is_owner BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        o.id as organization_id,
        o.name as organization_name,
        o.slug as organization_slug,
        o.logo_url as organization_logo_url,
        om.role as member_role,
        (o.owner_id = user_uuid) as is_owner
    FROM organizations o
    INNER JOIN organization_members om ON o.id = om.organization_id
    WHERE om.user_id = user_uuid
    AND om.status = 'active'
    ORDER BY o.name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Check coverage area
CREATE OR REPLACE FUNCTION check_coverage_area(
    search_city TEXT DEFAULT NULL,
    search_province TEXT DEFAULT NULL,
    search_postal_code TEXT DEFAULT NULL
)
RETURNS TABLE(
    area_id UUID,
    area_name TEXT,
    city TEXT,
    province TEXT,
    is_active BOOLEAN,
    service_types TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ca.id as area_id,
        ca.area_name,
        ca.city,
        ca.province,
        ca.is_active,
        ca.service_types
    FROM coverage_areas ca
    WHERE ca.is_active = true
    AND (
        (search_city IS NOT NULL AND ca.city ILIKE '%' || search_city || '%')
        OR (search_province IS NOT NULL AND ca.province ILIKE '%' || search_province || '%')
        OR (search_postal_code IS NOT NULL AND search_postal_code = ANY(ca.postal_codes))
    )
    ORDER BY ca.priority DESC, ca.area_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- GRANT PERMISSIONS
-- =====================================================

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION get_organization_dashboard_analytics(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_bot_status_distribution(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_bot_type_distribution(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_mowing_activity_last_30_days(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_pool_cleaning_activity_last_30_days(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_upcoming_services(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_recent_alerts(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_garden_details(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_organizations(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION check_coverage_area(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION check_coverage_area(TEXT, TEXT, TEXT) TO anon;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON FUNCTION get_organization_dashboard_analytics(UUID) IS 'Get comprehensive dashboard analytics for an organization';
COMMENT ON FUNCTION get_bot_status_distribution(UUID) IS 'Get bot status counts for pie/bar charts';
COMMENT ON FUNCTION get_bot_type_distribution(UUID) IS 'Get bot type counts for visualization';
COMMENT ON FUNCTION get_mowing_activity_last_30_days(UUID) IS 'Get mowing sessions and area mowed over last 30 days';
COMMENT ON FUNCTION get_pool_cleaning_activity_last_30_days(UUID) IS 'Get pool cleaning sessions over last 30 days';
COMMENT ON FUNCTION get_upcoming_services(UUID, INTEGER) IS 'Get bots with upcoming service dates';
COMMENT ON FUNCTION get_recent_alerts(UUID, INTEGER) IS 'Get most recent alerts for an organization';
COMMENT ON FUNCTION get_garden_details(UUID) IS 'Get complete garden details including bots and sessions';
COMMENT ON FUNCTION get_user_organizations(UUID) IS 'Get all organizations a user belongs to';
COMMENT ON FUNCTION check_coverage_area(TEXT, TEXT, TEXT) IS 'Check if service is available in a given area';

