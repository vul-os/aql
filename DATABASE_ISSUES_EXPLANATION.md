# Database Issues & Explanations

## Issue 1: service_schedules.service_id Column Does Not Exist

### The Error
```json
{
    "code": "42703",
    "details": null,
    "hint": null,
    "message": "column service_schedules.service_id does not exist"
}
```

### Root Cause
The code is trying to query `service_schedules` table with a `service_id` column, but this column doesn't exist in your current database schema.

### Affected Files
1. `src/pages/services/add-service-page.jsx` - Line 401
2. `src/pages/services/service-detail-page.jsx` - Lines 127-130
3. `src/pages/services/schedules-page.jsx` - Multiple queries

### Solution Options

#### Option 1: The `service_schedules` table doesn't exist (most likely)
The table may have been removed or never created. Check your migrations:

```bash
# Search for service_schedules table creation
grep -r "CREATE TABLE service_schedules" supabase/migrations/
```

**If not found**, you need to create it or remove all references to it from the code.

#### Option 2: Column was renamed
The column might be named differently (e.g., `services_id`, `service_fk`, etc.)

**Action**: Check your actual table schema in Supabase dashboard or run:
```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'service_schedules';
```

#### Option 3: Using Wrong Table
You might need to use the `services` table directly instead of `service_schedules`.

### Recommended Fix
Based on your schema (SCHEMA.md doesn't mention `service_schedules`), you should either:

1. **Remove all `service_schedules` code** - The functionality might be handled differently now
2. **Create the missing table** - If you need this functionality, create a migration:

```sql
CREATE TABLE service_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id UUID REFERENCES services(id) ON DELETE CASCADE,
    schedule_type TEXT,
    weekly_days INTEGER[],
    monthly_day INTEGER,
    time_of_day TIME,
    is_active BOOLEAN DEFAULT true,
    is_paused BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Issue 2: Service Shows "Pending" When is_active is TRUE

### Your Service Data
```json
{
    "status": "pending_setup",
    "is_active": true,
    "installation_completed_date": "2025-10-17T21:54:02.966+00:00"
}
```

### Why This Happens
The `status` field and `is_active` field serve **different purposes**:

| Field | Purpose | Your Value |
|-------|---------|------------|
| `status` | Service lifecycle stage | `"pending_setup"` |
| `is_active` | Soft delete / enabled flag | `true` |

### Status Field Values
The `status` field represents the service's current lifecycle stage:

1. **`pending_setup`** - Service created but setup not complete
2. **`pending_installation`** - Setup done, awaiting installation
3. **`installation_scheduled`** - Installation date set
4. **`installing`** - Installation in progress
5. **`active`** - Fully operational
6. **`cancelled`** - Service terminated

### is_active Field
The `is_active` field is a simple enabled/disabled toggle:
- `true` = Service record is "alive" (not soft-deleted)
- `false` = Service record is disabled/archived

### Your Case
Your service shows as "Pending" because:
- ✅ `is_active: true` - The service record is enabled
- ⚠️ `status: "pending_setup"` - The service hasn't been fully set up yet

Even though installation was "completed" on `2025-10-17T21:54:02.966`, the status was never updated to `"active"`.

### How to Fix

#### Option 1: Update the Status Manually (Quick Fix)
```sql
UPDATE services 
SET status = 'active' 
WHERE id = '08b6b031-016e-46f5-8dac-f739ea1a8c5a';
```

#### Option 2: Fix the Code Logic
Update your service completion handler to set status to 'active':

```javascript
// In your installation completion code
await supabase
  .from('services')
  .update({ 
    status: 'active',  // ← Add this
    installation_completed_date: new Date().toISOString()
  })
  .eq('id', serviceId);
```

#### Option 3: Add Auto-Status Update
Create a database trigger to automatically set status to 'active' when installation is completed:

```sql
CREATE OR REPLACE FUNCTION update_service_status_on_installation()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.installation_completed_date IS NOT NULL 
       AND OLD.installation_completed_date IS NULL 
       AND NEW.status = 'pending_setup' THEN
        NEW.status := 'active';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_service_status
    BEFORE UPDATE ON services
    FOR EACH ROW
    EXECUTE FUNCTION update_service_status_on_installation();
```

### Expected Behavior Flow

```
1. Service Created
   ↓
   status: "pending_setup"
   is_active: true

2. Installation Scheduled
   ↓
   status: "installation_scheduled"
   is_active: true

3. Installation Completed
   ↓
   status: "active"  ← Should update here
   is_active: true
```

---

## Quick Action Items

### For service_schedules Error
1. Run: `SELECT * FROM information_schema.tables WHERE table_name = 'service_schedules';`
2. If exists: Check column names
3. If not exists: Remove all code references or create the table

### For Status Issue
1. Update your service to active:
   ```sql
   UPDATE services SET status = 'active' 
   WHERE id = '08b6b031-016e-46f5-8dac-f739ea1a8c5a';
   ```

2. Fix the installation completion logic to update status

---

## Files to Check/Update

1. **Remove service_schedules references:**
   - `src/pages/services/add-service-page.jsx`
   - `src/pages/services/service-detail-page.jsx`
   - `src/pages/services/schedules-page.jsx`

2. **Fix status update logic:**
   - Look for where `installation_completed_date` is set
   - Add `status: 'active'` to that update

---

Last Updated: October 17, 2025

