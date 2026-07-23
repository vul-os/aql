# Signature & PDF Generation Setup

## Overview

The service wizard now includes a signature step (Step 5) where users sign the rental agreement. After signing, a PDF is generated via your backend API.

## Database Storage

### Rental Agreements Table

The following fields are available in `rental_agreements`:

```sql
-- Signature storage
signature_image_url TEXT,          -- CDN URL to signature image
signature_ip_address INET,         -- IP when signed  
signature_user_agent TEXT,         -- Browser info
signed_at TIMESTAMPTZ,            -- Timestamp

-- PDF storage
agreement_pdf_url TEXT,            -- CDN URL to generated PDF
```

## Frontend Implementation

### Step 5: Contract & Signature

Located in: `src/pages/services/add-service-page.jsx`

**Features:**
- Agreement summary with pricing details
- Flexible contract benefits highlighted
- Link to full terms & conditions
- Canvas-based signature pad
- PDF generation status display
- View generated PDF button

### Signature Component

Located in: `src/components/services/signature-pad.jsx`

**Features:**
- HTML5 Canvas for signature capture
- High DPI support (2x resolution)
- Touch device support
- Clear/reset functionality
- Returns base64 PNG data URL

## Backend API Required

### POST `/api/generate-agreement-pdf`

**Request Body:**
```json
{
  "organizationId": "uuid",
  "locationId": "uuid",
  "pricing": {
    "number_of_bots": 2,
    "bot_rental_total": 300.00,
    "service_total": 300.00,
    "monthly_total": 600.00,
    "setup_fee": 650.00,
    "services_per_month": 4
  },
  "gardens": [
    {
      "name": "Garden 1",
      "area_sqm": "250"
    }
  ],
  "schedule": {
    "scheduleType": "weekly",
    "weeklyDays": [1, 3, 5],
    "preferredTime": "10:00"
  },
  "signature": "data:image/png;base64,...",
  "userInfo": {
    "userId": "uuid",
    "email": "user@example.com"
  }
}
```

**Response:**
```json
{
  "pdfUrl": "https://your-cdn.com/agreements/RA-2025-001234.pdf",
  "agreementNumber": "RA-2025-001234"
}
```

## Implementation Steps

### 1. Create Backend Endpoint

Create a backend API endpoint that:
1. Receives the agreement data and signature
2. Uploads signature image to CDN storage (e.g., Supabase Storage, AWS S3, Cloudinary)
3. Generates PDF with:
   - Company branding (BotKorp/Exolution Technologies)
   - Agreement terms and conditions
   - Pricing breakdown
   - Service details (gardens, schedule)
   - Embedded signature image
4. Uploads PDF to CDN storage
5. Returns both URLs

### 2. Update Frontend API URL

In `src/pages/services/add-service-page.jsx`, update:

```javascript
const response = await fetch('YOUR_BACKEND_URL/api/generate-agreement-pdf', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({...}),
});
```

Replace `YOUR_BACKEND_URL` with your actual backend URL.

### 3. PDF Generation Options

#### Option A: Supabase Edge Function (Recommended)

Create `/supabase/functions/generate-agreement-pdf/index.ts`:

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import puppeteer from 'https://deno.land/x/puppeteer@16.2.0/mod.ts'

serve(async (req) => {
  const data = await req.json()
  
  // 1. Upload signature to Supabase Storage
  const signatureBlob = dataURLtoBlob(data.signature)
  const signaturePath = `signatures/${data.userId}/${Date.now()}.png`
  await supabase.storage.from('agreements').upload(signaturePath, signatureBlob)
  const signatureUrl = supabase.storage.from('agreements').getPublicUrl(signaturePath).data.publicUrl
  
  // 2. Generate PDF using Puppeteer
  const browser = await puppeteer.launch()
  const page = await browser.newPage()
  await page.setContent(generateAgreementHTML(data, signatureUrl))
  const pdfBuffer = await page.pdf({ format: 'A4' })
  await browser.close()
  
  // 3. Upload PDF to Supabase Storage
  const pdfPath = `pdfs/${data.agreementNumber}.pdf`
  await supabase.storage.from('agreements').upload(pdfPath, pdfBuffer)
  const pdfUrl = supabase.storage.from('agreements').getPublicUrl(pdfPath).data.publicUrl
  
  return new Response(JSON.stringify({ pdfUrl, signatureUrl }))
})
```

#### Option B: Third-party PDF Service

Use services like:
- **PDFShift** - HTML to PDF API
- **DocRaptor** - PDF generation
- **CloudConvert** - Format conversion

#### Option C: Server-side Node.js

Use libraries:
- `puppeteer` - Chrome headless
- `pdfkit` - PDF generation
- `jsPDF` - Client-side alternative

### 4. Supabase Storage Setup

Create storage buckets:

```sql
-- Create storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('agreements', 'agreements', true);

-- Set policy to allow authenticated uploads
CREATE POLICY "Authenticated users can upload agreements"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'agreements');

-- Allow public read access
CREATE POLICY "Public read access for agreements"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'agreements');
```

### 5. Save URLs to Database

After PDF generation, save both URLs:

```sql
UPDATE rental_agreements
SET 
  signature_image_url = 'https://cdn.../signature.png',
  agreement_pdf_url = 'https://cdn.../agreement.pdf',
  signed_at = NOW(),
  status = 'active'
WHERE id = 'agreement-uuid';
```

## PDF Template

The generated PDF should include:

### Header
- BotKorp Logo
- "Bot Rental Agreement"
- Agreement Number (e.g., RA-2025-001234)

### Company Information
- **Company:** Exolution Technologies (Pty) Ltd
- **Trading As:** BotKorp (Pty) Ltd  
- **Address:** MAP HOUSE, Umbilo, Durban, 4061
- **Registration:** 2024/567890/07
- **VAT:** 4123456789

### Agreement Details
- Customer information (from profile)
- Service location
- Bot type and quantity
- Service frequency
- Pricing breakdown
- Billing date

### Terms & Conditions
- No long-term contract
- Cancel anytime with 30 days notice
- Pause service during winter
- R500 refundable deposit per bot
- Monthly billing terms

### Signature Section
- Customer signature (embedded image)
- Signed date
- IP address (for records)

## Testing

1. Sign agreement in Step 5
2. Check PDF generation status
3. Click "View PDF" to open in new tab
4. Verify PDF contains:
   - Correct company branding
   - Customer details
   - Pricing breakdown
   - Signature image
   - All terms

## Security Considerations

1. **Validate signature data** - Ensure base64 PNG format
2. **Rate limiting** - Prevent abuse of PDF generation
3. **Storage permissions** - Restrict access appropriately
4. **Audit trail** - Log all signature and PDF generation events
5. **IP tracking** - Store IP address for legal purposes

## Next Steps

1. Choose PDF generation method (Option A, B, or C)
2. Set up Supabase Storage buckets (or alternative CDN)
3. Create backend API endpoint
4. Update frontend API URL
5. Test complete signature → PDF → storage flow
6. Deploy backend function
7. Test in production

## Support

For issues or questions:
- Check Supabase Storage docs: https://supabase.com/docs/guides/storage
- Puppeteer docs: https://pptr.dev/
- Example implementation: See `/supabase/functions/generate-invoice-pdf/` (similar pattern)

