-- =====================================================
-- Add Pause/Resume Functionality to Services
-- Migration to allow pausing gardens and pools
-- =====================================================

-- Add pause functionality to gardens
ALTER TABLE gardens
    ADD COLUMN IF NOT EXISTS is_paused BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS paused_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS pause_reason TEXT,
    ADD COLUMN IF NOT EXISTS resumed_at TIMESTAMPTZ;

-- Add pause functionality to pools
ALTER TABLE pools
    ADD COLUMN IF NOT EXISTS is_paused BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS paused_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS pause_reason TEXT,
    ADD COLUMN IF NOT EXISTS resumed_at TIMESTAMPTZ;

-- Create indexes for pause status
CREATE INDEX IF NOT EXISTS idx_gardens_is_paused ON gardens(is_paused);
CREATE INDEX IF NOT EXISTS idx_pools_is_paused ON pools(is_paused);

-- Function to pause a garden service
CREATE OR REPLACE FUNCTION pause_garden_service(
    p_garden_id UUID,
    p_user_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE gardens
    SET 
        is_paused = true,
        paused_at = NOW(),
        paused_by = p_user_id,
        pause_reason = p_reason,
        updated_at = NOW()
    WHERE id = p_garden_id
        AND is_paused = false;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to resume a garden service
CREATE OR REPLACE FUNCTION resume_garden_service(
    p_garden_id UUID,
    p_user_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE gardens
    SET 
        is_paused = false,
        resumed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_garden_id
        AND is_paused = true;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to pause a pool service
CREATE OR REPLACE FUNCTION pause_pool_service(
    p_pool_id UUID,
    p_user_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE pools
    SET 
        is_paused = true,
        paused_at = NOW(),
        paused_by = p_user_id,
        pause_reason = p_reason,
        updated_at = NOW()
    WHERE id = p_pool_id
        AND is_paused = false;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to resume a pool service
CREATE OR REPLACE FUNCTION resume_pool_service(
    p_pool_id UUID,
    p_user_id UUID
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE pools
    SET 
        is_paused = false,
        resumed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_pool_id
        AND is_paused = true;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comments
COMMENT ON COLUMN gardens.is_paused IS 'Whether the service is currently paused';
COMMENT ON COLUMN gardens.paused_at IS 'When the service was paused';
COMMENT ON COLUMN gardens.paused_by IS 'User who paused the service';
COMMENT ON COLUMN gardens.pause_reason IS 'Reason for pausing (optional)';

COMMENT ON FUNCTION pause_garden_service IS 'Pause a garden service';
COMMENT ON FUNCTION resume_garden_service IS 'Resume a paused garden service';
COMMENT ON FUNCTION pause_pool_service IS 'Pause a pool service';
COMMENT ON FUNCTION resume_pool_service IS 'Resume a paused pool service';

-- Grant permissions
GRANT EXECUTE ON FUNCTION pause_garden_service TO authenticated;
GRANT EXECUTE ON FUNCTION resume_garden_service TO authenticated;
GRANT EXECUTE ON FUNCTION pause_pool_service TO authenticated;
GRANT EXECUTE ON FUNCTION resume_pool_service TO authenticated;

