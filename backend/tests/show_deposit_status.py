#!/usr/bin/env python3
"""
Show Deposit Invoice and Payment Attempt Status

Shows which rental agreements have deposit invoices and whether payment attempts were created.
"""

import json
import urllib.request

# Supabase configuration
SUPABASE_URL = 'https://kyoowsarfopltjwmhksi.supabase.co'
SUPABASE_SERVICE_KEY = 'sb_secret_REDACTED'

def api_request(endpoint):
    """Make API request to Supabase."""
    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
    
    headers = {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
    }
    
    req = urllib.request.Request(url, headers=headers)
    
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print(f"Error: {e}")
        return []

def main():
    print("\n" + "="*70)
    print("📊 DEPOSIT INVOICE & PAYMENT ATTEMPT STATUS")
    print("="*70)
    print()
    
    # Get deposit invoices
    print("🔍 Checking deposit invoices...")
    invoices = api_request("invoices?notes=ilike.*Deposit*&order=created_at.desc")
    
    if not invoices:
        print("   No deposit invoices found")
        return
    
    print(f"   Found {len(invoices)} deposit invoice(s)\n")
    
    for i, invoice in enumerate(invoices, 1):
        print("="*70)
        print(f"Invoice #{i}: {invoice['invoice_number']}")
        print("="*70)
        print(f"Amount: R{invoice['total_amount']:.2f}")
        print(f"Status: {invoice['status']}")
        print(f"Due Date: {invoice['due_date']}")
        print(f"Created: {invoice['created_at']}")
        print(f"Rental Agreement: {invoice.get('rental_agreement_id', 'N/A')}")
        
        # Check for payment attempts
        if invoice.get('id'):
            attempts = api_request(f"payment_attempts?invoice_id=eq.{invoice['id']}")
            
            if attempts and len(attempts) > 0:
                print(f"\n💳 Payment Attempts ({len(attempts)}):")
                for j, attempt in enumerate(attempts, 1):
                    status_icon = {
                        'success': '✅',
                        'failed': '❌',
                        'pending': '⏳',
                        'retry': '🔄'
                    }.get(attempt['status'], '❓')
                    
                    print(f"   {status_icon} Attempt {j}: {attempt['status'].upper()}")
                    print(f"      ID: {attempt['id'][:16]}...")
                    print(f"      Amount: R{attempt['amount']:.2f}")
                    print(f"      Created: {attempt['created_at']}")
                    
                    if attempt.get('paystack_reference'):
                        print(f"      Reference: {attempt['paystack_reference']}")
                    
                    if attempt.get('error_message'):
                        print(f"      Error: {attempt['error_message']}")
            else:
                print(f"\n❌ NO PAYMENT ATTEMPTS FOUND FOR THIS INVOICE")
                print("   This means the updated create_deposit_invoice() is NOT running")
                print("   or the user had no payment authorization when invoice was created")
        
        print()
    
    # Summary
    print("="*70)
    print("📊 SUMMARY")
    print("="*70)
    print()
    
    total_invoices = len(invoices)
    invoices_with_attempts = sum(1 for inv in invoices if api_request(f"payment_attempts?invoice_id=eq.{inv['id']}"))
    
    print(f"Total deposit invoices: {total_invoices}")
    print(f"Invoices with payment attempts: {invoices_with_attempts}")
    print(f"Invoices WITHOUT payment attempts: {total_invoices - invoices_with_attempts}")
    print()
    
    if invoices_with_attempts == 0:
        print("❌ NO PAYMENT ATTEMPTS CREATED")
        print()
        print("🔧 The create_deposit_invoice() function needs to be updated:")
        print("   Option 1: Run 'supabase db reset' to apply updated migrations")
        print("   Option 2: Run update_trigger_function.sql in Supabase SQL Editor")
    elif invoices_with_attempts == total_invoices:
        print("✅ ALL DEPOSIT INVOICES HAVE PAYMENT ATTEMPTS")
        print()
        print("🎉 Automatic deposit collection is working!")
    else:
        print("⚠️  SOME INVOICES MISSING PAYMENT ATTEMPTS")
        print()
        print("   Older invoices may not have attempts (created before migration)")
        print("   New invoices should have attempts automatically")
    
    print()

if __name__ == '__main__':
    main()

