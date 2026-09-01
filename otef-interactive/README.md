# OTEF Interactive Projection Module

Interactive mapping module for the OTEF physical model with synchronized projection mapping.

## Features

- Interactive MapLibre map with OpenStreetMap/Satellite basemap
- Real-time coordinate transformation (EPSG:2039 ↔ WGS84)
- Layer groups from registry (GeoJSON + PMTiles for large layers)
- Physical model overlay with transparent background
- WebSocket sync between interactive map and projection display
- Mobile remote controller for touch-based navigation
- Maptastic.js calibration for projection adjustment
- Flow animation metadata for selected line layers (default OFF on fresh load)
- Remote layer-sheet animation toggles (layer + pack, animatable layers only)
- NLI investigation timeline shared by GIS and projection
- Remote People search with GIS halo/bubble and remote-only NLI archive-window control

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
    └── model.png
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

### NLI investigation and people records

- With the timeline off, during playback, or after **Stop**, every visible
  investigation route remains in the red route family. Future and revealing
  routes show a solid red route; the active reveal follows its reviewed travel
  direction.
- After a route completes, it keeps a solid `#c31f4f` red carrier and adds a
  black, line-based dashed overlay that flows across the full route in the
  reviewed direction. The motion continues through **Pause** and **End**. When
  the timeline is off or returns to idle after **Stop**, all visible routes use
  this final-state flow. Reduced-motion mode uses a static directional dashed
  overlay.
- Investigation polygons activate only at their authored timeline beat. If a
  route shares that beat, the polygon waits until the route reveal completes;
  a polygon-only beat activates immediately.
- Settlement outlines activate when either an associated investigation polygon
  turns red or a revealing route reaches or crosses the settlement boundary.
- Alarms remain yellow; cumulative volume changes radius, and new onsets flash
  with one ripple.
- In remote **Navigation**, use **Settlements / People** to search and select a
  person. The GIS shows the selected name and location; the remote provides
  **Open NLI record** and **Back to map**.
- Projection uses a large `HH:MM` NLI story clock during timeline playback.
  This `clock-only` caption applies only to the projection NLI timeline; it
  does not change the remote **Presentation** tab, slideshow mode, or
  `presentationActive` behavior.
- The presenter uses the remote **Open NLI record** action. GIS resolves the
  validated local record URL and opens or reuses the named top-level
  `otef-nli-archive` window on demand. The remote changes to **Back to map**
  only after GIS reports the matching `navigation_attempted` result.
- Configure the exhibit browser once to allow popups from exactly
  `http://localhost:80`. From the repository root, run the following command in
  Windows PowerShell as administrator:

  ```powershell
  & '.\otef-interactive\scripts\configure-chrome-popup-policy.ps1' -Mode Install
  ```

  Running the script without `-Mode Install` only reports policy status. This
  is technician setup, not a presenter action. Popup denial or a closed context
  reports `unavailable`; the remote keeps the action usable or shows its
  localized unavailable state. **Back to map** closes the archive window and
  restores GIS focus when the browser permits it.
- The NLI site cannot be embedded. `navigation_attempted` proves only local
  handle acquisition and navigation assignment; it is not proof that the
  cross-origin NLI document loaded. See [NLI exhibit verification](docs/nli-exhibit-verification.md)
  for the required browser check and current limitations.

The person-selection transport handles an interleaved stale response: if a
WebSocket advances the canonical revision from 4 to 5 while the HTTP request
for revision 4 is in flight, the first stale conflict retries once with
revision 5. A second conflict remains visible to the presenter.

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

The committed left projection calibration is stored in
`NLI_EXPLAINER_LAYOUT.left` as
`leftPct: 48.88333333333333`, `topPct: 26.175280590197644`,
`widthPct: 13.572916666666666`, `heightPct: 11.732162458836443`,
`fontPx: 15`, and `rotateDeg: 0`.
The `full` and `right` layouts remain unchanged.

### Remote Controller
- Directional pad and virtual joystick for navigation
- Zoom slider (10-19)
- Layer toggles (layer groups, model base)
- Animation toggles for animatable layers/packs only
- Real-time synchronization

## Animation State Model

- Style capability lives in `styles.json` as `style.animation` metadata.
- Runtime state is synchronized via `OTEFViewportState.animations` (generic map by full layer id).
- Fresh load state is `animations = {}` (all flow effects OFF).
- Backend/WebSocket no longer assume a legacy `parcels` animation key.

## Development

### Frontend-B Build Workflow

- Canonical migration source lives under `frontend/src/`.
- Page entrypoints:
  - `frontend/src/entries/map-main.js`
  - `frontend/src/entries/projection-main.js`
  - `frontend/src/entries/remote-main.js`
  - `frontend/src/entries/curation-main.js`
- Runtime/shared logic lives under `frontend/src/shared/`, `frontend/src/map/`, and `frontend/src/projection/`.

Commands:

```bash
npm run dev:frontend
npm run build:frontend
npm test
```

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
