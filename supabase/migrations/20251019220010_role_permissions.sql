-- =====================================================
-- ROLE-BASED PERMISSIONS SYSTEM
-- =====================================================
-- Simple role-based permissions instead of individual flags
-- Role determines what a member can do

-- =====================================================
-- PERMISSION CHECKING FUNCTIONS
-- =====================================================

-- Function to check if user has permission
CREATE OR REPLACE FUNCTION has_permission(
    p_user_id UUID,
    p_organization_id UUID,
    p_permission TEXT  -- 'manage_bots', 'manage_services', 'view_billing', 'manage_billing', 'manage_members', 'view_analytics'
)
RETURNS BOOLEAN AS $$
DECLARE
    v_member_role TEXT;
BEGIN
    -- Get member role
    SELECT role INTO v_member_role
    FROM organization_members
    WHERE user_id = p_user_id
    AND organization_id = p_organization_id
    AND status = 'active';
    
    IF NOT FOUND THEN
        RETURN false;
    END IF;
    
    -- Permission matrix based on role
    CASE v_member_role
        WHEN 'owner' THEN
            RETURN true;  -- Owner has all permissions
            
        WHEN 'admin' THEN
            -- Admin has everything except changing ownership
            RETURN true;
            
        WHEN 'manager' THEN
            -- Manager can manage services, bots, locations, view billing
            RETURN p_permission IN ('manage_bots', 'manage_services', 'manage_locations', 'view_billing', 'view_analytics');
            
        WHEN 'operator' THEN
            -- Operator can view and do basic operations
            RETURN p_permission IN ('view_bots', 'view_services', 'view_analytics');
            
        WHEN 'viewer' THEN
            -- Viewer can only view
            RETURN p_permission IN ('view_bots', 'view_services', 'view_analytics');
            
        WHEN 'member' THEN
            -- Basic member can view assigned items
            RETURN p_permission IN ('view_analytics');
            
        ELSE
            RETURN false;
    END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user role in organization
CREATE OR REPLACE FUNCTION get_user_role(
    p_user_id UUID,
    p_organization_id UUID
)
RETURNS TEXT AS $$
DECLARE
    v_role TEXT;
BEGIN
    SELECT role INTO v_role
    FROM organization_members
    WHERE user_id = p_user_id
    AND organization_id = p_organization_id
    AND status = 'active';
    
    RETURN v_role;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get all permissions for a role
CREATE OR REPLACE FUNCTION get_role_permissions(p_role TEXT)
RETURNS JSONB AS $$
BEGIN
    RETURN CASE p_role
        WHEN 'owner' THEN
            jsonb_build_object(
                'manage_bots', true,
                'manage_services', true,
                'manage_locations', true,
                'view_billing', true,
                'manage_billing', true,
                'manage_members', true,
                'view_analytics', true,
                'manage_settings', true,
                'delete_organization', true
            )
        WHEN 'admin' THEN
            jsonb_build_object(
                'manage_bots', true,
                'manage_services', true,
                'manage_locations', true,
                'view_billing', true,
                'manage_billing', true,
                'manage_members', true,
                'view_analytics', true,
                'manage_settings', true,
                'delete_organization', false
            )
        WHEN 'manager' THEN
            jsonb_build_object(
                'manage_bots', true,
                'manage_services', true,
                'manage_locations', true,
                'view_billing', true,
                'manage_billing', false,
                'manage_members', false,
                'view_analytics', true,
                'manage_settings', false,
                'delete_organization', false
            )
        WHEN 'operator' THEN
            jsonb_build_object(
                'manage_bots', false,
                'manage_services', false,
                'manage_locations', false,
                'view_billing', false,
                'manage_billing', false,
                'manage_members', false,
                'view_analytics', true,
                'manage_settings', false,
                'delete_organization', false
            )
        WHEN 'viewer' THEN
            jsonb_build_object(
                'manage_bots', false,
                'manage_services', false,
                'manage_locations', false,
                'view_billing', false,
                'manage_billing', false,
                'manage_members', false,
                'view_analytics', true,
                'manage_settings', false,
                'delete_organization', false
            )
        WHEN 'member' THEN
            jsonb_build_object(
                'manage_bots', false,
                'manage_services', false,
                'manage_locations', false,
                'view_billing', false,
                'manage_billing', false,
                'manage_members', false,
                'view_analytics', true,
                'manage_settings', false,
                'delete_organization', false
            )
        ELSE
            '{}'::JSONB
    END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Grant permissions
GRANT EXECUTE ON FUNCTION has_permission(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_role(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_role_permissions(TEXT) TO authenticated;

-- Comments
COMMENT ON FUNCTION has_permission IS 'Check if user has specific permission in organization based on their role';
COMMENT ON FUNCTION get_user_role IS 'Get user role in organization';
COMMENT ON FUNCTION get_role_permissions IS 'Get all permissions for a specific role as JSONB';

-- Success message
DO $$
BEGIN
    RAISE NOTICE '=== ROLE-BASED PERMISSIONS SYSTEM ===';
    RAISE NOTICE 'Roles and their permissions:';
    RAISE NOTICE '  owner:    Full access to everything';
    RAISE NOTICE '  admin:    Almost full access (cannot delete org)';
    RAISE NOTICE '  manager:  Manage services, bots, locations, view billing';
    RAISE NOTICE '  operator: View bots, services, analytics';
    RAISE NOTICE '  viewer:   Read-only access';
    RAISE NOTICE '  member:   Basic view access';
    RAISE NOTICE '';
    RAISE NOTICE 'Functions:';
    RAISE NOTICE '  - has_permission(user_id, org_id, permission)';
    RAISE NOTICE '  - get_user_role(user_id, org_id)';
    RAISE NOTICE '  - get_role_permissions(role)';
    RAISE NOTICE '';
    RAISE NOTICE 'Example: SELECT has_permission(user_id, org_id, ''manage_bots'');';
END $$;

