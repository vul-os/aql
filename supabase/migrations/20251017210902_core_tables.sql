-- =====================================================
-- Core Tables: Profiles, Organizations, Locations
-- =====================================================

-- PROFILES TABLE
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Basic info
    email TEXT UNIQUE NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    phone TEXT,
    role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin', 'staff', 'owner')),
    is_admin BOOLEAN DEFAULT false,
    
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
    
    -- Organization relationship
    organization_id UUID,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_sa_id_number CHECK (id_number IS NULL OR LENGTH(id_number) = 13)
);

-- ORGANIZATIONS TABLE
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    logo_url TEXT,
    owner_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    subscription_tier TEXT DEFAULT 'free' CHECK (subscription_tier IN ('free', 'basic', 'premium', 'enterprise')),
    is_active BOOLEAN DEFAULT true,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add foreign key from profiles to organizations (circular dependency)
ALTER TABLE profiles 
    ADD CONSTRAINT fk_profiles_organization 
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;

-- LOCATIONS TABLE
CREATE TABLE locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    
    -- Address
    address TEXT,
    city TEXT,
    state TEXT,
    country TEXT DEFAULT 'South Africa',
    province TEXT DEFAULT 'KwaZulu-Natal',
    suburb TEXT,
    postal_code TEXT,
    
    -- Geographic coordinates
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    timezone TEXT DEFAULT 'Africa/Johannesburg',
    
    -- Location type
    location_type TEXT CHECK (location_type IN ('residential', 'commercial', 'industrial', 'agricultural')),
    is_active BOOLEAN DEFAULT true,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for profiles
CREATE INDEX IF NOT EXISTS idx_profiles_organization_id ON profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_id_number ON profiles(id_number) WHERE id_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_legal_complete ON profiles(legal_profile_completed) WHERE legal_profile_completed = true;

-- Indexes for organizations
CREATE INDEX IF NOT EXISTS idx_organizations_owner_id ON organizations(owner_id);
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organizations_is_active ON organizations(is_active);

-- Indexes for locations
CREATE INDEX IF NOT EXISTS idx_locations_organization_id ON locations(organization_id);
CREATE INDEX IF NOT EXISTS idx_locations_is_active ON locations(is_active);
CREATE INDEX IF NOT EXISTS idx_locations_coordinates ON locations(latitude, longitude);

-- RLS will be disabled in later migration (development mode)

-- Comments
COMMENT ON TABLE profiles IS 'User profiles extending Supabase auth.users with legal information for contracts';
COMMENT ON TABLE organizations IS 'Organizations/companies owning bots and locations';
COMMENT ON TABLE locations IS 'Physical locations where bots are deployed';

COMMENT ON COLUMN profiles.first_name IS 'Legal first name for contracts';
COMMENT ON COLUMN profiles.surname IS 'Legal surname for contracts';
COMMENT ON COLUMN profiles.id_number IS 'South African ID number (13 digits) for legal identification';
COMMENT ON COLUMN profiles.physical_address IS 'Physical residential address for legal contracts';
COMMENT ON COLUMN profiles.cell_phone IS 'Cell phone number for contact and verification';
COMMENT ON COLUMN profiles.legal_profile_completed IS 'Whether user has completed legal profile information';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Core tables created: profiles, organizations, locations';
END $$;

