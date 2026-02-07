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

## WMTS Layers (Satellite Imagery)

You can add WMTS (tile) layers by placing one or more `.wmts.json` files in the pack's `gis/` folder. Each file defines a single WMTS layer (e.g. satellite imagery).

**File name:** `satellite_imagery.wmts.json` (or any `*.wmts.json`). The layer `id` in the JSON is used in the manifest.

**JSON shape:**

```json
{
  "id": "satellite_imagery",
  "name": "Satellite Imagery",
  "format": "wmts",
  "wmts": {
    "urlTemplate": "https://example.com/tiles/{z}/{y}/{x}",
    "zoom": 12,
    "attribution": "Source attribution text"
  },
  "mask": {
    "type": "geojson",
    "file": "boundary.geojson",
    "packId": "other_pack",
    "exclude": false
  }
}
```

- `mask` is optional. If present, the frontend clips WMTS drawing to the boundary (or excludes it when `"exclude": true`). `file` is the asset filename; `packId` is the pack that contains it (defaults to the current pack).
- WMTS layers are discovered automatically; no injection or separate config file is needed.

## Mask Assets (Boundary Files)

Any GeoJSON file in `gis/` whose **filename stem ends with `_boundary`** (e.g. `gaza_boundary.geojson`) is treated as a **mask asset** only:

- It is **transformed** to WGS84 and **copied** to `processed/<pack_id>/<stem>.geojson`.
- It is **not** added as a visible layer in the manifest.
- It is referenced by WMTS `mask.file` (e.g. `"file": "gaza_boundary.geojson"`) so the frontend can load it for clipping.

Replace the file with your real boundary when ready; no code changes required.

## Label Layers (Text-Only Points)

Point layers that have **label classes** in their `.lyrx` (e.g. a CIM layer with `labelClasses` and a text expression like `$feature["cityname"]`) are processed so that `styles.json` includes a full `labels` object (field, font, size, color, halo, alignment, textDirection, etc.).

- On the **GIS map** and **projection display**, these layers render as **text labels** at each point (no circle marker), using the parsed style.
- Label layers are drawn **on top** of other vector layers on the projector (dedicated labels canvas).

If a point layer has both a symbol and `style.labels`, the frontend treats it as a label layer and draws only the text (labels-only convention).

## What the Processor Does

The `process_layers.py` script:

1. **Discovers** all layer group folders in `source/layers/`
2. **Transforms** coordinates from EPSG:2039 to WGS84 (and copies `*_boundary.geojson` assets without adding them as layers)
3. **Parses** `.lyrx` files for styling information (including full label style for label layers)
4. **Discovers** WMTS layers from `gis/*.wmts.json` and adds them to the manifest
5. **Converts** large files (>10MB or >10,000 features) to PMTiles for better performance
6. **Generates** `manifest.json` and `styles.json` for each group
7. **Caches** processed files to skip unchanged layers on subsequent runs

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

## Troubleshooting

### `net::ERR_CACHE_OPERATION_NOT_SUPPORTED` / `TypeError: Failed to fetch` on PMTiles

When loading a PMTiles layer (e.g. `land_use.שטח_לדרכים`), the browser may show:

- **Failed to load resource: net::ERR_CACHE_OPERATION_NOT_SUPPORTED**
- **TypeError: Failed to fetch** (from PMTiles `FetchSource.getBytes`)

This is usually due to **browser cache and range requests**:

1. **DevTools "Disable cache"** – With Network → "Disable cache" checked, some browsers reject cache operations used by PMTiles range requests. Try unchecking it and reloading.
2. **Serving and range support** – Ensure the dev server serves the `.pmtiles` file and supports HTTP range requests (many static servers do). The URL must be same-origin or CORS-enabled.
3. **Known limitation** – Browsers often do not cache range requests well; see [PMTiles #272](https://github.com/protomaps/PMTiles/issues/272). If the file is valid and the URL loads in a new tab, the app should still work once cache is not forced off.

### Favicon 404

A `favicon.ico:1 Failed to load resource: 404` message is harmless. Add a `favicon.ico` in the app root or ignore it.

### Console: "Registering PMTiles layer X for popups"

These logs are disabled by default. To show them during debugging, set in the console: `window.DEBUG_PMTILES_POPUPS = true` before layers load, then refresh.

## Related Files

- `scripts/process_layers.py` - Main processing script
- `scripts/analyze_data.py` - Data inspection utility
- `public/source/layers/example_layer_group/` - Empty template
- `public/processed/layers/map_3_future/manifest.json` - Example with popups
