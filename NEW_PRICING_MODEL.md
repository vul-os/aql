# New Pricing Model Implementation

## Overview
Complete restructure of pricing: **Bot Rental + Service Fees** (separate charges)

---

## Pricing Structure

### Components:
1. **Bot Rental**: R150 per bot per month
   - 1 bot per garden/pool
   - Includes: Bot hardware, charging station, boundary wire/infrastructure
   
2. **Service Visits**: Variable price per visit
   - Includes: Edge trimming + bot swap/maintenance
   - Price depends on frequency and number of bots

### Examples (as requested):
- **2 bots + 1 service/month = R500**
  - Bot rental: 2 × R150 = R300
  - Service: 1 × R200 = R200
  - Total: R500

- **4 bots + 8 services/month = R1,750**
  - Bot rental: 4 × R150 = R600
  - Service: 8 × R143.75 = R1,150
  - Total: R1,750

---

## Database Tables

### 1. `pricing_structure`
Base pricing for bot types:
```sql
- bot_rental_monthly: DECIMAL (e.g., R150)
- service_price_per_visit: DECIMAL (e.g., R50-200)
- setup_fee: DECIMAL (one-time, per bot)
```

### 2. `service_tier_pricing`
Pre-calculated packages for common scenarios:
```sql
- number_of_bots: INTEGER
- services_per_month: INTEGER
- monthly_total: DECIMAL
- tier_name: TEXT
```

Tiers include:
- Single Garden Light (1 bot, 1 service): R300
- Two Gardens Light (2 bots, 1 service): R500
- Four Gardens Max (4 bots, 8 services): R1,750
- etc.

### 3. `rental_agreements`
Flexible agreements (NO contracts):
```sql
- agreement_number: TEXT (e.g., "RA-2025-001234")
- user_id, organization_id, location_id
- bot_type, number_of_bots, services_per_month
- monthly_total, bot_rental_total, service_total, setup_fee
- signer legal info (from profile)
- signature_image_url: TEXT (CDN URL)
- signature_ip_address, signature_user_agent, signed_at
- agreement_pdf_url: TEXT (CDN URL to PDF)
- status: 'draft', 'active', 'paused', 'cancelled'
- paused_at, cancelled_at, pause_reason, cancellation_reason
```

---

## Database Functions

### 1. `get_tier_pricing(bot_type, number_of_bots, services_per_month)`
Returns pricing breakdown:
```json
{
  "monthly_total": 500,
  "bot_rental_total": 300,
  "service_total": 200,
  "bot_rental_per_bot": 150,
  "service_price_per_visit": 200,
  "number_of_bots": 2,
  "services_per_month": 1,
  "tier_name": "Two Gardens Light",
  "setup_fee": 598
}
```

### 2. `create_rental_agreement(...)`
Creates agreement with user's legal info:
- Pulls first_name, surname, id_number, address, phone from profile
- Validates legal_profile_completed = true
- Generates agreement number (RA-YYYY-NNNNNN)
- Stores signature image URL
- Sets status based on signature presence

### 3. `pause_rental_agreement(agreement_id, reason)`
Pauses active agreement - for winter, travel, etc.

### 4. `resume_rental_agreement(agreement_id)`
Reactivates paused agreement.

### 5. `cancel_rental_agreement(agreement_id, reason)`
Cancels agreement permanently.

---

## Frontend Updates

### Price Calculator Component
**Old Structure:**
```
Monthly Rate: R899
Setup Fee: R299
Total First Month: R1,198
```

**New Structure:**
```
┌─────────────────────────────────────┐
│ Bot Rental                          │
│ 2 bots × R150/month = R300          │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Service Visits                      │
│ 1 visit × R200 = R200               │
│ (edge trimming + bot swap)          │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Monthly Total: R500/month           │
│ ✓ Pause or cancel anytime           │
│ ✓ No long-term contracts            │
│ ✓ Winter pause available            │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ One-Time Setup Fee: R598            │
│ (2 bots × R299 each)                │
└─────────────────────────────────────┘

First Month Total: R1,098
```

### Service Wizard Updates
**New Final Step: Signature**

Before final submission:
1. Show pricing breakdown
2. Show rental agreement terms
3. Signature canvas (draw/upload signature)
4. Capture IP address & user agent
5. Create agreement in DB
6. PDF generation (placeholder for now - just store URL field)

---

## Flexibility Features

### No Contracts
- ✅ Month-to-month only
- ✅ Cancel anytime (no penalty)
- ✅ Pause anytime (no penalty)

### Winter Pause
**Visual:** Show winter graphic/illustration

**Message:**
"Going away for winter? No problem! Pause your service anytime. We'll:
- Collect the bots for storage
- Leave the infrastructure in place (boundary wire, charging station)
- Resume service whenever you're ready

No fees, no hassle, full flexibility."

**Implementation:**
- User clicks "Pause Service"
- Select reason: "Winter break", "Travel", "Other"
- Agreement status → 'paused'
- Billing stops
- Bots collected within 1 week

**Resume:**
- User clicks "Resume Service"
- Agreement status → 'active'
- Bots redeployed within 1 week
- Billing resumes

---

## Migration Files

### 1. `20251017000004_new_pricing_structure.sql`
- Creates `pricing_structure` table
- Creates `service_tier_pricing` table
- Inserts default pricing tiers
- Creates `get_tier_pricing()` function
- Test data for 2 bots + 1 service = R500, 4 bots + 8 services = R1,750

### 2. `20251017000005_rental_agreements.sql`
- Creates `rental_agreements` table
- Creates `create_rental_agreement()` function
- Creates `pause_rental_agreement()` function
- Creates `resume_rental_agreement()` function
- Creates `cancel_rental_agreement()` function
- Creates `generate_agreement_number()` function

---

## Frontend Components to Update

### 1. `PriceCalculator.jsx` ✅ (in progress)
- Update to use `get_tier_pricing()` RPC
- Show bot rental + service breakdown
- Display per-garden/bot pricing
- Add flexibility messaging

### 2. `ScheduleSelector.jsx`
- Update pricing display to use new structure
- Show service visit pricing

### 3. Service Wizard (`add-service-page.jsx`)
- **New Final Step**: Signature
- Show agreement terms
- Signature canvas
- Submit with signature
- Create rental_agreement

### 4. Dashboard/Settings
- Show active agreements
- "Pause Service" button
- "Cancel Service" button
- "Resume Service" button (if paused)
- Winter pause messaging

---

## User Experience Flow

### New Service Creation:
```
1. Select Location
   ↓
2. Select Service Type (garden/pool)
   ↓
3. Add Garden Details (area, count)
   ↓
4. Set Schedule (services per month)
   ↓
5. Review Pricing
   - Bot Rental: X bots × R150 = RX
   - Service: Y visits × RZ = RY
   - Total: R(X+Y)/month
   ↓
6. 🆕 Sign Agreement
   - View terms
   - Draw/upload signature
   - Accept terms
   ↓
7. Complete!
   - Agreement created
   - Status: active
   - First service scheduled
```

### Pause Service (Winter):
```
Dashboard → My Services → "Pause"
   ↓
Select reason: "Winter break"
   ↓
Confirm: "We'll collect bots, leave infrastructure"
   ↓
Status: paused
Billing: stopped
   ↓
(Later) "Resume Service" → active again
```

---

## Benefits

### For Users:
✅ **Clear Pricing**: Separate bot rental vs service costs
✅ **Flexibility**: No contracts, pause/cancel anytime
✅ **Per-Garden Transparency**: See exactly what each garden costs
✅ **Winter Pause**: Don't pay when you don't need service
✅ **No Surprises**: All costs shown upfront

### For Business:
✅ **Scalable**: Easy to adjust pricing
✅ **Upsell Potential**: Users see value of more frequent service
✅ **Customer Retention**: Flexibility builds trust
✅ **Seasonal Management**: Winter pause prevents cancellations
✅ **Legal Clarity**: Signed agreements with all details

---

## Winter Pause Graphics/Messaging Ideas

### Visual Elements:
```
🌨️ ❄️ ☃️ Winter illustrations
🤖 → 📦 Bot going into storage
🏠 Infrastructure stays (boundary wire, charging station)
📅 Calendar showing pause period
```

### Messaging:
```
"Winter is Coming? We've Got You Covered!"

• Pause your service anytime, no questions asked
• We collect the bots and store them safely
• Your infrastructure stays in place
• Resume whenever you're ready
• No fees, no penalties, no hassle

It's your service, your way. 🌟
```

---

## Deployment Checklist

- [ ] Apply migrations (pricing structure + rental agreements)
- [ ] Update PriceCalculator component
- [ ] Update ScheduleSelector component
- [ ] Add signature step to wizard
- [ ] Add pause/cancel buttons to dashboard
- [ ] Create winter pause UI/graphics
- [ ] Test agreement creation
- [ ] Test pause/resume flow
- [ ] Test cancel flow
- [ ] Update documentation

---

**Status:** Database complete, frontend in progress
**Date:** October 17, 2025
**Key Change:** No contracts! Full flexibility with pause/cancel anytime

