#!/usr/bin/env python3
"""
Apply migration directly using psycopg2
"""

import sys

try:
    import psycopg2
except ImportError:
    print("❌ psycopg2 not installed. Installing...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "psycopg2-binary"])
    import psycopg2

# Database connection string
DB_URL = "postgresql://postgres:okX66yfcw8A9VB2Y@db.kyoowsarfopltjwmhksi.supabase.co:5432/postgres"

# Read the SQL file
with open('add_service_tracking_columns.sql', 'r') as f:
    migration_sql = f.read()

print("=" * 70)
print("🔧 Applying Service Tracking Columns Migration")
print("=" * 70)

try:
    # Connect to the database
    print("\n📡 Connecting to database...")
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    cursor = conn.cursor()
    
    print("✅ Connected successfully!\n")
    
    # Execute the migration
    print("🔄 Executing migration SQL...")
    cursor.execute(migration_sql)
    
    print("✅ Migration applied successfully!")
    
    # Close connection
    cursor.close()
    conn.close()
    
    print("\n" + "=" * 70)
    print("✨ Done! You can now run populate_service_activity.py")
    print("=" * 70)
    
except Exception as e:
    print(f"\n❌ Error: {e}")
    print("\n" + "=" * 70)
    print("⚠️  Could not apply migration automatically.")
    print("   Please run the SQL in add_service_tracking_columns.sql")
    print("   manually in the Supabase SQL Editor.")
    print("   URL: https://supabase.com/dashboard/project/kyoowsarfopltjwmhksi/sql")
    print("=" * 70)
    sys.exit(1)

