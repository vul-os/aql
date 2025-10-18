# ✅ Simplified Pricing System

## 🎯 Simplified: Just Mow Bot + Edge Trimming

Per your request, the pricing has been simplified to focus on the core offering.

---

## 💰 Pricing Structure

### **Mow Bot (Only Bot Type)**

**Base Pricing:**
- **Bot Rental:** R150/month per bot
- **Setup Fee:** R299 per bot (one-time)
- **Area Pricing:** First 100m² included, then R0.50/m² over

**Line Items (Per Visit):**
- **Edge Trimming:** R100/visit (required)

---

## 📊 Pricing Examples

### **Example 1: Single Lawn**
```
Configuration:
- 1 bot
- 4 visits/month
- 150m² lawn

Calculation:
- Bot Rental: R150
- Edge Trimming: R400 (4 × R100)
- Area Surcharge: R25 ((150-100) × R0.50)
= R575/month
+ R299 setup (one-time)
```

### **Example 2: Multiple Lawns**
```
Configuration:
- 2 bots (2 lawns)
- 4 visits/month each
- 120m² + 180m² lawns

Calculation:
- Bot Rental: R300 (2 × R150)
- Edge Trimming: R800 (2 × 4 × R100)
- Area Surcharge: R50 ((120-100)×R0.50 + (180-100)×R0.50)
= R1,150/month
+ R598 setup (one-time)
```

---

## 🧪 Test Pricing

### **Database Query:**

```sql
-- Get full pricing details
SELECT * FROM get_full_pricing('mow_bot');

-- Calculate for 2 bots, 4 visits/month
SELECT * FROM get_tier_pricing('mow_bot', 2, 4);

-- Expected result:
{
  "bot_rental_total": 300,
  "service_total": 800,
  "monthly_total": 1100,
  "setup_fee": 598
}
```

### **Frontend API:**

```bash
# Get pricing
curl "https://your-backend/api/pricing?bot_type=mow_bot"

# Calculate
curl -X POST https://your-backend/api/calculate-pricing \
  -H "Content-Type: application/json" \
  -d '{
    "number_of_bots": 2,
    "services_per_month": 4,
    "bot_type": "mow_bot"
  }'
```

---

## 🎯 Adding More Later

The system is flexible - you can easily add more:

### **Add New Bot Types:**

```sql
-- Add pool bot
INSERT INTO pricing_plans (bot_type, name, bot_rental_monthly, setup_fee, description) 
VALUES ('pool_bot', 'Pool Package', 150.00, 299.00, 'Pool cleaning');

-- Add line items
INSERT INTO pricing_line_items (pricing_plan_id, item_type, name, price_per_unit) 
SELECT id, 'water_testing', 'Water Testing', 50.00
FROM pricing_plans WHERE bot_type = 'pool_bot';
```

### **Add New Services to Mow Bot:**

```sql
-- Add bot swap service
INSERT INTO pricing_line_items (pricing_plan_id, item_type, name, price_per_unit, is_optional) 
SELECT id, 'bot_swap', 'Bot Swap', 35.00, true
FROM pricing_plans WHERE bot_type = 'mow_bot';
```

---

## 📋 Current Seed Data

### **Pricing:**
- ✅ 1 pricing plan (mow_bot)
- ✅ 1 line item (edge_trimming)
- ✅ 4 promotional discounts

### **Sample Data:**
- ✅ 3 Organizations
- ✅ 3 Locations
- ✅ 8 Bots
- ✅ 5 Services
- ✅ 5 Gardens (linked to services)
- ✅ 4 Pools (linked to services)
- ✅ 5 Coverage areas (SA cities)
- ❌ No organization members (will be created when users sign up)

---

## ✅ Benefits of Simple Pricing

1. **Clear Value Proposition**
   - R150/month bot rental
   - R100/visit edge trimming
   - R299 setup fee
   - Easy to understand

2. **Easy to Quote**
   - Customer knows exactly what they pay
   - No confusion about multiple services
   - Transparent pricing

3. **Room to Grow**
   - Add optional services later
   - Introduce new bot types gradually
   - Test market with simple offering first

---

## 🚀 Ready to Deploy

**Simplified pricing:**
- ✅ Just mow_bot
- ✅ Just edge_trimming
- ✅ Clean and simple
- ✅ Easy to expand later

**Fixed seed data:**
- ✅ No fake user IDs
- ✅ Members created via auth trigger
- ✅ All foreign keys valid

**Try migrations:**
```bash
supabase db reset
```

Should work perfectly now! 🎉

