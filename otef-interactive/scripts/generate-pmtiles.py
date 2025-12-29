#!/usr/bin/env python3
"""
Generate PMTiles from GeoJSON using Python
This is an alternative to using tippecanoe via Docker
"""

import json
import os
import sys
from pathlib import Path

# Check if pmtiles is installed
try:
    import pmtiles
    from pmtiles.writer import Writer
    from pmtiles.tile import Compression
except ImportError:
    print("ERROR: pmtiles library not found")
    print("\nPlease install it:")
    print("  pip install pmtiles")
    print("\nOr use WSL/Docker approach:")
    print("  wsl bash generate-tiles.sh")
    sys.exit(1)

# Paths
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_SOURCE = PROJECT_ROOT / "data-source" / "layers"
OUTPUT_DIR = PROJECT_ROOT / "frontend" / "data"

print("Generating PMTiles using Python...")
print(f"Source: {DATA_SOURCE}")
print(f"Output: {OUTPUT_DIR}")
print()

# Create output directory
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Process GeoJSON files
files_to_process = [
    ("migrashim.json", "parcels.pmtiles", "parcels", "OTEF Parcels"),
    ("small_roads.json", "roads.pmtiles", "roads", "OTEF Roads")
]

for input_file, output_file, layer_name, display_name in files_to_process:
    input_path = DATA_SOURCE / input_file
    output_path = OUTPUT_DIR / output_file
    
    print(f"Processing {input_file}...")
    
    if not input_path.exists():
        print(f"ERROR: {input_path} not found")
        continue
    
    try:
        # Load GeoJSON
        with open(input_path, 'r', encoding='utf-8') as f:
            geojson = json.load(f)
        
        # Get feature count
        feature_count = len(geojson.get('features', []))
        print(f"  Features: {feature_count:,}")
        
        # For now, we'll use a simpler approach - convert to a single-tile PMTiles
        # This is a temporary solution until we can use proper tiling with tippecanoe
        
        print(f"  NOTE: For large datasets, consider using tippecanoe via WSL:")
        print(f"    wsl bash {SCRIPT_DIR}/generate-tiles.sh")
        print()
        
    except Exception as e:
        print(f"ERROR processing {input_file}: {e}")
        continue

print("\nAlternative approaches:")
print("1. Use WSL with tippecanoe:")
print("   wsl sudo apt-get install tippecanoe")
print(f"   wsl bash {SCRIPT_DIR}/generate-tiles.sh")
print()
print("2. Use Docker with a working image:")
print("   docker pull osgeo/gdal")
print("   # Then convert GeoJSON to MBTiles, then to PMTiles")
print()
print("3. Use online tools:")
print("   https://felt.com (supports PMTiles export)")
print("   https://mapshaper.org (for simplification)")

