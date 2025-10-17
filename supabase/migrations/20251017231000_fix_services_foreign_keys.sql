-- =====================================================
-- Fix Services Foreign Keys
-- Ensure foreign key relationships exist for PostgREST
-- =====================================================

-- Drop existing constraints if they exist (to avoid conflicts)
ALTER TABLE IF EXISTS services 
    DROP CONSTRAINT IF EXISTS fk_services_location,
    DROP CONSTRAINT IF EXISTS fk_services_organization,
    DROP CONSTRAINT IF EXISTS services_location_id_fkey,
    DROP CONSTRAINT IF EXISTS services_organization_id_fkey;

-- Add foreign key for location_id
ALTER TABLE services
    ADD CONSTRAINT services_location_id_fkey 
    FOREIGN KEY (location_id) 
    REFERENCES locations(id) 
    ON DELETE CASCADE;

-- Add foreign key for organization_id  
ALTER TABLE services
    ADD CONSTRAINT services_organization_id_fkey 
    FOREIGN KEY (organization_id) 
    REFERENCES organizations(id) 
    ON DELETE CASCADE;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_services_location_id ON services(location_id);
CREATE INDEX IF NOT EXISTS idx_services_organization_id ON services(organization_id);
CREATE INDEX IF NOT EXISTS idx_services_service_type ON services(service_type);
CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);

-- Refresh schema cache (helps PostgREST detect relationships)
NOTIFY pgrst, 'reload schema';

-- Comment
COMMENT ON CONSTRAINT services_location_id_fkey ON services IS 'Links services to their physical location';
COMMENT ON CONSTRAINT services_organization_id_fkey ON services IS 'Links services to their organization';

