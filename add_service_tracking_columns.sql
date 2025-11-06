-- Run this in the Supabase SQL Editor to add service tracking columns
-- These columns enable the dashboard analytics to track service completions

-- Add stage column for tracking individual service session state
ALTER TABLE services ADD COLUMN IF NOT EXISTS stage TEXT DEFAULT 'active';

-- Add area tracking for lawn and pool services (in square meters)
ALTER TABLE services ADD COLUMN IF NOT EXISTS area_sqm INTEGER DEFAULT 0;

-- Add timing columns for individual service sessions
ALTER TABLE services ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE services ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Add organization_id to bots table for easier dashboard queries
ALTER TABLE bots ADD COLUMN IF NOT EXISTS organization_id UUID;

-- Update existing bots to set organization_id from their location
UPDATE bots 
SET organization_id = l.organization_id
FROM locations l
WHERE bots.location_id = l.id 
  AND bots.organization_id IS NULL;

-- Create indexes for better dashboard performance
CREATE INDEX IF NOT EXISTS idx_services_stage ON services(stage);
CREATE INDEX IF NOT EXISTS idx_services_completed_at ON services(completed_at);
CREATE INDEX IF NOT EXISTS idx_services_org_stage ON services(organization_id, stage);
CREATE INDEX IF NOT EXISTS idx_bots_organization_id ON bots(organization_id);

-- Add helpful comments
COMMENT ON COLUMN services.stage IS 'Tracks the state of individual service sessions (for dashboard analytics)';
COMMENT ON COLUMN services.area_sqm IS 'Area serviced in square meters (for lawn/pool services)';
COMMENT ON COLUMN services.started_at IS 'When the current service session started';
COMMENT ON COLUMN services.completed_at IS 'When the service session was completed';

-- Fix the dashboard function to use correct service_type values
CREATE OR REPLACE FUNCTION get_service_activity_chart_data(org_id UUID, days_back INTEGER DEFAULT 30)
RETURNS TABLE (
  date DATE,
  mowing_area INTEGER,
  pool_cleaning_area INTEGER,
  services_count INTEGER
) AS $$
BEGIN
  RETURN QUERY
  WITH date_series AS (
    SELECT generate_series(
      CURRENT_DATE - days_back + 1,
      CURRENT_DATE,
      '1 day'::interval
    )::date as date
  )
  SELECT
    ds.date,
    COALESCE(SUM(s.area_sqm) FILTER (WHERE s.service_type = 'lawn' AND s.completed_at::date = ds.date), 0)::INTEGER as mowing_area,
    COALESCE(SUM(s.area_sqm) FILTER (WHERE s.service_type = 'pool' AND s.completed_at::date = ds.date), 0)::INTEGER as pool_cleaning_area,
    COUNT(s.id) FILTER (WHERE s.completed_at::date = ds.date)::INTEGER as services_count
  FROM date_series ds
  LEFT JOIN services s ON s.completed_at::date = ds.date
    AND s.organization_id = org_id
    AND s.stage = 'completed'
  GROUP BY ds.date
  ORDER BY ds.date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

