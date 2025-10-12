# Service Fees from Database

All service fees are now stored in the database and can be fetched dynamically using the `useServiceFees` hook.

## Migration

The migration `20251012000010_ensure_service_fees.sql` creates:
- ✅ All service fees in the `service_fees` table
- ✅ `active_service_fees` view for easy querying
- ✅ `get_service_fee()` function for fetching specific fees
- ✅ `calculate_invoice_with_fees()` function for invoice calculations

## Hook Usage

### 1. Fetch All Active Fees

```jsx
import { useServiceFees } from '@/hooks/use-service-fees';

function ServiceFeesList() {
  const { fees, loading, error } = useServiceFees();

  if (loading) return <div>Loading fees...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      {fees.map(fee => (
        <div key={fee.id}>
          <h3>{fee.fee_name}</h3>
          <p>{fee.description}</p>
          <p>Amount: R{fee.amount}</p>
          <p>With Tax: R{fee.amount_with_tax}</p>
        </div>
      ))}
    </div>
  );
}
```

### 2. Fetch Specific Fee Type

```jsx
import { useServiceFees } from '@/hooks/use-service-fees';

function MaintenanceFees() {
  const { fees, loading } = useServiceFees({ feeType: 'maintenance' });

  return (
    <div>
      {fees.map(fee => (
        <div key={fee.id}>{fee.fee_name} - R{fee.amount}</div>
      ))}
    </div>
  );
}
```

### 3. Get Single Fee

```jsx
import { useServiceFee } from '@/hooks/use-service-fees';

function EmergencyCalloutFee() {
  const { fee, loading } = useServiceFee('emergency_callout');

  if (!fee) return null;

  return (
    <div>
      <h3>{fee.fee_name}</h3>
      <p>R{fee.amount_with_tax} (incl. VAT)</p>
    </div>
  );
}
```

### 4. Calculate Total with Fees

```jsx
import { supabase } from '@/lib/supabase';

async function calculateInvoice() {
  const { data } = await supabase.rpc('calculate_invoice_with_fees', {
    p_subtotal: 1000.00,
    p_fee_types: ['maintenance', 'late_payment']
  });

  console.log('Subtotal:', data[0].subtotal);
  console.log('Fees:', data[0].fees_total);
  console.log('Tax:', data[0].tax_total);
  console.log('Grand Total:', data[0].grand_total);
}
```

## Helper Functions

```jsx
import { 
  formatFeeAmount, 
  groupFeesByType, 
  calculateTotalFees 
} from '@/hooks/use-service-fees';

// Format amount
const formatted = formatFeeAmount(250.00, 'ZAR'); // "R 250.00"

// Group fees by type
const grouped = groupFeesByType(fees);
// Returns: { maintenance: [...], repair: [...], ... }

// Calculate total
const total = calculateTotalFees(fees, true); // Include tax
```

## Available Fee Types

- `maintenance` - Standard maintenance services
- `repair` - Repair services
- `emergency_callout` - 24/7 emergency response
- `installation` - Installation and setup
- `late_payment` - Late payment penalty
- `data_storage` - Data storage (per GB)
- `relocation` - Bot relocation service
- `training` - On-site training
- `upgrade` - Hardware upgrades
- `cancellation` - Early cancellation fee
- `api_access` - API access fee

## Database Functions

### get_service_fee(fee_type, bot_type)

```sql
-- Get emergency callout fee
SELECT * FROM get_service_fee('emergency_callout');

-- Get maintenance fee for specific bot type
SELECT * FROM get_service_fee('maintenance', 'mow_bot');
```

### calculate_invoice_with_fees(subtotal, fee_types)

```sql
-- Calculate invoice with maintenance and late payment fees
SELECT * FROM calculate_invoice_with_fees(
  1000.00,
  ARRAY['maintenance', 'late_payment']
);
```

## View: active_service_fees

Pre-calculated view with tax included:

```sql
SELECT * FROM active_service_fees;
```

Returns all active fees with:
- Base amount
- Tax amount
- Total with tax
- Metadata

## Update Fees

To update fees, create a new migration:

```sql
-- Example: Update maintenance fee
UPDATE service_fees 
SET amount = 300.00
WHERE fee_type = 'maintenance' 
  AND fee_name = 'Standard Maintenance';
```

## Testing

```bash
# Test fee retrieval
curl http://localhost:54321/rest/v1/active_service_fees \
  -H "apikey: YOUR_ANON_KEY"

# Test RPC function
curl -X POST http://localhost:54321/rest/v1/rpc/get_service_fee \
  -H "apikey: YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"p_fee_type": "maintenance"}'
```

