# BotKorp Edge Functions

Deno Edge Functions for Paystack payment processing.

## Functions

### 1. `get-authorization`
Verifies a card by charging R1 and returns Paystack authorization URL.

**Endpoint:** `/functions/v1/get-authorization`

**Request:**
```json
{
  "email": "user@example.com",
  "amount": 100,
  "metadata": {
    "organization_id": "uuid-here"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "authorization_url": "https://checkout.paystack.com/...",
    "access_code": "access_code_here",
    "reference": "ref_123456",
    "payment_id": "uuid"
  }
}
```

**Usage:**
1. Frontend calls this function to get authorization URL
2. User is redirected to Paystack payment page
3. User enters card details
4. Paystack charges R1 for verification
5. Webhook stores authorization code for future charges

---

### 2. `charge-authorization`
Charges an existing card authorization.

**Endpoint:** `/functions/v1/charge-authorization`

**Request:**
```json
{
  "authorization_code": "AUTH_code_from_db",
  "amount": 899.00,
  "email": "user@example.com",
  "description": "Monthly subscription - MowBot",
  "metadata": {
    "subscription_id": "uuid",
    "payment_type": "subscription"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "payment_id": "uuid",
    "reference": "TXN-123456",
    "amount": 899.00,
    "status": "completed",
    "transaction": { ... }
  }
}
```

**Usage:**
1. Fetch user's saved authorization from database
2. Call this function to charge the card
3. Payment is processed automatically
4. Database is updated with results

---

### 3. `paystack-webhook`
Handles Paystack webhook events.

**Endpoint:** `/functions/v1/paystack-webhook`

**Events Handled:**
- `charge.success` - Payment successful
- `charge.failed` - Payment failed
- Automatically updates database

**Setup:**
1. Configure in Paystack Dashboard: Settings → Webhooks
2. Add URL: `https://your-project.supabase.co/functions/v1/paystack-webhook`
3. Paystack will send events to this endpoint

---

## Setup

### 1. Set Environment Variables

Create `supabase/functions/.env`:
```bash
PAYSTACK_SECRET_KEY=sk_test_your_key_here
PAYSTACK_PUBLIC_KEY=pk_test_your_key_here
```

Or set via Supabase CLI:
```bash
supabase secrets set PAYSTACK_SECRET_KEY=sk_test_your_key_here
supabase secrets set PAYSTACK_PUBLIC_KEY=pk_test_your_key_here
```

### 2. Deploy Functions

```bash
# Deploy all functions
supabase functions deploy get-authorization
supabase functions deploy charge-authorization
supabase functions deploy paystack-webhook

# Or deploy all at once
supabase functions deploy
```

### 3. Configure Paystack Webhook

1. Login to Paystack Dashboard: https://dashboard.paystack.com
2. Go to Settings → Webhooks
3. Add webhook URL: `https://YOUR_PROJECT.supabase.co/functions/v1/paystack-webhook`
4. Select events: `charge.success`, `charge.failed`

### 4. Test Locally

```bash
# Start Supabase (includes Edge Functions runtime)
supabase start

# Serve a specific function
supabase functions serve get-authorization --env-file ./supabase/functions/.env

# Test with curl
curl -X POST http://localhost:54321/functions/v1/get-authorization \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com", "amount": 100}'
```

## Frontend Integration

### Get Authorization (Add Card)

```jsx
import { supabase } from '@/lib/supabase';

async function addPaymentMethod(email, organizationId) {
  const { data, error } = await supabase.functions.invoke('get-authorization', {
    body: {
      email,
      amount: 100, // R1.00 verification
      metadata: { organization_id: organizationId }
    }
  });

  if (error) throw error;

  // Redirect user to Paystack payment page
  window.location.href = data.data.authorization_url;
}
```

### Charge Authorization (Charge Card)

```jsx
import { supabase } from '@/lib/supabase';

async function chargeCard(authorizationCode, amount, email, description) {
  const { data, error } = await supabase.functions.invoke('charge-authorization', {
    body: {
      authorization_code: authorizationCode,
      amount,
      email,
      description,
      metadata: {
        payment_type: 'subscription'
      }
    }
  });

  if (error) throw error;
  return data;
}
```

### Delete Authorization (Remove Card)

```jsx
import { supabase } from '@/lib/supabase';

async function deletePaymentMethod(authorizationId) {
  const { data: { user } } = await supabase.auth.getUser();
  
  const { data, error } = await supabase.rpc('delete_payment_authorization', {
    p_authorization_id: authorizationId,
    p_user_id: user.id
  });

  if (error) throw error;
  return data; // Returns true if deleted
}
```

### Get User's Cards

```jsx
import { supabase } from '@/lib/supabase';

async function getUserCards() {
  const { data: { user } } = await supabase.auth.getUser();
  
  const { data, error } = await supabase.rpc('get_user_authorizations', {
    p_user_id: user.id
  });

  if (error) throw error;
  return data;
}
```

## Payment Flow

### 1. Add New Card (First Time)

```
User clicks "Add Card"
    ↓
Frontend calls get-authorization function
    ↓
Returns Paystack checkout URL
    ↓
User redirected to Paystack
    ↓
User enters card details
    ↓
Paystack charges R1 verification
    ↓
Paystack webhook fired (charge.success)
    ↓
Webhook stores authorization in database
    ↓
User redirected back to app
    ↓
Card saved and ready to use
```

### 2. Charge Existing Card (Recurring)

```
System needs to charge subscription
    ↓
Fetch user's default authorization from DB
    ↓
Call charge-authorization function
    ↓
Paystack processes charge
    ↓
Webhook updates payment status
    ↓
Database updated
    ↓
User notified
```

## Security

- ✅ Webhook signatures verified
- ✅ Row Level Security enabled
- ✅ Users can only access their own authorizations
- ✅ Soft delete (deleted_at timestamp)
- ✅ Failed attempt tracking
- ✅ Transaction logging

## Testing

### Test Cards (Paystack Test Mode)

```
Successful: 4084084084084081
Declined: 5060666666666666666
Insufficient Funds: 5061666666666666666
```

### Test the Flow

```bash
# 1. Get authorization
curl -X POST http://localhost:54321/functions/v1/get-authorization \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "amount": 100,
    "metadata": {"organization_id": "uuid-here"}
  }'

# 2. (User completes payment on Paystack)

# 3. Charge the authorization
curl -X POST http://localhost:54321/functions/v1/charge-authorization \
  -H "Authorization: Bearer YOUR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "authorization_code": "AUTH_code_from_webhook",
    "amount": 899.00,
    "email": "test@example.com",
    "description": "Monthly subscription"
  }'
```

## Monitoring

### View Payment Logs

```sql
-- Recent transactions
SELECT * FROM payment_transaction_logs
ORDER BY created_at DESC
LIMIT 50;

-- Failed payments
SELECT * FROM payments
WHERE status = 'failed'
ORDER BY created_at DESC;

-- Authorization usage stats
SELECT 
    authorization_code,
    card_type,
    last4,
    usage_count,
    failed_attempts,
    last_used_at
FROM payment_authorizations
WHERE user_id = 'user-uuid'
ORDER BY created_at DESC;
```

## Troubleshooting

### Webhook not receiving events
1. Check Paystack webhook URL is correct
2. Verify webhook is active in Paystack dashboard
3. Check Supabase function logs: `supabase functions logs paystack-webhook`

### Authorization not saved
1. Check webhook signature is valid
2. Verify charge.success event was received
3. Check database logs for errors

### Charge failed
1. Verify authorization is still active
2. Check card expiry date
3. Verify sufficient funds
4. Check authorization belongs to user

## Resources

- [Paystack API Docs](https://paystack.com/docs/api/)
- [Paystack Test Cards](https://paystack.com/docs/payments/test-payments/)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)

