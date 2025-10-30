#!/usr/bin/env python3

"""
Delete Duplicate Test Services

This script helps identify and delete duplicate test services.
"""

import sys
import json
import urllib.request
import urllib.error

# Supabase configuration
SUPABASE_URL = 'https://kyoowsarfopltjwmhksi.supabase.co'
SUPABASE_SERVICE_KEY = 'REDACTED_JWT'

DEFAULT_USER_EMAIL = "botkorpza@gmail.com"


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


def get_user_services(user_id):
    """Get all services for a user."""
    # Get user's organizations
    memberships = supabase_request('organization_members', params={
        'user_id': f'eq.{user_id}',
        'select': 'organization_id'
    })
    
    if not memberships:
        return []
    
    org_ids = [m['organization_id'] for m in memberships]
    
    # Get services for these organizations
    services = []
    for org_id in org_ids:
        org_services = supabase_request('services', params={
            'organization_id': f'eq.{org_id}',
            'select': '*'
        })
        if org_services:
            services.extend(org_services)
    
    return services


def get_service_details(service_id):
    """Get detailed information about a service."""
    # Get gardens
    gardens = supabase_request('gardens', params={
        'service_id': f'eq.{service_id}',
        'select': '*'
    })
    
    # Get mowing sessions count
    sessions = supabase_request('garden_mowing_sessions', params={
        'garden_id': f'in.({",".join([g["id"] for g in gardens])})' if gardens else 'eq.none',
        'select': 'id'
    }) if gardens else []
    
    # Get environmental data count
    env_data = supabase_request('garden_environmental_data', params={
        'garden_id': f'in.({",".join([g["id"] for g in gardens])})' if gardens else 'eq.none',
        'select': 'id'
    }) if gardens else []
    
    return {
        'gardens': gardens or [],
        'session_count': len(sessions) if sessions else 0,
        'env_data_count': len(env_data) if env_data else 0
    }


def delete_service(service_id):
    """Delete a service (cascades to gardens, sessions, etc)."""
    supabase_request(f'services?id=eq.{service_id}', method='DELETE')


def main():
    """Main execution function."""
    try:
        print("\n" + "="*60)
        print("🗑️  BOTKORP DUPLICATE SERVICE CLEANUP")
        print("="*60 + "\n")
        
        # Get user
        user = get_user_by_email(DEFAULT_USER_EMAIL)
        if not user:
            print(f"❌ User not found: {DEFAULT_USER_EMAIL}")
            return 1
        
        user_id = user['id']
        print(f"✅ Found user: {user['email']} (ID: {user_id})\n")
        
        # Get all services
        print("📋 Fetching services...")
        services = get_user_services(user_id)
        
        if not services:
            print("❌ No services found")
            return 1
        
        print(f"✅ Found {len(services)} service(s)\n")
        
        # Display all services with details
        print("="*60)
        print("SERVICE DETAILS")
        print("="*60 + "\n")
        
        service_details = []
        for idx, service in enumerate(services, 1):
            details = get_service_details(service['id'])
            service_details.append(details)
            
            print(f"{idx}. {service['name']}")
            print(f"   ID: {service['id']}")
            print(f"   Status: {service['status']}")
            print(f"   Service Type: {service['service_type']}")
            print(f"   Gardens: {len(details['gardens'])}")
            if details['gardens']:
                for garden in details['gardens']:
                    print(f"      - {garden['name']} ({garden.get('area_sqm', '?')} m²)")
            print(f"   Mowing Sessions: {details['session_count']}")
            print(f"   Environmental Data Points: {details['env_data_count']}")
            print(f"   Created: {service['created_at']}")
            print()
        
        # Find duplicates by name
        service_names = {}
        for service in services:
            name = service['name']
            if name not in service_names:
                service_names[name] = []
            service_names[name].append(service)
        
        duplicates = {name: svcs for name, svcs in service_names.items() if len(svcs) > 1}
        
        if not duplicates:
            print("✅ No duplicate services found by name")
            return 0
        
        print("="*60)
        print("⚠️  DUPLICATE SERVICES DETECTED")
        print("="*60 + "\n")
        
        for name, duplicate_services in duplicates.items():
            print(f"Service Name: {name}")
            print(f"Found {len(duplicate_services)} duplicates:\n")
            
            for idx, svc in enumerate(duplicate_services, 1):
                details = get_service_details(svc['id'])
                print(f"  {idx}. ID: {svc['id'][:8]}...")
                print(f"     Status: {svc['status']}")
                print(f"     Gardens: {len(details['gardens'])}")
                print(f"     Sessions: {details['session_count']}")
                print(f"     Data Points: {details['env_data_count']}")
                print()
        
        # Ask user which ones to delete
        print("="*60)
        print("Which service(s) would you like to DELETE?")
        print("(Enter the service number(s), separated by commas)")
        print("(Press Enter to cancel)")
        print("="*60 + "\n")
        
        choice = input("Delete service number(s): ").strip()
        
        if not choice:
            print("\n⚠️  Cancelled - no services deleted")
            return 0
        
        # Parse choices
        try:
            choices = [int(c.strip()) for c in choice.split(',')]
        except ValueError:
            print("\n❌ Invalid input")
            return 1
        
        # Validate choices
        if any(c < 1 or c > len(services) for c in choices):
            print("\n❌ Invalid service number(s)")
            return 1
        
        # Confirm deletion
        print("\n⚠️  You are about to DELETE:")
        for c in choices:
            svc = services[c - 1]
            details = service_details[c - 1]
            print(f"   - {svc['name']} (ID: {svc['id'][:8]}...)")
            print(f"     └─ This will also delete:")
            print(f"        - {len(details['gardens'])} garden(s)")
            print(f"        - {details['session_count']} mowing session(s)")
            print(f"        - {details['env_data_count']} environmental data point(s)")
        
        print("\nType 'DELETE' to confirm: ", end='')
        confirm = input().strip()
        
        if confirm != 'DELETE':
            print("\n⚠️  Cancelled - no services deleted")
            return 0
        
        # Delete services
        print("\n🗑️  Deleting services...")
        for c in choices:
            svc = services[c - 1]
            try:
                delete_service(svc['id'])
                print(f"   ✅ Deleted: {svc['name']} (ID: {svc['id'][:8]}...)")
            except Exception as e:
                print(f"   ❌ Error deleting {svc['name']}: {e}")
        
        print("\n" + "="*60)
        print("✅ CLEANUP COMPLETE!")
        print("="*60 + "\n")
        
        return 0
        
    except KeyboardInterrupt:
        print('\n\n⚠️  Cleanup cancelled by user\n')
        return 1
    except Exception as e:
        print(f'❌ Fatal error: {str(e)}')
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    sys.exit(main())


