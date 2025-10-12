-- =====================================================
-- Remove Weather-Aware Features & Update Service Frequency
-- Migration to simplify mowing frequency to monthly/bi-monthly
-- =====================================================

-- Update gardens table: Change mowing_frequency_days to service_frequency
ALTER TABLE gardens 
    DROP COLUMN IF EXISTS mowing_frequency_days,
    ADD COLUMN IF NOT EXISTS service_frequency TEXT DEFAULT 'bi-weekly' 
        CHECK (service_frequency IN ('bi-weekly', 'monthly'));

-- Remove weather-related fields from mowing_sessions if they exist
ALTER TABLE mowing_sessions
    DROP COLUMN IF EXISTS weather_temp_c,
    DROP COLUMN IF EXISTS weather_conditions;

-- Update bot_schedules to reflect monthly/bi-monthly instead of daily/weekly
-- (Keep the table structure but update any existing schedules)
UPDATE bot_schedules
SET schedule_type = 'monthly'
WHERE schedule_type = 'daily' OR schedule_type = 'weekly';

-- Add comment to explain the change
COMMENT ON COLUMN gardens.service_frequency IS 'Service frequency: bi-weekly (every 2 weeks) or monthly (every 4 weeks)';

-- =====================================================
-- Data Migration: Convert existing frequency data
-- =====================================================

-- For existing gardens, convert mowing_frequency_days to service_frequency
-- This would have run before we dropped the column, but keeping for reference
-- If mowing_frequency_days <= 30, set to 'monthly'
-- If mowing_frequency_days > 30, set to 'bi-monthly'

