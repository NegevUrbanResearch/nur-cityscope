#!/bin/bash
# Generate PMTiles for Mac/Linux
# Requires tippecanoe: brew install tippecanoe (Mac) or build from source (Linux)

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DATA_SOURCE="$PROJECT_ROOT/public/layers"
OUTPUT_DIR="$PROJECT_ROOT/frontend/data"

echo "Generating PMTiles..."
echo "Source: $DATA_SOURCE"
echo "Output: $OUTPUT_DIR"

# Check if tippecanoe is installed
if ! command -v tippecanoe &> /dev/null; then
    echo "ERROR: tippecanoe not found"
    echo ""
    echo "Install options:"
    echo "  Mac:   brew install tippecanoe"
    echo "  Linux: Use Docker (see below)"
    echo ""
    echo "Docker alternative:"
    echo "  docker run -v \"\$PWD:/data\" maptiler/tippecanoe tippecanoe <args>"
    exit 1
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Generate PMTiles for parcels
echo ""
echo "Processing parcels (migrashim.json)..."
tippecanoe -o "$OUTPUT_DIR/parcels.pmtiles" \
  --maximum-zoom=18 \
  --minimum-zoom=12 \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping \
  --simplification=10 \
  --detect-shared-borders \
  --coalesce-densest-as-needed \
  --layer=parcels \
  --name="OTEF Parcels" \
  --force \
  "$DATA_SOURCE/migrashim.json"

if [ $? -eq 0 ]; then
    echo "Parcels tiles generated successfully!"
    ls -lh "$OUTPUT_DIR/parcels.pmtiles"
else
    echo "ERROR: Failed to generate parcels tiles"
    exit 1
fi

# Generate PMTiles for roads
echo ""
echo "Processing roads (small_roads.json)..."
tippecanoe -o "$OUTPUT_DIR/roads.pmtiles" \
  --maximum-zoom=18 \
  --minimum-zoom=13 \
  --simplification=5 \
  --layer=roads \
  --name="OTEF Roads" \
  --force \
  "$DATA_SOURCE/small_roads.json"

if [ $? -eq 0 ]; then
    echo "Roads tiles generated successfully!"
    ls -lh "$OUTPUT_DIR/roads.pmtiles"
else
    echo "ERROR: Failed to generate roads tiles"
    exit 1
fi

echo ""
echo "All tiles generated successfully!"
echo ""
echo "Output files:"
ls -lh "$OUTPUT_DIR"/*.pmtiles 2>/dev/null || echo "No pmtiles found"


