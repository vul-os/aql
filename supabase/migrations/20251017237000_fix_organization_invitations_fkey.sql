-- =====================================================
-- Fix Organization Invitations Foreign Key
-- Ensure PostgREST can detect the relationship
-- =====================================================

-- Drop and recreate the foreign key with explicit naming
ALTER TABLE organization_invitations
    DROP CONSTRAINT IF EXISTS organization_invitations_organization_id_fkey;

ALTER TABLE organization_invitations
    ADD CONSTRAINT organization_invitations_organization_id_fkey 
    FOREIGN KEY (organization_id) 
    REFERENCES organizations(id) 
    ON DELETE CASCADE;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_organization_invitations_organization_id 
    ON organization_invitations(organization_id);

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';

-- Comment
COMMENT ON CONSTRAINT organization_invitations_organization_id_fkey ON organization_invitations 
    IS 'Links invitations to organizations for PostgREST relationship detection';

