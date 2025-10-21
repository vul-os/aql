#!/usr/bin/env python3
"""
Test Charge Payment Edge Function

Manually calls the charge-payment edge function to test if it's working.
"""

import json
import urllib.request
import urllib.error

# Supabase configuration
SUPABASE_URL = 'https://kyoowsarfopltjwmhksi.supabase.co'
SUPABASE_SERVICE_KEY = 'sb_secret_REDACTED'
def test_charge_payment():
    """Test the charge-payment edge function."""
    print("\n" + "="*60)
    print("🧪 TESTING CHARGE-PAYMENT EDGE FUNCTION")
    print("="*60 + "\n")
    
    url = f"{SUPABASE_URL}/functions/v1/charge-payment"
    
    print(f"📍 URL: {url}")
    print(f"🔑 Using service role key\n")
    
    try:
        # Call the edge function
        req = urllib.request.Request(
            url,
            data=b'{}',  # Empty body - function queries DB
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}'
            },
            method='POST'
        )
        
        print("📤 Calling edge function...")
        
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode('utf-8'))
            
            print(f"\n✅ SUCCESS! Status: {response.status}\n")
            print("📊 Response:")
            print(f"  • Processed: {result.get('processed', 0)}")
            print(f"  • Successful: {result.get('successful', 0)}")
            print(f"  • Failed: {result.get('failed', 0)}")
            
            if result.get('errors'):
                print(f"\n  ⚠️  Errors:")
                for error in result.get('errors', []):
                    print(f"    - {error}")
            
            print(f"\n  🕐 Timestamp: {result.get('timestamp')}")
            
            return True
            
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        print(f"\n❌ HTTP ERROR {e.code}")
        print(f"  {error_body}\n")
        
        try:
            error_data = json.loads(error_body)
            if 'error' in error_data:
                print(f"  Error: {error_data['error']}")
            if 'reason' in error_data:
                print(f"  Reason: {error_data['reason']}")
            if 'details' in error_data:
                print(f"  Details: {error_data['details']}")
        except:
            pass
            
        return False
        
    except Exception as e:
        print(f"\n❌ ERROR: {str(e)}\n")
        import traceback
        traceback.print_exc()
        return False


def check_pending_attempts():
    """Check for pending payment attempts in database."""
    print("\n" + "="*60)
    print("📋 CHECKING PENDING PAYMENT ATTEMPTS")
    print("="*60 + "\n")
    
    url = f"{SUPABASE_URL}/rest/v1/payment_attempts"
    
    try:
        req = urllib.request.Request(
            url + "?status=eq.pending&select=*",
            headers={
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}'
            }
        )
        
        with urllib.request.urlopen(req) as response:
            attempts = json.loads(response.read().decode('utf-8'))
            
            if attempts:
                print(f"Found {len(attempts)} pending payment attempt(s):\n")
                for i, attempt in enumerate(attempts, 1):
                    print(f"{i}. Attempt ID: {attempt.get('id')}")
                    print(f"   Invoice ID: {attempt.get('invoice_id')}")
                    print(f"   Amount: R{attempt.get('amount', 0):.2f}")
                    print(f"   Created: {attempt.get('created_at')}")
                    print()
            else:
                print("ℹ️  No pending payment attempts found.")
                print("   This is why the edge function didn't process anything.\n")
            
            return len(attempts)
            
    except Exception as e:
        print(f"❌ Error checking attempts: {str(e)}\n")
        return 0


def main():
    """Main test function."""
    print("\n" + "="*60)
    print("🧪 CHARGE PAYMENT EDGE FUNCTION TESTER")
    print("="*60 + "\n")
    
    # Check for pending attempts
    pending_count = check_pending_attempts()
    
    # Test the edge function
    success = test_charge_payment()
    
    # Summary
    print("\n" + "="*60)
    print("📊 SUMMARY")
    print("="*60 + "\n")
    
    if success:
        print("✅ Edge function is working correctly!")
        if pending_count == 0:
            print("ℹ️  No pending payments to process (this is normal)")
        else:
            print(f"✅ Processed {pending_count} pending payment(s)")
    else:
        print("❌ Edge function test failed")
        print("\n🔧 Troubleshooting:")
        print("  1. Check if the edge function is deployed")
        print("  2. Verify service role key is correct")
        print("  3. Check Edge Function logs in Supabase Dashboard")
        print("  4. Run the fix migration: 20251019240003_fix_charge_payment_trigger.sql")
    
    print()
    return 0 if success else 1


if __name__ == '__main__':
    exit(main())

