# 📦 Storage and PDF Generation Setup Guide

Complete guide to setting up Supabase Storage and PDF generation for BotKorp rental agreements and invoices.

## 🚀 Quick Start

```bash
# 1. Apply storage migration
npx supabase db push

# 2. Deploy PDF generation function
npx supabase functions deploy generate-agreement-pdf

# 3. Test the setup
npx supabase functions serve generate-agreement-pdf
```

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Storage Buckets Setup](#storage-buckets-setup)
3. [Edge Function Deployment](#edge-function-deployment)
4. [PDF Generation Options](#pdf-generation-options)
5. [Frontend Integration](#frontend-integration)
6. [Testing](#testing)
7. [Troubleshooting](#troubleshooting)

## Prerequisites

- ✅ Supabase project created
- ✅ Supabase CLI installed (`npm install -g supabase`)
- ✅ Project linked: `npx supabase link --project-ref YOUR_PROJECT_REF`
- ✅ Database migrations up to date

## Storage Buckets Setup

### Option 1: Using Migration (Recommended)

The storage buckets are created automatically when you apply migrations:

```bash
# Apply all migrations including storage setup
npx supabase db push
```

This creates:
- ✅ `agreements` bucket - Rental agreement PDFs
- ✅ `signatures` bucket - Customer signature images  
- ✅ `invoices` bucket - Monthly invoice PDFs
- ✅ Row Level Security (RLS) policies for each bucket

### Option 2: Manual Setup via CLI

If you prefer manual setup:

```bash
# Create buckets
npx supabase storage create agreements --public false
npx supabase storage create signatures --public false
npx supabase storage create invoices --public false
```

Then apply the policies from the migration file.

### Verify Buckets

Check that buckets were created:

```bash
npx supabase storage list
```

Expected output:
```
agreements (private)
signatures (private)
invoices (private)
```

## Edge Function Deployment

### 1. Deploy the Function

```bash
# Deploy to production
npx supabase functions deploy generate-agreement-pdf

# Or deploy with custom configuration
npx supabase functions deploy generate-agreement-pdf \
  --verify-jwt \
  --import-map functions/import_map.json
```

### 2. Set Secrets (if using external PDF service)

If using PDFShift or another external service:

```bash
# Set PDFShift API key
npx supabase secrets set PDFSHIFT_API_KEY=your_api_key_here

# View all secrets
npx supabase secrets list
```

### 3. Verify Deployment

```bash
# Check function status
npx supabase functions list

# View function logs
npx supabase functions logs generate-agreement-pdf
```

## PDF Generation Options

The Edge Function needs a PDF generation method. Choose one:

### Option A: PDFShift (Easiest - Recommended for Production)

**Pros:** Simple, reliable, no server setup
**Cons:** Costs ~$9/month for 1000 PDFs

1. Sign up at https://pdfshift.io
2. Get API key from dashboard
3. Set secret:
   ```bash
   npx supabase secrets set PDFSHIFT_API_KEY=pk_test_xxxxx
   ```
4. Update the `generatePDFFromHTML` function in `index.ts`:

```typescript
async function generatePDFFromHTML(html: string): Promise<Uint8Array> {
  const pdfShiftApiKey = Deno.env.get('PDFSHIFT_API_KEY');
  
  const response = await fetch('https://api.pdfshift.io/v3/convert/pdf', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(pdfShiftApiKey + ':')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ 
      source: html,
      format: 'A4',
      margin: '20mm'
    }),
  });
  
  if (!response.ok) {
    throw new Error(`PDFShift error: ${await response.text()}`);
  }
  
  return new Uint8Array(await response.arrayBuffer());
}
```

### Option B: Puppeteer with Deno (Free - More Complex)

**Pros:** Free, full control
**Cons:** Requires Chrome/Chromium setup

1. Update `import_map.json`:
```json
{
  "imports": {
    "puppeteer": "https://deno.land/x/puppeteer@16.2.0/mod.ts"
  }
}
```

2. Update function:
```typescript
import puppeteer from "puppeteer";

async function generatePDFFromHTML(html: string): Promise<Uint8Array> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  
  const pdf = await page.pdf({
    format: 'A4',
    margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
    printBackground: true
  });
  
  await browser.close();
  return pdf;
}
```

3. Deploy with Docker (requires self-hosting):
```dockerfile
FROM denoland/deno:1.37.0

# Install Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY . .
CMD ["deno", "run", "--allow-all", "index.ts"]
```

### Option C: PDF.co API (Middle Ground)

**Pros:** Good balance of ease and cost
**Cons:** ~$20/month

Similar to PDFShift but with more features:

```bash
npx supabase secrets set PDFCO_API_KEY=your_key_here
```

### Option D: Client-Side Generation (Quick Start)

**Pros:** No server setup, free
**Cons:** Client-side processing, less control

Use in frontend with jsPDF or pdfmake:

```javascript
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

const pdf = new jsPDF();
// Generate PDF on client
// Upload to storage using Supabase client
```

## Frontend Integration

Update `src/pages/services/add-service-page.jsx`:

```javascript
const handleGeneratePDF = async () => {
  try {
    setGeneratingPdf(true);

    const response = await fetch(
      `${supabaseUrl}/functions/v1/generate-agreement-pdf`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({
          rental_agreement_id: rentalAgreement.id,
          user_id: user.id,
          signature_base64: formData.signature,
          rental_agreement: {
            organization_id: selectedOrg.organization_id,
            location_id: formData.locationId,
            number_of_bots: formData.gardens.length,
            monthly_rental_fee: calculatedPricing.bot_rental_total,
            service_fee_per_visit: calculatedPricing.service_price_per_visit,
            services_per_month: calculatedPricing.services_per_month,
            deposit_total: formData.gardens.length * 500,
            billing_day: formData.billingDay || 1,
            start_date: new Date().toISOString(),
            agreement_terms: null // Use default
          },
          user_profile: profile,
          location: locations.find(l => l.id === formData.locationId)
        })
      }
    );

    const data = await response.json();
    
    if (data.success) {
      // Store URLs
      setFormData({
        ...formData,
        signatureUrl: data.signature_url,
        pdfUrl: data.pdf_url
      });
      
      toast({
        title: 'PDF Generated! 📄',
        description: 'Your agreement is ready to download.'
      });
    }
  } catch (error) {
    console.error('PDF generation error:', error);
    toast({
      title: 'Error',
      description: 'Failed to generate PDF. Please try again.',
      variant: 'destructive'
    });
  } finally {
    setGeneratingPdf(false);
  }
};
```

## Testing

### Local Testing

1. Start local Supabase:
```bash
npx supabase start
```

2. Serve function locally:
```bash
npx supabase functions serve generate-agreement-pdf
```

3. Test with curl:
```bash
curl -X POST http://localhost:54321/functions/v1/generate-agreement-pdf \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d '{
    "rental_agreement_id": "test-uuid",
    "user_id": "test-user-uuid",
    "signature_base64": "data:image/png;base64,iVBORw0KG...",
    "rental_agreement": {
      "organization_id": "org-uuid",
      "location_id": "loc-uuid",
      "number_of_bots": 2,
      "monthly_rental_fee": 300,
      "service_fee_per_visit": 150,
      "services_per_month": 4,
      "deposit_total": 1000,
      "billing_day": 15,
      "start_date": "2025-10-17"
    },
    "user_profile": {
      "legal_first_name": "John",
      "legal_surname": "Doe",
      "id_number": "8001015009083",
      "phone_number": "+27821234567",
      "legal_address_line1": "123 Main St",
      "legal_city": "Durban",
      "legal_province": "KwaZulu-Natal",
      "legal_postal_code": "4001"
    },
    "location": {
      "name": "Home",
      "address": "123 Main St, Durban",
      "city": "Durban",
      "province": "KwaZulu-Natal"
    }
  }'
```

### Production Testing

```bash
# Invoke function in production
npx supabase functions invoke generate-agreement-pdf \
  --body '{"rental_agreement_id":"test"}' \
  --project-ref YOUR_PROJECT_REF
```

### View Logs

```bash
# Real-time logs
npx supabase functions logs generate-agreement-pdf --follow

# Last 100 log entries
npx supabase functions logs generate-agreement-pdf --tail 100
```

## Troubleshooting

### Issue: "Bucket not found"

**Solution:**
```bash
# Check if buckets exist
npx supabase storage list

# If missing, apply migration
npx supabase db push
```

### Issue: "Permission denied" when uploading

**Solution:**
Check RLS policies:
```sql
-- Verify policies exist
SELECT * FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage';

-- Re-apply policies from migration if needed
```

### Issue: "Service role key not set"

**Solution:**
Environment variables are auto-set by Supabase, but verify:
```bash
npx supabase secrets list
```

### Issue: "PDF generation timeout"

**Solution:**
- Increase function timeout (max 60s for Edge Functions)
- Use async processing for large PDFs
- Consider client-side generation for complex documents

### Issue: "CORS error"

**Solution:**
Ensure CORS headers are set in the Edge Function (already included).

### Issue: "Signature image too large"

**Solution:**
Compress signature before sending:
```javascript
// In frontend
const compressSignature = async (base64) => {
  const img = new Image();
  img.src = base64;
  await img.decode();
  
  const canvas = document.createElement('canvas');
  canvas.width = 400;  // Reduce size
  canvas.height = 100;
  
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, 400, 100);
  
  return canvas.toDataURL('image/png', 0.8); // 80% quality
};
```

## CLI Commands Cheat Sheet

```bash
# === Storage ===
npx supabase storage list                    # List all buckets
npx supabase storage create BUCKET_NAME      # Create bucket
npx supabase storage ls BUCKET_NAME          # List files in bucket
npx supabase storage rm BUCKET_NAME/path     # Delete file

# === Functions ===
npx supabase functions list                  # List all functions
npx supabase functions deploy FUNCTION_NAME  # Deploy function
npx supabase functions delete FUNCTION_NAME  # Delete function
npx supabase functions logs FUNCTION_NAME    # View logs
npx supabase functions serve FUNCTION_NAME   # Test locally

# === Secrets ===
npx supabase secrets list                    # List all secrets
npx supabase secrets set KEY=value           # Set secret
npx supabase secrets unset KEY               # Remove secret

# === Database ===
npx supabase db push                         # Apply migrations
npx supabase db reset                        # Reset local DB
npx supabase migration list                  # List migrations

# === Project ===
npx supabase link                            # Link to project
npx supabase status                          # Check status
npx supabase start                           # Start local dev
npx supabase stop                            # Stop local dev
```

## Security Checklist

- ✅ Storage buckets are private (not public)
- ✅ RLS policies restrict access to user's own files
- ✅ Signed URLs expire after 1 hour
- ✅ Service role key is used only in Edge Function
- ✅ User authentication verified before generation
- ✅ File paths include user ID to prevent conflicts
- ✅ CORS configured correctly
- ✅ No sensitive data logged

## Performance Tips

1. **Cache PDFs**: Don't regenerate if already exists
2. **Compress signatures**: Reduce image size before upload
3. **Async processing**: For complex PDFs, use background jobs
4. **CDN**: Consider CloudFlare in front of Storage
5. **Lazy loading**: Load PDFs only when needed
6. **Pagination**: Limit number of documents shown at once

## Next Steps

1. ✅ Set up storage buckets
2. ✅ Deploy Edge Function
3. ✅ Choose PDF generation method
4. ✅ Test locally
5. ✅ Integrate with frontend
6. 🔄 Add email delivery
7. 🔄 Implement version control
8. 🔄 Add company logo to PDFs
9. 🔄 Support multiple languages
10. 🔄 Add cryptographic signatures

## Additional Resources

- [Supabase Storage Docs](https://supabase.com/docs/guides/storage)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [PDFShift API Docs](https://pdfshift.io/documentation)
- [Puppeteer Deno](https://deno.land/x/puppeteer)
- [jsPDF GitHub](https://github.com/parallax/jsPDF)

## Support

If you encounter issues:
1. Check function logs: `npx supabase functions logs generate-agreement-pdf`
2. Verify storage policies in Supabase dashboard
3. Test locally with `npx supabase functions serve`
4. Check this guide's troubleshooting section
5. Contact Supabase support or check their Discord

---

**Setup Status:**
- ✅ Migration created: `20251017134618_storage_buckets_and_policies.sql`
- ✅ Edge Function created: `supabase/functions/generate-agreement-pdf/`
- ✅ README created: Documentation complete
- 🔄 **Action Required:** Choose PDF generation method and deploy

**Quick Deploy:**
```bash
# 1. Apply migration
npx supabase db push

# 2. Deploy function
npx supabase functions deploy generate-agreement-pdf

# 3. Test it
# Navigate to service wizard → Sign agreement → Generate PDF
```

