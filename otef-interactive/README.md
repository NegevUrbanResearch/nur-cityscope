# OTEF Interactive Projection Module

Interactive mapping module for the OTEF physical model with synchronized projection mapping.

## Features

- Interactive Leaflet map with OpenStreetMap/Satellite basemap
- Real-time coordinate transformation (EPSG:2039 ↔ WGS84)
- 25,516 parcels with land-use styling (simplified from 500K+ vertices)
- Road network visualization (simplified from 37K+ vertices)
- Physical model overlay with transparent background
- Real-time WebSocket sync between interactive map and projection display
- Mobile remote controller for touch-based navigation
- Viewport highlighting on physical model
- Layer toggles with dynamic legends
- Maptastic.js calibration for projection adjustment
- **Database-driven layers** - GIS layers loaded dynamically from backend database

## Architecture

### Database Integration

The OTEF module is integrated with the backend database for dynamic layer management:

**✅ Using Database (No Fallbacks)**
- **GIS Layers** (parcels, roads): Loaded from `/api/actions/get_otef_layers/`
  - Source files: `public/import/layers/*.json` → imported to database
  - Frontend: Only uses database API (no static file fallbacks)
  - Updates: Layers can be updated in database without redeploying frontend

**📁 Still Using Static Files**
- **Model Bounds**: `frontend/data/model-bounds.json`
  - Loaded directly by frontend (required for initialization)
  - Also copied to `public/import/model-bounds.json` for database import
  - Database import uses `public/import/model-bounds.json` if available, falls back to `frontend/data/model-bounds.json`
- **Model Images**: `frontend/data/model.png`, `model-transparent.png`
  - Large binary files served directly to browser
  - Not stored in database (by design - too large)

### Folder Structure

```
otef-interactive/
├── public/
│   ├── import/              # Files imported into database
│   │   ├── layers/          # Simplified GeoJSON for DB import
│   │   │   ├── migrashim_simplified.json
│   │   │   └── small_roads_simplified.json
│   │   └── model-bounds.json
│   └── source/              # Original source files (not imported)
│       ├── layers/          # Full-resolution GeoJSON
│       │   ├── migrashim.json
│       │   └── small_roads.json
│       └── model/           # Source model files
│           ├── Model.tif
│           └── Model.tfw
│
└── frontend/
    ├── data/                # Static files served directly to frontend
    │   ├── model-bounds.json
    │   ├── model.png
    │   └── model-transparent.png
    └── [other frontend files...]
```

**Purpose of Each Folder:**
- `public/import/` - Files imported into database (simplified layers, model bounds)
- `public/source/` - Original source files (full-resolution layers, model files)
- `frontend/data/` - Static assets served directly to browser

## Requirements

- **Backend API**: Django REST API with OTEF data imported
- **WebSocket Channel**: `ws://host/ws/otef/`
- **Redis**: Required for WebSocket synchronization. Ensure Redis is running: `docker ps | grep redis`
- **Database**: PostgreSQL with `GISLayer` and `OTEFModelConfig` models

## Setup

### Automatic Initialization

When Docker containers start, the system automatically:
1. Creates database migrations
2. Runs migrations
3. Creates OTEF table
4. Imports GIS layers from `public/import/layers/`
5. Imports model bounds from `public/import/model-bounds.json` (or `frontend/data/model-bounds.json` as fallback)

No manual steps required - just run `./reset-docker.sh` and everything initializes automatically.

### Manual Data Import

To manually import or update OTEF data:

```bash
# From the Django API container
docker exec nur-api python manage.py import_otef_data
```

This command:
- Imports/updates GIS layers from `public/import/layers/`
- Imports/updates model bounds from `public/import/model-bounds.json` (or `frontend/data/model-bounds.json` as fallback)
- Is idempotent (safe to run multiple times)

### Adding New Layers

1. Place simplified GeoJSON files in `public/import/layers/`
2. Update `import_otef_data.py` to include new layers
3. Run import command or restart Docker containers
4. Layers will be available via API and frontend automatically

## API Endpoints

### Get OTEF Layers
```
GET /api/actions/get_otef_layers/?table=otef
```

Returns all active GIS layers for the OTEF table:
```json
[
  {
    "id": 1,
    "name": "parcels",
    "display_name": "Parcels (Migrashim)",
    "layer_type": "geojson",
    "geojson": { ... },
    "style_config": { ... }
  },
  ...
]
```

### OTEF Model Config
```
GET /api/otef_model_config/
```

Returns model configuration including bounds, calibration data, etc.

### OTEF Viewport State
```
GET /api/otef_viewport/
POST /api/otef_viewport/
```

Manages viewport state persistence across sessions.

## Usage

### Control Interface (User Device)
Access at: `http://localhost/otef-interactive/`

- Pan/zoom to explore the map
- Tap features for information
- Toggle layers via menu button
- Connection status indicator shows sync state
- Layers loaded dynamically from database

### Projection Display (Projector)
Access at: `http://localhost/otef-interactive/projection.html`

- Full-screen projection view
- Highlights current viewport from control interface
- Press **Shift+Z** to enter calibration mode
- Press **F** for fullscreen
- Press **X** to reset calibration
- Layers rendered from database data

### Remote Controller (Mobile Device)
Access at: `http://localhost/otef-interactive/remote-controller.html`

- Directional pad and virtual joystick for map navigation
- Zoom slider and controls (10-19)
- Layer toggles (Roads, Parcels, Model Base)
- Connection status indicator
- Real-time synchronization with main map

## Data Flow

1. **Source Files** → `public/import/layers/*.json` (simplified GeoJSON)
2. **Import** → `python manage.py import_otef_data` (loads into database)
3. **Database** → `GISLayer` model stores layer data
4. **API** → `/api/actions/get_otef_layers/` serves layers
5. **Frontend** → Fetches layers from API and renders on map

## Development

### Simplifying Layers

To create simplified versions of layers:

```bash
cd otef-interactive/scripts
python simplify_geometries.py
```

This creates simplified versions in `public/import/layers/` optimized for web display.

### Manually Updating Layers

1. Edit source files in `public/source/layers/` or simplified files in `public/import/layers/`
2. Run import command: `python manage.py import_otef_data`
3. Frontend automatically uses updated data from database

### Model Files

- **Model.tif**: Source GeoTIFF file (large, kept in `public/source/model/`)
- **Model.tfw**: World file for georeferencing (in `public/source/model/`)
- **model.png**: Rendered image for projection display (in `frontend/data/`)
- **model-transparent.png**: Transparent version for overlay (in `frontend/data/`)
- **model-bounds.json**: Model bounds configuration
  - Served to frontend from: `frontend/data/model-bounds.json`
  - Imported to database from: `public/import/model-bounds.json` (or `frontend/data/model-bounds.json` as fallback)

## Troubleshooting

### Layers Not Loading

1. Check database has layers: `docker exec nur-api python manage.py shell -c "from backend.models import GISLayer, Table; print(GISLayer.objects.filter(table__name='otef').count())"`
2. Verify API endpoint: `curl http://localhost/api/actions/get_otef_layers/?table=otef`
3. Check browser console for errors
4. Ensure import command ran successfully

### WebSocket Connection Issues

1. Verify Redis is running: `docker ps | grep redis`
2. Check WebSocket endpoint: `ws://localhost/ws/otef/`
3. Review browser console for connection errors

### Model Bounds Not Found

- Ensure `frontend/data/model-bounds.json` exists
- Check import command output for warnings
- Verify file is mounted in Docker container

## Notes

- **No Fallbacks**: Frontend only uses database - no static file fallbacks
- **Automatic Updates**: Layers update automatically when database changes
- **Idempotent Import**: Safe to run import command multiple times
- **Large Files**: Model images stay as static files (too large for database)
