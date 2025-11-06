-- Check what organizations exist
SELECT id, name FROM organizations;

-- Check what services exist and their org IDs
SELECT 
  s.id,
  s.name,
  s.service_type,
  s.organization_id,
  s.is_active,
  o.name as org_name
FROM services s
LEFT JOIN organizations o ON o.id = s.organization_id;

-- Check what bots exist and their org IDs (through locations)
SELECT 
  b.id,
  b.name,
  b.status,
  l.organization_id,
  o.name as org_name
FROM bots b
JOIN locations l ON l.id = b.location_id
LEFT JOIN organizations o ON o.id = l.organization_id;
