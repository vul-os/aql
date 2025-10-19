# Cascade Delete Implementation for Services

## Overview
When a service is deleted, all related records (invoices, payments, deposits, etc.) are now automatically deleted through database-level cascade deletes.

## Problem
Previously, when deleting a service:
- Rental agreements were deleted (✓ already cascading)
- Invoices were **NOT deleted** (rental_agreement_id was set to NULL)
- Payments were **NOT deleted** (orphaned with invalid invoice_number)
- Deposits were **NOT deleted** (service_id was set to NULL)

This led to orphaned data and potential data integrity issues.

## Solution

### Migration: `20251019240000_fix_service_cascade_deletes.sql`

#### 1. Fixed `invoices.rental_agreement_id`
```sql
-- Changed from: ON DELETE SET NULL
-- Changed to:   ON DELETE CASCADE
ALTER TABLE invoices
DROP CONSTRAINT IF EXISTS invoices_rental_agreement_id_fkey;

ALTER TABLE invoices
ADD CONSTRAINT invoices_rental_agreement_id_fkey
FOREIGN KEY (rental_agreement_id)
REFERENCES rental_agreements(id)
ON DELETE CASCADE;
```

#### 2. Fixed `deposits.service_id`
```sql
-- Changed from: ON DELETE SET NULL
-- Changed to:   ON DELETE CASCADE
ALTER TABLE deposits
DROP CONSTRAINT IF EXISTS deposits_service_id_fkey;

ALTER TABLE deposits
ADD CONSTRAINT deposits_service_id_fkey
FOREIGN KEY (service_id)
REFERENCES services(id)
ON DELETE CASCADE;
```

#### 3. Added Payment Cleanup Trigger
Since `payments.invoice_number` is a TEXT field (not a proper FK), we added a trigger to clean up payments when invoices are deleted:

```sql
CREATE OR REPLACE FUNCTION cleanup_payments_on_invoice_delete()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM payments
    WHERE invoice_number = OLD.invoice_number;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_cleanup_payments_on_invoice_delete
    BEFORE DELETE ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION cleanup_payments_on_invoice_delete();
```

## Cascade Flow

When you delete a service, the following happens automatically:

```
DELETE FROM services WHERE id = '<service-id>'
    ↓
1. master_rental_agreements (CASCADE) - deleted
    ↓
2. rental_agreements (CASCADE) - deleted
    ↓
3. invoices (CASCADE) - deleted
    ↓
4. payment_attempts (CASCADE) - deleted
5. payments (TRIGGER) - deleted via cleanup trigger
    ↓
6. deposits (CASCADE) - deleted (direct from service)
7. service_appointments (CASCADE) - deleted (direct from service)
8. service_schedules (CASCADE) - deleted (direct from service)
9. gardens (CASCADE) - deleted (direct from service)
10. pools (CASCADE) - deleted (direct from service)
```

## Tables Affected

| Table | Relationship | Action |
|-------|-------------|--------|
| `rental_agreements` | `service_id` → `services(id)` | CASCADE (already configured) |
| `master_rental_agreements` | `service_id` → `services(id)` | CASCADE (already configured) |
| `invoices` | `rental_agreement_id` → `rental_agreements(id)` | CASCADE (**FIXED**) |
| `deposits` | `service_id` → `services(id)` | CASCADE (**FIXED**) |
| `payments` | `invoice_number` → `invoices.invoice_number` | TRIGGER (**ADDED**) |
| `payment_attempts` | `invoice_id` → `invoices(id)` | CASCADE (already configured) |
| `service_appointments` | `service_id` → `services(id)` | CASCADE (already configured) |
| `service_schedules` | `service_id` → `services(id)` | CASCADE (already configured) |
| `gardens` | `service_id` → `services(id)` | CASCADE (already configured) |
| `pools` | `service_id` → `services(id)` | CASCADE (already configured) |

## Testing

### Automated Test
Run the test migration:
```bash
psql -d your_database -f supabase/migrations/20251019240001_test_cascade_deletes.sql
```

This will:
1. Find a test service
2. Count all related records
3. Report what would be deleted (DRY RUN - doesn't actually delete)

### Manual Verification

After deleting a service, verify no orphaned records exist:

```sql
-- Check for orphaned rental_agreements (should return 0)
SELECT COUNT(*) as orphaned_agreements
FROM rental_agreements
WHERE service_id NOT IN (SELECT id FROM services WHERE id IS NOT NULL);

-- Check for orphaned invoices (should return 0)
SELECT COUNT(*) as orphaned_invoices
FROM invoices
WHERE rental_agreement_id IS NOT NULL
AND rental_agreement_id NOT IN (SELECT id FROM rental_agreements WHERE id IS NOT NULL);

-- Check for orphaned deposits (should return 0)
SELECT COUNT(*) as orphaned_deposits
FROM deposits
WHERE service_id IS NOT NULL
AND service_id NOT IN (SELECT id FROM services WHERE id IS NOT NULL);

-- Check for orphaned payments (should return 0)
SELECT COUNT(*) as orphaned_payments
FROM payments
WHERE invoice_number IS NOT NULL
AND invoice_number NOT IN (SELECT invoice_number FROM invoices WHERE invoice_number IS NOT NULL);
```

## Important Notes

⚠️ **Data Loss Warning**: Deleting a service will now permanently delete all related financial records (invoices, payments, deposits). Make sure this is the intended behavior.

### Recommended Best Practices

Instead of deleting services, consider:

1. **Soft Delete**: Set `status = 'cancelled'` instead of deleting
2. **Archive**: Move to an archive table before deletion
3. **Backup**: Always backup before bulk deletions

### Example: Safe Service Cancellation

```sql
-- Instead of: DELETE FROM services WHERE id = '<service-id>'
-- Do this:
UPDATE services 
SET status = 'cancelled',
    cancelled_at = NOW(),
    is_active = false
WHERE id = '<service-id>';
```

## Migration Files

1. **Main Migration**: `supabase/migrations/20251019240000_fix_service_cascade_deletes.sql`
   - Implements the cascade delete changes
   - Adds payment cleanup trigger
   - Includes verification output

2. **Test Script**: `supabase/migrations/20251019240001_test_cascade_deletes.sql`
   - Dry-run test of cascade behavior
   - Verification queries
   - Safe to run multiple times

## Deployment

To deploy these changes:

```bash
# Apply migrations
supabase db push

# Or if using manual deployment:
psql -d your_database -f supabase/migrations/20251019240000_fix_service_cascade_deletes.sql
```

## Rollback

If you need to rollback (restore SET NULL behavior):

```sql
-- Restore invoices to SET NULL
ALTER TABLE invoices
DROP CONSTRAINT IF EXISTS invoices_rental_agreement_id_fkey;

ALTER TABLE invoices
ADD CONSTRAINT invoices_rental_agreement_id_fkey
FOREIGN KEY (rental_agreement_id)
REFERENCES rental_agreements(id)
ON DELETE SET NULL;

-- Restore deposits to SET NULL
ALTER TABLE deposits
DROP CONSTRAINT IF EXISTS deposits_service_id_fkey;

ALTER TABLE deposits
ADD CONSTRAINT deposits_service_id_fkey
FOREIGN KEY (service_id)
REFERENCES services(id)
ON DELETE SET NULL;

-- Remove trigger
DROP TRIGGER IF EXISTS trigger_cleanup_payments_on_invoice_delete ON invoices;
DROP FUNCTION IF EXISTS cleanup_payments_on_invoice_delete();
```

## Support

For questions or issues, contact the development team or refer to:
- Database schema documentation
- Supabase migration logs
- This implementation guide

