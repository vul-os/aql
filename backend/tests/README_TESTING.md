# Testing Scripts for Charge Payment System

## Available Test Scripts

### 1. `test_trigger_edge_function.py` ⭐ **RECOMMENDED**
**Complete diagnostic tool for the entire trigger → edge function flow**

Tests:
- ✅ Database trigger exists
- ✅ `app_config` table has `service_role_key`
- ✅ HTTP extension is enabled
- ✅ Creates test payment attempt
- ✅ Checks if trigger fires HTTP request
- ✅ Verifies edge function processes payment
- ✅ Tests edge function directly

**Usage:**
```bash
cd /home/imran/Documents/botkorp-mono/backend/tests
python3 test_trigger_edge_function.py
```

**Best for:**
- Diagnosing why payments aren't processing automatically
- Verifying the complete flow after DB reset
- Troubleshooting trigger issues

---

### 2. `test_charge_payment.py`
**Directly calls the charge-payment edge function**

Tests:
- ✅ Edge function is accessible
- ✅ Edge function processes pending payments
- ✅ Returns correct response

**Usage:**
```bash
cd /home/imran/Documents/botkorp-mono/backend/tests
python3 test_charge_payment.py
```

**Best for:**
- Quick check if edge function is working
- Manual payment processing
- Debugging edge function logic

---

### 3. `check_invoice_trigger.py`
**Checks invoice PDF generation trigger**

Tests:
- ✅ Recent invoices have PDFs
- ✅ pg_net HTTP queue status
- ✅ PDF generation trigger

**Usage:**
```bash
cd /home/imran/Documents/botkorp-mono/backend/tests
python3 check_invoice_trigger.py
```

**Best for:**
- Diagnosing PDF generation issues
- Checking if backend API is receiving webhook calls

---

## Common Issues & Solutions

### Issue: "service_role_key NOT found in app_config"

**Problem:** The trigger can't authenticate with the edge function

**Fix:**
```sql
-- Run in Supabase SQL Editor:
INSERT INTO app_config (key, value, description)
VALUES (
  'service_role_key',
  'YOUR_SERVICE_ROLE_KEY_HERE',
  'Service role key for authenticating with Edge Functions'
);
```

Or re-run migration:
```bash
# Reset DB to apply all migrations including app_config setup
supabase db reset
```

---

### Issue: "Edge function works but trigger not firing"

**Symptoms:**
- `test_charge_payment.py` works ✅
- `test_trigger_edge_function.py` shows trigger not firing ❌

**Possible Causes:**
1. **Trigger doesn't exist** - Check if migration ran successfully
2. **HTTP extension not enabled** - Run `CREATE EXTENSION IF NOT EXISTS http;`
3. **Permission issues** - Function needs `SECURITY DEFINER`

**Debug:**
```sql
-- Check if trigger exists
SELECT * FROM pg_trigger 
WHERE tgname = 'auto_trigger_charge_payment';

-- Check if trigger function exists
SELECT * FROM pg_proc 
WHERE proname = 'trigger_charge_payment';

-- Check app_config
SELECT * FROM app_config WHERE key = 'service_role_key';

-- Enable HTTP extension
CREATE EXTENSION IF NOT EXISTS http;
```

---

### Issue: "Payment attempt created but status stays 'pending'"

**Symptoms:**
- Payment attempt created
- No errors in logs
- Status never changes to 'success' or 'failed'

**Possible Causes:**
1. **Edge function not deployed**
2. **Invalid payment authorization**
3. **Paystack API issues**

**Debug:**
1. Check Supabase Edge Function logs
2. Verify edge function is deployed:
   ```bash
   supabase functions list
   ```
3. Check payment authorization is valid:
   ```sql
   SELECT * FROM payment_authorizations 
   WHERE is_active = true;
   ```

---

## Testing Workflow (After DB Reset)

Run tests in this order:

```bash
# 1. Full diagnostic
python3 test_trigger_edge_function.py

# If issues found, check specific components:

# 2. Test edge function directly
python3 test_charge_payment.py

# 3. Check invoice PDFs (if relevant)
python3 check_invoice_trigger.py
```

---

## Expected Output (Healthy System)

### `test_trigger_edge_function.py`:
```
✅ SUCCESS: Trigger → Edge Function flow is working!

Component Status:
  ✅ Database trigger
  ✅ app_config (service_role_key)
  ✅ HTTP extension
  ✅ Test payment attempt created
  ✅ HTTP request queued
  ✅ Edge function (direct call)

  Final Status: success
```

### `test_charge_payment.py`:
```
✅ Edge function is working correctly!
✅ Processed 1 pending payment(s)
```

---

## Getting Help

If tests still fail after troubleshooting:

1. **Check Supabase logs:**
   - Go to Supabase Dashboard
   - Navigate to Edge Functions → Logs
   - Check for errors

2. **Check database logs:**
   - Look for `RAISE WARNING` or `RAISE NOTICE` messages
   - Check for permission errors

3. **Verify migrations:**
   ```bash
   supabase db reset --debug
   ```

4. **Check environment:**
   - Verify `SUPABASE_URL` in test scripts
   - Verify `SUPABASE_SERVICE_KEY` in test scripts
   - Ensure edge functions are deployed

