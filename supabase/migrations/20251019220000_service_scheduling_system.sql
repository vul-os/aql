-- =====================================================
-- SERVICE SCHEDULING SYSTEM
-- Customer preferences + Admin appointment scheduling
-- =====================================================

-- =====================================================
-- HELPER FUNCTION: Update updated_at timestamp
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- TABLES
-- =====================================================

-- =====================================================
-- SERVICE PREFERENCES TABLE
-- Customer's scheduling preferences
-- =====================================================
CREATE TABLE IF NOT EXISTS service_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    
    -- Day and time preferences
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0 = Sunday, 6 = Saturday
    time_window_start TIME NOT NULL,
    time_window_end TIME NOT NULL,
    
    -- Priority (if customer has multiple days, which is preferred)
    priority INTEGER DEFAULT 1, -- 1 = highest priority
    
    -- Active status
    is_active BOOLEAN DEFAULT true,
    
    -- Metadata
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(service_id, day_of_week)
);

-- =====================================================
-- SERVICE APPOINTMENTS TABLE  
-- Actual scheduled appointments (allocated by admin)
-- =====================================================
CREATE TABLE IF NOT EXISTS service_appointments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    
    -- Appointment details
    appointment_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    
    -- Status
    status TEXT DEFAULT 'scheduled' CHECK (status IN (
        'scheduled',    -- Appointment scheduled
        'confirmed',    -- Customer confirmed
        'in_progress',  -- Service in progress
        'completed',    -- Service completed
        'cancelled',    -- Cancelled by customer or admin
        'no_show',      -- Customer didn't show up
        'rescheduled'   -- Has been rescheduled
    )),
    
    -- Assignment
    assigned_bot_id UUID REFERENCES bots(id) ON DELETE SET NULL,
    assigned_technician_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    
    -- Completion details
    completed_at TIMESTAMPTZ,
    completed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    service_duration_minutes INTEGER,
    
    -- Cancellation/Rescheduling
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    cancellation_reason TEXT,
    rescheduled_to UUID REFERENCES service_appointments(id) ON DELETE SET NULL,
    rescheduled_from UUID REFERENCES service_appointments(id) ON DELETE SET NULL,
    
    -- Customer communication
    reminder_sent_at TIMESTAMPTZ,
    confirmation_sent_at TIMESTAMPTZ,
    completion_notification_sent_at TIMESTAMPTZ,
    
    -- Service details
    service_notes TEXT,
    admin_notes TEXT,
    photos TEXT[],
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    
    -- Prevent double-booking
    UNIQUE(service_id, appointment_date, start_time)
);

-- =====================================================
-- INDEXES
-- =====================================================

-- Service preferences
CREATE INDEX IF NOT EXISTS idx_service_preferences_service_id ON service_preferences(service_id);
CREATE INDEX IF NOT EXISTS idx_service_preferences_day_of_week ON service_preferences(day_of_week);
CREATE INDEX IF NOT EXISTS idx_service_preferences_active ON service_preferences(is_active) WHERE is_active = true;

-- Service appointments
CREATE INDEX IF NOT EXISTS idx_service_appointments_service_id ON service_appointments(service_id);
CREATE INDEX IF NOT EXISTS idx_service_appointments_organization_id ON service_appointments(organization_id);
CREATE INDEX IF NOT EXISTS idx_service_appointments_location_id ON service_appointments(location_id);
CREATE INDEX IF NOT EXISTS idx_service_appointments_date ON service_appointments(appointment_date);
CREATE INDEX IF NOT EXISTS idx_service_appointments_status ON service_appointments(status);
CREATE INDEX IF NOT EXISTS idx_service_appointments_bot ON service_appointments(assigned_bot_id) WHERE assigned_bot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_appointments_technician ON service_appointments(assigned_technician_id) WHERE assigned_technician_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_appointments_upcoming ON service_appointments(appointment_date, start_time) WHERE status IN ('scheduled', 'confirmed');

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to get day name from number
CREATE OR REPLACE FUNCTION get_day_name(day_num INTEGER)
RETURNS TEXT AS $$
BEGIN
    RETURN CASE day_num
        WHEN 0 THEN 'Sunday'
        WHEN 1 THEN 'Monday'
        WHEN 2 THEN 'Tuesday'
        WHEN 3 THEN 'Wednesday'
        WHEN 4 THEN 'Thursday'
        WHEN 5 THEN 'Friday'
        WHEN 6 THEN 'Saturday'
        ELSE 'Unknown'
    END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to check if appointment overlaps with existing
CREATE OR REPLACE FUNCTION check_appointment_overlap(
    p_service_id UUID,
    p_appointment_date DATE,
    p_start_time TIME,
    p_end_time TIME,
    p_exclude_appointment_id UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_overlap_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM service_appointments
        WHERE service_id = p_service_id
            AND appointment_date = p_appointment_date
            AND status NOT IN ('cancelled', 'rescheduled')
            AND (p_exclude_appointment_id IS NULL OR id != p_exclude_appointment_id)
            AND (
                (start_time, end_time) OVERLAPS (p_start_time, p_end_time)
            )
    ) INTO v_overlap_exists;
    
    RETURN v_overlap_exists;
END;
$$ LANGUAGE plpgsql;

-- Function to get available time slots for a date based on preferences
CREATE OR REPLACE FUNCTION get_available_time_slots(
    p_service_id UUID,
    p_date DATE
)
RETURNS TABLE(
    day_of_week INTEGER,
    day_name TEXT,
    time_window_start TIME,
    time_window_end TIME,
    has_preference BOOLEAN,
    is_available BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        EXTRACT(DOW FROM p_date)::INTEGER as day_of_week,
        get_day_name(EXTRACT(DOW FROM p_date)::INTEGER) as day_name,
        sp.time_window_start,
        sp.time_window_end,
        true as has_preference,
        NOT check_appointment_overlap(
            p_service_id,
            p_date,
            sp.time_window_start,
            sp.time_window_end
        ) as is_available
    FROM service_preferences sp
    WHERE sp.service_id = p_service_id
        AND sp.day_of_week = EXTRACT(DOW FROM p_date)
        AND sp.is_active = true
    ORDER BY sp.priority;
END;
$$ LANGUAGE plpgsql;

-- Function to schedule appointment
CREATE OR REPLACE FUNCTION schedule_service_appointment(
    p_service_id UUID,
    p_appointment_date DATE,
    p_start_time TIME,
    p_end_time TIME,
    p_assigned_bot_id UUID DEFAULT NULL,
    p_assigned_technician_id UUID DEFAULT NULL,
    p_created_by UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSON AS $$
DECLARE
    v_appointment_id UUID;
    v_service RECORD;
    v_has_overlap BOOLEAN;
BEGIN
    -- Get service details
    SELECT * INTO v_service FROM services WHERE id = p_service_id;
    
    IF v_service IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Service not found');
    END IF;
    
    -- Check for overlaps
    v_has_overlap := check_appointment_overlap(
        p_service_id, 
        p_appointment_date, 
        p_start_time, 
        p_end_time
    );
    
    IF v_has_overlap THEN
        RETURN json_build_object(
            'success', false, 
            'error', 'Time slot already booked for this service'
        );
    END IF;
    
    -- Create appointment
    INSERT INTO service_appointments (
        service_id,
        organization_id,
        location_id,
        appointment_date,
        start_time,
        end_time,
        assigned_bot_id,
        assigned_technician_id,
        created_by,
        admin_notes,
        status
    ) VALUES (
        p_service_id,
        v_service.organization_id,
        v_service.location_id,
        p_appointment_date,
        p_start_time,
        p_end_time,
        p_assigned_bot_id,
        p_assigned_technician_id,
        p_created_by,
        p_notes,
        'scheduled'
    ) RETURNING id INTO v_appointment_id;
    
    -- Update service next_service_date if this is the nearest upcoming appointment
    UPDATE services 
    SET next_service_date = p_appointment_date
    WHERE id = p_service_id
        AND (next_service_date IS NULL OR p_appointment_date < next_service_date)
        AND p_appointment_date >= CURRENT_DATE;
    
    RETURN json_build_object(
        'success', true,
        'appointment_id', v_appointment_id,
        'message', 'Appointment scheduled successfully'
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', SQLERRM
        );
END;
$$ LANGUAGE plpgsql;

-- Function to get monthly appointments for a service
CREATE OR REPLACE FUNCTION get_service_appointments_for_month(
    p_service_id UUID,
    p_year INTEGER,
    p_month INTEGER
)
RETURNS TABLE(
    appointment_id UUID,
    appointment_date DATE,
    day_name TEXT,
    start_time TIME,
    end_time TIME,
    status TEXT,
    assigned_bot_name TEXT,
    assigned_technician_name TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        sa.id,
        sa.appointment_date,
        get_day_name(EXTRACT(DOW FROM sa.appointment_date)::INTEGER),
        sa.start_time,
        sa.end_time,
        sa.status,
        b.name as bot_name,
        COALESCE(p.full_name, p.first_name, SPLIT_PART(p.email, '@', 1)) as technician_name
    FROM service_appointments sa
    LEFT JOIN bots b ON b.id = sa.assigned_bot_id
    LEFT JOIN profiles p ON p.id = sa.assigned_technician_id
    WHERE sa.service_id = p_service_id
        AND EXTRACT(YEAR FROM sa.appointment_date) = p_year
        AND EXTRACT(MONTH FROM sa.appointment_date) = p_month
    ORDER BY sa.appointment_date, sa.start_time;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- TRIGGERS
-- =====================================================

-- Update updated_at on service_preferences
CREATE TRIGGER update_service_preferences_updated_at
    BEFORE UPDATE ON service_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Update updated_at on service_appointments
CREATE TRIGGER update_service_appointments_updated_at
    BEFORE UPDATE ON service_appointments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- ROW LEVEL SECURITY (DISABLED FOR DEVELOPMENT)
-- =====================================================

-- For production, uncomment the sections below to enable RLS

/*
ALTER TABLE service_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_appointments ENABLE ROW LEVEL SECURITY;

-- Users can view preferences for their organization's services
CREATE POLICY "Users can view service preferences for their org"
    ON service_preferences FOR SELECT
    USING (
        service_id IN (
            SELECT s.id FROM services s
            JOIN organization_members om ON om.organization_id = s.organization_id
            WHERE om.user_id = auth.uid() AND om.status = 'active'
        )
    );

-- Users can view appointments for their organization's services
CREATE POLICY "Users can view service appointments for their org"
    ON service_appointments FOR SELECT
    USING (
        organization_id IN (
            SELECT organization_id FROM organization_members
            WHERE user_id = auth.uid() AND status = 'active'
        )
    );

-- Admins can manage everything
CREATE POLICY "Admins can manage service preferences"
    ON service_preferences FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid() AND (is_admin = true OR role = 'admin')
        )
    );

CREATE POLICY "Admins can manage service appointments"
    ON service_appointments FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid() AND (is_admin = true OR role = 'admin')
        )
    );
*/

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE service_preferences IS 'Customer preferences for service scheduling (day of week + time windows)';
COMMENT ON TABLE service_appointments IS 'Actual scheduled appointments allocated by admin';
COMMENT ON FUNCTION schedule_service_appointment IS 'Schedule a new service appointment with overlap checking';
COMMENT ON FUNCTION get_available_time_slots IS 'Get available time slots for a specific date based on customer preferences';
COMMENT ON FUNCTION get_service_appointments_for_month IS 'Get all appointments for a service in a specific month';

-- Success message
DO $$
BEGIN
    RAISE NOTICE '- Service scheduling system created successfully!';
    RAISE NOTICE 'Tables:';
    RAISE NOTICE '  - service_preferences (customer day/time preferences)';
    RAISE NOTICE '  - service_appointments (admin scheduled appointments)';
    RAISE NOTICE 'Features:';
    RAISE NOTICE '  - Customer can choose days of week + time windows';
    RAISE NOTICE '  - Admin allocates actual appointment dates/times';
    RAISE NOTICE '  - Automatic overlap prevention';
    RAISE NOTICE '  - Monthly appointment views';
END $$;

