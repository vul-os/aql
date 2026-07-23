# Cleanup: Old Charge Authorization System

## Overview
The old `charge-authorization` Edge Function has been **replaced** by the new automated billing system with `charge-payment`. This document explains what to keep and what to remove.

---

## ❌ TO DELETE - Old Direct Charging System

### Edge Function: `charge-authorization`
**Location:** `supabase/functions/charge-authorization/`

**Why Delete:**
- This function allowed direct charging from the frontend
- **Replaced by:** `charge-payment` function (automated via pg_cron)
- No longer needed as all charges are now automated

**How to Delete:**
```bash
# Delete the directory
rm -rf supabase/functions/charge-authorization/

# Undeploy from Supabase (if deployed)
supabase functions delete charge-authorization
```

---

## ✅ TO KEEP - Still Needed

### 1. Edge Function: `get-authorization`
**Location:** `supabase/functions/get-authorization/`

**Why Keep:**
- **Required for R1 card verification** when users add a new card
- Separate from automated billing
- Called when user adds payment method
- Creates initial Paystack authorization

**Usage:**
- User adds card → Frontend calls `get-authorization`
- Paystack charges R1 for verification
- Authorization code stored in `payment_authorizations` table
- This authorization is then used by automated `charge-payment` system

### 2. Database Table: `payment_authorizations`
**Location:** `supabase/migrations/20251012000011_paystack_integration.sql`

**Why Keep:**
- Stores card authorizations for recurring payments
- Used by automated billing system
- Contains functions:
  - `get_user_authorizations()`
  - `set_default_authorization()`
  - `delete_payment_authorization()`
  - `update_authorization_usage()`

### 3. Database Table: `payment_transaction_logs`
**Why Keep:**
- Logs all payment attempts (success and failure)
- Used for audit trail and debugging
- Referenced by automated billing system

### 4. Edge Function: `paystack-webhook`
**Location:** `supabase/functions/paystack-webhook/`

**Why Keep:**
- Handles Paystack webhook callbacks
- Updates authorization status after R1 verification
- Confirms successful card additions

---

## System Comparison

### OLD System (Being Removed)
```
Frontend → charge-authorization Edge Function → Paystack API
         (manual, on-demand charging)
```

### NEW System (Automated)
```
pg_cron → auto_collect_payments() → charge-payment Edge Function → Paystack API
         (scheduled, automated billing with retry logic)
```

### Card Verification (Still Used)
```
Frontend → get-authorization Edge Function → Paystack API (R1 charge)
         ↓
  payment_authorizations table
         ↓
  Used by automated billing system
```

---

## Migration Path

1. **Delete old charge-authorization function:**
   ```bash
   rm -rf supabase/functions/charge-authorization/
   ```

2. **Keep get-authorization function:**
   - Still needed for adding cards
   - Charges R1 verification
   - No changes needed

3. **Update any frontend code:**
   - Remove any calls to `charge-authorization` function
   - Keep calls to `get-authorization` for adding cards
   - Billing now happens automatically via cron

4. **Verify tables are intact:**
   - `payment_authorizations` - Keep
   - `payment_transaction_logs` - Keep
   - `payment_attempts` - New (automated system)
   - `billing_notifications` - New (automated system)

---

## Frontend Changes Needed

### Remove (if exists):
```javascript
// OLD - Manual charging (REMOVE)
const chargeCustomer = async (authCode, amount) => {
  const { data } = await supabase.functions.invoke('charge-authorization', {
    body: { authorization_code: authCode, amount, email }
  });
};
```

### Keep:
```javascript
// KEEP - Card verification when adding payment method
const addPaymentMethod = async (email) => {
  const { data } = await supabase.functions.invoke('get-authorization', {
    body: { email, amount: 100 } // R1.00 verification
  });
  // Redirect to Paystack authorization URL
  window.location.href = data.data.authorization_url;
};
```

---

## Summary

| Component | Action | Reason |
|-----------|--------|--------|
| `charge-authorization` function | ❌ DELETE | Replaced by automated `charge-payment` |
| `get-authorization` function | ✅ KEEP | Still needed for R1 card verification |
| `payment_authorizations` table | ✅ KEEP | Used by automated billing |
| `payment_transaction_logs` table | ✅ KEEP | Audit trail for all payments |
| `paystack-webhook` function | ✅ KEEP | Confirms card additions |
| `charge-payment` function | ✅ NEW | Automated billing via cron |
| `send-billing-email` function | ✅ NEW | Automated emails via cron |

---

## After Cleanup

Your payment system will be:
1. **Card Addition:** User adds card → `get-authorization` → R1 verification → Authorization stored
2. **Automated Billing:** pg_cron → `charge-payment` → Charges authorization → Retry logic → Email notifications
3. **Clean Architecture:** Frontend only handles card addition, server handles all billing automatically

✅ **Result:** Simpler, more reliable, fully automated billing!

