-- Test the dashboard analytics function
-- Run this to see what data is being returned

-- First, find your organization ID
SELECT id, name FROM organizations LIMIT 5;

-- Then test the function (replace 'your-org-id' with actual ID from above)
-- SELECT get_dashboard_analytics_v2('your-org-id');

-- Also check if services exist
SELECT 
  id,
  organization_id,
  name,
  service_type,
  status,
  is_active
FROM services
WHERE is_active = true
LIMIT 10;

-- Check bots
SELECT 
  b.id,
  b.name,
  b.status,
  b.is_enabled,
  l.organization_id
FROM bots b
JOIN locations l ON l.id = b.location_id
LIMIT 10;

