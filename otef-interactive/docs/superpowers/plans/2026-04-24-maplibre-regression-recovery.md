# MapLibre Regression Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore GIS + projection behavioral and visual parity after MapLibre migration, then harden sync/render paths so parity is stable under joystick, zoom, and heavy layer use.

**Architecture:** Keep MapLibre as the rendering runtime, but fix the current contract mismatches at boundaries: viewport/zoom state boundary, layer enable semantics, style IR translation, projection WMTS masking, curated style materialization, and animation wiring. Preserve existing APIs (`OTEFDataContext`, layer groups, curated heartbeat) and patch parity gaps with minimal targeted tests.

**Tech Stack:** MapLibre GL JS, PMTiles, proj4, OTEFDataContext, Vitest, Django Channels backend (unchanged)

---

## File Structure

### Files to modify
- `otef-interactive/frontend/src/remote/remote-controller.js` — fix zoom control base value handling for fractional zoom state.
- `otef-interactive/frontend/src/map/maplibre-viewport-sync.js` — port sequence/echo stabilization semantics and normalize zoom reporting contract.
- `otef-interactive/frontend/src/shared/otef-data-context/OTEFDataContext-actions.js` — tighten `interaction_guard` behavior and add reconciliation signal for blocked GIS reports.
- `otef-interactive/frontend/src/projection/maplibre-projection.js` — remove inline cyan styling; restore CSS-driven highlight style and improve highlight geometry stability.
- `otef-interactive/frontend/src/map/maplibre-layer-manager.js` — remove `group.enabled` hard gate, validate PMTiles `source-layer`, improve point color parity (`marker.fillColor`/co-emitted fill handling), and begin marker-line fallback support.
- `otef-interactive/frontend/src/projection/maplibre-projection-layers.js` — align WMTS enable semantics with per-layer visibility rules; implement projection WMTS masking strategy.
- `otef-interactive/frontend/src/map/maplibre-curated-layer-loader.js` — restore proposed dual-dash parity (`dashOffset` equivalent) and secondary color behavior.
- `otef-interactive/frontend/src/entries/map-main.js` — wire `OTEFDataContext.subscribe("animations")` to concrete MapLibre layer ids.
- `otef-interactive/frontend/src/entries/projection-main.js` — wire projection flow animation subscription and parity-safe teardown.
- `otef-interactive/frontend/src/shared/maplibre-flow-animation.js` — support deterministic phase offsets + map-scoped animation bookkeeping by full layer id mapping.
- `otef-interactive/frontend/src/shared/layer-state-helper.js` — preserve documented layer-state semantics and centralize resolver usage for MapLibre managers.
- `otef-interactive/frontend/css/styles.css` — ensure projection highlight style matches pre-migration design tokens.
- `otef-interactive/docs/performance-analysis.md` — append findings/progress updates as implementation advances.

### Existing tests to extend (preferred over adding many new files)
- `otef-interactive/tests/map/maplibre-viewport-sync.test.js`
- `otef-interactive/tests/map/maplibre-layer-manager.test.js`
- `otef-interactive/tests/map/maplibre-style-bridge.test.js`
- `otef-interactive/tests/map/maplibre-flow-animation.test.js`
- `otef-interactive/tests/projection/projection-curated-layer-reload.test.js`
- `otef-interactive/tests/projection/projection-bounds-rotation-maplibre-contract.test.js`

---

## Bug-to-Task Traceability

| Bug ID | Symptom | Task(s) |
|---|---|---|
| 0 | projection highlight/GIS viewport lose sync quickly | 2, 8 |
| 1 | joystick movement causes zoom drift (`11.267...`) and wrong `+` jump | 1, 2 |
| 2 | advanced styles / PMTiles polygons missing | 5 |
| 3 | markers render grey while legend is correct | 5 |
| 4 | curated proposed lines lose dual-dash/secondary color | 6 |
| 5 | animations appear broken | 7 |
| 6 | Gaza satellite image ignores mask | 4 |
| 7 | projection highlight design regressed (cyan vs white) | 8 |
| 8 | layer tiles do not enable unless pack toggle-all used first | 3 |

---

### Task 1: Fix Zoom Contract Drift and the 11.267 -> 12 Jump

**Files:**
- Modify: `otef-interactive/frontend/src/remote/remote-controller.js`
- Modify: `otef-interactive/frontend/src/map/maplibre-viewport-sync.js`
- Test: `otef-interactive/tests/map/maplibre-viewport-sync.test.js` (extend)

- [ ] **Step 1: Write failing regression test for zoom control contract**

```javascript
it("uses live fractional zoom as base and increments predictably", () => {
  const next = computeNextZoomFromLiveState({
    sliderValue: "11",
    liveViewportZoom: 15.8,
    delta: +1,
  });
  expect(next).toBeCloseTo(16.8, 6);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- tests/map/maplibre-viewport-sync.test.js`  
Expected: FAIL on old `parseInt(slider.value, 10)` / stale-slider base behavior.

- [ ] **Step 3: Implement zoom base unification**

```javascript
export function computeNextZoomFromLiveState({ sliderValue, liveViewportZoom, delta }) {
  const liveZoom = Number(liveViewportZoom);
  const sliderZoom = Number(sliderValue);
  const base = Number.isFinite(liveZoom) ? liveZoom : sliderZoom;
  return Math.max(10, Math.min(19, base + Number(delta || 0)));
}

function getCurrentZoomForControls() {
  const liveViewport = OTEFDataContext.getViewport?.();
  const liveZoom = Number(liveViewport?.zoom);
  if (Number.isFinite(liveZoom)) return liveZoom;

  const slider = document.getElementById("zoomSlider");
  const sliderZoom = slider ? Number(slider.value) : NaN;
  if (Number.isFinite(sliderZoom)) return sliderZoom;

  const stateZoom = Number(currentState.viewport?.zoom);
  return Number.isFinite(stateZoom) ? stateZoom : 15;
}
```

- [ ] **Step 4: Normalize viewport sync zoom policy**

```javascript
// maplibre-viewport-sync.js
const reportedZoom = map.getZoom();
dataContext.updateViewportFromUI({ bbox, zoom: reportedZoom, corners }, "gis");
// policy: keep fractional zoom end-to-end and only format to integer for display labels.
```

- [ ] **Step 5: Run test to verify pass**

Run: `npm run test -- tests/map/maplibre-viewport-sync.test.js`  
Expected: PASS.

---

### Task 2: Restore Viewport/Projection Sync Stability (No Fast Drift)

**Files:**
- Modify: `otef-interactive/frontend/src/map/maplibre-viewport-sync.js`
- Modify: `otef-interactive/frontend/src/shared/otef-data-context/OTEFDataContext-actions.js`
- Test: `otef-interactive/tests/map/maplibre-viewport-sync.test.js`

- [ ] **Step 1: Add failing test for interaction guard + reconciliation**

```javascript
it("reconciles map and context after interaction_guard during velocity loop", () => {
  const result = ctx.updateViewportFromUI(viewportPayload, "gis");
  expect(result).toEqual({ accepted: false, reason: "interaction_guard" });
  // then assert maplibre-viewport-sync schedules a single post-lock report attempt
  expect(reportSpy).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Port sequence-aware guard from Leaflet semantics**

```javascript
// maplibre-viewport-sync.js
// - track lastAppliedViewportSeq
// - ignore incoming viewport seq <= lastAppliedViewportSeq
// - release remote lock on settled apply and run one reconcile when GIS report was blocked
```

- [ ] **Step 3: Tighten apply path to single camera update**

```javascript
// preserve fitBounds+setZoom (required for explicit zoom parity),
// but emit a single post-apply reconcile event to avoid duplicate report loops.
```

- [ ] **Step 4: Verify with targeted test**

Run: `npm run test -- tests/map/maplibre-viewport-sync.test.js`  
Expected: PASS and no duplicate report loops in assertions.

---

### Commit Checkpoint A (Tasks 1-2)

- [ ] **Step 1: Stage files for Tasks 1-2**

Run:  
`git add otef-interactive/frontend/src/remote/remote-controller.js otef-interactive/frontend/src/map/maplibre-viewport-sync.js otef-interactive/frontend/src/shared/otef-data-context/OTEFDataContext-actions.js otef-interactive/tests/map/maplibre-viewport-sync.test.js`

- [ ] **Step 2: Commit**

```bash
git commit -m "fix(otef): stabilize maplibre zoom contract and viewport sync ordering

Unifies zoom base between remote controls and MapLibre viewport state, and ports
sequence-aware sync safeguards to prevent fast GIS/projection drift after joystick and zoom interactions."
```

---

### Task 3: Fix Layer Tile Behavior When Pack Toggle-All Is Off

**Files:**
- Modify: `otef-interactive/frontend/src/map/maplibre-layer-manager.js`
- Modify: `otef-interactive/frontend/src/projection/maplibre-projection-layers.js`
- Modify: `otef-interactive/frontend/src/shared/layer-state-helper.js`
- Test: `otef-interactive/tests/map/maplibre-layer-manager.test.js` (extend)

- [ ] **Step 1: Write failing test for per-layer enabled inside disabled group**

```javascript
it("applies layer when layer.enabled=true even if group.enabled=false", () => {
  const map = createMockMap();
  applyLayerGroupsToMap(map, [
    { id: "greens", enabled: false, layers: [{ id: "agri", enabled: true }] },
  ]);
  expect(map.addLayer).toHaveBeenCalled();
});
```

- [ ] **Step 2: Remove group-level short-circuit in MapLibre resolvers**

```javascript
for (const group of groups) {
  if (!group || !group.id) continue;
  for (const layer of group.layers || []) {
    if (layer?.enabled) enabled.add(`${group.id}.${layer.id}`);
  }
}
```

- [ ] **Step 3: Keep helper contract explicit and reuse it consistently**

```javascript
// keep layer-state-helper gate semantics unchanged for now;
// route MapLibre manager visibility via effective groups to preserve tile-level toggles.
```

- [ ] **Step 4: Run regression test**

Run: `npm run test -- tests/map/maplibre-layer-manager.test.js`  
Expected: PASS with layer-on/pack-off scenario covered.

---

### Task 4: Reintroduce Projection WMTS Masking (Gaza Satellite Clip)

**Files:**
- Modify: `otef-interactive/frontend/src/projection/maplibre-projection-layers.js`
- Reference: `otef-interactive/frontend/src/projection/wmts-layer-renderer.js`

- [ ] **Step 1: Add failing focused test or runtime assertion**

```javascript
it("applies configured mask for wmts layer before display", () => {
  const map = createProjectionMockMap();
  addWmtsSource(map, maskedLayerConfig);
  expect(map.addSource).toHaveBeenCalledWith(
    expect.stringContaining("mask"),
    expect.objectContaining({ type: "geojson" }),
  );
});
```

- [ ] **Step 2: Implement MapLibre mask strategy**

```javascript
// load mask GeoJSON via layerRegistry.getLayerMaskAssetUrl(...)
// create explicit mask source/layer ids per WMTS fullId
// apply mask compositing path and ensure remove deletes raster + mask artifacts
```

- [ ] **Step 3: Manual verification command**

Run: `npm run dev:frontend`  
Expected: `gaza.satellite_imagery` is clipped to configured mask extent on projection.

---

### Task 5: Fix Style Parity Gaps (Advanced Styles, PMTiles/Polygons, Grey Markers)

**Files:**
- Modify: `otef-interactive/frontend/src/map/maplibre-layer-manager.js`
- Modify: `otef-interactive/frontend/src/shared/maplibre-style-bridge.js`
- Test: `otef-interactive/tests/map/maplibre-style-bridge.test.js`

- [ ] **Step 1: Add failing tests for marker color + source-layer mismatch safety**

```javascript
it("maps marker fillColor to circle-color and avoids default grey fallback when style exists", () => {
  const layer = symbolLayerToMapLibre(
    { type: "markerPoint", marker: { fillColor: "#e84a5f", size: 10 } },
    "id",
  );
  expect(layer.paint["circle-color"]).toBe("#e84a5f");
});
it("uses explicit source-layer from config for pmtiles layers", () => {
  const name = getVectorSourceLayerName("greens.agri", { sourceLayer: "agri_tiles" });
  expect(name).toBe("agri_tiles");
});
```

- [ ] **Step 2: Implement point color parity**

```javascript
const fill = marker.fill ?? marker.fillColor ?? marker.color;
paint["circle-color"] = fill || "#808080";
```

- [ ] **Step 3: Harden PMTiles source-layer resolution**

```javascript
const sourceLayer = layerConfig.sourceLayer || layerConfig.source_layer || layerConfig.id;
if (!sourceLayer) {
  console.warn(`[MapLibre] Missing source-layer for ${fullId}`);
  return;
}
```

- [ ] **Step 4: Keep markerLine gap explicit and non-breaking**

```javascript
if (symbolLayer.type === "markerLine") {
  // temporary parity fallback/log until symbol-placement implementation lands
  return null;
}
```

- [ ] **Step 5: Run style bridge tests**

Run: `npm run test -- tests/map/maplibre-style-bridge.test.js`  
Expected: PASS for color and PMTiles assertions.

---

### Commit Checkpoint B (Tasks 3-5)

- [ ] **Step 1: Stage files for Tasks 3-5**

Run:  
`git add otef-interactive/frontend/src/map/maplibre-layer-manager.js otef-interactive/frontend/src/projection/maplibre-projection-layers.js otef-interactive/frontend/src/shared/layer-state-helper.js otef-interactive/frontend/src/shared/maplibre-style-bridge.js otef-interactive/tests/map/maplibre-layer-manager.test.js otef-interactive/tests/map/maplibre-style-bridge.test.js`

- [ ] **Step 2: Commit**

```bash
git commit -m "fix(otef): restore layer visibility semantics and projection masking parity

Removes pack-level gating regressions, reintroduces WMTS mask behavior on projection,
and closes major style parity gaps for PMTiles and point marker coloring."
```

---

### Task 6: Restore Curation Proposed Double-Dash Rendering

**Files:**
- Modify: `otef-interactive/frontend/src/map/maplibre-curated-layer-loader.js`
- Reference: `otef-interactive/frontend/src/map-utils/pink-route-map-styles.js`
- Test: `otef-interactive/tests/projection/projection-curated-layer-reload.test.js` (extend)

- [ ] **Step 1: Add failing test for proposed primary/secondary dash parity**

```javascript
it("keeps distinct primary and secondary proposed dash phases/colors", () => {
  const plan = planPinkCuratedOverlayLayers(samplePayload);
  const proposed = plan.operations.filter((op) => op.kind === "polyline");
  expect(proposed.length).toBeGreaterThan(1);
  expect(proposed[0].style.dashArray).not.toEqual(proposed[1].style.dashArray);
});
```

- [ ] **Step 2: Implement dash offset equivalent**

```javascript
// translate Leaflet dashOffset intent to MapLibre-compatible phase strategy
// ensure secondary layer does not appear transparent under primary stroke
```

- [ ] **Step 3: Verify in projection + GIS manually**

Run: `npm run dev:frontend`  
Expected: proposed lines are clearly double-dashed with visible secondary color.

---

### Task 7: Wire Animation State to MapLibre Layers

**Files:**
- Modify: `otef-interactive/frontend/src/entries/map-main.js`
- Modify: `otef-interactive/frontend/src/entries/projection-main.js`
- Modify: `otef-interactive/frontend/src/shared/maplibre-flow-animation.js`
- Test: `otef-interactive/tests/map/maplibre-flow-animation.test.js`

- [ ] **Step 1: Add failing test for OTEFDataContext animation toggle integration**

```javascript
it("starts/stops flow animation when context animation state changes", () => {
  const map = createMockMap();
  startFlowAnimation(map, "greens__agri__line__0", { speed: 1 });
  stopFlowAnimation(map, "greens__agri__line__0");
  expect(map.setPaintProperty).toHaveBeenCalled();
});
```

- [ ] **Step 2: Implement animation subscription wiring**

```javascript
OTEFDataContext.subscribe("animations", (animState) => {
  // resolve fullLayerId -> concrete MapLibre line layers
  // call startFlowAnimation / stopFlowAnimation deterministically
});
```

- [ ] **Step 3: Ensure teardown is map-scoped and leak-free**

```javascript
registerDisposer(() => stopAllFlowAnimations(map));
```

- [ ] **Step 4: Run animation tests**

Run: `npm run test -- tests/map/maplibre-flow-animation.test.js`  
Expected: PASS.

---

### Task 8: Restore Projection Highlight Visual Parity

**Files:**
- Modify: `otef-interactive/frontend/src/projection/maplibre-projection.js`
- Modify: `otef-interactive/frontend/css/styles.css`
- Test: `otef-interactive/tests/projection/projection-bounds-rotation-maplibre-contract.test.js` (extend)

- [ ] **Step 1: Add failing test for highlight styling contract**

```javascript
it("creates highlight box without overriding css border color tokens", () => {
  const host = document.createElement("div");
  updateHighlightFromViewport(sampleViewport, sampleModelBounds, host);
  const box = host.querySelector(".highlight-box");
  expect(box.style.border).toBe("");
});
```

- [ ] **Step 2: Remove inline cyan style and use class-based style**

```javascript
box.className = "highlight-box";
box.style.position = "absolute";
box.style.pointerEvents = "none";
// no inline border/color/transition tokens
```

- [ ] **Step 3: Verify full-extent hide/show and resize behavior**

Run: `npm run test -- tests/projection/projection-bounds-rotation-maplibre-contract.test.js`  
Expected: PASS with unchanged editor behavior.

---

### Commit Checkpoint C (Tasks 6-8 + docs)

- [ ] **Step 1: Update analysis docs with outcomes**

Modify: `otef-interactive/docs/performance-analysis.md` with bug-cluster findings and closure status.

- [ ] **Step 2: Stage files for Tasks 6-8 and docs**

Run:  
`git add otef-interactive/frontend/src/map/maplibre-curated-layer-loader.js otef-interactive/frontend/src/entries/map-main.js otef-interactive/frontend/src/entries/projection-main.js otef-interactive/frontend/src/shared/maplibre-flow-animation.js otef-interactive/frontend/src/projection/maplibre-projection.js otef-interactive/frontend/css/styles.css otef-interactive/tests/map/maplibre-flow-animation.test.js otef-interactive/tests/projection/projection-curated-layer-reload.test.js otef-interactive/tests/projection/projection-bounds-rotation-maplibre-contract.test.js otef-interactive/docs/performance-analysis.md`

- [ ] **Step 3: Commit**

```bash
git commit -m "fix(otef): complete maplibre parity for curation, animations, and projection highlight

Restores proposed-line visual semantics, wires animation state to MapLibre layers on
both surfaces, and aligns projection highlight styling/behavior with pre-migration parity."
```

---

## Final Verification (Required Before Declaring Completion)

- [ ] **Step 1: Run focused minimal regression suite**

Run:  
`npm run test -- tests/map/maplibre-viewport-sync.test.js tests/map/maplibre-style-bridge.test.js tests/map/maplibre-flow-animation.test.js tests/projection/projection-curated-layer-reload.test.js tests/projection/projection-bounds-rotation-maplibre-contract.test.js`

If Task 3 touched layer-gating logic, also run:
`npm run test -- tests/map/maplibre-layer-manager.test.js`

Expected: targeted tests PASS.

- [ ] **Step 2: Run lint on touched files**

Run: `npm run lint -- frontend/src/entries/map-main.js frontend/src/entries/projection-main.js frontend/src/map/maplibre-layer-manager.js frontend/src/projection/maplibre-projection-layers.js frontend/src/shared/maplibre-style-bridge.js frontend/src/map/maplibre-viewport-sync.js`

Expected: no new lints on touched paths.

- [ ] **Step 3: Manual parity verification checklist**

Run: `npm run dev:frontend` and verify:
- joystick/d-pad movement keeps zoom contract stable; no forced jump to 12 from unrelated baseline
- GIS viewport and projection highlight stay aligned after rapid zoom/pan
- advanced styles and PMTiles/polygon packs render on GIS + projection
- point markers render expected colors (not default grey unless style actually missing)
- curated proposed lines show double-dash + secondary color
- animation toggles visibly animate on both GIS and projection
- Gaza satellite respects mask extent on projection
- projection highlight styling matches pre-migration intent (white, not cyan)
- individual layer tiles work even when pack toggle-all is off

---

## Scope Guardrails

- **Branch:** `sync_and_layers_performance` (continue on current branch).
- Keep fixes focused on parity regressions; no broad refactors.
- Keep test additions minimal and regression-focused.
- Preserve `OTEFDataContext` as the single state authority.
- Do **not** introduce worktrees for this execution.
