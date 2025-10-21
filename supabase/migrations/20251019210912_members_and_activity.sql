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
    
    -- Invitation tracking
    invited_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
    token TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
    
    -- Response tracking
    accepted_at TIMESTAMPTZ,
    declined_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    
    -- Metadata (permissions stored here as JSONB if needed)
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Alias table for compatibility
CREATE TABLE IF NOT EXISTS organization_invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'manager', 'operator', 'viewer', 'member')),
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
CREATE INDEX IF NOT EXISTS idx_org_invitations_invited_by ON organization_invitations(invited_by);

-- =====================================================
-- INVITATION MANAGEMENT FUNCTIONS
-- =====================================================

-- Create invitation
CREATE OR REPLACE FUNCTION create_member_invitation(
    p_organization_id UUID,
    p_email TEXT,
    p_role TEXT,
    p_invited_by UUID,
    p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_invitation_id UUID;
    v_token TEXT;
BEGIN
    v_token := encode(gen_random_bytes(32), 'hex');
    
    -- Cancel any pending invitations for this email
    UPDATE organization_invitations
    SET status = 'cancelled', cancelled_at = NOW()
    WHERE organization_id = p_organization_id AND email = p_email AND status = 'pending';
    
    -- Create new invitation
    INSERT INTO organization_invitations (
        organization_id, email, role, invited_by, status, token, expires_at, metadata
    ) VALUES (
        p_organization_id, p_email, p_role, p_invited_by, 'pending', v_token,
        NOW() + INTERVAL '7 days',
        p_metadata
    )
    RETURNING id INTO v_invitation_id;
    
    RETURN json_build_object('success', true, 'invitation_id', v_invitation_id, 'email', p_email, 'token', v_token);
EXCEPTION
    WHEN OTHERS THEN RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Accept invitation
CREATE OR REPLACE FUNCTION accept_member_invitation(p_invitation_id UUID, p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_invitation RECORD;
    v_user_email TEXT;
    v_member_id UUID;
BEGIN
    SELECT * INTO v_invitation FROM organization_invitations WHERE id = p_invitation_id;
    IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'Not found'); END IF;
    IF v_invitation.status != 'pending' THEN RETURN json_build_object('success', false, 'error', 'Already ' || v_invitation.status); END IF;
    IF v_invitation.expires_at < NOW() THEN RETURN json_build_object('success', false, 'error', 'Expired'); END IF;
    
    SELECT email INTO v_user_email FROM profiles WHERE id = p_user_id;
    IF v_user_email != v_invitation.email THEN RETURN json_build_object('success', false, 'error', 'Email mismatch'); END IF;
    
    -- Insert member with role only (permissions determined by role)
    INSERT INTO organization_members (
        organization_id, user_id, role, status, joined_at, metadata
    ) VALUES (
        v_invitation.organization_id, p_user_id, v_invitation.role, 'active', NOW(), v_invitation.metadata
    ) RETURNING id INTO v_member_id;
    
    UPDATE organization_invitations SET status = 'accepted', accepted_at = NOW() WHERE id = p_invitation_id;
    RETURN json_build_object('success', true, 'member_id', v_member_id);
EXCEPTION
    WHEN OTHERS THEN RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Decline invitation
CREATE OR REPLACE FUNCTION decline_member_invitation(p_invitation_id UUID, p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE 
    v_invitation RECORD;
    v_user_email TEXT;
BEGIN
    SELECT * INTO v_invitation FROM organization_invitations WHERE id = p_invitation_id;
    IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'Not found'); END IF;
    
    SELECT email INTO v_user_email FROM profiles WHERE id = p_user_id;
    IF v_user_email != v_invitation.email THEN RETURN json_build_object('success', false, 'error', 'Email mismatch'); END IF;
    
    UPDATE organization_invitations SET status = 'declined', declined_at = NOW() WHERE id = p_invitation_id;
    RETURN json_build_object('success', true);
EXCEPTION 
    WHEN OTHERS THEN RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Cancel invitation
CREATE OR REPLACE FUNCTION cancel_member_invitation(p_invitation_id UUID, p_user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_invitation RECORD;
BEGIN
    SELECT * INTO v_invitation FROM organization_invitations WHERE id = p_invitation_id;
    IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'Not found'); END IF;
    
    UPDATE organization_invitations SET status = 'cancelled', cancelled_at = NOW() WHERE id = p_invitation_id;
    RETURN json_build_object('success', true);
EXCEPTION 
    WHEN OTHERS THEN RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Get pending invitations for user
CREATE OR REPLACE FUNCTION get_user_pending_invitations(p_user_id UUID)
RETURNS TABLE (
    invitation_id UUID,
    organization_id UUID,
    organization_name TEXT,
    role TEXT,
    invited_by_name TEXT,
    invited_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_email TEXT;
BEGIN
    -- Get user's email
    SELECT email INTO v_user_email FROM profiles WHERE id = p_user_id;
    
    IF v_user_email IS NULL THEN
        RETURN;
    END IF;
    
    -- Return pending invitations for this email
    RETURN QUERY
    SELECT 
        oi.id,
        oi.organization_id,
        o.name,
        oi.role,
        p.full_name,
        oi.created_at,
        oi.expires_at
    FROM organization_invitations oi
    JOIN organizations o ON o.id = oi.organization_id
    LEFT JOIN profiles p ON p.id = oi.invited_by
    WHERE oi.email = v_user_email
        AND oi.status = 'pending'
        AND oi.expires_at > NOW()
    ORDER BY oi.created_at DESC;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION create_member_invitation(UUID, TEXT, TEXT, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION accept_member_invitation(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION decline_member_invitation(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_member_invitation(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_pending_invitations(UUID) TO authenticated;

-- RLS will be disabled in later migration

-- Comments
COMMENT ON TABLE organization_members IS 'Team members within organizations - permissions determined by role (owner, admin, manager, operator, viewer, member)';
COMMENT ON TABLE activity_logs IS 'Audit trail for all system activities';
COMMENT ON TABLE member_invitations IS 'Invitations to join organizations';
COMMENT ON TABLE organization_invitations IS 'Invitations table with token column for email invites';

COMMENT ON COLUMN organization_members.role IS 'Role determines all permissions: owner (all), admin (most), manager (services+bots), operator (view+basic), viewer (read-only), member (basic)';

-- =====================================================
-- NOTIFICATION PREFERENCES TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS notification_preferences (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
    
    -- Global notification channels
    email_enabled BOOLEAN DEFAULT true,
    push_enabled BOOLEAN DEFAULT false,
    
    -- Email notification preferences (by category)
    email_bot_alerts BOOLEAN DEFAULT true,
    email_service_reminders BOOLEAN DEFAULT true,
    email_billing BOOLEAN DEFAULT true,
    email_organization BOOLEAN DEFAULT true,
    email_system BOOLEAN DEFAULT true,
    
    -- Push notification preferences (by category)
    push_bot_alerts BOOLEAN DEFAULT true,
    push_service_reminders BOOLEAN DEFAULT true,
    push_billing BOOLEAN DEFAULT true,
    push_organization BOOLEAN DEFAULT false,
    push_system BOOLEAN DEFAULT true,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast user lookups
CREATE INDEX IF NOT EXISTS idx_notification_preferences_user ON notification_preferences(user_id);

-- Comments
COMMENT ON TABLE notification_preferences IS 'User notification preferences for email and push notifications';
COMMENT ON COLUMN notification_preferences.email_enabled IS 'Master toggle for email notifications';
COMMENT ON COLUMN notification_preferences.push_enabled IS 'Master toggle for push notifications';
COMMENT ON COLUMN notification_preferences.email_bot_alerts IS 'Email notifications for bot alerts (offline, battery, errors)';
COMMENT ON COLUMN notification_preferences.email_service_reminders IS 'Email notifications for service reminders and appointments';
COMMENT ON COLUMN notification_preferences.email_billing IS 'Email notifications for billing and payments';
COMMENT ON COLUMN notification_preferences.email_organization IS 'Email notifications for organization updates';
COMMENT ON COLUMN notification_preferences.email_system IS 'Email notifications for system announcements';

-- =====================================================
-- NOTIFICATIONS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Notification details
    type TEXT NOT NULL CHECK (type IN (
        'bot_offline',
        'bot_low_battery',
        'bot_alert',
        'service_created',
        'service_scheduled',
        'service_completed',
        'installation_completed',
        'service_amendment_submitted',
        'service_amendment_approved',
        'service_amendment_rejected',
        'payment_failed',
        'payment_success',
        'member_joined',
        'system'
    )),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    
    -- Related entities
    related_type TEXT CHECK (related_type IN ('bot', 'service', 'invoice', 'organization', 'amendment')),
    related_id UUID,
    
    -- Action button
    action_url TEXT,
    action_label TEXT,
    
    -- Status
    is_read BOOLEAN DEFAULT false,
    is_archived BOOLEAN DEFAULT false,
    read_at TIMESTAMPTZ,
    
    -- Delivery tracking
    sent_email BOOLEAN DEFAULT false,
    sent_push BOOLEAN DEFAULT false,
    
    -- Additional data
    data JSONB DEFAULT '{}'::jsonb,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_organization_id ON notifications(organization_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_is_archived ON notifications(is_archived) WHERE is_archived = false;

-- Comments
COMMENT ON TABLE notifications IS 'User notifications for events and alerts in the system';

-- =====================================================
-- PUSH SUBSCRIPTIONS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Push subscription details
    endpoint TEXT NOT NULL UNIQUE,
    p256dh_key TEXT NOT NULL,
    auth_key TEXT NOT NULL,
    
    -- Device/Browser info
    user_agent TEXT,
    device_type TEXT,
    browser TEXT,
    os TEXT,
    fcm_token TEXT,  -- Firebase Cloud Messaging token
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    last_used_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_organization_id ON push_subscriptions(organization_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_active ON push_subscriptions(is_active) WHERE is_active = true;

COMMENT ON TABLE push_subscriptions IS 'Web push notification subscriptions for users';

-- =====================================================
-- NOTIFICATION FUNCTIONS
-- =====================================================

-- Create notification (used by triggers and functions)
CREATE OR REPLACE FUNCTION create_notification(
    p_user_id UUID,
    p_type TEXT,
    p_title TEXT,
    p_message TEXT,
    p_priority TEXT DEFAULT 'normal',
    p_organization_id UUID DEFAULT NULL,
    p_related_type TEXT DEFAULT NULL,
    p_related_id UUID DEFAULT NULL,
    p_action_url TEXT DEFAULT NULL,
    p_action_label TEXT DEFAULT NULL,
    p_data JSONB DEFAULT '{}'::jsonb,
    p_send_email BOOLEAN DEFAULT false,
    p_send_push BOOLEAN DEFAULT false
)
RETURNS UUID AS $$
DECLARE
    v_notification_id UUID;
BEGIN
    INSERT INTO notifications (
        user_id,
        organization_id,
        type,
        title,
        message,
        priority,
        related_type,
        related_id,
        action_url,
        action_label,
        data
    ) VALUES (
        p_user_id,
        p_organization_id,
        p_type,
        p_title,
        p_message,
        p_priority,
        p_related_type,
        p_related_id,
        p_action_url,
        p_action_label,
        p_data
    )
    RETURNING id INTO v_notification_id;
    
    RETURN v_notification_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Mark notification as read
CREATE OR REPLACE FUNCTION mark_notification_read(p_notification_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE notifications
    SET is_read = true, read_at = NOW()
    WHERE id = p_notification_id AND user_id = p_user_id;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Mark all notifications as read
CREATE OR REPLACE FUNCTION mark_all_notifications_read(p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE notifications
    SET is_read = true, read_at = NOW()
    WHERE user_id = p_user_id AND is_read = false;
    
    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Archive notification
CREATE OR REPLACE FUNCTION archive_notification(p_notification_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE notifications
    SET is_archived = true
    WHERE id = p_notification_id AND user_id = p_user_id;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION create_notification IS 'Creates a new notification for a user';
COMMENT ON FUNCTION mark_notification_read IS 'Marks a notification as read';
COMMENT ON FUNCTION mark_all_notifications_read IS 'Marks all notifications as read for a user';
COMMENT ON FUNCTION archive_notification IS 'Archives a notification';

-- Grant permissions
GRANT EXECUTE ON FUNCTION create_notification TO authenticated;
GRANT EXECUTE ON FUNCTION mark_notification_read TO authenticated;
GRANT EXECUTE ON FUNCTION mark_all_notifications_read TO authenticated;
GRANT EXECUTE ON FUNCTION archive_notification TO authenticated;

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Organization members, activity logs, and invitations tables created';
    RAISE NOTICE 'Invitation management functions created';
    RAISE NOTICE 'Notification tables and functions created';
    RAISE NOTICE 'Push subscriptions table created';
END $$;

