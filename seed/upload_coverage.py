#!/usr/bin/env python3

"""
Upload KML Coverage Data to Supabase

This script parses the coverage.kml file and uploads coverage areas to the database.

Usage:
    python upload-coverage.py
"""

import json
import re
from pathlib import Path
from typing import List, Dict
import urllib.request
import urllib.error

# Supabase configuration
SUPABASE_URL = 'https://kyoowsarfopltjwmhksi.supabase.co'
SUPABASE_ANON_KEY = 'REDACTED_JWT'
# Service role key for admin operations (has full database access)
SUPABASE_SERVICE_KEY = 'REDACTED_JWT'

# Use service key for seeding operations (requires full database access)
SUPABASE_KEY = SUPABASE_SERVICE_KEY


def parse_kml(kml_content: str) -> List[Dict]:
    """Parse KML file and extract coverage areas."""
    areas = []
    
    # Find all Placemark elements
    placemark_pattern = re.compile(r'<Placemark>(.*?)</Placemark>', re.DOTALL)
    placemarks = placemark_pattern.findall(kml_content)
    
    for placemark in placemarks:
        # Extract name
        name_match = re.search(r'<name>(.*?)</name>', placemark)
        name = name_match.group(1).strip() if name_match else 'Unnamed Area'
        
        # Extract coordinates
        coords_match = re.search(r'<coordinates>(.*?)</coordinates>', placemark, re.DOTALL)
        if not coords_match:
            continue
        
        coords_text = coords_match.group(1).strip()
        coord_pairs = [c for c in coords_text.split() if c]
        
        # Parse coordinate pairs
        coordinates = []
        for pair in coord_pairs:
            parts = pair.split(',')
            if len(parts) >= 2:
                lon = float(parts[0])
                lat = float(parts[1])
                coordinates.append([lon, lat])
        
        if len(coordinates) < 3:
            print(f"⚠️  Skipping {name}: not enough coordinates")
            continue
        
        # Convert to GeoJSON Polygon format
        geo_json = {
            'type': 'Polygon',
            'coordinates': [coordinates]
        }
        
        # Calculate center point
        lats = [c[1] for c in coordinates]
        lons = [c[0] for c in coordinates]
        center_lat = sum(lats) / len(lats)
        center_lon = sum(lons) / len(lons)
        
        # Determine city from name
        city = 'Durban'
        name_lower = name.lower()
        if 'montclair' in name_lower:
            city = 'Montclair'
        elif 'westville' in name_lower:
            city = 'Westville'
        elif 'durban north' in name_lower or 'la lucia' in name_lower:
            city = 'Durban North'
        
        area = {
            'country': 'South Africa',
            'country_code': 'ZA',
            'province': 'KwaZulu-Natal',
            'city': city,
            'area_name': name,
            'boundary_geojson': geo_json,
            'center_latitude': round(center_lat, 8),
            'center_longitude': round(center_lon, 8),
            'is_active': True,
            'service_types': ['mow_bot', 'weather_station', 'pool_bot', 'security_bot'],
            'priority': 1
        }
        
        areas.append(area)
    
    return areas


def upload_to_supabase(areas: List[Dict]) -> None:
    """Upload coverage areas to Supabase."""
    print(f"\n📤 Uploading {len(areas)} coverage areas to Supabase...\n")
    
    url = f"{SUPABASE_URL}/rest/v1/coverage_areas"
    
    for area in areas:
        try:
            # Prepare request
            data = json.dumps(area).encode('utf-8')
            
            req = urllib.request.Request(
                url,
                data=data,
                headers={
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_KEY,
                    'Authorization': f'Bearer {SUPABASE_KEY}',
                    'Prefer': 'resolution=merge-duplicates'
                },
                method='POST'
            )
            
            # Send request
            with urllib.request.urlopen(req) as response:
                if response.status in (200, 201):
                    print(f"✅ Uploaded: {area['area_name']} ({area['city']})")
                else:
                    print(f"❌ Failed to upload {area['area_name']}: HTTP {response.status}")
                    
        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8')
            print(f"❌ Failed to upload {area['area_name']}: {e.code} - {error_body}")
        except Exception as e:
            print(f"❌ Error uploading {area['area_name']}: {str(e)}")
    
    print(f"\n✨ Upload complete!\n")


def main():
    """Main execution function."""
    try:
        print('🗺️  BotKorp Coverage Area Uploader\n')
        print('=====================================\n')
        
        # Read KML file
        script_dir = Path(__file__).parent
        kml_path = script_dir / 'coverage.kml'
        
        print(f'📖 Reading KML file: {kml_path}\n')
        
        if not kml_path.exists():
            print('❌ Error: coverage.kml not found!')
            print('   Please ensure coverage.kml exists in the coverage/ directory.\n')
            return 1
        
        kml_content = kml_path.read_text(encoding='utf-8')
        
        # Parse KML
        print('🔍 Parsing KML data...\n')
        areas = parse_kml(kml_content)
        
        if not areas:
            print('❌ No coverage areas found in KML file!\n')
            return 1
        
        print(f'✅ Found {len(areas)} coverage areas:\n')
        for i, area in enumerate(areas, 1):
            print(f'   {i}. {area["area_name"]} ({area["city"]})')
            print(f'      Center: {area["center_latitude"]:.6f}, {area["center_longitude"]:.6f}')
        
        # Upload to Supabase
        upload_to_supabase(areas)
        
        print('✅ Done!\n')
        return 0
        
    except KeyboardInterrupt:
        print('\n\n⚠️  Upload cancelled by user\n')
        return 1
    except Exception as e:
        print(f'❌ Fatal error: {str(e)}')
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    exit(main())

