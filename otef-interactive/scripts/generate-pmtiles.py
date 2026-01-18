#!/usr/bin/env python3
"""
Generate PMTiles from GeoJSON using Docker + tippecanoe

Cross-platform script (Windows/macOS/Linux) that:
1. Transforms source GeoJSON from EPSG:2039 to WGS84
2. Generates MBTiles with tippecanoe (via Docker)
3. Converts MBTiles to PMTiles

Usage:
  python generate-pmtiles.py

Requirements:
  - Docker (with tippecanoe image)
  - Python 3.8+ with packages: pyproj, pmtiles
"""

import json
import os
import subprocess
import sys
from pathlib import Path

# Paths
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
DATA_SOURCE = PROJECT_ROOT / "public" / "source" / "layers"
OUTPUT_DIR = PROJECT_ROOT / "frontend" / "data"
TEMP_DIR = SCRIPT_DIR / "temp"

# Docker image
TIPPECANOE_IMAGE = "ingmapping/tippecanoe"


def check_docker():
    """Check if Docker is available"""
    try:
        result = subprocess.run(["docker", "info"], capture_output=True, timeout=10)
        return result.returncode == 0
    except:
        return False


def ensure_docker_image():
    """Pull tippecanoe Docker image if not present"""
    result = subprocess.run(
        ["docker", "images", "-q", TIPPECANOE_IMAGE],
        capture_output=True, text=True
    )
    if not result.stdout.strip():
        print(f"Pulling {TIPPECANOE_IMAGE}...")
        subprocess.run(["docker", "pull", TIPPECANOE_IMAGE])


def check_dependencies():
    """Check if required Python packages are installed"""
    missing = []
    try:
        import pyproj
    except ImportError:
        missing.append("pyproj")

    try:
        import pmtiles
    except ImportError:
        missing.append("pmtiles")

    if missing:
        print(f"Missing packages: {', '.join(missing)}")
        print(f"Install with: pip install {' '.join(missing)}")
        return False
    return True


def get_file_size_mb(path):
    return path.stat().st_size / (1024 * 1024) if path.exists() else 0


def count_features(geojson_path):
    try:
        with open(geojson_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            return len(data.get('features', []))
    except:
        return 0


def to_docker_path(path):
    """Convert path to Docker-compatible format (for Windows)"""
    posix = str(path).replace('\\', '/')
    if len(posix) >= 2 and posix[1] == ':':
        # Windows: D:\path -> /d/path
        return '/' + posix[0].lower() + posix[2:]
    return posix


def transform_to_wgs84(input_path, output_path):
    """Transform GeoJSON from EPSG:2039 to WGS84"""
    from pyproj import Transformer

    print("Transforming coordinates from EPSG:2039 to WGS84...")

    transformer = Transformer.from_crs("EPSG:2039", "EPSG:4326", always_xy=True)

    with open(input_path, 'r', encoding='utf-8') as f:
        geojson = json.load(f)

    def transform_coords(coords, depth=0):
        if depth > 10:
            return coords
        if isinstance(coords[0], (int, float)):
            lon, lat = transformer.transform(coords[0], coords[1])
            return [lon, lat]
        else:
            return [transform_coords(c, depth + 1) for c in coords]

    count = 0
    for feature in geojson.get('features', []):
        if 'geometry' in feature and feature['geometry'] and 'coordinates' in feature['geometry']:
            feature['geometry']['coordinates'] = transform_coords(feature['geometry']['coordinates'])
            count += 1

    geojson['crs'] = {"type": "name", "properties": {"name": "EPSG:4326"}}

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(geojson, f)

    print(f"Transformed {count} features")
    return True


def generate_mbtiles(input_file, output_file):
    """Generate MBTiles using tippecanoe Docker"""
    print()
    print("=" * 60)
    print("Generating MBTiles with tippecanoe")
    print("=" * 60)

    if output_file.exists():
        output_file.unlink()

    abs_input = input_file.resolve()
    abs_output_dir = output_file.parent.resolve()

    # Convert paths for Docker
    if sys.platform == 'win32':
        docker_input_dir = to_docker_path(abs_input.parent)
        docker_output_dir = to_docker_path(abs_output_dir)
    else:
        docker_input_dir = str(abs_input.parent)
        docker_output_dir = str(abs_output_dir)

    docker_cmd = [
        "docker", "run", "--rm",
        "-v", f"{docker_input_dir}:/input:ro",
        "-v", f"{docker_output_dir}:/output",
        TIPPECANOE_IMAGE,
        "tippecanoe",
        "-o", f"/output/{output_file.name}",
        "--minimum-zoom=9",
        "--maximum-zoom=18",
        "--no-feature-limit",
        "--no-tile-size-limit",
        "--detect-shared-borders",
        "--simplification=5",
        "--layer=parcels",
        "--force",
        f"/input/{abs_input.name}"
    ]

    print(f"Input: {input_file.name} ({get_file_size_mb(input_file):.1f} MB)")
    print("Running tippecanoe... (1-2 minutes)")

    try:
        result = subprocess.run(docker_cmd, capture_output=True, text=True, timeout=300)

        if output_file.exists() and output_file.stat().st_size > 100000:
            print(f"SUCCESS: MBTiles generated ({get_file_size_mb(output_file):.1f} MB)")
            return True
        else:
            print("ERROR: MBTiles generation failed")
            if result.stderr:
                lines = [l for l in result.stderr.strip().split('\n') if l.strip()][-10:]
                print('\n'.join(lines))
            return False
    except subprocess.TimeoutExpired:
        print("ERROR: Timed out")
        return False
    except Exception as e:
        print(f"ERROR: {e}")
        return False


def convert_to_pmtiles(mbtiles_path, pmtiles_path):
    """Convert MBTiles to PMTiles using pmtiles Python module"""
    print()
    print("=" * 60)
    print("Converting to PMTiles")
    print("=" * 60)

    if pmtiles_path.exists():
        pmtiles_path.unlink()

    try:
        from pmtiles.convert import mbtiles_to_pmtiles

        print(f"Converting {mbtiles_path.name} to {pmtiles_path.name}...")
        mbtiles_to_pmtiles(str(mbtiles_path), str(pmtiles_path), maxzoom=18)

        if pmtiles_path.exists() and pmtiles_path.stat().st_size > 100000:
            print(f"SUCCESS: PMTiles generated ({get_file_size_mb(pmtiles_path):.1f} MB)")
            return True
        else:
            print("ERROR: PMTiles conversion failed - output file too small or missing")
            return False
    except ImportError:
        print("ERROR: pmtiles module not found")
        print("Ensure pmtiles is installed: pip install pmtiles")
        return False
    except Exception as e:
        print(f"ERROR: {e}")
        return False


def cleanup(files):
    """Remove temporary files"""
    for f in files:
        if f.exists():
            f.unlink()


def main():
    print()
    print("=" * 60)
    print("OTEF Parcels - PMTiles Generator")
    print("=" * 60)
    print()

    # Pre-checks
    if not check_docker():
        print("ERROR: Docker not available or not running")
        print("Please start Docker Desktop and try again")
        sys.exit(1)
    print("Docker: OK")

    if not check_dependencies():
        sys.exit(1)
    print("Dependencies: OK")

    ensure_docker_image()
    print()

    # File paths
    source_file = DATA_SOURCE / "migrashim.json"
    wgs84_file = TEMP_DIR / "migrashim_wgs84.json"
    mbtiles_file = OUTPUT_DIR / "parcels.mbtiles"
    pmtiles_file = OUTPUT_DIR / "parcels.pmtiles"

    if not source_file.exists():
        print(f"ERROR: Source not found: {source_file}")
        sys.exit(1)

    print(f"Source: {source_file.name} ({get_file_size_mb(source_file):.1f} MB)")
    print(f"Features: {count_features(source_file):,}")

    # Step 1: Transform to WGS84
    if not transform_to_wgs84(source_file, wgs84_file):
        sys.exit(1)
    print(f"WGS84: {wgs84_file.name} ({get_file_size_mb(wgs84_file):.1f} MB)")

    # Step 2: Generate MBTiles
    if not generate_mbtiles(wgs84_file, mbtiles_file):
        cleanup([wgs84_file])
        sys.exit(1)

    # Step 3: Convert to PMTiles
    if not convert_to_pmtiles(mbtiles_file, pmtiles_file):
        print("\nMBTiles available but PMTiles conversion failed.")
        cleanup([wgs84_file])
        sys.exit(1)

    # Cleanup temp files
    cleanup([wgs84_file, mbtiles_file])

    # Summary
    print()
    print("=" * 60)
    print("COMPLETE!")
    print("=" * 60)
    print(f"Output: {pmtiles_file}")
    print(f"Size:   {get_file_size_mb(pmtiles_file):.1f} MB")


if __name__ == '__main__':
    main()
