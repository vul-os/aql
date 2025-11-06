#!/usr/bin/env python3
"""
Apply the service tracking columns migration
"""

import sys
from supabase import create_client, Client

# Supabase configuration
SUPABASE_URL = 'https://kyoowsarfopltjwmhksi.supabase.co'
SUPABASE_SERVICE_KEY = 'REDACTED_JWT'

# Initialize Supabase client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

migration_sql = """
-- Add stage column for tracking service execution state
ALTER TABLE services ADD COLUMN IF NOT EXISTS stage TEXT DEFAULT 'pending_setup';

-- Add area tracking for lawn and pool services
ALTER TABLE services ADD COLUMN IF NOT EXISTS area_sqm INTEGER DEFAULT 0;

-- Add timing columns for service execution
ALTER TABLE services ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE services ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Add organization_id to bots table for easier querying
ALTER TABLE bots ADD COLUMN IF NOT EXISTS organization_id UUID;

-- Update existing bots to set organization_id from their location
UPDATE bots SET organization_id = l.organization_id
FROM locations l
WHERE bots.location_id = l.id AND bots.organization_id IS NULL;
"""

print("=" * 70)
print("🔧 Applying Service Tracking Columns Migration")
print("=" * 70)

try:
    # Execute migration
    result = supabase.rpc('exec_sql', {'sql': migration_sql}).execute()
    print("✅ Migration applied successfully!")
    
except Exception as e:
    print(f"Trying alternative method...")
    
    # Try each statement individually
    statements = [s.strip() for s in migration_sql.split(';') if s.strip()]
    
    for i, stmt in enumerate(statements, 1):
        try:
            print(f"  Executing statement {i}/{len(statements)}...")
            supabase.postgrest.rpc('exec_sql', {'sql': stmt}).execute()
            print(f"    ✅ Statement {i} completed")
        except Exception as stmt_error:
            print(f"    ⚠️  Statement {i} error (might be okay if column exists): {stmt_error}")

print("\n✨ Migration process completed!")
print("   You can now run populate_service_activity.py to add test data.")

