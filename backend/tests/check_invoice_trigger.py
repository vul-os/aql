#!/usr/bin/env python3
"""
Check if invoice PDFs are being auto-generated after DB reset
"""
import requests
import json
import time

SUPABASE_URL = "https://kyoowsarfopltjwmhksi.supabase.co"
SUPABASE_KEY = "REDACTED_JWT"

headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json"
}

print("="*70)
print("CHECKING INVOICE AUTO-GENERATION")
print("="*70)
print()

# 1. Check for recent invoices
print("1. Checking for recent invoices...")
response = requests.get(
    f"{SUPABASE_URL}/rest/v1/invoices",
    headers=headers,
    params={"order": "created_at.desc", "limit": "5"}
)

if response.status_code == 200:
    invoices = response.json()
    print(f"   Found {len(invoices)} recent invoice(s)")
    print()
    
    if invoices:
        for idx, inv in enumerate(invoices, 1):
            print(f"   Invoice #{idx}:")
            print(f"     - ID: {inv['id']}")
            print(f"     - Number: {inv['invoice_number']}")
            print(f"     - Status: {inv['status']}")
            print(f"     - Amount: R{inv['total_amount']}")
            print(f"     - PDF URL: {inv.get('invoice_pdf_url') or 'NOT GENERATED'}")
            print(f"     - Created: {inv['created_at']}")
            print(f"     - Notes: {inv.get('notes', 'N/A')[:50]}...")
            print()
    else:
        print("   No invoices found. Create a service to test auto-generation.")
else:
    print(f"   ERROR: {response.status_code}")
    print(f"   {response.text[:200]}")

print()

# 2. Check pg_net queue
print("2. Checking pg_net async request queue...")
response = requests.get(
    f"{SUPABASE_URL}/rest/v1/http_request_queue",
    headers=headers,
    params={"order": "created.desc", "limit": "10"}
)

if response.status_code == 200:
    queue = response.json()
    print(f"   Found {len(queue)} queued request(s)")
    print()
    
    if queue:
        for idx, req in enumerate(queue, 1):
            print(f"   Request #{idx}:")
            print(f"     - ID: {req.get('id')}")
            print(f"     - URL: {req.get('url', 'N/A')[:60]}")
            print(f"     - Status: {req.get('status', 'pending')}")
            print(f"     - Created: {req.get('created', 'N/A')}")
            print()
    else:
        print("   No async requests in queue")
        print("   This might mean:")
        print("     - Trigger is not firing")
        print("     - pg_net extension is not enabled")
        print("     - Requests already completed and cleared")
else:
    print(f"   Could not access queue: {response.status_code}")
    if response.status_code == 404:
        print("   The 'net.http_request_queue' table doesn't exist or isn't exposed")
        print("   Check if pg_net extension is enabled in Supabase")

print()

# 3. Check if trigger exists
print("3. Recommendations:")
print()

invoices_without_pdf = [inv for inv in invoices if not inv.get('invoice_pdf_url')] if response.status_code == 200 and invoices else []

if invoices_without_pdf:
    print("   INVOICES MISSING PDFs:")
    for inv in invoices_without_pdf:
        print(f"     - {inv['invoice_number']}: {inv['id']}")
    print()
    print("   To manually trigger PDF generation:")
    print(f"     cd /home/imran/Documents/botkorp-mono/backend/tests")
    print(f"     python3 test_invoice_pdf_generation.py")
    print()
    print("   Or test async trigger in database:")
    print("     SELECT net.http_post(")
    print("       url := 'https://botkorp-backend-695066639923.europe-west1.run.app/api/send-invoice-email',")
    print(f"       body := '{{\"invoice_id\": \"{invoices_without_pdf[0]['id']}\"}}'::jsonb")
    print("     );")
else:
    print("   All invoices have PDFs generated!")

print()
print("="*70)


