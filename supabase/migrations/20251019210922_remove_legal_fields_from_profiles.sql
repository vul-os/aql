-- =====================================================
-- Remove Legal Profile Fields from Profiles Table
-- Legal profile data has been moved to organization_legal_profiles
-- NOTE: We keep first_name in profiles for display purposes
-- =====================================================

-- Drop views that depend on profiles columns we're removing
DROP VIEW IF EXISTS service_installation_status CASCADE;

-- Remove legal profile related indexes
DROP INDEX IF EXISTS idx_profiles_id_number;
DROP INDEX IF EXISTS idx_profiles_legal_complete;

-- Drop the trigger for updating full_name (if it exists)
DROP TRIGGER IF EXISTS trigger_update_full_name ON profiles;
DROP TRIGGER IF EXISTS update_full_name ON profiles;
DROP FUNCTION IF EXISTS update_full_name_trigger() CASCADE;

-- Remove legal profile fields from profiles table
-- NOTE: Keeping first_name for display purposes (auto-filled from auth trigger)
ALTER TABLE profiles 
    DROP COLUMN IF EXISTS surname,
    DROP COLUMN IF EXISTS id_number,
    DROP COLUMN IF EXISTS physical_address,
    DROP COLUMN IF EXISTS physical_city,
    DROP COLUMN IF EXISTS physical_province,
    DROP COLUMN IF EXISTS physical_postal_code,
    DROP COLUMN IF EXISTS cell_phone,
    DROP COLUMN IF EXISTS legal_profile_completed,
    DROP COLUMN IF EXISTS legal_profile_completed_at;

-- Recreate the service_installation_status view with updated schema
CREATE OR REPLACE VIEW service_installation_status AS
SELECT 
    'garden'::TEXT as service_type,
    g.id,
    g.name,
    l.name as location_name,
    l.organization_id,
    g.stage,
    g.installation_scheduled_date,
    g.installation_completed_date,
    g.activation_date,
    g.installation_notes,
    COALESCE(p.full_name, p.first_name, SPLIT_PART(p.email, '@', 1)) as technician_name,
    g.created_at
FROM gardens g
JOIN locations l ON g.location_id = l.id
LEFT JOIN profiles p ON g.technician_id = p.id

UNION ALL

SELECT 
    'pool'::TEXT as service_type,
    po.id,
    po.name,
    l.name as location_name,
    l.organization_id,
    po.stage,
    po.installation_scheduled_date,
    po.installation_completed_date,
    po.activation_date,
    po.installation_notes,
    COALESCE(p.full_name, p.first_name, SPLIT_PART(p.email, '@', 1)) as technician_name,
    po.created_at
FROM pools po
JOIN locations l ON po.location_id = l.id
LEFT JOIN profiles p ON po.technician_id = p.id;

COMMENT ON VIEW service_installation_status IS 'Combined view of installation status for all service types';

-- Update comment on profiles table
COMMENT ON TABLE profiles IS 'User profiles extending Supabase auth.users. Legal details stored in organization_legal_profiles.';

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Legal profile fields removed from profiles table (kept first_name for display)';
    RAISE NOTICE 'service_installation_status view recreated with updated schema';
END $$;

