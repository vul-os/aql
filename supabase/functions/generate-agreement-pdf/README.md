# Generate Agreement PDF - Supabase Edge Function

This Edge Function generates rental agreement PDFs with signature images and stores them in Supabase Storage.

## Features

- ✅ Uploads signature image to `signatures` bucket
- ✅ Generates professional HTML-based rental agreement
- ✅ Converts HTML to PDF
- ✅ Uploads PDF to `agreements` bucket
- ✅ Updates rental agreement record with URLs
- ✅ Returns signed URLs for secure download

## Setup

### 1. Create Storage Buckets

Run the setup script from the project root:

```bash
bash setup-storage-buckets.sh
```

Or manually apply the migration:

```bash
npx supabase db push
```

This will create three storage buckets:
- `agreements` - Stores rental agreement PDFs
- `signatures` - Stores customer signature images
- `invoices` - Stores monthly invoice PDFs

### 2. Deploy the Edge Function

```bash
npx supabase functions deploy generate-agreement-pdf
```

### 3. Set Environment Variables

The function requires these environment variables (automatically set in Supabase):
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (has storage permissions)

Optional (for production PDF generation):
- `PDFSHIFT_API_KEY` - If using PDFShift for PDF generation

### 4. Install PDF Generation Service (Production)

For production-quality PDFs, you have several options:

#### Option A: PDFShift (Recommended - Easy)
1. Sign up at https://pdfshift.io
2. Get your API key
3. Add to Supabase secrets:
   ```bash
   npx supabase secrets set PDFSHIFT_API_KEY=your_api_key_here
   ```

#### Option B: Puppeteer with Deno
Install puppeteer for Deno in your function:
```typescript
import puppeteer from "https://deno.land/x/puppeteer@16.2.0/mod.ts";
```

#### Option C: Gotenberg (Docker)
Deploy Gotenberg as a microservice and call it from the Edge Function.

#### Option D: Client-side PDF generation
Use jsPDF or pdfmake in the frontend (simpler but less control).

## Usage

### From Frontend

```javascript
const response = await fetch(
  `${SUPABASE_URL}/functions/v1/generate-agreement-pdf`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseAnonKey}`,
    },
    body: JSON.stringify({
      rental_agreement_id: 'uuid-here',
      user_id: 'user-uuid',
      signature_base64: 'data:image/png;base64,...',
      rental_agreement: {
        organization_id: 'uuid',
        location_id: 'uuid',
        number_of_bots: 2,
        monthly_rental_fee: 300,
        service_fee_per_visit: 150,
        services_per_month: 4,
        deposit_total: 1000,
        billing_day: 15,
        start_date: '2025-10-17',
        agreement_terms: '<html>...</html>' // optional
      },
      user_profile: {
        legal_first_name: 'John',
        legal_surname: 'Doe',
        id_number: '8001015009083',
        phone_number: '+27821234567',
        legal_address_line1: '123 Main St',
        legal_city: 'Durban',
        legal_province: 'KwaZulu-Natal',
        legal_postal_code: '4001'
      },
      location: {
        name: 'Home',
        address: '123 Main St',
        city: 'Durban',
        province: 'KwaZulu-Natal'
      }
    })
  }
);

const { signature_url, pdf_url } = await response.json();
```

### Response

```json
{
  "success": true,
  "signature_url": "https://...signed-url...",
  "pdf_url": "https://...signed-url...",
  "message": "Agreement PDF generated successfully"
}
```

Signed URLs are valid for 1 hour (3600 seconds).

## Storage Structure

```
signatures/
  ├── {user_id}/
  │   ├── {agreement_id}_signature.png
  │   └── {agreement_id2}_signature.png

agreements/
  ├── {user_id}/
  │   ├── {agreement_id}_agreement.pdf
  │   └── {agreement_id2}_agreement.pdf

invoices/
  ├── {user_id}/
  │   ├── {invoice_id}_invoice.pdf
  │   └── {invoice_id2}_invoice.pdf
```

## Security

- ✅ **RLS Policies**: Users can only access their own files
- ✅ **Service Role**: Function uses service role for elevated permissions
- ✅ **Signed URLs**: Temporary access URLs expire after 1 hour
- ✅ **Private Buckets**: All buckets are private by default
- ✅ **User Validation**: User ID is verified from auth token

## Testing

Test the function locally:

```bash
npx supabase functions serve generate-agreement-pdf
```

Then call it:

```bash
curl -X POST http://localhost:54321/functions/v1/generate-agreement-pdf \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -d @test-payload.json
```

## Troubleshooting

### "Bucket not found"
Run the storage setup migration:
```bash
npx supabase db push
```

### "Permission denied"
Check that:
1. Storage buckets exist
2. RLS policies are created
3. Service role key is set correctly

### "PDF generation failed"
The current implementation uses a placeholder. For production:
1. Choose a PDF generation option (see Setup step 4)
2. Update the `generatePDFFromHTML` function
3. Test with a real signature image

### "Signature upload failed"
Verify:
1. Base64 image is properly formatted
2. Image size is reasonable (<5MB)
3. Storage bucket exists

## PDF Customization

Edit the `generateAgreementHTML` function to customize:
- Company branding and logo
- Layout and styling
- Terms and conditions text
- Color scheme
- Additional fields

The HTML template uses inline CSS for reliable PDF rendering.

## Next Steps

1. **Add Logo**: Include company logo in the PDF header
2. **Email Integration**: Send PDF via email after generation
3. **Version Control**: Track agreement versions
4. **Digital Signatures**: Add cryptographic signature verification
5. **Multi-language**: Support multiple languages for agreements
6. **Custom Templates**: Allow per-organization agreement templates

## Related Documentation

- [Storage Policies Migration](../../migrations/20251017134618_storage_buckets_and_policies.sql)
- [Signature Setup Guide](../../../SIGNATURE_PDF_SETUP.md)
- [Supabase Storage Docs](https://supabase.com/docs/guides/storage)

