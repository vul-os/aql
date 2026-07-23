-- =====================================================
-- Complete Member Invitation System
-- =====================================================

-- Create member_invitations table for tracking invites
CREATE TABLE IF NOT EXISTS member_invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'operator', 'viewer', 'member')),
    
    -- Permissions
    can_manage_bots BOOLEAN DEFAULT false,
    can_manage_locations BOOLEAN DEFAULT false,
    can_view_billing BOOLEAN DEFAULT false,
    can_manage_billing BOOLEAN DEFAULT false,
    can_manage_members BOOLEAN DEFAULT false,
    can_view_analytics BOOLEAN DEFAULT true,
    
    -- Invitation metadata
    invited_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    invited_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    
    -- Status
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
    accepted_at TIMESTAMPTZ,
    accepted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_member_invitations_organization ON member_invitations(organization_id);
CREATE INDEX idx_member_invitations_email ON member_invitations(email);
CREATE INDEX idx_member_invitations_token ON member_invitations(token);
CREATE INDEX idx_member_invitations_status ON member_invitations(status);
CREATE INDEX idx_member_invitations_expires_at ON member_invitations(expires_at);

-- Function to create member invitation (UPDATED)
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
    v_token TEXT;
    v_expires_at TIMESTAMPTZ;
    v_org_name TEXT;
    v_inviter_name TEXT;
    v_inviter_email TEXT;
    v_invitation_id UUID;
    result JSON;
BEGIN
    -- Check if user is already a member
    IF EXISTS (
        SELECT 1 FROM organization_members om
        JOIN profiles p ON om.user_id = p.id
        WHERE om.organization_id = p_organization_id
        AND p.email = p_email
        AND om.status = 'active'
    ) THEN
        RAISE EXCEPTION 'User is already a member of this organization';
    END IF;
    
    -- Check if there's a pending invitation
    IF EXISTS (
        SELECT 1 FROM member_invitations
        WHERE organization_id = p_organization_id
        AND email = p_email
        AND status = 'pending'
        AND expires_at > NOW()
    ) THEN
        RAISE EXCEPTION 'An invitation for this email already exists';
    END IF;
    
    -- Generate random token
    v_token := encode(gen_random_bytes(32), 'hex');
    v_expires_at := NOW() + INTERVAL '7 days';
    
    -- Get organization name
    SELECT name INTO v_org_name
    FROM organizations
    WHERE id = p_organization_id;
    
    -- Get inviter details
    SELECT full_name, email INTO v_inviter_name, v_inviter_email
    FROM profiles
    WHERE id = p_invited_by;
    
    -- Create invitation record
    INSERT INTO member_invitations (
        organization_id,
        email,
        token,
        role,
        can_manage_bots,
        can_manage_locations,
        can_view_billing,
        can_manage_billing,
        can_manage_members,
        can_view_analytics,
        invited_by,
        expires_at,
        status
    ) VALUES (
        p_organization_id,
        p_email,
        v_token,
        p_role,
        p_can_manage_bots,
        p_can_manage_locations,
        p_can_view_billing,
        p_can_manage_billing,
        p_can_manage_members,
        p_can_view_analytics,
        p_invited_by,
        v_expires_at,
        'pending'
    )
    RETURNING id INTO v_invitation_id;
    
    -- Return invitation data for email
    result := json_build_object(
        'invitation_id', v_invitation_id,
        'email', p_email,
        'organization_name', v_org_name,
        'organization_id', p_organization_id,
        'role', p_role,
        'inviter_name', COALESCE(v_inviter_name, 'A team member'),
        'inviter_email', v_inviter_email,
        'invite_token', v_token,
        'expires_at', v_expires_at,
        'accept_url', current_setting('app.base_url', true) || '/accept-invite/' || v_token
    );
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing function first to avoid parameter name conflicts
DROP FUNCTION IF EXISTS accept_member_invitation;

-- Function to accept invitation
CREATE FUNCTION accept_member_invitation(
    p_token TEXT,
    p_user_id UUID
)
RETURNS JSON AS $$
DECLARE
    v_invitation RECORD;
    v_member_id UUID;
    result JSON;
BEGIN
    -- Get invitation
    SELECT * INTO v_invitation
    FROM member_invitations
    WHERE token = p_token
        AND status = 'pending'
        AND expires_at > NOW();
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid or expired invitation';
    END IF;
    
    -- Check if user email matches invitation
    IF NOT EXISTS (
        SELECT 1 FROM profiles
        WHERE id = p_user_id
        AND email = v_invitation.email
    ) THEN
        RAISE EXCEPTION 'This invitation is for a different email address';
    END IF;
    
    -- Create organization member
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
    RETURNING id INTO v_member_id;
    
    -- Mark invitation as accepted
    UPDATE member_invitations
    SET 
        status = 'accepted',
        accepted_at = NOW(),
        accepted_by = p_user_id,
        updated_at = NOW()
    WHERE id = v_invitation.id;
    
    -- Update user's organization_id in profiles
    UPDATE profiles
    SET organization_id = v_invitation.organization_id
    WHERE id = p_user_id
        AND organization_id IS NULL;
    
    result := json_build_object(
        'success', true,
        'member_id', v_member_id,
        'organization_id', v_invitation.organization_id,
        'role', v_invitation.role
    );
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to cancel invitation
CREATE OR REPLACE FUNCTION cancel_member_invitation(
    p_invitation_id UUID,
    p_user_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE member_invitations
    SET 
        status = 'cancelled',
        updated_at = NOW()
    WHERE id = p_invitation_id
        AND invited_by = p_user_id
        AND status = 'pending';
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger
CREATE TRIGGER update_member_invitations_updated_at 
    BEFORE UPDATE ON member_invitations
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE member_invitations ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Organization members can view invitations"
    ON member_invitations FOR SELECT
    USING (
        organization_id IN (
            SELECT organization_id FROM organization_members
            WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Organization admins can create invitations"
    ON member_invitations FOR INSERT
    WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM organization_members
            WHERE user_id = auth.uid()
            AND (role IN ('owner', 'admin') OR can_manage_members = true)
        )
    );

-- Comments
COMMENT ON TABLE member_invitations IS 'Tracks pending and accepted team member invitations';
COMMENT ON FUNCTION create_member_invitation IS 'Create invitation and return data for email';
COMMENT ON FUNCTION accept_member_invitation IS 'Accept invitation and create organization member';
COMMENT ON FUNCTION cancel_member_invitation IS 'Cancel a pending invitation';

-- Grants
GRANT SELECT, INSERT ON member_invitations TO authenticated;
GRANT EXECUTE ON FUNCTION create_member_invitation TO authenticated;
GRANT EXECUTE ON FUNCTION accept_member_invitation TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_member_invitation TO authenticated;

