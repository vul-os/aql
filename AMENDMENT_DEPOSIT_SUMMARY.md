# Amendment Deposit Invoice Automation

## Overview
The deposit invoice system now automatically creates deposit invoices for service amendments when additional gardens/bots are added to an existing service.

## What Changed

### Previous Behavior
- Only created ONE deposit invoice per service (for initial setup)
- When gardens were added via amendments, no deposit was charged for the new bots
- This meant customers could add multiple bots without paying setup deposits

### New Behavior
- ✅ **Initial Setup**: Creates deposit invoice for all bots when first rental agreement is signed
- ✅ **Amendments**: Automatically creates deposit invoice when new gardens are added
- ✅ **Smart Detection**: Only charges for NEW bots that haven't been billed yet
- ✅ **Prevents Duplicates**: Tracks which bots already have deposit invoices

## How It Works

### Initial Service Creation
1. Customer creates service with 2 gardens
2. Backend creates 2 rental agreements (1 per garden)
3. When first agreement becomes active → deposit invoice created for 2 bots
4. Total: R299 × 2 = R598 + VAT = **R687.70**

### Amendment Flow
1. Customer adds 2 more gardens to existing service
2. Backend creates 2 new rental agreements for new gardens
3. When new agreements become active → system detects:
   - Already charged for: 2 bots
   - Total active bots: 4 bots
   - New bots to charge: 2 bots
4. Creates amendment deposit invoice for 2 new bots only
5. Invoice clearly marked as "Amendment Setup Fee for 2 Additional Bots"
6. Total: R299 × 2 = R598 + VAT = **R687.70**

## Technical Details

### Database Function Changes
**File**: `supabase/migrations/20251019220003_deposit_invoice_trigger.sql`

#### create_deposit_invoice()
- Now tracks how many bots already have deposit invoices
- Calculates difference between total bots and charged bots
- Only creates invoice for NEW bots
- Labels invoice as "Amendment" when applicable

#### trigger_create_deposit_invoice()
- Detects when new rental agreements are amendments
- Prevents duplicate deposits for same bots
- Logs clear messages about initial vs amendment invoices

### Key Logic

```sql
-- Count bots already charged
SELECT SUM(quantity) FROM invoices WHERE service_id = X AND notes LIKE '%Deposit%'

-- Count total active bots
SELECT COUNT(*) FROM rental_agreements WHERE service_id = X AND status = 'active'

-- New bots to charge = Total - Already Charged
IF new_bots > 0 THEN create_invoice_for_new_bots_only
```

## Invoice Details

### Amendment Deposit Invoice Includes:
- **Description**: "Bot Setup Fee - Amendment (Refundable Deposit)"
- **Details**: "Per bot: R299 × X bot(s) (new)"
- **Notes**: "Deposit Invoice - Amendment Setup Fee for X Additional Bot(s)"
- **Due Date**: 7 days from creation
- **Status**: 'sent' (PDF auto-generated)

## Benefits

1. **Fair Billing**: Customers only pay deposit for new bots, not re-charged for existing ones
2. **Automatic**: No manual intervention needed for amendments
3. **Transparent**: Invoices clearly show they're for amendments
4. **Prevents Fraud**: Can't add unlimited bots without deposits
5. **Audit Trail**: Each amendment gets its own deposit invoice

## Testing

### To Test Amendment Deposits:

```sql
-- 1. Create initial service with 2 gardens
-- 2. Check deposit invoice created for 2 bots
SELECT invoice_number, total_amount, notes 
FROM invoices 
WHERE notes LIKE '%Deposit%'
ORDER BY created_at DESC;

-- 3. Add 2 more gardens (amendment)
-- 4. Check new deposit invoice created for 2 NEW bots only
SELECT 
    i.invoice_number,
    i.total_amount,
    i.notes,
    (i.line_items->0->>'quantity')::INTEGER as bot_count,
    i.created_at
FROM invoices i
WHERE i.notes LIKE '%Deposit%'
ORDER BY i.created_at DESC;

-- Should see:
-- Invoice 1: 2 bots, "Initial Setup"
-- Invoice 2: 2 bots, "Amendment Setup Fee for 2 Additional Bots"
```

## Edge Cases Handled

1. **Multiple Amendments**: Each amendment creates separate deposit invoice
2. **Cancelled Invoices**: Excluded from "already charged" calculation
3. **Concurrent Amendments**: Uses SUM of quantities from all deposit invoices
4. **No Double Charging**: If all bots already have deposits, skips invoice creation

## Migration Impact

- ✅ No breaking changes to existing invoices
- ✅ Works with existing rental agreements
- ✅ Compatible with PDF generation trigger
- ✅ Integrates with existing billing workflow

## Related Files Modified

1. `supabase/migrations/20251019220003_deposit_invoice_trigger.sql` - Main logic
2. This summary document

## Support for Other Service Types

Currently implemented for:
- ✅ Garden services (bots)

Future enhancement needed for:
- ⏳ Pool services (if they have setup fees)
- ⏳ Security services
- ⏳ Weather stations

## Notes

- Setup fee per bot: **R299.00**
- Tax rate: **15% VAT**
- Total per bot: **R343.85**
- Due date: **7 days** from invoice creation
- Status: **'sent'** (triggers automatic PDF generation)

---

**Date**: October 19, 2025  
**Author**: AI Assistant  
**Status**: ✅ Implemented and Documented

