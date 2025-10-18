# Legal Profile Migration Summary

## Overview
Successfully separated legal profile from user profiles and attached it to organizations.

## What Changed

### 1. Database Changes (3 Migrations)

#### Migration 1: `20251018000000_organization_legal_profiles.sql`
- **Created** `organization_legal_profiles` table with:
  - `organization_id` (FK to organizations)
  - Legal fields: `first_name`, `surname`, `id_number`, `physical_address`, `physical_city`, `physical_province`, `physical_postal_code`, `cell_phone`
  - Status field: `legal_profile_completed`, `legal_profile_completed_at`
  - Audit fields: `created_by`, `updated_by`, `created_at`, `updated_at`
- **Migrated** existing legal profile data from `profiles` to `organization_legal_profiles`
- **Added** indexes and constraints

#### Migration 2: `20251018000001_update_legal_profile_functions.sql`
- **Dropped** old functions: `is_legal_profile_complete()`, `update_legal_profile()`
- **Created** new functions:
  - `is_org_legal_profile_complete(p_organization_id)` - Check if org legal profile is complete
  - `update_org_legal_profile(p_organization_id, p_user_id, ...)` - Update/create org legal profile
  - `get_org_legal_profile(p_organization_id)` - Get org legal profile

#### Migration 3: `20251018000002_remove_legal_fields_from_profiles.sql`
- **Removed** legal profile fields from `profiles` table:
  - `first_name`, `surname`, `id_number`
  - `physical_address`, `physical_city`, `physical_province`, `physical_postal_code`
  - `cell_phone`
  - `legal_profile_completed`, `legal_profile_completed_at`
- **Dropped** related indexes and triggers

### 2. Backend Python Changes

#### Files Updated:
- `backend/main.py`
- `backend/templates/agreement.py`
- `api/pdf_service/main.py` (if used)
- `api/pdf_service/templates/agreement.py` (if used)

#### Key Changes:
1. **Added** `fetch_org_legal_profile(organization_id)` function
2. **Updated** `create_rental_agreements()` endpoint to:
   - Fetch organization legal profile instead of user profile
   - Pass `legal_profile` instead of `profile` to functions
3. **Updated** `create_rental_agreement()` function signature:
   - Changed parameter from `profile` to `legal_profile`
   - Updated all field references
4. **Updated** `render_agreement_template()` function:
   - Changed parameter from `profile` to `legal_profile`
   - Updated template context
5. **Updated** agreement templates:
   - Changed all `{{ profile.* }}` to `{{ legal_profile.* }}`

### 3. Frontend Changes

#### Files Updated:
- `src/pages/settings/settings-page.jsx`
- `src/components/services/legal-profile-wizard.jsx`
- `src/pages/dashboard/dashboard-page.jsx`

#### Settings Page (`settings-page.jsx`)
- **Updated** `loadLegalProfile()` to:
  - Query `organization_legal_profiles` table instead of `profiles`
  - Filter by `organization_id` instead of `user.id`
  - Load data when `selectedOrg` changes

#### Legal Profile Wizard (`legal-profile-wizard.jsx`)
- **Added** `organizationId` prop (required)
- **Updated** to:
  - Load organization legal profile instead of user profile
  - Call `update_org_legal_profile()` RPC function instead of `update_legal_profile()`
  - Pass both `p_organization_id` and `p_user_id` to RPC function

#### Dashboard Page (`dashboard-page.jsx`)
- **Updated** to:
  - Load organization legal profile to check completion status
  - Pass `organizationId` prop to `LegalProfileWizard`
  - Check `orgLegalProfile.legal_profile_completed` instead of `profile.legal_profile_completed`

## Database Schema

### New Table: `organization_legal_profiles`

```sql
CREATE TABLE organization_legal_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Legal fields
    first_name TEXT,
    surname TEXT,
    id_number TEXT,
    physical_address TEXT,
    physical_city TEXT,
    physical_province TEXT,
    physical_postal_code TEXT,
    cell_phone TEXT,
    legal_profile_completed BOOLEAN DEFAULT false,
    legal_profile_completed_at TIMESTAMPTZ,
    
    -- Audit fields
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT unique_org_legal_profile UNIQUE (organization_id)
);
```

## API Changes

### RPC Functions

#### Old (Deprecated):
- `update_legal_profile(p_user_id, ...)`
- `is_legal_profile_complete(p_user_id)`

#### New:
- `update_org_legal_profile(p_organization_id, p_user_id, ...)`
- `is_org_legal_profile_complete(p_organization_id)`
- `get_org_legal_profile(p_organization_id)`

### Backend Endpoints

No endpoint URLs changed, but the implementation now:
- Fetches legal profile from `organization_legal_profiles` table
- Uses organization ID instead of user ID for legal profile lookups

## Migration Steps for Running This

### 1. Apply Database Migrations
```bash
cd supabase/migrations

# Apply migrations in order
psql -f 20251018000000_organization_legal_profiles.sql
psql -f 20251018000001_update_legal_profile_functions.sql
psql -f 20251018000002_remove_legal_fields_from_profiles.sql
```

Or if using Supabase CLI:
```bash
supabase db push
```

### 2. Deploy Backend
```bash
cd backend
./deploy.sh
```

### 3. Deploy Frontend
```bash
npm run build
# Deploy to your hosting (Firebase, Vercel, etc.)
```

## Breaking Changes

⚠️ **Important**: This is a breaking change if you have:
1. Frontend code that directly queries legal profile fields from `profiles` table
2. Custom SQL queries that join on legal profile fields in `profiles`
3. Any code calling the old RPC functions `update_legal_profile()` or `is_legal_profile_complete()`

## Data Migration

✅ **Automatic**: The migration automatically copies existing legal profile data from `profiles` to `organization_legal_profiles` for:
- Users who have an `organization_id`
- Users who have completed their legal profile
- Takes the most recent data if multiple users from same organization have legal profiles

## Testing Checklist

- [ ] Legal profile loads correctly in Settings page
- [ ] Legal profile wizard works when creating new service
- [ ] Rental agreement PDFs show correct legal information
- [ ] Legal profile can be updated (only once created)
- [ ] Organizations without legal profile show incomplete state
- [ ] Dashboard shows legal profile wizard when needed

## Benefits

1. **One Legal Profile Per Organization**: Avoid duplicate legal data for multiple users in same org
2. **Better Data Model**: Legal information belongs to the organization, not individual users
3. **Simpler Contracts**: Organization signs contracts, not individual users
4. **Cleaner User Profiles**: User profile table is simpler, focused on user-specific data
5. **Audit Trail**: Track who created/updated organization legal profile

## Notes

- The `profiles` table still contains basic user info (`email`, `full_name`, `phone`, etc.)
- Legal profile is now organization-scoped, requiring one per organization
- Multiple users in an organization share the same legal profile
- Organization owner/admin can update the legal profile

