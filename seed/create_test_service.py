#!/usr/bin/env python3

"""
Create Test Service Setup

This script creates a complete test service setup:
1. Organization (or uses existing)
2. Location
3. Lawn Service
4. Garden
5. Bot

For the test user: botkorpza@gmail.com
"""

import sys
import json
import urllib.request
import urllib.error

# Supabase configuration
SUPABASE_URL = 'https://kyoowsarfopltjwmhksi.supabase.co'
SUPABASE_SERVICE_KEY = 'REDACTED_JWT'

DEFAULT_USER_EMAIL = "botkorpza@gmail.com"
TEST_BOT_ID = "550e8400-e29b-41d4-a716-446655440000"


def supabase_request(endpoint, method='GET', data=None, params=None):
    """Make a request to Supabase REST API."""
    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
    
    if params:
        query = '&'.join([f"{k}={v}" for k, v in params.items()])
        url = f"{url}?{query}"
    
    headers = {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
    }
    
    req_data = json.dumps(data).encode('utf-8') if data else None
    req = urllib.request.Request(url, data=req_data, headers=headers, method=method)
    
    try:
        with urllib.request.urlopen(req) as response:
            result = response.read().decode('utf-8')
            return json.loads(result) if result else None
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        print(f"❌ HTTP Error {e.code}: {error_body}")
        raise


def get_user_by_email(email):
    """Get user by email."""
    users = supabase_request('profiles', params={'email': f'eq.{email}', 'select': 'id,email'})
    if users and len(users) > 0:
        return users[0]
    return None


def get_or_create_organization(user_id):
    """Get existing organization or create one."""
    print("\n📋 Looking for organization...")
    
    # Check if user is member of any organization
    memberships = supabase_request('organization_members', params={
        'user_id': f'eq.{user_id}',
        'select': 'organization_id,organizations(id,name,slug)'
    })
    
    if memberships and len(memberships) > 0:
        org = memberships[0]['organizations']
        print(f"✅ Using existing organization: {org['name']} (ID: {org['id']})")
        return org
    
    # Create new organization
    print("   Creating new organization...")
    org_data = {
        'name': 'Test Organization',
        'slug': 'test-org-' + user_id[:8],
        'subscription_tier': 'premium'
    }
    
    orgs = supabase_request('organizations', method='POST', data=[org_data])
    if not orgs or len(orgs) == 0:
        raise Exception("Failed to create organization")
    
    org = orgs[0]
    
    # Add user as owner
    member_data = {
        'organization_id': org['id'],
        'user_id': user_id,
        'role': 'owner'
    }
    supabase_request('organization_members', method='POST', data=[member_data])
    
    print(f"✅ Created organization: {org['name']} (ID: {org['id']})")
    return org


def create_location(org_id):
    """Create a test location."""
    print("\n📍 Creating location...")
    
    location_data = {
        'organization_id': org_id,
        'name': 'Test Property - Durban',
        'address': '123 Test Street',
        'city': 'Durban',
        'province': 'KwaZulu-Natal',
        'postal_code': '4001',
        'latitude': -29.8587,
        'longitude': 31.0218,
        'location_type': 'residential'
    }
    
    locations = supabase_request('locations', method='POST', data=[location_data])
    if not locations or len(locations) == 0:
        raise Exception("Failed to create location")
    
    location = locations[0]
    print(f"✅ Created location: {location['name']} (ID: {location['id']})")
    return location


def create_service(org_id, location_id):
    """Create a lawn service."""
    print("\n🌱 Creating lawn service...")
    
    service_data = {
        'organization_id': org_id,
        'location_id': location_id,
        'name': 'Test Lawn Service',
        'service_type': 'lawn',
        'service_frequency': 'weekly',
        'services_per_month': 4,
        'status': 'active',
        'is_active': True,
        'activation_date': '2025-10-28T00:00:00Z'
    }
    
    services = supabase_request('services', method='POST', data=[service_data])
    if not services or len(services) == 0:
        raise Exception("Failed to create service")
    
    service = services[0]
    print(f"✅ Created service: {service['name']} (ID: {service['id']})")
    return service


def create_garden(service_id, location_id):
    """Create a garden."""
    print("\n🏡 Creating garden...")
    
    garden_data = {
        'service_id': service_id,
        'location_id': location_id,
        'name': 'Main Garden',
        'area_sqm': 200,
        'grass_type': 'kikuyu',
        'terrain_type': 'flat',
        'preferred_cut_height_mm': 35,
        'mowing_frequency_days': 7
    }
    
    gardens = supabase_request('gardens', method='POST', data=[garden_data])
    if not gardens or len(gardens) == 0:
        raise Exception("Failed to create garden")
    
    garden = gardens[0]
    print(f"✅ Created garden: {garden['name']} (ID: {garden['id']}, {garden['area_sqm']} m²)")
    return garden


def create_bot(location_id):
    """Create a test bot."""
    print("\n🤖 Creating bot...")
    
    bot_data = {
        'id': TEST_BOT_ID,
        'location_id': location_id,
        'name': 'Test Mow Bot #1',
        'bot_type': 'mow_bot',
        'serial_number': 'MOWBOT-TEST-001',
        'status': 'online',
        'battery_level': 95,
        'is_enabled': True
    }
    
    # Try to insert, if exists just get it
    try:
        bots = supabase_request('bots', method='POST', data=[bot_data])
        if bots and len(bots) > 0:
            bot = bots[0]
            print(f"✅ Created bot: {bot['name']} (ID: {bot['id']})")
            return bot
    except Exception as e:
        # Bot might already exist, try to get it
        if 'duplicate' in str(e).lower() or 'unique' in str(e).lower():
            print(f"   Bot already exists, fetching...")
            bots = supabase_request('bots', params={'id': f'eq.{TEST_BOT_ID}'})
            if bots and len(bots) > 0:
                bot = bots[0]
                print(f"✅ Using existing bot: {bot['name']} (ID: {bot['id']})")
                return bot
        raise


def main():
    """Main execution function."""
    try:
        print("\n" + "="*60)
        print("🏗️  BOTKORP TEST SERVICE CREATOR")
        print("="*60 + "\n")
        
        print(f"👤 User: {DEFAULT_USER_EMAIL}")
        
        # Get user
        user = get_user_by_email(DEFAULT_USER_EMAIL)
        if not user:
            print(f"❌ User not found: {DEFAULT_USER_EMAIL}")
            print("   Please run: python3 main.py")
            return 1
        
        user_id = user['id']
        print(f"✅ Found user: {user['email']} (ID: {user_id})")
        
        # Create or get organization
        org = get_or_create_organization(user_id)
        org_id = org['id']
        
        # Create location
        location = create_location(org_id)
        location_id = location['id']
        
        # Create service
        service = create_service(org_id, location_id)
        service_id = service['id']
        
        # Create garden
        garden = create_garden(service_id, location_id)
        garden_id = garden['id']
        
        # Create bot
        bot = create_bot(location_id)
        bot_id = bot['id']
        
        print("\n" + "="*60)
        print("✅ TEST SERVICE SETUP COMPLETE!")
        print("="*60)
        print(f"\n📊 Summary:")
        print(f"   User ID:         {user_id}")
        print(f"   Organization ID: {org_id}")
        print(f"   Location ID:     {location_id}")
        print(f"   Service ID:      {service_id}")
        print(f"   Garden ID:       {garden_id}")
        print(f"   Bot ID:          {bot_id}")
        
        print(f"\n🎯 Next step:")
        print(f"   Run: python3 seed_service_data.py")
        print()
        
        return 0
        
    except KeyboardInterrupt:
        print('\n\n⚠️  Setup cancelled by user\n')
        return 1
    except Exception as e:
        print(f'❌ Fatal error: {str(e)}')
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    sys.exit(main())

