-- Service Stages and Installation Tracking
-- Manages the lifecycle of service from creation to active operation

-- Add stage column to gardens table
ALTER TABLE gardens
    ADD COLUMN IF NOT EXISTS stage TEXT DEFAULT 'pending_installation' 
        CHECK (stage IN (
            'pending_installation',
            'installation_scheduled',
            'installing',
            'installed',
            'active',
            'paused',
            'cancelled'
        )),
    ADD COLUMN IF NOT EXISTS installation_scheduled_date TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS installation_completed_date TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS installation_notes TEXT,
    ADD COLUMN IF NOT EXISTS technician_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS activation_date TIMESTAMPTZ;

-- Add stage column to pools table
ALTER TABLE pools
    ADD COLUMN IF NOT EXISTS stage TEXT DEFAULT 'pending_installation' 
        CHECK (stage IN (
            'pending_installation',
            'installation_scheduled',
            'installing',
            'installed',
            'active',
            'paused',
            'cancelled'
        )),
    ADD COLUMN IF NOT EXISTS installation_scheduled_date TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS installation_completed_date TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS installation_notes TEXT,
    ADD COLUMN IF NOT EXISTS technician_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS activation_date TIMESTAMPTZ;

-- Create indexes for stage queries
CREATE INDEX IF NOT EXISTS idx_gardens_stage ON gardens(stage);
CREATE INDEX IF NOT EXISTS idx_pools_stage ON pools(stage);
CREATE INDEX IF NOT EXISTS idx_gardens_installation_scheduled ON gardens(installation_scheduled_date) WHERE installation_scheduled_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pools_installation_scheduled ON pools(installation_scheduled_date) WHERE installation_scheduled_date IS NOT NULL;

-- Function to schedule installation
CREATE OR REPLACE FUNCTION schedule_installation(
    p_service_type TEXT,
    p_service_id UUID,
    p_scheduled_date TIMESTAMPTZ,
    p_technician_id UUID DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF p_service_type = 'garden' THEN
        UPDATE gardens
        SET 
            stage = 'installation_scheduled',
            installation_scheduled_date = p_scheduled_date,
            technician_id = p_technician_id,
            installation_notes = p_notes,
            updated_at = NOW()
        WHERE id = p_service_id;
    ELSIF p_service_type = 'pool' THEN
        UPDATE pools
        SET 
            stage = 'installation_scheduled',
            installation_scheduled_date = p_scheduled_date,
            technician_id = p_technician_id,
            installation_notes = p_notes,
            updated_at = NOW()
        WHERE id = p_service_id;
    ELSE
        RETURN FALSE;
    END IF;
    
    RETURN TRUE;
END;
$$;

-- Function to mark installation as in progress
CREATE OR REPLACE FUNCTION start_installation(
    p_service_type TEXT,
    p_service_id UUID,
    p_technician_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF p_service_type = 'garden' THEN
        UPDATE gardens
        SET 
            stage = 'installing',
            technician_id = COALESCE(p_technician_id, technician_id),
            updated_at = NOW()
        WHERE id = p_service_id;
    ELSIF p_service_type = 'pool' THEN
        UPDATE pools
        SET 
            stage = 'installing',
            technician_id = COALESCE(p_technician_id, technician_id),
            updated_at = NOW()
        WHERE id = p_service_id;
    ELSE
        RETURN FALSE;
    END IF;
    
    RETURN TRUE;
END;
$$;

-- Function to mark installation as complete
CREATE OR REPLACE FUNCTION complete_installation(
    p_service_type TEXT,
    p_service_id UUID,
    p_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF p_service_type = 'garden' THEN
        UPDATE gardens
        SET 
            stage = 'installed',
            installation_completed_date = NOW(),
            installation_notes = COALESCE(p_notes, installation_notes),
            updated_at = NOW()
        WHERE id = p_service_id;
    ELSIF p_service_type = 'pool' THEN
        UPDATE pools
        SET 
            stage = 'installed',
            installation_completed_date = NOW(),
            installation_notes = COALESCE(p_notes, installation_notes),
            updated_at = NOW()
        WHERE id = p_service_id;
    ELSE
        RETURN FALSE;
    END IF;
    
    RETURN TRUE;
END;
$$;

-- Function to activate service (start operations)
CREATE OR REPLACE FUNCTION activate_service(
    p_service_type TEXT,
    p_service_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF p_service_type = 'garden' THEN
        UPDATE gardens
        SET 
            stage = 'active',
            activation_date = NOW(),
            updated_at = NOW()
        WHERE id = p_service_id
        AND stage = 'installed';
    ELSIF p_service_type = 'pool' THEN
        UPDATE pools
        SET 
            stage = 'active',
            activation_date = NOW(),
            updated_at = NOW()
        WHERE id = p_service_id
        AND stage = 'installed';
    ELSE
        RETURN FALSE;
    END IF;
    
    RETURN TRUE;
END;
$$;

-- Function to get services pending installation
CREATE OR REPLACE FUNCTION get_pending_installations(
    p_organization_id UUID
)
RETURNS TABLE(
    service_type TEXT,
    service_id UUID,
    service_name TEXT,
    location_name TEXT,
    stage TEXT,
    installation_scheduled_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        'garden'::TEXT as service_type,
        g.id as service_id,
        g.name as service_name,
        l.name as location_name,
        g.stage,
        g.installation_scheduled_date,
        g.created_at
    FROM gardens g
    JOIN locations l ON g.location_id = l.id
    WHERE l.organization_id = p_organization_id
    AND g.stage IN ('pending_installation', 'installation_scheduled', 'installing')
    
    UNION ALL
    
    SELECT 
        'pool'::TEXT as service_type,
        p.id as service_id,
        p.name as service_name,
        l.name as location_name,
        p.stage,
        p.installation_scheduled_date,
        p.created_at
    FROM pools p
    JOIN locations l ON p.location_id = l.id
    WHERE l.organization_id = p_organization_id
    AND p.stage IN ('pending_installation', 'installation_scheduled', 'installing')
    
    ORDER BY installation_scheduled_date NULLS LAST, created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION schedule_installation TO authenticated;
GRANT EXECUTE ON FUNCTION start_installation TO authenticated;
GRANT EXECUTE ON FUNCTION complete_installation TO authenticated;
GRANT EXECUTE ON FUNCTION activate_service TO authenticated;
GRANT EXECUTE ON FUNCTION get_pending_installations TO authenticated;

-- Create installation status view
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
    p.first_name || ' ' || p.surname as technician_name,
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
    p.first_name || ' ' || p.surname as technician_name,
    po.created_at
FROM pools po
JOIN locations l ON po.location_id = l.id
LEFT JOIN profiles p ON po.technician_id = p.id;

COMMENT ON VIEW service_installation_status IS 'Combined view of installation status for all service types';

-- Comments
COMMENT ON COLUMN gardens.stage IS 'Current stage of service lifecycle: pending_installation, installation_scheduled, installing, installed, active, paused, cancelled';
COMMENT ON COLUMN gardens.installation_scheduled_date IS 'When installation is scheduled to happen';
COMMENT ON COLUMN gardens.installation_completed_date IS 'When installation was completed';
COMMENT ON COLUMN gardens.installation_notes IS 'Notes from technician about installation';
COMMENT ON COLUMN gardens.activation_date IS 'When service became active and operational';

COMMENT ON FUNCTION schedule_installation IS 'Schedule installation for a service';
COMMENT ON FUNCTION complete_installation IS 'Mark installation as complete';
COMMENT ON FUNCTION activate_service IS 'Activate service after installation';
COMMENT ON FUNCTION get_pending_installations IS 'Get all services pending installation for an organization';

