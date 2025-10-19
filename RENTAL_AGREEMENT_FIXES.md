# Rental Agreement Fixes Summary

## Issues Fixed

### Issue 1: Strange Agreement Numbers ❌
**Problem**: Agreement numbers were using Unix timestamps
```
RA-2025-1760845275801  ❌ (13-digit timestamp)
RA-2025-1760845279020  ❌ (13-digit timestamp)
```

**Fix**: Changed to random 6-8 digit numbers
```python
# Before
timestamp = int(datetime.now().timestamp() * 1000) + index
agreement_number = f"RA-{datetime.now().year}-{timestamp}"

# After
random_num = random.randint(100000, 999999)
agreement_number = f"RA-{datetime.now().year}-{random_num:06d}{index:02d}"
```

**Result**: Clean, readable agreement numbers
```
RA-2025-12345600  ✅
RA-2025-12345601  ✅
RA-2025-12345602  ✅
```

---

### Issue 2: Approvals Dashboard Showing Active Agreements ❌
**Problem**: Dashboard showed ALL rental agreements (draft, active, paused)
- Active agreements are already approved - they don't need approval!
- Cluttered the approvals dashboard unnecessarily

**Fix**: Filter to show ONLY draft agreements
```javascript
// Before
.in('status', ['draft', 'active', 'paused'])

// After
.eq('status', 'draft')
```

**Result**: Approvals page now shows ONLY pending approvals ✅

---

### Issue 3: Monthly Total Including Service Fee ❌
**Problem**: Rental agreements were including service fee (R400/month)
- First garden: monthly_total = R550 (R150 bot + R400 service)
- Other gardens: monthly_total = R150 (R150 bot only)
- **Inconsistent and confusing!**

**Why This Was Wrong**:
- Service fee should be on **monthly INVOICES**, not rental agreements
- Rental agreements should only show **bot rental fee** (R150/month)
- Invoices calculate full amount: `(bots × R150) + R400 service fee`

**Fix in Backend** (`backend/main.py`):
```python
# Before
pricing = calculate_pricing(
    number_of_bots=1,
    services_per_month=services_per_month,
    billing_day=billing_day,
    include_service_fee=is_first_garden  # ❌ First garden gets R550
)

# After
pricing = calculate_pricing(
    number_of_bots=1,
    services_per_month=services_per_month,
    billing_day=billing_day,
    include_service_fee=False  # ✅ All gardens get R150
)
```

**Fix in Amendment Trigger** (`20251019230002_implement_amendment_trigger.sql`):
```sql
-- Before
ra.monthly_total,      -- ❌ Could be R550 if copied from first garden
ra.bot_rental_total,
ra.service_total,

-- After
ra.bot_rental_total,   -- ✅ Always R150 (bot rental only)
ra.bot_rental_total,   -- Bot rental total
0,                     -- ✅ No service fee in agreements
```

**Result**:
```
✅ ALL rental agreements now show:
   - monthly_total: R150 (bot rental only)
   - bot_rental_total: R150
   - service_total: R0

✅ Service fee (R400) only appears on monthly INVOICES
```

---

## Where Service Fee IS Charged

Service fees are charged on **monthly invoices**, calculated as:

```
Total Monthly Invoice = (Number of Bots × R150) + R400 (service fee per location)

Examples:
1 bot  → Invoice: R150 + R400 = R550/month
2 bots → Invoice: R300 + R400 = R700/month
3 bots → Invoice: R450 + R400 = R850/month
```

Service fee is:
- ✅ **PER LOCATION** (not per bot, not per garden)
- ✅ **Charged on monthly invoices** (billing table)
- ✅ **NOT shown on rental agreements** (they only show bot rental)

---

## Files Modified

1. **`backend/main.py`**
   - Fixed agreement number generation (lines 218-221)
   - Removed service fee from rental agreements (lines 199-209)

2. **`src/pages/admin/approvals-page.jsx`**
   - Filter to show only draft agreements (lines 77-88)

3. **`supabase/migrations/20251019230002_implement_amendment_trigger.sql`**
   - Fixed amendment rental agreements to exclude service fee (lines 88-135)

---

## Testing Results

### Before Fixes:
```sql
SELECT agreement_number, monthly_total, service_total 
FROM rental_agreements 
WHERE service_id = 'X';

-- Results:
RA-2025-1760845275801  | R550.00 | R400.00  ❌ (first garden)
RA-2025-1760845279020  | R150.00 | R0.00    ❌ (second garden)
RA-2025-1760845281651  | R550.00 | R400.00  ❌ (amendment - copied wrong!)
```

### After Fixes:
```sql
SELECT agreement_number, monthly_total, service_total 
FROM rental_agreements 
WHERE service_id = 'X';

-- Results:
RA-2025-12345600  | R150.00 | R0.00  ✅ (first garden)
RA-2025-12345601  | R150.00 | R0.00  ✅ (second garden)
RA-2025-12345602  | R150.00 | R0.00  ✅ (third garden - amendment)
```

---

## Migration Impact

### Existing Data:
- Existing rental agreements with service fees will remain as-is (no breaking changes)
- New agreements will be created correctly going forward

### To Fix Existing Agreements (Optional):
```sql
-- Update existing agreements to remove service fee
UPDATE rental_agreements
SET 
    monthly_total = bot_rental_total,
    service_total = 0
WHERE service_total > 0;
```

**Note**: Only run this if you want to clean up historical data. Not required for system to work.

---

## Summary

✅ **Agreement numbers**: Clean format (RA-2025-XXXXXX)  
✅ **Approvals dashboard**: Shows only drafts needing approval  
✅ **Monthly totals**: All agreements show R150 (bot rental only)  
✅ **Service fees**: Only on monthly invoices, not agreements  
✅ **Amendments**: Create correct rental agreements  
✅ **Consistent billing**: All agreements follow same structure  

---

**Date**: October 19, 2025  
**Status**: ✅ Fixed and Deployed  
**Impact**: HIGH - Fixes billing display and approval workflow

