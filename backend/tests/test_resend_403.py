#!/usr/bin/env python3
"""
Test for diagnosing 403 Forbidden error from Resend API
This test checks:
1. API key validity
2. Domain verification status
3. Email sending permissions
4. Sender email configuration
"""
import requests
import json
import base64

# API key from backend config
RESEND_API_KEY = "re_Wr7jYKK2_Ax1ZQhyi3JLbpYFVDUD6JMaD"

# Expected sender email (from backend/main.py line 796)
SENDER_EMAIL = "billing@kom.botkorp.com"
SENDER_DOMAIN = SENDER_EMAIL.split('@')[1]

print("="*70)
print("🔍 DIAGNOSING RESEND API 403 ERROR")
print("="*70)
print(f"API Key: {RESEND_API_KEY[:10]}...{RESEND_API_KEY[-4:]}")
print(f"Sender Email: {SENDER_EMAIL}")
print(f"Sender Domain: {SENDER_DOMAIN}")
print()

headers = {
    "Authorization": f"Bearer {RESEND_API_KEY}",
    "Content-Type": "application/json"
}

# Test 1: Check API key validity
print("="*70)
print("TEST 1: API Key Validity")
print("="*70)
response = requests.get("https://api.resend.com/api-keys", headers=headers)
print(f"Status Code: {response.status_code}")

if response.status_code == 200:
    print("✅ API key is valid")
    try:
        data = response.json()
        print(f"Response: {json.dumps(data, indent=2)}")
    except:
        print(f"Response: {response.text}")
elif response.status_code == 401:
    print("❌ API key is INVALID or EXPIRED")
    print("Action needed: Get new API key from https://resend.com/api-keys")
    exit(1)
elif response.status_code == 403:
    print("⚠️  API key is valid but has INSUFFICIENT PERMISSIONS")
    print("This API key might be read-only or restricted")
else:
    print(f"⚠️  Unexpected response: {response.text[:200]}")

print()

# Test 2: Check domains
print("="*70)
print("TEST 2: Domain Verification Status")
print("="*70)
response = requests.get("https://api.resend.com/domains", headers=headers)
print(f"Status Code: {response.status_code}")

verified_domains = []
if response.status_code == 200:
    try:
        data = response.json()
        if data.get('data'):
            print(f"✅ Found {len(data['data'])} domain(s):")
            for domain in data['data']:
                status = domain.get('status', 'unknown')
                name = domain.get('name', 'unknown')
                verified_domains.append(name)
                icon = "✅" if status == 'verified' else "❌"
                print(f"   {icon} {name}: {status}")
                if status != 'verified':
                    print(f"      Action: Verify at https://resend.com/domains")
        else:
            print("❌ No domains configured")
            print("Action needed: Add domain at https://resend.com/domains")
    except Exception as e:
        print(f"Error parsing response: {e}")
        print(f"Response: {response.text[:500]}")
elif response.status_code == 401:
    print("❌ API key is invalid")
    exit(1)
elif response.status_code == 403:
    print("❌ API key lacks permission to view domains")
    print("This might be a read-only or restricted key")
else:
    print(f"Response: {response.text[:200]}")

print()

# Test 3: Check if sender domain is verified
print("="*70)
print("TEST 3: Sender Domain Check")
print("="*70)
if SENDER_DOMAIN in verified_domains:
    print(f"✅ Sender domain '{SENDER_DOMAIN}' is configured")
else:
    print(f"❌ Sender domain '{SENDER_DOMAIN}' is NOT in verified domains list")
    print(f"Action needed:")
    print(f"   1. Add and verify '{SENDER_DOMAIN}' at https://resend.com/domains")
    print(f"   2. OR change sender email to use a verified domain")
    print(f"   3. OR use Resend test domain: onboarding@resend.dev")

print()

# Test 4: Try sending a test email
print("="*70)
print("TEST 4: Actual Email Send Test")
print("="*70)
print("Attempting to send test email...")

test_payload = {
    "from": SENDER_EMAIL,
    "to": ["test@example.com"],  # Won't actually send to example.com
    "subject": "Test Email - Resend API 403 Diagnostic",
    "html": "<p>This is a test email to diagnose 403 error</p>",
}

print(f"Payload: {json.dumps(test_payload, indent=2)}")
print()

response = requests.post(
    "https://api.resend.com/emails",
    json=test_payload,
    headers=headers
)

print(f"Status Code: {response.status_code}")

if response.status_code == 200:
    print("✅ Email sent successfully!")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
elif response.status_code == 403:
    print("❌ 403 FORBIDDEN - This is the error you're seeing!")
    try:
        error_data = response.json()
        print(f"Error details: {json.dumps(error_data, indent=2)}")
        
        if 'message' in error_data:
            message = error_data['message'].lower()
            if 'domain' in message:
                print("\n🔍 Root Cause: DOMAIN NOT VERIFIED")
                print(f"   The domain '{SENDER_DOMAIN}' is not verified in Resend")
            elif 'api key' in message or 'permission' in message:
                print("\n🔍 Root Cause: API KEY PERMISSIONS")
                print(f"   The API key doesn't have permission to send emails")
            else:
                print(f"\n🔍 Error message: {error_data['message']}")
    except:
        print(f"Response: {response.text[:500]}")
elif response.status_code == 401:
    print("❌ Unauthorized - API key is invalid")
elif response.status_code == 422:
    print("⚠️  Validation error")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
else:
    print(f"Response: {response.text[:500]}")

print()

# Test 5: Try with Resend test domain
print("="*70)
print("TEST 5: Test with Resend's Test Domain")
print("="*70)
print("Trying with onboarding@resend.dev (always works)...")

test_payload_resend = {
    "from": "onboarding@resend.dev",
    "to": ["delivered@resend.dev"],  # Resend's test recipient
    "subject": "Test Email - Resend Test Domain",
    "html": "<p>This email uses Resend's test domain</p>",
}

response = requests.post(
    "https://api.resend.com/emails",
    json=test_payload_resend,
    headers=headers
)

print(f"Status Code: {response.status_code}")

if response.status_code == 200:
    print("✅ Test email sent successfully with resend.dev domain!")
    print("This proves the API key works, but your custom domain needs verification")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
elif response.status_code == 403:
    print("❌ 403 even with test domain - API key has no send permission")
    print("Action needed: Generate a new API key with 'Sending access' enabled")
    print(f"Response: {response.text[:500]}")
else:
    print(f"Response: {response.text[:500]}")

print()

# Summary and recommendations
print("="*70)
print("📋 SUMMARY & RECOMMENDATIONS")
print("="*70)
print()
print("Current Configuration:")
print(f"  • API Key: {RESEND_API_KEY[:10]}...{RESEND_API_KEY[-4:]}")
print(f"  • Sender: {SENDER_EMAIL}")
print(f"  • Backend: https://botkorp-backend-695066639923.europe-west1.run.app")
print()
print("To fix the 403 error, choose ONE of these solutions:")
print()
print("OPTION 1: Verify Custom Domain (RECOMMENDED)")
print("  1. Go to https://resend.com/domains")
print(f"  2. Add domain '{SENDER_DOMAIN}' if not already added")
print(f"  3. Complete DNS verification (add TXT, MX, DKIM records)")
print("  4. Wait for verification (can take up to 72 hours)")
print()
print("OPTION 2: Use Resend Test Domain (FOR TESTING ONLY)")
print("  1. Edit backend/main.py line 796")
print("  2. Change from: 'BotKorp Billing <billing@kom.botkorp.com>'")
print("  3. Change to:   'BotKorp Billing <onboarding@resend.dev>'")
print("  4. Redeploy backend")
print("  Note: Test domain has limits and is for testing only")
print()
print("OPTION 3: Get New API Key (If current key is restricted)")
print("  1. Go to https://resend.com/api-keys")
print("  2. Create new API key with 'Sending access' permission")
print("  3. Update Cloud Run environment variable:")
print("     gcloud run services update botkorp-backend \\")
print("       --region=europe-west1 \\")
print("       --update-env-vars RESEND_API_KEY=re_YOUR_NEW_KEY")
print()
print("="*70)
print("🔗 Useful Links:")
print("="*70)
print("Resend Dashboard: https://resend.com/overview")
print("API Keys:         https://resend.com/api-keys")
print("Domains:          https://resend.com/domains")
print("Email Logs:       https://resend.com/emails")
print("="*70)

