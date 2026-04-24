# MapLibre Migration: Bug Fixes & Feature Parity Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all active bugs from the initial MapLibre migration and achieve visual/functional parity with the pre-migration Leaflet+Canvas system.

**Architecture:** The MapLibre migration (7 commits) replaced Leaflet with MapLibre GL JS on both GIS and projection pages. The style bridge translates the existing AdvancedStyleEngine IR into MapLibre style layers. This plan fixes bugs in that translation, restores projection page behavior, adds GIS-layer filtering, ports curated layer rendering, adds hatch fill patterns, and implements flow animations.

**Tech Stack:** MapLibre GL JS 5.x, PMTiles 4.x, proj4, Vite (bundler), Vitest (tests)

**Branch:** `sync_and_layers_performance` (continue on current branch, no worktrees)

---

## File Structure

### Files to create:
- `otef-interactive/frontend/src/map/maplibre-curated-layer-loader.js` — NEW: MapLibre equivalent of `leaflet-curated-layer-loader.js` (pink line overlay + curated layers)
- `otef-interactive/frontend/src/shared/maplibre-flow-animation.js` — NEW: flow animation controller

### Files to modify:
- `otef-interactive/frontend/src/shared/maplibre-style-bridge.js` — fix undefined in match expressions, add hatch pattern support
- `otef-interactive/frontend/src/projection/maplibre-projection.js` — fix static viewport
- `otef-interactive/frontend/src/entries/map-main.js` — add GIS layer filtering, wire curated/pink line loading
- `otef-interactive/frontend/src/entries/projection-main.js` — wire curated/pink line loading + Supabase heartbeat
- `otef-interactive/frontend/src/map/maplibre-layer-manager.js` — curated GeoJSON helpers, skip curated in registry path, handle image layers
- `otef-interactive/frontend/src/projection/maplibre-projection-layers.js` — curated + image layer handling for projection

### Files to read (reference only — renderer-agnostic pipeline, DO NOT modify):
- `otef-interactive/frontend/src/map/leaflet-curated-layer-loader.js` — the Leaflet original (748 lines), reference for porting
- `otef-interactive/frontend/src/map/pink-curated-overlay-plan.js` — renderer-agnostic overlay planner
- `otef-interactive/frontend/src/map-utils/pink-route-map-styles.js` — Leaflet style defs → MapLibre paint translation reference
- `otef-interactive/frontend/src/map-utils/pink-line-route.js` — route building (shared)
- `otef-interactive/frontend/src/map-utils/colab-route-geometry-bundle.js` — bundle parsing (shared)
- `otef-interactive/frontend/src/map/leaflet-curated-pink-helpers.js` — pure helpers (shared, despite "leaflet" in name)
- `otef-interactive/frontend/src/shared/curated-layer-service.js` — curated data fetch (shared)
- `otef-interactive/frontend/src/shared/curated-supabase-heartbeat.js` — heartbeat sync (shared)
- `otef-interactive/frontend/src/map/map-curated-supabase-sync.js` — curated sync flow (shared)
- `otef-interactive/frontend/src/shared/gis-layer-filter.js` — existing filter logic
- `otef-interactive/public/processed/layers/land_use/styles.json` — sample style data with unique values
- `otef-interactive/public/processed/layers/projector_base/manifest.json` — projector base layers

---

## Task 1: Fix Style Bridge `undefined` in Match Expressions

**Files:**
- Modify: `otef-interactive/frontend/src/shared/maplibre-style-bridge.js`

**Problem:** `buildUniqueValueGroups` indexes symbol layers by position. When a class's symbol has symbolLayers at different indices or types than the default (e.g., default `[fill@0, stroke@1]` but class `[stroke@0, fill@1, fill@2, fill@3]`), `buildMatchLayer` receives a wrong-type default symbol layer. `getNestedProp(fillSymbol, "width")` returns `undefined`, which MapLibre rejects.

**Root cause trace:** For layer "חניון" (land_use pack):
- Default symbol: `[{type:"fill"}, {type:"stroke"}]` (indices 0,1)
- Class "870" symbol: `[{type:"stroke"}, {type:"fill"}, {type:"fill"}, {type:"fill"}]` (indices 0,1,2,3)
- `buildUniqueValueGroups` creates group `line__0` from class index 0, then `buildUniqueValueLayers` does `defaultSymbolLayers[0]` which is the fill type — wrong type for a line group.

**Fix strategy:** In `buildMatchExpr`, when `fallback` is `undefined` or `null`, and the expression would contain undefined entries, produce a safe fallback. Also in `buildUniqueValueLayers`, prefer `group.sampleSymbolLayer` when `defaultSymbolLayers[group.index]` has a mismatched type.

- [ ] **Step 1: Fix `buildUniqueValueLayers` to use type-appropriate default**

In `maplibre-style-bridge.js`, modify `buildUniqueValueLayers` to check that the default symbol layer at the group's index matches the group's type. If not, use `group.sampleSymbolLayer`:

```javascript
function buildUniqueValueLayers(idBase, uniqueValues, defaultSymbol) {
  const field = uniqueValues?.field;
  if (!field) return buildSimpleLayers(idBase, defaultSymbol);

  const defaultSymbolLayers = Array.isArray(defaultSymbol?.symbolLayers) ? defaultSymbol.symbolLayers : [];
  const groups = buildUniqueValueGroups(uniqueValues, defaultSymbol);
  const output = [];

  for (const [groupKey, group] of Object.entries(groups)) {
    const candidateDefault = defaultSymbolLayers[group.index];
    const candidateType = getMapLibreType(candidateDefault);
    const defaultSymbolLayer =
      candidateType === group.type ? candidateDefault : group.sampleSymbolLayer;
    const layer = buildMatchLayer(
      `${idBase}__${groupKey}`,
      group.type,
      field,
      group.entries,
      defaultSymbolLayer
    );
    if (layer) output.push(layer);
  }

  return output;
}
```

- [ ] **Step 2: Add safety net in `buildMatchExpr` for undefined values**

Add a guard so that if `fallback` is still `undefined` after resolution, the function returns `undefined` to the caller. The caller (`buildMatchLayer`) must then handle the missing property by omitting it or using a type-aware default. MapLibre rejects both `undefined` AND `null` as values in typed paint properties like `line-width` or `line-color`.

```javascript
function buildMatchExpr(field, entries, defaultSymbolLayer, propPath, transform) {
  // ... existing code ...
  const fallback = toValue(defaultSymbolLayer);

  // If no fallback and no entries have values, skip this property entirely
  if (fallback === undefined) {
    const anyDefined = entries.some(e => toValue(e?.symbolLayer) !== undefined);
    if (!anyDefined) return undefined;
  }

  const expression = ["match", ["get", field]];
  let allMatchFallback = true;

  for (const entry of entries) {
    if (entry?.value == null) continue;
    const entryValue = toValue(entry.symbolLayer);
    const resolvedValue = entryValue ?? fallback;
    if (resolvedValue === undefined) continue; // skip entries with no resolvable value
    if (!valuesEqual(resolvedValue, fallback)) allMatchFallback = false;
    expression.push(entry.value, toExpressionValue(resolvedValue));
  }

  // If fallback is still undefined, use type-aware defaults
  // (null is NOT valid for MapLibre typed paint properties)
  if (fallback === undefined) {
    // Don't emit a broken expression — return undefined so caller can omit the property
    if (expression.length <= 3) return undefined;
    // If we have entries but no default, use the first entry's value as fallback
    const firstEntryValue = entries.find(e => toValue(e?.symbolLayer) !== undefined);
    const emergencyFallback = firstEntryValue ? toValue(firstEntryValue.symbolLayer) : undefined;
    if (emergencyFallback === undefined) return undefined;
    expression.push(toExpressionValue(emergencyFallback));
  } else {
    expression.push(toExpressionValue(fallback));
  }

  if (expression.length <= 3 || allMatchFallback) return fallback;
  return expression;
}
```

Then in `buildMatchLayer`, handle `undefined` returns by omitting the property:

```javascript
// In buildMatchLayer for "line" type:
const lineWidth = buildMatchExpr(field, entries, defaultSymbolLayer, "width");
if (lineWidth !== undefined) {
  paint["line-width"] = lineWidth;
} else {
  paint["line-width"] = 1; // safe fallback
}
```

- [ ] **Step 2b: Add test case for the type-mismatch scenario**

In `tests/map/maplibre-style-bridge.test.js`, add a test using the "חניון" symbol structure (default `[fill@0, stroke@1]`, class `[stroke@0, fill@1, fill@2, fill@3]`) and assert no `undefined` values appear in generated paint properties.

- [ ] **Step 3: Verify the fix by running the dev server and checking affected layers**

Run: `npm run dev:frontend` from `otef-interactive/frontend`
Expected: Layers `חניון`, `כרייה_וחציבה`, `מתקני_הנדסה`, `ספורט`, `תחבורה`, `מימושים`, `מתחמי_דיור` load without `undefined value invalid` errors in console.

- [ ] **Step 4: Commit**

```bash
git add otef-interactive/frontend/src/shared/maplibre-style-bridge.js
git commit -m "fix(otef): resolve undefined values in style bridge match expressions

buildUniqueValueGroups indexed symbolLayers by position, causing type
mismatches when class symbols differ from defaults. Now uses
type-appropriate defaults and sanitizes undefined fallbacks."
```

---

## Task 2: Fix Projection Static Viewport (Map Should Not Move)

**Files:**
- Modify: `otef-interactive/frontend/src/projection/maplibre-projection.js`
- Modify: `otef-interactive/frontend/src/entries/projection-main.js`

**Problem:** The projection page should show the full model at all times. Only the CSS highlight overlay should move when the GIS viewport changes. Currently `updateProjectionViewport` calls `map.fitBounds` on every viewport update, physically moving the projection map.

- [ ] **Step 1: Remove viewport-driven map movement from projection-main.js**

In `projection-main.js`, the viewport subscription currently calls both `updateProjectionViewport` (moves map) and `updateHighlightFromViewport` (moves highlight). Remove the `updateProjectionViewport` call:

```javascript
// In the map.on("load") handler:

// Initial highlight (no map movement)
lastViewport = OTEFDataContext.getViewport();
if (lastViewport) {
  updateHighlightFromViewport(lastViewport, modelBounds, highlightEl);
}

registerDisposer(
  OTEFDataContext.subscribe("viewport", (viewport) => {
    lastViewport = viewport;
    updateHighlightFromViewport(viewport, modelBounds, highlightEl);
  }),
);
```

Also remove `updateProjectionViewport` from the import statement since it's no longer needed.

- [ ] **Step 2: Ensure projection map stays at model bounds after initial load**

The `createProjectionMap` already does `map.fitBounds(modelBounds.bounds, { animate: false, padding: 0 })`. Verify that `interactive: false` prevents user interaction from moving the map. This is already set — no code change needed, just verify.

- [ ] **Step 3: Commit**

```bash
git add otef-interactive/frontend/src/entries/projection-main.js
git commit -m "fix(otef): keep projection map static, only highlight overlay moves

Removed updateProjectionViewport from viewport subscription — the
projection map should show the full model at all times. Only the CSS
highlight rectangle updates on viewport changes."
```

---

## Task 3: Filter Projector Base Layers from GIS Page

**Files:**
- Modify: `otef-interactive/frontend/src/entries/map-main.js`

**Problem:** `map-main.js` passes raw `OTEFDataContext.getLayerGroups()` to `applyLayerGroupsToMap` without filtering. Layers like `projector_base.רקע_שחור`, `projector_base.SEA`, `projector_base.model_base`, `projector_base.satellite_imagery` appear on GIS even though they're projection-only.

The filter already exists: `gis-layer-filter.js` exports `filterGroupsForGisMap` which removes `projector_base.*` (except `Tkuma_Area_LIne`), WMTS layers, and hidden-legend layers.

- [ ] **Step 1: Import and apply the GIS filter in map-main.js**

Add the import:
```javascript
import { filterGroupsForGisMap } from "../shared/gis-layer-filter.js";
```

Then wrap all calls to `applyLayerGroupsToMap` to filter first:

```javascript
// In map.on("load"):
const layerGroups = OTEFDataContext.getLayerGroups();
applyLayerGroupsToMap(map, filterGroupsForGisMap(layerGroups));

// In subscription:
registerDisposer(
  OTEFDataContext.subscribe("layerGroups", (groups) => {
    applyLayerGroupsToMap(map, filterGroupsForGisMap(groups));
  }),
);
```

Also update `refreshCuratedLayers` to apply the filter:
```javascript
const refreshCuratedLayers = ({ affectedCuratedFullLayerIds } = {}) => {
  const currentGroups = filterGroupsForGisMap(OTEFDataContext.getLayerGroups());
  // ... rest stays the same but uses currentGroups
};
```

- [ ] **Step 2: Commit**

```bash
git add otef-interactive/frontend/src/entries/map-main.js
git commit -m "fix(otef): filter projection-only layers from GIS page

Import filterGroupsForGisMap and apply it before passing layer groups
to applyLayerGroupsToMap. Projector base layers (רקע_שחור, SEA,
model_base, satellite_imagery) no longer appear on GIS."
```

---

## Task 4: Curated Pink Line & Layer Rendering on GIS via MapLibre

**Files:**
- Create: `otef-interactive/frontend/src/map/maplibre-curated-layer-loader.js` — MapLibre equivalent of `leaflet-curated-layer-loader.js`
- Modify: `otef-interactive/frontend/src/map/maplibre-layer-manager.js` — add curated GeoJSON helpers + skip curated in registry path
- Modify: `otef-interactive/frontend/src/entries/map-main.js` — wire curated loading

**Problem:** Curated layer IDs (e.g., `curated_moresht_axis.16`) are not in the layer registry. The old `leaflet-curated-layer-loader.js` handled all Leaflet-specific rendering. With MapLibre, we need a new loader that:
1. Uses the same renderer-agnostic data pipeline (fetch, route building, overlay planning)
2. Materializes draw operations as MapLibre sources + layers instead of Leaflet elements
3. Handles the pink line base layer, proposed routes, removed/ghost routes, offroad connectors, node markers, and memorial icons
4. Integrates with Supabase heartbeat for real-time updates

**Key architectural insight:** `planPinkCuratedOverlayLayers()` in `pink-curated-overlay-plan.js` is already renderer-agnostic — it returns ordered draw ops (`{kind: "polyline", styleKey, latLngs}` and `{kind: "circleMarker", latLng}`). `routeLineStylesForDisplayColor()` returns style objects (color, weight, opacity, dashArray) that map directly to MapLibre paint properties. Only the final materialization step (currently in `leaflet-curated-layer-loader.js`) needs a MapLibre equivalent.

**Coordinate system note:** The overlay plan uses Leaflet `[lat, lng]` format. MapLibre GeoJSON needs `[lng, lat]`. All coordinates must be flipped at the materialization boundary.

- [ ] **Step 1: Add curated layer helpers to maplibre-layer-manager.js**

Add helper functions for adding/removing/updating curated GeoJSON layers that bypass the registry:

```javascript
export function addCuratedGeoJsonSource(map, sourceId, geojsonData) {
  if (map.getSource(sourceId)) {
    const source = map.getSource(sourceId);
    if (typeof source.setData === "function") {
      source.setData(geojsonData);
    }
    return;
  }
  map.addSource(sourceId, { type: "geojson", data: geojsonData });
}

export function removeCuratedLayer(map, fullId) {
  const state = getOrCreateMapState(map);
  removeFullIdFromMap(map, fullId, state);
}

export function removeCuratedLayersByPrefix(map, prefix) {
  const state = getOrCreateMapState(map);
  const toRemove = [...state.loadedSources.keys()].filter(id => id.startsWith(prefix));
  for (const fullId of toRemove) {
    removeFullIdFromMap(map, fullId, state);
  }
}

export function registerCuratedLayerIds(map, fullId, sourceId, layerIds) {
  const state = getOrCreateMapState(map);
  state.loadedSources.set(fullId, sourceId);
  state.loadedLayerIds.set(fullId, layerIds);
}
```

Also add the curated skip in `addLayerToMap`:
```javascript
if (!layerConfig && fullId.startsWith("curated")) {
  return; // Curated layers managed via maplibre-curated-layer-loader
}
```

- [ ] **Step 2: Create `maplibre-curated-layer-loader.js`**

This is the MapLibre equivalent of `leaflet-curated-layer-loader.js`. It reuses the entire renderer-agnostic pipeline. Key components:

**Imports** (all renderer-agnostic, already existing):
```javascript
import { UI_CONFIG } from "../config/ui-config.js";
import {
  fetchCuratedLayerData, extractPointFeatures, extractPinkDetourPointFeatures,
  fetchPinkLinePaths, getMemorialIconForFeature, resolvePinkLinePackStyleBundle,
} from "../shared/curated-layer-service.js";
import { buildIntegratedRoute } from "../map-utils/pink-line-route.js";
import {
  colabBundleHasDetourPaint, colabBundleHasRenderableGeometry, parseColabRouteGeometryBundle,
} from "../map-utils/colab-route-geometry-bundle.js";
import { assignPinkNodeDisplayOrders } from "../map-utils/pink-route-optimizer.js";
import {
  STORED_PINK_ROUTE_OFFROAD_GAP_METERS, routeLineStylesForDisplayColor,
} from "../map-utils/pink-route-map-styles.js";
import {
  clipProposedPathsLatLngExcludingOffroadGaps, collectOffroadJunctionLatLngs,
  findOffroadTwoPointSegments, parsePinkLineRouteFromGeojson, resolveFirstDisplayColorFromGeojson,
  sanitizeDisplayColorHex,
} from "./leaflet-curated-pink-helpers.js";
import { planPinkCuratedOverlayLayers } from "./pink-curated-overlay-plan.js";
import { readPinkNodeOrder } from "../map-utils/pink-node-order.js";
import {
  addCuratedGeoJsonSource, registerCuratedLayerIds, removeCuratedLayersByPrefix,
} from "./maplibre-layer-manager.js";
import MapProjectionConfig from "../shared/map-projection-config.js";
```

**Coordinate flip helper** (overlay plan uses `[lat, lng]`, MapLibre needs `[lng, lat]`):
```javascript
function latLngToCoord([lat, lng]) { return [lng, lat]; }
```

**Style translation** (Leaflet polyline options → MapLibre paint/layout):
```javascript
function leafletStyleToMapLibrePaint(style) {
  const paint = {
    "line-color": style.color || "#FF69B4",
    "line-width": style.weight || 3,
    "line-opacity": style.opacity ?? 0.9,
  };
  if (style.dashArray) {
    paint["line-dasharray"] = style.dashArray.split(/[\s,]+/).map(Number);
  }
  return paint;
}
function leafletStyleToMapLibreLayout(style) {
  const layout = {};
  if (style.lineCap) layout["line-cap"] = style.lineCap;
  if (style.lineJoin) layout["line-join"] = style.lineJoin;
  return layout;
}
```

**Pink line base layer** (`ensurePinkLineBaseLayer` / `removePinkLineBaseLayer`):
- Fetches base paths via `fetchPinkLinePaths()` and style via `resolvePinkLinePackStyleBundle()`
- When `removedPaths` are present, removes the base layer (Colab parity: base is omitted when heritage is clipped)
- Creates GeoJSON source `pink_line_base` with line layer `pink_line_base__line`
- Coordinates flipped from `[lat,lng]` to `[lng,lat]`

**Main loader function** `loadCuratedLayerToMapLibre(map, fullLayerId, opts)`:
1. Calls `fetchCuratedLayerData(fullLayerId)` — same data fetch as Leaflet
2. CRS normalization (ITM → WGS84) — same as Leaflet
3. Point/detour extraction — same as Leaflet
4. Route computation (bundle path or `buildIntegratedRoute`) — same as Leaflet
5. Style computation (`routeLineStylesForDisplayColor`) — same as Leaflet
6. Overlay plan via `planPinkCuratedOverlayLayers` — same as Leaflet
7. **Materialization** (THIS IS THE ONLY DIFFERENT PART):
   - Groups polyline ops by `styleKey` → one GeoJSON source + line layer per styleKey
   - Circle marker ops → one GeoJSON point source + circle layer
   - Node markers (numbered pink nodes) → MapLibre `Marker` with custom HTML element (same HTML as Leaflet `divIcon`)
   - Memorial icon markers → MapLibre `Marker` with custom HTML element

**HTML marker cleanup**: Side-map `_htmlMarkersByLayer` tracks MapLibre `Marker` instances per curated layer for removal.

**Fallback for non-pink curated layers**: Simple GeoJSON source + line/fill/circle layers with curated color.

The implementer should reference `leaflet-curated-layer-loader.js` (748 lines) line-by-line. The data pipeline code (steps 1-6) is nearly identical — only the Leaflet `L.layerGroup`, `L.polyline`, `L.marker`, `L.circleMarker`, `L.divIcon` calls need replacement.

- [ ] **Step 3: Wire curated loading into map-main.js**

Replace `refreshCuratedLayers` to use the new MapLibre loader:

```javascript
import { loadCuratedLayerToMapLibre, removeCuratedHtmlMarkers } from "../map/maplibre-curated-layer-loader.js";
import { removeCuratedLayersByPrefix } from "../map/maplibre-layer-manager.js";

const refreshCuratedLayers = async ({ affectedCuratedFullLayerIds } = {}) => {
  const groups = filterGroupsForGisMap(OTEFDataContext.getLayerGroups());
  if (!Array.isArray(groups)) return;
  for (const group of groups) {
    if (!group.id?.startsWith("curated")) continue;
    for (const layer of group.layers || []) {
      const fullId = `${group.id}.${layer.id}`;
      const isAffected = !affectedCuratedFullLayerIds ||
        affectedCuratedFullLayerIds.length === 0 ||
        affectedCuratedFullLayerIds.includes(fullId);
      if (!isAffected) continue;
      if (layer.enabled) {
        try { await loadCuratedLayerToMapLibre(map, fullId, { force: true }); }
        catch (e) { console.warn(`[map-main] curated load failed: ${fullId}`, e); }
      } else {
        removeCuratedLayersByPrefix(map, fullId);
        removeCuratedHtmlMarkers(fullId);
      }
    }
  }
};
```

Wire initial load:
```javascript
// In map.on("load"):
await loadCuratedLayersToMap(map);

async function loadCuratedLayersToMap(map) {
  const groups = OTEFDataContext.getLayerGroups();
  if (!Array.isArray(groups)) return;
  for (const group of groups) {
    if (!group.id?.startsWith("curated")) continue;
    for (const layer of group.layers || []) {
      if (!layer.enabled) continue;
      const fullId = `${group.id}.${layer.id}`;
      try { await loadCuratedLayerToMapLibre(map, fullId); }
      catch (e) { console.warn(`[map-main] curated load failed: ${fullId}`, e); }
    }
  }
}
```

The `map-curated-supabase-sync.js` → `reloadCuratedOnMap` → `refreshCuratedLayers` flow remains the same — only the final rendering step changes.

- [ ] **Step 4: Commit**

```bash
git add otef-interactive/frontend/src/map/maplibre-curated-layer-loader.js \
       otef-interactive/frontend/src/map/maplibre-layer-manager.js \
       otef-interactive/frontend/src/entries/map-main.js
git commit -m "feat(otef): port curated pink line overlay to MapLibre

Create maplibre-curated-layer-loader.js as MapLibre equivalent of
leaflet-curated-layer-loader.js. Reuses renderer-agnostic data pipeline
(curated-layer-service, buildIntegratedRoute, planPinkCuratedOverlayLayers,
routeLineStylesForDisplayColor). Pink line base, proposed routes,
removed/ghost routes, offroad connectors, node markers, and memorial
icons all render via MapLibre sources+layers and HTML markers.
Curated layers update via Supabase heartbeat flow."
```

---

## Task 5: Curated Pink Line & Layer Rendering on Projection via MapLibre

**Files:**
- Modify: `otef-interactive/frontend/src/entries/projection-main.js`
- Modify: `otef-interactive/frontend/src/projection/maplibre-projection-layers.js`

**Problem:** The old projection curated pipeline (via `projection-curated-layer-load.js` and `projection-pink-line-canvas.js`) fetched GeoJSON, built integrated routes, and drew to the Canvas 2D renderer. The Canvas renderer is now a no-op shim. The pink line route overlay must render via MapLibre on the projection page — including the pink line base, proposed routes, removed/ghost routes, offroad connectors, node labels, and memorial icons.

**Approach:** Reuse `loadCuratedLayerToMapLibre` from Task 4's `maplibre-curated-layer-loader.js`. The loader is already map-instance agnostic — it takes a `map` parameter. For projection, pass the projection MapLibre instance. The only projection-specific concern is that node markers with HTML content (MapLibre `Marker` instances) should work identically. Wire Supabase heartbeat for real-time updates.

**Note on projection-pink-line-canvas.js:** The old file rendered the pink line on the Canvas 2D overlay (rotation + stroke shadow effects). With MapLibre, line layers handle this natively. The old canvas code does NOT need porting — `loadCuratedLayerToMapLibre` creates equivalent MapLibre layers.

- [ ] **Step 1: Wire curated loading into projection-main.js**

```javascript
import { loadCuratedLayerToMapLibre, removeCuratedHtmlMarkers } from "../map/maplibre-curated-layer-loader.js";
import { removeCuratedLayersByPrefix } from "../map/maplibre-layer-manager.js";

async function loadProjectionCuratedLayers(map) {
  const groups = OTEFDataContext.getLayerGroups();
  if (!Array.isArray(groups)) return;
  for (const group of groups) {
    if (!group.id?.startsWith("curated")) continue;
    for (const layer of group.layers || []) {
      if (!layer.enabled) continue;
      const fullId = `${group.id}.${layer.id}`;
      try { await loadCuratedLayerToMapLibre(map, fullId); }
      catch (e) { console.warn(`[projection-main] curated load failed: ${fullId}`, e); }
    }
  }
}

const refreshProjectionCuratedLayers = async ({ affectedCuratedFullLayerIds } = {}) => {
  const groups = OTEFDataContext.getLayerGroups();
  if (!Array.isArray(groups)) return;
  for (const group of groups) {
    if (!group.id?.startsWith("curated")) continue;
    for (const layer of group.layers || []) {
      const fullId = `${group.id}.${layer.id}`;
      const isAffected = !affectedCuratedFullLayerIds ||
        affectedCuratedFullLayerIds.length === 0 ||
        affectedCuratedFullLayerIds.includes(fullId);
      if (!isAffected) continue;
      if (layer.enabled) {
        try { await loadCuratedLayerToMapLibre(map, fullId, { force: true }); }
        catch (e) { console.warn(`[projection-main] curated reload failed: ${fullId}`, e); }
      } else {
        removeCuratedLayersByPrefix(map, fullId);
        removeCuratedHtmlMarkers(fullId);
      }
    }
  }
};
```

- [ ] **Step 2: Wire Supabase heartbeat for projection curated sync**

```javascript
// After map.on("load"):
try {
  const { startCuratedSupabaseHeartbeat } = await import("../shared/curated-supabase-heartbeat.js");
  const stopHeartbeat = startCuratedSupabaseHeartbeat({
    table: "otef",
    onUpdated: async () => { await refreshProjectionCuratedLayers(); },
  });
  registerDisposer(stopHeartbeat);
} catch (e) {
  console.warn("[projection-main] Curated heartbeat not available:", e);
}

// Initial curated load
await loadProjectionCuratedLayers(map);
```

Wire into layer groups subscription:
```javascript
registerDisposer(
  OTEFDataContext.subscribe("layerGroups", () => {
    syncProjectionLayers(map, getEffectiveProjectionLayerGroups());
    loadProjectionCuratedLayers(map);
  }),
);
```

- [ ] **Step 3: Commit**

```bash
git add otef-interactive/frontend/src/entries/projection-main.js \
       otef-interactive/frontend/src/projection/maplibre-projection-layers.js
git commit -m "feat(otef): port curated pink line to projection MapLibre

Reuse maplibre-curated-layer-loader for projection page. Wire Supabase
heartbeat for real-time curated layer updates. Pink line base, proposed
routes, ghost routes, offroad connectors, and node markers render via
MapLibre on projection."
```

---

## Task 6: Hatch Fill Pattern Support

**Files:**
- Modify: `otef-interactive/frontend/src/shared/maplibre-style-bridge.js`

**Problem:** The style IR has `fillType: "hatch"` with properties like `hatch.color`, `hatch.rotation`, `hatch.separation`, `hatch.width`. The style bridge currently ignores `fillType` and uses the `color` property as a solid fill, which produces wrong colors.

**Approach:** MapLibre supports `fill-pattern` with image names. We can generate hatch pattern images at runtime using a small canvas and add them to the map's sprite via `map.addImage`. The style bridge needs to output `fill-pattern` references, and the layer manager needs to ensure the patterns are registered.

- [ ] **Step 1: Add hatch pattern image generation**

Add a function to `maplibre-style-bridge.js` that generates a **deterministic** pattern name for a hatch config (to avoid memory leaks from non-deterministic IDs on repeated syncs):

```javascript
function buildHatchPatternSpec(hatchConfig) {
  if (!hatchConfig) return null;
  const color = hatchConfig.color || "#808080";
  const rotation = hatchConfig.rotation || 0;
  const separation = hatchConfig.separation || 8;
  const width = hatchConfig.width || 1;
  // Deterministic ID: same hatch config → same pattern ID → deduplicates via map.hasImage
  const patternId = `hatch_${color}_${rotation}_${separation}_${width}`.replace(/[^a-zA-Z0-9_#]/g, "_");
  return { patternId, color, rotation, separation, width };
}
```

- [ ] **Step 2: Modify symbolLayerToMapLibre to handle hatch fills**

When `fillType === "hatch"`, output a fill layer with a `_hatchPattern` metadata field. The layer manager will use this to generate and register the pattern image before adding the layer.

**Important constraint:** MapLibre's `fill-pattern` and `fill-color` are mutually exclusive — when `fill-pattern` is set, `fill-color` is ignored. This means for unique-value renderers where some classes use solid fills and others use hatch fills, we need separate layers. The simple renderer path handles this naturally (one layer per symbolLayer). For unique-value renderers, `buildUniqueValueGroups` already splits by type+index, so hatch fills at the same index as solid fills will be in the same group. 

**Strategy for unique-value hatch:** In `buildUniqueValueGroups`, further split fill groups by `fillType`. A solid fill and a hatch fill at the same index should be in separate groups with appropriate filters:

```javascript
// In buildUniqueValueGroups, when iterating symbolLayers:
const fillKind = symbolLayer.fillType === "hatch" ? "hatch" : "solid";
const key = `${mapLibreType}__${fillKind}__${i}`;
```

For the simple renderer path in `symbolLayerToMapLibre`:

```javascript
if (symbolLayer.type === "fill") {
  if (symbolLayer.fillType === "hatch" && symbolLayer.hatch) {
    const hatchSpec = buildHatchPatternSpec(symbolLayer.hatch);
    const paint = { "fill-pattern": hatchSpec.patternId };
    if (symbolLayer.opacity != null) paint["fill-opacity"] = symbolLayer.opacity;
    return { id, type: "fill", paint, layout: {}, _hatchPattern: hatchSpec };
  }
  const paint = { "fill-color": symbolLayer.color || "#808080" };
  if (symbolLayer.opacity != null) paint["fill-opacity"] = symbolLayer.opacity;
  return { id, type: "fill", paint, layout: {} };
}
```

And in `buildMatchLayer`, when the group is a hatch-fill group, use `fill-pattern` with a match expression that maps values to pattern IDs, generating a unique pattern for each class's hatch config:

```javascript
if (mapLibreType === "fill" && defaultSymbolLayer?.fillType === "hatch") {
  // All entries in this group are hatch fills
  // Each entry may have different hatch params → different pattern ID
  const patterns = []; // { value, patternSpec }
  for (const entry of entries) {
    const hatch = entry?.symbolLayer?.hatch || defaultSymbolLayer?.hatch;
    if (hatch) {
      patterns.push({ value: entry.value, spec: buildHatchPatternSpec(hatch) });
    }
  }
  const defaultSpec = buildHatchPatternSpec(defaultSymbolLayer?.hatch);
  const paint = {};
  if (patterns.length > 0 && defaultSpec) {
    const expr = ["match", ["get", field]];
    for (const p of patterns) {
      expr.push(p.value, p.spec.patternId);
    }
    expr.push(defaultSpec.patternId);
    paint["fill-pattern"] = expr;
  } else if (defaultSpec) {
    paint["fill-pattern"] = defaultSpec.patternId;
  }
  const allPatterns = [...patterns.map(p => p.spec), defaultSpec].filter(Boolean);
  return { id, type: "fill", paint, layout: {}, _hatchPatterns: allPatterns };
}
```

- [ ] **Step 3: Add pattern image registration in maplibre-layer-manager.js**

In `addLayerToMap`, before adding a style layer that has `_hatchPattern`, generate the pattern image and add it to the map:

```javascript
// In addLayerToMap, inside the for loop over styleLayers:
if (styleLayer._hatchPattern) {
  const spec = styleLayer._hatchPattern;
  if (!map.hasImage(spec.patternId)) {
    const patternImage = generateHatchImage(spec);
    map.addImage(spec.patternId, patternImage);
  }
  delete layerDef._hatchPattern; // clean up metadata
}
```

Add the `generateHatchImage` function. The tile size must ensure seamless tiling — for rotated hatches, compute a size that's a multiple of the line spacing projected onto both axes:

```javascript
function generateHatchImage(spec) {
  const separation = spec.separation || 8;
  const angleDeg = spec.rotation || 0;
  const angleRad = (angleDeg * Math.PI) / 180;

  // For seamless tiling at arbitrary angles, use a tile size that's a
  // multiple of the separation projected onto both axes.
  // For 45-degree hatches: size = separation * sqrt(2)
  const absCos = Math.abs(Math.cos(angleRad));
  const absSin = Math.abs(Math.sin(angleRad));
  const projX = absCos < 0.01 ? separation : separation / absCos;
  const projY = absSin < 0.01 ? separation : separation / absSin;
  const size = Math.max(16, Math.ceil(Math.max(projX, projY)));

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  // Clear with transparent background
  ctx.clearRect(0, 0, size, size);

  // Translate to center, rotate, draw parallel lines, restore
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(angleRad);
  ctx.strokeStyle = spec.color;
  ctx.lineWidth = spec.width || 1;

  // Draw enough lines to cover the rotated canvas area
  const diagonal = size * Math.SQRT2;
  for (let offset = -diagonal; offset < diagonal; offset += separation) {
    ctx.beginPath();
    ctx.moveTo(-diagonal, offset);
    ctx.lineTo(diagonal, offset);
    ctx.stroke();
  }
  ctx.restore();

  return ctx.getImageData(0, 0, size, size);
}
```

- [ ] **Step 4: Commit**

```bash
git add otef-interactive/frontend/src/shared/maplibre-style-bridge.js otef-interactive/frontend/src/map/maplibre-layer-manager.js
git commit -m "feat(otef): add hatch fill pattern support to MapLibre style bridge

Hatch fills from the AdvancedStyleEngine IR are now rendered using
generated pattern images via fill-pattern. Each unique hatch config
produces a canvas-drawn pattern registered with the map."
```

---

## Task 7: Flow/Trail Animations via MapLibre

**Files:**
- Create: `otef-interactive/frontend/src/shared/maplibre-flow-animation.js`
- Modify: `otef-interactive/frontend/src/entries/map-main.js`
- Modify: `otef-interactive/frontend/src/entries/projection-main.js`

**Problem:** The old system used a Canvas 2D animation loop with `line-dashoffset` to animate flow lines (e.g., attack routes in `october_7th`). The Canvas renderer is gone.

**Approach:** MapLibre supports `line-dasharray` which can be animated by periodically calling `setPaintProperty` to shift the dash pattern. Use `requestAnimationFrame` to create smooth flow animation.

- [ ] **Step 1: Create maplibre-flow-animation.js**

```javascript
/**
 * Flow animation controller for MapLibre.
 * Animates line-dasharray to create flowing line effects.
 */

const FLOW_DASH_LENGTH = 4;
const FLOW_GAP_LENGTH = 4;
const FLOW_SPEED = 0.02; // units per ms

const animatedLayers = new Map(); // layerId -> { map, speed }
let animationFrameId = null;
let lastTimestamp = 0;
let phase = 0;

function tick(timestamp) {
  if (!lastTimestamp) lastTimestamp = timestamp;
  const dt = timestamp - lastTimestamp;
  lastTimestamp = timestamp;
  phase += FLOW_SPEED * dt;

  for (const [layerId, config] of animatedLayers) {
    const map = config.map;
    if (!map.getLayer(layerId)) {
      animatedLayers.delete(layerId);
      continue;
    }
    const offset = phase * (config.speed || 1);
    const dashLength = config.dashLength || FLOW_DASH_LENGTH;
    const gapLength = config.gapLength || FLOW_GAP_LENGTH;
    const period = dashLength + gapLength;
    const shift = offset % period;
    try {
      map.setPaintProperty(layerId, "line-dasharray", [
        Math.max(0.1, dashLength - shift),
        gapLength,
        shift,
        0,
      ]);
    } catch (_) {
      animatedLayers.delete(layerId);
    }
  }

  if (animatedLayers.size > 0) {
    animationFrameId = requestAnimationFrame(tick);
  } else {
    animationFrameId = null;
    lastTimestamp = 0;
  }
}

export function startFlowAnimation(map, layerId, options = {}) {
  animatedLayers.set(layerId, {
    map,
    speed: options.speed || 1,
    dashLength: options.dashLength || FLOW_DASH_LENGTH,
    gapLength: options.gapLength || FLOW_GAP_LENGTH,
  });
  if (!animationFrameId) {
    lastTimestamp = 0;
    animationFrameId = requestAnimationFrame(tick);
  }
}

export function stopFlowAnimation(layerId) {
  animatedLayers.delete(layerId);
  if (animatedLayers.size === 0 && animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
    lastTimestamp = 0;
  }
}

export function stopAllFlowAnimations() {
  animatedLayers.clear();
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
    lastTimestamp = 0;
  }
}
```

- [ ] **Step 2: Integrate with map-main.js**

After layers are loaded, check if any layers should be animated (based on animation-runtime.js speed settings or layer metadata), and call `startFlowAnimation`. This can be wired up in a follow-up once we identify which specific layers need animation.

For now, expose the animation API on `window.MapLibreFlowAnimation` so it can be triggered from the remote controller:

```javascript
// In map-main.js, after map.on("load"):
import { startFlowAnimation, stopFlowAnimation, stopAllFlowAnimations } from "../shared/maplibre-flow-animation.js";

if (typeof window !== "undefined") {
  window.MapLibreFlowAnimation = { startFlowAnimation: (layerId, opts) => startFlowAnimation(map, layerId, opts), stopFlowAnimation, stopAllFlowAnimations };
}
```

- [ ] **Step 3: Commit**

```bash
git add otef-interactive/frontend/src/shared/maplibre-flow-animation.js otef-interactive/frontend/src/entries/map-main.js otef-interactive/frontend/src/entries/projection-main.js
git commit -m "feat(otef): add MapLibre-native flow animation controller

Uses line-dasharray animation via requestAnimationFrame for flow/trail
effects. Replaces the old Canvas 2D animation loop. Exposed on window
for remote controller integration."
```

---

## Task 8: Verify and Fix Projection Bounds & Rotation Editors

**Files:**
- Read: `otef-interactive/frontend/src/projection/projection-bounds-editor.js`
- Read: `otef-interactive/frontend/src/projection/projection-rotation-editor.js`
- Possibly modify: same files if they reference old Canvas elements

**Problem:** These editors load in `projection-main.js` and are configured with `getModelBounds`, `getDisplayedImageBounds`, and `itmToDisplayPixels`. They interact with SVG overlay elements (`#boundsEditorOverlay`) and toolbar buttons. They should work independently of the rendering engine since they operate on DOM/SVG elements, but need verification.

- [ ] **Step 1: Read both editor files and check for Canvas/Leaflet references**

If they reference `canvasRenderer`, `CanvasLayerRenderer`, or any Leaflet APIs, they need updates. If they only use DOM manipulation and the configured callback functions, they should work as-is.

- [ ] **Step 2: Test keyboard shortcuts (B for bounds, R for rotation)**

Open projection page, press B and R. Verify the editor UI appears and is interactive.

- [ ] **Step 3: Fix any issues found and commit**

```bash
git add otef-interactive/frontend/src/projection/
git commit -m "fix(otef): verify and fix projection bounds/rotation editors for MapLibre"
```

---

## Task 9: Handle Image Layers and Model Base Visibility

**Files:**
- Modify: `otef-interactive/frontend/src/map/maplibre-layer-manager.js`
- Modify: `otef-interactive/frontend/src/projection/maplibre-projection-layers.js`

**Problem:** The `projector_base.model_base` layer has `format: "image"` and `geometryType: "image"`. The layer manager doesn't handle image format layers. On projection, the model base image is managed via the `<img>` element, and its visibility should be controlled by the layer state.

- [ ] **Step 1: Skip image-format layers in addLayerToMap**

In `maplibre-layer-manager.js`, add a check at the beginning of `addLayerToMap`:

```javascript
if (layerConfig.format === "image" || layerConfig.geometryType === "image") {
  return; // Image layers are handled via DOM elements
}
```

- [ ] **Step 2: Handle model_base visibility in projection-main.js**

In `projection-main.js`, within the layer groups subscription, check for `projector_base.model_base` and update the image element visibility:

```javascript
registerDisposer(
  OTEFDataContext.subscribe("layerGroups", (groups) => {
    syncProjectionLayers(map, getEffectiveProjectionLayerGroups());
    // Handle model_base image visibility
    const projBase = (Array.isArray(groups) ? groups : Object.values(groups || {}))
      .find(g => g.id === "projector_base");
    if (projBase) {
      const modelBase = (projBase.layers || []).find(l => l.id === "model_base");
      if (modelImgEl) {
        modelImgEl.style.opacity = modelBase?.enabled ? "1" : "0";
      }
    }
  }),
);
```

- [ ] **Step 3: Commit**

```bash
git add otef-interactive/frontend/src/map/maplibre-layer-manager.js otef-interactive/frontend/src/entries/projection-main.js otef-interactive/frontend/src/projection/maplibre-projection-layers.js
git commit -m "fix(otef): handle image layers and model base visibility correctly

Image-format layers are skipped in MapLibre layer manager (rendered
via DOM elements). Model base visibility on projection is now driven
by layer group state."
```

---

## Task 10: ~~Suppress Duplicate "Missing layer config" Warnings~~ (ABSORBED INTO TASK 4)

**This task is now handled by Task 4 Step 1** which adds the curated skip in `addLayerToMap`. No separate task needed. Verify during Task 4 that the skip is in place.

---

## Notes for the Implementing Agent

1. **No git worktrees** — all work happens on the current `sync_and_layers_performance` branch directly.

2. **Minimal tests** — focus on manual verification through the dev server rather than writing extensive test suites. The style bridge already has `tests/map/maplibre-style-bridge.test.js` which should be updated for the undefined-fix changes in Task 1.

3. **Old files are kept** — per the user's decision, legacy files (`advanced-style-engine.js`, `advanced-style-drawing.js`, `projection-display.js`, `layer-renderer-canvas.js`, etc.) are NOT deleted until full visual parity is confirmed.

4. **Task ordering:**
   - **Tasks 1-3** are critical bug fixes — do first, can be parallelized.
   - **Task 4 is the highest priority feature task** — pink line is critical for first pass. Task 10 is absorbed into Task 4.
   - **Tasks 4, 6, 9 all modify `maplibre-layer-manager.js`** — must be done sequentially, not in parallel subagents.
   - **Task 5** depends on Task 4 (reuses `maplibre-curated-layer-loader.js`).
   - **Tasks 6, 7, 8** can be done in parallel with each other after Task 5.
   - Recommended order: [1,2,3] → [4] → [5] → [6,7,8 in parallel] → [9]

5. **Curated layers (Tasks 4-5) are the highest complexity and priority** — the pink line route overlay is critical for the first pass. Task 4 creates `maplibre-curated-layer-loader.js` which handles the full pipeline: fetch → route building → overlay planning → MapLibre materialization. The implementer MUST read `leaflet-curated-layer-loader.js` (748 lines) in full as the reference implementation. The renderer-agnostic modules (`planPinkCuratedOverlayLayers`, `routeLineStylesForDisplayColor`, `buildIntegratedRoute`, `parseColabRouteGeometryBundle`) are reused unchanged.

6. **PMTiles source-layer naming** — if PMTiles layers render empty (no features), the source-layer name is likely wrong. Use `console.log` in `getVectorSourceLayerName` to debug.

7. **Projection coordinate system** — MapLibre uses WGS84 (EPSG:4326). The projection system uses ITM (EPSG:2039). All coordinate transforms go through `proj4`. The projection MapLibre map is positioned using WGS84 bounds converted from ITM model bounds.
