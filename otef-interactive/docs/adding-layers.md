# Adding New Layers to OTEF Interactive

This guide explains how to add new GIS layers to the OTEF Interactive map.

## Quick Start

1. Create a folder in `public/source/layers/` with your layer group name
2. Add GeoJSON files to the `gis/` subfolder
3. (Optional) Add `.lyrx` style files to the `styles/` subfolder
4. Run `./setup.sh` or `./reset-docker.sh` to process

## Directory Structure

```
otef-interactive/
  public/
    source/
      layers/
        example_layer_group/     # Template (copy this)
          gis/
            .gitkeep
          styles/
            .gitkeep
        my_new_layers/           # Your new layer group
          gis/
            layer1.geojson
            layer2.geojson
          styles/
            layer1.lyrx          # Optional: ArcGIS style
            layer2.lyrx
    processed/
      layers/
        my_new_layers/           # Auto-generated output
          manifest.json
          styles.json
          layer1.geojson
          layer2.pmtiles         # Auto-generated for large files
```

## Step-by-Step Guide

### 1. Create Your Layer Group Folder

Copy the example template:

```bash
cp -r otef-interactive/public/source/layers/example_layer_group \
      otef-interactive/public/source/layers/my_new_layers
```

### 2. Add GeoJSON Files

Place your GeoJSON files in the `gis/` subfolder:

```
my_new_layers/
  gis/
    buildings.geojson
    roads.geojson
    points_of_interest.geojson
```

**Requirements:**
- Files must be valid GeoJSON (FeatureCollection)
- Coordinate system: **EPSG:2039 (ITM)** - will be auto-transformed to WGS84
- Supported geometry types: Point, LineString, Polygon (and Multi* variants)

### 3. (Optional) Add Style Files

If you have ArcGIS `.lyrx` style files, place them in the `styles/` subfolder:

```
my_new_layers/
  styles/
    buildings.lyrx
    roads.lyrx
```

The processor will:
- Match `.lyrx` files to GeoJSON by filename
- Extract fill/stroke colors, line widths
- Support simple and unique-value renderers

### 4. Process the Layers

Run one of these commands from the project root:

```bash
# Full setup (first time or after major changes)
./setup.sh

# Or just reset and rebuild
./reset-docker.sh

# Or run the processor directly
cd otef-interactive/scripts
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
python process_layers.py \
  --source ../public/source/layers \
  --output ../public/processed/layers
```

### 5. Add Popup Configuration (Manual)

After processing, edit the generated `manifest.json` to add popup configurations:

```
otef-interactive/public/processed/layers/my_new_layers/manifest.json
```

Add a `ui.popup` section to each layer that needs popups:

```json
{
  "id": "buildings",
  "name": "Buildings",
  "file": "buildings.geojson",
  "format": "geojson",
  "geometryType": "polygon",
  "ui": {
    "popup": {
      "titleField": "NAME",
      "fields": [
        { "label": "Building Name", "key": "NAME" },
        { "label": "Address", "key": "ADDRESS" },
        { "label": "Year Built", "key": "YEAR" }
      ],
      "hideEmpty": true
    }
  }
}
```

**Popup Config Options:**
- `titleField`: Property key to use as popup title (optional)
- `fields`: Array of `{ label, key }` pairs to display
- `hideEmpty`: Skip fields with null/empty values (default: true)

## What the Processor Does

The `process_layers.py` script:

1. **Discovers** all layer group folders in `source/layers/`
2. **Transforms** coordinates from EPSG:2039 to WGS84
3. **Parses** `.lyrx` files for styling information
4. **Converts** large files (>10MB or >10,000 features) to PMTiles for better performance
5. **Generates** `manifest.json` and `styles.json` for each group
6. **Caches** processed files to skip unchanged layers on subsequent runs

### PMTiles Conversion

Large polygon layers are automatically converted to PMTiles format:
- Uses tippecanoe via Docker for tile generation
- Keeps original GeoJSON for coordinate transformation compatibility
- PMTiles used for rendering, GeoJSON for data queries

**Threshold for PMTiles:**
- File size > 10MB, OR
- Feature count > 10,000

## Analyzing Layer Data

Use `analyze_data.py` to inspect GeoJSON properties:

```bash
cd otef-interactive/scripts
source .venv/bin/activate
python analyze_data.py
```

This generates `outputs/layer_pack_name.json` with all property keys and sample values - useful for determining which fields to expose in popups.


## Example: Adding a Complete Layer Group

```bash
# 1. Create folder structure
mkdir -p otef-interactive/public/source/layers/tourism/{gis,styles}

# 2. Copy your GeoJSON files
cp hotels.geojson otef-interactive/public/source/layers/tourism/gis/
cp attractions.geojson otef-interactive/public/source/layers/tourism/gis/

# 3. Copy style files (if available)
cp hotels.lyrx otef-interactive/public/source/layers/tourism/styles/
cp attractions.lyrx otef-interactive/public/source/layers/tourism/styles/

# 4. Process
./reset-docker.sh

# 5. Edit manifest to add popups
# Edit: otef-interactive/public/processed/layers/tourism/manifest.json
```

## Related Files

- `scripts/process_layers.py` - Main processing script
- `scripts/analyze_data.py` - Data inspection utility
- `public/source/layers/example_layer_group/` - Empty template
- `public/processed/layers/map_3_future/manifest.json` - Example with popups
