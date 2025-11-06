#!/usr/bin/env python3
"""
Check the actual services table schema
"""

import sys
from supabase import create_client, Client

# Supabase configuration
SUPABASE_URL = 'https://kyoowsarfopltjwmhksi.supabase.co'
SUPABASE_SERVICE_KEY = 'REDACTED_JWT'

# Initialize Supabase client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

print("=" * 70)
print("🔍 Checking Services Table Schema")
print("=" * 70)

# Get a sample service to see what columns exist
try:
    result = supabase.table('services').select('*').limit(1).execute()
    
    if result.data and len(result.data) > 0:
        print("\n✓ Sample service record found")
        print("\n📋 Available columns:")
        for key in sorted(result.data[0].keys()):
            value = result.data[0][key]
            print(f"  - {key}: {type(value).__name__} = {value}")
    else:
        print("\n⚠️  No services found in database")
        print("   Let's check the table structure by trying to insert a test record...")
        
except Exception as e:
    print(f"\n❌ Error: {e}")

print("\n" + "=" * 70)

