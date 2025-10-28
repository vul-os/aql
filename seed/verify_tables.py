#!/usr/bin/env python3

"""
Verify Service Data Tables Exist

Quick script to check if the service data tables have been created.
"""

import urllib.request
import json

SUPABASE_URL = 'https://kyoowsarfopltjwmhksi.supabase.co'
SUPABASE_SERVICE_KEY = 'REDACTED_JWT'

TABLES_TO_CHECK = [
    'garden_environmental_data',
    'garden_mowing_sessions',
    'garden_mowing_sensor_data',
    'pool_environmental_data',
    'pool_cleaning_sessions',
    'pool_cleaning_sensor_data',
    'service_events'
]

def check_table(table_name):
    """Check if a table exists by trying to query it."""
    url = f'{SUPABASE_URL}/rest/v1/{table_name}?limit=1'
    req = urllib.request.Request(url, headers={
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}'
    })
    
    try:
        with urllib.request.urlopen(req) as response:
            return True
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return False
        raise

def main():
    print("\n" + "="*60)
    print("🔍 VERIFYING SERVICE DATA TABLES")
    print("="*60 + "\n")
    
    print("Checking for required tables...\n")
    
    all_exist = True
    
    for table in TABLES_TO_CHECK:
        exists = check_table(table)
        status = "✅" if exists else "❌"
        print(f"  {status} {table}")
        if not exists:
            all_exist = False
    
    print()
    print("="*60)
    
    if all_exist:
        print("✅ ALL TABLES EXIST!")
        print("="*60)
        print()
        print("You can now run the data seeder:")
        print("  python3 seed_service_data.py")
        print()
        return 0
    else:
        print("❌ SOME TABLES ARE MISSING")
        print("="*60)
        print()
        print("Please apply the migrations first:")
        print()
        print("Option 1: Using Supabase CLI (recommended):")
        print("  cd supabase")
        print("  supabase db reset")
        print()
        print("Option 2: Using Supabase SQL Editor:")
        print("  1. Open: https://supabase.com/dashboard/project/kyoowsarfopltjwmhksi/editor/sql")
        print("  2. Run: supabase/migrations/20251024120001_create_service_data_tables.sql")
        print()
        print("Then run this script again to verify.")
        print()
        return 1

if __name__ == '__main__':
    import sys
    sys.exit(main())

