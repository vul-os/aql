# Bot Data Tracking - Frontend Integration Guide

## Overview
The bot data tracking system uses **Supabase RPC functions** to access bot sensor data, events, location history, and statistics. This provides secure, row-level access control without exposing direct table queries.

## Architecture

### Database Tables
- `bot_sensor_readings` - Real-time sensor data (battery, temp, humidity, GPS, IMU, etc.)
- `bot_events` - Important bot events (errors, warnings, state changes)
- `bot_location_history` - GPS tracking trail
- `bot_daily_statistics` - Aggregated daily stats

### RPC Functions (Security Definer)
All bot data access goes through these RPC functions with built-in permission checks:

#### 1. `get_my_locations_with_bots()`
Returns all locations for the current user's organization with bot status.

**Usage:**
```javascript
const { data, error } = await supabase
  .rpc('get_my_locations_with_bots');
```

**Returns:**
- `location_id`, `location_name`, `location_address`
- `bot_id`, `bot_name`, `bot_type`, `bot_status`
- `battery_level`, `last_online_at`, `is_on`, `current_temperature`

#### 2. `get_location_bot_data(location_id_input)`
Get comprehensive bot data for a specific location.

**Usage:**
```javascript
const { data, error } = await supabase
  .rpc('get_location_bot_data', { 
    location_id_input: locationId 
  });
```

**Returns:**
- `bot_id`, `bot_name`, `bot_type`, `bot_status`
- `latest_sensor_reading` (JSONB) - Most recent sensor data
- `recent_events` (JSONB array) - Last 20 events
- `location_trail` (JSONB array) - Last 100 GPS points
- `today_stats` (JSONB) - Today's aggregated statistics

#### 3. `get_service_bot_data(service_id_input)`
Get bot data in the context of a service record.

**Usage:**
```javascript
const { data, error } = await supabase
  .rpc('get_service_bot_data', { 
    service_id_input: serviceId 
  });
```

**Returns:** Same as `get_location_bot_data`

#### 4. `get_bot_sensor_history(location_id_input, hours_back)`
Get historical sensor readings for graphing.

**Usage:**
```javascript
const { data, error } = await supabase
  .rpc('get_bot_sensor_history', { 
    location_id_input: locationId,
    hours_back: 24  // default: 24
  });
```

**Returns:** Array of sensor readings with timestamps

#### 5. `get_location_bot_statistics(location_id_input, days_back)`
Get daily statistics for a location.

**Usage:**
```javascript
const { data, error } = await supabase
  .rpc('get_location_bot_statistics', {
    location_id_input: locationId,
    days_back: 7  // default: 7
  });
```

**Returns:** Array of daily statistics

## Frontend Components

### Updated Components ✅

1. **`my-locations-bot-status.jsx`**
   - Lists all user's locations with bot status
   - Uses: `get_my_locations_with_bots()`

2. **`location-bot-status-page.jsx`**
   - Full bot dashboard for a specific location
   - Uses: `get_location_bot_data()`, `get_bot_sensor_history()`, `get_location_bot_statistics()`
   - Route: `/portal/location/:locationId/bot-status`

3. **`service-bot-status.jsx`**
   - Bot status in context of a service
   - Uses: Gets location from service, then `get_location_bot_data()`, `get_bot_sensor_history()`
   - Route: `/portal/service/:serviceId/bot-status`

4. **`bot-dashboard-page.jsx`** (Admin)
   - Admin view of bot data
   - Uses: Gets location from bot, then `get_location_bot_data()`
   - Route: `/admin/bot/:botId`

## Security

### RLS Policies
All bot data tables have Row Level Security enabled:
- **Admins**: Full read access to all data
- **Users**: Can only read data for bots at their organization's locations
- **Service Role**: Can insert/update data (for bot API)

### RPC Function Security
- All RPC functions are `SECURITY DEFINER` (run with elevated privileges)
- Built-in permission checks verify user's organization access
- Functions check `profiles.organization_id` matches `locations.organization_id`

## Data Flow

```
Bot Hardware
    ↓
Bot API (Service Role)
    ↓
Database Tables (bot_sensor_readings, bot_events, etc.)
    ↓
RPC Functions (SECURITY DEFINER)
    ↓
Frontend Components
    ↓
User Interface
```

## Sensor Data Structure

### Latest Sensor Reading (JSONB)
```javascript
{
  id: "uuid",
  bot_id: "uuid",
  recorded_at: "timestamp",
  
  // Power
  is_on: boolean,
  battery_percentage: 85,
  battery_voltage: 12.6,
  is_charging: false,
  
  // Movement
  direction_degrees: 45.5,
  rpm: 1200,
  distance_traveled_cm: 125.5,
  speed_cm_per_sec: 15.3,
  
  // 3D Orientation (IMU)
  pitch: 2.5,   // Forward/backward tilt
  roll: -1.2,   // Left/right tilt
  yaw: 45.0,    // Compass heading
  
  // 3D Acceleration (m/s²)
  acceleration_x: 0.05,
  acceleration_y: 0.02,
  acceleration_z: 9.81,
  
  // 3D Rotation (degrees/second)
  rotation_x: 0.1,
  rotation_y: -0.05,
  rotation_z: 0.3,
  
  // Environment
  temperature_celsius: 22.5,
  humidity_percentage: 65.0,
  is_raining: false,
  rain_intensity: 0,
  
  // GPS
  latitude: -26.1234567,
  longitude: 28.1234567,
  gps_accuracy_meters: 5.2,
  
  // Bot-specific data (flexible)
  bot_specific_data: {
    blade_rpm: 3000,      // For mow bots
    water_ph: 7.2,        // For pool bots
    chlorine_level: 2.5   // For pool bots
  }
}
```

### Event Structure
```javascript
{
  id: "uuid",
  bot_id: "uuid",
  event_type: "error_occurred",
  severity: "error",  // info, warning, error, critical
  title: "Motor Stall Detected",
  description: "Left motor stopped responding",
  data: { motor_id: "left", last_rpm: 1200 },
  latitude: -26.1234,
  longitude: 28.1234,
  event_timestamp: "timestamp"
}
```

### Daily Statistics
```javascript
{
  date: "2025-10-21",
  total_runtime_minutes: 240,
  active_time_minutes: 180,
  idle_time_minutes: 60,
  total_distance_meters: 1250.5,
  area_covered_sqm: 450.0,
  average_battery_level: 75.5,
  error_count: 0,
  warning_count: 2
}
```

## Example: Creating a New Bot Status Component

```javascript
import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function MyBotComponent({ locationId }) {
  const [botData, setBotData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBotData();
  }, [locationId]);

  const fetchBotData = async () => {
    try {
      const { data, error } = await supabase
        .rpc('get_location_bot_data', { 
          location_id_input: locationId 
        });
      
      if (error) throw error;
      
      if (data && data.length > 0) {
        setBotData(data[0]);
      }
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div>Loading...</div>;
  if (!botData) return <div>No bot found</div>;

  const sensor = botData.latest_sensor_reading;

  return (
    <div>
      <h2>{botData.bot_name}</h2>
      <p>Status: {botData.bot_status}</p>
      <p>Battery: {sensor?.battery_percentage}%</p>
      <p>Temperature: {sensor?.temperature_celsius}°C</p>
    </div>
  );
}
```

## Migration Files

1. `20251021100001_bot_data_tracking_system.sql` - Creates tables and indexes
2. `20251021100002_bot_tracking_rpc_functions.sql` - Creates RPC functions
3. `20251021100003_bot_tracking_rls_policies.sql` - Enables RLS and policies

## Testing

To test the system:

1. Ensure migrations are applied:
```bash
cd supabase
supabase db push
```

2. Verify RPC functions exist:
```sql
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_name LIKE 'get_%bot%';
```

3. Test from frontend:
```javascript
// Should return your locations
const { data } = await supabase.rpc('get_my_locations_with_bots');
console.log(data);
```

## Notes

- **Do NOT** query bot data tables directly - always use RPC functions
- All RPC functions handle permission checks automatically
- Real-time subscriptions can be added to `bot_sensor_readings` for live updates
- The service role should be used by bot hardware/API to insert data
- Admin users have full access to all bot data across organizations

## Support

For questions or issues:
1. Check the RPC function definitions in `20251021100002_bot_tracking_rpc_functions.sql`
2. Verify RLS policies in `20251021100003_bot_tracking_rls_policies.sql`
3. Review example components in `/src/pages/locations/location-bot-status-page.jsx`


