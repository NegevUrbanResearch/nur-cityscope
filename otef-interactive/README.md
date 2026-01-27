# OTEF Interactive Projection Module

Interactive mapping module for the OTEF physical model with synchronized projection mapping.

## Features

- Interactive Leaflet map with OpenStreetMap/Satellite basemap
- Real-time coordinate transformation (EPSG:2039 ↔ WGS84)
- Layer groups from registry (GeoJSON + PMTiles for large layers)
- Physical model overlay with transparent background
- WebSocket sync between interactive map and projection display
- Mobile remote controller for touch-based navigation
- Maptastic.js calibration for projection adjustment

## Access Points

- **Control Interface**: http://localhost/otef-interactive/
- **Projection Display**: http://localhost/otef-interactive/projection.html
- **Remote Controller**: http://localhost/otef-interactive/remote-controller.html

## Setup

Everything initializes automatically when Docker containers start:
1. Creates database migrations
2. Imports GIS layers from `nur-io/django_api/public/processed/otef/layers/`
3. Imports model bounds from `nur-io/django_api/public/processed/otef/model-bounds.json`

No manual steps needed - just run `./reset-docker.sh` and it's ready.

### Manual Data Import

To update OTEF data manually:

```bash
docker exec nur-api python manage.py import_otef_data
```

This imports/updates layers and model bounds. Safe to run multiple times.

### Adding New Layers

1. Place simplified GeoJSON files in `nur-io/django_api/public/processed/otef/layers/`
2. Update `nur-io/django_api/backend/management/commands/import_otef_data.py` to include new layers
3. Run: `docker exec nur-api python manage.py import_otef_data`

## Data Organization

**Import data** (loaded into database) lives in the Django folder:
```
nur-io/django_api/public/processed/otef/
├── layers/              # Simplified GeoJSON for import
│   ├── migrashim_simplified.json
│   └── small_roads_simplified.json
└── model-bounds.json
```

**Source files and static assets** remain in the OTEF module:
```
otef-interactive/
├── public/source/       # Original source files (not imported)
│   ├── layers/         # Full-resolution GeoJSON
│   └── model/          # Source model files
└── frontend/data/      # Static files served to browser
    ├── model-bounds.json
    ├── model.png
    └── model-transparent.png
```

**Summary:**
- Import data: `nur-io/django_api/public/processed/otef/` (same location as climate/mobility data)
- Source files: `otef-interactive/public/source/` (original files, not imported)
- Static assets: `otef-interactive/frontend/data/` (model images served directly)

## Layer Processing

Setup and reset scripts run `process_layers.py`, which:

1. Discovers layer packs in `public/source/layers/` (see [Adding layers](docs/adding-layers.md))
2. Transforms GeoJSON to WGS84, parses `.lyrx` styles
3. Converts large layers to PMTiles (via Docker tippecanoe) for GIS performance
4. Writes `manifest.json` and `styles.json` per pack under `public/processed/layers/`

Requires Python 3.8+ (pyproj, pmtiles), Docker for PMTiles. Venv: `otef-interactive/scripts/.venv`.

## How It Works

1. Import command loads GeoJSON from `nur-io/django_api/public/processed/otef/layers/` into database
2. Frontend fetches layers from `/api/actions/get_otef_layers/?table=otef`
3. Model images stay as static files in `otef-interactive/frontend/data/` (too large for database)
4. Model bounds are loaded from `nur-io/django_api/public/processed/otef/model-bounds.json` into database

## API Endpoints

```
GET /api/actions/get_otef_layers/?table=otef
GET /api/otef_model_config/
GET /api/otef_viewport/
POST /api/otef_viewport/
```

## Usage

### Control Interface
- Pan/zoom to explore the map
- Tap features for information
- Toggle layers via menu button
- Connection status shows sync state

### Projection Display
- Full-screen projection view
- Highlights current viewport from control interface
- **Shift+Z** - Enter calibration mode
- **F** - Fullscreen
- **X** - Reset calibration

### Remote Controller
- Directional pad and virtual joystick for navigation
- Zoom slider (10-19)
- Layer toggles (layer groups, model base)
- Real-time synchronization

## Development

### Simplifying Layers

To create simplified versions for web display:

```bash
cd otef-interactive/scripts
python simplify_geometries.py
```

Move the generated files to `nur-io/django_api/public/processed/otef/layers/`, then run the import command.

### Updating Layers

1. Edit files in `nur-io/django_api/public/processed/otef/layers/`
2. Run: `docker exec nur-api python manage.py import_otef_data`
3. Frontend automatically uses updated data from database

## Troubleshooting

**Layers not loading?**
```bash
# Check database
docker exec nur-api python manage.py shell -c "from backend.models import GISLayer; print(GISLayer.objects.filter(table__name='otef').count())"

# Test API
curl http://localhost/api/actions/get_otef_layers/?table=otef
```

**WebSocket issues?**
- Check Redis is running: `docker ps | grep redis`
- Verify endpoint: `ws://localhost/ws/otef/`
- Check browser console for errors

**Model bounds not found?**
- Ensure `nur-io/django_api/public/processed/otef/model-bounds.json` exists
- Check import command output: `docker exec nur-api python manage.py import_otef_data`
- Verify file is in the Django folder, not the OTEF module folder

## Requirements

- Django REST API with OTEF data imported
- WebSocket channel: `ws://host/ws/otef/`
- Redis (for WebSocket sync)
- PostgreSQL with `GISLayer` and `OTEFModelConfig` models
