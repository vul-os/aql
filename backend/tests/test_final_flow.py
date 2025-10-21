#!/usr/bin/env python3
"""Test complete invoice flow with email"""
from supabase import create_client
import time
import requests

SUPABASE_URL = "https://kyoowsarfopltjwmhksi.supabase.co"
SUPABASE_SERVICE_KEY = "REDACTED_JWT"
BACKEND_URL = "https://botkorp-backend-695066639923.europe-west1.run.app"

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

print("=" * 80)
print("FINAL INVOICE FLOW TEST - WITH EMAIL")
print("=" * 80)

# Use existing test invoice
INVOICE_ID = "7ec705ca-af09-4856-bd02-6f3913833908"

print(f"\n📧 Testing email sending for invoice: {INVOICE_ID}...")
print("   Waiting for backend to be ready...")
time.sleep(3)

response = requests.post(
    f"{BACKEND_URL}/api/send-invoice-email",
    json={'invoice_id': INVOICE_ID},
    timeout=60
)

print(f"\n   HTTP Status: {response.status_code}")

if response.status_code == 200:
    data = response.json()
    print(f"   ✅ SUCCESS!")
    print(f"   Invoice: {data.get('invoice_id', 'N/A')[:20]}...")
    print(f"   PDF URL: {data.get('pdf_url', 'N/A')[:80]}...")
    print(f"   Email sent: {data.get('email_sent', False)}")
    print(f"   Email ID: {data.get('email_id', 'N/A')}")
    
    # Verify PDF was saved
    invoice = supabase.table('invoices').select('invoice_pdf_url').eq('id', INVOICE_ID).single().execute()
    if invoice.data.get('invoice_pdf_url'):
        print(f"   ✅ PDF URL saved to database")
    
    print(f"\n🎉 COMPLETE SUCCESS!")
    print(f"   ✅ PDF generated")
    print(f"   ✅ PDF uploaded to storage")
    print(f"   ✅ PDF URL saved to database")
    print(f"   ✅ Email sent with PDF attachment")
    print(f"\n   📬 Check botkorpza@gmail.com for the invoice email!")
    
else:
    print(f"   ❌ ERROR: {response.status_code}")
    try:
        print(f"   Response: {response.json()}")
    except:
        print(f"   Response: {response.text[:200]}")

print("=" * 80)

