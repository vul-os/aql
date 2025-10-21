-- =====================================================
-- Update Legal Profile Functions
-- Update functions to work with organization_legal_profiles
-- =====================================================

-- Drop old function
DROP FUNCTION IF EXISTS is_legal_profile_complete(UUID);

-- Function to check if organization legal profile is complete
CREATE OR REPLACE FUNCTION is_org_legal_profile_complete(p_organization_id UUID)
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
    FROM organization_legal_profiles
    WHERE organization_id = p_organization_id;
    
    RETURN COALESCE(v_complete, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old function
DROP FUNCTION IF EXISTS update_legal_profile(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

-- Function to update organization legal profile
CREATE OR REPLACE FUNCTION update_org_legal_profile(
    p_organization_id UUID,
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
    v_exists BOOLEAN;
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
    
    -- Check if legal profile exists for this organization
    SELECT EXISTS (
        SELECT 1 FROM organization_legal_profiles 
        WHERE organization_id = p_organization_id
    ) INTO v_exists;
    
    IF v_exists THEN
        -- Update existing legal profile
        UPDATE organization_legal_profiles
        SET 
            first_name = p_first_name,
            surname = p_surname,
            id_number = p_id_number,
            physical_address = p_physical_address,
            physical_city = p_physical_city,
            physical_province = p_physical_province,
            physical_postal_code = p_physical_postal_code,
            cell_phone = p_cell_phone,
            legal_profile_completed = true,
            legal_profile_completed_at = NOW(),
            updated_by = p_user_id,
            updated_at = NOW()
        WHERE organization_id = p_organization_id;
    ELSE
        -- Insert new legal profile
        INSERT INTO organization_legal_profiles (
            organization_id,
            first_name,
            surname,
            id_number,
            physical_address,
            physical_city,
            physical_province,
            physical_postal_code,
            cell_phone,
            legal_profile_completed,
            legal_profile_completed_at,
            created_by,
            updated_by
        ) VALUES (
            p_organization_id,
            p_first_name,
            p_surname,
            p_id_number,
            p_physical_address,
            p_physical_city,
            p_physical_province,
            p_physical_postal_code,
            p_cell_phone,
            true,
            NOW(),
            p_user_id,
            p_user_id
        );
    END IF;
    
    -- Return success with updated data
    SELECT json_build_object(
        'success', true,
        'legal_profile', row_to_json(lp.*)
    ) INTO v_result
    FROM organization_legal_profiles lp
    WHERE lp.organization_id = p_organization_id;
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get organization legal profile
CREATE OR REPLACE FUNCTION get_org_legal_profile(p_organization_id UUID)
RETURNS JSON AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT row_to_json(lp.*)
    INTO v_result
    FROM organization_legal_profiles lp
    WHERE lp.organization_id = p_organization_id;
    
    RETURN COALESCE(v_result, json_build_object('error', 'Legal profile not found'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Success message
DO $$
BEGIN
    RAISE NOTICE 'Legal profile functions updated to use organization_legal_profiles';
END $$;

