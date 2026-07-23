# Automated Billing System with pg_cron

## Overview
Complete automated billing system with invoice generation, payment collection, retry logic, and email notifications.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     AUTOMATED BILLING FLOW                   │
└─────────────────────────────────────────────────────────────┘

Day 26 @ 2am: Generate Invoices
   │
   ├─> auto_generate_monthly_invoices()
   │   ├─ Create invoices for all active agreements
   │   ├─ Set due date (1st of next month)
   │   └─ Create "invoice_generated" notifications
   │
   └─> send-billing-email (Edge Function)
       └─ Send invoice emails via Resend

Day 1 @ 3am: Collect Payments
   │
   ├─> auto_collect_payments()
   │   ├─ Find unpaid invoices
   │   ├─ Get default payment authorizations
   │   └─ Create payment_attempts (status: pending)
   │
   └─> charge-payment (Edge Function)
       ├─ Call Paystack API to charge authorizations
       ├─ Update payment_attempts (success/failed)
       ├─ Mark invoices as paid (if successful)
       └─ Create notifications (success or failure)

Daily @ 4am: Retry Failed Payments
   │
   ├─> retry_failed_payments()
   │   ├─ Find attempts needing retry
   │   ├─ Update retry_count
   │   ├─ Reset to "pending" status
   │   └─ Set next_retry_at (+1 day)
   │
   └─> charge-payment (Edge Function)
       └─ Attempt charging again (max 3 retries)

Daily @ 5am: Pause Failed Subscriptions
   │
   └─> pause_failed_subscriptions()
       ├─ Find attempts that exhausted retries
       ├─ Pause rental agreements
       ├─ Notify ALL organization members
       └─ Create "subscription_paused" notifications

Every 15min: Send Email Notifications
   │
   └─> send-billing-email (Edge Function)
       ├─ Get pending notifications
       ├─ Send via Resend API
       ├─ Mark as "sent" or "failed"
       └─ Store Resend email ID
```

---

## Database Tables

### 1. `payment_attempts`
Tracks all payment collection attempts with retry logic.

```sql
- id: UUID
- invoice_id: UUID (FK)
- rental_agreement_id: UUID (FK)
- user_id: UUID (FK)
- authorization_code: TEXT (Paystack)
- amount: DECIMAL
- attempt_number: INTEGER (1, 2, 3...)
- status: TEXT (pending/success/failed/retry)
- paystack_reference: TEXT
- paystack_response: JSONB
- error_message: TEXT
- next_retry_at: TIMESTAMPTZ
- retry_count: INTEGER (0-3)
- max_retries: INTEGER (default: 3)
```

### 2. `billing_notifications`
Queue for billing-related email notifications.

```sql
- id: UUID
- invoice_id: UUID (FK)
- payment_attempt_id: UUID (FK)
- user_id: UUID (FK)
- notification_type: TEXT
  - invoice_generated
  - payment_success
  - payment_failed
  - payment_retry
  - subscription_paused
  - payment_overdue
- recipients: JSONB (array of emails)
- subject: TEXT
- body: TEXT
- html_body: TEXT
- status: TEXT (pending/sent/failed)
- sent_at: TIMESTAMPTZ
- resend_email_id: TEXT
```

### 3. `cron_job_logs`
Logs all cron job executions.

```sql
- id: UUID
- job_name: TEXT
- started_at: TIMESTAMPTZ
- completed_at: TIMESTAMPTZ
- status: TEXT (running/success/failed)
- result: JSONB
- error_message: TEXT
```

---

## Cron Jobs Schedule

| Job Name | Schedule | Function | Purpose |
|----------|----------|----------|---------|
| `generate-monthly-invoices` | 26th @ 2am | `auto_generate_monthly_invoices()` | Create invoices 5 days before billing |
| `collect-monthly-payments` | 1st @ 3am | `auto_collect_payments()` | Collect payments for due invoices |
| `retry-failed-payments` | Daily @ 4am | `retry_failed_payments()` | Retry failed payment attempts |
| `pause-failed-subscriptions` | Daily @ 5am | `pause_failed_subscriptions()` | Pause services after final failure |
| `send-billing-emails` | Every 15min | `send_pending_billing_emails()` | Send notification emails |

---

## Edge Functions

### 1. `charge-payment`
**Purpose:** Charges Paystack authorizations for pending payment attempts

**Flow:**
1. Get all `payment_attempts` with status = 'pending'
2. For each attempt:
   - Call Paystack `/transaction/charge_authorization`
   - If success:
     - Update attempt status = 'success'
     - Mark invoice as paid
     - Create "payment_success" notification
   - If failed:
     - Update attempt status = 'retry' (if retries left) or 'failed'
     - Create "payment_failed" notification
3. Return results summary

**Environment Variables:**
- `PAYSTACK_SECRET_KEY` - Paystack secret key
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key

### 2. `send-billing-email`
**Purpose:** Sends billing notification emails via Resend

**Flow:**
1. Get all `billing_notifications` with status = 'pending'
2. For each notification:
   - Get recipients (user email + org members)
   - Generate HTML email from template
   - Send via Resend API
   - If success:
     - Update status = 'sent'
     - Store Resend email ID
   - If failed:
     - Update status = 'failed'
     - Store error message
3. Return results summary

**Environment Variables:**
- `RESEND_API_KEY` - Resend API key
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key

**Email Template Features:**
- Bot Korp branded header
- Invoice details (if applicable)
- Clear call-to-action button
- Support contact information
- Professional HTML/CSS styling

---

## Payment Retry Logic

### Timeline:
```
Day 1 (1st of month): 
  - Initial charge attempt
  - If fails → status = 'retry', next_retry_at = Day 2

Day 2:
  - Retry #1
  - If fails → status = 'retry', next_retry_at = Day 3

Day 3:
  - Retry #2
  - If fails → status = 'retry', next_retry_at = Day 4

Day 4:
  - Final retry #3
  - If fails → status = 'failed'
  
Day 5:
  - Pause subscription
  - Notify ALL organization members
```

### Retry Strategy:
- **Max retries:** 3 attempts
- **Retry interval:** 1 day between attempts
- **Exponential backoff:** Not implemented (could be added)
- **Final action:** Pause subscription, notify all members

### Notification Flow:
```
Attempt 1 fails:
  → Email to user: "Payment failed, we'll retry"

Attempt 2 fails:
  → Email to user: "Payment failed again, 2 retries left"

Attempt 3 fails:
  → Email to user: "Final retry failed, 1 retry left"

Final attempt fails:
  → Email to ALL org members: "Service paused due to payment failure"
```

---

## Setup Instructions

### 1. Deploy Database Migrations
```bash
cd supabase
supabase db push
```

Migrations to apply:
- `20251017000007_automated_billing_system.sql` - Cron jobs & tables
- `20251017000008_cron_http_triggers.sql` - HTTP triggers

### 2. Enable Extensions
```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net; -- For HTTP requests
CREATE EXTENSION IF NOT EXISTS http;   -- Alternative HTTP extension
```

### 3. Deploy Edge Functions
```bash
# Deploy charge-payment function
supabase functions deploy charge-payment

# Deploy send-billing-email function
supabase functions deploy send-billing-email
```

### 4. Set Environment Secrets
```bash
# Paystack secret key
supabase secrets set PAYSTACK_SECRET_KEY=sk_live_...

# Resend API key
supabase secrets set RESEND_API_KEY=re_...
```

### 5. Configure Database Settings
```sql
-- Set Supabase URL
ALTER DATABASE postgres 
SET app.supabase_url = 'https://your-project.supabase.co';

-- Set service role key
ALTER DATABASE postgres 
SET app.supabase_service_role_key = 'eyJ...';
```

### 6. Verify Cron Jobs
```sql
-- Check scheduled jobs
SELECT * FROM cron.job;

-- Check job run history
SELECT * FROM cron.job_run_details
ORDER BY start_time DESC
LIMIT 10;
```

### 7. Test Functions Manually
```sql
-- Test invoice generation
SELECT auto_generate_monthly_invoices();

-- Test payment collection
SELECT auto_collect_payments();

-- Test email sending
SELECT send_pending_billing_emails();
```

---

## Monitoring & Debugging

### Check Cron Job Status
```sql
-- View all scheduled jobs
SELECT * FROM cron.job;

-- View recent job runs
SELECT * FROM cron.job_run_details
WHERE jobid IN (SELECT jobid FROM cron.job)
ORDER BY start_time DESC
LIMIT 20;

-- View job logs (custom table)
SELECT * FROM cron_job_logs
ORDER BY started_at DESC
LIMIT 20;
```

### Check Payment Attempts
```sql
-- View recent payment attempts
SELECT 
    pa.*,
    i.invoice_number,
    i.total_amount
FROM payment_attempts pa
JOIN invoices i ON i.id = pa.invoice_id
ORDER BY pa.created_at DESC
LIMIT 50;

-- Count by status
SELECT 
    status,
    COUNT(*),
    SUM(amount) as total_amount
FROM payment_attempts
WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY status;
```

### Check Notifications
```sql
-- View pending notifications
SELECT * FROM billing_notifications
WHERE status = 'pending'
ORDER BY created_at;

-- View failed notifications
SELECT * FROM billing_notifications
WHERE status = 'failed'
ORDER BY created_at DESC
LIMIT 20;

-- Count by type
SELECT 
    notification_type,
    status,
    COUNT(*)
FROM billing_notifications
GROUP BY notification_type, status;
```

### View Edge Function Logs
```bash
# Via Supabase CLI
supabase functions logs charge-payment
supabase functions logs send-billing-email

# Via Supabase Dashboard
# → Functions → Select function → Logs tab
```

---

## Email Templates

### Invoice Generated
```
Subject: Your Bot Korp Invoice for October 2025

Hi John,

Your invoice INV-202510-0001 for R575.00 is ready. 
Payment will be automatically collected on 2025-11-01.

[View Invoice]
```

### Payment Success
```
Subject: Payment Received - Thank You!

Hi John,

We've successfully received your payment of R575.00.
Reference: ref_abc123xyz

[View Receipt]
```

### Payment Failed
```
Subject: Payment Failed - Action Required

Hi John,

Payment attempt failed: Card declined.
We'll retry 3 more time(s) over the next 3 days.

Please update your payment method to avoid service interruption.

[Update Payment Method]
```

### Subscription Paused
```
Subject: Service Paused - Payment Failed

Hi Team,

We've paused your Bot Korp service due to failed payment for 
invoice INV-202510-0001. We attempted to collect payment 3 times 
without success.

Please update your payment method and contact us to resume service.

[Update Payment Method] [Contact Support]
```

---

## Troubleshooting

### Issue: Cron jobs not running
**Solution:**
1. Check if pg_cron is enabled: `SELECT * FROM pg_extension WHERE extname = 'pg_cron';`
2. Check job schedule: `SELECT * FROM cron.job;`
3. Check for errors: `SELECT * FROM cron.job_run_details WHERE status = 'failed';`

### Issue: Edge functions not being called
**Solution:**
1. Check database settings: `SHOW app.supabase_url;`
2. Verify service role key is set
3. Check edge function deployment: `supabase functions list`
4. Check function logs for errors

### Issue: Emails not sending
**Solution:**
1. Verify Resend API key: `supabase secrets list`
2. Check notification queue: `SELECT * FROM billing_notifications WHERE status = 'pending';`
3. Check for failed notifications with errors
4. Verify email addresses are valid

### Issue: Payments failing
**Solution:**
1. Check Paystack secret key is correct
2. Verify authorization codes are valid and not expired
3. Check Paystack dashboard for transaction errors
4. Review `payment_attempts` table for error messages

---

## Performance Optimization

### Batch Processing
- Process max 50 attempts/notifications per run
- Prevents timeouts and resource exhaustion
- Can be adjusted based on load

### Indexing
All tables have appropriate indexes:
- `payment_attempts`: invoice_id, user_id, status, next_retry_at
- `billing_notifications`: invoice_id, user_id, status, type
- `cron_job_logs`: job_name, started_at

### Cleanup Old Data
```sql
-- Clean up old logs (keep 90 days)
DELETE FROM cron_job_logs
WHERE started_at < CURRENT_DATE - INTERVAL '90 days';

-- Archive old payment attempts (keep 1 year)
-- Move to archive table or delete
```

---

## Security Considerations

1. **Service Role Key:** Only accessible to cron jobs, never exposed to frontend
2. **Payment Secrets:** Stored in Supabase secrets, not in database
3. **Authorization:** Edge functions verify service role key in header
4. **Email Privacy:** Recipients array stores emails securely
5. **Audit Trail:** All payment attempts and notifications logged

---

## Cost Estimation

### Supabase Functions
- Executions: ~150/month (cron jobs + retries)
- Cost: Free tier covers this easily

### Resend Emails
- Volume: ~100-500 emails/month (depending on customer count)
- Cost: Free tier = 3,000 emails/month

### Database Storage
- Payment attempts: ~1KB each, ~1,000/month = 1MB
- Notifications: ~2KB each, ~500/month = 1MB
- Total: Negligible

**Total Monthly Cost: ~R0** (within free tiers)

---

## Success Metrics

### Monitor These KPIs:
1. **Invoice Generation Success Rate:** Should be >99%
2. **Payment Success Rate:** Target >90% on first attempt
3. **Email Delivery Rate:** Should be >98%
4. **Subscription Pause Rate:** Target <2%
5. **Average Retry Count:** Should be <1.5

### Dashboards to Build:
- Daily payment collection success/failure
- Invoice aging (overdue invoices)
- Notification queue size
- Cron job execution times

---

## Status
- ✅ Database tables created
- ✅ Cron jobs scheduled
- ✅ Edge functions written
- ⏳ Deployment pending
- ⏳ Testing pending

**Ready for:** Migration deployment and edge function deployment!

