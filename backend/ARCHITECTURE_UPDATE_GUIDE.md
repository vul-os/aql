# Backend Architecture Update Guide

## 🎯 Current State
The backend generates ONE PDF per request.

## ✅ New Required Behavior
Generate MULTIPLE PDFs from ONE signature:
- User signs ONCE
- Backend creates 1 Master Agreement + N Bot Agreements
- Generates N PDF documents (1 per bot)

## 🔧 Backend Changes Needed

### 1. Update `/api/generate-agreement-pdf` Endpoint

**OLD Request:**
```json
{
  "user_id": "uuid",
  "number_of_bots": 2,
  "services_per_month": 4,
  "signature_base64": "..."
}
```

**NEW Request:**
```json
{
  "service_id": "uuid",
  "user_id": "uuid",
  "organization_id": "uuid",
  "location_id": "uuid",
  "gardens": [
    {"id": "uuid", "name": "Front Lawn", "area_sqm": 150},
    {"id": "uuid", "name": "Back Garden", "area_sqm": 200}
  ],
  "services_per_month": 4,
  "signature_base64": "..."
}
```

**NEW Response:**
```json
{
  "success": true,
  "master_agreement_id": "uuid",
  "master_agreement_number": "MA-2025-123456",
  "signature_url": "https://...",
  "bot_agreements": [
    {
      "id": "uuid",
      "agreement_number": "RA-2025-001",
      "pdf_url": "https://...",
      "garden_name": "Front Lawn",
      "bot_number": 1
    },
    {
      "id": "uuid",
      "agreement_number": "RA-2025-002",
      "pdf_url": "https://...",
      "garden_name": "Back Garden",
      "bot_number": 2
    }
  ],
  "total_documents": 2
}
```

### 2. Update `create_rental_agreement()` Function

Add parameters:
```python
def create_rental_agreement(
    master_agreement_id,  # NEW
    service_id,           # NEW
    garden_id,            # NEW
    bot_id=None,          # NEW
    agreement_number,
    user_id,
    organization_id,
    location_id,
    pricing,
    profile,
    auth_user,
    signature_url
):
    agreement_data = {
        'master_agreement_id': master_agreement_id,  # NEW
        'service_id': service_id,                    # NEW
        'garden_id': garden_id,                      # NEW
        'bot_id': bot_id,                            # NEW
        'agreement_number': agreement_number,
        'user_id': user_id,
        # ... rest of fields
        'number_of_bots': 1,  # Always 1 (per bot agreement)
        # ...
    }
```

### 3. Update PDF Template

Add to agreement template:
```html
<p><strong>Master Agreement:</strong> {{ master_agreement_number }}</p>
<p><strong>Garden:</strong> {{ garden_name }} ({{ garden_area }} m²)</p>
<p><strong>Bot Number:</strong> {{ bot_number }} of {{ total_bots }}</p>
```

### 4. New Flow

```python
# 1. Upload signature ONCE
signature_url = upload_signature(...)

# 2. Create Master Agreement
master = create_master_agreement(service_id, user_id, signature_url)

# 3. Loop through gardens
for i, garden in enumerate(gardens):
    # Calculate pricing for 1 bot
    pricing = calculate_pricing(1, services_per_month)
    
    # Create bot rental agreement
    agreement = create_rental_agreement(
        master_agreement_id=master['id'],
        service_id=service_id,
        garden_id=garden['id'],
        ...
    )
    
    # Generate PDF
    pdf = generate_pdf(agreement, garden, i+1, len(gardens))
    
    bot_agreements.append(pdf_info)

# 4. Return all agreements
return {bot_agreements: [...]}
```

## 📝 Summary

**Backend must:**
1. ✅ Accept gardens array
2. ✅ Create master agreement record
3. ✅ Loop through gardens
4. ✅ Create 1 rental agreement per garden
5. ✅ Generate 1 PDF per garden
6. ✅ Return array of all PDFs

This matches the new database architecture!

