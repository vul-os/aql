#!/usr/bin/env python3
"""Test Resend API key and domain verification"""
import requests

RESEND_API_KEY = "re_HjE9aC37_P2q9RsQAr4F91i3cKHKEfwgN"

print("🔍 Testing Resend API Key...")
print(f"Key: {RESEND_API_KEY[:10]}...{RESEND_API_KEY[-4:]}\n")

# Test 1: Check API key validity
print("1️⃣ Testing API key validity...")
headers = {
    "Authorization": f"Bearer {RESEND_API_KEY}",
}

# Try to get API key info
response = requests.get("https://api.resend.com/api-keys", headers=headers)
print(f"   Status: {response.status_code}")
if response.status_code == 200:
    print(f"   ✅ API key is valid")
elif response.status_code == 401:
    print(f"   ❌ API key is invalid or expired")
    print(f"   Get new key from: https://resend.com/api-keys")
elif response.status_code == 403:
    print(f"   ⚠️  API key valid but insufficient permissions")
else:
    print(f"   Response: {response.text[:200]}")

# Test 2: Check domains
print("\n2️⃣ Checking verified domains...")
response = requests.get("https://api.resend.com/domains", headers=headers)
print(f"   Status: {response.status_code}")
if response.status_code == 200:
    domains = response.json()
    if domains.get('data'):
        print(f"   ✅ Verified domains:")
        for domain in domains['data']:
            print(f"      - {domain['name']}: {domain['status']}")
    else:
        print(f"   ⚠️  No domains verified")
        print(f"   Add domain at: https://resend.com/domains")
elif response.status_code == 401:
    print(f"   ❌ API key is invalid")
else:
    print(f"   Response: {response.text[:200]}")

print("\n" + "="*60)
print("📧 EMAIL CONFIGURATION NEEDED:")
print("="*60)
print("1. Get new Resend API key: https://resend.com/api-keys")
print("2. Verify domain 'botkorp.co.za': https://resend.com/domains")
print("3. Update Cloud Run environment variable:")
print("   gcloud run services update botkorp-backend \\")
print("     --region=europe-west1 \\")
print("     --update-env-vars RESEND_API_KEY=re_YOUR_NEW_KEY")
print("="*60)

