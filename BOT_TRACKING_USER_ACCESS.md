# 🔐 Bot Tracking - User Access & Security

## How Users Access Bot Data

In your system, **users don't interact with "bots" directly**. They interact with:
- **🌱 Gardens/Locations** - Their property where the bot works
- **📋 Services** - Lawn mowing, pool cleaning services
- **🏊 Pools** - Pool cleaning services

The bot is the underlying hardware, but users see it as "my garden's status" or "my pool service."

---

## Security Model (RLS)

All bot data access goes through **RPC functions** with **Row Level Security (RLS)**:

```
User → Frontend → RPC Function → Security Check → Bot Data
                      ↓
               Checks if user owns
               this location/service
```

---

## RPC Functions Created

### 1. `get_location_bot_data(location_id)`
Get bot data for a specific garden/pool.

**Access Control:** User must own the location (same organization) OR be admin.

**Returns:**
- Bot info (name, type, status)
- Latest sensor reading
- Recent events (last 20)
- Location trail (last 100 GPS points)
- Today's statistics

**Frontend Usage:**
```javascript
const { data } = await supabase
  .rpc('get_location_bot_data', { 
    location_id_input: locationId 
  });
```

### 2. `get_service_bot_data(service_id)`
Get bot data in the context of a service record.

**Access Control:** User must own the service's location OR be admin.

**Frontend Usage:**
```javascript
const { data } = await supabase
  .rpc('get_service_bot_data', { 
    service_id_input: serviceId 
  });
```

### 3. `get_bot_sensor_history(location_id, hours_back)`
Get sensor history for graphs (temperature, battery, etc. over time).

**Parameters:**
- `location_id`: UUID of the location
- `hours_back`: Number of hours (default: 24)

**Frontend Usage:**
```javascript
const { data } = await supabase
  .rpc('get_bot_sensor_history', { 
    location_id_input: locationId,
    hours_back: 24 
  });
```

### 4. `get_location_bot_statistics(location_id, days_back)`
Get daily statistics summary.

**Parameters:**
- `location_id`: UUID of the location
- `days_back`: Number of days (default: 7)

**Returns:** Array of daily stats (runtime, distance, battery, errors)

### 5. `get_my_locations_with_bots()`
Get all user's locations with current bot status (dashboard view).

**Returns:** All locations owned by user's organization with:
- Location name and address
- Bot name, type, status
- Current battery level
- Current temperature
- Last online time

**Frontend Usage:**
```javascript
const { data } = await supabase.rpc('get_my_locations_with_bots');
// Returns array of all user's locations
```

---

## Frontend Components

### 1. **My Locations Dashboard** ✅
**Component:** `/src/components/services/my-locations-bot-status.jsx`

Shows all user's locations with bot status cards:
- Location name
- Bot status (online/offline/charging)
- Battery level
- Temperature
- "View Details" button

**Use in:** Dashboard page or Services page

```jsx
import MyLocationsBotStatus from '@/components/services/my-locations-bot-status';

function DashboardPage() {
  return (
    <div>
      <h1>My Locations</h1>
      <MyLocationsBotStatus />
    </div>
  );
}
```

### 2. **Location Bot Status Page** ✅
**Component:** `/src/pages/locations/location-bot-status-page.jsx`

Full bot status page for a specific garden/pool with tabs:
- **Current Status:** Real-time sensor data, battery, temperature
- **Activity History:** Recent events timeline
- **Statistics:** Weekly performance stats

**Route:** `/portal/location/:locationId/bot-status`

### 3. **Service Bot Status** ✅
**Component:** `/src/pages/services/service-bot-status.jsx`

Bot status in the context of a service record.

**Route:** `/portal/service/:serviceId/bot-status`

---

## User Flow Examples

### Scenario 1: User Wants to Check Their Garden
```
1. User logs in → Dashboard
2. Sees card: "My Garden" with bot status
3. Clicks "View Details"
4. Goes to: /portal/location/{location-id}/bot-status
5. Sees:
   - Battery: 85%
   - Temperature: 28°C
   - Status: Active, mowing
   - Recent events: "Started mowing 2 hours ago"
   - Map showing where bot has mowed
```

### Scenario 2: User Checks Service Progress
```
1. User goes to Services page
2. Clicks on "Lawn Mowing Service"
3. Tab options: Details | Bot Status | Invoice
4. Clicks "Bot Status" tab
5. Goes to: /portal/service/{service-id}/bot-status
6. Sees current activity for this specific service
```

### Scenario 3: Admin Views All Bots
```
1. Admin logs in
2. Goes to: /admin/bot-management
3. Sees list of ALL bots (bypasses RLS)
4. Clicks bot → /admin/bot/{bot-id}
5. Sees detailed technical dashboard (direct bot access)
```

---

## Database Flow

### Regular User Accessing Location Bot Data
```
Frontend
  ↓ calls
get_location_bot_data(location_id)
  ↓ checks
Is user's organization == location's organization?
  ↓ YES
locations → bots → bot_sensor_readings
                 → bot_events
                 → bot_location_history
                 → bot_daily_statistics
  ↓ returns
Bot data (secure, only their data)
```

### Direct Bot Access (Admin Only)
```
Admin Frontend
  ↓ direct query
bots table (bypasses RPC)
  ↓ no RLS restriction
All bot data visible
  ↓ admin dashboard
/admin/bot/{bot-id}
```

---

## Routes Summary

### User Routes (RLS Protected via RPC)
| Route | Purpose | RPC Function |
|-------|---------|--------------|
| `/portal/location/:locationId/bot-status` | View garden/pool bot status | `get_location_bot_data` |
| `/portal/service/:serviceId/bot-status` | View service bot status | `get_service_bot_data` |
| Dashboard with locations component | All my locations overview | `get_my_locations_with_bots` |

### Admin Routes (Direct Access)
| Route | Purpose |
|-------|---------|
| `/admin/bot/:botId` | Technical bot dashboard (direct query) |
| `/admin/bot-management` | Manage all bots |

---

## Integration Steps

### Step 1: Apply Both Migrations
```bash
cd /home/exo/botkorp-mono
npx supabase db reset
# This runs both migrations:
# - 20251021100001_bot_data_tracking_system.sql (tables)
# - 20251021100002_bot_tracking_rpc_functions.sql (RPC functions)
```

### Step 2: Generate Test Data
```bash
cd backend
python tests/test_bot_sensor_data.py
```
This creates:
- Test bot with location
- 24 hours of sensor data
- Events
- Statistics

### Step 3: Add Component to Dashboard
Edit `/src/pages/dashboard/dashboard-page.jsx`:

```jsx
import MyLocationsBotStatus from '@/components/services/my-locations-bot-status';

export default function DashboardPage() {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>
      
      {/* Add this component */}
      <MyLocationsBotStatus />
      
      {/* ... rest of your dashboard */}
    </div>
  );
}
```

### Step 4: Test User Flow
1. Login as regular user (not admin)
2. Go to dashboard
3. See your locations with bot status
4. Click "View Details" on a location
5. See bot sensor data (only for your locations)

### Step 5: Test Admin Flow
1. Login as admin
2. Go to `/admin/bot/{bot-id}`
3. See technical dashboard with all bot details

---

## Security Benefits

✅ **Users only see their own data** - RPC functions check organization_id
✅ **No direct table access** - Users call functions, not SELECT queries
✅ **Centralized permission logic** - All checks in one place (RPC functions)
✅ **Admin bypass when needed** - Admin routes can query directly
✅ **Audit trail** - Can log RPC function calls
✅ **SQL injection protection** - Parameterized queries in functions

---

## Adding Bot Status to Existing Pages

### Option 1: Add Tab to Service Detail Page
```jsx
// In /src/pages/services/service-detail-page.jsx
<Tabs>
  <TabsList>
    <TabsTrigger>Details</TabsTrigger>
    <TabsTrigger>Bot Status</TabsTrigger> {/* ADD THIS */}
    <TabsTrigger>Invoice</TabsTrigger>
  </TabsList>
  
  <TabsContent value="bot-status">
    {/* Embed ServiceBotStatus component or redirect */}
    <ServiceBotStatus serviceId={serviceId} />
  </TabsContent>
</Tabs>
```

### Option 2: Add Button to Service Card
```jsx
// In service list
<Card>
  <CardHeader>Service #{service.id}</CardHeader>
  <CardContent>
    <Button asChild>
      <Link to={`/portal/service/${service.id}/bot-status`}>
        View Bot Status
      </Link>
    </Button>
  </CardContent>
</Card>
```

### Option 3: Dashboard Widget
```jsx
// In dashboard
<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
  <Card>
    <CardHeader>Quick Stats</CardHeader>
    {/* ... */}
  </Card>
  
  <Card>
    <CardHeader>Bot Status</CardHeader>
    <CardContent>
      <MyLocationsBotStatus />
    </CardContent>
  </Card>
</div>
```

---

## Troubleshooting

### "Access denied" error
**Cause:** User's organization doesn't match location's organization.

**Fix:**
1. Check user's `organization_id` in `profiles` table
2. Check location's `organization_id` in `locations` table
3. Ensure they match

### "No bot found for this location"
**Cause:** Location has no bot assigned.

**Fix:**
```sql
-- Assign a bot to the location
INSERT INTO bots (location_id, name, bot_type, serial_number)
VALUES ('location-id', 'Garden Bot #1', 'mow_bot', 'MB-001');
```

### RPC function not found
**Cause:** Migration not applied.

**Fix:**
```bash
npx supabase db reset
# Or apply specific migration
```

---

## Summary

**Regular Users:** Access bot data through **locations** and **services** (RPC functions with RLS)

**Admins:** Can access technical bot dashboards directly

**Security:** All user access goes through RPC functions that check permissions

**Routes:**
- User: `/portal/location/{id}/bot-status`
- Admin: `/admin/bot/{id}`

**Components Ready:** ✅ All user-facing components created and secured!

---

This approach keeps your data secure while giving users a great experience! 🎉


