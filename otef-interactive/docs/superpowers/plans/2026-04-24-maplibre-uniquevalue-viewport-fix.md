# MapLibre uniqueValue + viewport/highlight alignment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This plan overrides the usual “commit per task” habit:** no git commits until the implementer finishes and the human commits manually (see **VCS** below).

**Goal:** Restore full unique-value (multi-class) styling parity with the legacy `AdvancedStyleEngine` where gaps were caused by strict `["get", field]` and type mismatches, and align GIS MapLibre camera extents with projection highlight by fixing ITM→WGS84 bounds math and removing contradictory `fitBounds`+`setZoom` behavior when the bbox changes.

**Architecture:** (1) Centralize **classification key** reading in `maplibre-style-bridge.js` via a small expression builder (case-variant `coalesce` + `to-string`) and normalize **match labels** to strings so tile properties match `styles.json` classes. (2) Add a shared **four-corner ITM bbox → WGS84 axis-aligned hull** helper used by GIS viewport apply and projection `bboxToWGS84`, and (3) change `applyViewportToMap` so **`setZoom` runs only when the remote bbox did not change** (zoom-only updates), eliminating camera footprints that disagree with stored ITM bbox.

**October 7th “combined” / geometry-sibling clarification (product vocabulary):** Layers that share the same **base Hebrew name** but differ by **geometry suffix** (`אזור` polygon / `נקודה` point / `ציר` line) are **merged in the UI only** (`parseLayerNameWithGeometrySuffix` + `normalizeLayerBaseName` in `frontend/src/shared/layer-name-utils.js`; remote sheet in `layer-sheet-controller.js` `groupLayersByNameForSheet`; GIS legend in `legend-model-builder.js` `groupLayersByName`). A composite legend row shows the **union** of legend items built **per registry layer** from each sibling’s `styles.json` (`itemsFromUniqueValue` → `symbolIRToLegendItems`). **MapLibre still mounts one source + style stack per `groupId.layerId`** (`maplibre-layer-manager.js` `resolveEnabledFullIds` → `addLayerToMap`). So “not all types or values appear” can mean: (A) **bridge/tile** issues cause missing classes on **one or more** siblings; (B) **one sibling never loads** (missing `pmtilesFile` / URL, `getVectorSourceLayerName` bail-out, GeoJSON URL missing, `addLayer` rollback) while the legend still lists swatches from **other** siblings; (C) siblings use **different `uniqueValues.field` or class lists** — the legend union over-promises relative to any single geometry. After Tasks 1–3, if oct7 rows are still wrong, add targeted logging or manual checks that **every** `fullLayerId` in `row.fullLayerIds` reaches `addLayerToMap` without early `return` (see manager ~357–414).

**Tech Stack:** MapLibre GL JS 5.x (`maplibre-gl`), Vitest, existing `proj4` global in browser; tests stub `globalThis.proj4` as today.

**Verification note (2026-04-24):** Explore subagents confirmed ITM `bbox` is `[minEasting, minNorthing, maxEasting, maxNorthing]` with corners SW, SE, NE, NW (`OTEFDataContext-actions.js`, `maplibre-viewport-sync.js`), and that skipping `setZoom` when `boundsChanged` updates expectations in exactly two viewport tests (`re-applies explicit zoom…`, `cleans up map listeners…`).

**VCS:** Do **not** commit inside tasks. Finish implementation and tests, then **commit manually once** (or as you prefer) at the end. **No git worktrees** required for this plan.

---

## File map

| File | Responsibility |
|------|----------------|
| `frontend/src/map-utils/itm-bbox-to-wgs84-bounds.js` | **New** — pure function `itmBboxToWgs84SwNe(bbox)` projecting four ITM rectangle corners through proj4 and returning `[west, south, east, north]` in degrees. |
| `frontend/src/map/maplibre-viewport-sync.js` | Replace inline `itmBboxToWgs84` with import from new util; tighten `applyViewportToMap` `setZoom` guard. |
| `frontend/src/projection/maplibre-projection.js` | Replace `bboxToWGS84` body to use the same util (DRY with GIS). |
| `frontend/src/shared/maplibre-style-bridge.js` | Add `uniqueValueClassificationInputExpression(field)` (and helpers), use in `buildMatchExpr`, hatch `fill-pattern` `match`, and normalize match keys. |
| `tests/map/itm-bbox-to-wgs84-bounds.test.js` | **New** — unit tests for hull helper (proj4 call count + hull with skewed stub proj4). |
| `tests/map/maplibre-style-bridge.test.js` | New cases for case-variant field + string coercion of class values. |
| `tests/map/maplibre-viewport-sync.test.js` | Update two tests’ `setZoomCalls` expectations; optionally assert proj4/hull if exposed via map mock. |

---

### Task 1: Four-corner ITM → WGS84 bounds helper (TDD)

**Files:**
- Create: `d:\Projects\Nur\nur-cityscope\otef-interactive\frontend\src\map-utils\itm-bbox-to-wgs84-bounds.js`
- Create: `d:\Projects\Nur\nur-cityscope\otef-interactive\tests\map\itm-bbox-to-wgs84-bounds.test.js`
- Modify: `d:\Projects\Nur\nur-cityscope\otef-interactive\frontend\src\map\maplibre-viewport-sync.js` (import + replace `itmBboxToWgs84`)
- Modify: `d:\Projects\Nur\nur-cityscope\otef-interactive\frontend\src\projection\maplibre-projection.js` (`bboxToWGS84`)

- [ ] **Step 1: Write the failing test**

Create `tests/map/itm-bbox-to-wgs84-bounds.test.js`:

```javascript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { itmBboxToWgs84SwNe } from "../../frontend/src/map-utils/itm-bbox-to-wgs84-bounds.js";

describe("itmBboxToWgs84SwNe", () => {
  beforeEach(() => {
    globalThis.proj4 = vi.fn((from, to, xy) => {
      void from;
      void to;
      // Mild skew: easting affects longitude so SW/NE diagonal alone is wrong vs four corners
      const [x, y] = xy;
      return [x + 0.001 * y, y + 0.001 * x];
    });
  });
  afterEach(() => {
    delete globalThis.proj4;
  });

  it("projects four ITM corners and returns axis-aligned WGS84 hull", () => {
    const bbox = [100_000, 500_000, 101_000, 501_000]; // minX,minY,maxX,maxY
    const hull = itmBboxToWgs84SwNe(bbox);
    expect(globalThis.proj4).toHaveBeenCalledTimes(4);
    expect(hull).toHaveLength(4);
    const [w, s, e, n] = hull;
    expect(w <= e).toBe(true);
    expect(s <= n).toBe(true);
    // Hull must be at least as wide as naive SW/NE box in this skewed stub
    const sw = globalThis.proj4.mock.results[0].value;
    const ne = globalThis.proj4.mock.results[2].value;
    const naiveW = Math.min(sw[0], ne[0]);
    const naiveE = Math.max(sw[0], ne[0]);
    expect(w).toBeLessThanOrEqual(naiveW + 1e-9);
    expect(e).toBeGreaterThanOrEqual(naiveE - 1e-9);
  });

  it("returns null when proj4 missing or bbox invalid", () => {
    delete globalThis.proj4;
    expect(itmBboxToWgs84SwNe([0, 0, 1, 1])).toBeNull();
    globalThis.proj4 = vi.fn(() => [0, 0]);
    expect(itmBboxToWgs84SwNe(null)).toBeNull();
    expect(itmBboxToWgs84SwNe([0, 0, Number.NaN, 1])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd d:\Projects\Nur\nur-cityscope\otef-interactive
npm run test -- tests/map/itm-bbox-to-wgs84-bounds.test.js
```

Expected: **FAIL** — module not found or function not exported.

- [ ] **Step 3: Implement the helper**

Create `frontend/src/map-utils/itm-bbox-to-wgs84-bounds.js`:

```javascript
/**
 * Convert axis-aligned ITM bbox to WGS84 degrees [west, south, east, north]
 * using EPSG:2039 -> EPSG:4326 on all four rectangle corners (EPSG:2039 min/max).
 * @param {number[]} bbox [minEasting, minNorthing, maxEasting, maxNorthing]
 * @returns {number[]|null} [west, south, east, north] or null
 */
export function itmBboxToWgs84SwNe(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || typeof proj4 === "undefined") {
    return null;
  }
  if (!bbox.every((coord) => Number.isFinite(coord))) {
    return null;
  }
  const [minX, minY, maxX, maxY] = bbox;
  const corners = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
  const lngLat = [];
  for (const pt of corners) {
    const out = proj4("EPSG:2039", "EPSG:4326", pt);
    if (
      !Array.isArray(out) ||
      out.length !== 2 ||
      !Number.isFinite(out[0]) ||
      !Number.isFinite(out[1])
    ) {
      return null;
    }
    lngLat.push(out);
  }
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const [lng, lat] of lngLat) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return [west, south, east, north];
}
```

- [ ] **Step 4: Wire GIS + projection**

In `maplibre-viewport-sync.js`, delete the local `itmBboxToWgs84` function (currently **lines 7–35**) and add:

```javascript
import { itmBboxToWgs84SwNe } from "../map-utils/itm-bbox-to-wgs84-bounds.js";
```

Replace the body of `applyViewportToMap` where `itmBboxToWgs84(viewport.bbox)` was called with `itmBboxToWgs84SwNe(viewport.bbox)`.

In `maplibre-projection.js`, replace `bboxToWGS84` implementation to:

```javascript
import { itmBboxToWgs84SwNe } from "../map-utils/itm-bbox-to-wgs84-bounds.js";

function bboxToWGS84(bbox) {
  const hull = itmBboxToWgs84SwNe(bbox);
  if (!hull) return [NaN, NaN, NaN, NaN];
  return hull;
}
```

(Keep the same export surface for `updateProjectionViewport`.)

- [ ] **Step 5: Run tests**

```bash
npm run test -- tests/map/itm-bbox-to-wgs84-bounds.test.js tests/map/maplibre-viewport-sync.test.js
```

Expected: viewport tests may still pass (proj4 stub returns points unchanged for axis-aligned case). Hull test **PASS**.

---

### Task 2: Skip `setZoom` when remote bbox changes (camera matches stored ITM bbox)

**Files:**
- Modify: `d:\Projects\Nur\nur-cityscope\otef-interactive\frontend\src\map\maplibre-viewport-sync.js` (`applyViewportToMap` only)
- Modify: `d:\Projects\Nur\nur-cityscope\otef-interactive\tests\map\maplibre-viewport-sync.test.js`

- [ ] **Step 1: Write failing test adjustments first**

In `maplibre-viewport-sync.test.js`, change:

1. Test `"re-applies explicit zoom after fitBounds changes zoom"` (assertion ~**line 136**, test block **125–139**): replace  
   `expect(map.setZoomCalls).toEqual([{ zoom: 8, options: { animate: false } }]);`  
   with  
   `expect(map.setZoomCalls).toEqual([]);`

2. Test `"cleans up map listeners and viewport subscription"` (block ~**333–365**, assertion **line 363**): replace  
   `expect(map.setZoomCalls).toHaveLength(1);`  
   with  
   `expect(map.setZoomCalls).toHaveLength(0);`

Run:

```bash
npm run test -- tests/map/maplibre-viewport-sync.test.js
```

Expected: **FAIL** on those two assertions until implementation changes.

- [ ] **Step 2: Implement guard in `applyViewportToMap`**

Replace the block:

```javascript
  if (hasExplicitZoom && (zoomChanged || boundsChanged) && typeof map.setZoom === "function") {
    map.setZoom(targetZoom, { animate: false });
  }
```

with:

```javascript
  // When bbox changes, fitBounds defines the camera footprint that matches stored ITM bbox.
  // Calling setZoom afterward breaks parity with projection highlight (bbox-driven) and
  // amplifies error with zoom. Only honor explicit remote zoom when bounds did not change.
  if (
    hasExplicitZoom &&
    !boundsChanged &&
    zoomChanged &&
    typeof map.setZoom === "function"
  ) {
    map.setZoom(targetZoom, { animate: false });
  }
```

- [ ] **Step 3: Run tests**

```bash
npm run test -- tests/map/maplibre-viewport-sync.test.js
```

Expected: **PASS** (entire file).

---

### Task 3: Unique-value classification expression + string labels (TDD)

**Files:**
- Modify: `d:\Projects\Nur\nur-cityscope\otef-interactive\frontend\src\shared\maplibre-style-bridge.js`
- Modify: `d:\Projects\Nur\nur-cityscope\otef-interactive\tests\map\maplibre-style-bridge.test.js`

- [ ] **Step 1: Add failing tests**

Append to `describe("irToMapLibreLayers", …)` in `maplibre-style-bridge.test.js`:

```javascript
  it("uniqueValue fill-color uses coalesce+to-string for mixed-case field names", () => {
    const layerConfig = {
      geometryType: "polygon",
      style: {
        renderer: "uniqueValue",
        uniqueValues: {
          field: "Zone",
          classes: [
            {
              value: "a",
              symbol: {
                symbolLayers: [{ type: "fill", fillType: "solid", color: "#ff0000", opacity: 1 }],
              },
            },
          ],
        },
        defaultSymbol: {
          symbolLayers: [{ type: "fill", fillType: "solid", color: "#808080", opacity: 1 }],
        },
      },
    };

    const fill = irToMapLibreLayers("test.case", "test__case", layerConfig).find((l) => l.type === "fill");
    const fillColor = fill.paint["fill-color"];
    expect(fillColor[0]).toBe("match");
    const input = fillColor[1];
    expect(input[0]).toBe("to-string");
    expect(input[1][0]).toBe("coalesce");
    const coReads = input[1].slice(1, -1);
    expect(coReads).toEqual([
      ["get", "ZONE"],
      ["get", "Zone"],
      ["get", "zone"],
    ]);
    expect(fillColor).toEqual(["match", input, "a", "#ff0000", "#808080"]);
  });

  it("uniqueValue stringifies numeric class values for match labels", () => {
    const layerConfig = {
      geometryType: "polygon",
      style: {
        renderer: "uniqueValue",
        uniqueValues: {
          field: "k",
          classes: [
            {
              value: 1,
              symbol: {
                symbolLayers: [{ type: "fill", fillType: "solid", color: "#111111", opacity: 1 }],
              },
            },
          ],
        },
        defaultSymbol: {
          symbolLayers: [{ type: "fill", fillType: "solid", color: "#999999", opacity: 1 }],
        },
      },
    };
    const fill = irToMapLibreLayers("test.num", "test__num", layerConfig).find((l) => l.type === "fill");
    const fillColor = fill.paint["fill-color"];
    expect(fillColor[0]).toBe("match");
    expect(fillColor[1]).toEqual(["to-string", ["get", "k"]]);
    expect(fillColor[2]).toBe("1");
    expect(fillColor[3]).toBe("#111111");
    expect(fillColor[4]).toBe("#999999");
  });
```

**Important:** `fieldNameCaseVariants` must **dedupe** and **sort** so `coalesce` argument order is deterministic (implementation above uses `[...out].sort()`).

Run:

```bash
npm run test -- tests/map/maplibre-style-bridge.test.js
```

Expected: **FAIL** until bridge updated.

- [ ] **Step 2: Implement expression helpers in `maplibre-style-bridge.js`**

Add after `getNestedProp` (keep helpers **unexported** unless another module needs them):

```javascript
function fieldNameCaseVariants(field) {
  if (!field || typeof field !== "string") return [field];
  const out = new Set();
  out.add(field);
  out.add(field.toLowerCase());
  out.add(field.toUpperCase());
  if (field.length > 1) {
    out.add(field.charAt(0).toUpperCase() + field.slice(1).toLowerCase());
  }
  return [...out].sort();
}

function uniqueValueClassificationInputExpression(field) {
  const variants = fieldNameCaseVariants(field);
  if (variants.length === 1) {
    return ["to-string", ["get", variants[0]]];
  }
  const reads = variants.map((v) => ["get", v]);
  return ["to-string", ["coalesce", ...reads, ""]];
}

function normalizeUniqueValueMatchKey(value) {
  if (value === undefined || value === null) return null;
  return String(value);
}
```

In `buildMatchExpr`, replace `const expression = ["match", ["get", field]]` with `const expression = ["match", uniqueValueClassificationInputExpression(field)]`.

Replace the match loop body with:

```javascript
  for (const { value, entryValue } of entryRows) {
    const resolved = entryValue == null ? effectiveFallback : (entryValue ?? effectiveFallback);
    if (resolved == null) continue;
    if (!valuesEqual(resolved, effectiveFallback)) allMatchFallback = false;
    const label = normalizeUniqueValueMatchKey(value);
    if (label == null) continue;
    expression.push(label, toExpressionValue(resolved));
  }
```

In `buildMatchLayer` uniqueValue **hatch** branch, replace `const expression = ["match", ["get", field]]` with the same input expression, and push `normalizeUniqueValueMatchKey(value)` instead of raw `value` for each class row in that `match`.

- [ ] **Step 3: Update existing tests that pin the old match input**

In `maplibre-style-bridge.test.js`, replace every paint/layout expectation that starts a `match` with `["get", "<field>"]` as the second element. For a single-variant lowercase field `mimush`, the new input is `["to-string", ["get", "mimush"]]`.

Run:

```bash
rg "\[\"match\", \[\"get\"," tests/map/maplibre-style-bridge.test.js
```

Update each hit.

- [ ] **Step 4: Run full bridge tests**

```bash
npm run test -- tests/map/maplibre-style-bridge.test.js
```

Expected: **PASS**.

---

### Task 4: Regression sweep ( targeted )

**Files:** none new

**Order:** Run **after Task 1** has created `tests/map/itm-bbox-to-wgs84-bounds.test.js`. Until then, omit that path from the command (Vitest errors on missing files).

- [ ] **Step 1: Run combined test command**

From repo **`otef-interactive/`** (same cwd as other `npm run test` steps in this plan):

```bash
cd d:\Projects\Nur\nur-cityscope\otef-interactive
npm run test -- tests/map/maplibre-style-bridge.test.js tests/map/maplibre-viewport-sync.test.js tests/map/itm-bbox-to-wgs84-bounds.test.js tests/map/maplibre-layer-manager.test.js
```

Expected: **0 failed** tests. `maplibre-layer-manager.test.js` does not import viewport or ITM helpers today; re-run if Task 3 changes the bridge contract mocked by that file.

- [ ] **Step 2: Fix failures if any**

If tests fail, fix the underlying code or tests and re-run Step 1 until green. No separate VCS step here.

---

### Task 5 (Optional follow-up): Verify all geometry siblings in a merged row load

**When:** After Tasks 1–4, if October 7th (or similar) composite rows still miss a **whole geometry type** (e.g. line shows, points do not).

**Files:**
- Modify: `d:\Projects\Nur\nur-cityscope\otef-interactive\frontend\src\map\maplibre-layer-manager.js` (temporary `console.warn` with `fullId` + reason on early `return`, or gated `OTEF_DEBUG_LAYERS`)
- Or: manual checklist in QA doc (no code)

**Steps:**
- [ ] For one failing base name (e.g. `חדירה_לישוב`), list every `october_7th.<id>` in `row.fullLayerIds` from the remote sheet HTML / state dump.
- [ ] In DevTools, confirm each id has `layerRegistry.getLayerConfig(fullId)` and that `addLayerToMap` does not return early (PMTiles URL, `getVectorSourceLayerName`, GeoJSON `dataUrl`, empty `irToMapLibreLayers`).
- [ ] If one sibling lacks PMTiles while others have it, treat as **data/pipeline** follow-up, not style-bridge only.

---

### Task 6 (Optional P2): Projection highlight vs `bearing` / model stretch

**Files:**
- Modify: `d:\Projects\Nur\nur-cityscope\otef-interactive\frontend\src\projection\maplibre-projection.js`
- Modify: `d:\Projects\Nur\nur-cityscope\otef-interactive\frontend\css\styles.css` (only if needed for transform origin)

**Scope:** If manual QA after Tasks 1–4 still shows **constant** skew between model photo and vectors, consider CSS `transform: rotate(...)` on `.highlight-box` using negative `modelBounds.bearing` with `transform-origin` at the physical table center — only after confirming `object-fit: fill` vs `model-bounds` aspect ratio is not the sole cause.

- [ ] **Step 1: Record decision** (issue / notes) — skip implementation until repro photos confirm bearing is the culprit.

---

## Plan verification (subagents + doc pass, 2026-04-24)

Cross-checked against `otef-interactive` sources; corrections applied above (file-map helper name, viewport test line hints, Task 4 ordering + cwd).

- **Task 1–2:** `itmBboxToWgs84` **L7–35**, `setZoom` guard **L97–101** in `maplibre-viewport-sync.js`; imports `../map-utils/itm-bbox-to-wgs84-bounds.js` valid from `map/` and `projection/`. `bboxToWGS84` in `maplibre-projection.js` **L87–95** (two-corner today). Only **two** tests need `setZoomCalls` expectation updates besides unchanged **"applies remote zoom when bounds are unchanged"** (~L120). Bare `proj4` in a new module matches existing viewport-sync + Vitest `globalThis.proj4` pattern.
- **Task 3:** `buildMatchExpr` and hatch use `["match", ["get", field]]` at **L197** and **L329**; expect **~10** `match`+`get` expectations to update in `maplibre-style-bridge.test.js`. `coalesce` + `""` fallback is style-spec–consistent; `"Zone"` sorted variants **`["ZONE","Zone","zone"]`**.
- **Task 4:** `itm-bbox-to-wgs84-bounds.test.js` must exist before including it in the vitest list; `maplibre-layer-manager.test.js` has no direct ITM/viewport import (mock-based).

---

## Self-review (author checklist)

1. **Spec coverage:** Multi-class parity (case + type) → Task 3. Highlight vs GIS growth on zoom → Tasks 1–2. Four-corner hull → Task 1. Oct7 geometry siblings → Task 5 follow-up. Optional skew → Task 6.
2. **Placeholder scan:** No TBD sections; optional Tasks 5–6 are explicitly gated on QA / residual repro.
3. **Type consistency:** `itmBboxToWgs84SwNe` returns `[west,south,east,north]` matching current `itmBboxToWgs84` contract in `maplibre-viewport-sync.js`.

---

## Execution handoff

Plan complete and saved to `d:\Projects\Nur\nur-cityscope\otef-interactive\docs\superpowers\plans\2026-04-24-maplibre-uniquevalue-viewport-fix.md`.

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task (Task 1 → Task 2 → Task 3 → Task 4), with spec-then-quality review between tasks per `subagent-driven-development`. For this plan, **defer all git commits** to the human at the end (see **VCS** above).

**2. Inline Execution** — Run Tasks 1–4 in order in one session with human checkpoints after each task (or logical batch), then commit manually when done.

Which approach do you want for execution?
