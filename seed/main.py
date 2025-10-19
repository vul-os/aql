
#!/usr/bin/env python3

"""
Seed Database with User and Coverage Data

This script seeds the database with:
1. A test user (botkorpza@gmail.com)
2. Coverage areas from coverage.kml

Usage:
    python main.py
"""

import sys
import json
from pathlib import Path
import urllib.request
import urllib.error

# Import the upload coverage functionality
from upload_coverage import parse_kml, upload_to_supabase

# Supabase configuration
SUPABASE_URL = 'https://kyoowsarfopltjwmhksi.supabase.co'
SUPABASE_SERVICE_KEY = 'sb_secret_REDACTED'

# User credentials
USER_EMAIL = "botkorpza@gmail.com"
USER_PASSWORD = "happy135"


def seed_user() -> bool:
    """Seed the test user using Supabase Admin API."""
    print("\n" + "="*60)
    print("👤 SEEDING USER")
    print("="*60 + "\n")
    
    print(f"📝 Creating user: {USER_EMAIL}")
    print(f"   Password: {USER_PASSWORD}\n")
    
    try:
        # Use Supabase Admin API to create user
        url = f"{SUPABASE_URL}/auth/v1/admin/users"
        
        user_data = {
            "email": USER_EMAIL,
            "password": USER_PASSWORD,
            "email_confirm": True,
            "user_metadata": {
                "seeded": True
            }
        }
        
        data = json.dumps(user_data).encode('utf-8')
        
        req = urllib.request.Request(
            url,
            data=data,
            headers={
                'Content-Type': 'application/json',
                'apikey': SUPABASE_SERVICE_KEY,
                'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}'
            },
            method='POST'
        )
        
        try:
            with urllib.request.urlopen(req) as response:
                result = json.loads(response.read().decode('utf-8'))
                print(f"✅ User created successfully!")
                print(f"   User ID: {result.get('id', 'N/A')}")
                print(f"   Email: {result.get('email', 'N/A')}\n")
                return True
                
        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8')
            error_data = json.loads(error_body)
            
            # Check if user already exists
            if 'already been registered' in error_body or e.code == 422:
                print(f"⚠️  User already exists, attempting to update password...")
                
                # Get user by email first
                get_url = f"{SUPABASE_URL}/auth/v1/admin/users"
                get_req = urllib.request.Request(
                    get_url,
                    headers={
                        'apikey': SUPABASE_SERVICE_KEY,
                        'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}'
                    }
                )
                
                with urllib.request.urlopen(get_req) as get_response:
                    users_data = json.loads(get_response.read().decode('utf-8'))
                    user = next((u for u in users_data.get('users', []) if u['email'] == USER_EMAIL), None)
                    
                    if user:
                        # Update user password
                        update_url = f"{SUPABASE_URL}/auth/v1/admin/users/{user['id']}"
                        update_data = json.dumps({"password": USER_PASSWORD}).encode('utf-8')
                        
                        update_req = urllib.request.Request(
                            update_url,
                            data=update_data,
                            headers={
                                'Content-Type': 'application/json',
                                'apikey': SUPABASE_SERVICE_KEY,
                                'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}'
                            },
                            method='PUT'
                        )
                        
                        with urllib.request.urlopen(update_req) as update_response:
                            print(f"✅ User password updated successfully!")
                            print(f"   User ID: {user['id']}")
                            print(f"   Email: {user['email']}\n")
                            return True
                    else:
                        print(f"❌ Could not find existing user")
                        return False
            else:
                print(f"❌ Failed to create user: {e.code}")
                print(f"   Error: {error_data.get('message', error_body)}\n")
                return False
                
    except Exception as e:
        print(f"❌ Error seeding user: {str(e)}")
        import traceback
        traceback.print_exc()
        return False


def seed_coverage() -> bool:
    """Seed coverage areas from KML file."""
    print("\n" + "="*60)
    print("🗺️  SEEDING COVERAGE AREAS")
    print("="*60 + "\n")
    
    try:
        # Read KML file
        script_dir = Path(__file__).parent
        kml_path = script_dir / 'coverage.kml'
        
        print(f'📖 Reading KML file: {kml_path}\n')
        
        if not kml_path.exists():
            print('❌ Error: coverage.kml not found!')
            print('   Please ensure coverage.kml exists in the seed/ directory.\n')
            return False
        
        kml_content = kml_path.read_text(encoding='utf-8')
        
        # Parse KML
        print('🔍 Parsing KML data...\n')
        areas = parse_kml(kml_content)
        
        if not areas:
            print('❌ No coverage areas found in KML file!\n')
            return False
        
        print(f'✅ Found {len(areas)} coverage areas:\n')
        for i, area in enumerate(areas, 1):
            print(f'   {i}. {area["area_name"]} ({area["city"]})')
            print(f'      Center: {area["center_latitude"]:.6f}, {area["center_longitude"]:.6f}')
        
        # Upload to Supabase
        upload_to_supabase(areas)
        
        print('✅ Coverage areas seeded successfully!\n')
        return True
        
    except Exception as e:
        print(f'❌ Error seeding coverage areas: {str(e)}')
        import traceback
        traceback.print_exc()
        return False


def main():
    """Main execution function."""
    try:
        print("\n" + "="*60)
        print("🌱 BOTKORP DATABASE SEEDER")
        print("="*60 + "\n")
        
        print("This script will seed the database with:")
        print(f"  1. Test user: {USER_EMAIL}")
        print(f"  2. Coverage areas from coverage.kml\n")
        
        # Seed user
        user_success = seed_user()
        
        # Seed coverage
        coverage_success = seed_coverage()
        
        # Summary
        print("\n" + "="*60)
        print("📊 SEEDING SUMMARY")
        print("="*60 + "\n")
        
        print(f"User seeding:     {'✅ Success' if user_success else '❌ Failed'}")
        print(f"Coverage seeding: {'✅ Success' if coverage_success else '❌ Failed'}")
        
        if user_success and coverage_success:
            print("\n✅ All seeding completed successfully!\n")
            print("You can now log in with:")
            print(f"  Email:    {USER_EMAIL}")
            print(f"  Password: {USER_PASSWORD}\n")
            return 0
        else:
            print("\n⚠️  Some seeding operations failed. Check the errors above.\n")
            return 1
        
    except KeyboardInterrupt:
        print('\n\n⚠️  Seeding cancelled by user\n')
        return 1
    except Exception as e:
        print(f'❌ Fatal error: {str(e)}')
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    sys.exit(main())

