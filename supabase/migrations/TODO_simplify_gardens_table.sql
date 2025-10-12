-- =====================================================
-- TODO: Simplify Gardens Table
-- Remove unnecessary fields that aren't being used
-- =====================================================

-- This migration should be reviewed and applied when ready
-- Current required fields: id, location_id, name, area_sqm, created_at, updated_at
-- Everything else can be removed or made truly optional

/*
-- Drop unnecessary columns
ALTER TABLE gardens DROP COLUMN IF EXISTS description;
ALTER TABLE gardens DROP COLUMN IF EXISTS perimeter_m;
ALTER TABLE gardens DROP COLUMN IF EXISTS grass_type;
ALTER TABLE gardens DROP COLUMN IF EXISTS terrain_type;
ALTER TABLE gardens DROP COLUMN IF EXISTS difficulty_level;
ALTER TABLE gardens DROP COLUMN IF EXISTS has_obstacles;
ALTER TABLE gardens DROP COLUMN IF EXISTS obstacle_description;
ALTER TABLE gardens DROP COLUMN IF EXISTS images;
ALTER TABLE gardens DROP COLUMN IF EXISTS thumbnail_url;
ALTER TABLE gardens DROP COLUMN IF EXISTS preferred_cut_height_mm;
ALTER TABLE gardens DROP COLUMN IF EXISTS preferred_pattern;
ALTER TABLE gardens DROP COLUMN IF EXISTS mowing_frequency_days;
ALTER TABLE gardens DROP COLUMN IF EXISTS requires_maintenance;
ALTER TABLE gardens DROP COLUMN IF EXISTS last_mowed_at;
ALTER TABLE gardens DROP COLUMN IF EXISTS next_scheduled_mow;
ALTER TABLE gardens DROP COLUMN IF EXISTS boundary_geojson;
ALTER TABLE gardens DROP COLUMN IF EXISTS notes;

-- Keep only essential fields:
-- - id (PK)
-- - location_id (FK)
-- - name
-- - area_sqm
-- - is_active (for soft delete)
-- - metadata (for any future flexible data)
-- - created_at
-- - updated_at

-- Simplified gardens table will have minimal fields
-- All operational data (last_mowed_at, next_scheduled_mow) should come from mowing_sessions
-- All configuration (cut height, pattern, frequency) should be in bot_garden_assignments or bot config
*/

COMMENT ON TABLE gardens IS 'TODO: Simplify this table to only essential fields: name, area_sqm, is_active. Move operational data to sessions and config to assignments.';


