#!/usr/bin/env python3
"""
Test Deposit Invoice & Payment Attempt Generation Flow

This test verifies the complete flow:
1. Create service with rental agreement
2. Set rental agreement to 'active'
3. Verify deposit invoice is created automatically
4. Verify payment attempt is created automatically
5. Verify edge function processes the payment
"""

import json
import urllib.request
import urllib.error
import time
import uuid

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
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        print(f"      ❌ HTTP Error {e.code}: {error_body[:300]}")
        raise
    except Exception as e:
        print(f"      ❌ Error: {str(e)}")
        raise

def get_test_user():
    """Get or find a test user with payment authorization."""
    print("   Looking for test user with payment authorization...")
    
    # Get user with authorization
    auths = api_request('payment_authorizations?is_active=eq.true&limit=1')
    
    if not auths or len(auths) == 0:
        print("   ❌ No users with payment authorization found")
        print("      Please add a payment method first")
        return None
    
    auth = auths[0]
    user_id = auth['user_id']
    org_id = auth['organization_id']
    
    print(f"   ✅ Found user: {user_id[:8]}...")
    print(f"      Org: {org_id[:8]}...")
    print(f"      Auth: ****{auth['last4']}")
    
    return {
        'user_id': user_id,
        'organization_id': org_id,
        'auth': auth
    }

def get_test_location(user_data):
    """Get or create a test location."""
    print("\n   Looking for test location...")
    
    # Try to find existing location
    locations = api_request(f"locations?organization_id=eq.{user_data['organization_id']}&limit=1")
    
    if locations and len(locations) > 0:
        location = locations[0]
        print(f"   ✅ Using existing location: {location['name']}")
        return location
    
    # Create new location
    print("   Creating new test location...")
    location_data = {
        'organization_id': user_data['organization_id'],
        'name': f'Test Location {uuid.uuid4().hex[:8]}',
        'address': '123 Test Street',
        'city': 'Johannesburg',
        'province': 'Gauteng',
        'postal_code': '2000',
        'country': 'South Africa'
    }
    
    result = api_request('locations', method='POST', data=json.dumps(location_data))
    
    if result and len(result) > 0:
        print(f"   ✅ Created location: {result[0]['name']}")
        return result[0]
    else:
        raise Exception("Failed to create location")

def create_test_service(user_data, location):
    """Get or create a test service."""
    print("\n   Looking for test service...")
    
    # Try to find existing service
    services = api_request(
        f"services?organization_id=eq.{user_data['organization_id']}&location_id=eq.{location['id']}&service_type=eq.lawn&limit=1"
    )
    
    if services and len(services) > 0:
        service = services[0]
        print(f"   ✅ Using existing service: {service['name']}")
        return service
    
    # Create new service
    print("   Creating new test service...")
    service_data = {
        'organization_id': user_data['organization_id'],
        'location_id': location['id'],
        'name': f'Test Service {uuid.uuid4().hex[:8]}',
        'service_type': 'lawn',
        'status': 'pending_setup',
        'service_frequency': 'weekly',
        'services_per_month': 4
    }
    
    result = api_request('services', method='POST', data=json.dumps(service_data))
    
    if result and len(result) > 0:
        service = result[0]
        print(f"   ✅ Service created: {service['id'][:8]}...")
        return service
    else:
        raise Exception("Failed to create service")

def create_rental_agreement(user_data, location, service):
    """Create a rental agreement (initially with status='pending')."""
    print("\n   Creating rental agreement...")
    
    # Get garden_id or pool_id from service
    garden_id = None
    pool_id = None
    
    # Check if service has gardens
    gardens = api_request(f"gardens?service_id=eq.{service['id']}&limit=1")
    if gardens and len(gardens) > 0:
        garden_id = gardens[0]['id']
    
    agreement_data = {
        'user_id': user_data['user_id'],
        'organization_id': user_data['organization_id'],
        'location_id': location['id'],
        'service_id': service['id'],
        'garden_id': garden_id,  # May be null
        'bot_type': 'mow_bot',
        'number_of_bots': 1,
        'services_per_month': 4,
        'monthly_total': 550.00,
        'bot_rental_total': 150.00,
        'service_total': 400.00,
        'setup_fee': 299.00,
        'billing_day': 1,
        'status': 'pending',  # Start as pending
        'agreement_number': f'RA-TEST-{uuid.uuid4().hex[:8].upper()}',
        'signer_first_name': 'Test',
        'signer_surname': 'User',
        'signer_email': 'test@example.com'
    }
    
    result = api_request('rental_agreements', method='POST', data=json.dumps(agreement_data))
    
    if result and len(result) > 0:
        agreement = result[0]
        print(f"   ✅ Rental agreement created: {agreement['agreement_number']}")
        print(f"      ID: {agreement['id'][:8]}...")
        print(f"      Status: {agreement['status']}")
        return agreement
    else:
        raise Exception("Failed to create rental agreement")

def activate_rental_agreement(agreement_id):
    """Activate rental agreement - this should trigger deposit invoice creation."""
    print("\n   🎬 Activating rental agreement (this triggers the flow)...")
    
    update_data = {
        'status': 'active',
        'signed_at': 'now()',
        'started_at': 'now()'
    }
    
    result = api_request(
        f'rental_agreements?id=eq.{agreement_id}',
        method='PATCH',
        data=json.dumps(update_data)
    )
    
    if result and len(result) > 0:
        print(f"   ✅ Rental agreement activated!")
        print(f"      Status: {result[0]['status']}")
        return result[0]
    else:
        raise Exception("Failed to activate rental agreement")

def check_deposit_invoice(agreement_id, timeout=10):
    """Check if deposit invoice was created."""
    print("\n   Checking for deposit invoice...")
    
    start_time = time.time()
    while time.time() - start_time < timeout:
        invoices = api_request(
            f'invoices?rental_agreement_id=eq.{agreement_id}&notes=ilike.*Deposit*'
        )
        
        if invoices and len(invoices) > 0:
            invoice = invoices[0]
            print(f"   ✅ Deposit invoice created!")
            print(f"      Invoice: {invoice['invoice_number']}")
            print(f"      Amount: R{invoice['total_amount']:.2f}")
            print(f"      Status: {invoice['status']}")
            print(f"      Due Date: {invoice['due_date']}")
            return invoice
        
        time.sleep(1)
    
    print(f"   ❌ No deposit invoice found after {timeout} seconds")
    return None

def check_payment_attempt(invoice_id, timeout=10):
    """Check if payment attempt was created."""
    print("\n   Checking for payment attempt...")
    
    start_time = time.time()
    while time.time() - start_time < timeout:
        attempts = api_request(
            f'payment_attempts?invoice_id=eq.{invoice_id}'
        )
        
        if attempts and len(attempts) > 0:
            attempt = attempts[0]
            print(f"   ✅ Payment attempt created!")
            print(f"      ID: {attempt['id'][:8]}...")
            print(f"      Amount: R{attempt['amount']:.2f}")
            print(f"      Status: {attempt['status']}")
            print(f"      Created: {attempt['created_at']}")
            return attempt
        
        time.sleep(1)
    
    print(f"   ❌ No payment attempt found after {timeout} seconds")
    return None

def check_payment_success(attempt_id, timeout=15):
    """Check if payment was processed successfully."""
    print("\n   Waiting for edge function to process payment...")
    
    start_time = time.time()
    while time.time() - start_time < timeout:
        attempts = api_request(
            f'payment_attempts?id=eq.{attempt_id}'
        )
        
        if attempts and len(attempts) > 0:
            attempt = attempts[0]
            status = attempt['status']
            
            if status == 'success':
                print(f"   ✅ Payment processed successfully!")
                print(f"      Reference: {attempt.get('paystack_reference', 'N/A')}")
                if attempt.get('paystack_response'):
                    response = attempt['paystack_response']
                    if isinstance(response, dict):
                        print(f"      Gateway: {response.get('data', {}).get('gateway_response', 'N/A')}")
                return True
            elif status in ['failed', 'retry']:
                print(f"   ❌ Payment failed: {attempt.get('error_message', 'Unknown error')}")
                return False
            else:
                print(f"      Status: {status} (waiting...)")
        
        time.sleep(2)
    
    print(f"   ⏰ Payment still pending after {timeout} seconds")
    return None

def cleanup_test_data(service_id, agreement_id):
    """Clean up test data (optional)."""
    print("\n   Cleaning up test data...")
    try:
        # Delete rental agreement
        api_request(f'rental_agreements?id=eq.{agreement_id}', method='DELETE')
        # Delete service
        api_request(f'services?id=eq.{service_id}', method='DELETE')
        print("   ✅ Test data cleaned up")
    except:
        print("   ⚠️  Could not clean up (data may have constraints)")

def main():
    """Run the complete deposit flow test."""
    print("\n" + "="*70)
    print("🧪 DEPOSIT INVOICE & PAYMENT ATTEMPT GENERATION TEST")
    print("="*70)
    print("\nThis test verifies the complete automated flow:\n")
    print("1. Create rental agreement")
    print("2. Activate rental agreement")
    print("3. Deposit invoice auto-created")
    print("4. Payment attempt auto-created")
    print("5. Edge function processes payment")
    print()
    
    service = None
    agreement = None
    
    try:
        # Step 1: Get test user
        print("="*70)
        print("1️⃣  SETUP TEST DATA")
        print("="*70)
        
        user_data = get_test_user()
        if not user_data:
            return 1
        
        location = get_test_location(user_data)
        service = create_test_service(user_data, location)
        
        # Step 2: Create rental agreement
        print("\n" + "="*70)
        print("2️⃣  CREATE RENTAL AGREEMENT")
        print("="*70)
        
        agreement = create_rental_agreement(user_data, location, service)
        
        # Step 3: Activate agreement (triggers the flow)
        print("\n" + "="*70)
        print("3️⃣  ACTIVATE RENTAL AGREEMENT (TRIGGER FLOW)")
        print("="*70)
        
        agreement = activate_rental_agreement(agreement['id'])
        
        # Step 4: Check deposit invoice
        print("\n" + "="*70)
        print("4️⃣  VERIFY DEPOSIT INVOICE CREATED")
        print("="*70)
        
        invoice = check_deposit_invoice(agreement['id'])
        if not invoice:
            print("\n❌ TEST FAILED: Deposit invoice not created")
            return 1
        
        # Step 5: Check payment attempt
        print("\n" + "="*70)
        print("5️⃣  VERIFY PAYMENT ATTEMPT CREATED")
        print("="*70)
        
        attempt = check_payment_attempt(invoice['id'])
        if not attempt:
            print("\n❌ TEST FAILED: Payment attempt not created")
            print("\n🔧 Possible issues:")
            print("  • create_deposit_invoice() function not updated")
            print("  • No payment authorization for user")
            print("  • Database trigger not firing")
            return 1
        
        # Step 6: Check payment success
        print("\n" + "="*70)
        print("6️⃣  VERIFY PAYMENT PROCESSED")
        print("="*70)
        
        success = check_payment_success(attempt['id'])
        
        # Summary
        print("\n" + "="*70)
        print("📊 TEST SUMMARY")
        print("="*70)
        print()
        print(f"✅ Rental Agreement: {agreement['agreement_number']}")
        print(f"✅ Deposit Invoice: {invoice['invoice_number']}")
        print(f"✅ Payment Attempt: {attempt['id'][:8]}...")
        
        if success:
            print(f"✅ Payment Status: SUCCESS")
            print()
            print("🎉 TEST PASSED: Complete flow working!")
        elif success is False:
            print(f"❌ Payment Status: FAILED")
            print()
            print("⚠️  TEST PARTIALLY PASSED:")
            print("  ✅ Invoice created automatically")
            print("  ✅ Payment attempt created automatically")
            print("  ❌ Payment failed (check Paystack credentials)")
        else:
            print(f"⏳ Payment Status: PENDING")
            print()
            print("⚠️  TEST PARTIALLY PASSED:")
            print("  ✅ Invoice created automatically")
            print("  ✅ Payment attempt created automatically")
            print("  ⏳ Payment still processing")
        
        print()
        print("="*70)
        
        # Optional cleanup
        # cleanup_test_data(service['id'], agreement['id'])
        
        return 0 if success else 1
        
    except Exception as e:
        print(f"\n❌ TEST FAILED WITH ERROR:")
        print(f"   {str(e)}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == '__main__':
    exit(main())

