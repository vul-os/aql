#!/usr/bin/env python3
"""
Populate Service Activity Data for Dashboard Chart
Creates completed services over the past 30 days with realistic data
"""

import sys
from datetime import datetime, timedelta
import random
from supabase import create_client, Client

# Supabase configuration
SUPABASE_URL = 'https://kyoowsarfopltjwmhksi.supabase.co'
SUPABASE_SERVICE_KEY = 'REDACTED_JWT'

# Initialize Supabase client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

def get_organization_data():
    """Get the first organization and its associated data"""
    try:
        # Get first organization
        org_response = supabase.table('organizations').select('*').limit(1).execute()
        if not org_response.data:
            print("❌ No organizations found. Please create an organization first.")
            sys.exit(1)
        
        org = org_response.data[0]
        print(f"✓ Found organization: {org['name']} ({org['id']})")
        
        # Get location
        location_response = supabase.table('locations').select('*').eq(
            'organization_id', org['id']
        ).eq('is_active', True).limit(1).execute()
        
        if not location_response.data:
            print("❌ No active locations found. Please create a location first.")
            sys.exit(1)
        
        location = location_response.data[0]
        print(f"✓ Found location: {location['name']} ({location['id']})")
        
        # Get bots
        bots_response = supabase.table('bots').select('*').eq(
            'location_id', location['id']
        ).execute()
        
        if not bots_response.data:
            print("⚠️  Warning: No bots found. Services will be created without bot assignments.")
            bots = []
        else:
            bots = bots_response.data
            print(f"✓ Found {len(bots)} bot(s)")
        
        return org, location, bots
    
    except Exception as e:
        print(f"❌ Error fetching organization data: {e}")
        sys.exit(1)

def create_service_activities(org_id, location_id, bots, days_back=30):
    """
    Create completed service records over the past N days
    """
    print(f"\n📊 Creating service activity data for the past {days_back} days...")
    
    services_created = 0
    errors = 0
    
    # Service types and their typical area ranges (in sqm)
    service_configs = [
        {
            'type': 'lawn',
            'name': 'Lawn Mowing Service',
            'area_min': 150,
            'area_max': 500,
            'frequency_per_week': 3  # How many times per week this service typically runs
        },
        {
            'type': 'pool',
            'name': 'Pool Cleaning Service',
            'area_min': 30,
            'area_max': 80,
            'frequency_per_week': 2
        }
    ]
    
    # Generate services for each day
    for day_offset in range(days_back):
        date = datetime.now() - timedelta(days=days_back - day_offset - 1)
        
        # Skip some days randomly to create realistic gaps
        if random.random() < 0.15:  # 15% chance to skip a day
            continue
        
        # Create services for this day
        for config in service_configs:
            # Determine how many services of this type to create today
            # Based on frequency, with some randomness
            services_today = 0
            
            # Calculate probability of service happening today
            prob_per_day = config['frequency_per_week'] / 7.0
            
            if random.random() < prob_per_day:
                services_today = random.randint(1, 2)  # 1-2 services
            
            for _ in range(services_today):
                try:
                    # Random area within range
                    area = random.randint(config['area_min'], config['area_max'])
                    
                    # Random time on that day
                    hour = random.randint(6, 18)  # Services run between 6 AM and 6 PM
                    minute = random.randint(0, 59)
                    
                    start_time = date.replace(hour=hour, minute=minute, second=0, microsecond=0)
                    
                    # Duration: 30 minutes to 2 hours
                    duration_minutes = random.randint(30, 120)
                    completed_time = start_time + timedelta(minutes=duration_minutes)
                    
                    # Select random bot if available
                    assigned_bot_id = random.choice(bots)['id'] if bots else None
                    
                    # Create service record
                    service_data = {
                        'organization_id': org_id,
                        'location_id': location_id,
                        'service_type': config['type'],
                        'stage': 'completed',
                        'area_sqm': area,
                        'started_at': start_time.isoformat(),
                        'completed_at': completed_time.isoformat(),
                        'created_at': (start_time - timedelta(hours=1)).isoformat(),  # Created 1 hour before start
                    }
                    
                    if assigned_bot_id:
                        service_data['assigned_bot_id'] = assigned_bot_id
                    
                    # Insert service
                    result = supabase.table('services').insert(service_data).execute()
                    
                    if result.data:
                        services_created += 1
                        print(f"  ✓ {date.strftime('%Y-%m-%d')}: {config['name']} - {area} m² completed at {completed_time.strftime('%H:%M')}")
                    
                except Exception as e:
                    errors += 1
                    print(f"  ❌ Error creating service: {e}")
    
    return services_created, errors

def test_query_data(org_id, days_back=30):
    """
    Test the dashboard query to see the data
    """
    print(f"\n🔍 Testing service activity chart data query...")
    
    try:
        result = supabase.rpc('get_service_activity_chart_data', {
            'org_id': org_id,
            'days_back': days_back
        }).execute()
        
        if result.data:
            print(f"\n✓ Successfully retrieved {len(result.data)} days of data")
            
            # Show summary
            total_mowing = sum(day['mowing_area'] for day in result.data)
            total_pool = sum(day['pool_cleaning_area'] for day in result.data)
            total_services = sum(day['services_count'] for day in result.data)
            
            print(f"\n📈 Summary:")
            print(f"  Total Lawn Mowing Area: {total_mowing:,} m²")
            print(f"  Total Pool Cleaning Area: {total_pool:,} m²")
            print(f"  Total Services: {total_services}")
            
            # Show sample days with activity
            print(f"\n📅 Sample days with activity:")
            active_days = [day for day in result.data if day['services_count'] > 0]
            for day in active_days[:5]:  # Show first 5 active days
                print(f"  {day['date']}: Mowing={day['mowing_area']} m², Pool={day['pool_cleaning_area']} m², Services={day['services_count']}")
            
            if len(active_days) > 5:
                print(f"  ... and {len(active_days) - 5} more days with activity")
                
            return result.data
        else:
            print("⚠️  No data returned from query")
            return []
            
    except Exception as e:
        print(f"❌ Error querying data: {e}")
        return []

def main():
    print("=" * 70)
    print("🚀 Service Activity Data Population Script")
    print("=" * 70)
    
    # Get organization data
    org, location, bots = get_organization_data()
    
    # Create service activities
    days_back = 30
    services_created, errors = create_service_activities(
        org['id'], 
        location['id'], 
        bots, 
        days_back=days_back
    )
    
    print(f"\n" + "=" * 70)
    print(f"✅ Created {services_created} service records")
    if errors > 0:
        print(f"⚠️  {errors} errors occurred")
    print("=" * 70)
    
    # Test the query
    chart_data = test_query_data(org['id'], days_back=days_back)
    
    print(f"\n✨ Done! Your dashboard should now show service activity data.")
    print(f"   Refresh your dashboard to see the Service Activity Chart populated.")

if __name__ == '__main__':
    main()

