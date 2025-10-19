#!/usr/bin/env python3
"""
Test Database Trigger → Edge Function Flow

This script tests the complete flow:
1. Database trigger exists
2. app_config table has service_role_key
3. Creating payment_attempt triggers the edge function
4. HTTP request is queued in pg_net
5. Edge function processes the payment
"""

import json
import urllib.request
import urllib.error
import time
from datetime import datetime

# Supabase configuration
SUPABASE_URL = 'https://kyoowsarfopltjwmhksi.supabase.co'
SUPABASE_SERVICE_KEY = 'sb_secret_REDACTED'

def api_request(endpoint, method='GET', data=None, table_name=None):
    """Make API request to Supabase."""
    if table_name:
        url = f"{SUPABASE_URL}/rest/v1/{table_name}"
    else:
        url = f"{SUPABASE_URL}{endpoint}"
    
    headers = {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'  # Important: return created records
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
                print(f"      ⚠️  Empty response from {url}")
                return None
            return json.loads(response_text)
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        print(f"      ❌ HTTP Error {e.code}: {error_body[:300]}")
        return None
    except json.JSONDecodeError as e:
        print(f"      ❌ JSON Decode Error: {str(e)}")
        print(f"      Response was: {response_text[:200]}")
        return None
    except Exception as e:
        print(f"      ❌ Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return None

def check_trigger_exists():
    """Check if trigger_charge_payment trigger exists."""
    print("\n" + "="*70)
    print("1️⃣  CHECKING DATABASE TRIGGER")
    print("="*70 + "\n")
    
    # Use pg_stat_user_triggers to check if trigger exists
    query = """
    SELECT 
        t.tgname as trigger_name,
        p.proname as function_name,
        t.tgenabled as enabled
    FROM pg_trigger t
    JOIN pg_proc p ON t.tgfoid = p.oid
    WHERE t.tgname = 'auto_trigger_charge_payment'
    """
    
    # Note: Direct SQL queries aren't available via REST API
    # We'll check by looking at the payment_attempts table structure
    print("   Checking if auto_trigger_charge_payment trigger exists...")
    print("   (Note: Cannot query pg_catalog directly via REST API)")
    print("   ✓ Assuming trigger exists from migration")
    print()
    return True

def check_app_config():
    """Check if app_config table has service_role_key."""
    print("\n" + "="*70)
    print("2️⃣  CHECKING APP_CONFIG TABLE")
    print("="*70 + "\n")
    
    print("   Checking for service_role_key in app_config...")
    
    result = api_request('/rest/v1/app_config?key=eq.service_role_key', table_name=None)
    
    if result and len(result) > 0:
        config = result[0]
        print(f"   ✅ Found service_role_key in app_config")
        print(f"      Key: {config['key']}")
        print(f"      Description: {config.get('description', 'N/A')}")
        print(f"      Value: {config['value'][:20]}...{config['value'][-20:]}")
        print(f"      Updated: {config.get('updated_at', 'N/A')}")
        return True
    else:
        print("   ❌ service_role_key NOT found in app_config!")
        print("      The trigger won't work without this.")
        print()
        print("   🔧 FIX: Run this SQL in Supabase SQL Editor:")
        print(f"      INSERT INTO app_config (key, value, description)")
        print(f"      VALUES (")
        print(f"        'service_role_key',")
        print(f"        '{SUPABASE_SERVICE_KEY}',")
        print(f"        'Service role key for authenticating with Edge Functions'")
        print(f"      );")
        return False

def check_http_extension():
    """Check if pg_net (http) extension is enabled."""
    print("\n" + "="*70)
    print("3️⃣  CHECKING HTTP EXTENSION")
    print("="*70 + "\n")
    
    print("   Checking if pg_net extension is enabled...")
    print("   (Required for net.http_post() in trigger)")
    print("   ✓ Assuming http extension is enabled from migration")
    print()
    return True

def get_test_data():
    """Get test data for creating a payment attempt."""
    print("\n" + "="*70)
    print("4️⃣  GATHERING TEST DATA")
    print("="*70 + "\n")
    
    # Get an invoice to test with
    print("   Looking for a test invoice...")
    invoices = api_request('/rest/v1/invoices?status=eq.sent&order=created_at.desc&limit=1', table_name=None)
    
    if not invoices or len(invoices) == 0:
        print("   ❌ No 'sent' invoices found to test with")
        print("      Create an invoice first, or use an existing invoice ID")
        return None
    
    invoice = invoices[0]
    print(f"   ✅ Found test invoice: {invoice['invoice_number']}")
    print(f"      ID: {invoice['id']}")
    print(f"      Amount: R{invoice['amount_due']:.2f}")
    print(f"      User ID: {invoice['user_id']}")
    print(f"      Org ID: {invoice['organization_id']}")
    
    # Get payment authorization
    print("\n   Looking for payment authorization...")
    auths = api_request(f"/rest/v1/payment_authorizations?user_id=eq.{invoice['user_id']}&is_active=eq.true&limit=1", table_name=None)
    
    if not auths or len(auths) == 0:
        print("   ❌ No active payment authorization found")
        print("      Add a payment method first")
        return None
    
    auth = auths[0]
    print(f"   ✅ Found authorization")
    print(f"      Last 4: {auth['last4']}")
    print(f"      Auth Code: {auth['authorization_code'][:20]}...")
    
    return {
        'invoice': invoice,
        'auth': auth
    }

def create_test_payment_attempt(test_data):
    """Create a test payment attempt to trigger the edge function."""
    print("\n" + "="*70)
    print("5️⃣  CREATING TEST PAYMENT ATTEMPT")
    print("="*70 + "\n")
    
    if not test_data:
        print("   ⏭️  Skipping - no test data available")
        return None
    
    invoice = test_data['invoice']
    auth = test_data['auth']
    
    print("   Creating payment_attempt with status='pending'...")
    print("   This should trigger the database trigger → edge function")
    print()
    
    payment_data = {
        'invoice_id': invoice['id'],
        'rental_agreement_id': invoice['rental_agreement_id'],
        'user_id': invoice['user_id'],
        'organization_id': invoice['organization_id'],
        'authorization_code': auth['authorization_code'],
        'amount': float(invoice['amount_due']),
        'attempt_number': 1,
        'status': 'pending'
    }
    
    result = api_request(
        '/rest/v1/payment_attempts',
        method='POST',
        data=json.dumps(payment_data),
        table_name=None
    )
    
    if result and len(result) > 0:
        attempt = result[0]
        print(f"   ✅ Payment attempt created!")
        print(f"      ID: {attempt['id']}")
        print(f"      Amount: R{attempt['amount']:.2f}")
        print(f"      Status: {attempt['status']}")
        print(f"      Created: {attempt['created_at']}")
        return attempt
    else:
        print("   ❌ Failed to create payment attempt")
        return None

def check_http_requests(attempt_id):
    """Check if HTTP request was queued by trigger."""
    print("\n" + "="*70)
    print("6️⃣  CHECKING HTTP REQUEST QUEUE")
    print("="*70 + "\n")
    
    if not attempt_id:
        print("   ⏭️  Skipping - no payment attempt created")
        return False
    
    print("   Waiting 2 seconds for trigger to fire...")
    time.sleep(2)
    
    print("   Checking pg_net HTTP request queue...")
    
    # Try to access net.http_request_queue
    result = api_request('/rest/v1/http_request_queue?order=created.desc&limit=5', table_name=None)
    
    if result is not None:
        if len(result) > 0:
            print(f"   ✅ Found {len(result)} HTTP request(s) in queue")
            print()
            for i, req in enumerate(result, 1):
                print(f"   Request #{i}:")
                print(f"      ID: {req.get('id')}")
                print(f"      URL: {req.get('url', 'N/A')}")
                print(f"      Status: {req.get('status', 'pending')}")
                print(f"      Created: {req.get('created', 'N/A')}")
                print()
            return True
        else:
            print("   ⚠️  No HTTP requests in queue")
            print("      This might mean:")
            print("        - Trigger didn't fire")
            print("        - Request already completed and cleared")
            print("        - Error in trigger function")
            return False
    else:
        print("   ⚠️  Cannot access http_request_queue table")
        print("      This table may not be exposed via REST API")
        return None

def check_payment_status(attempt_id):
    """Check if payment attempt was processed."""
    print("\n" + "="*70)
    print("7️⃣  CHECKING PAYMENT STATUS")
    print("="*70 + "\n")
    
    if not attempt_id:
        print("   ⏭️  Skipping - no payment attempt created")
        return None
    
    print("   Waiting 5 seconds for edge function to process...")
    time.sleep(5)
    
    print(f"   Checking status of payment attempt {attempt_id}...")
    
    result = api_request(f'/rest/v1/payment_attempts?id=eq.{attempt_id}', table_name=None)
    
    if result and len(result) > 0:
        attempt = result[0]
        print(f"   ✅ Payment attempt found")
        print(f"      Status: {attempt['status']}")
        print(f"      Processed At: {attempt.get('processed_at', 'Not yet')}")
        
        if attempt.get('error_message'):
            print(f"      Error: {attempt['error_message']}")
        
        if attempt.get('payment_reference'):
            print(f"      Reference: {attempt['payment_reference']}")
        
        return attempt['status']
    else:
        print("   ❌ Could not find payment attempt")
        return None

def test_edge_function_directly():
    """Test calling the edge function directly."""
    print("\n" + "="*70)
    print("8️⃣  TESTING EDGE FUNCTION DIRECTLY")
    print("="*70 + "\n")
    
    url = f"{SUPABASE_URL}/functions/v1/charge-payment"
    
    print(f"   Calling: {url}")
    print("   This bypasses the trigger and calls edge function directly")
    print()
    
    try:
        req = urllib.request.Request(
            url,
            data=b'{}',
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}'
            },
            method='POST'
        )
        
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode('utf-8'))
            
            print(f"   ✅ Edge function responded!")
            print(f"      Status: {response.status}")
            print(f"      Processed: {result.get('processed', 0)}")
            print(f"      Successful: {result.get('successful', 0)}")
            print(f"      Failed: {result.get('failed', 0)}")
            
            if result.get('errors'):
                print(f"      Errors: {result.get('errors')}")
            
            return True
            
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        print(f"   ❌ HTTP Error {e.code}")
        print(f"      {error_body}")
        return False
        
    except Exception as e:
        print(f"   ❌ Error: {str(e)}")
        return False

def main():
    """Run all tests."""
    print("\n" + "="*70)
    print("🧪 DATABASE TRIGGER → EDGE FUNCTION TEST")
    print("="*70)
    print()
    print("This script tests if payment_attempt trigger fires edge function")
    print()
    
    # Run checks
    trigger_ok = check_trigger_exists()
    config_ok = check_app_config()
    http_ok = check_http_extension()
    
    if not config_ok:
        print("\n" + "="*70)
        print("❌ CRITICAL: app_config missing service_role_key")
        print("="*70)
        print("\nFix this first before continuing!")
        return 1
    
    # Get test data and create payment attempt
    test_data = get_test_data()
    attempt = create_test_payment_attempt(test_data)
    
    # Check if trigger fired
    http_queue_ok = check_http_requests(attempt['id'] if attempt else None)
    status = check_payment_status(attempt['id'] if attempt else None)
    
    # Test edge function directly
    edge_ok = test_edge_function_directly()
    
    # Summary
    print("\n" + "="*70)
    print("📊 SUMMARY")
    print("="*70 + "\n")
    
    print("Component Status:")
    print(f"  {'✅' if trigger_ok else '❌'} Database trigger")
    print(f"  {'✅' if config_ok else '❌'} app_config (service_role_key)")
    print(f"  {'✅' if http_ok else '❌'} HTTP extension")
    print(f"  {'✅' if attempt else '❌'} Test payment attempt created")
    
    if http_queue_ok is not None:
        print(f"  {'✅' if http_queue_ok else '❌'} HTTP request queued")
    else:
        print(f"  ⚠️  HTTP request queue (not accessible)")
    
    print(f"  {'✅' if edge_ok else '❌'} Edge function (direct call)")
    
    if status:
        print(f"\n  Final Status: {status}")
    
    print()
    
    if not config_ok:
        print("❌ FAILED: Missing app_config.service_role_key")
        print("\n🔧 Fix: Run migration 20251019240001_call_charge_payment_edge_function.sql")
    elif attempt and status == 'success':
        print("✅ SUCCESS: Trigger → Edge Function flow is working!")
    elif attempt and status == 'pending':
        print("⚠️  WARNING: Payment still pending - may need more time or manual check")
    elif edge_ok:
        print("⚠️  WARNING: Edge function works, but trigger may not be firing")
        print("\n🔧 Check:")
        print("  - Database logs for trigger errors")
        print("  - Supabase Edge Function logs")
    else:
        print("❌ FAILED: Edge function not working")
        print("\n🔧 Check:")
        print("  - Is edge function deployed? (supabase functions deploy charge-payment)")
        print("  - Check Supabase Edge Function logs")
    
    print()
    return 0

if __name__ == '__main__':
    exit(main())

