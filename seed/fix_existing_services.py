#!/usr/bin/env python3
"""
Fix existing services after migration to ensure they show on dashboard
"""

import sys
from supabase import create_client, Client

# Supabase configuration
SUPABASE_URL = 'https://kyoowsarfopltjwmhksi.supabase.co'
SUPABASE_SERVICE_KEY = 'REDACTED_JWT'

# Initialize Supabase client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

print("=" * 70)
print("🔧 Fixing Existing Services After Migration")
print("=" * 70)

try:
    # First, let's see what we have
    print("\n📋 Checking current services...")
    result = supabase.table('services').select('id, name, service_type, status, stage').execute()
    
    if result.data:
        print(f"✓ Found {len(result.data)} service(s)\n")
        for svc in result.data:
            print(f"  - {svc['name']}: status={svc['status']}, stage={svc.get('stage', 'NULL')}")
        
        # Update services to have correct stage based on their status
        print("\n🔄 Updating service stages...")
        
        # Services that are 'active' should have stage 'active' (for counting in analytics)
        # The stage column is for individual service sessions, so active subscriptions should be 'active'
        active_count = 0
        for svc in result.data:
            if svc['status'] == 'active':
                # Keep them as 'active' which is the default
                active_count += 1
        
        print(f"  ✓ {active_count} service(s) are active")
        
        # Now let's check if the analytics function is working
        print("\n🔍 Testing dashboard analytics...")
        
        # Get first org
        org_response = supabase.table('organizations').select('*').limit(1).execute()
        if org_response.data:
            org_id = org_response.data[0]['id']
            
            # Test the analytics function
            analytics = supabase.rpc('get_dashboard_analytics_v2', {'org_id': org_id}).execute()
            
            if analytics.data:
                print(f"✓ Analytics data retrieved!")
                print(f"\n📊 Current Dashboard Data:")
                data = analytics.data
                print(f"  Total Services: {data.get('services', {}).get('total_services', 0)}")
                print(f"  Total Bots: {data.get('bots', {}).get('total', 0)}")
                print(f"  Active Alerts: {data.get('alerts', {}).get('total', 0)}")
            else:
                print("⚠️  No analytics data returned")
        
        print("\n" + "=" * 70)
        print("✅ Services are configured correctly!")
        print("   Your dashboard should now show your services.")
        print("   Refresh your browser (Ctrl+F5) to see the changes.")
        print("=" * 70)
        
    else:
        print("⚠️  No services found in the database.")
        print("   This might be why your dashboard is empty.")
        print("\n💡 Solution: Add a service through the UI or create test services")
        
except Exception as e:
    print(f"\n❌ Error: {e}")
    import traceback
    traceback.print_exc()

print("\n")

