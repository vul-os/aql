-- =====================================================
-- Require Service ID in Gardens and Pools
-- Ensures gardens/pools are always linked to a service
-- =====================================================

-- Add service_id to gardens if not exists
ALTER TABLE gardens
    ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE CASCADE;

-- Add service_id to pools if not exists  
ALTER TABLE pools
    ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE CASCADE;

-- For existing gardens/pools without service_id, create a placeholder service
-- This handles legacy data that was created before services were required
DO $$
DECLARE
    v_default_service_id UUID;
    v_garden RECORD;
    v_pool RECORD;
BEGIN
    -- Handle gardens without service_id
    FOR v_garden IN 
        SELECT g.*, l.organization_id 
        FROM gardens g 
        LEFT JOIN locations l ON l.id = g.location_id
        WHERE g.service_id IS NULL
    LOOP
        -- Create or get a service for this garden
        INSERT INTO services (
            organization_id,
            location_id,
            name,
            service_type,
            status,
            is_active
        ) VALUES (
            v_garden.organization_id,
            v_garden.location_id,
            'Legacy Lawn Service',
            'lawn',
            'active',
            true
        )
        ON CONFLICT DO NOTHING
        RETURNING id INTO v_default_service_id;
        
        -- If no service was created (conflict), get existing one
        IF v_default_service_id IS NULL THEN
            SELECT id INTO v_default_service_id
            FROM services
            WHERE location_id = v_garden.location_id
                AND service_type = 'lawn'
            LIMIT 1;
        END IF;
        
        -- Update garden with service_id
        UPDATE gardens
        SET service_id = v_default_service_id
        WHERE id = v_garden.id;
    END LOOP;
    
    -- Handle pools without service_id
    FOR v_pool IN 
        SELECT p.*, l.organization_id 
        FROM pools p 
        LEFT JOIN locations l ON l.id = p.location_id
        WHERE p.service_id IS NULL
    LOOP
        -- Create or get a service for this pool
        INSERT INTO services (
            organization_id,
            location_id,
            name,
            service_type,
            status,
            is_active
        ) VALUES (
            v_pool.organization_id,
            v_pool.location_id,
            'Legacy Pool Service',
            'pool',
            'active',
            true
        )
        ON CONFLICT DO NOTHING
        RETURNING id INTO v_default_service_id;
        
        IF v_default_service_id IS NULL THEN
            SELECT id INTO v_default_service_id
            FROM services
            WHERE location_id = v_pool.location_id
                AND service_type = 'pool'
            LIMIT 1;
        END IF;
        
        UPDATE pools
        SET service_id = v_default_service_id
        WHERE id = v_pool.id;
    END LOOP;
END $$;

-- Now make service_id NOT NULL (all rows should have values now)
ALTER TABLE gardens
    ALTER COLUMN service_id SET NOT NULL;

ALTER TABLE pools
    ALTER COLUMN service_id SET NOT NULL;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_gardens_service_id ON gardens(service_id);
CREATE INDEX IF NOT EXISTS idx_pools_service_id ON pools(service_id);

-- Comments
COMMENT ON COLUMN gardens.service_id IS 'Every garden must belong to a service (NOT NULL)';
COMMENT ON COLUMN pools.service_id IS 'Every pool must belong to a service (NOT NULL)';

