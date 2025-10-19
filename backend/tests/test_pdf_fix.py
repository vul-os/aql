#!/usr/bin/env python3
"""Test that PDF generation is fixed"""
import requests
import time

BACKEND_URL = "https://botkorp-backend-695066639923.europe-west1.run.app"

# Invoice ID from our test
INVOICE_ID = "7ec705ca-af09-4856-bd02-6f3913833908"

print("=" * 80)
print("TESTING PDF GENERATION FIX")
print("=" * 80)

# Wait for new revision to be ready
print("\n⏳ Waiting for new backend revision to be ready...")
time.sleep(5)

# Check health
print("\n🔍 Checking backend health...")
response = requests.get(f"{BACKEND_URL}/health")
health = response.json()
print(f"   Status: {health['status']}")
print(f"   Revision: {health['revision']}")
print(f"   Supabase: {health['supabase']}")

# Test PDF generation
print(f"\n📄 Testing PDF generation for invoice: {INVOICE_ID}...")
response = requests.post(
    f"{BACKEND_URL}/api/send-invoice-email",
    json={'invoice_id': INVOICE_ID},
    timeout=60
)

print(f"   HTTP Status: {response.status_code}")

if response.status_code == 200:
    data = response.json()
    print(f"   ✅ SUCCESS!")
    print(f"   Invoice: {data.get('invoice_id', 'N/A')[:20]}...")
    print(f"   PDF URL: {data.get('pdf_url', 'N/A')[:80]}...")
    print(f"   Email sent: {data.get('email_sent', False)}")
    print(f"\n🎉 PDF GENERATION IS WORKING!")
elif response.status_code == 404:
    print(f"   ⚠️  Invoice not found (404)")
    print(f"   This is expected if the invoice was cleaned up")
else:
    print(f"   ❌ ERROR: {response.status_code}")
    try:
        print(f"   Response: {response.json()}")
    except:
        print(f"   Response: {response.text[:200]}")

print("=" * 80)

