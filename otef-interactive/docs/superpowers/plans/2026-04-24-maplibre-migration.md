# MapLibre GL JS Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Leaflet + Canvas 2D rendering stack with MapLibre GL JS on both the GIS and projection pages, enabling WebGL-accelerated vector tile rendering that eliminates the current main-thread freeze on heavy layer packs.

**Architecture:** The GIS page (`index.html`) currently uses Leaflet 1.9.4 with PMTiles via protomaps-leaflet; it will be replaced by MapLibre GL JS which natively consumes PMTiles via the `pmtiles://` protocol. The projection page (`projection.html`) currently uses a custom Canvas 2D renderer (`AdvancedStyleEngine` + `AdvancedStyleDrawing`); it will be replaced by a second MapLibre instance with transparent background overlaid on the model image. Both pages share state via `OTEFDataContext` (unchanged). The existing `advanced-style-engine.js` style IR will be translated to MapLibre style spec at load time by a new `maplibre-style-bridge.js` module.

**Tech Stack:** MapLibre GL JS v5+, pmtiles JS library v3, proj4js (retained for ITM↔WGS84), Vite (existing build), Vitest (existing tests)

**Background:** Read `otef-interactive/docs/performance-analysis.md` for the full root-cause analysis. The TL;DR: Leaflet + Canvas 2D cannot render 35,000+ polygon layers interactively. The `land_use` pack is ~165 MB of GeoJSON; `greens` is ~175 MB. PMTiles exist for all 19 `land_use` layers and 9/10 `greens` layers but the projection Canvas renderer cannot consume them. MapLibre solves both: WebGL rendering handles the feature count, and native PMTiles support eliminates the GeoJSON parse bottleneck.

**Decision:** We keep working on the existing `sync_and_layers_performance` branch. The 11 existing commits (dedup, echo suppression, sequence-aware sync, CSS highlight, offscreen caches, etc.) stay as-is; some may become obsolete after migration but they don't conflict. Django backend stays unchanged. No Supabase Realtime migration.

---

## File Structure

### New files to create

| File | Responsibility |
|------|---------------|
| `frontend/src/map/maplibre-map.js` | MapLibre map instance creation, basemap styles, PMTiles protocol registration. Replaces `map-initialization.js`'s Leaflet setup. |
| `frontend/src/shared/maplibre-style-bridge.js` | Translates the existing `AdvancedStyleEngine` IR (from `styles.json`) into MapLibre style spec layers. Shared by GIS and projection. |
| `frontend/src/projection/maplibre-projection.js` | MapLibre instance for projection page: transparent background, model-image underlay, highlight overlay. Replaces `projection-display.js`'s Canvas rendering. |
| `frontend/src/map/maplibre-layer-manager.js` | Layer loading/unloading for GIS page using MapLibre sources+layers. Replaces `leaflet-control-with-basemap.js` + `layer-state-manager.js` + `map-geojson-layer-loader.js`. |
| `frontend/src/projection/maplibre-projection-layers.js` | Layer loading for projection page. Replaces `projection-layer-manager.js` + `layer-renderer-canvas.js`. |
| `frontend/src/map/maplibre-viewport-sync.js` | Viewport sync adapted for MapLibre events (`moveend`, `zoomend`, `idle`). Replaces `viewport-sync.js`. |
| `tests/map/maplibre-style-bridge.test.js` | Tests for the style IR → MapLibre style translation. |

### Files to modify

| File | Change |
|------|--------|
| `frontend/index.html` | Remove Leaflet/protomaps-leaflet CDN scripts; add MapLibre GL JS + CSS CDN. |
| `frontend/projection.html` | Add MapLibre GL JS CDN; restructure display container for MapLibre canvas under model image. |
| `frontend/src/entries/map-main.js` | Replace Leaflet module imports with MapLibre equivalents. |
| `frontend/src/entries/projection-main.js` | Replace Canvas renderer imports with MapLibre projection equivalents. |
| `frontend/css/styles.css` | MapLibre container styles; remove Leaflet-specific overrides. |

### Files that become dead code (remove after migration validates)

| File | Why |
|------|-----|
| `frontend/src/map/map-initialization.js` | Replaced by `maplibre-map.js` |
| `frontend/src/map/leaflet-control-with-basemap.js` | Replaced by `maplibre-layer-manager.js` |
| `frontend/src/map/map-geojson-layer-loader.js` | MapLibre loads GeoJSON natively |
| `frontend/src/map/viewport-sync.js` | Replaced by `maplibre-viewport-sync.js` |
| `frontend/src/map/viewport-sync-scheduler.js` | MapLibre handles frame pacing |
| `frontend/src/map/viewport-apply-policy.js` | Simplified in MapLibre |
| `frontend/src/map-utils/advanced-pmtiles-layer.js` | MapLibre has native PMTiles |
| `frontend/src/map-utils/layer-factory.js` | Replaced by style bridge |
| `frontend/src/map-utils/visibility-controller.js` | MapLibre `minzoom`/`maxzoom` on layers |
| `frontend/src/projection/layer-renderer-canvas.js` | Replaced by MapLibre projection |
| `frontend/src/projection/wmts-layer-renderer.js` | MapLibre raster source |
| `frontend/src/projection/projection-animation-loop.js` | MapLibre handles rendering |
| `frontend/src/projection/highlight-smoothing-policy.js` | CSS transitions (already in use) |

---

## Task 1: Install MapLibre and register PMTiles protocol

**Files:**
- Modify: `otef-interactive/package.json`
- Modify: `otef-interactive/frontend/index.html`
- Create: `otef-interactive/frontend/src/map/maplibre-map.js`

- [ ] **Step 1: Install maplibre-gl and pmtiles**

```bash
cd otef-interactive
npm install maplibre-gl pmtiles
```

- [ ] **Step 2: Update `index.html` — remove Leaflet CDN, add MapLibre**

Replace the existing `<head>` section in `otef-interactive/frontend/index.html`:

Remove these lines:
```html
<!-- Leaflet -->
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<!-- PMTiles for vector tiles -->
<script src="https://unpkg.com/pmtiles@3.0.6/dist/pmtiles.js"></script>
<script src="https://unpkg.com/protomaps-leaflet@4.0.0/dist/protomaps-leaflet.js"></script>
```

Add in their place:
```html
<!-- MapLibre GL JS -->
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css" />
<!-- Proj4 for coordinate transformations -->
<script src="https://unpkg.com/proj4@2.9.0/dist/proj4.js"></script>
```

Add the EPSG:2039 projection definition **after** the proj4 script tag:

```html
<script>
  proj4.defs(
    "EPSG:2039",
    "+proj=tmerc +lat_0=31.73439361111111 +lon_0=35.20451694444445 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=-24.0024,-17.1032,-17.8444,0.33077,-1.85269,1.66969,5.4248 +units=m +no_defs"
  );
</script>
```

This is critical — the old `map-initialization.js` registered EPSG:2039 at runtime; the new MapLibre modules need it available for ITM↔WGS84 conversions.

Note: MapLibre JS itself will be imported as an ES module from `node_modules` via Vite. Only the CSS is loaded via CDN for simplicity.

- [ ] **Step 3: Create `maplibre-map.js` — MapLibre instance + PMTiles protocol**

Create `otef-interactive/frontend/src/map/maplibre-map.js`:

```javascript
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";

const pmtilesProtocol = new Protocol();
maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);

const BASEMAP_STYLES = {
  osm: {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: [
          "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
          "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
          "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
        ],
        tileSize: 256,
        attribution: "&copy; OpenStreetMap contributors",
      },
    },
    layers: [{ id: "osm-tiles", type: "raster", source: "osm" }],
  },
  satellite: {
    version: 8,
    sources: {
      esri: {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        attribution: "Esri, Maxar, Earthstar Geographics",
      },
    },
    layers: [{ id: "esri-tiles", type: "raster", source: "esri" }],
  },
};

export function createGISMap(containerId, options = {}) {
  const {
    center = [34.5, 31.4],
    zoom = 11,
    minZoom = 10,
    maxZoom = 19,
    basemap = "osm",
  } = options;

  const map = new maplibregl.Map({
    container: containerId,
    style: BASEMAP_STYLES[basemap] || BASEMAP_STYLES.osm,
    center,
    zoom,
    minZoom,
    maxZoom,
    attributionControl: true,
    dragRotate: false,
  });

  map.touchZoomRotate.disableRotation();

  return map;
}

export { maplibregl, pmtilesProtocol, BASEMAP_STYLES };
```

- [ ] **Step 4: Verify MapLibre loads**

Temporarily add to `map-main.js` at the top (will be replaced in Task 3):

```javascript
import { createGISMap } from "../map/maplibre-map.js";
```

Run:
```bash
cd otef-interactive && npm run dev:frontend
```

Open the GIS page in a browser. Confirm the map container renders a MapLibre basemap (OSM tiles). This is a smoke test — remove the temporary import after confirming. Actual wiring happens in Task 3.

- [ ] **Step 5: Commit**

```bash
git add otef-interactive/package.json otef-interactive/package-lock.json otef-interactive/frontend/index.html otef-interactive/frontend/src/map/maplibre-map.js
git commit -m "feat(otef): install MapLibre GL JS and register PMTiles protocol"
```

---

## Task 2: Style bridge — translate IR to MapLibre style spec

This is the core translation layer. The existing `AdvancedStyleEngine` produces a symbol IR with `symbolLayers` arrays containing `fill`, `stroke`, `markerPoint`, and `markerLine` entries. This task builds a module that converts that IR into MapLibre style spec layer definitions.

**Files:**
- Create: `otef-interactive/frontend/src/shared/maplibre-style-bridge.js`
- Create: `otef-interactive/tests/map/maplibre-style-bridge.test.js`

- [ ] **Step 1: Write the test file**

Create `otef-interactive/tests/map/maplibre-style-bridge.test.js`:

```javascript
import { describe, it, expect } from "vitest";
import {
  irToMapLibreLayers,
  buildMatchLayer,
} from "../../frontend/src/shared/maplibre-style-bridge.js";

describe("irToMapLibreLayers", () => {
  it("converts a simple solid-fill polygon layer", () => {
    const layerConfig = {
      geometryType: "polygon",
      style: {
        renderer: "simple",
        defaultSymbol: {
          symbolLayers: [
            { type: "fill", fillType: "solid", color: "#ffdf7f", opacity: 1.0 },
            { type: "stroke", color: "#000000", width: 1.0, opacity: 1.0 },
          ],
        },
      },
    };

    const result = irToMapLibreLayers("land_use.מגורים", "land_use__מגורים", layerConfig);

    expect(result).toHaveLength(2);

    const fill = result.find((l) => l.type === "fill");
    expect(fill).toBeDefined();
    expect(fill.paint["fill-color"]).toBe("#ffdf7f");
    expect(fill.paint["fill-opacity"]).toBe(1.0);

    const line = result.find((l) => l.type === "line");
    expect(line).toBeDefined();
    expect(line.paint["line-color"]).toBe("#000000");
    expect(line.paint["line-width"]).toBe(1.0);
  });

  it("converts a uniqueValue renderer with match expression", () => {
    const layerConfig = {
      geometryType: "polygon",
      style: {
        renderer: "uniqueValue",
        uniqueValues: {
          field: "mimush",
          classes: [
            {
              value: "0",
              symbol: {
                symbolLayers: [
                  { type: "fill", fillType: "solid", color: "#d76e89", opacity: 1.0 },
                ],
              },
            },
            {
              value: "1",
              symbol: {
                symbolLayers: [
                  { type: "fill", fillType: "solid", color: "#76b5c5", opacity: 1.0 },
                ],
              },
            },
          ],
        },
        defaultSymbol: {
          symbolLayers: [
            { type: "fill", fillType: "solid", color: "#808080", opacity: 1.0 },
          ],
        },
      },
    };

    const result = irToMapLibreLayers("test.layer", "test__layer", layerConfig);
    const fill = result.find((l) => l.type === "fill");
    expect(fill.paint["fill-color"]).toEqual([
      "match",
      ["get", "mimush"],
      "0", "#d76e89",
      "1", "#76b5c5",
      "#808080",
    ]);
  });

  it("converts a circle marker layer", () => {
    const layerConfig = {
      geometryType: "point",
      style: {
        renderer: "simple",
        defaultSymbol: {
          symbolLayers: [
            {
              type: "markerPoint",
              marker: { size: 8, fill: "#a83800", stroke: "#000000", strokeWidth: 1 },
            },
          ],
        },
      },
    };

    const result = irToMapLibreLayers("test.points", "test__points", layerConfig);
    const circle = result.find((l) => l.type === "circle");
    expect(circle).toBeDefined();
    expect(circle.paint["circle-radius"]).toBe(4);
    expect(circle.paint["circle-color"]).toBe("#a83800");
  });

  it("converts a line layer with dash array", () => {
    const layerConfig = {
      geometryType: "line",
      style: {
        renderer: "simple",
        defaultSymbol: {
          symbolLayers: [
            {
              type: "stroke",
              color: "#ff0000",
              width: 2,
              opacity: 1.0,
              dash: { array: [4, 4] },
            },
          ],
        },
      },
    };

    const result = irToMapLibreLayers("test.dashed", "test__dashed", layerConfig);
    const line = result.find((l) => l.type === "line");
    expect(line.paint["line-dasharray"]).toEqual([4, 4]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd otef-interactive && npx vitest run tests/map/maplibre-style-bridge.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `maplibre-style-bridge.js`**

Create `otef-interactive/frontend/src/shared/maplibre-style-bridge.js`:

```javascript
/**
 * Translates the OTEF AdvancedStyleEngine IR (symbolLayers)
 * into MapLibre GL JS style spec layer definitions.
 *
 * Input:  layerConfig with .style.renderer, .style.defaultSymbol, .style.uniqueValues
 * Output: Array of MapLibre layer objects (paint + layout, no source — caller adds source/source-layer)
 */

export function irToMapLibreLayers(fullLayerId, sourceLayerId, layerConfig) {
  const style = layerConfig.style || {};
  const geomType = layerConfig.geometryType || "polygon";
  const renderer = style.renderer || "simple";
  const defaultSymbol = style.defaultSymbol || { symbolLayers: [] };
  const uniqueValues = style.uniqueValues;

  const layers = [];
  const idBase = fullLayerId.replace(/\./g, "__");

  if (renderer === "uniqueValue" && uniqueValues) {
    layers.push(
      ...buildUniqueValueLayers(idBase, geomType, uniqueValues, defaultSymbol)
    );
  } else {
    layers.push(...buildSimpleLayers(idBase, geomType, defaultSymbol));
  }

  return layers;
}

function buildSimpleLayers(idBase, geomType, symbol) {
  const layers = [];
  const symLayers = symbol.symbolLayers || [];

  for (let i = 0; i < symLayers.length; i++) {
    const sl = symLayers[i];
    const layer = symbolLayerToMapLibre(sl, `${idBase}__${i}`, geomType);
    if (layer) layers.push(layer);
  }

  return layers;
}

function buildUniqueValueLayers(idBase, geomType, uv, defaultSymbol) {
  const field = uv.field;
  const classes = uv.classes || [];
  const defaultSym = defaultSymbol.symbolLayers || [];

  const layersByType = {};

  for (const cls of classes) {
    const sym = cls.symbol || cls.style || defaultSymbol;
    const symLayers = sym.symbolLayers || [];
    for (let i = 0; i < symLayers.length; i++) {
      const sl = symLayers[i];
      const mlType = getMapLibreType(sl, geomType);
      if (!mlType) continue;
      const key = `${mlType}__${i}`;
      if (!layersByType[key]) {
        layersByType[key] = { type: mlType, index: i, entries: [], sl };
      }
      layersByType[key].entries.push({ value: cls.value, sl });
    }
  }

  const result = [];

  for (const [key, group] of Object.entries(layersByType)) {
    const defaultSl = defaultSym[group.index] || group.sl;
    const layer = buildMatchLayer(
      `${idBase}__${key}`,
      group.type,
      field,
      group.entries,
      defaultSl,
      geomType
    );
    if (layer) result.push(layer);
  }

  return result;
}

function buildMatchLayer(id, mlType, field, entries, defaultSl, geomType) {
  const paint = {};

  if (mlType === "fill") {
    const colorExpr = buildMatchExpr(field, entries, defaultSl, "color");
    const opacityExpr = buildMatchExpr(field, entries, defaultSl, "opacity");
    paint["fill-color"] = colorExpr;
    if (opacityExpr !== undefined) paint["fill-opacity"] = opacityExpr;
    return { id, type: "fill", paint, layout: {} };
  }

  if (mlType === "line") {
    paint["line-color"] = buildMatchExpr(field, entries, defaultSl, "color");
    paint["line-width"] = buildMatchExpr(field, entries, defaultSl, "width") || 1;
    const opacityExpr = buildMatchExpr(field, entries, defaultSl, "opacity");
    if (opacityExpr !== undefined) paint["line-opacity"] = opacityExpr;
    return { id, type: "line", paint, layout: {} };
  }

  if (mlType === "circle") {
    paint["circle-color"] = buildMatchExpr(field, entries, defaultSl, "marker.fill");
    paint["circle-radius"] = buildMatchExpr(field, entries, defaultSl, "marker.size", (v) => v / 2) || 4;
    paint["circle-stroke-color"] = buildMatchExpr(field, entries, defaultSl, "marker.stroke") || "#000";
    paint["circle-stroke-width"] = buildMatchExpr(field, entries, defaultSl, "marker.strokeWidth") || 1;
    return { id, type: "circle", paint, layout: {} };
  }

  return null;
}

function buildMatchExpr(field, entries, defaultSl, prop, transform) {
  const getValue = (sl) => {
    const raw = getNestedProp(sl, prop);
    return transform && raw != null ? transform(raw) : raw;
  };

  const defaultVal = getValue(defaultSl);
  const args = ["match", ["get", field]];
  let allSame = true;

  for (const entry of entries) {
    const val = getValue(entry.sl);
    if (val !== defaultVal) allSame = false;
    args.push(entry.value, val ?? defaultVal);
  }

  args.push(defaultVal);

  if (allSame || entries.length === 0) return defaultVal;
  return args;
}

function getNestedProp(sl, prop) {
  const parts = prop.split(".");
  let obj = sl;
  for (const p of parts) {
    if (obj == null) return undefined;
    obj = obj[p];
  }
  return obj;
}

function symbolLayerToMapLibre(sl, id, geomType) {
  if (sl.type === "fill") {
    const paint = { "fill-color": sl.color || "#808080" };
    if (sl.opacity != null) paint["fill-opacity"] = sl.opacity;
    return { id, type: "fill", paint, layout: {} };
  }

  if (sl.type === "stroke") {
    const paint = {
      "line-color": sl.color || "#000000",
      "line-width": sl.width || 1,
    };
    if (sl.opacity != null) paint["line-opacity"] = sl.opacity;
    if (sl.dash && sl.dash.array) paint["line-dasharray"] = sl.dash.array;
    const layout = {};
    if (sl.lineCap) layout["line-cap"] = sl.lineCap;
    if (sl.lineJoin) layout["line-join"] = sl.lineJoin;
    return { id, type: "line", paint, layout };
  }

  if (sl.type === "markerPoint") {
    const m = sl.marker || {};
    const paint = {
      "circle-radius": (m.size || 8) / 2,
      "circle-color": m.fill || m.color || "#808080",
      "circle-stroke-color": m.stroke || m.strokeColor || "#000000",
      "circle-stroke-width": m.strokeWidth || 1,
    };
    return { id, type: "circle", paint, layout: {} };
  }

  if (sl.type === "markerLine") {
    console.warn(`[style-bridge] markerLine not yet supported for ${id}, skipping`);
    return null;
  }

  if (sl.type === "fill" && sl.fillType === "hatch") {
    console.warn(`[style-bridge] hatch fill rendered as solid for ${id} — needs fill-pattern image`);
    const paint = { "fill-color": sl.color || "#808080" };
    if (sl.opacity != null) paint["fill-opacity"] = sl.opacity;
    return { id, type: "fill", paint, layout: {} };
  }

  console.warn(`[style-bridge] Unknown symbolLayer type "${sl.type}" for ${id}, skipping`);
  return null;
}

function getMapLibreType(sl, geomType) {
  if (sl.type === "fill") return "fill";
  if (sl.type === "stroke") return "line";
  if (sl.type === "markerPoint") return "circle";
  if (sl.type === "markerLine") return "symbol";
  return null;
}

export { buildMatchLayer };
```

- [ ] **Step 4: Run tests**

```bash
cd otef-interactive && npx vitest run tests/map/maplibre-style-bridge.test.js
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add otef-interactive/frontend/src/shared/maplibre-style-bridge.js otef-interactive/tests/map/maplibre-style-bridge.test.js
git commit -m "feat(otef): style bridge translating IR to MapLibre style spec"
```

---

## Task 3: GIS page — MapLibre layer manager

Replace the Leaflet layer loading pipeline with MapLibre sources and layers.

**Important context:** `layer-registry.js` exports a **singleton instance** (not the class). API:
- `layerRegistry.init()` — async, loads manifests
- `layerRegistry.getLayerConfig(fullId)` — returns `{id, file, pmtilesFile, geometryType, style, groupId, ...}`
- `layerRegistry.getGroups()` — returns `[{id, name, layers}]`
- `layerRegistry.getLayersInGroup(groupId)` — returns layer array
- `layerRegistry.getLayerPMTilesUrl(fullId)` — returns URL-encoded PMTiles path or null
- `layerRegistry.getLayerDataUrl(fullId)` — returns URL-encoded GeoJSON path or null
- `layerRegistry.isPMTiles(fullId)` — boolean

**Files:**
- Create: `otef-interactive/frontend/src/map/maplibre-layer-manager.js`

- [ ] **Step 1: Create `maplibre-layer-manager.js`**

Create `otef-interactive/frontend/src/map/maplibre-layer-manager.js`:

```javascript
/**
 * Manages adding/removing MapLibre sources and style layers
 * based on OTEFDataContext layer group state.
 *
 * Uses the LayerRegistry singleton for config/URL resolution.
 * Each registry layer becomes:
 *  - A MapLibre source (vector PMTiles or GeoJSON)
 *  - One or more MapLibre style layers (from the style bridge)
 */
import { irToMapLibreLayers } from "../shared/maplibre-style-bridge.js";
import layerRegistry from "../shared/layer-registry.js";

const loadedSources = new Map();
const loadedLayerIds = new Map();

export function applyLayerGroupsToMap(map, layerGroups) {
  const enabledFullIds = new Set();

  for (const group of Object.values(layerGroups || {})) {
    if (!group.enabled) continue;
    for (const layer of group.layers || []) {
      if (layer.enabled) {
        enabledFullIds.add(`${group.id}.${layer.id}`);
      }
    }
  }

  for (const [fullId, mlLayerIds] of loadedLayerIds.entries()) {
    if (!enabledFullIds.has(fullId)) {
      for (const lid of mlLayerIds) {
        if (map.getLayer(lid)) map.removeLayer(lid);
      }
      loadedLayerIds.delete(fullId);
      if (loadedSources.has(fullId)) {
        if (map.getSource(fullId)) map.removeSource(fullId);
        loadedSources.delete(fullId);
      }
    }
  }

  for (const fullId of enabledFullIds) {
    if (loadedSources.has(fullId)) continue;
    addLayerToMap(map, fullId);
  }
}

function addLayerToMap(map, fullId) {
  const layerConfig = layerRegistry.getLayerConfig(fullId);
  if (!layerConfig) {
    console.warn(`[maplibre-layer-manager] No config found for ${fullId}`);
    return;
  }

  const sourceId = fullId;

  if (layerConfig.pmtilesFile) {
    const pmUrl = layerRegistry.getLayerPMTilesUrl(fullId);
    if (!pmUrl) return;
    const pmtilesUrl = `pmtiles://${window.location.origin}${pmUrl}`;

    try {
      map.addSource(sourceId, { type: "vector", url: pmtilesUrl });
    } catch (e) {
      console.warn(`[maplibre-layer-manager] Failed to add PMTiles source for ${fullId}:`, e);
      return;
    }
  } else if (layerConfig.file) {
    const dataUrl = layerRegistry.getLayerDataUrl(fullId);
    if (!dataUrl) return;

    try {
      map.addSource(sourceId, { type: "geojson", data: dataUrl });
    } catch (e) {
      console.warn(`[maplibre-layer-manager] Failed to add GeoJSON source for ${fullId}:`, e);
      return;
    }
  } else if (layerConfig.format === "wmts") {
    return;
  } else {
    return;
  }

  loadedSources.set(fullId, sourceId);

  const mlLayers = irToMapLibreLayers(fullId, sourceId, layerConfig);
  const addedIds = [];

  for (const mlLayer of mlLayers) {
    mlLayer.source = sourceId;
    if (layerConfig.pmtilesFile) {
      mlLayer["source-layer"] = layerConfig.sourceLayer || layerConfig.id || "default";
    }
    try {
      map.addLayer(mlLayer);
      addedIds.push(mlLayer.id);
    } catch (e) {
      console.warn(`[maplibre-layer-manager] Failed to add layer ${mlLayer.id}:`, e);
    }
  }

  loadedLayerIds.set(fullId, addedIds);
}

export function clearAllLayers(map) {
  for (const [fullId, mlLayerIds] of loadedLayerIds.entries()) {
    for (const lid of mlLayerIds) {
      if (map.getLayer(lid)) map.removeLayer(lid);
    }
    if (map.getSource(fullId)) map.removeSource(fullId);
  }
  loadedSources.clear();
  loadedLayerIds.clear();
}
```

**Key differences from old Leaflet pipeline:**
- Uses `layerRegistry.getLayerConfig(fullId)` for config (not `getPack()`)
- Uses `layerRegistry.getLayerPMTilesUrl(fullId)` which handles `encodeURIComponent` for Hebrew filenames
- Uses `layerRegistry.getLayerDataUrl(fullId)` for GeoJSON fallback
- Wraps `addSource`/`addLayer` in try/catch since source-layer name mismatches fail silently
- The `source-layer` for PMTiles defaults to `layerConfig.id` — **you must verify this matches what tippecanoe used**. Run `npx pmtiles show <file>` to check actual layer names.

- [ ] **Step 2: Commit**

```bash
git add otef-interactive/frontend/src/map/maplibre-layer-manager.js
git commit -m "feat(otef): MapLibre layer manager with PMTiles + GeoJSON sources"
```

---

## Task 4: GIS page — viewport sync for MapLibre

Port the viewport sync logic from Leaflet events to MapLibre events.

**Files:**
- Create: `otef-interactive/frontend/src/map/maplibre-viewport-sync.js`

- [ ] **Step 1: Create `maplibre-viewport-sync.js`**

Create `otef-interactive/frontend/src/map/maplibre-viewport-sync.js`:

```javascript
/**
 * Viewport synchronization for MapLibre GL JS.
 * Subscribes to OTEFDataContext viewport changes and applies them to the map.
 * Listens to MapLibre moveend/zoomend and reports back to OTEFDataContext.
 */

let isApplyingRemote = false;
let syncLockTimer = null;

export function setupViewportSync(map, dataContext) {
  dataContext.subscribe("viewport", (viewport) => {
    if (!viewport || !viewport.bbox) return;
    applyViewport(map, viewport);
  });

  map.on("moveend", () => {
    if (isApplyingRemote) return;
    reportViewportToContext(map, dataContext);
  });
}

function applyViewport(map, viewport) {
  const { bbox, zoom } = viewport;
  if (!bbox) return;

  const [west, south, east, north] = bboxToWGS84(bbox);

  const currentBounds = map.getBounds();
  const currentZoom = map.getZoom();

  if (
    Math.abs(currentBounds.getWest() - west) < 0.0001 &&
    Math.abs(currentBounds.getSouth() - south) < 0.0001 &&
    Math.abs(currentZoom - (zoom || currentZoom)) < 0.1
  ) {
    return;
  }

  isApplyingRemote = true;
  clearTimeout(syncLockTimer);

  map.fitBounds([[west, south], [east, north]], {
    animate: false,
    padding: 0,
  });

  syncLockTimer = setTimeout(() => {
    isApplyingRemote = false;
  }, 200);
}

function reportViewportToContext(map, dataContext) {
  const bounds = map.getBounds();
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();

  const swItm = wgs84ToItm(sw.lng, sw.lat);
  const neItm = wgs84ToItm(ne.lng, ne.lat);

  const bbox = [swItm[0], swItm[1], neItm[0], neItm[1]];
  const zoom = map.getZoom();

  const corners = [
    wgs84ToItm(bounds.getNorthWest().lng, bounds.getNorthWest().lat),
    wgs84ToItm(ne.lng, ne.lat),
    wgs84ToItm(bounds.getSouthEast().lng, bounds.getSouthEast().lat),
    wgs84ToItm(sw.lng, sw.lat),
  ];

  dataContext.updateViewportFromUI({ bbox, zoom, corners }, "gis");
}

function bboxToWGS84(bbox) {
  const sw = proj4("EPSG:2039", "EPSG:4326", [bbox[0], bbox[1]]);
  const ne = proj4("EPSG:2039", "EPSG:4326", [bbox[2], bbox[3]]);
  return [sw[0], sw[1], ne[0], ne[1]];
}

function wgs84ToItm(lng, lat) {
  return proj4("EPSG:4326", "EPSG:2039", [lng, lat]);
}
```

- [ ] **Step 2: Commit**

```bash
git add otef-interactive/frontend/src/map/maplibre-viewport-sync.js
git commit -m "feat(otef): viewport sync adapted for MapLibre events"
```

---

## Task 5: Wire GIS page entry point to MapLibre

Replace the Leaflet bootstrap chain with MapLibre modules.

**Files:**
- Modify: `otef-interactive/frontend/src/entries/map-main.js`

- [ ] **Step 1: Rewrite `map-main.js`**

Replace the content of `otef-interactive/frontend/src/entries/map-main.js` with:

```javascript
import TableSwitcher from "../shared/table-switcher.js";
import TableSwitcherPopup from "../shared/table-switcher-popup.js";
import { createGISMap } from "../map/maplibre-map.js";
import { setupViewportSync } from "../map/maplibre-viewport-sync.js";
import { applyLayerGroupsToMap } from "../map/maplibre-layer-manager.js";

async function bootstrapMapRuntime() {
  const sharedModules = [
    "../shared/logger.js",
    "../shared/map-projection-config.js",
    "../shared/message-protocol.js",
    "../shared/websocket-client.js",
    "../shared/api-client.js",
    "../shared/otef-data-context/index.js",
    "../shared/otef-data-context/OTEFDataContext-actions.js",
    "../shared/otef-data-context/OTEFDataContext-bounds.js",
    "../shared/otef-data-context/OTEFDataContext-websocket.js",
    "../shared/OTEFDataContext.js",
    "../shared/layer-state-helper.js",
    "../shared/layer-registry.js",
  ];

  for (const mod of sharedModules) {
    await import(mod);
  }

  const OTEFDataContext = (await import("../shared/OTEFDataContext.js")).default;
  const layerRegistry = (await import("../shared/layer-registry.js")).default;

  await OTEFDataContext.init("otef");
  await layerRegistry.init();

  const bounds = OTEFDataContext.getBounds();
  const center = bounds
    ? proj4("EPSG:2039", "EPSG:4326", [
        (bounds.west + bounds.east) / 2,
        (bounds.south + bounds.north) / 2,
      ])
    : [34.5, 31.4];

  const map = createGISMap("map", {
    center,
    zoom: 11,
  });

  if (typeof window !== "undefined") {
    window._maplibreMap = map;
  }

  map.on("load", () => {
    setupViewportSync(map, OTEFDataContext);

    const layerGroups = OTEFDataContext.getLayerGroups();
    applyLayerGroupsToMap(map, layerGroups);

    OTEFDataContext.subscribe("layerGroups", (groups) => {
      applyLayerGroupsToMap(map, groups);
    });
}

function initializeTableSwitcher() {
  if (typeof TableSwitcher !== "function") {
    throw new Error("TableSwitcher constructor not available");
  }

  const tableSwitcher = new TableSwitcher({
    defaultTable: "otef",
    onTableChange: (tableName) => {
      if (tableName !== "otef") {
        window.location.href = `/dashboard/?table=${tableName}`;
      }
    },
  });

  window.tableSwitcher = tableSwitcher;

  if (tableSwitcher.getCurrentTable() !== "otef") {
    window.location.href = `/dashboard/?table=${tableSwitcher.getCurrentTable()}`;
    return false;
  }

  if (typeof TableSwitcherPopup === "function") {
    new TableSwitcherPopup(tableSwitcher);
  }

  return true;
}

async function boot() {
  const shouldContinue = initializeTableSwitcher();
  if (!shouldContinue) return;
  await bootstrapMapRuntime();
}

boot().catch((error) =>
  console.error("[frontend-b] map bootstrap failed", error)
);
```

- [ ] **Step 2: Update `styles.css` for MapLibre**

In `otef-interactive/frontend/css/styles.css`, ensure the `#map` container fills the page (likely already does), and add:

```css
.maplibregl-canvas {
  outline: none;
}
```

- [ ] **Step 3: Re-add curated layers, legend, and pink line wiring**

The old `map-initialization.js` wires up curated layer Supabase sync, the pink line overlay, and the map legend. These must be preserved. Add to `map-main.js` inside the `map.on("load", ...)` callback, after the layer group subscription:

```javascript
    // Curated layers (Supabase-synced overlays like annotations, pink line route)
    try {
      const curatedSync = await import("../map/map-curated-supabase-sync.js");
      const heartbeat = await import("../shared/curated-supabase-heartbeat.js");
      // Wire curated refresh — these modules register window event listeners
    } catch (e) {
      console.warn("[map-main] Curated layer modules not available:", e);
    }

    // Map legend
    try {
      const { updateMapLegend } = await import("../map/map-legend.js");
      OTEFDataContext.subscribe("layerGroups", () => {
        updateMapLegend(OTEFDataContext.getLayerGroups());
      });
      updateMapLegend(OTEFDataContext.getLayerGroups());
    } catch (e) {
      console.warn("[map-main] Legend module not available:", e);
    }
```

Note: The curated layer rendering itself (drawing curated GeoJSON onto the map) will need a separate follow-up task to port from Leaflet to MapLibre. For now, the sync/heartbeat modules can load safely — they listen for events and update data, they don't directly depend on Leaflet's API. The legend module may need minor adjustments since it currently reads Leaflet layer metadata.

- [ ] **Step 4: Manual integration test**

Start the dev server:
```bash
cd otef-interactive && npm run dev:frontend
```

Open the GIS page in the browser running the Docker stack (so the API/WS is reachable).

**Verify:**
1. MapLibre basemap renders (OSM tiles visible)
2. Toggle a lightweight layer pack from remote controller (e.g. `october_7th`) — layers appear on map
3. Pan/zoom from remote controller — map responds
4. Toggle a heavy pack (`land_use`) — should load WITHOUT freezing the UI (this is the key validation)
5. Map legend panel shows active layers (may need debugging)

If heavy layers still freeze, check the browser console for GeoJSON fallback (means PMTiles source-layer name doesn't match). The `sourceLayer` property in the manifest may need adjustment. Run `npx pmtiles show <file>` on a PMTiles file to check actual layer names.

- [ ] **Step 5: Commit**

```bash
git add otef-interactive/frontend/src/entries/map-main.js otef-interactive/frontend/css/styles.css
git commit -m "feat(otef): wire GIS page to MapLibre rendering pipeline"
```

---

## Task 6: Projection page — MapLibre with transparent background

Replace the Canvas 2D projection renderer with a MapLibre instance.

**Files:**
- Modify: `otef-interactive/frontend/projection.html`
- Create: `otef-interactive/frontend/src/projection/maplibre-projection.js`
- Create: `otef-interactive/frontend/src/projection/maplibre-projection-layers.js`
- Modify: `otef-interactive/frontend/src/entries/projection-main.js`

- [ ] **Step 1: Update `projection.html`**

In `otef-interactive/frontend/projection.html`, add the MapLibre CSS in `<head>`:

```html
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css" />
```

Replace the canvas elements inside `#displayContainer` with a MapLibre container. Change:

```html
<canvas id="layersCanvas"></canvas>
<div id="highlightOverlay"></div>
```

To:

```html
<div id="projectionMap" style="position:absolute;top:0;left:0;width:100%;height:100%;z-index:5;pointer-events:none;"></div>
<div id="highlightOverlay"></div>
```

The model image (`#displayedImage`) stays at z-index 1; MapLibre canvas at z-index 5; highlight at z-index 10.

- [ ] **Step 2: Create `maplibre-projection.js`**

Create `otef-interactive/frontend/src/projection/maplibre-projection.js`:

```javascript
/**
 * Creates and manages the MapLibre instance for the projection display.
 * Transparent background, no basemap, overlaid on model image.
 */
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";

const pmtilesProtocol = new Protocol();
maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);

export function createProjectionMap(containerId, modelBounds) {
  const map = new maplibregl.Map({
    container: containerId,
    style: {
      version: 8,
      sources: {},
      layers: [],
    },
    center: modelBounds.center,
    zoom: modelBounds.zoom || 12,
    bearing: modelBounds.bearing || 0,
    interactive: false,
    attributionControl: false,
    preserveDrawingBuffer: true,
  });

  map.fitBounds(modelBounds.bounds, { animate: false, padding: 0 });

  return map;
}

export function updateProjectionViewport(map, viewport, modelBounds) {
  if (!viewport || !viewport.bbox) return;

  const [west, south, east, north] = bboxToWGS84(viewport.bbox);

  map.fitBounds([[west, south], [east, north]], {
    animate: false,
    padding: 0,
    bearing: modelBounds.bearing || 0,
  });
}

function bboxToWGS84(bbox) {
  const sw = proj4("EPSG:2039", "EPSG:4326", [bbox[0], bbox[1]]);
  const ne = proj4("EPSG:2039", "EPSG:4326", [bbox[2], bbox[3]]);
  return [sw[0], sw[1], ne[0], ne[1]];
}

export function updateHighlightFromViewport(viewport, modelBounds, highlightEl) {
  if (!viewport || !viewport.bbox || !highlightEl) return;

  const fullExtent = isFullExtent(viewport.bbox, modelBounds);

  if (fullExtent) {
    highlightEl.style.display = "none";
    return;
  }

  highlightEl.style.display = "";

  const container = highlightEl.parentElement;
  if (!container) return;

  const cw = container.clientWidth;
  const ch = container.clientHeight;
  const mb = modelBounds.itm;

  const toPixelX = (itmX) => ((itmX - mb.west) / (mb.east - mb.west)) * cw;
  const toPixelY = (itmY) => ((mb.north - itmY) / (mb.north - mb.south)) * ch;

  const x = toPixelX(viewport.bbox[0]);
  const y = toPixelY(viewport.bbox[3]);
  const w = toPixelX(viewport.bbox[2]) - x;
  const h = toPixelY(viewport.bbox[1]) - y;

  let box = highlightEl.querySelector(".highlight-box");
  if (!box) {
    box = document.createElement("div");
    box.className = "highlight-box";
    box.style.cssText =
      "position:absolute;border:3px solid cyan;pointer-events:none;transition:all 0.15s ease-out;";
    highlightEl.appendChild(box);
  }

  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
  box.style.width = `${w}px`;
  box.style.height = `${h}px`;
}

function isFullExtent(bbox, modelBounds) {
  const tol = 10;
  const mb = modelBounds.itm;
  return (
    Math.abs(bbox[0] - mb.west) < tol &&
    Math.abs(bbox[1] - mb.south) < tol &&
    Math.abs(bbox[2] - mb.east) < tol &&
    Math.abs(bbox[3] - mb.north) < tol
  );
}
```

- [ ] **Step 3: Create `maplibre-projection-layers.js`**

Create `otef-interactive/frontend/src/projection/maplibre-projection-layers.js`:

```javascript
/**
 * Layer management for the projection MapLibre instance.
 * Reuses the same style bridge and layer manager logic as GIS,
 * but adds WMTS raster source support.
 */
import { applyLayerGroupsToMap, clearAllLayers } from "../map/maplibre-layer-manager.js";

export function syncProjectionLayers(map, layerGroups) {
  applyLayerGroupsToMap(map, layerGroups);
}

export function addWmtsSource(map, layerConfig) {
  if (!layerConfig.wmts) return;

  const sourceId = `wmts__${layerConfig.id}`;
  if (map.getSource(sourceId)) return;

  map.addSource(sourceId, {
    type: "raster",
    tiles: [layerConfig.wmts.urlTemplate],
    tileSize: 256,
  });

  map.addLayer({
    id: `wmts__${layerConfig.id}__raster`,
    type: "raster",
    source: sourceId,
    paint: {
      "raster-opacity": layerConfig.wmts.opacity ?? 1.0,
    },
  });
}
```

- [ ] **Step 4: Rewrite `projection-main.js`**

Replace `otef-interactive/frontend/src/entries/projection-main.js`:

```javascript
import TableSwitcher from "../shared/table-switcher.js";
import TableSwitcherPopup from "../shared/table-switcher-popup.js";
import {
  createProjectionMap,
  updateProjectionViewport,
  updateHighlightFromViewport,
} from "../projection/maplibre-projection.js";
import { syncProjectionLayers } from "../projection/maplibre-projection-layers.js";

async function bootstrapProjectionRuntime() {
  const sharedModules = [
    "../shared/logger.js",
    "../shared/map-projection-config.js",
    "../shared/animation-runtime.js",
    "../shared/message-protocol.js",
    "../shared/websocket-client.js",
    "../shared/api-client.js",
    "../shared/otef-data-context/index.js",
    "../shared/otef-data-context/OTEFDataContext-actions.js",
    "../shared/otef-data-context/OTEFDataContext-bounds.js",
    "../shared/otef-data-context/OTEFDataContext-websocket.js",
    "../shared/OTEFDataContext.js",
    "../shared/layer-registry.js",
    "../shared/layer-state-helper.js",
  ];

  for (const mod of sharedModules) {
    await import(mod);
  }

  const OTEFDataContext = (await import("../shared/OTEFDataContext.js")).default;
  const layerRegistry = (await import("../shared/layer-registry.js")).default;

  await OTEFDataContext.init("otef");
  await layerRegistry.init();

  const boundsResp = await fetch("/otef-interactive/frontend/data/model-bounds.json");
  const modelBoundsData = await boundsResp.json();

  const sw = proj4("EPSG:2039", "EPSG:4326", [
    modelBoundsData.bounds.west,
    modelBoundsData.bounds.south,
  ]);
  const ne = proj4("EPSG:2039", "EPSG:4326", [
    modelBoundsData.bounds.east,
    modelBoundsData.bounds.north,
  ]);

  const modelBounds = {
    bounds: [sw, ne],
    center: [(sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2],
    zoom: 12,
    bearing: modelBoundsData.viewer_angle_deg || 0,
    itm: modelBoundsData.bounds,
  };

  const modelImgEl = document.getElementById("displayedImage");
  if (modelImgEl && modelBoundsData.model_image) {
    modelImgEl.src = modelBoundsData.model_image;
    modelImgEl.style.opacity = "1";
  }

  const map = createProjectionMap("projectionMap", modelBounds);
  const highlightEl = document.getElementById("highlightOverlay");

  map.on("load", () => {
    const layerGroups = OTEFDataContext.getLayerGroups();
    syncProjectionLayers(map, layerGroups);

    OTEFDataContext.subscribe("layerGroups", (groups) => {
      syncProjectionLayers(map, groups);
    });

    OTEFDataContext.subscribe("viewport", (viewport) => {
      updateHighlightFromViewport(viewport, modelBounds, highlightEl);
    });
  });

  const boundsEditorMod = await import("../projection/projection-bounds-editor.js");
  const rotationEditorMod = await import("../projection/projection-rotation-editor.js");
}

function initializeTableSwitcher() {
  if (typeof TableSwitcher !== "function") {
    throw new Error("TableSwitcher constructor not available");
  }

  const tableSwitcher = new TableSwitcher({
    defaultTable: "otef",
    onTableChange: (tableName) => {
      if (tableName !== "otef") {
        window.location.href = `/projection/?table=${tableName}`;
      }
    },
  });

  window.tableSwitcher = tableSwitcher;

  if (tableSwitcher.getCurrentTable() !== "otef") {
    window.location.href = `/projection/?table=${tableSwitcher.getCurrentTable()}`;
    return false;
  }

  if (typeof TableSwitcherPopup === "function") {
    new TableSwitcherPopup(tableSwitcher);
  }

  return true;
}

async function boot() {
  const shouldContinue = initializeTableSwitcher();
  if (!shouldContinue) return;
  await bootstrapProjectionRuntime();
}

boot().catch((error) =>
  console.error("[frontend-b] projection bootstrap failed", error)
);
```

- [ ] **Step 5: Manual integration test**

Start dev server and open projection page. **Verify:**
1. Model image displays
2. MapLibre canvas is transparent on top
3. Toggle layers from remote — they render on projection
4. Viewport highlight tracks GIS viewport
5. Heavy packs (`land_use`) render without freezing

- [ ] **Step 6: Commit**

```bash
git add otef-interactive/frontend/projection.html otef-interactive/frontend/src/projection/maplibre-projection.js otef-interactive/frontend/src/projection/maplibre-projection-layers.js otef-interactive/frontend/src/entries/projection-main.js
git commit -m "feat(otef): projection page running on MapLibre with transparent overlay"
```

---

## Task 7: Clean up dead code and update docs

**Files:**
- Delete: old Leaflet-specific files (see dead code list above)
- Modify: `otef-interactive/docs/performance-analysis.md`

- [ ] **Step 1: Remove dead Leaflet files**

Delete these files (only after confirming Tasks 5 and 6 work):

**Source files:**
```
otef-interactive/frontend/src/map/map-initialization.js
otef-interactive/frontend/src/map/leaflet-control-with-basemap.js
otef-interactive/frontend/src/map/map-geojson-layer-loader.js
otef-interactive/frontend/src/map/viewport-sync.js
otef-interactive/frontend/src/map/viewport-sync-scheduler.js
otef-interactive/frontend/src/map/viewport-apply-policy.js
otef-interactive/frontend/src/map/map-options.js
otef-interactive/frontend/src/map-utils/advanced-pmtiles-layer.js
otef-interactive/frontend/src/map-utils/layer-factory.js
otef-interactive/frontend/src/map-utils/visibility-controller.js
otef-interactive/frontend/src/map-utils/style-applicator.js
otef-interactive/frontend/src/projection/layer-renderer-canvas.js
otef-interactive/frontend/src/projection/wmts-layer-renderer.js
otef-interactive/frontend/src/projection/projection-animation-loop.js
otef-interactive/frontend/src/projection/highlight-smoothing-policy.js
```

**Test files for deleted modules (must also be removed to avoid test failures):**
```
otef-interactive/tests/map/viewport-apply-policy.test.js
otef-interactive/tests/map/viewport-apply-policy.zoom.test.js
otef-interactive/tests/map/viewport-sync.integration.test.js
otef-interactive/tests/map/leaflet-control-with-basemap.dedupe.test.js
otef-interactive/tests/architecture/hotspots/leaflet-control-split.test.js
otef-interactive/tests/architecture/hotspots/canvas-renderer-size.test.js
otef-interactive/tests/projection/highlight-smoothing-policy.test.js
```

Also check and update if they reference deleted modules:
```
otef-interactive/tests/contracts/entry-bootstrap-contract.test.js
otef-interactive/tests/contracts/runtime-global-contract.test.js
```

**Do NOT delete yet:**
- `advanced-style-engine.js` — the IR format is the contract consumed by the style bridge
- `advanced-style-drawing.js` — keep as reference until projection visuals are confirmed
- `projection-display.js` — keep as reference

- [ ] **Step 2: Update `performance-analysis.md`**

Append a new section to the end of `otef-interactive/docs/performance-analysis.md`:

```markdown
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

### PMTiles Coverage

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
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(otef): remove dead Leaflet code, update analysis with decisions"
```

---

## Notes for the Implementing Agent

1. **PMTiles source-layer naming**: When adding a PMTiles vector source to MapLibre, the `source-layer` name must match what tippecanoe used when generating the tiles. Check the manifest or use `pmtiles show <file>` to inspect layer names. If the source-layer name doesn't match, features won't render (silent failure).

2. **proj4 global**: The `proj4` library is loaded as a CDN `<script>` tag and available as `window.proj4`. The MapLibre modules use it directly for ITM↔WGS84 conversions.

3. **OTEFDataContext is unchanged**: The entire `otef-data-context/` directory and its WebSocket/actions modules remain as-is. The migration only changes what *consumes* the context (map rendering), not the state management layer.

4. **Existing tests**: Run `npx vitest run` before and after each task to ensure no regressions in existing tests. The new style bridge test is the only new test required.

5. **Docker**: The frontend is served by nginx as static files. After changing dependencies, you may need to rebuild the Docker image or volume-mount `node_modules`. The dev server (`npm run dev:frontend`) bypasses Docker for rapid iteration.

6. **Incremental validation**: Each task should be validated individually. If Task 5 (GIS wiring) shows issues, debug before proceeding to Task 6 (projection).

---

## Known Limitations & Follow-ups

These are explicitly out of scope for this plan but will need addressing:

1. **Curated layer rendering**: The curated layer Supabase sync modules load, but the actual drawing (pink line overlays, curated GeoJSON annotations) was Leaflet-specific. Needs a follow-up task to render curated layers via MapLibre.

2. **Hatch fills**: The style bridge renders hatches as solid fills with a console warning. Full fidelity requires generating pattern images and using `fill-pattern`. Track as a follow-up.

3. **Flow/reveal/trail animations** (e.g. `october_7th` attack routes): These used the Canvas 2D animation loop. MapLibre can approximate these with `line-gradient` or custom layers, but this needs a dedicated task.

4. **Marker-along-line** (`markerLine` type): Not implemented in the style bridge. Needs MapLibre `symbol` layer with `symbol-placement: line`.

5. **Projection bounds/rotation editors**: `projection-bounds-editor.js` and `projection-rotation-editor.js` interact with the Canvas directly. They load in the new `projection-main.js` but may need adjustments if they reference the old Canvas elements.

6. **Keyboard shortcuts on projection**: The old `projection-display.js` registered keyboard shortcuts (H = help, F = fullscreen, B = bounds editor). These are NOT reproduced in the new `projection-main.js`. Add them in a follow-up or port from `projection-display.js`.

7. **Contract tests**: `tests/contracts/entry-bootstrap-contract.test.js` and `tests/contracts/runtime-global-contract.test.js` reference old module lists and globals. Update them to reflect the new MapLibre bootstrap chain.
