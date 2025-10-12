-- =====================================================
-- Add get_garden_details Function
-- Returns garden details with location, bots, and sessions
-- =====================================================

-- Function to get complete garden details
CREATE OR REPLACE FUNCTION get_garden_details(garden_uuid UUID)
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'garden', (
            SELECT row_to_json(g.*)
            FROM gardens g
            WHERE g.id = garden_uuid
        ),
        'location', (
            SELECT row_to_json(l.*)
            FROM gardens g
            JOIN locations l ON g.location_id = l.id
            WHERE g.id = garden_uuid
        ),
        'assigned_bots', (
            SELECT COALESCE(json_agg(
                json_build_object(
                    'id', b.id,
                    'name', b.name,
                    'bot_type', b.bot_type,
                    'status', b.status,
                    'identifier', b.identifier,
                    'is_primary', bga.is_primary,
                    'total_mows', bga.total_mows,
                    'total_runtime_minutes', bga.total_runtime_minutes,
                    'last_mowed_at', bga.last_mowed_at
                )
            ), '[]'::json)
            FROM bot_garden_assignments bga
            JOIN bots b ON bga.bot_id = b.id
            WHERE bga.garden_id = garden_uuid
                AND bga.is_active = true
        ),
        'recent_sessions', (
            SELECT COALESCE(json_agg(
                json_build_object(
                    'id', ms.id,
                    'bot_id', ms.bot_id,
                    'start_time', ms.start_time,
                    'end_time', ms.end_time,
                    'duration_minutes', ms.duration_minutes,
                    'area_mowed_sqm', ms.area_mowed_sqm,
                    'quality_rating', ms.quality_rating,
                    'completed_successfully', ms.completed_successfully
                )
                ORDER BY ms.start_time DESC
            ), '[]'::json)
            FROM mowing_sessions ms
            WHERE ms.garden_id = garden_uuid
            LIMIT 10
        )
    ) INTO result;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get pool details
CREATE OR REPLACE FUNCTION get_pool_details(pool_uuid UUID)
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'pool', (
            SELECT row_to_json(p.*)
            FROM pools p
            WHERE p.id = pool_uuid
        ),
        'location', (
            SELECT row_to_json(l.*)
            FROM pools p
            JOIN locations l ON p.location_id = l.id
            WHERE p.id = pool_uuid
        ),
        'assigned_bots', (
            SELECT COALESCE(json_agg(
                json_build_object(
                    'id', b.id,
                    'name', b.name,
                    'bot_type', b.bot_type,
                    'status', b.status,
                    'identifier', b.identifier,
                    'is_primary', bpa.is_primary,
                    'total_cleanings', bpa.total_cleanings,
                    'total_runtime_minutes', bpa.total_runtime_minutes,
                    'last_cleaned_at', bpa.last_cleaned_at
                )
            ), '[]'::json)
            FROM bot_pool_assignments bpa
            JOIN bots b ON bpa.bot_id = b.id
            WHERE bpa.pool_id = pool_uuid
                AND bpa.is_active = true
        ),
        'recent_sessions', (
            SELECT COALESCE(json_agg(
                json_build_object(
                    'id', pcs.id,
                    'bot_id', pcs.bot_id,
                    'start_time', pcs.start_time,
                    'end_time', pcs.end_time,
                    'duration_minutes', pcs.duration_minutes,
                    'area_cleaned_sqm', pcs.area_cleaned_sqm,
                    'quality_rating', pcs.quality_rating,
                    'completed_successfully', pcs.completed_successfully
                )
                ORDER BY pcs.start_time DESC
            ), '[]'::json)
            FROM pool_cleaning_sessions pcs
            WHERE pcs.pool_id = pool_uuid
            LIMIT 10
        )
    ) INTO result;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comments
COMMENT ON FUNCTION get_garden_details IS 'Get complete garden details including location, bots, and recent mowing sessions';
COMMENT ON FUNCTION get_pool_details IS 'Get complete pool details including location, bots, and recent cleaning sessions';

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_garden_details TO authenticated;
GRANT EXECUTE ON FUNCTION get_pool_details TO authenticated;

