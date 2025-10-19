#!/usr/bin/env python3
"""
Manually trigger retry_failed_payments function

This will retry all payment attempts that have status='retry' or 'failed'
"""

import json
import urllib.request
import urllib.error

# Supabase configuration
SUPABASE_URL = 'https://kyoowsarfopltjwmhksi.supabase.co'
SUPABASE_SERVICE_KEY = 'sb_secret_REDACTED'

def retry_failed_payments():
    """Call the retry_failed_payments database function."""
    print("\n" + "="*70)
    print("🔄 MANUALLY TRIGGERING PAYMENT RETRIES")
    print("="*70 + "\n")
    
    url = f"{SUPABASE_URL}/rest/v1/rpc/retry_failed_payments"
    
    headers = {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
        'Content-Type': 'application/json'
    }
    
    req = urllib.request.Request(
        url,
        data=b'{}',
        headers=headers,
        method='POST'
    )
    
    try:
        print("📞 Calling retry_failed_payments()...")
        with urllib.request.urlopen(req, timeout=30) as response:
            result = json.loads(response.read().decode('utf-8'))
            
            print(f"\n✅ Function executed successfully!\n")
            print("📊 Results:")
            print(f"   • Retries scheduled: {result.get('retries_scheduled', 0)}")
            print(f"   • Subscriptions paused: {result.get('subscriptions_paused', 0)}")
            print(f"   • Timestamp: {result.get('timestamp')}")
            
            if result.get('retries_scheduled', 0) > 0:
                print("\n⏳ Waiting 5 seconds for edge function to process retries...")
                import time
                time.sleep(5)
                print("✅ Done! Check payment status with:")
                print("   python3 check_payment_errors.py")
            else:
                print("\nℹ️  No failed payments needed retry")
            
            return True
            
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        print(f"\n❌ HTTP Error {e.code}")
        print(f"   {error_body}\n")
        return False
        
    except Exception as e:
        print(f"\n❌ Error: {str(e)}\n")
        import traceback
        traceback.print_exc()
        return False

def main():
    success = retry_failed_payments()
    
    if success:
        print("\n" + "="*70)
        print("✅ Retry triggered successfully!")
        print("="*70)
        print("\nNext steps:")
        print("  1. Wait a few seconds for edge function to process")
        print("  2. Check results: python3 check_payment_errors.py")
        print()
    else:
        print("\n" + "="*70)
        print("❌ Retry failed")
        print("="*70)
        print("\nTroubleshooting:")
        print("  1. Check if retry_failed_payments() function exists in database")
        print("  2. Check database logs for errors")
        print("  3. Verify service key is correct")
        print()
    
    return 0 if success else 1

if __name__ == '__main__':
    exit(main())

