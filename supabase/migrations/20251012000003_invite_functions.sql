-- =====================================================
-- Bot Korp Member Invite Functions
-- Handle member invitations and email sending
-- =====================================================

-- =====================================================
-- INVITATIONS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS organization_invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN (
        'owner', 'admin', 'manager', 'operator', 'viewer', 'member'
    )),
    invited_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    invited_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days',
    accepted_at TIMESTAMPTZ,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
    invite_token TEXT UNIQUE NOT NULL,
    can_manage_bots BOOLEAN DEFAULT false,
    can_manage_locations BOOLEAN DEFAULT false,
    can_view_billing BOOLEAN DEFAULT false,
    can_manage_billing BOOLEAN DEFAULT false,
    can_manage_members BOOLEAN DEFAULT false,
    can_view_analytics BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_org_invitations_organization_id ON organization_invitations(organization_id);
CREATE INDEX idx_org_invitations_email ON organization_invitations(email);
CREATE INDEX idx_org_invitations_token ON organization_invitations(invite_token);
CREATE INDEX idx_org_invitations_status ON organization_invitations(status);
CREATE INDEX idx_org_invitations_expires_at ON organization_invitations(expires_at);

-- Enable RLS
ALTER TABLE organization_invitations ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to generate secure invite token
CREATE OR REPLACE FUNCTION generate_invite_token()
RETURNS TEXT AS $$
BEGIN
    RETURN encode(gen_random_bytes(32), 'base64');
END;
$$ LANGUAGE plpgsql;

-- Function to check if invite is valid
CREATE OR REPLACE FUNCTION is_invite_valid(invite_token_param TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    invite_record RECORD;
BEGIN
    SELECT * INTO invite_record
    FROM organization_invitations
    WHERE invite_token = invite_token_param
    AND status = 'pending'
    AND expires_at > NOW();
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- INVITE MANAGEMENT FUNCTIONS
-- =====================================================

-- Function: Create member invitation
CREATE OR REPLACE FUNCTION create_member_invitation(
    p_organization_id UUID,
    p_email TEXT,
    p_role TEXT,
    p_invited_by UUID,
    p_can_manage_bots BOOLEAN DEFAULT false,
    p_can_manage_locations BOOLEAN DEFAULT false,
    p_can_view_billing BOOLEAN DEFAULT false,
    p_can_manage_billing BOOLEAN DEFAULT false,
    p_can_manage_members BOOLEAN DEFAULT false,
    p_can_view_analytics BOOLEAN DEFAULT true
)
RETURNS JSON AS $$
DECLARE
    v_invite_token TEXT;
    v_invitation_id UUID;
    v_organization_name TEXT;
    v_inviter_name TEXT;
    v_inviter_email TEXT;
    result JSON;
BEGIN
    -- Generate unique invite token
    v_invite_token := generate_invite_token();
    
    -- Get organization name
    SELECT name INTO v_organization_name
    FROM organizations
    WHERE id = p_organization_id;
    
    -- Get inviter details
    SELECT full_name, email INTO v_inviter_name, v_inviter_email
    FROM profiles
    WHERE id = p_invited_by;
    
    -- Check if user is already a member
    IF EXISTS (
        SELECT 1 FROM organization_members om
        INNER JOIN profiles p ON om.user_id = p.id
        WHERE om.organization_id = p_organization_id
        AND p.email = p_email
        AND om.status = 'active'
    ) THEN
        RAISE EXCEPTION 'User is already a member of this organization';
    END IF;
    
    -- Cancel any existing pending invites for this email and org
    UPDATE organization_invitations
    SET status = 'cancelled'
    WHERE organization_id = p_organization_id
    AND email = p_email
    AND status = 'pending';
    
    -- Create new invitation
    INSERT INTO organization_invitations (
        organization_id,
        email,
        role,
        invited_by,
        invite_token,
        can_manage_bots,
        can_manage_locations,
        can_view_billing,
        can_manage_billing,
        can_manage_members,
        can_view_analytics
    ) VALUES (
        p_organization_id,
        p_email,
        p_role,
        p_invited_by,
        v_invite_token,
        p_can_manage_bots,
        p_can_manage_locations,
        p_can_view_billing,
        p_can_manage_billing,
        p_can_manage_members,
        p_can_view_analytics
    )
    RETURNING id INTO v_invitation_id;
    
    -- Build result with all necessary email data
    SELECT json_build_object(
        'invitation_id', v_invitation_id,
        'invite_token', v_invite_token,
        'email', p_email,
        'organization_name', v_organization_name,
        'organization_id', p_organization_id,
        'role', p_role,
        'inviter_name', COALESCE(v_inviter_name, v_inviter_email),
        'inviter_email', v_inviter_email,
        'expires_at', (NOW() + INTERVAL '7 days')::TEXT,
        'invite_url', format('https://yourdomain.com/accept-invite/%s', v_invite_token)
    ) INTO result;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Accept invitation
CREATE OR REPLACE FUNCTION accept_member_invitation(
    p_invite_token TEXT,
    p_user_id UUID
)
RETURNS JSON AS $$
DECLARE
    v_invitation RECORD;
    v_membership_id UUID;
    v_user_email TEXT;
    result JSON;
BEGIN
    -- Get invitation details
    SELECT * INTO v_invitation
    FROM organization_invitations
    WHERE invite_token = p_invite_token
    AND status = 'pending'
    AND expires_at > NOW();
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid or expired invitation';
    END IF;
    
    -- Get user email
    SELECT email INTO v_user_email
    FROM profiles
    WHERE id = p_user_id;
    
    -- Verify email matches
    IF v_user_email != v_invitation.email THEN
        RAISE EXCEPTION 'Invitation email does not match user email';
    END IF;
    
    -- Check if already a member
    IF EXISTS (
        SELECT 1 FROM organization_members
        WHERE organization_id = v_invitation.organization_id
        AND user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'User is already a member of this organization';
    END IF;
    
    -- Create organization membership
    INSERT INTO organization_members (
        organization_id,
        user_id,
        role,
        can_manage_bots,
        can_manage_locations,
        can_view_billing,
        can_manage_billing,
        can_manage_members,
        can_view_analytics,
        status,
        invited_by,
        invited_at,
        joined_at
    ) VALUES (
        v_invitation.organization_id,
        p_user_id,
        v_invitation.role,
        v_invitation.can_manage_bots,
        v_invitation.can_manage_locations,
        v_invitation.can_view_billing,
        v_invitation.can_manage_billing,
        v_invitation.can_manage_members,
        v_invitation.can_view_analytics,
        'active',
        v_invitation.invited_by,
        v_invitation.invited_at,
        NOW()
    )
    RETURNING id INTO v_membership_id;
    
    -- Update invitation status
    UPDATE organization_invitations
    SET status = 'accepted',
        accepted_at = NOW()
    WHERE id = v_invitation.id;
    
    -- Return result
    SELECT json_build_object(
        'success', true,
        'membership_id', v_membership_id,
        'organization_id', v_invitation.organization_id
    ) INTO result;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get pending invitations for organization
CREATE OR REPLACE FUNCTION get_pending_invitations(p_organization_id UUID)
RETURNS TABLE(
    invitation_id UUID,
    email TEXT,
    role TEXT,
    invited_by_name TEXT,
    invited_by_email TEXT,
    invited_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    status TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        oi.id as invitation_id,
        oi.email,
        oi.role,
        p.full_name as invited_by_name,
        p.email as invited_by_email,
        oi.invited_at,
        oi.expires_at,
        oi.status
    FROM organization_invitations oi
    INNER JOIN profiles p ON oi.invited_by = p.id
    WHERE oi.organization_id = p_organization_id
    AND oi.status = 'pending'
    ORDER BY oi.invited_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Cancel invitation
CREATE OR REPLACE FUNCTION cancel_invitation(p_invitation_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE organization_invitations
    SET status = 'cancelled',
        updated_at = NOW()
    WHERE id = p_invitation_id
    AND status = 'pending';
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get invitation by token
CREATE OR REPLACE FUNCTION get_invitation_by_token(p_invite_token TEXT)
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'invitation_id', oi.id,
        'email', oi.email,
        'organization_id', oi.organization_id,
        'organization_name', o.name,
        'organization_logo', o.logo_url,
        'role', oi.role,
        'inviter_name', p.full_name,
        'inviter_email', p.email,
        'invited_at', oi.invited_at,
        'expires_at', oi.expires_at,
        'status', oi.status,
        'is_valid', (oi.status = 'pending' AND oi.expires_at > NOW())
    ) INTO result
    FROM organization_invitations oi
    INNER JOIN organizations o ON oi.organization_id = o.id
    INNER JOIN profiles p ON oi.invited_by = p.id
    WHERE oi.invite_token = p_invite_token;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- CLEANUP FUNCTION
-- =====================================================

-- Function to expire old invitations (call via cron/scheduler)
CREATE OR REPLACE FUNCTION expire_old_invitations()
RETURNS INTEGER AS $$
DECLARE
    expired_count INTEGER;
BEGIN
    UPDATE organization_invitations
    SET status = 'expired'
    WHERE status = 'pending'
    AND expires_at < NOW();
    
    GET DIAGNOSTICS expired_count = ROW_COUNT;
    RETURN expired_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- TRIGGERS
-- =====================================================

CREATE TRIGGER update_org_invitations_updated_at BEFORE UPDATE ON organization_invitations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- GRANT PERMISSIONS
-- =====================================================

GRANT EXECUTE ON FUNCTION create_member_invitation TO authenticated;
GRANT EXECUTE ON FUNCTION accept_member_invitation TO authenticated;
GRANT EXECUTE ON FUNCTION get_pending_invitations TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_invitation TO authenticated;
GRANT EXECUTE ON FUNCTION get_invitation_by_token TO authenticated;
GRANT EXECUTE ON FUNCTION get_invitation_by_token TO anon;
GRANT EXECUTE ON FUNCTION is_invite_valid TO authenticated;
GRANT EXECUTE ON FUNCTION is_invite_valid TO anon;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE organization_invitations IS 'Store pending member invitations with tokens';
COMMENT ON FUNCTION create_member_invitation IS 'Create a new member invitation and return email data';
COMMENT ON FUNCTION accept_member_invitation IS 'Accept an invitation and create organization membership';
COMMENT ON FUNCTION get_pending_invitations IS 'Get all pending invitations for an organization';
COMMENT ON FUNCTION cancel_invitation IS 'Cancel a pending invitation';
COMMENT ON FUNCTION get_invitation_by_token IS 'Get invitation details by token for display';
COMMENT ON FUNCTION expire_old_invitations IS 'Mark expired invitations as expired (run via scheduler)';

