-- =====================================================
-- SERVICE CALENDAR SYSTEM
-- Enhanced service tracking, completion, and monthly calendar views
-- =====================================================

-- =====================================================
-- 1. ADD COMPLETION TRACKING TO SERVICE_APPOINTMENTS
-- =====================================================

-- Add additional completion tracking fields
ALTER TABLE service_appointments
    ADD COLUMN IF NOT EXISTS work_started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS work_ended_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS actual_duration_minutes INTEGER,
    ADD COLUMN IF NOT EXISTS service_quality_rating INTEGER CHECK (service_quality_rating >= 1 AND service_quality_rating <= 5),
    ADD COLUMN IF NOT EXISTS customer_feedback TEXT,
    ADD COLUMN IF NOT EXISTS completion_photos TEXT[] DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN IF NOT EXISTS issues_encountered TEXT[],
    ADD COLUMN IF NOT EXISTS parts_used TEXT[],
    ADD COLUMN IF NOT EXISTS next_service_recommended_date DATE;

-- Create completion tracking index
CREATE INDEX IF NOT EXISTS idx_service_appointments_work_times ON service_appointments(work_started_at, work_ended_at);
CREATE INDEX IF NOT EXISTS idx_service_appointments_completed_date ON service_appointments(completed_at) WHERE completed_at IS NOT NULL;

COMMENT ON COLUMN service_appointments.work_started_at IS 'When the technician actually started working on site';
COMMENT ON COLUMN service_appointments.work_ended_at IS 'When the technician actually finished working on site';
COMMENT ON COLUMN service_appointments.actual_duration_minutes IS 'Actual duration of work performed';

-- =====================================================
-- 2. FUNCTION: Get Monthly Service Statistics
-- =====================================================

CREATE OR REPLACE FUNCTION get_monthly_service_statistics(
    p_year INTEGER,
    p_month INTEGER,
    p_organization_id UUID DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT json_build_object(
        'year', p_year,
        'month', p_month,
        'organization_id', p_organization_id,
        'total_appointments', COUNT(*),
        'scheduled', COUNT(*) FILTER (WHERE status = 'scheduled'),
        'confirmed', COUNT(*) FILTER (WHERE status = 'confirmed'),
        'in_progress', COUNT(*) FILTER (WHERE status = 'in_progress'),
        'completed', COUNT(*) FILTER (WHERE status = 'completed'),
        'cancelled', COUNT(*) FILTER (WHERE status = 'cancelled'),
        'no_show', COUNT(*) FILTER (WHERE status = 'no_show'),
        'unique_locations', COUNT(DISTINCT location_id),
        'unique_services', COUNT(DISTINCT service_id),
        'total_duration_hours', ROUND(SUM(service_duration_minutes)::NUMERIC / 60, 2),
        'avg_duration_minutes', ROUND(AVG(service_duration_minutes)::NUMERIC, 2)
    ) INTO v_result
    FROM service_appointments
    WHERE EXTRACT(YEAR FROM appointment_date) = p_year
        AND EXTRACT(MONTH FROM appointment_date) = p_month
        AND (p_organization_id IS NULL OR organization_id = p_organization_id);
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 3. FUNCTION: Get Monthly Service Locations (for map view)
-- =====================================================

CREATE OR REPLACE FUNCTION get_monthly_service_locations(
    p_year INTEGER,
    p_month INTEGER,
    p_organization_id UUID DEFAULT NULL
)
RETURNS TABLE(
    location_id UUID,
    location_name TEXT,
    address TEXT,
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    city TEXT,
    province TEXT,
    appointment_count INTEGER,
    completed_count INTEGER,
    scheduled_count INTEGER,
    next_appointment_date DATE,
    service_names TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        l.id,
        l.name,
        l.address,
        l.latitude,
        l.longitude,
        l.city,
        l.province,
        COUNT(sa.id)::INTEGER as appointment_count,
        COUNT(*) FILTER (WHERE sa.status = 'completed')::INTEGER as completed_count,
        COUNT(*) FILTER (WHERE sa.status IN ('scheduled', 'confirmed'))::INTEGER as scheduled_count,
        MIN(sa.appointment_date) FILTER (WHERE sa.status IN ('scheduled', 'confirmed') AND sa.appointment_date >= CURRENT_DATE) as next_appointment_date,
        ARRAY_AGG(DISTINCT s.name) as service_names
    FROM locations l
    INNER JOIN service_appointments sa ON sa.location_id = l.id
    INNER JOIN services s ON s.id = sa.service_id
    WHERE EXTRACT(YEAR FROM sa.appointment_date) = p_year
        AND EXTRACT(MONTH FROM sa.appointment_date) = p_month
        AND (p_organization_id IS NULL OR l.organization_id = p_organization_id)
    GROUP BY l.id, l.name, l.address, l.latitude, l.longitude, l.city, l.province
    ORDER BY appointment_count DESC, l.name;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 4. FUNCTION: Get Calendar View for Month
-- =====================================================

CREATE OR REPLACE FUNCTION get_service_calendar_for_month(
    p_year INTEGER,
    p_month INTEGER,
    p_organization_id UUID DEFAULT NULL
)
RETURNS TABLE(
    appointment_date DATE,
    day_name TEXT,
    appointments JSON
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        sa.appointment_date,
        get_day_name(EXTRACT(DOW FROM sa.appointment_date)::INTEGER) as day_name,
        json_agg(
            json_build_object(
                'id', sa.id,
                'service_id', sa.service_id,
                'service_name', s.name,
                'service_type', s.service_type,
                'location_id', sa.location_id,
                'location_name', l.name,
                'location_address', l.address,
                'start_time', sa.start_time::TEXT,
                'end_time', sa.end_time::TEXT,
                'status', sa.status,
                'assigned_bot_id', sa.assigned_bot_id,
                'assigned_technician_id', sa.assigned_technician_id,
                'completed_at', sa.completed_at,
                'service_notes', sa.service_notes
            ) ORDER BY sa.start_time
        ) as appointments
    FROM service_appointments sa
    INNER JOIN services s ON s.id = sa.service_id
    INNER JOIN locations l ON l.id = sa.location_id
    WHERE EXTRACT(YEAR FROM sa.appointment_date) = p_year
        AND EXTRACT(MONTH FROM sa.appointment_date) = p_month
        AND (p_organization_id IS NULL OR sa.organization_id = p_organization_id)
    GROUP BY sa.appointment_date
    ORDER BY sa.appointment_date;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 5. FUNCTION: Complete Service Appointment
-- =====================================================

CREATE OR REPLACE FUNCTION complete_service_appointment(
    p_appointment_id UUID,
    p_completed_by UUID,
    p_service_duration_minutes INTEGER DEFAULT NULL,
    p_service_notes TEXT DEFAULT NULL,
    p_service_quality_rating INTEGER DEFAULT NULL,
    p_issues_encountered TEXT[] DEFAULT NULL,
    p_parts_used TEXT[] DEFAULT NULL,
    p_completion_photos TEXT[] DEFAULT NULL,
    p_next_service_recommended_date DATE DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_appointment RECORD;
    v_service_id UUID;
    v_work_duration INTEGER;
BEGIN
    -- Get appointment details
    SELECT * INTO v_appointment 
    FROM service_appointments 
    WHERE id = p_appointment_id;
    
    IF v_appointment IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Appointment not found');
    END IF;
    
    IF v_appointment.status = 'completed' THEN
        RETURN json_build_object('success', false, 'error', 'Appointment already completed');
    END IF;
    
    -- Calculate actual work duration if work times are set
    IF v_appointment.work_started_at IS NOT NULL AND v_appointment.work_ended_at IS NOT NULL THEN
        v_work_duration := EXTRACT(EPOCH FROM (v_appointment.work_ended_at - v_appointment.work_started_at)) / 60;
    ELSE
        v_work_duration := p_service_duration_minutes;
    END IF;
    
    -- Update appointment to completed
    UPDATE service_appointments
    SET 
        status = 'completed',
        completed_at = NOW(),
        completed_by = p_completed_by,
        service_duration_minutes = COALESCE(v_work_duration, service_duration_minutes),
        actual_duration_minutes = v_work_duration,
        service_notes = COALESCE(p_service_notes, service_notes),
        service_quality_rating = p_service_quality_rating,
        issues_encountered = p_issues_encountered,
        parts_used = p_parts_used,
        completion_photos = COALESCE(p_completion_photos, completion_photos),
        next_service_recommended_date = p_next_service_recommended_date,
        updated_at = NOW()
    WHERE id = p_appointment_id
    RETURNING service_id INTO v_service_id;
    
    -- Update service's last_service_date (if exists in services table)
    UPDATE services 
    SET updated_at = NOW()
    WHERE id = v_service_id;
    
    -- Create service record entry
    INSERT INTO service_records (
        bot_id,
        location_id,
        service_type,
        title,
        description,
        performed_by_name,
        technician_id,
        scheduled_date,
        service_start,
        service_end,
        duration_minutes,
        status,
        actions_taken,
        issues_found,
        photos,
        notes
    )
    SELECT
        sa.assigned_bot_id,
        sa.location_id,
        'routine_maintenance',
        'Scheduled Service - ' || s.name,
        sa.service_notes,
        COALESCE(p.full_name, p.first_name, SPLIT_PART(p.email, '@', 1)),
        sa.assigned_technician_id,
        sa.appointment_date,
        sa.appointment_date + sa.start_time,
        sa.appointment_date + sa.end_time,
        sa.service_duration_minutes,
        'completed',
        p_parts_used,
        p_issues_encountered,
        p_completion_photos,
        sa.service_notes
    FROM service_appointments sa
    LEFT JOIN services s ON s.id = sa.service_id
    LEFT JOIN profiles p ON p.id = sa.assigned_technician_id
    WHERE sa.id = p_appointment_id;
    
    RETURN json_build_object(
        'success', true,
        'appointment_id', p_appointment_id,
        'message', 'Service appointment completed successfully'
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', SQLERRM
        );
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 6. FUNCTION: Start Service Work
-- =====================================================

CREATE OR REPLACE FUNCTION start_service_work(
    p_appointment_id UUID,
    p_technician_id UUID DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_appointment RECORD;
BEGIN
    -- Get appointment details
    SELECT * INTO v_appointment 
    FROM service_appointments 
    WHERE id = p_appointment_id;
    
    IF v_appointment IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Appointment not found');
    END IF;
    
    IF v_appointment.status IN ('completed', 'cancelled') THEN
        RETURN json_build_object('success', false, 'error', 'Cannot start work on ' || v_appointment.status || ' appointment');
    END IF;
    
    -- Update appointment to in_progress
    UPDATE service_appointments
    SET 
        status = 'in_progress',
        work_started_at = NOW(),
        assigned_technician_id = COALESCE(p_technician_id, assigned_technician_id),
        updated_at = NOW()
    WHERE id = p_appointment_id;
    
    RETURN json_build_object(
        'success', true,
        'appointment_id', p_appointment_id,
        'work_started_at', NOW(),
        'message', 'Service work started'
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', SQLERRM
        );
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 7. FUNCTION: End Service Work
-- =====================================================

CREATE OR REPLACE FUNCTION end_service_work(
    p_appointment_id UUID
)
RETURNS JSON AS $$
DECLARE
    v_appointment RECORD;
    v_duration INTEGER;
BEGIN
    -- Get appointment details
    SELECT * INTO v_appointment 
    FROM service_appointments 
    WHERE id = p_appointment_id;
    
    IF v_appointment IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Appointment not found');
    END IF;
    
    IF v_appointment.status != 'in_progress' THEN
        RETURN json_build_object('success', false, 'error', 'Appointment is not in progress');
    END IF;
    
    IF v_appointment.work_started_at IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Work was never started');
    END IF;
    
    -- Calculate duration
    v_duration := EXTRACT(EPOCH FROM (NOW() - v_appointment.work_started_at)) / 60;
    
    -- Update appointment
    UPDATE service_appointments
    SET 
        work_ended_at = NOW(),
        actual_duration_minutes = v_duration,
        updated_at = NOW()
    WHERE id = p_appointment_id;
    
    RETURN json_build_object(
        'success', true,
        'appointment_id', p_appointment_id,
        'work_ended_at', NOW(),
        'actual_duration_minutes', v_duration,
        'message', 'Service work ended. Remember to complete the appointment with notes and photos.'
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', SQLERRM
        );
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 8. VIEW: Service Appointment Overview
-- =====================================================

CREATE OR REPLACE VIEW service_appointment_overview AS
SELECT 
    sa.id,
    sa.appointment_date,
    sa.start_time,
    sa.end_time,
    sa.status,
    sa.service_id,
    s.name as service_name,
    s.service_type,
    sa.organization_id,
    o.name as organization_name,
    sa.location_id,
    l.name as location_name,
    l.address as location_address,
    l.city,
    l.province,
    l.latitude,
    l.longitude,
    sa.assigned_bot_id,
    b.name as bot_name,
    sa.assigned_technician_id,
    COALESCE(tech.full_name, tech.first_name, SPLIT_PART(tech.email, '@', 1)) as technician_name,
    sa.work_started_at,
    sa.work_ended_at,
    sa.actual_duration_minutes,
    sa.completed_at,
    sa.completed_by,
    COALESCE(comp.full_name, comp.first_name, SPLIT_PART(comp.email, '@', 1)) as completed_by_name,
    sa.service_quality_rating,
    sa.service_notes,
    sa.admin_notes,
    sa.created_at,
    sa.updated_at
FROM service_appointments sa
INNER JOIN services s ON s.id = sa.service_id
INNER JOIN organizations o ON o.id = sa.organization_id
INNER JOIN locations l ON l.id = sa.location_id
LEFT JOIN bots b ON b.id = sa.assigned_bot_id
LEFT JOIN profiles tech ON tech.id = sa.assigned_technician_id
LEFT JOIN profiles comp ON comp.id = sa.completed_by;

COMMENT ON VIEW service_appointment_overview IS 'Comprehensive view of service appointments with all related data';

-- =====================================================
-- 9. INDEXES FOR PERFORMANCE
-- =====================================================

-- Additional indexes for calendar queries
CREATE INDEX IF NOT EXISTS idx_service_appointments_month_year ON service_appointments(
    EXTRACT(YEAR FROM appointment_date),
    EXTRACT(MONTH FROM appointment_date)
);

CREATE INDEX IF NOT EXISTS idx_service_appointments_org_month ON service_appointments(
    organization_id,
    EXTRACT(YEAR FROM appointment_date),
    EXTRACT(MONTH FROM appointment_date)
);

-- =====================================================
-- 10. GRANT PERMISSIONS
-- =====================================================

GRANT EXECUTE ON FUNCTION get_monthly_service_statistics TO authenticated;
GRANT EXECUTE ON FUNCTION get_monthly_service_locations TO authenticated;
GRANT EXECUTE ON FUNCTION get_service_calendar_for_month TO authenticated;
GRANT EXECUTE ON FUNCTION complete_service_appointment TO authenticated;
GRANT EXECUTE ON FUNCTION start_service_work TO authenticated;
GRANT EXECUTE ON FUNCTION end_service_work TO authenticated;

GRANT SELECT ON service_appointment_overview TO authenticated;

-- =====================================================
-- SUCCESS MESSAGE
-- =====================================================

DO $$
BEGIN
    RAISE NOTICE '✅ Service Calendar System created successfully!';
    RAISE NOTICE '';
    RAISE NOTICE 'New Features:';
    RAISE NOTICE '  📅 get_monthly_service_statistics() - Monthly stats overview';
    RAISE NOTICE '  🗺️  get_monthly_service_locations() - Location mapping for month';
    RAISE NOTICE '  📆 get_service_calendar_for_month() - Calendar view with appointments';
    RAISE NOTICE '  ✅ complete_service_appointment() - Mark service complete with details';
    RAISE NOTICE '  🚀 start_service_work() - Start service work timer';
    RAISE NOTICE '  🏁 end_service_work() - End service work timer';
    RAISE NOTICE '  👁️  service_appointment_overview - Comprehensive view';
    RAISE NOTICE '';
    RAISE NOTICE 'Service completion now creates service_records automatically!';
END $$;

