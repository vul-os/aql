#!/usr/bin/env python3
"""
Create Test Bot for Simulator
Automatically creates the test bot in your Supabase database
"""

import sys
import os

# Add parent directory to path to import config
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from supabase import create_client
from config import SUPABASE_URL, SUPABASE_SERVICE_KEY

# Bot configuration
TEST_BOT_ID = '550e8400-e29b-41d4-a716-446655440000'
TEST_BOT_NAME = 'Test Mow Bot #1'
TEST_BOT_TYPE = 'mow_bot'
TEST_BOT_SERIAL = 'MOWBOT-TEST-001'

def create_test_bot():
    """Create or update the test bot in the database"""
    
    print("🤖 Creating Test Bot for Simulator")
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
    
    # Get a location to assign the bot to
    print("📍 Looking for a location to assign bot...")
    try:
        locations = supabase.table('locations').select('id, name').limit(1).execute()
        
        if not locations.data or len(locations.data) == 0:
            print("❌ No locations found in database!")
            print("   Please create a location first in your Supabase dashboard.")
            return False
        
        location = locations.data[0]
        location_id = location['id']
        location_name = location['name']
        print(f"✅ Found location: {location_name} ({location_id})")
    except Exception as e:
        print(f"❌ Error fetching location: {e}")
        return False
    
    print()
    
    # Check if bot already exists
    print("🔍 Checking if bot already exists...")
    try:
        existing = supabase.table('bots').select('id, name').eq('id', TEST_BOT_ID).execute()
        bot_exists = len(existing.data) > 0
        
        if bot_exists:
            print(f"⚠️  Bot already exists: {existing.data[0]['name']}")
            print("   Will update it...")
        else:
            print("✅ Bot doesn't exist yet, will create new one")
    except Exception as e:
        print(f"⚠️  Error checking bot: {e}")
        bot_exists = False
    
    print()
    
    # Create or update bot
    print(f"{'📝 Updating' if bot_exists else '🆕 Creating'} bot...")
    
    bot_data = {
        'id': TEST_BOT_ID,
        'location_id': location_id,
        'name': TEST_BOT_NAME,
        'bot_type': TEST_BOT_TYPE,
        'serial_number': TEST_BOT_SERIAL,
        'status': 'online',
        'battery_level': 95,
        'is_enabled': True
    }
    
    try:
        if bot_exists:
            # Update existing bot
            result = supabase.table('bots').update({
                'location_id': location_id,
                'status': 'online',
                'battery_level': 95,
                'is_enabled': True
            }).eq('id', TEST_BOT_ID).execute()
        else:
            # Insert new bot
            result = supabase.table('bots').insert(bot_data).execute()
        
        print("✅ Bot created/updated successfully!")
    except Exception as e:
        print(f"❌ Error creating/updating bot: {e}")
        return False
    
    print()
    
    # Verify bot was created
    print("🔍 Verifying bot...")
    try:
        bot = supabase.table('bots').select('*').eq('id', TEST_BOT_ID).single().execute()
        
        print("✅ Bot verified in database:")
        print(f"   ID: {bot.data['id']}")
        print(f"   Name: {bot.data['name']}")
        print(f"   Type: {bot.data['bot_type']}")
        print(f"   Serial: {bot.data['serial_number']}")
        print(f"   Location ID: {bot.data['location_id']}")
        print(f"   Status: {bot.data['status']}")
        print(f"   Battery: {bot.data['battery_level']}%")
    except Exception as e:
        print(f"⚠️  Error verifying bot: {e}")
        return False
    
    print()
    print("=" * 60)
    print("🎉 Success! Test bot is ready for simulation")
    print()
    print("Next steps:")
    print("  1. Make sure backend is running: cd backend && python main.py")
    print("  2. Run the simulator: cd backend/simulator && python bot_simulator.py")
    print("  3. View dashboard: http://localhost:5173/admin/bot/" + TEST_BOT_ID)
    print()
    
    return True


if __name__ == '__main__':
    success = create_test_bot()
    sys.exit(0 if success else 1)

