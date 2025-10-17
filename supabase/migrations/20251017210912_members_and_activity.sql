-- =====================================================
-- Organization Members and Activity Logs
-- =====================================================

-- ORGANIZATION_MEMBERS TABLE
CREATE TABLE organization_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN (
        'owner', 'admin', 'manager', 'operator', 'viewer', 'member'
    )),
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended', 'removed')),
    invited_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    invited_at TIMESTAMPTZ,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    last_active_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, user_id)
);

-- ACTIVITY_LOGS TABLE
CREATE TABLE activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id UUID,
    details JSONB,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for organization_members
CREATE INDEX IF NOT EXISTS idx_org_members_organization_id ON organization_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user_id ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_role ON organization_members(role);
CREATE INDEX IF NOT EXISTS idx_org_members_status ON organization_members(status);

-- Indexes for activity_logs
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_organization_id ON activity_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_resource ON activity_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC);

-- =====================================================
-- MEMBER INVITATIONS
-- =====================================================

CREATE TABLE IF NOT EXISTS member_invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'manager', 'operator', 'viewer', 'member')),
    
    -- Permissions
    can_manage_bots BOOLEAN DEFAULT false,
    can_manage_locations BOOLEAN DEFAULT false,
    can_view_billing BOOLEAN DEFAULT false,
    can_manage_billing BOOLEAN DEFAULT false,
    can_manage_members BOOLEAN DEFAULT false,
    can_view_analytics BOOLEAN DEFAULT true,
    
    -- Invitation tracking
    invited_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
    token TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    
    -- Response tracking
    accepted_at TIMESTAMPTZ,
    declined_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Alias table for compatibility
CREATE TABLE IF NOT EXISTS organization_invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'manager', 'operator', 'viewer', 'member')),
    invited_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
    token TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    accepted_at TIMESTAMPTZ,
    declined_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_member_invitations_org ON member_invitations(organization_id);
CREATE INDEX IF NOT EXISTS idx_member_invitations_email ON member_invitations(email);
CREATE INDEX IF NOT EXISTS idx_member_invitations_status ON member_invitations(status);
CREATE INDEX IF NOT EXISTS idx_member_invitations_token ON member_invitations(token);

CREATE INDEX IF NOT EXISTS idx_org_invitations_org ON organization_invitations(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_invitations_email ON organization_invitations(email);
CREATE INDEX IF NOT EXISTS idx_org_invitations_status ON organization_invitations(status);
CREATE INDEX IF NOT EXISTS idx_org_invitations_token ON organization_invitations(token);

-- RLS will be disabled in later migration

-- Comments
COMMENT ON TABLE organization_members IS 'Team members within organizations with roles and permissions';
COMMENT ON TABLE activity_logs IS 'Audit trail for all system activities';
COMMENT ON TABLE member_invitations IS 'Invitations to join organizations';
COMMENT ON TABLE organization_invitations IS 'Invitations alias table for compatibility';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Organization members, activity logs, and invitations tables created';
END $$;

