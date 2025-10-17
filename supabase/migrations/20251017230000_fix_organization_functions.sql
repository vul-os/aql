-- =====================================================
-- Fix Organization Functions
-- Drops and recreates organization management functions
-- =====================================================

-- Drop all existing versions of the functions
DROP FUNCTION IF EXISTS get_user_organizations CASCADE;
DROP FUNCTION IF EXISTS create_organization CASCADE;

-- =====================================================
-- GET USER ORGANIZATIONS
-- Returns all organizations a user is a member of
-- =====================================================
CREATE FUNCTION get_user_organizations(user_uuid UUID)
RETURNS TABLE (
    organization_id UUID,
    organization_name TEXT,
    organization_slug TEXT,
    organization_description TEXT,
    organization_logo_url TEXT,
    subscription_tier TEXT,
    is_active BOOLEAN,
    member_role TEXT,
    member_status TEXT,
    joined_at TIMESTAMPTZ,
    is_owner BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        o.id AS organization_id,
        o.name AS organization_name,
        o.slug AS organization_slug,
        o.description AS organization_description,
        o.logo_url AS organization_logo_url,
        o.subscription_tier,
        o.is_active,
        om.role AS member_role,
        om.status AS member_status,
        om.joined_at,
        (o.owner_id = user_uuid) AS is_owner
    FROM organizations o
    INNER JOIN organization_members om ON om.organization_id = o.id
    WHERE om.user_id = user_uuid
        AND om.status = 'active'
        AND o.is_active = true
    ORDER BY 
        (o.owner_id = user_uuid) DESC,  -- Owner orgs first
        om.role = 'admin' DESC,         -- Then admin orgs
        o.created_at DESC;              -- Then by creation date
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- CREATE ORGANIZATION
-- Creates a new organization and adds the user as owner
-- =====================================================
CREATE FUNCTION create_organization(
    p_user_id UUID,
    p_organization_name TEXT,
    p_organization_type TEXT DEFAULT 'residential'
)
RETURNS TABLE (
    organization_id UUID,
    organization_name TEXT,
    organization_slug TEXT,
    subscription_tier TEXT,
    member_role TEXT
) AS $$
DECLARE
    v_organization_id UUID;
    v_slug TEXT;
    v_slug_base TEXT;
    v_counter INTEGER := 0;
    v_slug_exists BOOLEAN;
BEGIN
    -- Validate inputs
    IF p_organization_name IS NULL OR trim(p_organization_name) = '' THEN
        RAISE EXCEPTION 'Organization name cannot be empty';
    END IF;
    
    -- Generate slug from organization name
    v_slug_base := lower(trim(regexp_replace(p_organization_name, '[^a-zA-Z0-9\s-]', '', 'g')));
    v_slug_base := regexp_replace(v_slug_base, '\s+', '-', 'g');
    v_slug_base := regexp_replace(v_slug_base, '-+', '-', 'g');
    v_slug_base := trim(both '-' from v_slug_base);
    
    -- Ensure slug is not empty
    IF v_slug_base = '' THEN
        v_slug_base := 'org';
    END IF;
    
    -- Make slug unique by adding counter if needed
    v_slug := v_slug_base;
    LOOP
        SELECT EXISTS(SELECT 1 FROM organizations WHERE slug = v_slug) INTO v_slug_exists;
        EXIT WHEN NOT v_slug_exists;
        
        v_counter := v_counter + 1;
        v_slug := v_slug_base || '-' || v_counter;
    END LOOP;
    
    -- Create the organization
    INSERT INTO organizations (
        name,
        slug,
        owner_id,
        subscription_tier,
        is_active
    ) VALUES (
        trim(p_organization_name),
        v_slug,
        p_user_id,
        'free',
        true
    ) RETURNING id INTO v_organization_id;
    
    -- Add user as owner member
    INSERT INTO organization_members (
        organization_id,
        user_id,
        role,
        status,
        joined_at
    ) VALUES (
        v_organization_id,
        p_user_id,
        'owner',
        'active',
        NOW()
    );
    
    -- Update user's default organization if they don't have one
    UPDATE profiles
    SET organization_id = v_organization_id
    WHERE id = p_user_id 
        AND organization_id IS NULL;
    
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
        v_organization_id,
        'create',
        'organization',
        v_organization_id,
        jsonb_build_object(
            'organization_name', trim(p_organization_name),
            'organization_type', p_organization_type
        )
    );
    
    -- Return the created organization
    RETURN QUERY
    SELECT 
        v_organization_id AS organization_id,
        trim(p_organization_name) AS organization_name,
        v_slug AS organization_slug,
        'free'::TEXT AS subscription_tier,
        'owner'::TEXT AS member_role;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- GRANT EXECUTE PERMISSIONS
-- =====================================================
GRANT EXECUTE ON FUNCTION get_user_organizations(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION create_organization(UUID, TEXT, TEXT) TO authenticated;

-- =====================================================
-- COMMENTS
-- =====================================================
COMMENT ON FUNCTION get_user_organizations IS 'Returns all organizations a user is a member of with their role and membership details';
COMMENT ON FUNCTION create_organization IS 'Creates a new organization and adds the user as owner member';

