#!/usr/bin/env python3
"""
Create Multiple Bots for a Location
Creates bots for each garden in a service
"""

import sys
import os

# Add parent directory to path to import config
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from supabase import create_client
from config import SUPABASE_URL, SUPABASE_SERVICE_KEY

def create_bots_for_location(location_id, num_bots=3):
    """Create multiple bots for a location"""
    
    print("🤖 Creating Bots for Location")
    print("=" * 60)
    print()
    
    # Initialize Supabase client
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        print(f"✅ Connected to Supabase: {SUPABASE_URL}")
    except Exception as e:
        print(f"❌ Failed to connect to Supabase: {e}")
        return False
    
    print()
    
    # Verify location exists
    print(f"📍 Verifying location: {location_id}")
    try:
        location = supabase.table('locations').select('*').eq('id', location_id).single().execute()
        print(f"✅ Found location: {location.data.get('name', 'Unknown')}")
    except Exception as e:
        print(f"❌ Location not found: {e}")
        return False
    
    print()
    
    # Create bots
    bot_names = ["MowBot Front", "MowBot Back", "MowBot Side"]
    created_bots = []
    
    for i in range(num_bots):
        bot_name = bot_names[i] if i < len(bot_names) else f"MowBot {i+1}"
        serial = f"MB-{location_id[:8].upper()}-{i+1:03d}"
        
        print(f"🆕 Creating bot {i+1}/{num_bots}: {bot_name}")
        
        bot_data = {
            'location_id': location_id,
            'name': bot_name,
            'bot_type': 'mow_bot',
            'serial_number': serial,
            'status': 'offline',
            'battery_level': 95,
            'is_enabled': True
        }
        
        try:
            result = supabase.table('bots').insert(bot_data).execute()
            bot_id = result.data[0]['id']
            created_bots.append({
                'id': bot_id,
                'name': bot_name,
                'serial': serial
            })
            print(f"   ✅ Created: {bot_id}")
        except Exception as e:
            print(f"   ❌ Error: {e}")
    
    print()
    print("=" * 60)
    print(f"🎉 Successfully created {len(created_bots)} bots!")
    print()
    
    if created_bots:
        print("Created bots:")
        for bot in created_bots:
            print(f"  • {bot['name']} - ID: {bot['id']}")
        
        print()
        print("Next steps:")
        print("  1. Run service bot simulator:")
        print(f"     export GARDEN_ID=\"your-garden-id\"")
        print(f"     export SERVICE_ID=\"your-service-id\"")
        print(f"     python3 seed/service_bot_simulator.py")
        print()
        print("  OR run bot simulator:")
        print(f"     export BOT_ID=\"{created_bots[0]['id']}\"")
        print(f"     python3 seed/bot_simulator.py")
    
    return True


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 create-bots-for-location.py <location-id> [num_bots]")
        print()
        print("Example:")
        print("  python3 create-bots-for-location.py 520dc52d-0fce-49f9-a52c-04b228b2ba91 3")
        sys.exit(1)
    
    location_id = sys.argv[1]
    num_bots = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    
    success = create_bots_for_location(location_id, num_bots)
    sys.exit(0 if success else 1)

