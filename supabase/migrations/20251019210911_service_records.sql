-- =====================================================
-- Service Records and Bot Maintenance
-- =====================================================

CREATE TABLE service_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    service_type TEXT NOT NULL CHECK (service_type IN (
        'routine_maintenance', 'repair', 'inspection', 'installation',
        'firmware_update', 'part_replacement', 'emergency', 'recall',
        'warranty', 'calibration', 'cleaning', 'other'
    )),
    title TEXT NOT NULL,
    description TEXT,
    
    -- Service provider
    performed_by_name TEXT,
    performed_by_company TEXT,
    technician_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    
    -- Scheduling
    scheduled_date DATE,
    service_start TIMESTAMPTZ,
    service_end TIMESTAMPTZ,
    duration_minutes INTEGER,
    
    -- Status
    status TEXT DEFAULT 'scheduled' CHECK (status IN (
        'scheduled', 'in_progress', 'completed', 'cancelled', 'failed'
    )),
    
    -- Parts and costs
    parts_replaced TEXT[],
    parts_cost DECIMAL(10, 2),
    labor_cost DECIMAL(10, 2),
    total_cost DECIMAL(10, 2),
    currency TEXT DEFAULT 'ZAR',
    
    -- Service details
    issues_found TEXT[],
    actions_taken TEXT[],
    recommendations TEXT[],
    
    -- Follow-up
    follow_up_required BOOLEAN DEFAULT false,
    follow_up_date DATE,
    
    -- Documentation
    photos TEXT[],
    documents TEXT[],
    warranty_valid_until DATE,
    
    -- Related alert
    related_alert_id UUID REFERENCES bot_alerts(id) ON DELETE SET NULL,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_service_records_bot_id ON service_records(bot_id);
CREATE INDEX IF NOT EXISTS idx_service_records_location_id ON service_records(location_id);
CREATE INDEX IF NOT EXISTS idx_service_records_service_type ON service_records(service_type);
CREATE INDEX IF NOT EXISTS idx_service_records_status ON service_records(status);
CREATE INDEX IF NOT EXISTS idx_service_records_scheduled_date ON service_records(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_service_records_follow_up_required ON service_records(follow_up_required);
CREATE INDEX IF NOT EXISTS idx_service_records_created_at ON service_records(created_at DESC);

-- Enable RLS
-- ALTER TABLE service_records ENABLE ROW LEVEL SECURITY;

-- Comments
COMMENT ON TABLE service_records IS 'Complete service and maintenance history for all bots';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Service records table created';
END $$;

