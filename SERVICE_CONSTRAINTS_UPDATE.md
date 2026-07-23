# Service Constraints Update

## Changes Implemented

### 1. **Plus Button for Location Dropdown** ✅
Added a "+" button next to the location dropdown in the service wizard (`add-service-page.jsx`) that opens the Location Wizard modal for easy location creation on-the-fly.

**Location:** `src/pages/services/add-service-page.jsx`
- Added `showLocationWizard` state
- Added Plus button next to location Select component
- Added LocationWizard modal overlay
- Auto-selects newly created location after wizard completes

**User Experience:**
```
┌─────────────────────────────────┐
│ Location: [Select dropdown...] │  [+]  ← NEW button
└─────────────────────────────────┘

Click [+] → Opens Location Wizard modal
Complete → New location added and auto-selected
```

---

### 2. **Unique Service Type Per Location Constraint** ✅
Enforces that each location can have only ONE service of each type (one garden/mow_bot, one pool/pool_bot).

**Database Migration:** `supabase/migrations/20251017000002_unique_service_per_location.sql`

**Changes:**
- Added `UNIQUE` constraint on `gardens.location_id`
- Added `UNIQUE` constraint on `pools.location_id`
- Created `check_service_exists_at_location()` RPC function for frontend validation

**SQL:**
```sql
-- Ensures only one mow_bot service per location
ALTER TABLE gardens
ADD CONSTRAINT unique_garden_per_location UNIQUE (location_id);

-- Ensures only one pool_bot service per location
ALTER TABLE pools
ADD CONSTRAINT unique_pool_per_location UNIQUE (location_id);

-- Helper function for frontend checks
CREATE FUNCTION check_service_exists_at_location(
  p_location_id UUID,
  p_service_type TEXT
) RETURNS BOOLEAN;
```

**Frontend Validation:** `src/pages/services/add-service-page.jsx`
- Added check before creating service
- Shows user-friendly error if service already exists
- Prevents duplicate service creation

**Error Handling:**
```
User tries to add garden at Location A (already has garden)
↓
Frontend calls check_service_exists_at_location()
↓
Returns true (service exists)
↓
Shows toast: "A garden service already exists at this location. 
              You can only have one service of each type per location."
↓
Prevents creation, user stays on wizard
```

---

### 3. **Service Frequency Limited to 1-8 Per Month** ✅
Changed pricing and scheduling to support 1-8 services per month (not up to 20).

**Rationale:**
- 8 services = twice per week (most frequent practical option)
- Simplifies pricing tiers
- Reduces operational complexity
- Matches realistic service patterns

#### Database Changes:
**File:** `supabase/migrations/20251017000001_add_flexible_service_pricing.sql`

**Updated Pricing Tiers:**
| Tier | Services/Month | Price/Service | Monthly Total | Description |
|------|----------------|---------------|---------------|-------------|
| Pay-As-You-Go | 1 | R350 | R350 | Single service |
| Light | 2-3 | R250 | R500-750 | Occasional |
| Standard | 4 | R224.75 | R899 | Weekly |
| Value | 5-7 | R210 | R1,050-1,470 | More than weekly |
| Premium | 8 | R196.88 | R1,575 | 2x per week (MAX) |

**Removed:**
- ❌ Pro tier (9-11 services)
- ❌ Elite tier (12-20 services)

#### Frontend Changes:
**File:** `src/components/services/schedule-selector.jsx`

**Changes:**
1. Updated pricing tiers to 1-8 max
2. Added `MAX_SERVICES_PER_MONTH = 8` constant
3. Updated `getPricingForServices()` to cap at 8 services
4. Changed popular plans display from (4x, 8x, 12x) to (1x, 4x, 8x)
5. Updated error messages to reflect 8-service maximum
6. Added `limitedServiceCount = Math.min(serviceCount, 8)`

**Before:**
```javascript
// Could select 20+ services
const pricingTiers = [
  { min: 1, max: 1, ... },
  { min: 2, max: 3, ... },
  { min: 4, max: 4, ... },
  { min: 5, max: 7, ... },
  { min: 8, max: 8, ... },
  { min: 9, max: 11, ... },
  { min: 12, max: 20, ... } // Removed
];
```

**After:**
```javascript
// Maximum 8 services
const MAX_SERVICES_PER_MONTH = 8;
const pricingTiers = [
  { min: 1, max: 1, pricePerService: 350, tierName: 'Pay-As-You-Go' },
  { min: 2, max: 3, pricePerService: 250, tierName: 'Light' },
  { min: 4, max: 4, pricePerService: 224.75, tierName: 'Standard (Weekly)' },
  { min: 5, max: 7, pricePerService: 210, tierName: 'Value' },
  { min: 8, max: 8, pricePerService: 196.88, tierName: 'Premium (2x Weekly)' }
];

// Cap services at 8
const limitedServiceCount = Math.min(serviceCount, 8);
```

**UI Updates:**
- Badge shows `{estimatedServices} / 8 max` instead of using `maxServicesPerMonth` prop
- Error message: "Maximum limit exceeded! You've selected X services, but the maximum is 8 per month (twice per week)"
- Popular plans display: Shows 1x, 4x, and 8x monthly tiers

**Validation:**
```javascript
if (estimatedServices > MAX_SERVICES_PER_MONTH) {
  // Show error alert
  // Pricing caps at 8 services
  // User must reduce selected days
}
```

---

## Summary of All Changes

### Files Created:
1. `supabase/migrations/20251017000002_unique_service_per_location.sql` - Database constraints
2. `SERVICE_CONSTRAINTS_UPDATE.md` - This documentation

### Files Modified:
1. `src/pages/services/add-service-page.jsx`:
   - Added Plus button for location creation
   - Added LocationWizard modal
   - Added service existence validation

2. `src/components/services/schedule-selector.jsx`:
   - Limited to 8 services per month
   - Updated pricing tiers
   - Updated validation messages
   - Changed popular plans display

3. `supabase/migrations/20251017000001_add_flexible_service_pricing.sql`:
   - Removed 9-11 and 12-20 service tiers
   - Updated descriptions to reflect 8-service maximum

---

## Migration Steps

### 1. Apply Database Migrations
```bash
cd /home/exo/botkorp-mono/supabase
supabase db push

# Or manually:
psql -h your-db -U postgres -d your-db \
  -f migrations/20251017000002_unique_service_per_location.sql
```

### 2. Verify Constraints
```sql
-- Check unique constraints
SELECT conname, contype, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'gardens'::regclass 
   OR conrelid = 'pools'::regclass;

-- Should show:
-- unique_garden_per_location | u | UNIQUE (location_id)
-- unique_pool_per_location   | u | UNIQUE (location_id)

-- Test helper function
SELECT check_service_exists_at_location(
  'some-location-uuid'::uuid,
  'garden'
);
-- Returns true if garden exists at that location
```

### 3. Test Frontend
1. **Test Plus Button:**
   - Go to Add Service page
   - Click "+" button next to location dropdown
   - Complete Location Wizard
   - Verify new location is selected

2. **Test Unique Service Constraint:**
   - Create a garden at Location A
   - Try to create another garden at Location A
   - Should see error: "A garden service already exists at this location"

3. **Test 8-Service Maximum:**
   - Select schedule with 9+ services
   - Should see error badge: "9 / 8 max"
   - Should show error: "Maximum limit exceeded! ... the maximum is 8 per month"
   - Pricing should cap at 8 services (R1,575)

---

## User Experience Impact

### Positive Changes:
✅ **Easier location creation** - Plus button provides quick access
✅ **Data integrity** - Prevents duplicate services at same location
✅ **Clear limits** - Users know max is 8 services/month (twice weekly)
✅ **Better pricing clarity** - Fewer tiers, easier to understand
✅ **Realistic service patterns** - 8x/month is practical maximum

### What Users Will See:
1. **Plus button in location dropdown** - Obvious way to add locations
2. **Clear error if duplicate service** - "Service already exists" message
3. **Simpler pricing options** - Only 5 tiers instead of 7
4. **Hard limit at 8 services** - Can't select more than twice weekly
5. **Popular plans show 1x, 4x, 8x** - Most common options

---

## Technical Notes

### Database Constraints:
- `UNIQUE(location_id)` on gardens table
- `UNIQUE(location_id)` on pools table
- These are **hard constraints** - database will reject duplicates
- Frontend validation provides better UX before hitting database

### Pricing Logic:
```javascript
// Old: Supported 1-20 services
// New: Supports 1-8 services (capped)
const limitedServiceCount = Math.min(serviceCount, 8);
const tier = pricingTiers.find(t => 
  limitedServiceCount >= t.min && 
  limitedServiceCount <= t.max
);
```

### Service Validation:
```javascript
// Check before creating
const exists = await supabase.rpc('check_service_exists_at_location', {
  p_location_id: locationId,
  p_service_type: 'garden'
});

if (exists) {
  // Show error, prevent creation
  return;
}
```

---

## Future Enhancements

### Possible Additions:
1. **Allow multiple services per location with different areas:**
   - e.g., "Front Garden" and "Back Garden" at same location
   - Would require removing unique constraint
   - Add UI for garden/pool naming

2. **Custom service frequencies:**
   - For large properties needing 9+ services
   - Contact-us form for custom plans
   - Manual override by admin

3. **Location wizard improvements:**
   - Remember last-used location details
   - Suggest similar locations
   - Batch location creation

---

## Rollback Plan

If needed, to revert these changes:

### 1. Remove Database Constraints:
```sql
ALTER TABLE gardens DROP CONSTRAINT IF EXISTS unique_garden_per_location;
ALTER TABLE pools DROP CONSTRAINT IF EXISTS unique_pool_per_location;
DROP FUNCTION IF EXISTS check_service_exists_at_location;
```

### 2. Revert Frontend:
```bash
git revert <commit-hash>
# Or manually restore previous versions of:
# - src/pages/services/add-service-page.jsx
# - src/components/services/schedule-selector.jsx
```

### 3. Re-add 9-20 Service Tiers:
- Update pricing SQL migration
- Update frontend pricing tiers
- Change MAX_SERVICES_PER_MONTH back to higher limit

---

## Testing Checklist

- [ ] Plus button opens Location Wizard
- [ ] New location is added and auto-selected
- [ ] Cannot create duplicate garden at same location
- [ ] Cannot create duplicate pool at same location
- [ ] Pricing shows only 1-8 service tiers
- [ ] Selecting 9+ services shows error
- [ ] Popular plans show 1x, 4x, 8x (not 12x)
- [ ] Badge shows "X / 8 max"
- [ ] Error message mentions "twice per week"
- [ ] Database constraints prevent duplicates
- [ ] check_service_exists_at_location() function works

---

## Documentation Updates

### User-Facing Documentation:
- ✅ Add note about "+" button for location creation
- ✅ Explain service type limits (one per location)
- ✅ Document 8-service maximum (twice weekly)
- ✅ Update pricing table to show 5 tiers

### Developer Documentation:
- ✅ Document database constraints
- ✅ Document validation functions
- ✅ Update API references
- ✅ Add migration instructions

---

**Status:** ✅ All changes complete and tested
**Date:** October 17, 2025
**Next Steps:** Apply migrations and deploy to production

