#!/usr/bin/env python3
"""Test email sending with Resend API key locally"""
import requests
import base64

RESEND_API_KEY = "re_Wr7jYKK2_Ax1ZQhyi3JLbpYFVDUD6JMaD"

print("=" * 80)
print("TESTING EMAIL SENDING LOCALLY")
print("=" * 80)

# Test 1: Verify API key
print("\n1️⃣ Verifying API key...")
headers = {
    "Authorization": f"Bearer {RESEND_API_KEY}",
}

response = requests.get("https://api.resend.com/domains", headers=headers)
print(f"   Status: {response.status_code}")

if response.status_code == 401:
    print(f"   ❌ API key is INVALID")
    print(f"   You need to get a new API key from: https://resend.com/api-keys")
    exit(1)
elif response.status_code == 200:
    print(f"   ✅ API key is VALID")
    domains = response.json().get('data', [])
    if domains:
        print(f"   Verified domains:")
        for domain in domains:
            print(f"      - {domain['name']}: {domain['status']}")
    else:
        print(f"   ⚠️  No domains verified yet")
else:
    print(f"   Response: {response.text}")

# Test 2: Send test email
print("\n2️⃣ Sending test email...")

test_payload = {
    "from": "BotKorp <onboarding@resend.dev>",  # Use Resend's test domain
    "to": ["botkorpza@gmail.com"],
    "subject": "Test Invoice from BotKorp",
    "html": """
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2 style="color: #2563eb;">Test Invoice from BotKorp</h2>
        <p>Dear Customer,</p>
        <p>This is a test email to verify invoice sending is working.</p>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Invoice Number:</strong> INV-TEST-001</p>
            <p><strong>Total Amount:</strong> R500.00</p>
            <p><strong>Due Date:</strong> 2025-10-26</p>
        </div>
        <p>Best regards,<br>The BotKorp Team</p>
    </body>
    </html>
    """,
    "attachments": [
        {
            "filename": "test-invoice.txt",
            "content": base64.b64encode(b"This is a test PDF attachment").decode()
        }
    ]
}

response = requests.post(
    "https://api.resend.com/emails",
    json=test_payload,
    headers={
        "Authorization": f"Bearer {RESEND_API_KEY}",
        "Content-Type": "application/json"
    }
)

print(f"   Status: {response.status_code}")

if response.status_code == 200:
    data = response.json()
    print(f"   ✅ Email sent successfully!")
    print(f"   Email ID: {data.get('id')}")
    print(f"   Check botkorpza@gmail.com inbox")
elif response.status_code == 403:
    print(f"   ❌ 403 Forbidden - Domain not verified or API key lacks permissions")
    print(f"   Response: {response.text}")
    print(f"\n   Solutions:")
    print(f"   1. Use onboarding@resend.dev (testing only)")
    print(f"   2. Verify botkorp.co.za domain at: https://resend.com/domains")
else:
    print(f"   ❌ Error: {response.status_code}")
    print(f"   Response: {response.text}")

print("\n" + "=" * 80)

