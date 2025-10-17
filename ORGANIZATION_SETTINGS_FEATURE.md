# Organization Settings Feature

## Overview
Added a new "Organization" tab in the settings page that allows organization owners and admins to update their organization name.

## Changes Made

### 1. Database Migration
**File:** `supabase/migrations/20251017240000_update_organization_function.sql`

Created a new PostgreSQL function `update_organization` that:
- Validates user permissions (only owners and admins can update)
- Updates the organization name
- Automatically regenerates a unique slug from the new name
- Logs the activity in `activity_logs` table
- Returns success/error messages

### 2. Frontend Changes
**File:** `src/pages/settings/settings-page.jsx`

Added:
- New "Organization" tab in the settings page (positioned between Profile and Legal Profile tabs)
- State management for organization name and update status
- `handleOrganizationUpdate` function that calls the database RPC
- Permission-based UI that shows:
  - Editable form for owners/admins
  - Read-only notice for regular members
- Organization details display (subscription tier, status, role)
- Auto-reload after successful update to refresh the organization name throughout the app

## How to Use

### For Users
1. Navigate to **Settings** from the portal menu
2. Click on the **Organization** tab
3. If you're an owner or admin, you'll see:
   - Current organization information
   - Editable organization name field
   - Update button
4. Make your changes and click "Update Organization"
5. The page will reload to show the updated name everywhere

### For Regular Members
- Regular members will see a read-only view with a message that only owners/admins can update settings
- They can still view organization details like subscription tier and status

## Database Migration Instructions

To apply the migration to your Supabase instance:

### Option 1: Using Supabase CLI (Recommended)
```bash
cd supabase
supabase db push
```

### Option 2: Manual Application
1. Open your Supabase project dashboard
2. Go to the SQL Editor
3. Copy the contents of `supabase/migrations/20251017240000_update_organization_function.sql`
4. Paste and execute it in the SQL Editor

### Option 3: Using psql
```bash
psql <your-connection-string> -f supabase/migrations/20251017240000_update_organization_function.sql
```

## Security Features

1. **Permission Checks**: Function validates that only owners and admins can update organization details
2. **Member Verification**: Checks that the user is an active member of the organization
3. **Activity Logging**: All updates are logged in the `activity_logs` table with old and new values
4. **Unique Slug Generation**: Automatically ensures the organization slug remains unique

## Technical Details

### Database Function Signature
```sql
update_organization(
    p_user_id UUID,
    p_organization_id UUID,
    p_organization_name TEXT
)
```

### Return Type
```sql
RETURNS TABLE (
    organization_id UUID,
    organization_name TEXT,
    organization_slug TEXT,
    success BOOLEAN,
    message TEXT
)
```

### RPC Call from Frontend
```javascript
await supabase.rpc('update_organization', {
  p_user_id: user.id,
  p_organization_id: selectedOrg.organization_id,
  p_organization_name: organizationName.trim()
});
```

## Future Enhancements

Potential additions for the Organization tab:
- [ ] Organization description field
- [ ] Logo upload
- [ ] Subscription tier management
- [ ] Billing information
- [ ] Organization member management
- [ ] Organization settings (JSONB field)
- [ ] Organization deletion (soft delete)
- [ ] Transfer ownership feature

## Testing Checklist

- [ ] Owner can update organization name
- [ ] Admin can update organization name
- [ ] Regular member sees read-only view
- [ ] Non-member cannot access update function
- [ ] Empty names are rejected
- [ ] Slug is properly generated from new name
- [ ] Slug collision is handled (adds counter)
- [ ] Activity is logged correctly
- [ ] Page reloads to show updated name
- [ ] Toast notifications work correctly
- [ ] Form validation works
- [ ] Loading states work properly

