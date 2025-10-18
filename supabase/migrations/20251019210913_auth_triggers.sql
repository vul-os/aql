-- =====================================================
-- Auth Triggers
-- Auto-create profile, organization, and membership on signup
-- =====================================================

-- Function to handle new user signup
-- Only creates profile, NOT organization (user creates org via frontend dialog)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_full_name TEXT;
    v_first_name TEXT;
BEGIN
    -- Get the full name from metadata, fallback to email username
    v_full_name := COALESCE(
        NEW.raw_user_meta_data->>'full_name',
        SPLIT_PART(NEW.email, '@', 1),
        'User'
    );
    
    -- Get first name from metadata, fallback to email username
    v_first_name := COALESCE(
        NEW.raw_user_meta_data->>'first_name',
        NEW.raw_user_meta_data->>'full_name',
        SPLIT_PART(NEW.email, '@', 1),
        'User'
    );
    
    -- Create profile only (no organization yet)
    INSERT INTO public.profiles (id, email, full_name, first_name, avatar_url, role)
    VALUES (
        NEW.id,
        NEW.email,
        v_full_name,
        v_first_name,
        NEW.raw_user_meta_data->>'avatar_url',
        'user'
    )
    ON CONFLICT (id) DO UPDATE
    SET 
        email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
        first_name = COALESCE(EXCLUDED.first_name, profiles.first_name),
        avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url),
        role = COALESCE(EXCLUDED.role, profiles.role);
    
    RETURN NEW;
    
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING 'Error in handle_new_user for %: %', NEW.email, SQLERRM;
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
COMMENT ON FUNCTION public.handle_new_user IS 'Automatically creates profile when a new user signs up. Organization creation handled separately via create_organization() function called from frontend.';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Auth trigger created: auto profile creation on signup';
    RAISE NOTICE 'Organization creation: handled via create_organization() function from frontend';
END $$;

