# Bot Data Tracking - Changes Summary

## What Was Fixed

### Issue
Frontend components were making direct database table queries instead of using secure Supabase RPC functions. This would fail due to Row Level Security (RLS) policies.

### Solution
Updated all frontend bot data components to use RPC functions with built-in permission checks.

## Files Changed

### Frontend Components (Fixed)

1. **`src/pages/services/service-bot-status.jsx`**
   - ✅ Changed from `get_service_bot_data()` to `get_location_bot_data()`
   - ✅ Fixed bug: Now gets `location_id` from service before fetching sensor history
   - ✅ Updated import: `@/lib/supabaseClient` → `@/lib/supabase`

2. **`src/pages/admin/bot-dashboard-page.jsx`**
   - ✅ Replaced all direct table queries with RPC function calls
   - ✅ Now uses `get_location_bot_data()` instead of querying tables directly
   - ✅ Updated import: `@/lib/supabaseClient` → `@/lib/supabase`

3. **`src/components/services/my-locations-bot-status.jsx`**
   - ✅ Already using RPC functions correctly
   - ✅ Updated import: `@/lib/supabaseClient` → `@/lib/supabase`

4. **`src/pages/locations/location-bot-status-page.jsx`**
   - ✅ Already using RPC functions correctly
   - ✅ Updated import: `@/lib/supabaseClient` → `@/lib/supabase`

### New Migration Files

5. **`supabase/migrations/20251021100003_bot_tracking_rls_policies.sql`** (NEW)
   - ✅ Enables Row Level Security on all bot tracking tables
   - ✅ Adds policies for admin full access
   - ✅ Adds policies for users to access their organization's bot data
   - ✅ Adds policies for service role to insert bot data

### Documentation

6. **`BOT_DATA_FRONTEND_GUIDE.md`** (NEW)
   - Complete guide on using the bot data tracking system
   - RPC function reference with examples
   - Security architecture explanation
   - Sensor data structure documentation

## How It Works Now

### Data Access Flow

```
Frontend Component
    ↓
RPC Function (with permission checks)
    ↓
Database Tables (protected by RLS)
    ↓
Returns filtered data to user
```

### Available RPC Functions

1. `get_my_locations_with_bots()` - Get all your locations with bot status
2. `get_location_bot_data(location_id)` - Get comprehensive bot data for a location
3. `get_service_bot_data(service_id)` - Get bot data for a service
4. `get_bot_sensor_history(location_id, hours_back)` - Get sensor history for graphs
5. `get_location_bot_statistics(location_id, days_back)` - Get daily statistics

### Security

- ✅ All bot tables have RLS enabled
- ✅ RPC functions use `SECURITY DEFINER` (bypass RLS with permission checks)
- ✅ Users can only access bot data for their organization's locations
- ✅ Admins have full access to all bot data
- ✅ Direct table queries are blocked for regular users

## Testing

1. **Apply migrations:**
   ```bash
   cd supabase
   supabase db push
   ```

2. **Test frontend:**
   - Navigate to `/portal/location/:locationId/bot-status`
   - Navigate to `/admin/bot/:botId` (admin only)
   - Check browser console for any errors

3. **Verify RPC functions:**
   ```sql
   SELECT routine_name 
   FROM information_schema.routines 
   WHERE routine_name LIKE 'get_%bot%';
   ```

## Benefits

✅ **Secure** - RLS policies prevent unauthorized access
✅ **Consistent** - All components use the same data access pattern
✅ **Maintainable** - Permission logic is centralized in RPC functions
✅ **Performant** - RPC functions return aggregated data in one query
✅ **Flexible** - JSONB fields allow bot-specific sensor data

## Next Steps

1. Apply the new migration: `supabase db push`
2. Test the frontend pages to ensure bot data loads correctly
3. Add real-time subscriptions if needed:
   ```javascript
   supabase
     .channel('bot-updates')
     .on('postgres_changes', {
       event: 'INSERT',
       schema: 'public',
       table: 'bot_sensor_readings',
       filter: `bot_id=eq.${botId}`
     }, (payload) => {
       // Handle new sensor data
     })
     .subscribe();
   ```

4. Implement bot API endpoints to insert sensor data using service role

## Questions or Issues?

Refer to:
- `BOT_DATA_FRONTEND_GUIDE.md` - Complete usage guide
- `supabase/migrations/20251021100002_bot_tracking_rpc_functions.sql` - RPC function definitions
- `supabase/migrations/20251021100003_bot_tracking_rls_policies.sql` - RLS policies


