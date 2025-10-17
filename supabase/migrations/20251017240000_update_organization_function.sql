-- =====================================================
-- Update Organization Function
-- Allows organization owners/admins to update organization details
-- =====================================================

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS update_organization CASCADE;

-- =====================================================
-- UPDATE ORGANIZATION
-- Updates organization name and regenerates slug
-- =====================================================
CREATE FUNCTION update_organization(
    p_user_id UUID,
    p_organization_id UUID,
    p_organization_name TEXT
)
RETURNS TABLE (
    organization_id UUID,
    organization_name TEXT,
    organization_slug TEXT,
    success BOOLEAN,
    message TEXT
) AS $$
DECLARE
    v_member_role TEXT;
    v_slug TEXT;
    v_slug_base TEXT;
    v_counter INTEGER := 0;
    v_slug_exists BOOLEAN;
    v_current_slug TEXT;
BEGIN
    -- Check if user is a member of the organization
    SELECT role INTO v_member_role
    FROM organization_members
    WHERE organization_id = p_organization_id 
        AND user_id = p_user_id
        AND status = 'active';
    
    -- If not a member, raise error
    IF v_member_role IS NULL THEN
        RAISE EXCEPTION 'You are not a member of this organization';
    END IF;
    
    -- Check if user has permission (owner or admin)
    IF v_member_role NOT IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'Only owners and admins can update organization details';
    END IF;
    
    -- Validate new organization name
    IF p_organization_name IS NULL OR trim(p_organization_name) = '' THEN
        RAISE EXCEPTION 'Organization name cannot be empty';
    END IF;
    
    -- Get current slug
    SELECT slug INTO v_current_slug
    FROM organizations
    WHERE id = p_organization_id;
    
    -- Generate new slug from organization name
    v_slug_base := lower(trim(regexp_replace(p_organization_name, '[^a-zA-Z0-9\s-]', '', 'g')));
    v_slug_base := regexp_replace(v_slug_base, '\s+', '-', 'g');
    v_slug_base := regexp_replace(v_slug_base, '-+', '-', 'g');
    v_slug_base := trim(both '-' from v_slug_base);
    
    -- Ensure slug is not empty
    IF v_slug_base = '' THEN
        v_slug_base := 'org';
    END IF;
    
    -- Make slug unique by adding counter if needed (skip if same as current slug)
    v_slug := v_slug_base;
    LOOP
        SELECT EXISTS(
            SELECT 1 FROM organizations 
            WHERE slug = v_slug 
                AND id != p_organization_id
        ) INTO v_slug_exists;
        
        EXIT WHEN NOT v_slug_exists;
        
        v_counter := v_counter + 1;
        v_slug := v_slug_base || '-' || v_counter;
    END LOOP;
    
    -- Update the organization
    UPDATE organizations
    SET 
        name = trim(p_organization_name),
        slug = v_slug,
        updated_at = NOW()
    WHERE id = p_organization_id;
    
    -- Log activity
    INSERT INTO activity_logs (
        user_id,
        organization_id,
        action,
        resource_type,
        resource_id,
        details
    ) VALUES (
        p_user_id,
        p_organization_id,
        'update',
        'organization',
        p_organization_id,
        jsonb_build_object(
            'organization_name', trim(p_organization_name),
            'old_slug', v_current_slug,
            'new_slug', v_slug
        )
    );
    
    -- Return the updated organization
    RETURN QUERY
    SELECT 
        p_organization_id AS organization_id,
        trim(p_organization_name) AS organization_name,
        v_slug AS organization_slug,
        true AS success,
        'Organization updated successfully'::TEXT AS message;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- GRANT EXECUTE PERMISSIONS
-- =====================================================
GRANT EXECUTE ON FUNCTION update_organization(UUID, UUID, TEXT) TO authenticated;

-- =====================================================
-- COMMENTS
-- =====================================================
COMMENT ON FUNCTION update_organization IS 'Updates organization name and slug. Only owners and admins can update.';

