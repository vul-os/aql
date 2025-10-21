#!/usr/bin/env python3
"""Check if invoice PDF was saved despite email failure"""
from supabase import create_client

SUPABASE_URL = "https://kyoowsarfopltjwmhksi.supabase.co"
SUPABASE_SERVICE_KEY = "REDACTED_JWT"

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

INVOICE_ID = "7ec705ca-af09-4856-bd02-6f3913833908"

print("🔍 Checking if PDF was saved to database...")
invoice = supabase.table('invoices').select('invoice_number, status, invoice_pdf_url').eq('id', INVOICE_ID).single().execute()

if invoice.data:
    print(f"\n✅ Invoice found: {invoice.data['invoice_number']}")
    print(f"   Status: {invoice.data['status']}")
    
    pdf_url = invoice.data.get('invoice_pdf_url')
    if pdf_url:
        print(f"   ✅ PDF URL saved: {pdf_url[:80]}...")
        print(f"\n🎉 PDF GENERATION AND STORAGE WORKING!")
        print(f"   (Email sending failed due to Resend API key, but that's separate)")
    else:
        print(f"   ❌ PDF URL not saved (None)")
        print(f"   The PDF generation may have failed before saving")
else:
    print(f"❌ Invoice not found")

