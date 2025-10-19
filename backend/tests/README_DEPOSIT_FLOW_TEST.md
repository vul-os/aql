# Deposit Flow Test

## Test: `test_deposit_flow.py`

This test verifies the complete automated deposit collection flow:

1. ✅ Create rental agreement
2. ✅ Activate rental agreement
3. ✅ **Deposit invoice auto-created**
4. ✅ **Payment attempt auto-created**
5. ✅ **Edge function processes payment**

## Prerequisites

Before running the test, you need:

### 1. Test User with Payment Method

```bash
# Run seed script to create test user
cd seed
python3 main.py
```

This creates:
- **Email**: `botkorpza@gmail.com`
- **Password**: `happy135`

### 2. Add Payment Method

1. Login to frontend with the test user
2. Go to Settings → Billing
3. Click "Add Card"
4. Use Paystack test card:
   - Card: `4084 0840 8408 4081`
   - CVV: `408`
   - Expiry: `12/30`
   - PIN: `0000`
   - OTP: `123456`

### 3. Run the Test

```bash
cd backend/tests
python3 test_deposit_flow.py
```

## What the Test Does

```
1. Finds test user with payment authorization
2. Creates a test service
3. Creates a rental agreement (status='pending')
4. Activates the rental agreement → status='active'
   ⬇️
5. ✨ TRIGGER FIRES: auto_create_deposit_invoice_trigger
   ⬇️
6. ✨ Deposit invoice created (due_date = TODAY)
   ⬇️
7. ✨ Payment attempt created (status='pending')
   ⬇️
8. ✨ TRIGGER FIRES: auto_trigger_charge_payment
   ⬇️
9. ✨ Edge function called
   ⬇️
10. ✨ Paystack charges card
   ⬇️
11. ✅ Payment attempt → status='success'
12. ✅ Invoice → status='paid'
```

## Expected Output

```
======================================================================
🧪 DEPOSIT INVOICE & PAYMENT ATTEMPT GENERATION TEST
======================================================================

1️⃣  SETUP TEST DATA
   ✅ Found user: ec48dc3e...
   ✅ Using existing location: Test Location

2️⃣  CREATE RENTAL AGREEMENT
   ✅ Rental agreement created: RA-TEST-ABCD1234

3️⃣  ACTIVATE RENTAL AGREEMENT (TRIGGER FLOW)
   ✅ Rental agreement activated!

4️⃣  VERIFY DEPOSIT INVOICE CREATED
   ✅ Deposit invoice created!
      Invoice: INV-202510-0001
      Amount: R343.85

5️⃣  VERIFY PAYMENT ATTEMPT CREATED
   ✅ Payment attempt created!
      Status: pending

6️⃣  VERIFY PAYMENT PROCESSED
   ✅ Payment processed successfully!
      Reference: abc123xyz

📊 TEST SUMMARY

✅ Rental Agreement: RA-TEST-ABCD1234
✅ Deposit Invoice: INV-202510-0001
✅ Payment Attempt: fdda1084...
✅ Payment Status: SUCCESS

🎉 TEST PASSED: Complete flow working!
```

## Troubleshooting

### "No users with payment authorization found"

**Solution**: Add a payment method for the test user (see step 2 above)

### "Deposit invoice not created"

**Possible causes:**
- Trigger `auto_create_deposit_invoice_trigger` not installed
- Run: `supabase db reset`

### "Payment attempt not created"

**Possible causes:**
- `create_deposit_invoice()` function not updated with payment attempt creation code
- Run: `supabase db reset` to apply latest migrations

### "Payment failed"

**Possible causes:**
- Edge function not deployed
- Edge function environment variables not set
- Paystack secret key invalid

**Check:**
```bash
# Test edge function directly
python3 test_charge_payment.py

# Check edge function logs
supabase functions logs charge-payment --tail
```

## Alternative: Test with Existing Data

If you already have services/agreements, you can test manually:

```sql
-- 1. Check existing rental agreement
SELECT id, agreement_number, status FROM rental_agreements LIMIT 1;

-- 2. Create deposit invoice manually
SELECT create_deposit_invoice('<rental_agreement_id>');

-- 3. Check if invoice AND payment attempt created
SELECT invoice_number, total_amount FROM invoices 
WHERE notes LIKE '%Deposit%' 
ORDER BY created_at DESC LIMIT 1;

SELECT id, status, amount FROM payment_attempts 
ORDER BY created_at DESC LIMIT 1;
```

## What This Test Validates

✅ **Deposit invoice automation works**
- Trigger fires when rental agreement becomes 'active'
- Invoice created with correct amount
- Invoice due date = today

✅ **Payment attempt automation works**
- Payment attempt created when invoice created
- Attempt has status='pending'
- Attempt linked to invoice and rental agreement

✅ **Edge function trigger works**
- Database trigger fires when payment attempt created
- Edge function receives request
- Edge function processes payment via Paystack

✅ **Complete flow is automatic**
- No manual intervention needed
- Works for initial services AND amendments
- Payment charged immediately upon signup

