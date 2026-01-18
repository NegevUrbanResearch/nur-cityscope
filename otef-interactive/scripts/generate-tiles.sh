#!/bin/bash
# Generate PMTiles for parcels layer using Docker
# Roads layer stays as GeoJSON for simplicity

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DATA_SOURCE="$PROJECT_ROOT/public/source/layers"
OUTPUT_DIR="$PROJECT_ROOT/frontend/data"

echo "==========================================="
echo "Generating PMTiles for OTEF Parcels Layer"
echo "==========================================="
echo "Source: $DATA_SOURCE"
echo "Output: $OUTPUT_DIR"
echo ""

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Check if source file exists
if [ ! -f "$DATA_SOURCE/migrashim.json" ]; then
    echo "ERROR: Source file not found: $DATA_SOURCE/migrashim.json"
    exit 1
fi

echo "Processing parcels (migrashim.json)..."
echo "This may take 1-2 minutes for 63MB of data..."
echo ""

# Generate PMTiles for parcels
# Key options:
#   --no-feature-limit: Allow all features at all zoom levels
#   --no-tile-size-limit: Don't drop features due to tile size
#   --minimum-zoom=10: Show parcels from zoom 10 (overview)
#   --maximum-zoom=18: Full detail at zoom 18
#   --no-tile-compression: Faster but larger tiles (ok for local use)
#   --detect-shared-borders: Better polygon rendering
#   --preserve-input-order: Keep feature ordering

tippecanoe -o "$OUTPUT_DIR/parcels.pmtiles" \
  --minimum-zoom=10 \
  --maximum-zoom=18 \
  --no-feature-limit \
  --no-tile-size-limit \
  --detect-shared-borders \
  --preserve-input-order \
  --simplification=5 \
  --layer=parcels \
  --name="OTEF Parcels" \
  --attribution="OTEF Interactive" \
  --force \
  "$DATA_SOURCE/migrashim.json"

if [ $? -eq 0 ]; then
    echo ""
    echo "SUCCESS: Parcels tiles generated!"
    ls -lh "$OUTPUT_DIR/parcels.pmtiles"
else
    echo ""
    echo "ERROR: Failed to generate parcels tiles"
    exit 1
fi

echo ""
echo "==========================================="
echo "PMTiles generation complete!"
echo "==========================================="
echo ""
echo "Output: $OUTPUT_DIR/parcels.pmtiles"
echo ""
echo "Note: Roads layer uses GeoJSON (no tiles needed)"
