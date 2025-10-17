-- =====================================================
-- Enforce Unique Service Type Per Location
-- Prevents multiple services of the same type at one location
-- =====================================================

-- Add unique constraint to gardens table (location_id unique)
-- This ensures only one mow_bot service (garden) per location
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'unique_garden_per_location'
  ) THEN
    ALTER TABLE gardens
    ADD CONSTRAINT unique_garden_per_location UNIQUE (location_id);
  END IF;
END $$;

-- Add unique constraint to pools table (location_id unique)
-- This ensures only one pool_bot service per location
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'unique_pool_per_location'
  ) THEN
    ALTER TABLE pools
    ADD CONSTRAINT unique_pool_per_location UNIQUE (location_id);
  END IF;
END $$;

-- Note: If you need to support multiple gardens/pools per location in the future,
-- you can drop these constraints with:
-- ALTER TABLE gardens DROP CONSTRAINT IF EXISTS unique_garden_per_location;
-- ALTER TABLE pools DROP CONSTRAINT IF EXISTS unique_pool_per_location;

-- Add helpful comments
COMMENT ON CONSTRAINT unique_garden_per_location ON gardens IS 
  'Ensures only one mow_bot service (garden) can exist per location';

COMMENT ON CONSTRAINT unique_pool_per_location ON pools IS 
  'Ensures only one pool_bot service can exist per location';

-- Create a function to check if service type already exists at location
CREATE OR REPLACE FUNCTION check_service_exists_at_location(
  p_location_id UUID,
  p_service_type TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  -- Check based on service type
  CASE p_service_type
    WHEN 'garden' THEN
      SELECT EXISTS(SELECT 1 FROM gardens WHERE location_id = p_location_id) INTO v_exists;
    WHEN 'pool' THEN
      SELECT EXISTS(SELECT 1 FROM pools WHERE location_id = p_location_id) INTO v_exists;
    ELSE
      v_exists := FALSE;
  END CASE;
  
  RETURN v_exists;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION check_service_exists_at_location TO authenticated;

-- Add helpful comment
COMMENT ON FUNCTION check_service_exists_at_location IS 
  'Check if a service type already exists at a given location. Returns true if it exists.';

-- Test the constraints (these should fail if run twice)
DO $$
BEGIN
  RAISE NOTICE 'Unique service type per location constraints applied successfully';
  RAISE NOTICE 'Each location can now have only one garden (mow_bot) and one pool (pool_bot)';
  RAISE NOTICE 'Use check_service_exists_at_location(location_id, service_type) to check before inserting';
END $$;

