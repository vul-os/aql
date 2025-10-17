-- =====================================================
-- Auth Triggers
-- Auto-create profile, organization, and membership on signup
-- =====================================================

-- Function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_organization_id UUID;
    v_full_name TEXT;
    v_org_name TEXT;
    v_org_slug TEXT;
BEGIN
    -- Get the full name from metadata, fallback to email username
    v_full_name := COALESCE(
        NEW.raw_user_meta_data->>'full_name',
        SPLIT_PART(NEW.email, '@', 1),
        'User'
    );
    
    -- Generate organization name
    v_org_name := v_full_name || '''s Organization';
    
    -- Generate organization slug (URL-safe)
    v_org_slug := LOWER(
        REGEXP_REPLACE(
            REPLACE(v_full_name, ' ', '-') || '-' || SUBSTRING(NEW.id::TEXT, 1, 8),
            '[^a-z0-9-]',
            '',
            'g'
        )
    );
    
    -- Remove any leading/trailing hyphens
    v_org_slug := TRIM(BOTH '-' FROM v_org_slug);
    
    -- Ensure slug is not empty
    IF v_org_slug = '' OR v_org_slug IS NULL THEN
        v_org_slug := 'org-' || SUBSTRING(NEW.id::TEXT, 1, 8);
    END IF;
    
    -- Ensure slug is unique by appending random string if needed
    WHILE EXISTS (SELECT 1 FROM public.organizations WHERE slug = v_org_slug) LOOP
        v_org_slug := v_org_slug || '-' || SUBSTRING(MD5(RANDOM()::TEXT), 1, 4);
    END LOOP;
    
    -- 1. Create profile first (without organization_id)
    INSERT INTO public.profiles (id, email, full_name, avatar_url, role)
    VALUES (
        NEW.id,
        NEW.email,
        v_full_name,
        NEW.raw_user_meta_data->>'avatar_url',
        'owner'
    )
    ON CONFLICT (id) DO UPDATE
    SET 
        email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
        avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url);
    
    -- 2. Create organization (owner_id references the profile we just created)
    INSERT INTO public.organizations (name, slug, owner_id, subscription_tier, is_active)
    VALUES (
        v_org_name,
        v_org_slug,
        NEW.id,
        'free',
        true
    )
    RETURNING id INTO v_organization_id;
    
    -- 3. Update profile with organization_id
    UPDATE public.profiles
    SET organization_id = v_organization_id
    WHERE id = NEW.id;
    
    -- 4. Add user as owner member of the organization
    INSERT INTO public.organization_members (
        organization_id,
        user_id,
        role,
        status,
        joined_at
    ) VALUES (
        v_organization_id,
        NEW.id,
        'owner',
        'active',
        NOW()
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to automatically create profile on user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- Comments
COMMENT ON FUNCTION public.handle_new_user IS 'Automatically creates profile, organization, and membership when a new user signs up. User becomes owner of their own organization.';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Auth trigger created: auto profile/org/membership on signup';
END $$;

