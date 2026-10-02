# OTEF Interactive Projection Module

Interactive mapping module for the OTEF physical model with synchronized projection mapping.

## Features

- Interactive MapLibre map with OpenStreetMap/Satellite basemap
- Real-time coordinate transformation (EPSG:2039 ↔ WGS84)
- Layer groups from registry (GeoJSON + PMTiles for large layers)
- Physical model overlay with transparent background
- WebSocket sync between interactive map and projection display
- Mobile remote controller for touch-based navigation
- Browser projection calibration and warp in `projection-config.html`
- Flow animation metadata for selected line layers (default OFF on fresh load)
- Remote layer-sheet animation toggles (layer + pack, animatable layers only)
- NLI investigation timeline shared by GIS and projection
- NLI people points on GIS and projection; remote People search with a GIS name bubble and remote-driven NLI archive window
- NLI staff remote (`nli-staff-remote.html`) for the guided exhibit sequence

## Access Points

- **Launcher**: http://localhost/ (redirects to http://localhost/otef-interactive/launcher.html)
- **Control Interface (GIS)**: http://localhost/otef-interactive/
- **Projection Display**: http://localhost/otef-interactive/projection.html (`?span=left` / `?span=right` for each projector)
- **Projection configuration**: http://localhost/otef-interactive/projection-config.html
- **Remote Controller**: http://localhost/otef-interactive/remote-controller.html
- **NLI staff remote**: http://localhost/otef-interactive/nli-staff-remote.html (installable web app via `nli-staff.webmanifest`)
- **Printable QR**: http://localhost/otef-interactive/qr.html (guest and staff remote QR codes)

## Phone remotes and QR

GIS and workstation Open links stay on `http://localhost`. Phone remotes and the QR use **Local** (`http://{hostname}.local`) or **Tailnet** (`http://{tailscale-ipv4}`).

Those origins are written once, on the host, by:

```powershell
.\otef-interactive\scripts\start-otef.ps1
```

```bash
./otef-interactive/scripts/start-otef.sh
```

`setup.ps1` / `setup.sh` do this at the end of first-time setup. Container startup and `docker compose up` do not. If Tailscale is not installed, the Tailnet control is hidden and Local still works. The launcher status tells you to run `start-otef` when `share.json` is missing.

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
    └── model-bounds.json
```

**Summary:**
- Import data: `nur-io/django_api/public/processed/otef/` (same location as climate/mobility data)
- Source files: `otef-interactive/public/source/` (original files, not imported)
- Static assets: `otef-interactive/frontend/data/` (`model-bounds.json` for table georeferencing)

## Layer Processing

The setup scripts check the newest versioned GitHub `layers-v*` release and
install both `source.zip` and `processed.zip`. If the processed manifest is
present, setup skips local processing. The layer updater runs independently of
setup and refreshes Django layer groups when the API container is running:

```bash
python otef-interactive/scripts/update_layers.py
```

The updater checks for a newer release each time. A new version replaces both
local layer trees; save local data edits separately before running it. If Django
is stopped, rerun the updater after starting it to refresh layer groups.

Processing remains an explicit operation. To process after an update, run
`python otef-interactive/scripts/update_layers.py --process`. To process local
source files without downloading first, run
`python otef-interactive/scripts/process_layers.py`. Processing requires the
dependencies in `scripts/requirements.txt` and Docker for PMTiles.

To build verified archives for a new release:

```bash
python otef-interactive/scripts/pack_layer_release.py --output-dir otef-interactive/public/release-build/layers-v1.1.0
```

The archives contain `source/` and `processed/` roots and are named
`source.zip` and `processed.zip` for the downloader.

When no processed manifest is available, or when explicitly invoked,
`process_layers.py`:

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
GET /api/otef/projection-config/
POST /api/otef/projection-config/
```

## Usage

### NLI investigation and people records

The [NLI remote run of show](docs/nli-remote-run-of-show.md) is the translated
NLI-authored source for the intended exhibit sequence. It preserves incomplete
steps and notes which narrative scene elements are already implemented.

- With the timeline off, during playback, or after **Stop**, every visible
  investigation route remains in the red route family. Future and revealing
  routes show a solid red route; the active reveal follows its reviewed travel
  direction.
- After a route completes, it keeps a solid `#c31f4f` red carrier and adds a
  black, line-based dashed overlay that flows across the full route in the
  reviewed direction. The motion continues through **Pause** and **End**. When
  the timeline is off or **idle** (full-timeline cue, Home, archive, scene
  change, slideshow), the complete story shows and all visible routes use this
  final-state flow. GIS **Stop** is different: it rewinds the armed scene window
  to its play start and stays paused; it does not jump to the complete story.
  Nova **Stop** returns to its 08:03 preview. Reduced-motion mode uses a static
  directional dashed overlay.
- Investigation polygons activate only at their authored timeline beat. If a
  route shares that beat, the polygon waits until the route reveal completes;
  a polygon-only beat activates immediately.
- Settlement outlines activate when either an associated investigation polygon
  turns red or a revealing route reaches or crosses the settlement boundary.
- Alarms remain yellow; cumulative volume changes radius, and new onsets flash
  with one ripple.
- People points show on both GIS and projection with the same status colors.
  In remote **Navigation**, use **Settlements / People** to search and select a
  person (the staff remote search steps do the same). Both surfaces dim the
  other people points. The GIS flies to the person and shows a name/location
  bubble; the remote provides **Open NLI record** and **Back to map**.
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

  Running the script without `-Mode Install` only reports policy status. The
  same Install adds `--disable-features=CrossOriginOpenerPolicy` to Google
  Chrome shortcuts. Quit Chrome fully and start GIS from an updated shortcut
  so archive close can work. This is technician setup, not a presenter action.
  Popup denial or a closed context
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

### Segev narrative

- The NLI staff remote owns the narrative controls; the regular remote Layers
  tab no longer starts narratives. Starting Segev applies the trusted
  `משפחת שגב` house focus at zoom `18` using the grayscale
  `satellite_bw` basemap; GIS and projection render the same Hebrew focus
  label, while the projection camera continues to follow the ordinary viewport
  channel.
- Staff presentation controls and exhibit setup are documented in the
  [staff remote guide](docs/nli-staff-remote-steps.md) and
  [NLI exhibit verification guide](docs/nli-exhibit-verification.md).
- Ending the narrative returns GIS to the configured OTEF-bounds center at
  zoom `10` on the dark basemap. Refresh and reconnect restore the durable
  narrative scene.
- Complete the unchecked **NLI Segev narrative matrix** in
  [the exhibit verification guide](docs/nli-exhibit-verification.md) on kiosk
  Chrome and the physical projection before claiming exhibit acceptance.

### Other narratives

Each narrative is started from the staff remote. Step-by-step details are in
the [staff remote guide](docs/nli-staff-remote-steps.md).

- **Nova and Mor Levy (`nova`)**: fits the reviewed Nova extent and shows 08:03
  before playback. The compounds step plays five authored four-second beats;
  later steps show escape routes, Mor Levy's route and slides, and the memorial
  slides.
- **Sderot (`sderot`)**: one step focused on the Sderot police station, with
  manual slides.
- **Shura Camp**: no narrative scene; its slides open automatically over the
  complete idle timeline overview.
- **Hostages (`hostages`, then `hostages_all`)**: Nir Oz and the Peri home,
  manual slides, Nir Oz people, then all hostages.
- These narratives have pending rows in the exhibit verification guide; none
  is accepted on exhibit hardware yet.

### Control Interface
- Pan/zoom to explore the map
- Tap features for information
- Toggle layers via menu button
- Connection status shows sync state

### Projection Display
- Full-screen projection view; each projector opens `projection.html?span=left`
  or `?span=right`
- Highlights current viewport from control interface
- Calibration (scale, crop, transform, keystone, and grid warp) is edited in
  `projection-config.html`, not on the projection page. See the
  [browser projector operation guide](docs/browser-projector-warp-operations.md)
  and [projection configuration acceptance](docs/projection-config-acceptance.md).
  Physical fit on the model is still a pending exhibit gate.
- Projection page lab keys: **H**/**A** help, **F** fullscreen, **B** bounds,
  **R** rotation, **D** render debug, **L** label debug

Clock and legend placement are edited in the GIS Clock and Projection Clock /
Legend nodes of `projection-config.html`. Their scene previews are local and do
not change the exhibit; use the separate **Show on exhibit** action to apply a GIS scene. The projection
clock uses the shared left slot and appears only on `?span=left`. Django
acknowledgements and layout revisions are authoritative; runtime views do not
write placement settings.

The legacy full/right clock layout records remain preserved. The active
projection clock reads only the saved left slot; the projection legend keeps
its existing full/left placement and right-hidden runtime behavior.

### Remote Controller
- Three tabs: **Navigation** (`navigation`), **Layers** (`layers`), and
  **Presentation** (`data-remote-tab="slideshow"`, labelled Slideshow in
  English). A fourth **Library** button opens the NLI staff remote. The
  curation/workshop panel stays in the DOM but is not shown and is out of scope.
- Directional pad and nipplejs virtual joystick for navigation
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
  - `frontend/src/entries/launcher-main.js` (`launcher.html`)
  - `frontend/src/entries/map-main.js` (`index.html`, GIS)
  - `frontend/src/entries/projection-main.js` (`projection.html`)
  - `frontend/src/entries/projection-config-main.js` (`projection-config.html`)
  - `frontend/src/entries/display-identify-main.js` (`display-identify.html`)
  - `frontend/src/entries/remote-main.js` (`remote-controller.html`)
  - `frontend/src/entries/nli-staff-remote-main.js` (`nli-staff-remote.html`)
  - `frontend/src/entries/qr-main.js` (`qr.html`)
  - `frontend/src/entries/curation-main.js` (`curation.html`)
- Runtime/shared logic lives under `frontend/src/shared/`, `frontend/src/map/`, and `frontend/src/projection/`.

Commands:

```bash
npm run dev:frontend
npm run build:frontend
npm test
```

### Processing Layers

There is no separate simplification script. Layer packs are processed with
`scripts/process_layers.py`; see [Adding layers](docs/adding-layers.md).

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
