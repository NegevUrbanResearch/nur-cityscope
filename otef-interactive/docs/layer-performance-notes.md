# OTEF Layer Performance Notes

## Context

The OTEF interactive map now uses MapLibre. Static GIS packs are processed from source GIS files into WGS84 GeoJSON and, for selected layers, PMTiles. The current pipeline decides whether to generate PMTiles mostly from source file size and style complexity:

- Source file larger than about 15MB.
- Advanced style / multi-symbol style.
- Excludes label-only point layers and `projector_base`.

This misses some "simple" layers that still cost a lot at runtime because they have many coordinates, many features, or heavy properties.

The main lesson: style complexity is not the same as render/runtime complexity.

## 2026-06-23 Implementation Update

The layer pipeline and projection runtime were updated from this note's initial
recommendations. The important implementation choices are:

- PMTiles eligibility now uses measured layer stats: feature count, coordinate
  count, property payload, source size, geometry type, style complexity, and
  explicit opt-outs.
- Existing PMTiles were regenerated after the tiling change. Local verification
  found 63 PMTiles, 0 header read errors, and 0 files below the required
  `max_zoom=19`.
- Generated PMTiles are now projection-safe at the artifact level:
  - `--maximum-zoom=19`
  - `--no-feature-limit`
  - `--no-tile-size-limit`
  - no `--drop-densest-as-needed`
  - no preset simplification; presets currently use `--no-line-simplification`
  - PMTiles conversion also writes `maxzoom=19`
- The processed GeoJSON files remain required. They are the full-fidelity
  fallback/debug artifact and are still used by layers that do not advertise
  `pmtilesFile`.
- Presentation/slideshow layer transitions now retain recently used MapLibre
  sources briefly, stage incoming layers hidden, refresh projection state while
  staged, then reveal. This reduces visible blanking and repeated teardown.

### Projection PMTiles Caveat

The projection wall is not a user-zoomed GIS map. It is a fixed calibrated view
onto a physical model. Because of that, visual detail must not depend on browser
window size or MapLibre's computed `fitBounds` zoom.

The regenerated PMTiles fix the artifact-side problem: tiles now contain z19
detail and do not intentionally drop dense features. However, MapLibre still
chooses tile zoom from the current projection container size. If details in a
PMTiles layer, for example the dirt-roads layer in `muniplicity_transport`,
appear or disappear when only the projection page size changes, that is a
runtime tile selection issue, not a stale PMTiles issue.

Recommended follow-up: add a projection-only source policy for detail-critical
layers. GIS can continue to use PMTiles for fast interactive zooming, while the
projection page can selectively use processed GeoJSON for layers whose detail
must be invariant under page size.

## What We Found

Scanned files under:

```text
otef-interactive/public/processed/layers
```

These files are gitignored, so numbers reflect the local generated dataset at the time of the scan.

### Heavy Geometry Layers

These layers have enough geometry to justify PMTiles and zoom-aware simplification:

| Layer | GeoJSON size | Features | Coordinates | Notes |
| --- | ---: | ---: | ---: | --- |
| `greens/מישורי_הצפה.geojson` | 117.4MB | 428 | ~2.81M | Very heavy polygons; has PMTiles. |
| `muniplicity_transport/שבילי_אופניים.geojson` | 23.3MB | 1,036 | ~552k | Heavy line layer; has PMTiles. |
| `land_use/שטח_לדרכים.geojson` | 16.4MB | 2,279 | ~366k | Heavy polygons; has PMTiles. |
| `greens/נחלים.geojson` | 12.7MB | 870 | ~291k | Heavy line layer; did not have PMTiles in the scan. |
| `muniplicity_transport/דרכי_עפר.geojson` | 11.7MB | 1 | ~280k | One huge MultiPolygon in processed geometry, but visually represents roads/paths as a line layer; has PMTiles. |
| `land_use/מגורים.geojson` | 27.7MB | 15,754 | ~279k | Heavy feature count and about 12.9MB of properties; has PMTiles. |
| `future_development/מימושים.geojson` | 19.0MB | 12,694 | ~257k | Heavy feature count and properties; has PMTiles. |

For these, PMTiles is the right baseline. For the largest ones, PMTiles alone is probably not enough; the generated tiles should also be generalized/simplified by zoom.

### October 7th Pack

The October 7th pack is not geometrically heavy:

| Layer | GeoJSON size | Features | Coordinates | Property payload |
| --- | ---: | ---: | ---: | ---: |
| `october_7th/שטחים_פתוחים_פגועים.geojson` | 0.32MB | 69 | 6,127 | 0.05MB |
| `october_7th/מאבק_וגבורה_נקודה.geojson` | 0.15MB | 87 | 87 | 0.11MB |
| `october_7th/אירוע_נקודתי-רציחה_חטיפה.geojson` | 0.06MB | 30 | 30 | 0.04MB |
| `october_7th/פגיעה_נקודתית-נקודה.geojson` | 0.05MB | 25 | 25 | 0.03MB |

The point layers are rendered as MapLibre `circle` layers through the style bridge, not as DOM markers. That should be cheap. If the October 7th pack feels slow, likely causes are:

- Many sources/layers toggling together.
- Labels on many styles.
- Large popup text fields carried inside every render feature.
- Flow animation on route/line layers.
- Sync churn causing repeated remove/add cycles between GIS and projection.

The point data is not huge in absolute terms, but some point records carry relatively large popup fields. If needed, keep popup data without putting all of it in the render source.

## Recommended Architecture

### 1. PMTiles by Default for Static Vector Layers

For static GIS layers, prefer PMTiles unless there is a good reason not to.

Good PMTiles candidates:

- Any line/polygon layer above about 1-2MB.
- Any layer above about 25k-50k coordinates.
- Any layer with many thousands of features.
- Any layer with advanced styling.

Good opt-outs:

- Tiny point layers.
- Label-only point layers that need raw GeoJSON behavior.
- Dynamic curated/user-published layers.
- `projector_base` layers where current assumptions require GeoJSON.

Keep the processed `.geojson` as a full-fidelity source/debug artifact, but let the runtime prefer `.pmtiles` whenever the manifest has `pmtilesFile`.

### 2. Zoom-Aware Simplification in the PMTiles Step

Simplification should be part of the tiling process:

```text
GeoJSON -> Tippecanoe MBTiles -> PMTiles
```

Tippecanoe is where zoom-aware simplification/generalization happens. PMTiles is the final container.

Do not destructively simplify the source GeoJSON. Keep source/processed GeoJSON as the accurate reference, and generate lighter tile representations for rendering.

The important rule is: simplify per zoom level, not once globally.

- Low zoom: simplified geometry, because tiny bends are visually smaller than a pixel.
- Mid zoom: more detail.
- High zoom: near-original or original detail.

This keeps overview rendering light without making inspected/detail views inaccurate.

### 3. Layer-Specific Tiling Presets

Avoid one global `high_fidelity=True` mode. Some current PMTiles are generated with `--no-line-simplification`, which may make them heavier than necessary.

Suggested preset categories:

| Preset | Use for | Behavior |
| --- | --- | --- |
| `critical_boundaries` | administrative/model boundaries, sensitive extents | Minimal simplification; preserve shape strongly. |
| `roads_paths_rivers` | `נחלים`, `דרכי עפר`, bike paths, trails | Moderate zoom-aware line simplification; high zoom preserves detail. |
| `large_polygons` | flood plains, land use, residential areas | Conservative polygon simplification with shared-border handling. |
| `dense_feature_polygons` | land-use layers with many features | Simplification plus property pruning. |
| `points_thin` | static point layers | Usually GeoJSON, or PMTiles only if point count grows significantly. |

### 3a. Per-Pack Simplification Strategy

Use this as the starting policy for implementation. The exact Tippecanoe numbers should be tuned by visual QA, but the intent should stay stable: keep source GeoJSON exact, keep high zoom faithful, simplify only what is visually unobservable at the current zoom, and never discard popup fields without preserving them elsewhere.

| Pack / layer | Recommended preset | PMTiles default? | Simplification stance | Popup/data stance |
| --- | --- | --- | --- | --- |
| `greens/מישורי_הצפה` | `large_polygons` / `critical_boundaries` hybrid | Yes | Very conservative. This layer expresses flood extent, so do not aggressively smooth edges. Use low-zoom generalization only; high zoom should be close to source. Validate polygon topology. | Preserve popup fields if present. Keep them inline if small; otherwise move full details to sidecar. |
| `greens/נחלים` | `roads_paths_rivers` | Yes | Moderate zoom-aware line simplification. Rivers should remain natural and connected; avoid angular low-zoom artifacts and do not remove short meaningful tributaries unless they are intentionally hidden by min zoom. | Preserve popup fields if present. Use sidecar only if popup text grows. |
| `greens/חקלאות`, `גן_לאומי`, `יערות_קקל`, `שמורות_טבע`, `מסדרונות_אקולוגיים` | `large_polygons` | Yes | Conservative polygon simplification. Low zoom can lose small boundary wiggles; high zoom should preserve parcel/area shapes. Use shared-border handling where adjacent polygons meet. | Render tiles may keep fewer attributes, but popup details must remain inline or sidecar. |
| `greens` tiny layers, e.g. `צוואר_בקבוק`, small forest layers | `large_polygons` or `points_thin` depending on geometry | Optional | If tiny, simplification is not urgent. Use PMTiles if generated by default, but do not spend tuning effort here first. | Keep normal popup behavior. |
| `muniplicity_transport/שבילי_אופניים` | `roads_paths_rivers` | Yes | Moderate line simplification by zoom. This is a major geometry layer; low zoom should show network structure, high zoom should preserve real path alignment. | Properties are light; keep fields needed for popup/labels. |
| `muniplicity_transport/דרכי_עפר` | `roads_paths_rivers` | Yes | Treat as a visual road/path line layer. The processed file appears as one huge MultiPolygon with ~280k coordinates, but the intended cartographic result is linear. Prefer upstream normalization to line geometry if possible; if it must remain polygonal, use line-like visual simplification conservatively and validate that roads do not shift, disconnect, or thicken/thin strangely. | Preserve popup fields if present. Properties are currently light, so sidecar is only needed if popup payload grows. |
| `muniplicity_transport/סינגלים`, `שבילים`, regional/local roads | `roads_paths_rivers` | Usually yes for static consistency; optional for very small layers | Light-to-moderate simplification. Preserve route continuity and intersections. Small layers can be left mostly intact. | Keep popup fields in source/tile. |
| `muniplicity_transport` point layers, e.g. train stations | `points_thin` | Usually no | No geometry simplification needed. Render as MapLibre circles/symbols. | Keep popup fields directly unless fields become heavy. |
| `land_use/מגורים` | `dense_feature_polygons` | Yes | Conservative polygon simplification, but the bigger issue is feature/property volume. Preserve parcel/block shapes at high zoom; low zoom can generalize. | Strong candidate for render-property pruning plus popup sidecar. It had about 12.9MB of properties in the scan; popup data must still be preserved. |
| `land_use/שטח_לדרכים`, `שטחים_פתוחים`, `חקלאות_מרעה_ותעשייה` | `large_polygons` / `dense_feature_polygons` | Yes | Conservative polygon simplification with topology checks. Preserve class boundaries and avoid holes/gaps. | Render properties can be reduced, but popup fields must remain inline or sidecar. |
| `land_use` small classes, e.g. `מסחר_ומשרדים`, `תחבורה`, `בית_עלמין`, `ספורט` | `large_polygons` | Yes by default, but lower priority | Light simplification only. These are not first-order bottlenecks. | Keep popup data unless payload grows. |
| `future_development/מימושים` | `dense_feature_polygons` | Yes | Conservative simplification. This has many features, so tune for feature count plus properties, not just coordinates. | Strong candidate for render-property pruning plus popup sidecar; scan showed about 6.1MB of properties. |
| `future_development` route/axis layers, e.g. `הציר_הורוד_חדש`, `ציר_232`, `מורשת-*` | `roads_paths_rivers` for lines, `large_polygons` for areas | Yes for static vectors | Preserve alignment and route identity. Low zoom can simplify small bends, high zoom should remain faithful. | Keep route names/ids and popup fields. |
| `gaza/Gaza_Roads` | `roads_paths_rivers` | Yes | Many features but moderate coordinate count. Use moderate simplification and consider min zoom if too dense at overview. | Preserve popup fields if present. Keep only style/label/lookup fields in render tiles when full popup details move to sidecar. |
| `gaza/gaza_boundary` | `critical_boundaries` | Optional | Minimal simplification. Boundary accuracy matters more than payload. | Keep simple properties. |
| `october_7th` point layers | `points_thin` | Usually no | Do not simplify point geometry. The points are few; lag is more likely labels, properties, flow animation, or sync churn. | Preserve popup data. If lag persists, move full popup fields to lazy-loaded sidecar keyed by feature id; do not discard data. |
| `october_7th` polygon/area layers | `critical_boundaries` for sensitive incident areas, otherwise `large_polygons` | Optional/yes if using static-vector default | Very light simplification only. These are small and semantically sensitive, so performance benefit is limited. | Preserve popup data; sidecar only if measured. |
| `october_7th` line/flow layers, e.g. `חדירה_לישוב-ציר`, `מאבק_וגבורה_ציר` | `roads_paths_rivers` with animation awareness | Optional | Geometry is small. Avoid simplification unless needed; focus first on animation cost and add/remove churn. | Preserve popup fields. |
| `projector_base` | Keep current special handling | Usually no | Do not change until projection assumptions are reviewed. Some layers are tied to calibration/projection behavior. | Preserve all needed projection/label fields. |

### 3b. Data Fidelity Rules

These rules should be treated as non-negotiable when simplifying:

- The original source and processed GeoJSON remain the full-fidelity reference.
- PMTiles are a render product, not the source of truth.
- High zoom tiles must preserve practical inspection accuracy.
- Popup fields must always be preserved when present, either directly in render properties or in a sidecar lookup.
- Style and label fields must remain in the render source.
- Every feature should have a stable id before using sidecars.
- Polygon layers must pass geometry validity checks after tiling/simplification.
- For sensitive semantic layers, prefer less simplification and more min-zoom gating.

### 3c. Sidecar Rule for Popup Data

When a layer has heavy popup text, do not solve performance by deleting fields. Split fields by use:

```text
Render fields:
  feature id
  title/name
  style/category fields
  label fields
  small preview fields

Popup sidecar:
  feature id -> full popup details
```

The GIS click flow can query the rendered feature, get the feature id, lazy-load the sidecar for that layer, and build the popup from the full details. This keeps fidelity and user-facing information while reducing render-source weight.

### 4. Render Property Pruning

Geometry is not the only payload. Some large layers carry large property payloads:

- `land_use/מגורים.geojson`: about 12.9MB of properties.
- `future_development/מימושים.geojson`: about 6.1MB of properties.

For render sources, keep only fields needed for:

- styling
- labels
- popup lookup/title/preview
- stable feature identity
- debugging if necessary

This must not remove popup information from the product. If a field is needed in a popup and is removed from the render source, it must be preserved in a sidecar lookup keyed by stable feature id.

For popup-heavy layers such as October 7th, consider a sidecar pattern:

```text
render GeoJSON / PMTiles:
  geometry
  feature id
  title/name
  styling/category fields
  short preview fields

popup sidecar JSON:
  feature id -> full popup fields
```

On click, query the rendered feature, read its id, and lazy-load the sidecar details for the popup. This preserves rich GIS popups without forcing MapLibre to carry all popup text in every render source.

This is optional for October 7th because the pack is small, but it is the right pattern if popup fields become a measurable bottleneck.

### 5. Runtime Toggle Strategy

PMTiles and simplification reduce load/render cost, but toggling can still lag if every change removes and re-adds sources.

For frequently toggled layers or slideshow packs:

- Prefer `visibility` or opacity changes when a layer may be turned back on soon.
- Remove sources after a short idle/debounce timeout rather than immediately.
- Keep heavy pack sources warm during an active session.
- Fully unload rarely used packs to control memory.

Sync between GIS and projection should stay based on logical layer state:

```text
pack.layer -> enabled / disabled / animation state
```

The render format, GeoJSON or PMTiles, should remain an implementation detail of the layer registry/renderer.

## Practical Next Steps

1. Change the PMTiles decision from complexity-based opt-in to static-vector default with explicit opt-outs.
2. Ensure `greens/נחלים` gets PMTiles.
3. Add tiling presets instead of a single `high_fidelity=True` behavior.
4. Use zoom-aware simplification for `נחלים`, `דרכי עפר`, `שבילי_אופניים`, `מישורי_הצפה`, and other heavy geometry layers.
5. Add a layer processing report that records:
   - GeoJSON size.
   - Feature count.
   - Coordinate count.
   - Estimated property payload.
   - Whether PMTiles exists.
   - Which tiling preset was used.
6. Profile October 7th separately before converting its point layers:
   - layer/source add count
   - label cost
   - popup/property payload
   - flow animation cost
   - repeated sync remove/add cycles
7. If October 7th remains slow, test property sidecars before over-optimizing geometry.

## Acceptance Criteria for Simplification

Simplification is acceptable when:

- High zoom remains visually faithful to source geometry.
- Low zoom still looks natural, not angular or obviously broken.
- Important small features do not disappear unless intentionally hidden by zoom.
- Polygon topology remains valid: no self-intersections, broken holes, or obvious boundary gaps.
- Sensitive layers use conservative presets.
- Any simplification is reproducible from the original source files.

For visual QA, compare original GeoJSON and PMTiles render at representative zooms:

- overview zoom
- normal GIS working zoom
- projection/inspection zoom

The aim is not mathematical perfection at every zoom. The aim is that errors stay below what the user can perceive at that scale, while detail remains available where it matters.
