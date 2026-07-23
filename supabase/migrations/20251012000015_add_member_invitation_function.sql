-- =====================================================
-- Member Invitation Function
-- Creates invitation for new team members
-- =====================================================

-- Function to create member invitation
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
    result JSON;
BEGIN
    -- Generate random token
    v_token := encode(gen_random_bytes(32), 'hex');
    v_expires_at := NOW() + INTERVAL '7 days';
    
    -- Get organization name
    SELECT name INTO v_org_name
    FROM organizations
    WHERE id = p_organization_id;
    
    -- Get inviter name
    SELECT full_name INTO v_inviter_name
    FROM profiles
    WHERE id = p_invited_by;
    
    -- Create pending member record
    -- Note: This will be activated when user accepts invitation
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
        invited_at
    ) VALUES (
        p_organization_id,
        p_invited_by, -- Placeholder, will be updated when user accepts
        p_role,
        p_can_manage_bots,
        p_can_manage_locations,
        p_can_view_billing,
        p_can_manage_billing,
        p_can_manage_members,
        p_can_view_analytics,
        'invited',
        p_invited_by,
        NOW()
    );
    
    -- Return invitation data for email
    result := json_build_object(
        'email', p_email,
        'organization_name', v_org_name,
        'organization_id', p_organization_id,
        'role', p_role,
        'inviter_name', COALESCE(v_inviter_name, 'A team member'),
        'invite_token', v_token,
        'expires_at', v_expires_at,
        'accept_url', 'https://your-app-url.com/accept-invite/' || v_token
    );
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permission
GRANT EXECUTE ON FUNCTION create_member_invitation TO authenticated;

-- Comment
COMMENT ON FUNCTION create_member_invitation IS 'Create an invitation for a new team member and return data for sending email';

