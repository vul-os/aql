# Invoice PDF Generation & Download

## Overview

BotKorp invoices include PDF generation and download functionality using the company information:

**Company:** Exolution Technologies (Pty) Ltd  
**Trading As:** BotKorp  
**Address:** MAP HOUSE, Umbilo, Durban, 4061, KwaZulu-Natal, South Africa  
**Registration:** 2024/567890/07  
**VAT Number:** 4123456789  

## Database Schema

The `invoices` table includes all vendor information:

```sql
vendor_name TEXT DEFAULT 'BotKorp (Pty) Ltd'
vendor_parent_company TEXT DEFAULT 'A member of Exolution Technologies (Pty) Ltd'
vendor_trading_as TEXT DEFAULT 'Trading as BotKorp'
vendor_registration_number TEXT DEFAULT '2024/567890/07'
vendor_vat_number TEXT DEFAULT '4123456789'
vendor_address_line1 TEXT DEFAULT 'MAP HOUSE'
vendor_address_line2 TEXT DEFAULT 'Umbilo'
vendor_city TEXT DEFAULT 'Durban'
vendor_postal_code TEXT DEFAULT '4061'
vendor_province TEXT DEFAULT 'KwaZulu-Natal'
vendor_country TEXT DEFAULT 'South Africa'
vendor_phone TEXT DEFAULT '+27 31 123 4567'
vendor_email TEXT DEFAULT 'billing@botkorp.co.za'
vendor_website TEXT DEFAULT 'www.botkorp.co.za'
invoice_pdf_url TEXT -- CDN URL to generated PDF
```

## Frontend Implementation

### 1. Invoice List Page

Create a page at `/src/pages/settings/invoices-page.jsx`:

```jsx
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Download, Eye } from 'lucide-react';

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchInvoices();
  }, []);

  const fetchInvoices = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    
    const { data, error } = await supabase
      .from('invoices')
      .select('*')
      .eq('user_id', user.id)
      .order('issue_date', { ascending: false });

    if (!error) setInvoices(data);
    setLoading(false);
  };

  const downloadPDF = async (invoice) => {
    // Call edge function to generate PDF
    const { data, error } = await supabase.functions.invoke('generate-invoice-pdf', {
      body: { invoice_id: invoice.id }
    });

    if (!error && data.pdf_url) {
      window.open(data.pdf_url, '_blank');
    }
  };

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6">Invoices</h1>
      
      <div className="space-y-4">
        {invoices.map(invoice => (
          <div key={invoice.id} className="border rounded-lg p-4 flex justify-between items-center">
            <div>
              <h3 className="font-semibold">{invoice.invoice_number}</h3>
              <p className="text-sm text-gray-600">
                {new Date(invoice.issue_date).toLocaleDateString()} - 
                R{invoice.total_amount.toFixed(2)}
              </p>
              <span className={`text-xs px-2 py-1 rounded ${
                invoice.status === 'paid' ? 'bg-green-100 text-green-800' : 
                invoice.status === 'overdue' ? 'bg-red-100 text-red-800' :
                'bg-yellow-100 text-yellow-800'
              }`}>
                {invoice.status}
              </span>
            </div>
            
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => downloadPDF(invoice)}
              >
                <Eye className="mr-2 h-4 w-4" />
                View
              </Button>
              <Button 
                variant="default" 
                size="sm"
                onClick={() => downloadPDF(invoice)}
              >
                <Download className="mr-2 h-4 w-4" />
                Download PDF
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 2. Create Edge Function for PDF Generation

Create `/supabase/functions/generate-invoice-pdf/index.ts`:

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async (req) => {
  try {
    const { invoice_id } = await req.json();
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch invoice with all details
    const { data: invoice, error } = await supabase
      .from('invoices')
      .select(`
        *,
        rental_agreements!inner(
          number_of_bots,
          bot_type
        )
      `)
      .eq('id', invoice_id)
      .single();

    if (error) throw error;

    // Generate PDF using a service like:
    // - pdfkit (Deno compatible)
    // - Puppeteer (headless Chrome)
    // - External API like DocRaptor, PDFShift, etc.

    // For now, use HTML template and convert to PDF
    const html = generateInvoiceHTML(invoice);
    
    // Option 1: Store in Supabase Storage
    const pdfBuffer = await convertHTMLtoPDF(html);
    const fileName = `invoices/${invoice.invoice_number}.pdf`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('documents')
      .upload(fileName, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage
      .from('documents')
      .getPublicUrl(fileName);

    // Update invoice with PDF URL
    await supabase
      .from('invoices')
      .update({ invoice_pdf_url: publicUrl })
      .eq('id', invoice_id);

    return new Response(JSON.stringify({ 
      success: true, 
      pdf_url: publicUrl 
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

function generateInvoiceHTML(invoice: any): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; padding: 40px; }
    .header { text-align: center; margin-bottom: 40px; }
    .company-info { margin-bottom: 20px; }
    .invoice-details { margin-bottom: 30px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
    .total { font-size: 1.2em; font-weight: bold; }
    .footer { margin-top: 40px; text-align: center; color: #666; }
  </style>
</head>
<body>
  <div class="header">
    <h1>INVOICE</h1>
    <h3>${invoice.vendor_parent_company}</h3>
    <p>${invoice.vendor_trading_as}</p>
  </div>

  <div class="company-info">
    <strong>From:</strong><br>
    ${invoice.vendor_name}<br>
    ${invoice.vendor_address_line1}, ${invoice.vendor_address_line2}<br>
    ${invoice.vendor_city}, ${invoice.vendor_postal_code}<br>
    ${invoice.vendor_province}, ${invoice.vendor_country}<br>
    <br>
    <strong>Registration:</strong> ${invoice.vendor_registration_number}<br>
    <strong>VAT Number:</strong> ${invoice.vendor_vat_number}<br>
    <strong>Phone:</strong> ${invoice.vendor_phone}<br>
    <strong>Email:</strong> ${invoice.vendor_email}<br>
    <strong>Website:</strong> ${invoice.vendor_website}
  </div>

  <div class="invoice-details">
    <strong>Bill To:</strong><br>
    ${invoice.billing_name}<br>
    ${invoice.billing_address}<br>
    ${invoice.billing_city}, ${invoice.billing_postal_code}<br>
    ${invoice.billing_email}
    <br><br>
    <strong>Invoice Number:</strong> ${invoice.invoice_number}<br>
    <strong>Invoice Date:</strong> ${new Date(invoice.issue_date).toLocaleDateString()}<br>
    <strong>Due Date:</strong> ${new Date(invoice.due_date).toLocaleDateString()}<br>
    <strong>Period:</strong> ${new Date(invoice.period_start).toLocaleDateString()} - ${new Date(invoice.period_end).toLocaleDateString()}
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th>Quantity</th>
        <th>Unit Price</th>
        <th>Total</th>
      </tr>
    </thead>
    <tbody>
      ${invoice.line_items.map((item: any) => `
        <tr>
          <td>${item.description}</td>
          <td>${item.quantity}</td>
          <td>R${item.unit_price.toFixed(2)}</td>
          <td>R${item.total.toFixed(2)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div style="text-align: right;">
    <p><strong>Subtotal:</strong> R${invoice.subtotal.toFixed(2)}</p>
    <p><strong>VAT (${invoice.tax_rate}%):</strong> R${invoice.tax_amount.toFixed(2)}</p>
    <p class="total"><strong>Total Amount:</strong> R${invoice.total_amount.toFixed(2)}</p>
    <p><strong>Amount Paid:</strong> R${invoice.amount_paid.toFixed(2)}</p>
    <p class="total" style="color: ${invoice.amount_due > 0 ? 'red' : 'green'}">
      <strong>Amount Due:</strong> R${invoice.amount_due.toFixed(2)}
    </p>
  </div>

  ${invoice.notes ? `<div style="margin-top: 30px;"><strong>Notes:</strong><br>${invoice.notes}</div>` : ''}

  <div class="footer">
    <p>Thank you for your business!</p>
    <p style="font-size: 0.9em;">
      Payment terms: Due within 14 days. Late payments may incur additional charges.
    </p>
  </div>
</body>
</html>
  `;
}

async function convertHTMLtoPDF(html: string): Promise<Uint8Array> {
  // Use a service or library to convert HTML to PDF
  // For example: https://deno.land/x/pdfgen or external API
  // This is a placeholder - implement based on your chosen solution
  throw new Error('PDF generation not yet implemented');
}
```

### 3. Add Route to Router

In `/src/routes.jsx`:

```jsx
import InvoicesPage from './pages/settings/invoices-page';

// Add to routes
{
  path: '/settings/invoices',
  element: <InvoicesPage />
}
```

## Recommended PDF Libraries

### Option 1: External API (Easiest)
- **PDFShift** - https://pdfshift.io/
- **DocRaptor** - https://docraptor.com/
- Simple API call to convert HTML to PDF

### Option 2: Puppeteer (Most Control)
- Run headless Chrome in Docker
- Full CSS/JS support
- Best for complex layouts

### Option 3: jsPDF + html2canvas
- Client-side PDF generation
- No server required
- Good for simple invoices

## Setup Steps

1. **Create Storage Bucket**
```sql
-- Create documents bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', true);

-- Set up RLS policies
CREATE POLICY "Users can view own invoices"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = 'invoices');
```

2. **Deploy Edge Function**
```bash
supabase functions deploy generate-invoice-pdf
```

3. **Add to Frontend**
- Create InvoicesPage component
- Add route to router
- Test PDF generation

## Future Enhancements

- Email invoices automatically
- Bulk download multiple invoices
- Invoice templates/branding customization
- Multi-currency support
- Payment link integration with Paystack

