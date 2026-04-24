# OTEF-Interactive Performance Analysis

**Date:** 2026-04-24
**Branch:** `sync_and_layers_performance` (11 commits beyond `main`)
**Status:** Investigation — root cause analysis before next moves

---

## Executive Summary

The three symptoms — slow layer state changes, layer-loading freezes, and viewport de-sync — share a common root cause that the current branch has been circling without addressing head-on: **the app is asking Leaflet and Canvas 2D to do work that only a WebGL-based renderer can handle at this data scale, and the sync architecture amplifies the pain by serializing everything through a single-threaded HTTP→Django→Redis→WS round-trip for every state change.**

The 11 commits on this branch are individually sound but collectively form a pattern of **symptom-chasing**: deduplication, echo suppression, offscreen caches, batched loads — all of which reduce the *frequency* or *redundancy* of expensive operations, but none of which reduce the *cost* of the operations themselves.

---

## 1. The Data: Where the Actual Weight Lives

### Layer Pack Size Inventory (from `layer_report_current.md`)

| Pack | Layers | Heaviest Layer | Size | Features | PMTiles? |
|------|--------|---------------|------|----------|----------|
| **`land_use`** | 19 | `מגורים` (residential) | **62.40 MB** | 35,823 polygons | Recommended, not always used |
| | | `שטח_לדרכים` (roads) | **51.63 MB** | 5,900 polygons | Recommended |
| | | `שטחים_פתוחים` (open areas) | **24.53 MB** | 6,170 polygons | Recommended |
| | | `חקלאות_מרעה_ותעשייה` | **14.18 MB** | 5,357 polygons | **No** |
| | | `מוסדות_ציבוריים` | 5.69 MB | 1,799 polygons | No |
| **`greens`** | 10 | `מישורי_הצפה` (flood plains) | **93.76 MB** | 428 polygons | Recommended |
| | | `חקלאות` (agriculture) | **42.11 MB** | 35,465 polygons | Recommended |
| | | `נחלים` (streams) | 11.12 MB | 870 lines | No |
| | | `מסדרונות_אקולוגיים` | 8.24 MB | 2 polygons | No |
| | | `יערות_קקל` | 7.36 MB | 1,156 polygons | No |
| **`muniplicity_transport`** | 16 | `שבילי_אופניים` | 21.05 MB | 1,036 lines | Recommended |
| | | `דרכי_עפר` | 10.63 MB | 1 polygon | No |
| **`future_development`** | 10 | `מימושים` | 23.50 MB | 18,074 polygons | Recommended |
| **`october_7th`** | 19 | All layers | < 0.3 MB each | < 100 features | No |

**Key finding:** Loading `land_use` means fetching **~165 MB** of GeoJSON. Loading `greens` means **~175 MB**. Loading both simultaneously means **~340 MB of raw GeoJSON** hitting the browser's main thread for parsing, then being rendered into Leaflet layers AND Canvas 2D projection overlays.

Even with PMTiles available for some layers, the **projection Canvas renderer does not support PMTiles** (confirmed in code comment). So the projection side always fetches and parses raw GeoJSON.

### Why This Matters More Than Sync Tuning

Consider what happens when a user toggles the `land_use` pack on from the remote controller:

1. **Remote controller** sends `PATCH` with updated `layerGroups` → Django → DB → WS broadcast (~20-40ms for the Django Channels group_send alone)
2. **GIS page** receives WS notification, runs `applyLayerGroupsState` → starts fetching up to 19 GeoJSON files (concurrency-limited to 2) → each large file blocks the main thread during JSON.parse → Leaflet creates DOM/Canvas elements for tens of thousands of features
3. **Projection page** receives same WS notification, runs `syncLayerGroupsFromState` → fetches same GeoJSON files → runs `AdvancedStyleEngine.computeCommands` + `AdvancedStyleDrawing.drawCommands` for every feature into offscreen canvases at `devicePixelRatio` resolution

**No amount of deduplication, echo suppression, or cache invalidation will make 62 MB of JSON.parse + 35,823 polygon Canvas 2D draws fast.**

---

## 2. Analysis of Branch Commits: What Was Tried

### Summary Table

| # | Commit | Strategy | Targets Root Cause? |
|---|--------|----------|-------------------|
| 1 | `12d5a5a` Deduplication | Reduce subscriber churn | Reduces redundancy, not cost |
| 2 | `68b62d4` Echo suppression | Skip WS echos during local writes | Reduces redundancy |
| 3 | `10d1898` Sequence-aware sync | Prevent stale viewport applies | Correctness fix (good) |
| 4 | `efa030d` CSS highlight | Move highlight to compositor | **Genuine root-cause win** |
| 5 | `61e54a7` Offscreen caches | Cache rasterized layers | Helps re-draws, not first draw |
| 6 | `34acde3` Parallel projection loads | Load WMTS in parallel | Small improvement |
| 7 | `fd607ff` Lazy-load GIS layers | Only load enabled layers | Reduces scope, not cost per layer |
| 8 | `a6c01bc` Telemetry | Count notify fanouts | Observability (good) |
| 9 | `252e80a` State-sync freshness | Server-enriched WS payloads | Reduces round-trips (good) |
| 10 | `2e0c55b` Remote control tuning | Queued zoom, live viewport | Correctness + responsiveness |
| 11 | `e27416b` Reconcile churn | Concurrency limits, centralized zoom | Reduces frequency of expensive ops |

**Verdict:** The branch is internally coherent and well-reasoned. Commit `efa030d` (CSS highlight) is the one genuine rendering-cost reduction. The rest are **necessary but insufficient** — they're the equivalent of optimizing the fuel injection on a car that needs a bigger engine.

### The Unseen Pattern

Across the 11 commits, a meta-pattern emerges: **layered heuristics compensating for architectural constraints**. The code now has:
- `_pendingLayerOps` / `_pendingAnimationOps` counters
- `_viewportSeq` monotonic sequence numbers
- `sourceId` dedup on viewport applies
- 150ms `isApplyingRemoteState` sync lock
- `lastAppliedViewportSeq` comparison
- 250ms `getState` short-term cache
- `VisibilityController` zoom gating
- `MAX_GIS_LAYER_LOAD_CONCURRENCY = 2`
- `BATCH_SIZE = 2` for projection loads
- Flow animation cache dirty flags

Each of these is locally rational, but together they form a **fragile coordination web** where changing any one parameter can break another's assumptions. This is the "chasing our own tail" feeling you described.

---

## 3. Root Cause Breakdown by Symptom

### Symptom 1: Layer state changes are not snappy (seconds delay)

**Root cause chain:**
1. Remote controller `PATCH`es layerGroups → Django view saves to DB → builds broadcast payload → `async_to_sync(channel_layer.group_send)` (20-40ms per group_send via Redis)
2. WS broadcast reaches GIS + projection pages
3. Both pages run full reconciliation: diff enabled layers, determine what to load/unload
4. Loading even one heavy layer blocks the main thread during fetch + parse + render

**The Django hop is not the bottleneck** for small payloads. The bottleneck is that "apply this layer state" means "parse and render megabytes of geometry." The delay feels like seconds because the main thread is genuinely blocked for seconds.

### Symptom 2: Loading heavy layer packs freezes GIS/projection

**Root cause:** This is the **primary architectural limitation**.

- **GIS side (Leaflet):** Even with `preferCanvas: true`, Leaflet processes GeoJSON features synchronously on the main thread. 35,000+ polygons from `מגורים` alone will freeze the UI. Leaflet maintainers explicitly say [32,000+ features is "basically too much"](https://github.com/Leaflet/Leaflet/issues/7309) for standard Leaflet rendering.
- **Projection side (Canvas 2D):** The custom `AdvancedStyleEngine` iterates every feature, computes draw commands, and executes them on 2D canvas context — all synchronous, all main-thread. Offscreen caches help for *redraws* but the *first draw* still pays full cost.
- **Multiplied by packs:** Loading `land_use` + `greens` simultaneously means 340+ MB of GeoJSON processed twice (once per page), with concurrency limited to 2 layers at a time = many sequential main-thread blocks.

### Symptom 3: Viewport sync de-syncs, rubberbanding, zoom issues

**Root cause chain:**
1. Remote controller sends pan/zoom → Django `command` endpoint applies delta to stored viewport → broadcasts new viewport
2. GIS page receives viewport, does `map.setView()` → Leaflet fires `moveend`/`zoomend` → viewport-sync sends the *applied* state back as a PATCH → this causes an echo
3. The echo suppression (seq, sourceId, sync lock) works *most of the time* but breaks under:
   - **High load:** When heavy layers are being rendered, `moveend` fires late (or the sync lock expires before `setView` completes)
   - **High zoom:** More precise coordinates = more jitter in the equality check; smaller pixel movements = more sensitive to latency
   - **Animated transitions:** `setView` with animation fires `moveend` *after* the animation, by which time the remote may have sent another update

**The fundamental issue:** Two sources of truth (Leaflet's internal state and the Django DB state) are being reconciled optimistically through a network hop, with the GIS page acting as both a producer and consumer of viewport state. Every round-trip adds a chance for divergence.

---

## 4. Perspective Ensemble

### Panel A — Council (Tradeoff Exploration)

**Task classification:** Performance architecture decision for a multi-surface collaborative GIS application.

#### Lens 1: Rendering Technology (Leaflet vs WebGL)
**Concern:** Leaflet with Canvas 2D rendering fundamentally cannot handle 30,000+ polygon layers interactively.
**Flag:** The entire layer rendering pipeline — both GIS and projection — is CPU-bound on the main thread. No amount of JS-level optimization changes this.
**Counter-move:** Migrate GIS to MapLibre GL JS (WebGL-based, vector tile native). For projection, either use a second MapLibre instance with custom style or move Canvas rendering to a Web Worker with OffscreenCanvas.

#### Lens 2: Data Format (GeoJSON vs Vector Tiles)
**Concern:** Raw GeoJSON forces the browser to parse entire datasets into memory. A 93 MB file means 93 MB of string parsing on the main thread.
**Flag:** PMTiles are "recommended" for 7 layers but the projection Canvas renderer doesn't support them. Many heavy layers (14 MB agriculture, 8 MB ecological corridors, 11 MB streams) have no PMTiles at all.
**Counter-move:** Convert ALL layers > 1 MB to PMTiles. For projection, either implement a PMTiles reader for Canvas or switch to a WebGL renderer that supports them natively.

#### Lens 3: Sync Architecture (Round-trip vs Local-first)
**Concern:** Every state change makes a full HTTP round-trip through Django before other clients see it. Group_send via Redis adds 20-40ms minimum.
**Flag:** The joystick/d-pad sends velocity updates over WS (good), but discrete pan/zoom/layer toggles go through HTTP PATCH → DB write → WS broadcast. This is unnecessarily serialized.
**Counter-move:** Adopt a **local-first** model: apply state changes immediately in all connected clients via WS broadcast, then persist to DB asynchronously. Django becomes a persistence and conflict-resolution backend, not the real-time data path.

#### Lens 4: Coupling to Legacy CityScope
**Concern:** The OTEF module lives inside a larger Django monolith. The `GeneralConsumer` handles all WS types; `views.py` is 2400+ lines with mixed concerns.
**Flag:** Performance debugging is harder when the frontend is served by nginx as static files but state management goes through a Django monolith that also handles curation, Supabase proxying, GIS layer imports, and workshop features.
**Counter-move:** The frontend is already architecturally independent (Vite-built, static HTML, own entry points). The backend coupling is in the state management API. Decoupling the real-time sync layer (extracting it to a lightweight WS server or using a service like Supabase Realtime directly) would be lower risk than a full separation.

#### Lens 5: Developer Experience / Debuggability
**Concern:** Diagnosing sync issues across 3 browser windows + Docker container + Django logs is painful.
**Flag:** The in-progress `otef-trace.js` is the right direction but collecting traces manually from 3 windows is untenable.
**Counter-move:** Build a unified trace dashboard (single page that collects and correlates events from all three surfaces via WS or shared state) before making more architectural changes. You can't optimize what you can't measure.

#### Tensions (unavoidable tradeoffs)

1. **Migration scope vs immediate relief:** Switching to MapLibre solves the rendering ceiling but is a multi-week effort; meanwhile the app is unusable with heavy layers.
2. **Data pipeline investment vs rendering workarounds:** Converting all layers to PMTiles/vector tiles and building a vector tile renderer for projection is thorough but requires pipeline work; loading fewer features at a time is a hack but works now.
3. **Decoupling vs feature velocity:** Extracting the sync layer gives architectural freedom but means temporarily maintaining two systems; staying in Django means living with its WS performance ceiling.

---

### Panel B — Adversarial (Red Cell)

**Attack target:** The implicit plan to continue optimizing the existing Leaflet + Canvas 2D + Django Channels architecture with surgical fixes.

#### Vector 1: The Rendering Ceiling is Physical, Not Algorithmic
**Vulnerability:** Leaflet and Canvas 2D rendering are CPU-bound on a single thread. The browser's main thread can process roughly 5,000-10,000 simple polygons per frame at 60fps. The `land_use` pack has 35,823 polygons in a single layer.
**Failure scenario:** Every optimization reduces overhead *around* the render call, but the render call itself takes 2-5 seconds for heavy layers. Users see "improvement" as going from 8-second freeze to 5-second freeze — still unusable. Team burns another month of effort for marginal gains.
**Mitigation:** Accept that the rendering engine must change. Budget the migration properly rather than hoping JS-level tricks will close a 10x performance gap.

#### Vector 2: Heuristic Coordination Collapse
**Vulnerability:** The branch has accumulated 8+ interlocking coordination mechanisms (seq, sourceId, pending ops, sync locks, cache TTL, visibility controller, concurrency limits, batch sizes). These interact in non-obvious ways.
**Failure scenario:** A future feature (multi-user editing, undo/redo, offline support) or even a Leaflet update breaks an assumption in one heuristic, causing cascading de-syncs. Debugging requires understanding all 8 mechanisms simultaneously. The team adds a 9th heuristic to patch the symptom.
**Mitigation:** Replace the heuristic stack with a formal state model: monotonic server revision per field, client applies if revision > local, conflict resolution is last-writer-wins. This eliminates seq, sourceId, pending ops, sync locks, and cache TTL as separate concepts.

#### Vector 3: Django Channels is Not Designed for This
**Vulnerability:** Django Channels group_send through Redis is [100x slower than direct consumer messaging](https://lightrun.com/answers/django-channels_redis-sending-messages-is-slow-when-using-groups). The architecture runs a single Daphne process. There's no server-side throttling of WS messages.
**Failure scenario:** Under load (multiple users, heavy layers, rapid viewport changes), the WS channel becomes a bottleneck. Messages queue in Redis, arrive out of order or stale. Scaling Daphne horizontally is possible but untested and adds sticky-session complexity.
**Mitigation:** For a 3-client collaborative map, the infrastructure is over-engineered (Django ORM + Redis + Channels) and under-performing. A lightweight WS relay (e.g., a 50-line Node/Bun script, or Supabase Realtime which you already use for curation) would be faster and simpler.

#### Vector 4: The Projection Canvas Renderer is a Dead End
**Vulnerability:** The custom `AdvancedStyleEngine` + `AdvancedStyleDrawing` Canvas 2D pipeline re-implements what MapLibre/deck.gl do in WebGL. It doesn't support PMTiles, doesn't use Web Workers, doesn't use OffscreenCanvas for off-thread rendering, and re-rasterizes animated layers every frame.
**Failure scenario:** As layer complexity grows (more packs, more features, more animation types), the Canvas renderer becomes the permanent bottleneck. Each new layer type requires custom drawing code. Performance improvements require low-level Canvas optimization expertise.
**Mitigation:** MapLibre GL JS can render directly to a `<canvas>` with no basemap (transparent background), making it usable as a projection overlay renderer. This replaces the entire custom Canvas pipeline with a battle-tested WebGL renderer.

### Strongest Attack (single paragraph)

The deepest vulnerability is **denial of the rendering ceiling**. The team has spent 11 commits optimizing the coordination layer — dedup, echo suppression, caching, batching — because those are the problems visible in the code. But the actual wall is that Canvas 2D cannot render 35,000 polygons interactively, and no amount of JS-level optimization will change that. Every hour spent on another heuristic or cache parameter is an hour not spent on the migration that would eliminate the entire class of problems. The longer this continues, the more coordination complexity accumulates, making the eventual migration harder.

### Falsifiers / Early Warnings

- If disabling ALL layers except one small pack (e.g., `october_7th`, < 1 MB total) makes sync perfectly snappy with no de-sync → confirms rendering cost is the dominant factor, not sync architecture
- If adding a `console.time('JSON.parse')` wrapper around GeoJSON fetch+parse shows > 1 second for heavy layers → confirms parse cost dominates
- If running Chrome DevTools Performance recording during layer toggle shows > 80% of time in "Scripting" (not "Rendering" or "Network") → confirms main-thread computation is the bottleneck
- If the Django response time for PATCH + broadcast is consistently < 100ms → confirms Django is not the bottleneck for state changes

---

## 5. Recommended Course of Action

### Conditional Recommendation

**Choice:** Migrate the GIS rendering from Leaflet to **MapLibre GL JS**, convert all heavy layers to **vector tiles** (PMTiles), and use MapLibre as the projection overlay renderer too. In parallel, simplify the sync architecture to a **local-first model** with server-side monotonic revisions.

**Because:** This addresses all three root causes simultaneously:
1. WebGL rendering eliminates the 35,000-polygon ceiling
2. Vector tiles eliminate the 62 MB JSON.parse blocking
3. MapLibre on projection eliminates the custom Canvas renderer entirely
4. Local-first sync eliminates most of the heuristic coordination complexity

**Would revise if:**
- The falsifier tests show that sync latency (not rendering) is actually dominant
- The project timeline cannot accommodate a rendering migration (in which case: convert ALL heavy layers to PMTiles, implement aggressive zoom-based layer visibility to never load more than ~5,000 features at once, and accept that heavy packs will always be slow on first load)

### Phased Approach

#### Phase 0: Validate (1-2 days)
Run the falsifier tests listed above to confirm rendering is the dominant bottleneck. Also measure:
- Time from remote toggle click to layer appearing on GIS
- Time from remote toggle click to layer appearing on projection
- Chrome Performance recording for `land_use` pack toggle

#### Phase 1: Stop the Bleeding (3-5 days)
Without changing the rendering engine:
1. **Convert ALL layers > 2 MB to PMTiles** (currently only "recommended" for some)
2. **Implement aggressive viewport-based feature culling** on the GIS side — use Leaflet's PMTiles adapter to only render features in the current viewport
3. **Add a loading state** to remote controller so users know something is happening (currently: toggle → wait → eventually something changes)
4. **Increase `MAX_GIS_LAYER_LOAD_CONCURRENCY`** from 2 to 4 for lightweight layers while keeping it at 2 for heavy ones

#### Phase 2: MapLibre Migration — GIS Page (1-2 weeks)
1. Replace Leaflet with MapLibre GL JS on the GIS page
2. MapLibre natively consumes PMTiles via `pmtiles://` protocol
3. Port the viewport-sync code to MapLibre's event model (`moveend`, `zoomend` are similar)
4. MapLibre's `setCenter`/`setZoom`/`flyTo` are GPU-accelerated — viewport applies become non-blocking
5. Port layer styles from the custom `AdvancedStyleEngine` IR to MapLibre style spec (the IR is already close to Mapbox/MapLibre style format)

#### Phase 3: MapLibre for Projection (1 week)
1. Use MapLibre GL JS with transparent background, no basemap
2. The model image stays as a CSS background behind the MapLibre canvas
3. MapLibre's `fitBounds` + rotation replaces the manual ITM→pixel math
4. This eliminates: `layer-renderer-canvas.js`, `AdvancedStyleEngine`, `AdvancedStyleDrawing`, `projection-animation-loop.js`, `wmts-layer-renderer.js`
5. Highlight overlay becomes a MapLibre `fill-extrusion` or simple CSS overlay on the MapLibre canvas

#### Phase 4: Simplify Sync (1 week, can start earlier)
1. Replace the heuristic stack with a **monotonic revision** model:
   - Server assigns `revision` on every write
   - WS broadcast includes `revision`
   - Client applies if `revision > lastApplied`
   - No more seq, sourceId, pending ops, sync locks, or cache TTL
2. Move discrete state changes (layer toggles) to **WS-first** (broadcast immediately, persist async) instead of HTTP-first
3. Keep HTTP PATCH for viewport debounced updates (already working)

---

## 6. Open Questions / Cheap Tests

1. **PMTiles coverage:** How many of the "recommended" PMTiles files actually exist in `public/processed/`? If they're already built, enabling them on GIS is quick.
2. **MapLibre in iframe:** Can the projection page use MapLibre inside the iframe-like projection display? Or does TouchDesigner capture require a specific DOM structure?
3. **Projection CRS:** MapLibre uses EPSG:3857 (Web Mercator). The projection currently uses EPSG:2039 (ITM) coordinates mapped linearly to pixels. Would MapLibre's built-in projection handling be accurate enough for the physical model overlay, or do you need custom CRS support (available via `maplibre-gl-js` transform extensions)?
4. **Supabase Realtime as sync layer:** You already use Supabase for curation. Could Supabase Realtime replace Django Channels for OTEF state sync, eliminating the Django-as-relay overhead?
5. **Team capacity:** Is there bandwidth for a rendering migration, or do we need to find a "good enough" intermediate state?

---

## Appendix: Architecture Diagram (Current)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Remote Controller                             │
│  (mobile browser — nipplejs joystick, layer sheet, zoom controls)   │
│                                                                      │
│  Actions: pan/zoom → HTTP POST command                               │
│           layer toggle → HTTP PATCH layerGroups                      │
│           velocity → WS otef_velocity_update                         │
└──────────┬──────────────────────────────────────┬───────────────────┘
           │ HTTP                                  │ WebSocket
           ▼                                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      Django (Daphne ASGI)                            │
│  ┌─────────────────┐   ┌────────────────┐   ┌───────────────────┐  │
│  │ OTEFViewportState│   │ GeneralConsumer │   │ Redis Channel Layer│  │
│  │ ViewSet          │   │ (WS handler)   │   │                   │  │
│  │ - by-table GET   │   │ - group_send   │   │ group: otef_channel│  │
│  │ - by-table PATCH │   │ - broadcast    │   │                   │  │
│  │ - command POST   │   │                │   │                   │  │
│  └────────┬─────────┘   └────────────────┘   └───────────────────┘  │
│           │                                                          │
│  ┌────────▼─────────┐                                                │
│  │ PostgreSQL        │                                               │
│  │ OTEFViewportState │                                               │
│  │ LayerGroup/State  │                                               │
│  │ GISLayer (data)   │                                               │
│  └──────────────────┘                                                │
└──────────┬──────────────────────────────────────┬───────────────────┘
           │ WS broadcast                          │ WS broadcast
           ▼                                       ▼
┌────────────────────────┐        ┌─────────────────────────────────┐
│     GIS Page           │        │     Projection Page              │
│  (Leaflet + Canvas)    │        │  (Custom Canvas 2D renderer)    │
│                        │        │                                  │
│  - Leaflet map         │        │  - Model image background       │
│  - GeoJSON layers      │        │  - Offscreen layer canvases     │
│  - PMTiles (some)      │        │  - AdvancedStyleEngine           │
│  - preferCanvas: true  │        │  - WMTS tile renderer           │
│  - proj4 ITM↔WGS84    │        │  - CSS highlight overlay        │
│                        │        │  - Animation rAF loop           │
│  BOTTLENECK:           │        │  BOTTLENECK:                    │
│  35k+ polygons on      │        │  Full GeoJSON parse + Canvas 2D │
│  main thread via       │        │  draw for every feature, every  │
│  Leaflet Canvas        │        │  layer, on main thread          │
└────────────────────────┘        └─────────────────────────────────┘

    All three pages share OTEFDataContext singleton
    State flow: HTTP PATCH → Django DB → WS broadcast → all clients
```

---

## Appendix: Layer Weight Visualization

```
Heavy layers by raw GeoJSON size:

greens.מישורי_הצפה       ████████████████████████████████████████████ 93.76 MB
land_use.מגורים           █████████████████████████████████ 62.40 MB
land_use.שטח_לדרכים      ██████████████████████████ 51.63 MB
greens.חקלאות             █████████████████████ 42.11 MB
land_use.שטחים_פתוחים    ████████████ 24.53 MB
future_dev.מימושים       ████████████ 23.50 MB
muni.שבילי_אופניים       ██████████ 21.05 MB
land_use.חקלאות_מרעה     ███████ 14.18 MB
greens.נחלים              ██████ 11.12 MB
muni.דרכי_עפר            █████ 10.63 MB
greens.מסדרונות_אקולוגיים ████ 8.24 MB
greens.יערות_קקל         ████ 7.36 MB

Everything else: < 6 MB each (usually < 2 MB)

When land_use + greens are enabled: ~340 MB of GeoJSON
    → parsed on main thread
    → rendered into Leaflet Canvas (GIS) + offscreen Canvas 2D (projection)
    → this is the freeze
```

---

## 7. Decision Record (2026-04-24)

### Decisions Made

1. **Rendering engine: Leaflet → MapLibre GL JS** on both GIS and projection pages
2. **Data format: PMTiles consumed natively** via `pmtiles://` protocol (already generated for heavy packs)
3. **Projection approach: MapLibre with transparent background** overlaid on model image, replacing Canvas 2D renderer
4. **Branch strategy: Keep `sync_and_layers_performance` branch**, add migration commits on top
5. **Backend: Django stays unchanged** — no Supabase Realtime migration at this time
6. **Sync improvements: Retained** — the 11 existing commits (dedup, echo suppression, etc.) stay; some may become redundant after migration

### Falsifier Validation

- Confirmed: lighter layer packs (e.g. `october_7th`) are noticeably snappier
- Confirms rendering cost is the dominant bottleneck, not sync architecture

### PMTiles Coverage (checked on disk, gitignored)

| Pack | PMTiles | GeoJSON | Coverage |
|------|---------|---------|----------|
| `land_use` | 19 | 19 | 100% |
| `greens` | 9 | 10 | 90% |
| `muniplicity_transport` | 8 | 17 | 47% |
| `october_7th` | 7 | 19 | 37% |
| `future_development` | 2 | 11 | 18% |

### Style Compatibility Assessment

~85% of existing styles map directly to MapLibre style spec. Gaps:
- **Hatch fills**: Need generated pattern images → `fill-pattern`
- **Stroke glow** (pink line shadow): Extra blurred line layer
- **Flow/reveal/trail animations**: Need per-frame style updates or custom layers
- **Marker-along-line**: `symbol` with `symbol-placement: line`

### Implementation Plan

See `docs/superpowers/plans/2026-04-24-maplibre-migration.md`

---

## 8. Post-Migration Status (2026-04-24, evening)

### What Was Implemented (7 commits)

| Commit | What |
|--------|------|
| `730e503` | Scaffold MapLibre runtime dependencies and map bootstrap |
| `5f0fb74` | Style bridge: translate OTEF AdvancedStyleEngine IR → MapLibre style layers |
| `51d81a5` | GIS layer manager: registry-driven add/remove of MapLibre sources+layers |
| `72ce376` | Viewport sync: remote viewport → MapLibre `fitBounds`, local move → context |
| `01d2352` | Wire GIS entrypoint (`map-main.js`) to MapLibre runtime |
| `bcb5798` | Projection: MapLibre overlay on model image, WMTS raster support |
| `b5e9675` | Keep legacy references, stabilize Docker runtime |

### What Works
- MapLibre loads on both GIS and projection pages
- OSM/satellite basemap on GIS
- Simple-renderer layers (polygon fill/stroke, line, circle markers) render correctly
- Viewport sync (remote → GIS pan/zoom) is functional
- Layer toggle propagation works end-to-end
- Highlight overlay on projection updates from viewport state
- PMTiles sources load via `pmtiles://` protocol
- Layer legend renders

### Active Bugs Found During Testing

1. **Style bridge `undefined` in match expressions** — `buildUniqueValueGroups` indexes by position; when class symbols differ from default composition, wrong default is used → MapLibre rejects `undefined` values in paint expressions. Affects ~7 `land_use` and `future_development` layers.

2. **Projection map moves with viewport** — `updateProjectionViewport` calls `map.fitBounds` on every viewport change. Should be static (full model always visible); only highlight overlay should move.

3. **Projector_base layers visible on GIS** — `map-main.js` doesn't use `filterGroupsForGisMap` from `gis-layer-filter.js`. Layers like רקע_שחור, SEA, model_base, sat imagery show on GIS page.

4. **Curated layers not rendering** — Curated layer IDs (`curated_moresht_axis.*`) not in layer registry → `getLayerConfig` returns null → silently skipped. The old curated pipeline wrote to the Canvas renderer which is now a no-op shim.

5. **Hatch fills render as solid** — `fillType: "hatch"` treated as regular fill. Affects land_use layers with hatch patterns.

6. **Layer propagation latency** — Pre-existing Django HTTP round-trip issue, unchanged by migration.

### Remaining Work for Feature Parity

| Feature | Priority | Complexity | Approach |
|---------|----------|------------|----------|
| Fix style bridge undefined bug | **P0** | Low | Sanitize match expression fallbacks in `buildMatchExpr` |
| Fix projection static viewport | **P0** | Low | Remove `updateProjectionViewport` call from viewport subscription |
| GIS layer filtering | **P0** | Low | Import and apply `filterGroupsForGisMap` in `map-main.js` |
| Pink line + curated on GIS | **P0** | High | Create `maplibre-curated-layer-loader.js` — MapLibre port of `leaflet-curated-layer-loader.js`, reusing renderer-agnostic pipeline |
| Pink line + curated on projection | **P0** | High | Reuse `maplibre-curated-layer-loader.js` + wire Supabase heartbeat |
| Hatch fill patterns | **P2** | Medium | Generate pattern images, use `fill-pattern` |
| Flow/trail animations | **P2** | Medium | MapLibre `line-dasharray` + periodic `setPaintProperty` |
| Marker-along-line | **P3** | Low | MapLibre `symbol` layer with `symbol-placement: line` |
| Projection bounds editor | **P2** | Low | Verify existing code works with MapLibre overlay |
| Projection rotation editor | **P2** | Low | Verify existing code works with MapLibre overlay |

### Decision: Animation Approach

Evaluated deck.gl vs MapLibre-native for flow animations:
- **deck.gl**: Powerful (TripsLayer, PathLayer with animation), but adds ~500KB bundle, second GL context, integration complexity
- **MapLibre-native**: `line-dasharray` animation via periodic `setPaintProperty` calls from `requestAnimationFrame`. Simpler, no new dependency, sufficient for 2-layer flow animation. Can evaluate deck.gl later if animation complexity grows.

**Decision:** Start with MapLibre-native `line-dasharray` animation. Revisit deck.gl only if more complex animation types are needed.

### Decision: Pink Line Route Overlay (2026-04-24)

The pink line route overlay is **critical for first pass** — it must work like it did before migration, showing the pink line base, proposed routes, old/removed routes correctly, with real-time updates from Supabase via heartbeat and workshop mode.

**Key architectural finding:** The existing data pipeline is already cleanly layered:
- `planPinkCuratedOverlayLayers()` is renderer-agnostic (returns draw ops, not Leaflet objects)
- `routeLineStylesForDisplayColor()` returns style objects that map directly to MapLibre paint properties
- `buildIntegratedRoute()`, `parseColabRouteGeometryBundle()`, etc. are all pure logic

Only the final materialization step (`leaflet-curated-layer-loader.js` → `L.polyline`, `L.marker`, etc.) needs a MapLibre equivalent. The porting creates `maplibre-curated-layer-loader.js` which converts draw ops to MapLibre sources + layers.

**Coordinate system note:** Overlay plan ops use Leaflet `[lat,lng]` format. MapLibre GeoJSON requires `[lng,lat]`. Flipped at materialization boundary.

---

## 9. Parity Plan Execution Update (2026-04-24, late night)

### Tasks Completed

The parity plan at `docs/superpowers/plans/2026-04-24-maplibre-parity.md` has been executed end-to-end.

| Task | Status | Notes |
|------|--------|-------|
| 1. Style bridge undefined fix | ✅ Done | Type-aware defaults + match fallback guards + regression test for index/type mismatch case |
| 2. Projection static viewport | ✅ Done | Projection map no longer follows GIS viewport; only CSS highlight updates |
| 3. GIS layer filtering | ✅ Done | `filterGroupsForGisMap` applied to GIS layer application and curated refresh paths |
| 4. Curated pink line on GIS | ✅ Done | New `maplibre-curated-layer-loader.js`; pink base + overlay ops + markers + cleanup + Supabase flow |
| 5. Curated pink line on projection | ✅ Done | Reused MapLibre curated loader on projection with heartbeat/reload wiring |
| 6. Hatch fill patterns | ✅ Done | Deterministic hatch specs + `fill-pattern` generation/registration + lifecycle cleanup/rollback hardening |
| 7. Flow/trail animations | ✅ Done | New `maplibre-flow-animation.js`, GIS + projection wiring, stop cleanup, map-scoped state |
| 8. Bounds/rotation editors verification | ✅ Done | Editors confirmed callback/DOM-based (not Leaflet/canvas dependent), shortcut wiring covered |
| 9. Image layer handling/model base visibility | ✅ Done | Image layers skipped in MapLibre manager; `model_base` opacity now follows layer state |
| 10. Curated warning suppression | ✅ Absorbed in Task 4 | Curated IDs are skipped in registry path when config is missing |

### Implementation Decisions During Execution

- Curated refresh paths were made consistent across GIS/projection: affected-list reloads and full refresh behavior both remove stale curated artifacts before reload.
- Pink base IDs were aligned to the plan contract (`pink_line_base`, `pink_line_base__line`) for deterministic integration behavior.
- For hatch patterns, deterministic pattern IDs are reused and image lifecycle is reference-counted to prevent style-image buildup over repeated toggles.
- Projection curated sync now mirrors GIS event behavior (`otef-curated-geojson-refresh` handling and `nur-curated-supabase-pull` dispatch), with serialized refreshes to avoid overlap races.
- Non-pink curated fallback now materializes geometry-appropriate MapLibre layers (`fill`, `line`, `circle`) instead of a fill-only fallback.

### Remaining Gaps / Follow-ups

- **Marker-along-line parity** is still pending (`P3` item from the parity table).
- **Manual visual QA pass** is still required for final sign-off (pink route styling, hatch aesthetics, flow behavior on real data packs, projection overlay parity).
- **Full branch test suite** still contains pre-existing unrelated failures (not introduced by these parity commits) in files such as parking toggle actions and selected map utility/config tests.

---

## 10. Deep Regression Sweep (2026-04-24, night)

### Scope

After the parity execution update, a focused bug sweep was run against live behavior reports:

1. GIS viewport and projection highlight lose sync after zoom/joystick usage  
2. zoom value drifts to ~`11.267` and `+` jumps to `12` from wrong baseline  
3. advanced style layers / PMTiles polygons missing  
4. point markers default to grey while legend colors remain correct  
5. curated proposed lines lose double-dash + secondary color  
6. animations appear non-functional  
7. Gaza satellite image ignores mask on projection  
8. projection highlight visual design diverges (cyan instead of white design tokens)  
9. individual layer tile toggles fail unless pack toggle-all was enabled first

### Root Cause Clusters (Validated in Code)

#### A) State contract mismatches (viewport + zoom)
- `maplibre-viewport-sync.js` reports fractional `map.getZoom()` and uses apply logic that can diverge from remote integer-ish control assumptions.
- `remote-controller.js` uses `parseInt(slider.value, 10)` as first zoom source in controls, causing truncation and wrong increment baselines.
- Existing sequence-aware Leaflet-era stabilization was not fully carried over to the MapLibre sync path.

#### B) Visibility contract regression (pack vs layer)
- `maplibre-layer-manager.js` and `maplibre-projection-layers.js` skip whole groups when `group.enabled === false`.
- This conflicts with prior OTEF behavior where `group.enabled` acts as toggle-all shortcut and individual `layer.enabled` can still control visibility.

#### C) Projection-only rendering parity gaps
- MapLibre WMTS projection path currently mounts raw raster sources/layers without mask clipping logic previously handled by `wmts-layer-renderer.js`.
- `maplibre-projection.js` creates `.highlight-box` with hardcoded inline cyan border, overriding CSS parity styling.

#### D) Style translation gaps
- `maplibre-style-bridge.js` point circle paint can fall back to `#808080` because color sourcing does not fully mirror legacy marker/fill combinations.
- `markerLine` remains intentionally unimplemented (`return null`) in bridge path.
- PMTiles rendering can silently fail when `source-layer` does not match tile metadata.

#### E) Curated + animation integration gaps
- Curated proposed line semantics need explicit phase/interleave parity for double-dash behavior.
- MapLibre flow animation module exists, but runtime layer-state wiring from `OTEFDataContext.animations` to concrete MapLibre layer ids remains incomplete.

### Branch Archaeology Summary

- Pre-migration sync/perf fixes (`12d5a5a`..`e27416b`) improved stability in Leaflet/Canvas paths.
- MapLibre stack landed in `730e503`..`bcb5798` and follow-up parity commits through `3bdb580`.
- Several current regressions are not single-line bugs; they are boundary mismatches between:
  - old state/visibility contracts and new MapLibre managers
  - old projection WMTS/mask pipeline and new raster-only projection path
  - old style semantics and bridge coverage limits

### Decision and Plan

A dedicated recovery plan was created to close these regressions with minimal tests and commit checkpoints every 2-3 tasks:

- `docs/superpowers/plans/2026-04-24-maplibre-regression-recovery.md`

Execution strategy:
- Keep MapLibre migration (no rollback of entire stack)
- Forward-fix parity gaps by subsystem in this order:
  1) zoom/viewport contract
  2) pack/layer visibility semantics
  3) projection WMTS masking + highlight parity
  4) style bridge and PMTiles source-layer hardening
  5) curated proposed-line semantics
  6) animation wiring

### Verification Requirements (Before Closure)

- Focused test runs on touched parity paths only (minimal suite)
- Manual parity QA on GIS + projection with joystick, zoom controls, curated routes, animation toggles, and masked Gaza imagery
- No completion claim without fresh command evidence

## 11. Regression recovery execution (2026-04-24, session)

**Context:** This subsection records outcomes for the [maplibre regression recovery plan](superpowers/plans/2026-04-24-maplibre-regression-recovery.md) work completed in the same session as this update.

**Tasks 1–8 — what was fixed (concise):**

1. **Zoom contract:** Addressed drift and the `11.267` → `12` jump by aligning remote zoom input and MapLibre sync with a stable, integer-baseline control contract.
2. **Viewport / projection sync:** Stabilized GIS ↔ projection viewport sync so zoom and joystick use do not desynchronize highlights quickly.
3. **Pack vs layer visibility:** Restored behavior where per-layer tile toggles work even when the pack’s toggle-all is off (group vs layer semantics).
4. **Projection WMTS masking:** Brought back masking for projection imagery (e.g. Gaza satellite) on the MapLibre projection path, within current engine limits (see limitations below).
5. **Style / PMTiles:** Removed incorrect grey fallbacks for valid point/marker colors and improved polygon/PMTiles rendering; see explicit note below.
6. **Curated proposed lines:** Restored double-dash and secondary-color semantics for curated proposed routes.
7. **Animations:** Wired animation state from the app to MapLibre layer targets so flow-style animations can run on the new stack.
8. **Projection highlight:** Re-aligned projection highlight styling with the intended design tokens (vs hardcoded cyan-only treatment).

**Style and PMTiles (explicit):** Changes in the style bridge and PMTiles path **removed grey masking of valid colors** and **hardened `source-layer` resolution** so layers resolve correctly against tile metadata and do not fail silently or paint with wrong neutrals.

**Verification evidence:** The targeted test suite for these paths was run successfully: **10 test files, 119 tests**, all passing.

**Lint status:** The `npm` **lint script was not present** in the project scripts checked for this work; **ReadLints** on touched files **reported no issues**.

**Known limitations to track**

- **Task 4 (masking):** `mask.exclude` (and similar) is applied in a **bounded** way: clipping follows the **mask bounding box** (or equivalent bbox-oriented handling), not a **true polygon inverse clip** in MapLibre. Expect edge cases at mask boundaries vs. legacy WMTS/mask pipeline behavior until/unless full vector clip parity is added.
- Other subsystem limits called out in the recovery plan (e.g. any remaining `markerLine` bridge gaps) should stay on the parity backlog until a follow-up pass.

---

## 12. Post-Recovery Re-Validation (2026-04-24, late night)

**Context:** After the regression-recovery execution note above, additional manual QA reports still showed critical failures:

1. PMTiles / advanced polygon+line styles still not rendering on GIS/projection.
2. Zoom contract still unstable (fractional display, +/- behavior drift, unstable handoff between remote movement and direct GIS interaction).

This section captures **new evidence-based root causes** from code archaeology and targeted checks.

### A) PMTiles source-layer contract mismatch (high confidence)

- PMTiles generation currently hardcodes tippecanoe output layer name to `layer` via `--layer=layer` in:
  - `scripts/otef_layer_processing/tiling.py`
- Runtime source-layer resolution in MapLibre falls back to `layerConfig.id` when manifest does not provide explicit `sourceLayer`/`source_layer`:
  - `frontend/src/map/maplibre-layer-manager.js` (`getVectorSourceLayerName`)
- Processed manifests include many `pmtilesFile` entries but (in sampled packs) no explicit `sourceLayer`, so runtime uses layer id fallback.

**Impact:** If PMTiles internals are `layer` while runtime requests `<layer id>`, MapLibre renders nothing and usually emits no useful console error. This explains “PMTiles/polygon layers do not render at all” on both GIS and projection (projection reuses the same registry-driven layer manager path).

### B) Advanced style coverage gaps still present (high confidence)

- `markerLine` is still intentionally unsupported in the bridge (`return null`):
  - `frontend/src/shared/maplibre-style-bridge.js`
- Real processed styles still contain `markerLine` symbols (example in `muniplicity_transport/styles.json`).
- When style layers resolve to empty or partially dropped results, manager rollback can leave no visible output for that layer.

**Impact:** Some advanced line symbology remains degraded or invisible even when data source is valid.

### C) Zoom contract mismatch across boundaries (high confidence)

- MapLibre sync reports raw fractional zoom into context:
  - `frontend/src/map/maplibre-viewport-sync.js` (`zoom: map.getZoom()`)
- Remote UI is still configured as integer-step control (`step="1"` in `remote-controller.html`) but currently displays and operates on fractional values end-to-end.
- Current remote zoom contract tests explicitly lock in fractional baseline behavior (`11.267 + 1 -> 12.267`), which conflicts with observed UX expectations.

**Impact:** Fractional zoom values leak into UI and command baseline, causing confusing +/- behavior and mismatch with the integer-slider mental model.

### D) Movement handoff instability: velocity guard + remote apply lock (medium-high confidence)

- Context blocks GIS-origin viewport updates during active remote interaction/velocity:
  - `frontend/src/shared/otef-data-context/OTEFDataContext-actions.js` (`interaction_guard`)
- MapLibre viewport sync also suppresses outbound reports while remote apply lock is active, and lock is repeatedly re-armed on incoming viewport updates:
  - `frontend/src/map/maplibre-viewport-sync.js`

**Impact:** Switching between d-pad/joystick movement and direct GIS pan can feel “crazy” (dropped/replayed/snap-back behavior), especially under continuous remote movement streams.

### Why this passed prior targeted tests

- Existing tests for zoom now codify fractional behavior as correct.
- Existing PMTiles tests validate fallback rules (`sourceLayer -> source_layer -> id`) but do not validate against the **actual tiling pipeline contract** (`--layer=layer`).

### Recommended Immediate Recovery Order (before new parity claims)

1. **Fix PMTiles source-layer contract** end-to-end (runtime + tests + manifest/tooling alignment).
2. **Reconcile zoom contract** (choose integer-control UX or full fractional UX; do not keep mixed mode).
3. **Stabilize movement handoff** between remote velocity and GIS direct interaction (guard/lock policy update).
4. **Address remaining advanced style bridge gaps** (`markerLine` path and any dropped-style fallback behavior).

Until these are closed with fresh manual QA, the regression-recovery section above should be treated as partially superseded by this re-validation.

---

## 13. Focused Fix Pass (2026-04-24, late night)

Following the post-recovery re-validation, a focused implementation pass was completed on the critical items:

1. **PMTiles source-layer contract hardening**
   - Runtime now prioritizes `sourceLayer`/`source_layer` and otherwise defaults to the tiling-contract layer name (`layer`) instead of guessing from layer id.
   - Tiling script now centralizes the same contract constant (`DEFAULT_TIPPECANOE_LAYER_NAME = "layer"`).
   - Result: removes the highest-risk silent empty-render mismatch for PMTiles-backed layers when manifests omit `sourceLayer`.

2. **Zoom UX contract (integer-step)**
   - Remote UI zoom behavior is now integer-normalized and clamped for slider/+/- interactions.
   - `+/-` now honors in-flight local intent (`pending/last requested`) to avoid under-accumulation under latency.
   - Result: user-facing zoom controls are predictable and step-based while backend/state flow remains compatible.

3. **Remote ↔ GIS handoff stabilization (guard softening)**
   - `interaction_guard` now treats velocity as active only when movement is effectively non-zero and fresh (stale/zero velocity no longer blocks GIS handoff unnecessarily).
   - Result: smoother transition from joystick/d-pad control to direct GIS interaction.

4. **Advanced style fallback for `markerLine`**
   - `markerLine` is no longer dropped by the bridge; it now renders via a pragmatic line fallback (including uniqueValue support).
   - Result: advanced line layers that previously disappeared now remain visible pending full symbol-placement parity.

### Verification evidence (fresh)

Command:
- `npm run test -- tests/remote/remote-zoom-control-contract.test.js tests/map/maplibre-layer-manager.test.js tests/map/maplibre-style-bridge.test.js tests/shared/otef-data-context-actions.test.js`

Result:
- **4 test files passed**
- **42 tests passed, 0 failed**

### Remaining validation gate

- Manual GIS/projection QA is still required for visual/runtime confirmation on:
  - PMTiles/advanced style rendering on real packs
  - zoom interaction feel across remote and direct GIS controls
  - end-to-end handoff behavior under live joystick/d-pad usage

---

## 14. MapLibre alignment — multi-value layers & projection geometry (2026-04-24, analysis)

**Status:** Root-cause analysis and discussion only — **no implementation claims** in this section. Evidence is from the current `otef-interactive` tree plus read-only exploration subagents and prior Codex rollout threads under `C:\Users\tuval\.codex\sessions\2026\04\24\` (parent `rollout-2026-04-24T23-09-47-019dc11c-ddb4-75e1-96ac-b80bfec12078`, explorers `019dc11e-20c9-72c0-bde3-3b9498bb808d` multi-value, `019dc11e-2111-7da2-affa-c6153885135a` projection).

### 14.1 Issue — “Multiple values” / oct7 combined or sister layers: only some classes render

**Symptom:** After PMTiles/polygons started rendering again, layers with **unique value** styling still show only a subset of classes on GIS and projection (including packs such as `october_7th` where “sister” or paired layers exist in product language).

**Architectural fact:** GIS and projection both use the same stack: `irToMapLibreLayers` in `frontend/src/shared/maplibre-style-bridge.js` and `applyLayerGroupsToMap` in `frontend/src/map/maplibre-layer-manager.js` (projection reuses it via `maplibre-projection-layers.js`). So a classification bug is **shared**, not GIS-only.

**Root-cause hypotheses (ranked by plausibility from code):**

1. **Case-sensitive `["get", field]` vs legacy case-insensitive property resolution**  
   MapLibre paint uses `["match", ["get", field], ...]` with the style JSON field name verbatim (`maplibre-style-bridge.js` around the `buildMatchExpr` loop). The legacy Canvas path in `AdvancedStyleEngine._resolveStyleSymbol` resolves the same field with a **case-insensitive** key search on feature properties. If PMTiles or GeoJSON uses `Field` vs `field`, legacy could style correctly while MapLibre always falls through to the default branch.

2. **Entries dropped when a class symbol omits a paint path**  
   `buildMatchExpr` skips any class whose `toValue(entry.symbolLayer)` is `undefined` (see the `entryValue === undefined` guard). Those attribute values never receive a `match` arm and collapse to the fallback — visually “only some values” match the legend.

3. **Per-`groupKey` gaps when class `symbolLayers` do not mirror `defaultSymbol` slots**  
   `buildUniqueValueGroups` seeds groups from `defaultSymbol.symbolLayers`, then only pushes class entries for symbol layers that exist **on that class**. A category that only defines stroke on one slot may never register on the fill group’s `match`, so fills show default for that category while another slot looks correct.

4. **Type / string mismatch on the classification field**  
   `match` compares feature property values to class `value` as provided. Number vs string vs null in tiles vs `styles.json` causes silent fallthrough to default for non-matching types.

5. **Duplicate class keys**  
   Legacy `_getUniqueValueSymbolMap` uses `Map.set` (last writer wins). MapLibre `match` is first-label-wins for duplicate labels. Inconsistent ordering between engines can make “which value wins” differ.

6. **Whole-layer rollback** (less often “partial classes,” but worth ruling out)  
   If any `map.addLayer` throws, `maplibre-layer-manager` rolls back the entire `fullId` add. That tends to drop a whole layer, not a subset of attribute values.

**October 7th “combined” rows (geometry siblings):** The product merges layers that share the same **base name** and differ only by Hebrew **geometry suffix** — polygon `אזור`, point `נקודה`, line `ציר` — see `parseLayerNameWithGeometrySuffix` in `frontend/src/shared/layer-name-utils.js`. The **remote sheet** (`layer-sheet-controller.js` `groupLayersByNameForSheet`) and **GIS legend** (`legend-model-builder.js` `groupLayersByName`) concatenate `fullLayerIds` / legend **items** into one UI row. The **map** still loads each `october_7th.<layerId>` separately (`maplibre-layer-manager.js`). So missing “types” (line vs point) usually means **one sibling failed to mount** (no PMTiles URL, source-layer resolution, GeoJSON URL, or `addLayer` rollback), not a single broken `match`. Missing “values” within one geometry is more often **style bridge / tile property** alignment (same as other packs). Hyphen vs underscore **id** variants (glossary + manifest) are separate from suffix merging.

### 14.2 Issue — Projection skew vs model base; highlight vs GIS viewport drift that grows with pan/zoom

**Symptom (two parts):** (a) Map content feels **slightly skewed** relative to the physical model base image. (b) The **CSS highlight** rectangle vs what the GIS MapLibre map shows diverges, and the gap **grows** as the user pans and zooms — feels unlike classic WS lag.

**How the two surfaces compute “the viewport”:**

- **GIS MapLibre camera:** Remote ITM bbox `[west, south, east, north]` is converted to WGS84 using **only the SW and NE ITM corners** via proj4, then `map.fitBounds([[west,south],[east,north]])`, and when zoom is explicit, **`setZoom` is applied after `fitBounds`** because `fitBounds` alone may pick a different zoom (`maplibre-viewport-sync.js`).

- **Projection highlight:** The shipped `projection.html` path uses `updateHighlightFromViewport` in `maplibre-projection.js`, which maps the **same ITM bbox** linearly to **CSS pixels** of the overlay container using `modelBounds.itm` extents — **no** Web Mercator, **no** four-corner hull, **no** rotation on the highlight box.

- **Projection MapLibre stack:** The vector overlay map is initialized with `fitBounds(modelBounds.bounds)` in WGS84 and can carry **`bearing`** from `viewer_angle_deg` (`createProjectionMap` / `projection-main.js`). Vectors rotate with the map; the model photograph and the axis-aligned highlight do not.

**Root-cause hypotheses (ranked):**

1. **`fitBounds` + subsequent `setZoom` decouples the visible extent from the stored ITM bbox**  
   Stored state still describes one geographic rectangle, but the camera after `setZoom` may show a **different** ground footprint than that rectangle. The highlight faithfully follows **stored** bbox, so error **accumulates with zoom** — this matches “not just sync lag.”

2. **ITM axis-aligned box → two-corner proj4 → axis-aligned lon/lat `fitBounds` is geometrically approximate**  
   For a rectangle aligned in EPSG:2039, projecting only SW and NE corners to WGS84 and taking min/max does not generally equal the hull of **all four** corners in geographic coordinates. That introduces a **small systematic skew** vs pure ITM linear mapping (what the highlight uses).

3. **Bearing / `object-fit: fill` vs linear ITM scaling**  
   Non-zero **bearing** on the projection MapLibre map rotates rendered vectors relative to the model image; the highlight is a non-rotated `div`. **`object-fit: fill`** on the model image can stretch the photograph if its aspect ratio does not match the ITM aspect implied by `model-bounds.json`, producing a **constant** “skew” between photo and geometry even when highlight math is self-consistent.

4. **Zoom semantics: ITM half-width scaling in actions vs MapLibre zoom**  
   Remote zoom updates scale the ITM bbox in meters with `2^(-Δzoom)` in context actions; MapLibre zoom is tied to Web Mercator pyramid levels. Combined with (1), bbox and camera can drift apart as zoom changes.

**Legacy note:** `projection-display.js` contains alternate highlight/quad logic; the current entrypoint contract tests expect `projection-main.js` + MapLibre projection — do not assume legacy paths run on the shipped page.

### 14.3 Perspective ensemble (decision support)

#### Panel A — Council

- **Data contract vs renderer:** Unique-value styling is extremely sensitive to field names, types, and per-class symbol completeness. Fixing “missing classes” is as much **manifest/style QA** as it is bridge code.
- **Single source of truth for viewport:** Today, highlight uses ITM-linear pixels while GIS uses ITM→two-point WGS84→`fitBounds`→optional `setZoom`. Unifying on **one** transform (e.g. four-corner ITM→lngLat hull + single camera update, or drive highlight from `map.getBounds()` after apply) reduces permanent drift.
- **Photo vs map:** Separating “model image stretch” from “map projection” avoids chasing the wrong fix — measure aspect ratio of `model-bounds` ITM span vs image native ratio before changing geodesy.
- **Ship vs rigor:** A quick guard (`coalesce`, `to-string` in expressions, or normalizing property keys at tile build) may restore classes fast; a full fix may require tippecanoe/postprocess to emit consistent property schemas.

#### Panel B — Adversarial (red cell)

- **Attack target:** The assumption that `fitBounds`+`setZoom` preserves equality between `viewport.bbox` and the GIS camera footprint.
- **Vector — silent class collapse:** If `allMatchFallback` becomes true in `buildMatchExpr`, the bridge returns a **constant** paint — every feature looks like one class while the UI still lists many; debugging looks like “random missing values.”
- **Vector — bearing without highlight rotation:** Operators calibrate on the highlight; if vectors rotate under `bearing` but the highlight does not, reports will always say “skew” no matter how good sync is.
- **Vector — two-corner bbox:** An adversarial GIS viewport could be rotated in the future; the two-corner shortcut becomes arbitrarily wrong — today it is a latent footgun.

**Strongest line of attack:** For growing mismatch, **`setZoom` after `fitBounds` without updating stored bbox to the camera’s true ground bounds** guarantees divergence between highlight (bbox-driven) and GIS (camera-driven). That is structural, not network jitter.

**Falsifiers / cheap tests**

- **Multi-value:** Log `Object.keys(feature.properties)` for one affected tile layer vs `uniqueValues.field`; dump `classes[].value` types. If case or type mismatches appear, hypothesis (1)/(4) is confirmed.
- **Projection:** Temporarily **disable** post-`fitBounds` `setZoom` on GIS and see if highlight-vs-map divergence stops growing with zoom.
- **Projection:** Set `bearing` to 0 and replace `object-fit: fill` with `contain` temporarily — if “skew” disappears, it is (3) not geodesy.

### 14.4 Recommended discussion order before coding

1. Confirm on a failing layer: **property key case**, **types**, and whether **each class** defines all `symbolLayers` slots present on `defaultSymbol`.
2. Decide viewport contract: either **remove `setZoom` override** when bbox is authoritative, **recompute bbox from `map.getBounds()`** after camera settle, or **project four ITM corners** to WGS84 for `fitBounds`.
3. Decide visual contract: should the **highlight rotate** with `viewer_angle_deg`, or should **bearing** be forced to 0 for projection MapLibre when aligning to a static table model?

**Verification reminder (per project rule):** Any future fix PR must attach **fresh** test or manual evidence; this section does not assert that tests were run for these hypotheses.
