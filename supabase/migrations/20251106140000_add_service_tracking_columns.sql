-- Add service tracking columns to services table
-- These columns enable the dashboard analytics functions to track service completion

-- Add stage column for tracking service execution state
ALTER TABLE services ADD COLUMN IF NOT EXISTS stage TEXT DEFAULT 'pending_setup' 
  CHECK (stage IN ('pending_setup', 'scheduled', 'in_progress', 'active', 'completed', 'paused', 'cancelled'));

-- Add area tracking for lawn and pool services
ALTER TABLE services ADD COLUMN IF NOT EXISTS area_sqm INTEGER DEFAULT 0;

-- Add timing columns for service execution
ALTER TABLE services ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE services ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Add organization_id to bots table for easier querying
ALTER TABLE bots ADD COLUMN IF NOT EXISTS organization_id UUID;

-- Update existing bots to set organization_id from their location
UPDATE bots SET organization_id = l.organization_id
FROM locations l
WHERE bots.location_id = l.id AND bots.organization_id IS NULL;

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_services_stage ON services(stage);
CREATE INDEX IF NOT EXISTS idx_services_completed_at ON services(completed_at);
CREATE INDEX IF NOT EXISTS idx_services_service_type ON services(service_type);
CREATE INDEX IF NOT EXISTS idx_services_org_stage ON services(organization_id, stage);
CREATE INDEX IF NOT EXISTS idx_bots_organization_id ON bots(organization_id);

-- Update the services check constraint to use stage if needed
-- Note: We're keeping both status and stage for now to maintain compatibility
COMMENT ON COLUMN services.status IS 'Overall service status (subscription level)';
COMMENT ON COLUMN services.stage IS 'Individual service session stage (work unit level)';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Service tracking columns added successfully';
END $$;

