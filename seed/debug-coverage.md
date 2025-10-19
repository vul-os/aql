# Coverage Check Debug Guide

## Testing Location
**Coordinates:** -29.916304, 30.966505 (Montclair area, Durban)

## Common Issues & Solutions

### Issue 1: No Coverage Areas in Database
**Symptom:** Queries return 0 rows

**Solution:**
```bash
# Upload the coverage areas
python3 upload-coverage.py
```

### Issue 2: PostGIS Extension Not Enabled
**Symptom:** Error about ST_Contains or other ST_* functions

**Solution:**
```sql
-- Run this migration
CREATE EXTENSION IF NOT EXISTS postgis;
```

### Issue 3: Geometry Column Not Populated
**Symptom:** `boundary_geometry IS NULL`

**Check:**
```sql
SELECT 
    area_name,
    boundary_geojson IS NOT NULL as has_geojson,
    boundary_geometry IS NOT NULL as has_geometry
FROM coverage_areas;
```

**Solution:**
```sql
-- Manually trigger geometry creation
UPDATE coverage_areas 
SET boundary_geometry = ST_GeomFromGeoJSON(boundary_geojson::TEXT)
WHERE boundary_geojson IS NOT NULL;
```

### Issue 4: Incorrect Coordinate Order
**Note:** PostGIS uses (LONGITUDE, LATITUDE) - not (LAT, LON)

**Wrong:**
```sql
ST_MakePoint(-29.916304, 30.966505)  -- ❌ Wrong order
```

**Correct:**
```sql
ST_MakePoint(30.966505, -29.916304)  -- ✅ Correct (lon, lat)
```

### Issue 5: RLS (Row Level Security) Blocking Queries
**Symptom:** Queries return empty even though data exists

**Check:**
```sql
-- Check if RLS is enabled
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE tablename = 'coverage_areas';
```

**Solution:** Already handled in migration `20251012000005_disable_rls.sql`

## Quick Test Queries

### Simplest Test (No functions)
```sql
SELECT COUNT(*) FROM coverage_areas WHERE is_active = true;
```

### Test Point Inside Montclair
```sql
SELECT 
    area_name,
    ST_Contains(
        boundary_geometry,
        ST_SetSRID(ST_MakePoint(30.966505, -29.916304), 4326)
    ) as is_inside
FROM coverage_areas
WHERE area_name = 'Montclair 1';
```

### Visual Check (Export as GeoJSON)
```sql
SELECT 
    area_name,
    ST_AsGeoJSON(boundary_geometry) as geometry
FROM coverage_areas
WHERE area_name = 'Montclair 1';
```

## Frontend Debug

### Check Browser Console
```javascript
// In browser console
const { data, error } = await supabase.rpc('is_point_in_coverage', {
  p_latitude: -29.916304,
  p_longitude: 30.966505,
  p_buffer_km: 2.0
});

console.log('Coverage check result:', data);
console.log('Error:', error);
```

### Test Raw SQL
```javascript
// In browser console
const { data, error } = await supabase
  .from('coverage_areas')
  .select('*')
  .eq('is_active', true);

console.log('Coverage areas:', data);
```

## Expected Result for Test Location

For coordinates **-29.916304, 30.966505** (Montclair):

```json
{
  "coverage_id": "...",
  "area_name": "Montclair 1",
  "city": "Montclair",
  "province": "KwaZulu-Natal",
  "is_inside": true,
  "distance_from_boundary_km": 0.00
}
```

## Migration Checklist

Run these migrations in order:
1. ✅ `20251012000000_complete_schema.sql` - Creates tables
2. ✅ `20251012000005_disable_rls.sql` - Disables RLS
3. ✅ `20251012000006_enable_postgis_coverage.sql` - Enables PostGIS

Then run:
```bash
python3 upload-coverage.py
```

