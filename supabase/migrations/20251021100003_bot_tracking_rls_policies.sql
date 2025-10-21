-- =====================================================
-- Bot Tracking RLS Policies
-- Secure bot data tables - force use of RPC functions
-- =====================================================

-- Enable RLS on all bot tracking tables
ALTER TABLE bot_location_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_sensor_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_daily_statistics ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- BOT_LOCATION_HISTORY POLICIES
-- =====================================================

-- Admin can see all location history
CREATE POLICY "Admins can view all bot location history"
ON bot_location_history
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
    )
);

-- Users can view location history for bots at their organization's locations
CREATE POLICY "Users can view bot location history in their org"
ON bot_location_history
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles p
        INNER JOIN bots b ON b.id = bot_location_history.bot_id
        INNER JOIN locations l ON l.id = b.location_id
        WHERE p.id = auth.uid()
        AND p.organization_id = l.organization_id
    )
);

-- Service role can insert location data (for bot API)
CREATE POLICY "Service role can insert location history"
ON bot_location_history
FOR INSERT
TO service_role
WITH CHECK (true);

-- =====================================================
-- BOT_EVENTS POLICIES
-- =====================================================

-- Admin can see all events
CREATE POLICY "Admins can view all bot events"
ON bot_events
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
    )
);

-- Users can view events for bots at their organization's locations
CREATE POLICY "Users can view bot events in their org"
ON bot_events
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles p
        INNER JOIN bots b ON b.id = bot_events.bot_id
        INNER JOIN locations l ON l.id = b.location_id
        WHERE p.id = auth.uid()
        AND p.organization_id = l.organization_id
    )
);

-- Service role can insert events (for bot API)
CREATE POLICY "Service role can insert bot events"
ON bot_events
FOR INSERT
TO service_role
WITH CHECK (true);

-- =====================================================
-- BOT_SENSOR_READINGS POLICIES
-- =====================================================

-- Admin can see all sensor readings
CREATE POLICY "Admins can view all bot sensor readings"
ON bot_sensor_readings
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
    )
);

-- Users can view sensor readings for bots at their organization's locations
CREATE POLICY "Users can view bot sensor readings in their org"
ON bot_sensor_readings
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles p
        INNER JOIN bots b ON b.id = bot_sensor_readings.bot_id
        INNER JOIN locations l ON l.id = b.location_id
        WHERE p.id = auth.uid()
        AND p.organization_id = l.organization_id
    )
);

-- Service role can insert sensor readings (for bot API)
CREATE POLICY "Service role can insert sensor readings"
ON bot_sensor_readings
FOR INSERT
TO service_role
WITH CHECK (true);

-- =====================================================
-- BOT_DAILY_STATISTICS POLICIES
-- =====================================================

-- Admin can see all daily statistics
CREATE POLICY "Admins can view all bot daily statistics"
ON bot_daily_statistics
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
    )
);

-- Users can view statistics for bots at their organization's locations
CREATE POLICY "Users can view bot statistics in their org"
ON bot_daily_statistics
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM profiles p
        INNER JOIN bots b ON b.id = bot_daily_statistics.bot_id
        INNER JOIN locations l ON l.id = b.location_id
        WHERE p.id = auth.uid()
        AND p.organization_id = l.organization_id
    )
);

-- Service role can insert/update statistics (for aggregation jobs)
CREATE POLICY "Service role can manage daily statistics"
ON bot_daily_statistics
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- =====================================================
-- Comments
-- =====================================================
COMMENT ON POLICY "Admins can view all bot location history" ON bot_location_history 
    IS 'Admins have full read access to all bot location history';
COMMENT ON POLICY "Users can view bot location history in their org" ON bot_location_history 
    IS 'Users can only view location history for bots at their organization locations';
COMMENT ON POLICY "Admins can view all bot events" ON bot_events 
    IS 'Admins have full read access to all bot events';
COMMENT ON POLICY "Users can view bot events in their org" ON bot_events 
    IS 'Users can only view events for bots at their organization locations';
COMMENT ON POLICY "Admins can view all bot sensor readings" ON bot_sensor_readings 
    IS 'Admins have full read access to all sensor readings';
COMMENT ON POLICY "Users can view bot sensor readings in their org" ON bot_sensor_readings 
    IS 'Users can only view sensor readings for bots at their organization locations';

-- Success message
DO $$
BEGIN
    RAISE NOTICE '🔒 RLS policies enabled for bot tracking tables';
    RAISE NOTICE '   ✓ bot_location_history';
    RAISE NOTICE '   ✓ bot_events';
    RAISE NOTICE '   ✓ bot_sensor_readings';
    RAISE NOTICE '   ✓ bot_daily_statistics';
    RAISE NOTICE '';
    RAISE NOTICE '⚠️  Note: RPC functions use SECURITY DEFINER and bypass RLS';
    RAISE NOTICE '   Direct table access is now protected by RLS policies';
END $$;


