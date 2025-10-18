-- =====================================================
-- Organization Legal Profiles
-- Separates legal information from user profiles
-- and attaches it to organizations
-- =====================================================

-- Create organization_legal_profiles table
CREATE TABLE organization_legal_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Legal profile fields (for contracts)
    first_name TEXT,
    surname TEXT,
    id_number TEXT,
    physical_address TEXT,
    physical_city TEXT,
    physical_province TEXT,
    physical_postal_code TEXT,
    cell_phone TEXT,
    legal_profile_completed BOOLEAN DEFAULT false,
    legal_profile_completed_at TIMESTAMPTZ,
    
    -- Audit fields
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_sa_id_number CHECK (id_number IS NULL OR LENGTH(id_number) = 13),
    CONSTRAINT unique_org_legal_profile UNIQUE (organization_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_org_legal_profiles_org_id ON organization_legal_profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_legal_profiles_id_number ON organization_legal_profiles(id_number) WHERE id_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_org_legal_profiles_completed ON organization_legal_profiles(legal_profile_completed) WHERE legal_profile_completed = true;

-- Migrate existing legal profile data from profiles to organization_legal_profiles
-- Only migrate for users who have an organization_id and have completed legal profile
INSERT INTO organization_legal_profiles (
    organization_id,
    first_name,
    surname,
    id_number,
    physical_address,
    physical_city,
    physical_province,
    physical_postal_code,
    cell_phone,
    legal_profile_completed,
    legal_profile_completed_at,
    created_by,
    created_at,
    updated_at
)
SELECT DISTINCT ON (p.organization_id)
    p.organization_id,
    p.first_name,
    p.surname,
    p.id_number,
    p.physical_address,
    p.physical_city,
    p.physical_province,
    p.physical_postal_code,
    p.cell_phone,
    p.legal_profile_completed,
    p.legal_profile_completed_at,
    p.id AS created_by,
    p.created_at,
    p.updated_at
FROM profiles p
WHERE 
    p.organization_id IS NOT NULL 
    AND p.legal_profile_completed = true
    AND p.first_name IS NOT NULL
ORDER BY p.organization_id, p.legal_profile_completed_at DESC NULLS LAST;

-- Add trigger for updated_at
CREATE TRIGGER update_organization_legal_profiles_updated_at
    BEFORE UPDATE ON organization_legal_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Comments
COMMENT ON TABLE organization_legal_profiles IS 'Legal profile information for organizations, used for contracts and agreements';
COMMENT ON COLUMN organization_legal_profiles.first_name IS 'Legal first name for contracts (typically the organization owner/representative)';
COMMENT ON COLUMN organization_legal_profiles.surname IS 'Legal surname for contracts';
COMMENT ON COLUMN organization_legal_profiles.id_number IS 'South African ID number (13 digits) for legal identification';
COMMENT ON COLUMN organization_legal_profiles.physical_address IS 'Physical address for legal contracts';
COMMENT ON COLUMN organization_legal_profiles.cell_phone IS 'Cell phone number for contact and verification';
COMMENT ON COLUMN organization_legal_profiles.legal_profile_completed IS 'Whether organization has completed legal profile information';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Organization legal profiles table created and data migrated';
END $$;

