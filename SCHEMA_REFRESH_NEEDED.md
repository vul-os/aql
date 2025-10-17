# Schema Refresh Needed

## Errors to Fix

### 1. Missing Loader2 Import (Frontend) ✅ FIXED
- Added `Loader2` to landing-page.jsx imports
- **Action Required:** Hard refresh browser (Ctrl+Shift+R)

### 2. Foreign Key Error (Database)
```
Could not find a relationship between 'organization_invitations' and 'organizations' in the schema cache
```

**Cause:** PostgREST schema cache is stale and doesn't recognize the new tables.

## Solutions

### Option 1: Reload PostgREST Schema (Quickest)
If you have access to Supabase dashboard:
1. Go to your Supabase project
2. **Settings** → **API**
3. Click **"Reload schema cache"** button
4. Wait 10 seconds
5. Refresh your browser

### Option 2: Restart Supabase (Local Development)
If running locally:
```bash
cd /home/imran/Documents/botkorp-mono
supabase stop
supabase start
```

### Option 3: Reapply Migrations
```bash
cd /home/imran/Documents/botkorp-mono
supabase db reset
```

This will:
- Drop and recreate all tables
- Apply all migrations in order
- Refresh the schema cache
- Fix the foreign key relationships

## After Fix

Once PostgREST recognizes the tables:
- ✅ Organization invitations will load
- ✅ Member invitations will work
- ✅ Foreign key queries will succeed

## Quick Test
After schema refresh, test this query in SQL editor:
```sql
SELECT * FROM organization_invitations 
LEFT JOIN organizations ON organization_invitations.organization_id = organizations.id 
LIMIT 5;
```

Should return results without error.

