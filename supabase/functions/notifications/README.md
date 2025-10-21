# Notifications Edge Function

Unified notification handler for all Bot Korp notification types. Receives HTTP POST requests from database triggers and sends notifications via email, push, etc.

## Architecture

```
Database Event → SQL Trigger → HTTP POST → Edge Function → Email/Push Services
```

**Flow:**
1. Event happens (bot offline, service completed, etc.)
2. SQL trigger fires
3. Trigger makes HTTP POST to `/functions/v1/notifications`
4. Edge Function processes notification
5. Sends emails via Resend
6. Creates push notification records (for future push service)

## Notification Types

All notification types are handled by this single function:

### Bot Notifications
- `bot_offline` - Bot goes offline or has error
- `bot_low_battery` - Battery below 20%
- `bot_maintenance` - Maintenance required
- `bot_alert` - Emergency stop or other alerts

### Service Notifications
- `service_scheduled` - New service created
- `service_completed` - Service completed
- `service_cancelled` - Service cancelled
- `service_reminder` - Upcoming service reminder

### Billing Notifications
- `payment_due` - Payment due soon
- `payment_success` - Payment processed
- `payment_failed` - Payment failed
- `invoice_generated` - New invoice created

### Organization Notifications
- `member_invited` - Member invited to organization
- `member_joined` - New member joined
- `member_removed` - Member removed
- `role_changed` - Member role changed

### Amendment Notifications
- `service_amendment_submitted` - Amendment request submitted
- `service_amendment_approved` - Amendment approved
- `service_amendment_rejected` - Amendment rejected

## Request Format

```typescript
POST /functions/v1/notifications

{
  "type": "bot_offline",              // notification type
  "user_ids": ["uuid1", "uuid2"],     // array of user IDs to notify
  "title": "Bot Offline",             // email subject / notification title
  "message": "Bot MowBot-01 is offline",  // notification message
  "priority": "urgent",               // low, normal, high, urgent (optional)
  "data": {                           // additional data (optional)
    "bot_id": "uuid",
    "action_url": "/portal/services",
    "action_label": "View Services"
  },
  "send_email": true,                 // send email notification (default: true)
  "send_push": true                   // send push notification (default: false)
}
```

## Response Format

```json
{
  "success": true,
  "emails_sent": 3,
  "push_sent": 2,
  "total_users": 3
}
```

## Email Template

The function generates beautiful HTML emails with:
- **Dynamic header colors** based on priority:
  - 🟠 Orange (default)
  - 🔴 Red (urgent)
  - 🟡 Amber (high)
  - 🟢 Green (success/completed)
- **Bot Korp branding**
- **Responsive design**
- **Action buttons** (if action_url provided)
- **User preference links**

## User Preferences

The function respects user notification preferences from `notification_preferences` table:

- `email_enabled` - Global email toggle
- `email_bot_alerts` - Bot-related emails
- `email_service_reminders` - Service-related emails
- `email_billing` - Billing-related emails
- `push_enabled` - Global push toggle
- (similar push preferences)

If a user has disabled a notification type, they won't receive it even if `send_email: true`.

## Database Configuration

The Edge Function URL and service role key must be configured in PostgreSQL:

```sql
-- Production configuration
ALTER DATABASE postgres SET app.edge_function_url = 'https://your-project.supabase.co';
ALTER DATABASE postgres SET app.service_role_key = 'your-service-role-key';

-- Local development (default)
-- Uses: http://localhost:54321/functions/v1/notifications
```

## Environment Variables

Required in Supabase Edge Function settings:

```bash
RESEND_API_KEY=re_xxxxx              # Your Resend API key
SUPABASE_URL=https://xxx.supabase.co # Your Supabase URL
SUPABASE_SERVICE_ROLE_KEY=xxx        # Service role key
APP_URL=https://app.botkorp.com      # Your app URL
```

## Deployment

```bash
# Deploy the function
supabase functions deploy notifications

# Set environment variables
supabase secrets set RESEND_API_KEY=your_key_here
supabase secrets set APP_URL=https://app.botkorp.com

# Configure database
psql -c "ALTER DATABASE postgres SET app.edge_function_url = 'https://your-project.supabase.co';"
psql -c "ALTER DATABASE postgres SET app.service_role_key = 'your-service-role-key';"
```

## Testing

### Manual Test from SQL

```sql
SELECT send_notification_http(
    'bot_offline',                              -- type
    ARRAY['user-uuid-1', 'user-uuid-2']::uuid[], -- user_ids
    'Test Notification',                        -- title
    'This is a test notification',              -- message
    'normal',                                   -- priority
    '{"test": true}'::jsonb,                   -- data
    true,                                       -- send_email
    false                                       -- send_push
);
```

### Manual Test via HTTP

```bash
curl -X POST 'https://your-project.supabase.co/functions/v1/notifications' \
  -H 'Authorization: Bearer YOUR_SERVICE_ROLE_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "bot_offline",
    "user_ids": ["user-uuid"],
    "title": "Test Notification",
    "message": "Testing notifications",
    "send_email": true
  }'
```

## Triggers Using This Function

All these triggers make HTTP POST to this function:

1. ✅ `trigger_bot_status_notification` - Bot status changes
2. ✅ `trigger_bot_battery_notification` - Low battery
3. ✅ `trigger_service_created_notification` - Service created
4. ✅ `trigger_service_completed_notification` - Service completed
5. ✅ `trigger_payment_failed_notification` - Payment failures
6. ✅ `trigger_member_joined_notification` - Member joined
7. ✅ `trigger_bot_emergency_notification` - Emergency stop
8. ✅ `trigger_amendment_submitted_notification` - Amendment submitted
9. ✅ `trigger_amendment_status_notification` - Amendment approved/rejected

## Future Enhancements

- [ ] Push notifications via Firebase Cloud Messaging
- [ ] SMS notifications via Twilio
- [ ] WhatsApp notifications
- [ ] Slack/Discord webhooks
- [ ] Notification batching (daily digests)
- [ ] A/B testing for email templates
- [ ] Analytics and tracking

## Error Handling

- Failed HTTP requests are logged but don't block trigger execution
- Invalid user IDs are skipped
- Missing preferences default to enabled
- Email failures don't affect other users in the batch
- Respects rate limits (TODO: implement rate limiting)

## Performance

- Asynchronous HTTP requests from triggers
- Batch processing for multiple users
- Efficient JSONB queries
- Indexed notification preferences table
- Edge-deployed for global performance

---

**Status:** ✅ Production Ready
**Maintained by:** BotKorp Development Team
**Last Updated:** 2025-10-18

