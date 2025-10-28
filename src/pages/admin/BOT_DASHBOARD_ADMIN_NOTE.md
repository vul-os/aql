# Admin Bot Dashboard - Important Notes

## ⚠️ This Dashboard Uses Deprecated Data

The bot dashboard page (`bot-dashboard-page.jsx`) uses **bot-centric data tables** that have been removed in the new service-centric architecture.

### Why This Dashboard Exists

This dashboard is maintained **for admin/maintenance purposes only** to:
- Monitor individual bot hardware status
- Troubleshoot bot-specific issues
- View raw sensor telemetry for debugging
- Track bot maintenance schedules

### Data Source Issues

The dashboard queries these **deprecated tables**:
- ❌ `bot_sensor_readings` - No longer populated
- ❌ `bot_location_history` - No longer populated  
- ❌ `bot_events` - No longer populated
- ❌ `bot_daily_statistics` - No longer populated

**Result:** This dashboard will show **no data** or **outdated data** because bots now send service-centric data instead.

---

## Recommended Alternatives

### For Service Operations
Use the **Service Dashboard** instead:
- `/portal/service/{id}/service-data` - View service performance
- Shows environmental data, mowing sessions, and service events
- Organized by garden/pool instead of bot

### For Bot Status
Use the **Service Status View**:
- `/portal/services` - View all services and their bot status
- Shows current bot status, location, and latest activity
- Service-centric but includes bot information

---

## If You Need Bot-Level Data

If you absolutely need bot-level monitoring for maintenance:

### Option 1: Query Service Data by Bot
```javascript
// Get all sessions performed by a specific bot
const { data } = await supabase
  .from('garden_mowing_sessions')
  .select('*, gardens(name)')
  .eq('bot_id', botId);

// Get environmental data collected by a bot
const { data } = await supabase
  .from('garden_environmental_data')
  .select('*, gardens(name)')
  .eq('bot_id', botId);
```

### Option 2: Create New Admin Components
Create new admin-specific components that:
- Query service-centric tables filtered by `bot_id`
- Show bot performance across all gardens it serves
- Display maintenance alerts from `service_events` filtered by `bot_id`

---

## Migration Plan for Admin Dashboard

### Short Term (Current)
- Keep existing dashboard for reference
- Add prominent warning that data is outdated
- Redirect users to service dashboards

### Medium Term (Recommended)
- Create new admin bot monitoring page using service data
- Show bot performance aggregated from service tables
- Include maintenance tracking and alerts

### Long Term
- Remove old bot dashboard entirely
- All monitoring done through service-centric views
- Bot-level views only for hardware diagnostics

---

## Example: New Admin Bot View

```jsx
// Proposed new admin bot monitoring component
export function AdminBotMonitoring({ botId }) {
  // Get bot info
  const { data: bot } = await supabase
    .from('bots')
    .select('*')
    .eq('id', botId)
    .single();

  // Get all mowing sessions by this bot
  const { data: sessions } = await supabase
    .from('garden_mowing_sessions')
    .select('*, gardens(name, service_id)')
    .eq('bot_id', botId)
    .order('session_start', { ascending: false })
    .limit(50);

  // Get service events related to this bot
  const { data: events } = await supabase
    .from('service_events')
    .select('*')
    .eq('bot_id', botId)
    .order('event_timestamp', { ascending: false })
    .limit(100);

  return (
    <div>
      <h2>Bot: {bot.name}</h2>
      <BotHealthCard bot={bot} />
      <BotSessionHistory sessions={sessions} />
      <BotEventLog events={events} />
    </div>
  );
}
```

---

**Last Updated:** October 24, 2025



