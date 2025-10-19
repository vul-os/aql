#!/usr/bin/env python3
"""
Check Payment Attempt Errors

Shows why payments are failing by displaying error messages from Paystack
"""

import json
import urllib.request
import urllib.error

# Supabase configuration
SUPABASE_URL = 'https://kyoowsarfopltjwmhksi.supabase.co'
SUPABASE_SERVICE_KEY = 'sb_secret_REDACTED'

def get_payment_attempts():
    """Get recent payment attempts with errors."""
    url = f"{SUPABASE_URL}/rest/v1/payment_attempts?order=created_at.desc&limit=10"
    
    headers = {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
    }
    
    req = urllib.request.Request(url, headers=headers)
    
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print(f"Error: {e}")
        return []

def main():
    print("\n" + "="*70)
    print("💳 PAYMENT ATTEMPT ERROR CHECKER")
    print("="*70 + "\n")
    
    attempts = get_payment_attempts()
    
    if not attempts:
        print("No payment attempts found")
        return
    
    print(f"Found {len(attempts)} recent payment attempt(s)\n")
    
    for i, attempt in enumerate(attempts, 1):
        print(f"{'='*70}")
        print(f"Attempt #{i}: {attempt['id']}")
        print(f"{'='*70}")
        print(f"Status: {attempt['status']}")
        print(f"Amount: R{attempt['amount']:.2f}")
        print(f"Created: {attempt['created_at']}")
        print(f"Attempt Number: {attempt.get('attempt_number', 'N/A')}")
        print(f"Retry Count: {attempt.get('retry_count', 0)}")
        
        if attempt.get('error_message'):
            print(f"\n❌ Error Message:")
            print(f"   {attempt['error_message']}")
        
        if attempt.get('paystack_response'):
            print(f"\n📊 Paystack Response:")
            response = attempt['paystack_response']
            
            # Pretty print the response
            if isinstance(response, dict):
                print(f"   Status: {response.get('status', 'N/A')}")
                print(f"   Message: {response.get('message', 'N/A')}")
                
                if response.get('data'):
                    print(f"   Data:")
                    for key, value in response['data'].items():
                        print(f"     - {key}: {value}")
            else:
                print(f"   {json.dumps(response, indent=2)}")
        
        if attempt.get('paystack_reference'):
            print(f"\n✅ Reference: {attempt['paystack_reference']}")
        
        print()
    
    # Summary
    print("\n" + "="*70)
    print("📊 SUMMARY")
    print("="*70 + "\n")
    
    status_counts = {}
    for attempt in attempts:
        status = attempt['status']
        status_counts[status] = status_counts.get(status, 0) + 1
    
    for status, count in status_counts.items():
        icon = {
            'success': '✅',
            'failed': '❌',
            'pending': '⏳',
            'retry': '🔄'
        }.get(status, '❓')
        print(f"{icon} {status}: {count}")
    
    # Check for common issues
    print("\n" + "="*70)
    print("🔍 COMMON ISSUES")
    print("="*70 + "\n")
    
    failed_attempts = [a for a in attempts if a['status'] in ['failed', 'retry']]
    
    if not failed_attempts:
        print("✅ No failed attempts!")
    else:
        error_messages = [a.get('error_message', 'Unknown') for a in failed_attempts if a.get('error_message')]
        
        if any('authorization' in msg.lower() or 'auth' in msg.lower() for msg in error_messages):
            print("❌ Authorization Issues Detected")
            print("   • Check if Paystack authorization codes are valid")
            print("   • Test cards might not support recurring charges")
            print("   • Try using a real card to test")
        
        if any('insufficient' in msg.lower() for msg in error_messages):
            print("❌ Insufficient Funds")
            print("   • Test card might not have sufficient balance")
        
        if any('declined' in msg.lower() for msg in error_messages):
            print("❌ Card Declined")
            print("   • Card issuer declined the transaction")
        
        if any('invalid' in msg.lower() or 'not found' in msg.lower() for msg in error_messages):
            print("❌ Invalid Data")
            print("   • Authorization code might be invalid or expired")
            print("   • Check payment_authorizations table")
    
    print()

if __name__ == '__main__':
    main()

