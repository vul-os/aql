#!/usr/bin/env python3
"""
Test invoice PDF generation for existing invoice
Tests the /api/send-invoice-email endpoint on deployed backend
"""
import requests
import json

# Configuration
BACKEND_URL = "https://botkorp-backend-695066639923.europe-west1.run.app"
INVOICE_ID = "595dac04-dab3-41fe-9fda-e319b8195a62"

print("="*70)
print("🧪 TESTING INVOICE PDF GENERATION")
print("="*70)
print(f"Backend URL: {BACKEND_URL}")
print(f"Invoice ID: {INVOICE_ID}")
print()

# Test 1: Health check
print("="*70)
print("TEST 1: Backend Health Check")
print("="*70)
try:
    response = requests.get(f"{BACKEND_URL}/health", timeout=10)
    print(f"Status Code: {response.status_code}")
    
    if response.status_code == 200:
        health_data = response.json()
        print("✅ Backend is healthy")
        print(f"   Revision: {health_data.get('revision')}")
        print(f"   Supabase: {health_data.get('supabase')}")
        print(f"   Environment: {health_data.get('environment')}")
    else:
        print(f"❌ Health check failed: {response.status_code}")
        print(f"Response: {response.text}")
        exit(1)
except Exception as e:
    print(f"❌ Failed to connect to backend: {e}")
    exit(1)

print()

# Test 2: Trigger PDF generation and email
print("="*70)
print("TEST 2: Generate Invoice PDF and Send Email")
print("="*70)
print(f"Requesting PDF generation for invoice: {INVOICE_ID}")
print()

payload = {
    "invoice_id": INVOICE_ID
}

try:
    print("Sending POST request...")
    response = requests.post(
        f"{BACKEND_URL}/api/send-invoice-email",
        json=payload,
        headers={"Content-Type": "application/json"},
        timeout=60  # PDF generation can take time
    )
    
    print(f"Status Code: {response.status_code}")
    print()
    
    if response.status_code == 200:
        result = response.json()
        print("✅ PDF GENERATION SUCCESSFUL!")
        print()
        print("Response:")
        print(json.dumps(result, indent=2))
        print()
        
        if result.get('success'):
            print("📄 PDF Details:")
            print(f"   • Invoice ID: {result.get('invoice_id')}")
            print(f"   • PDF URL: {result.get('pdf_url')}")
            print(f"   • Email Sent: {result.get('email_sent')}")
            print(f"   • Email ID: {result.get('email_id')}")
            print(f"   • Backend Revision: {result.get('revision')}")
            print()
            print("✅ SUCCESS! Invoice PDF generated and email sent!")
        else:
            print(f"⚠️  Request succeeded but returned success=false")
            print(f"   Error: {result.get('error')}")
            
    elif response.status_code == 404:
        print("❌ INVOICE NOT FOUND (404)")
        try:
            error_data = response.json()
            print()
            print("Error Details:")
            print(json.dumps(error_data, indent=2))
            print()
            print("Possible reasons:")
            print("  • Invoice was deleted from database")
            print("  • Invoice ID is incorrect")
            print("  • Database was reset")
        except:
            print(f"Response: {response.text}")
            
    elif response.status_code == 500:
        print("❌ SERVER ERROR (500)")
        try:
            error_data = response.json()
            print()
            print("Error Details:")
            print(json.dumps(error_data, indent=2))
            print()
            
            error_msg = error_data.get('error', '')
            if '403' in error_msg and 'resend' in error_msg.lower():
                print("🔍 Root Cause: RESEND API ERROR")
                print("   The Resend API key may still have issues")
                print()
                print("   Solutions:")
                print("   1. Check Resend API key is correct")
                print("   2. Verify domain is verified in Resend dashboard")
                print("   3. Check Cloud Run environment variables")
            else:
                print(f"🔍 Error: {error_msg}")
        except:
            print(f"Response: {response.text}")
            
    else:
        print(f"⚠️  Unexpected status code: {response.status_code}")
        print(f"Response: {response.text[:500]}")
        
except requests.exceptions.Timeout:
    print("❌ REQUEST TIMEOUT")
    print("   The request took longer than 60 seconds")
    print("   This might indicate:")
    print("   • PDF generation is stuck")
    print("   • Backend is overloaded")
    print("   • Network issues")
    
except Exception as e:
    print(f"❌ EXCEPTION: {e}")
    import traceback
    traceback.print_exc()

print()
print("="*70)
print("📋 SUMMARY")
print("="*70)
print()
print("If PDF generation succeeded:")
print("  1. Check the PDF URL in the response")
print("  2. Check your email (botkorpza@gmail.com) for the invoice")
print("  3. Verify the PDF was uploaded to Supabase Storage")
print()
print("If it failed:")
print("  1. Check the error message above")
print("  2. Review backend logs: gcloud logging read ...")
print("  3. Verify Resend API key and domain verification")
print()
print("Backend Logs Command:")
print('gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=botkorp-backend" --limit=20 --project=botkorp-za')
print()
print("="*70)


