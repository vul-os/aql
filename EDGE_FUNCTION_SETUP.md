# Edge Function Setup Guide

## Problem

The `charge-payment` edge function is returning `401 Unauthorized` because environment variables aren't configured.

## Why This Happens

After a database reset:
1. ✅ Database migrations run successfully
2. ✅ Triggers are created
3. ✅ `app_config` table is populated
4. ❌ **Edge function environment variables are NOT set** (they're managed separately)

## Solution

### Step 1: Get Your Paystack Keys

1. Go to https://dashboard.paystack.com/settings/developer
2. Copy your **Secret Key** (starts with `sk_test_` or `sk_live_`)
3. Copy your **Public Key** (starts with `pk_test_` or `pk_live_`)

### Step 2: Update the Secrets Script

Edit `supabase/set-secrets.sh` and replace the Paystack keys:

```bash
PAYSTACK_SECRET_KEY="sk_test_YOUR_ACTUAL_KEY_HERE"
PAYSTACK_PUBLIC_KEY="pk_test_YOUR_ACTUAL_KEY_HERE"
```

### Step 3: Run the Secrets Script

```bash
cd supabase
./set-secrets.sh
```

This will set all required environment variables for your edge functions.

### Step 4: Verify Secrets are Set

```bash
supabase secrets list
```

You should see:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PAYSTACK_SECRET_KEY`
- `PAYSTACK_PUBLIC_KEY`
- `RESEND_API_KEY`
- `APP_URL`

### Step 5: Test the Edge Function

```bash
cd backend/tests
python3 test_trigger_edge_function.py
```

Expected output:
```
✅ SUCCESS: Trigger → Edge Function flow is working!
```

---

## What Each Secret Does

| Secret | Purpose |
|--------|---------|
| `SUPABASE_URL` | Database connection URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Authenticates edge function with database (bypasses RLS) |
| `PAYSTACK_SECRET_KEY` | Charges customers via Paystack API |
| `PAYSTACK_PUBLIC_KEY` | Frontend Paystack integration |
| `RESEND_API_KEY` | Sends emails (invoices, notifications) |
| `APP_URL` | Links in emails point to your app |

---

## Troubleshooting

### "supabase: command not found"

Install the Supabase CLI:
```bash
npm install -g supabase
```

Then login:
```bash
supabase login
```

### "Not logged in to Supabase"

Run:
```bash
supabase login
```

Follow the prompts to authenticate.

### "401 Unauthorized" after setting secrets

Wait 1-2 minutes for secrets to propagate, then test again.

If still failing, redeploy the function:
```bash
cd supabase
supabase functions deploy charge-payment --no-verify-jwt
```

### Payment attempt stays "pending"

Check edge function logs:
```bash
supabase functions logs charge-payment --tail
```

Common issues:
- ❌ `PAYSTACK_SECRET_KEY` not set or invalid
- ❌ `SUPABASE_SERVICE_ROLE_KEY` not set
- ❌ Edge function not deployed

---

## Complete Setup Flow (After DB Reset)

```bash
# 1. Reset database
supabase db reset

# 2. Set edge function secrets
cd supabase
./set-secrets.sh

# 3. Deploy edge functions (if needed)
./deploy-functions.sh

# 4. Test the flow
cd ../backend/tests
python3 test_trigger_edge_function.py
```

---

## Why Secrets Aren't Persisted

Edge function secrets are **not** stored in your database migrations. They're:
- Stored in Supabase's edge function runtime
- Set via Supabase CLI (`supabase secrets set`)
- Separate from database configuration

This is by design for security - secrets shouldn't be in version control or migrations.

---

## Quick Reference

**Check if secrets are set:**
```bash
supabase secrets list
```

**Update a single secret:**
```bash
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_new_key
```

**View edge function logs:**
```bash
supabase functions logs charge-payment --tail
```

**Test edge function directly:**
```bash
python3 backend/tests/test_charge_payment.py
```

**Test complete trigger flow:**
```bash
python3 backend/tests/test_trigger_edge_function.py
```
