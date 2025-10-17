-- =====================================================
-- Add Legal Profile Information Fields
-- For contract signing and legal documentation
-- =====================================================

-- Add legal fields to profiles table
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS first_name TEXT,
ADD COLUMN IF NOT EXISTS surname TEXT,
ADD COLUMN IF NOT EXISTS id_number TEXT,
ADD COLUMN IF NOT EXISTS physical_address TEXT,
ADD COLUMN IF NOT EXISTS physical_city TEXT,
ADD COLUMN IF NOT EXISTS physical_province TEXT,
ADD COLUMN IF NOT EXISTS physical_postal_code TEXT,
ADD COLUMN IF NOT EXISTS cell_phone TEXT,
ADD COLUMN IF NOT EXISTS legal_profile_completed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS legal_profile_completed_at TIMESTAMPTZ;

-- Add constraint for South African ID number format (13 digits)
ALTER TABLE profiles
ADD CONSTRAINT IF NOT EXISTS valid_sa_id_number 
CHECK (id_number IS NULL OR LENGTH(id_number) = 13);

-- Add index for searching by ID number (for legal/compliance)
CREATE INDEX IF NOT EXISTS idx_profiles_id_number ON profiles(id_number) 
WHERE id_number IS NOT NULL;

-- Add index for legal profile completion status
CREATE INDEX IF NOT EXISTS idx_profiles_legal_complete ON profiles(legal_profile_completed) 
WHERE legal_profile_completed = true;

-- Create a view for legal contract data
CREATE OR REPLACE VIEW profile_legal_info AS
SELECT 
    p.id,
    p.email,
    p.first_name,
    p.surname,
    COALESCE(p.first_name || ' ' || p.surname, p.full_name) as display_name,
    p.id_number,
    p.physical_address,
    p.physical_city,
    p.physical_province,
    p.physical_postal_code,
    COALESCE(p.cell_phone, p.phone) as contact_number,
    p.legal_profile_completed,
    p.legal_profile_completed_at,
    p.organization_id,
    o.name as organization_name
FROM profiles p
LEFT JOIN organizations o ON p.organization_id = o.organization_id;

-- Grant access to authenticated users
GRANT SELECT ON profile_legal_info TO authenticated;

-- Function to check if legal profile is complete
CREATE OR REPLACE FUNCTION is_legal_profile_complete(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_complete BOOLEAN;
BEGIN
    SELECT 
        first_name IS NOT NULL AND
        surname IS NOT NULL AND
        id_number IS NOT NULL AND
        physical_address IS NOT NULL AND
        cell_phone IS NOT NULL
    INTO v_complete
    FROM profiles
    WHERE id = p_user_id;
    
    RETURN COALESCE(v_complete, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to update legal profile
CREATE OR REPLACE FUNCTION update_legal_profile(
    p_user_id UUID,
    p_first_name TEXT,
    p_surname TEXT,
    p_id_number TEXT,
    p_physical_address TEXT,
    p_physical_city TEXT,
    p_physical_province TEXT,
    p_physical_postal_code TEXT,
    p_cell_phone TEXT
)
RETURNS JSON AS $$
DECLARE
    v_result JSON;
BEGIN
    -- Validate ID number format (South African - 13 digits)
    IF p_id_number IS NOT NULL AND LENGTH(p_id_number) != 13 THEN
        RETURN json_build_object(
            'success', false,
            'error', 'ID number must be exactly 13 digits'
        );
    END IF;
    
    -- Validate phone number (10 digits starting with 0, or with country code)
    IF p_cell_phone IS NOT NULL AND LENGTH(p_cell_phone) < 10 THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Cell phone number must be at least 10 digits'
        );
    END IF;
    
    -- Update the profile
    UPDATE profiles
    SET 
        first_name = p_first_name,
        surname = p_surname,
        full_name = p_first_name || ' ' || p_surname, -- Update full_name too
        id_number = p_id_number,
        physical_address = p_physical_address,
        physical_city = p_physical_city,
        physical_province = p_physical_province,
        physical_postal_code = p_physical_postal_code,
        cell_phone = p_cell_phone,
        phone = COALESCE(phone, p_cell_phone), -- Set phone if not already set
        legal_profile_completed = true,
        legal_profile_completed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_user_id;
    
    -- Return success with updated data
    SELECT json_build_object(
        'success', true,
        'profile', row_to_json(p.*)
    ) INTO v_result
    FROM profiles p
    WHERE p.id = p_user_id;
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION is_legal_profile_complete TO authenticated;
GRANT EXECUTE ON FUNCTION update_legal_profile TO authenticated;

-- Add helpful comments
COMMENT ON COLUMN profiles.first_name IS 'Legal first name for contracts';
COMMENT ON COLUMN profiles.surname IS 'Legal surname for contracts';
COMMENT ON COLUMN profiles.id_number IS 'South African ID number (13 digits) for legal identification';
COMMENT ON COLUMN profiles.physical_address IS 'Physical residential address for legal contracts';
COMMENT ON COLUMN profiles.cell_phone IS 'Cell phone number for contact and verification';
COMMENT ON COLUMN profiles.legal_profile_completed IS 'Whether user has completed legal profile information';

COMMENT ON FUNCTION is_legal_profile_complete IS 
'Check if user has completed all required legal profile fields for contract signing';

COMMENT ON FUNCTION update_legal_profile IS 
'Update user legal profile information. Used for contract signing and legal documentation. Validates ID number and phone formats.';

-- Trigger to update full_name when first_name or surname changes
CREATE OR REPLACE FUNCTION update_full_name_trigger()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.first_name IS NOT NULL AND NEW.surname IS NOT NULL THEN
        NEW.full_name := NEW.first_name || ' ' || NEW.surname;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_full_name
BEFORE INSERT OR UPDATE OF first_name, surname ON profiles
FOR EACH ROW
EXECUTE FUNCTION update_full_name_trigger();

-- Test and notify
DO $$
BEGIN
    RAISE NOTICE 'Legal profile fields added successfully';
    RAISE NOTICE 'Fields: first_name, surname, id_number, physical_address, cell_phone';
    RAISE NOTICE 'Use update_legal_profile() function to update legal information';
    RAISE NOTICE 'Use is_legal_profile_complete() to check if profile is ready for contracts';
END $$;

