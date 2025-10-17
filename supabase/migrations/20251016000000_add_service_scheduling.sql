-- =====================================================
-- Service Scheduling System
-- Flexible scheduling for garden/pool services
-- =====================================================

-- =====================================================
-- SERVICE SCHEDULES TABLE
-- Stores flexible scheduling preferences for services
-- =====================================================

CREATE TABLE IF NOT EXISTS service_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- References
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    garden_id UUID REFERENCES gardens(id) ON DELETE CASCADE,
    pool_id UUID REFERENCES pools(id) ON DELETE CASCADE,
    bot_id UUID REFERENCES bots(id) ON DELETE SET NULL,
    
    -- Schedule type
    schedule_type TEXT NOT NULL CHECK (schedule_type IN (
        'weekly',      -- Specific days of week (e.g., Monday, Wednesday)
        'monthly',     -- Specific days of month (e.g., 1st, 15th)
        'mixed'        -- Combination of both
    )),
    
    -- Service details
    service_name TEXT,
    description TEXT,
    
    -- Weekly schedule (days of week: 0=Sunday, 1=Monday, ..., 6=Saturday)
    weekly_days INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    
    -- Monthly schedule (days of month: 1-31)
    monthly_days INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    
    -- Time preferences
    preferred_time TIME NOT NULL,
    time_window_start TIME DEFAULT '10:00:00', -- Default 10am
    time_window_end TIME DEFAULT '16:00:00',   -- Default 4pm
    
    -- Frequency limits (based on subscription tier)
    max_services_per_month INTEGER NOT NULL DEFAULT 4,
    services_used_this_month INTEGER DEFAULT 0,
    
    -- Status and activation
    is_active BOOLEAN DEFAULT true,
    is_paused BOOLEAN DEFAULT false,
    paused_until DATE,
    
    -- Next scheduled date (calculated)
    next_service_date DATE,
    last_service_date DATE,
    
    -- Notifications
    notify_before_hours INTEGER DEFAULT 24,
    notification_enabled BOOLEAN DEFAULT true,
    
    -- Metadata and notes
    special_instructions TEXT,
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    
    -- Constraints
    CONSTRAINT check_service_target CHECK (
        (garden_id IS NOT NULL AND pool_id IS NULL) OR
        (pool_id IS NOT NULL AND garden_id IS NULL)
    ),
    CONSTRAINT check_time_window CHECK (
        time_window_start < time_window_end AND
        time_window_start >= '10:00:00' AND
        time_window_end <= '16:00:00'
    ),
    CONSTRAINT check_preferred_time_in_window CHECK (
        preferred_time >= time_window_start AND
        preferred_time <= time_window_end
    ),
    CONSTRAINT check_schedule_days CHECK (
        (schedule_type = 'weekly' AND array_length(weekly_days, 1) > 0) OR
        (schedule_type = 'monthly' AND array_length(monthly_days, 1) > 0) OR
        (schedule_type = 'mixed' AND array_length(weekly_days, 1) > 0 AND array_length(monthly_days, 1) > 0)
    )
);

-- Create indexes
CREATE INDEX idx_service_schedules_org ON service_schedules(organization_id);
CREATE INDEX idx_service_schedules_location ON service_schedules(location_id);
CREATE INDEX idx_service_schedules_garden ON service_schedules(garden_id);
CREATE INDEX idx_service_schedules_pool ON service_schedules(pool_id);
CREATE INDEX idx_service_schedules_bot ON service_schedules(bot_id);
CREATE INDEX idx_service_schedules_active ON service_schedules(is_active, is_paused);
CREATE INDEX idx_service_schedules_next_date ON service_schedules(next_service_date) WHERE is_active = true;
CREATE INDEX idx_service_schedules_type ON service_schedules(schedule_type);
CREATE INDEX idx_service_schedules_created ON service_schedules(created_at DESC);

-- =====================================================
-- SERVICE SCHEDULE HISTORY TABLE
-- Track actual service executions
-- =====================================================

CREATE TABLE IF NOT EXISTS service_schedule_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    schedule_id UUID NOT NULL REFERENCES service_schedules(id) ON DELETE CASCADE,
    bot_id UUID REFERENCES bots(id) ON DELETE SET NULL,
    
    -- Service details
    scheduled_date DATE NOT NULL,
    scheduled_time TIME NOT NULL,
    actual_start_time TIMESTAMPTZ,
    actual_end_time TIMESTAMPTZ,
    duration_minutes INTEGER,
    
    -- Status
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN (
        'scheduled',
        'confirmed',
        'in_progress',
        'completed',
        'cancelled',
        'rescheduled',
        'missed',
        'weather_cancelled'
    )),
    
    -- Completion details
    completion_notes TEXT,
    weather_conditions JSONB,
    photos TEXT[] DEFAULT ARRAY[]::TEXT[],
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    
    -- Cancellation/Rescheduling
    cancelled_at TIMESTAMPTZ,
    cancelled_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    cancellation_reason TEXT,
    rescheduled_to DATE,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_schedule_history_schedule ON service_schedule_history(schedule_id);
CREATE INDEX idx_schedule_history_bot ON service_schedule_history(bot_id);
CREATE INDEX idx_schedule_history_date ON service_schedule_history(scheduled_date DESC);
CREATE INDEX idx_schedule_history_status ON service_schedule_history(status);
CREATE INDEX idx_schedule_history_created ON service_schedule_history(created_at DESC);

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Function to calculate next service date
CREATE OR REPLACE FUNCTION calculate_next_service_date(
    p_schedule_id UUID
)
RETURNS DATE AS $$
DECLARE
    v_schedule RECORD;
    v_current_date DATE := CURRENT_DATE;
    v_next_date DATE;
    v_days_checked INTEGER := 0;
    v_max_days INTEGER := 60; -- Look ahead max 60 days
    v_check_date DATE;
    v_day_of_week INTEGER;
    v_day_of_month INTEGER;
BEGIN
    -- Get schedule details
    SELECT * INTO v_schedule
    FROM service_schedules
    WHERE id = p_schedule_id;
    
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    
    -- If paused, return paused_until date if in future
    IF v_schedule.is_paused AND v_schedule.paused_until IS NOT NULL THEN
        IF v_schedule.paused_until > v_current_date THEN
            RETURN v_schedule.paused_until;
        END IF;
    END IF;
    
    -- Start checking from tomorrow if last service was today
    IF v_schedule.last_service_date = v_current_date THEN
        v_check_date := v_current_date + 1;
    ELSE
        v_check_date := v_current_date;
    END IF;
    
    -- Loop through dates to find next matching day
    WHILE v_days_checked < v_max_days LOOP
        v_day_of_week := EXTRACT(DOW FROM v_check_date)::INTEGER;
        v_day_of_month := EXTRACT(DAY FROM v_check_date)::INTEGER;
        
        -- Check if date matches schedule
        IF v_schedule.schedule_type = 'weekly' THEN
            IF v_day_of_week = ANY(v_schedule.weekly_days) THEN
                RETURN v_check_date;
            END IF;
        ELSIF v_schedule.schedule_type = 'monthly' THEN
            IF v_day_of_month = ANY(v_schedule.monthly_days) THEN
                RETURN v_check_date;
            END IF;
        ELSIF v_schedule.schedule_type = 'mixed' THEN
            IF v_day_of_week = ANY(v_schedule.weekly_days) OR 
               v_day_of_month = ANY(v_schedule.monthly_days) THEN
                RETURN v_check_date;
            END IF;
        END IF;
        
        v_check_date := v_check_date + 1;
        v_days_checked := v_days_checked + 1;
    END LOOP;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Function to create schedule history entry
CREATE OR REPLACE FUNCTION create_schedule_history_entry(
    p_schedule_id UUID,
    p_service_date DATE,
    p_service_time TIME
)
RETURNS UUID AS $$
DECLARE
    v_history_id UUID;
    v_schedule RECORD;
BEGIN
    -- Get schedule details
    SELECT * INTO v_schedule
    FROM service_schedules
    WHERE id = p_schedule_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Schedule not found';
    END IF;
    
    -- Create history entry
    INSERT INTO service_schedule_history (
        schedule_id,
        bot_id,
        scheduled_date,
        scheduled_time,
        status
    ) VALUES (
        p_schedule_id,
        v_schedule.bot_id,
        p_service_date,
        p_service_time,
        'scheduled'
    )
    RETURNING id INTO v_history_id;
    
    RETURN v_history_id;
END;
$$ LANGUAGE plpgsql;

-- Function to update schedule after service completion
CREATE OR REPLACE FUNCTION complete_scheduled_service(
    p_history_id UUID,
    p_completion_notes TEXT DEFAULT NULL,
    p_rating INTEGER DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
    v_history RECORD;
    v_next_date DATE;
BEGIN
    -- Get history entry
    SELECT * INTO v_history
    FROM service_schedule_history
    WHERE id = p_history_id;
    
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    
    -- Update history entry
    UPDATE service_schedule_history
    SET 
        status = 'completed',
        actual_end_time = NOW(),
        completion_notes = p_completion_notes,
        rating = p_rating,
        duration_minutes = EXTRACT(EPOCH FROM (NOW() - actual_start_time)) / 60,
        updated_at = NOW()
    WHERE id = p_history_id;
    
    -- Update schedule
    UPDATE service_schedules
    SET 
        last_service_date = v_history.scheduled_date,
        services_used_this_month = services_used_this_month + 1,
        updated_at = NOW()
    WHERE id = v_history.schedule_id;
    
    -- Calculate and update next service date
    v_next_date := calculate_next_service_date(v_history.schedule_id);
    
    UPDATE service_schedules
    SET next_service_date = v_next_date
    WHERE id = v_history.schedule_id;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to reset monthly service counter (run at start of each month)
CREATE OR REPLACE FUNCTION reset_monthly_service_counters()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE service_schedules
    SET 
        services_used_this_month = 0,
        updated_at = NOW()
    WHERE is_active = true;
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get upcoming schedules
CREATE OR REPLACE FUNCTION get_upcoming_schedules(
    p_organization_id UUID,
    p_days_ahead INTEGER DEFAULT 30
)
RETURNS TABLE (
    schedule_id UUID,
    location_name TEXT,
    garden_name TEXT,
    pool_name TEXT,
    next_service_date DATE,
    preferred_time TIME,
    schedule_type TEXT,
    is_paused BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ss.id AS schedule_id,
        l.name AS location_name,
        g.name AS garden_name,
        p.name AS pool_name,
        ss.next_service_date,
        ss.preferred_time,
        ss.schedule_type,
        ss.is_paused
    FROM service_schedules ss
    JOIN locations l ON ss.location_id = l.id
    LEFT JOIN gardens g ON ss.garden_id = g.id
    LEFT JOIN pools p ON ss.pool_id = p.id
    WHERE ss.organization_id = p_organization_id
        AND ss.is_active = true
        AND ss.next_service_date IS NOT NULL
        AND ss.next_service_date <= CURRENT_DATE + p_days_ahead
    ORDER BY ss.next_service_date ASC, ss.preferred_time ASC;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- TRIGGERS
-- =====================================================

-- Trigger to validate day arrays
CREATE OR REPLACE FUNCTION validate_schedule_days()
RETURNS TRIGGER AS $$
DECLARE
    v_day INTEGER;
BEGIN
    -- Validate weekly days (0-6)
    IF NEW.weekly_days IS NOT NULL AND array_length(NEW.weekly_days, 1) > 0 THEN
        FOREACH v_day IN ARRAY NEW.weekly_days LOOP
            IF v_day < 0 OR v_day > 6 THEN
                RAISE EXCEPTION 'Invalid weekly day: %. Must be between 0 (Sunday) and 6 (Saturday)', v_day;
            END IF;
        END LOOP;
    END IF;
    
    -- Validate monthly days (1-31)
    IF NEW.monthly_days IS NOT NULL AND array_length(NEW.monthly_days, 1) > 0 THEN
        FOREACH v_day IN ARRAY NEW.monthly_days LOOP
            IF v_day < 1 OR v_day > 31 THEN
                RAISE EXCEPTION 'Invalid monthly day: %. Must be between 1 and 31', v_day;
            END IF;
        END LOOP;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER validate_schedule_days_trigger
    BEFORE INSERT OR UPDATE ON service_schedules
    FOR EACH ROW
    EXECUTE FUNCTION validate_schedule_days();

-- Trigger to update updated_at timestamp
CREATE TRIGGER update_service_schedules_updated_at 
    BEFORE UPDATE ON service_schedules
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_service_schedule_history_updated_at 
    BEFORE UPDATE ON service_schedule_history
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger to calculate next service date on insert/update
CREATE OR REPLACE FUNCTION trigger_calculate_next_service_date()
RETURNS TRIGGER AS $$
BEGIN
    NEW.next_service_date := calculate_next_service_date(NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calculate_next_date_on_change
    AFTER INSERT OR UPDATE OF weekly_days, monthly_days, schedule_type, is_paused, paused_until, last_service_date
    ON service_schedules
    FOR EACH ROW
    EXECUTE FUNCTION trigger_calculate_next_service_date();

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE service_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_schedule_history ENABLE ROW LEVEL SECURITY;

-- Users can view schedules for their organization
CREATE POLICY "Users can view own org schedules"
    ON service_schedules FOR SELECT
    USING (
        organization_id IN (
            SELECT organization_id FROM profiles 
            WHERE id = auth.uid()
        )
    );

-- Users can create schedules for their organization
CREATE POLICY "Users can create schedules for own org"
    ON service_schedules FOR INSERT
    WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM profiles 
            WHERE id = auth.uid()
        )
    );

-- Users can update schedules for their organization
CREATE POLICY "Users can update own org schedules"
    ON service_schedules FOR UPDATE
    USING (
        organization_id IN (
            SELECT organization_id FROM profiles 
            WHERE id = auth.uid()
        )
    );

-- Users can delete schedules for their organization
CREATE POLICY "Users can delete own org schedules"
    ON service_schedules FOR DELETE
    USING (
        organization_id IN (
            SELECT organization_id FROM profiles 
            WHERE id = auth.uid()
        )
    );

-- Users can view schedule history for their organization
CREATE POLICY "Users can view own org schedule history"
    ON service_schedule_history FOR SELECT
    USING (
        schedule_id IN (
            SELECT id FROM service_schedules 
            WHERE organization_id IN (
                SELECT organization_id FROM profiles 
                WHERE id = auth.uid()
            )
        )
    );

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE service_schedules IS 'Flexible scheduling system for garden and pool services';
COMMENT ON TABLE service_schedule_history IS 'History of scheduled and completed services';

COMMENT ON COLUMN service_schedules.schedule_type IS 'Type of schedule: weekly (days of week), monthly (days of month), or mixed';
COMMENT ON COLUMN service_schedules.weekly_days IS 'Array of days of week (0=Sunday to 6=Saturday)';
COMMENT ON COLUMN service_schedules.monthly_days IS 'Array of days of month (1-31)';
COMMENT ON COLUMN service_schedules.max_services_per_month IS 'Maximum services allowed per month based on subscription tier';
COMMENT ON COLUMN service_schedules.time_window_start IS 'Service time window start (default 10am)';
COMMENT ON COLUMN service_schedules.time_window_end IS 'Service time window end (default 4pm)';

COMMENT ON FUNCTION calculate_next_service_date IS 'Calculates the next service date based on schedule type and days';
COMMENT ON FUNCTION complete_scheduled_service IS 'Marks a service as completed and updates schedule';
COMMENT ON FUNCTION reset_monthly_service_counters IS 'Resets monthly service counters (run at start of each month)';
COMMENT ON FUNCTION get_upcoming_schedules IS 'Gets upcoming scheduled services for an organization';

-- =====================================================
-- GRANT PERMISSIONS
-- =====================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON service_schedules TO authenticated;
GRANT SELECT ON service_schedule_history TO authenticated;

GRANT EXECUTE ON FUNCTION calculate_next_service_date TO authenticated;
GRANT EXECUTE ON FUNCTION create_schedule_history_entry TO authenticated;
GRANT EXECUTE ON FUNCTION complete_scheduled_service TO authenticated;
GRANT EXECUTE ON FUNCTION get_upcoming_schedules TO authenticated;

