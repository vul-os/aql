# Flexible Service Pricing System

## Overview
Implemented a **flexible pricing structure** that handles **any number of services per month from 1 to 8** (maximum twice per week), not just the fixed tiers (4, 8, 12). This gives users freedom to choose their schedule within practical limits and automatically get the best pricing for their selection.

---

## Key Features

### 1. **Tiered Pricing Structure (1-8 Services Max)**
Users get better value per service as they commit to more services:

| Tier | Services/Month | Price per Service | Monthly Total | Savings vs Pay-As-You-Go |
|------|----------------|-------------------|---------------|--------------------------|
| **Pay-As-You-Go** | 1 | R350.00 | R350 | - |
| **Light** | 2-3 | R250.00 | R500-R750 | Up to R300/mo |
| **Standard (Weekly)** | 4 | R224.75 | R899 | R501/mo |
| **Value** | 5-7 | R210.00 | R1,050-R1,470 | Up to R980/mo |
| **Premium (2x Weekly)** | 8 (MAX) | R196.88 | R1,575 | R1,225/mo |

**Note:** Maximum 8 services per month (twice per week) is the highest tier supported.

### 2. **Automatic Tier Selection**
- User picks their desired schedule (any combination of days)
- System calculates estimated monthly services
- Pricing tier is automatically applied
- No manual tier selection needed!

### 3. **Visual Pricing Comparison**
Shows users the **3 most popular plans** (4x, 8x, 12x monthly) so they can see the value of upgrading or downgrading their schedule.

### 4. **Real-time Savings Display**
- Shows exact savings vs pay-as-you-go pricing
- Displays cost per service
- Calculates monthly total automatically
- Updates instantly as schedule changes

---

## Implementation Details

### Frontend (`schedule-selector.jsx`)
```javascript
// Flexible pricing function - handles any service count
const getPricingForServices = (serviceCount) => {
  const pricingTiers = [
    { min: 1, max: 1, pricePerService: 350, tierName: 'Pay-As-You-Go' },
    { min: 2, max: 3, pricePerService: 250, tierName: 'Light' },
    { min: 4, max: 4, pricePerService: 224.75, tierName: 'Standard (Weekly)' },
    // ... more tiers
  ];
  
  // Find tier and calculate pricing
  const tier = pricingTiers.find(t => serviceCount >= t.min && serviceCount <= t.max);
  return {
    totalPrice: tier.basePrice || (tier.pricePerService * serviceCount),
    pricePerService: tier.pricePerService,
    tierName: tier.tierName,
    savingsVsPayAsYouGo: (350 - tier.pricePerService) * serviceCount
  };
};
```

### Backend (`20251017000001_add_flexible_service_pricing.sql`)
```sql
-- Database table for pricing tiers
CREATE TABLE service_pricing_tiers (
    bot_type TEXT NOT NULL,
    min_services INTEGER NOT NULL,
    max_services INTEGER NOT NULL,
    base_price DECIMAL(10, 2) NOT NULL,
    price_per_service DECIMAL(10, 2) NOT NULL,
    discount_percentage DECIMAL(5, 2),
    tier_name TEXT
);

-- Function to calculate price for any service count
CREATE FUNCTION calculate_service_price(
    p_bot_type TEXT,
    p_services_count INTEGER
) RETURNS JSON;

-- Function to get all available tiers
CREATE FUNCTION get_pricing_tiers(
    p_bot_type TEXT
) RETURNS TABLE(...);
```

---

## User Experience Flow

### Example: User wants 3 services per month

1. **User selects schedule:**
   - Picks 3 specific days in the month
   - Or chooses "Quick Select: Twice Monthly" then adds one more day

2. **System calculates:**
   - Estimated services: 3/month
   - Tier: "Light" (2-3 services)
   - Price per service: R250
   - Monthly total: R750

3. **User sees:**
   ```
   Selected plan: Light
   Services per month: 3
   Cost per service: R250.00
   
   ✓ Great value! You're saving R300.00/month compared to 
     pay-as-you-go pricing (R350 per service).
   
   Your monthly total: R750.00
   (3 services × R250.00)
   ```

4. **Popular plans shown:**
   - Weekly (4x) - R899 - Save R501/mo
   - Bi-weekly (8x) - R1,575 - Save R1,225/mo ⭐ Best value
   - 3x Weekly (12x) - R2,250 - Save R1,950/mo

---

## Benefits

### For Users:
✅ **Complete flexibility** - pick any schedule they want
✅ **Transparent pricing** - see exactly what they're paying
✅ **Automatic optimization** - always get best rate for their selection
✅ **Clear savings** - see how much they save vs pay-as-you-go
✅ **Easy upgrades** - see value of more frequent service

### For Business:
✅ **Encourages higher tiers** - users see the value clearly
✅ **Reduces support** - pricing is automatic and transparent
✅ **Scalable** - supports any future pricing changes
✅ **Database-driven** - can update prices without code changes

---

## Database Schema

### `service_pricing_tiers` Table
```sql
- id: UUID (primary key)
- bot_type: TEXT (mow_bot, pool_bot, security_bot)
- min_services: INTEGER (minimum services in tier)
- max_services: INTEGER (maximum services in tier)
- base_price: DECIMAL (fixed price for this tier, if applicable)
- price_per_service: DECIMAL (cost per individual service)
- discount_percentage: DECIMAL (percentage discount vs base rate)
- tier_name: TEXT (display name)
- description: TEXT (tier description)
- is_active: BOOLEAN (enable/disable tiers)
```

### Functions
- `calculate_service_price(bot_type, services_count)` - Get pricing for any service count
- `get_pricing_tiers(bot_type)` - List all available tiers with savings comparison

---

## Testing

To test different scenarios:

1. **Select 1 service** → Should see "Pay-As-You-Go" at R350
2. **Select 3 services** → Should see "Light" at R250/service = R750
3. **Select 4 services** → Should see "Standard (Weekly)" at R899
4. **Select 6 services** → Should see "Value" at R210/service = R1,260
5. **Select 8 services** → Should see "Premium (Bi-weekly)" at R1,575
6. **Select 12 services** → Should see "Elite (3x Weekly)" at R2,250

Each should show:
- Correct tier name
- Accurate per-service cost
- Savings vs pay-as-you-go
- Total monthly price

---

## Future Enhancements

### Possible additions:
1. **Dynamic pricing** based on:
   - Garden size
   - Location
   - Seasonal demand

2. **Bundle discounts**:
   - Multiple properties
   - Multiple bot types

3. **Loyalty rewards**:
   - Long-term customer discounts
   - Referral bonuses

4. **Promotional pricing**:
   - First month discount
   - Holiday specials

---

## Migration Steps

To apply the new pricing system:

```bash
# 1. Apply database migration
cd supabase
supabase db push

# 2. Or manually run:
psql -h your-db-host -U postgres -d your-db-name \
  -f migrations/20251017000001_add_flexible_service_pricing.sql

# 3. Verify tables created
psql> \dt service_pricing_tiers
psql> SELECT * FROM service_pricing_tiers WHERE bot_type = 'mow_bot';

# 4. Test pricing function
psql> SELECT calculate_service_price('mow_bot', 3);
```

Frontend will automatically use the new pricing logic on next deployment.

---

## Pricing Strategy Rationale

### Why these tiers?

1. **Pay-As-You-Go (R350)**: Premium for flexibility, discourages sporadic use
2. **Light (R250)**: 29% discount for minimal commitment (2-3x/month)
3. **Standard/Weekly (R225)**: 36% discount for regular weekly service
4. **Value (R210)**: 40% discount for above-weekly service
5. **Premium/Bi-weekly (R197)**: 44% discount for serious commitment
6. **Pro (R185)**: 47% discount for heavy users
7. **Elite (R188)**: 46% discount for maximum service (slight increase from Pro due to logistics)

### Volume discounting:
- Rewards commitment
- Ensures consistent revenue
- Reduces operational complexity (predictable scheduling)
- Encourages users to see value in more services

---

## Support & Maintenance

### To update pricing:
1. Update `service_pricing_tiers` table in database
2. Frontend automatically reflects new prices
3. No code deployment needed

### To add new bot types:
1. Insert rows for new bot_type in `service_pricing_tiers`
2. Update frontend bot type list if needed

### To disable a tier:
```sql
UPDATE service_pricing_tiers 
SET is_active = false 
WHERE tier_name = 'Light' AND bot_type = 'mow_bot';
```

---

## Summary

✅ **Flexible** - handles ANY number of services (1-20+)
✅ **Transparent** - users see exactly what they pay
✅ **Scalable** - database-driven, easy to update
✅ **User-friendly** - automatic tier selection, clear savings
✅ **Business-smart** - encourages higher tiers with clear value proposition

Users can now pick **exactly** the schedule they want (e.g., 3 services, 7 services, 15 services) and the system automatically prices it correctly with the appropriate tier and savings displayed.

