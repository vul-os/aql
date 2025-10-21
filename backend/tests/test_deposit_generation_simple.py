#!/usr/bin/env python3
"""
Simple Deposit Invoice Generation Test

Tests the create_deposit_invoice() function directly with an existing rental agreement.
"""

import json
import urllib.request
import urllib.error
import time

# Supabase configuration
SUPABASE_URL = 'https://kyoowsarfopltjwmhksi.supabase.co'
SUPABASE_SERVICE_KEY = 'sb_secret_REDACTED'

def api_request(endpoint, method='GET', data=None):
    """Make API request to Supabase."""
    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
    
    headers = {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
    }
    
    req = urllib.request.Request(
        url,
        data=data.encode('utf-8') if data else None,
        headers=headers,
        method=method
    )
    
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            response_text = response.read().decode('utf-8')
            if not response_text:
                return None
            return json.loads(response_text)
    except Exception as e:
        print(f"      ❌ Error: {str(e)}")
        raise

def call_rpc(function_name, params):
    """Call Supabase RPC function."""
    url = f"{SUPABASE_URL}/rest/v1/rpc/{function_name}"
    
    headers = {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
        'Content-Type': 'application/json'
    }
    
    req = urllib.request.Request(
        url,
        data=json.dumps(params).encode('utf-8'),
        headers=headers,
        method='POST'
    )
    
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            response_text = response.read().decode('utf-8')
            return json.loads(response_text)
    except Exception as e:
        print(f"      ❌ Error calling {function_name}: {str(e)}")
        raise

def main():
    print("\n" + "="*70)
    print("🧪 DEPOSIT INVOICE GENERATION TEST (Simplified)")
    print("="*70)
    print()
    
    # Step 1: Find existing rental agreement
    print("1️⃣  Finding existing rental agreement...")
    agreements = api_request('rental_agreements?status=eq.active&limit=1')
    
    if not agreements or len(agreements) == 0:
        print("   ❌ No active rental agreements found")
        print("      Please create a service first through the UI")
        return 1
    
    agreement = agreements[0]
    print(f"   ✅ Found rental agreement: {agreement['agreement_number']}")
    print(f"      ID: {agreement['id'][:8]}...")
    print(f"      User: {agreement['user_id'][:8]}...")
    
    # Step 2: Check if user has payment authorization
    print("\n2️⃣  Checking payment authorization...")
    auths = api_request(f"payment_authorizations?user_id=eq.{agreement['user_id']}&is_active=eq.true&limit=1")
    
    if not auths or len(auths) == 0:
        print("   ❌ No payment authorization found for this user")
        print("      Please add a payment method in the UI")
        return 1
    
    print(f"   ✅ Payment authorization found: ****{auths[0]['last4']}")
    
    # Step 3: Call create_deposit_invoice() function
    print("\n3️⃣  Calling create_deposit_invoice()...")
    print("      This should create:")
    print("        1. Deposit invoice")
    print("        2. Payment attempt (NEW!)")
    print()
    
    result = call_rpc('create_deposit_invoice', {
        'p_rental_agreement_id': agreement['id']
    })
    
    if not result.get('success'):
        print(f"   ❌ Function failed: {result.get('error')}")
        return 1
    
    print(f"   ✅ Function succeeded!")
    print(f"      Invoice: {result.get('invoice_number')}")
    print(f"      Amount: R{result.get('total_amount'):.2f}")
    print(f"      Due Date: {result.get('due_date')}")
    
    invoice_id = result.get('invoice_id')
    
    # Step 4: Check if payment attempt was created
    print("\n4️⃣  Checking for payment attempt...")
    time.sleep(2)  # Give it a moment
    
    attempts = api_request(f"payment_attempts?invoice_id=eq.{invoice_id}")
    
    if not attempts or len(attempts) == 0:
        print("   ❌ No payment attempt created!")
        print()
        print("   🔧 This means the updated create_deposit_invoice() function")
        print("      is NOT running. You need to:")
        print("        1. supabase db reset")
        print("        2. OR run the updated function SQL in SQL Editor")
        return 1
    
    attempt = attempts[0]
    print(f"   ✅ Payment attempt created!")
    print(f"      ID: {attempt['id'][:8]}...")
    print(f"      Amount: R{attempt['amount']:.2f}")
    print(f"      Status: {attempt['status']}")
    
    # Step 5: Wait for edge function to process
    print("\n5️⃣  Waiting for edge function to process...")
    
    for i in range(10):
        time.sleep(2)
        attempts = api_request(f"payment_attempts?id=eq.{attempt['id']}")
        
        if attempts and len(attempts) > 0:
            current = attempts[0]
            status = current['status']
            
            print(f"      Status: {status}")
            
            if status == 'success':
                print(f"   ✅ Payment processed successfully!")
                print(f"      Reference: {current.get('paystack_reference', 'N/A')}")
                break
            elif status in ['failed', 'retry']:
                print(f"   ❌ Payment failed: {current.get('error_message', 'Unknown')}")
                break
    
    # Summary
    print("\n" + "="*70)
    print("📊 SUMMARY")
    print("="*70)
    print()
    print(f"✅ Deposit invoice created: {result.get('invoice_number')}")
    print(f"✅ Payment attempt created: {attempt['id'][:8]}...")
    print(f"✅ Final status: {current['status']}")
    print()
    
    if current['status'] == 'success':
        print("🎉 TEST PASSED: Automatic deposit collection working!")
    else:
        print("⚠️  PARTIAL SUCCESS: Invoice & attempt created, payment needs attention")
    
    print()
    return 0 if current['status'] == 'success' else 1

if __name__ == '__main__':
    exit(main())

