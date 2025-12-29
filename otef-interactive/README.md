# OTEF Interactive Projection Module

Interactive mapping module for the OTEF physical model with synchronized projection mapping.

## Features

- Interactive Leaflet map with OpenStreetMap/Satellite basemap
- Real-time coordinate transformation (EPSG:2039 ↔ WGS84)
- 25,516 parcels with land-use styling (simplified from 500K+ vertices)
- Road network visualization (simplified from 37K+ vertices)
- Physical model overlay with transparent background
- Real-time WebSocket sync between interactive map and projection display
- Viewport highlighting on physical model
- Layer toggles with dynamic legends
- Maptastic.js calibration for projection adjustment

## Usage

### Control Interface (User Device)
Access at: `http://localhost/otef-interactive/`

- Pan/zoom to explore the map
- Tap features for information
- Toggle layers via menu button
- Connection status indicator shows sync state

### Projection Display (Projector)
Access at: `http://localhost/otef-interactive/projection.html`

- Full-screen projection view
- Highlights current viewport from control interface
- Press **Shift+Z** to enter calibration mode
- Press **F** for fullscreen
- Press **X** to reset calibration

## Data Processing

### Regenerate Model Images
After updating `data-source/model/Model.tif`:

```bash
cd otef-interactive/scripts
python3 create_model_versions.py
```

This creates:
- `model.png` - For projection (with white background)
- `model-transparent.png` - For interactive map (transparent background)

### Regenerate Simplified Layers
After updating source GeoJSON files in `data-source/layers/`:

```bash
cd otef-interactive/scripts
pip install -r requirements.txt
python3 simplify_geometries.py
```

This generates optimized layers in `data-source/layers-simplified/` with 80%+ vertex reduction for web performance.

### Future: Convert to Vector Tiles
When ready to convert from GeoJSON to PMTiles:

```bash
cd otef-interactive/scripts
./generate-tiles.sh  # Mac/Linux
.\generate-tiles.bat  # Windows
```

## Technical Details

- **Coordinate System**: EPSG:2039 (Israel Transverse Mercator) → WGS84 for web display
- **Model Bounds**: [101471, 557880, 194632, 621404] meters (ITM)
- **Data Format**: Simplified GeoJSON (future: PMTiles)
- **WebSocket Channel**: `ws://host/ws/otef/`
- **Model Resolution**: 1534×1046 pixels (~60.73m/pixel)
- **Performance**: 
  - Parcels: 25,516 features, simplified from 534,456 to 98,741 vertices (81.5% reduction)
  - Roads: 2,686 features, simplified from 37,426 to 4,824 vertices (87.1% reduction)

## Known Issues

1. **Projection highlight coordinates** - Viewport highlight on projection doesn't accurately reflect viewed area, especially at smaller zoom levels
2. **Model grid overlay** - Original TIF file contains a dark grid (~26K pixels) that's visible on projection
3. **Map bounds** - Interactive map not fully constrained to model bounds, allows panning beyond model area

## Troubleshooting

**Layers not loading:**
- Check that simplified GeoJSON files exist in `data-source/layers-simplified/`
- Verify nginx serves `/otef-interactive/data-source/` correctly
- Check browser console (F12) for fetch errors
- Hard refresh (Ctrl+Shift+R) to clear cached data

**Projection not highlighting:**
- Verify both devices are connected (check status indicator)
- Check WebSocket connection in browser DevTools Network tab
- Ensure Redis is running: `docker ps | grep redis`

**Calibration issues:**
- Press **X** to reset to defaults
- Press **Shift+Z** to toggle calibration mode
- Clear browser localStorage and refresh
- Calibration data is saved in browser localStorage


