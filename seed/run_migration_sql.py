#!/usr/bin/env python3
"""
Execute the service tracking columns migration using raw SQL
"""

import sys
import urllib.request
import urllib.error
import json

# Supabase configuration
SUPABASE_URL = 'https://kyoowsarfopltjwmhksi.supabase.co'
SUPABASE_SERVICE_KEY = 'REDACTED_JWT'

# Read the SQL file
with open('add_service_tracking_columns.sql', 'r') as f:
    migration_sql = f.read()

print("=" * 70)
print("🔧 Applying Service Tracking Columns Migration")
print("=" * 70)

# Split into individual statements
statements = [s.strip() + ';' for s in migration_sql.split(';') if s.strip() and not s.strip().startswith('--')]

print(f"\n📝 Found {len(statements)} SQL statements to execute\n")

# Execute each statement
for i, stmt in enumerate(statements, 1):
    # Skip comments
    if stmt.strip().startswith('--') or stmt.strip() == ';':
        continue
        
    print(f"[{i}/{len(statements)}] Executing: {stmt[:60]}...")
    
    try:
        # Use Supabase REST API to execute SQL
        url = f"{SUPABASE_URL}/rest/v1/rpc/query"
        headers = {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
            'Content-Type': 'application/json',
        }
        
        # This won't work as there's no query RPC function by default
        # We'll need to use a different approach
        
        print(f"    ⏭️  Skipped (SQL execution via API not available)")
        
    except Exception as e:
        print(f"    ❌ Error: {e}")

print("\n" + "=" * 70)
print("⚠️  Note: SQL execution via API is limited.")
print("   Please run the SQL in add_service_tracking_columns.sql")
print("   manually in the Supabase SQL Editor.")
print("   URL: https://supabase.com/dashboard/project/kyoowsarfopltjwmhksi/sql")
print("=" * 70)

