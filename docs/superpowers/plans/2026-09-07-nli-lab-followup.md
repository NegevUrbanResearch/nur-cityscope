# NLI Lab Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the 2026-09-07 owner lab lock so GIS and projection share clock chrome, category colors + legend, people-name layout, Route 232, and highlight fade, while GIS mutes settlement names/leaders, impact outlines match in width, and archive close fans out with remote `closed`-wins.

**Architecture:** Keep the existing NLI clock + MapLibre investigation pipeline. This follow-up inverts a handful of 2026-09-06 paint locks (clock clamps/v1, GIS שמות allowlist, gold/purple fills, size-11 map-aligned names, empty-FC highlight, sand 232) without a second narrative controller. Shared DOM overlays (clock already exists; add legend). Archive uses same-origin `BroadcastChannel("otef-nli-archive")` plus remote result preference. Pack-prep restyles names and 232; do not hand-edit gitignored geojson.

**Tech Stack:** MapLibre GL, Vitest (`otef-interactive`), `nli_pack_prep.py` / `styles.py` via `python -m unittest`, Django unchanged.

**Spec:** `docs/superpowers/specs/2026-09-06-nli-visual-polish-design.md` (Owner lab lock 2026-09-07)

## Global Constraints

- GIS and projection share one design (tokens + same paint/motion). Almost no exceptions.
- GIS-only extras: named archive window, GIS clock layout debug, temporary mute of settlement names + leader lines on GIS (outlines stay).
- Split cameras unchanged. Projection never `flyTo` for a person.
- No Tesuga / `POST_TY` / `POST_SCALE` / `PROJECTION_SPAN` edits.
- Alarms idle/off unchanged.
- Do not reuse `#c31f4f` or `#f5c542` for polygon category fills.
- Do not `window.open("", "otef-nli-archive")`.
- `{ ok: true }` on archive close only if that handle’s `closed === true`.
- Stop/`idle` complete-story and no future ghosts stay as 2026-09-06.
- Tests: `cd otef-interactive && npm test -- <file>` or `python -m unittest` for pack-prep.
- Do not commit gitignored NLI geojson by hand; re-prep the accepted pack after script changes.

## File map

| File | Responsibility |
|---|---|
| `otef-interactive/frontend/src/projection/nli-explainer-overlay.js` | Storage keys `.v2`; `clampNliExplainerLayout` min width/height 2 |
| `otef-interactive/frontend/src/projection/nli-explainer-debug.js` | GIS rotation already gated on `enableRotation`; keep span/export off on GIS |
| `otef-interactive/frontend/src/shared/map-projection-config.js` | Committed `NLI_EXPLAINER_LAYOUT` JSON |
| `otef-interactive/frontend/src/entries/map-main.js` | `enableRotation: true`; GIS storage key import; mount legend |
| `otef-interactive/frontend/src/entries/projection-main.js` | Mount legend |
| `otef-interactive/frontend/css/styles.css` | Transparent clock-only caption; `font-size: inherit` from `fontPx`; legend chrome |
| `otef-interactive/frontend/src/shared/gis-layer-filter.js` | GIS allowlist `Tkuma_Area_LIne` + `ישובים` only |
| `otef-interactive/frontend/src/shared/maplibre-style-bridge.js` | GIS mute שמות labels; people_names viewport; exempt `nli.ציר_232` from hatch stroke scale; pack `ישובים` outline color parity |
| `otef-interactive/frontend/src/shared/maplibre-investigation-polygons.js` | Impact outline width 1.8, no `lineWidthMultiplier` |
| `otef-interactive/frontend/src/shared/nli-investigation-theme.js` | Category fills/outlines; highlight transition 400 ms |
| `otef-interactive/frontend/src/shared/nli-investigation-legend.js` | Shared legend overlay (create) |
| `otef-interactive/frontend/src/map/nli-archive-window.js` | `BroadcastChannel("otef-nli-archive")`; no-handle silent |
| `otef-interactive/frontend/src/remote/remote-people-archive-controller.js` | Same `requestId`: `closed` wins over `unavailable` |
| `otef-interactive/scripts/otef_layer_processing/styles.py` | people_names size 8, halo 0.12, `textRotationAlignment: viewport` |
| `otef-interactive/scripts/nli_pack_prep.py` | Wider radial; Route 232 brown/bold/opaque; label fill `(255, 224, 210)` |
| `otef-interactive/frontend/src/projection/maplibre-projection-viewport-geojson.js` | Keep highlight geometry below zoom 13 |
| `otef-interactive/frontend/src/projection/maplibre-projection.js` | Opacity lerp + 400 ms `*-opacity-transition` |
| `otef-interactive/AGENTS.md` | Stop = complete story; alarms idle/off |
| `otef-interactive/docs/nli-exhibit-verification.md` | Exhibit gates for this lock |

---

### Task 1: Clock chrome, fontPx, clamp 2%, GIS rotation, committed layout, storage v2

**Files:**
- Modify: `otef-interactive/frontend/src/projection/nli-explainer-overlay.js`
- Modify: `otef-interactive/frontend/src/shared/map-projection-config.js`
- Modify: `otef-interactive/frontend/src/entries/map-main.js`
- Modify: `otef-interactive/frontend/css/styles.css`
- Test: `otef-interactive/tests/projection/nli-explainer-overlay.test.js`
- Test: `otef-interactive/tests/projection/nli-explainer-debug.test.js`

**Interfaces:**
- Consumes: `applyNliExplainerLayout(hostEl, layout)` already sets `fontSize` to `fontPx` and CSS `rotate(rotateDeg)`
- Produces: `NLI_EXPLAINER_LAYOUT_STORAGE_KEY = "otef.nliExplainerLayout.v2"`; `NLI_GIS_CLOCK_LAYOUT_STORAGE_KEY = "otef.nliGisClockLayout.v2"`; `clampNliExplainerLayout` min width/height `2`; GIS `installNliExplainerDebug({ enableRotation: true })`

- [ ] **Step 1: Write the failing tests**

Invert overlay committed-left + clamp min. Invert GIS rotation / v1 key / CSS clamp assertions.

In `nli-explainer-overlay.test.js`, replace the committed-left expectation and add a min-2 clamp case:

```javascript
it("uses the committed calibrated left layout without changing full or right", () => {
  expect(MapProjectionConfig.NLI_EXPLAINER_LAYOUT).toEqual({
    full: { leftPct: 31.83, topPct: 48.95, widthPct: 16.7, heightPct: 19.75, fontPx: 12, rotateDeg: -48.5 },
    left: {
      leftPct: 30.810416666666665,
      topPct: 11.905247659352419,
      widthPct: 13.572916666666666,
      heightPct: 11.732162458836443,
      fontPx: 15,
      rotateDeg: 91.18739188335852,
    },
    right: { leftPct: 58, topPct: 68, widthPct: 42, heightPct: 26, fontPx: 22, rotateDeg: 0 },
  });
});

it("clamps width and height down to 2 percent so the box can hug the clock", () => {
  const out = clampNliExplainerLayout(
    { leftPct: 40, topPct: 40, widthPct: 1, heightPct: 1, fontPx: 12, rotateDeg: 0 },
    fallback,
  );
  expect(out.widthPct).toBe(2);
  expect(out.heightPct).toBe(2);
});
```

Keep the existing oversized clamp case (`widthPct: 40` still 40). Change storage-key exports:

```javascript
import {
  NLI_EXPLAINER_LAYOUT_STORAGE_KEY,
  NLI_GIS_CLOCK_LAYOUT_STORAGE_KEY,
} from "../../frontend/src/projection/nli-explainer-overlay.js";

it("bumps layout stores to v2 so lab v1 parks cannot shadow", () => {
  expect(NLI_EXPLAINER_LAYOUT_STORAGE_KEY).toBe("otef.nliExplainerLayout.v2");
  expect(NLI_GIS_CLOCK_LAYOUT_STORAGE_KEY).toBe("otef.nliGisClockLayout.v2");
});
```

In `nli-explainer-debug.test.js`:

- Import `NLI_GIS_CLOCK_LAYOUT_STORAGE_KEY` from the overlay module (delete the local `"otef.nliGisClockLayout.v1"` constant).
- Source scan: `expect(gis).toMatch(/enableRotation:\s*true/)` (invert `false`).
- GIS mount helper: `enableRotation: true`. Expect a rotate handle and `data-ned-field="rotateDeg"`. Invert `not.toMatch(/data-ned-field="rotateDeg"/)` and rotate-handle length `0`.
- Storage isolation: `expect(localStorage.getItem("otef.nliExplainerLayout.v2")).toBeNull()` and still never write v1 (`otef.nliExplainerLayout.v1` stays null).
- CSS: projection and GIS clock-only rules use `font-size: inherit`. Invert `--nli-gis-clock-size: clamp(...)` as the live clock size. Assert clock-only caption hosts are transparent:

```javascript
it("clock-only captions are transparent and inherit layout fontPx", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const css = fs.readFileSync(path.resolve(here, "../../frontend/css/styles.css"), "utf8");
  const main = fs.readFileSync(path.resolve(here, "../../frontend/src/entries/projection-main.js"), "utf8");
  void main;
  expect(css).toMatch(/#nliExplainerHost \.nli-tl-clock--clock-only/);
  expect(css).toMatch(/#nliGisClockHost \.nli-tl-clock--clock-only/);
  const explainerClock = css.slice(
    css.indexOf("#nliExplainerHost .nli-tl-clock--clock-only"),
    css.indexOf("#nliExplainerHost .nli-investigation-timeline-caption"),
  );
  expect(explainerClock).toMatch(/font-size:\s*inherit/);
  expect(explainerClock).not.toMatch(/--nli-projection-clock-size/);
  const explainerCaption = css.slice(
    css.indexOf("#nliExplainerHost .nli-investigation-timeline-caption"),
    css.indexOf("#nliGisClockHost"),
  );
  expect(explainerCaption).toMatch(/background:\s*transparent/);
  expect(explainerCaption).not.toMatch(/rgba\(12,\s*16,\s*22,\s*0\.62\)/);
  const gisCaption = css.slice(
    css.indexOf("#nliGisClockHost .nli-investigation-timeline-caption"),
  );
  expect(gisCaption).toMatch(/background:\s*transparent/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd otef-interactive && npm test -- tests/projection/nli-explainer-overlay.test.js tests/projection/nli-explainer-debug.test.js`

Expected: FAIL on left `rotateDeg` 0 / old leftPct, clamp min 8, storage v1, GIS `enableRotation: false`, projection clock using `--nli-projection-clock-size`, opaque caption.

- [ ] **Step 3: Write minimal implementation**

`nli-explainer-overlay.js`:

```javascript
export const NLI_EXPLAINER_LAYOUT_STORAGE_KEY = "otef.nliExplainerLayout.v2";
export const NLI_GIS_CLOCK_LAYOUT_STORAGE_KEY = "otef.nliGisClockLayout.v2";
```

In `clampNliExplainerLayout`, change width/height min from `8` to `2`. Do not strip `rotateDeg`.

`map-projection-config.js` `NLI_EXPLAINER_LAYOUT` — exact owner JSON (left `topPct` is `11.905247659352419`).

`map-main.js`: `enableRotation: true`. Keep `enableSpanGuards: false`, `enableLayoutMapExport: false`, `mergeProjectionLayout: false`, `storageKey: NLI_GIS_CLOCK_LAYOUT_STORAGE_KEY`.

`styles.css`:

- `#nliExplainerHost .nli-tl-clock--clock-only` and `#nliGisClockHost .nli-tl-clock--clock-only`: `font-size: inherit` (remove `var(--nli-projection-clock-size)` / host clamp as the clock size). Keep color `#fff`, weight 800, text-shadow.
- `#nliExplainerHost .nli-investigation-timeline-caption` and `#nliGisClockHost .nli-investigation-timeline-caption`: `background: transparent; padding: 0;` so the % box hugs HH:MM.
- `#nliGisClockHost` must not set `font-size: var(--nli-gis-clock-size)`. `applyNliExplainerLayout` owns host `fontSize`.

Do not add a second layout model. Do not teach GIS span/copy/download.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd otef-interactive && npm test -- tests/projection/nli-explainer-overlay.test.js tests/projection/nli-explainer-debug.test.js tests/projection/projection-slideshow-guards.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add otef-interactive/frontend/src/projection/nli-explainer-overlay.js otef-interactive/frontend/src/shared/map-projection-config.js otef-interactive/frontend/src/entries/map-main.js otef-interactive/frontend/css/styles.css otef-interactive/tests/projection/nli-explainer-overlay.test.js otef-interactive/tests/projection/nli-explainer-debug.test.js
git commit -m "feat(nli): clock fontPx, GIS rotate, layout v2"
```

---

### Task 2: GIS settlement name/leader mute + impact outline width parity

**Files:**
- Modify: `otef-interactive/frontend/src/shared/gis-layer-filter.js`
- Modify: `otef-interactive/frontend/src/shared/maplibre-style-bridge.js`
- Modify: `otef-interactive/frontend/src/shared/maplibre-investigation-polygons.js`
- Test: `otef-interactive/tests/shared/gis-layer-filter.test.js`
- Test: `otef-interactive/tests/map/maplibre-style-bridge.test.js`
- Test: `otef-interactive/tests/shared/maplibre-investigation-polygons.test.js`

**Interfaces:**
- Consumes: `shouldShowLayerOnGisMap(groupId, layerId)`; `irToMapLibreLayers(fullLayerId, sourceLayerId, layerConfig, styleOptions)`; `createInvestigationPolygonRenderer(map, profile)`
- Produces: GIS allowlist `{ Tkuma_Area_LIne, ישובים }`; GIS does not emit `*.שמות_יישובים` labels unless `applyProjectionHatchPresentation`; settlement impact overlay `line-width` `1.8` for both `NLI_DISPLAY_PROFILES.gis` and `.projection`

- [ ] **Step 1: Write the failing tests**

Invert GIS allowlist (today `שמות_יישובים` and `Locations_Lines` are `true`):

```javascript
test("returns true for projector_base settlement outlines on GIS, not names or leaders", () => {
  expect(shouldShowLayerOnGisMap("projector_base", "ישובים")).toBe(true);
  expect(shouldShowLayerOnGisMap("projector_base", "Tkuma_Area_LIne")).toBe(true);
  expect(shouldShowLayerOnGisMap("projector_base", "שמות_יישובים")).toBe(false);
  expect(shouldShowLayerOnGisMap("projector_base", "Locations_Lines")).toBe(false);
});
```

In `filterGroupsForGisMap` keep-allowlist test, expected ids become `["Tkuma_Area_LIne", "ישובים"]` only. Disabled-row test: filter still returns `ישובים` with `enabled: false`; `שמות_יישובים` / `Locations_Lines` are dropped even if listed.

Invert GIS label emission in `maplibre-style-bridge.test.js` (the case **without** `applyProjectionHatchPresentation`):

```javascript
it("does not emit GIS labels for projector_base שמות_יישובים without applyProjectionHatchPresentation", () => {
  const layerConfig = {
    geometryType: "point",
    style: {
      renderer: "simple",
      defaultSymbol: { symbolLayers: [] },
      labels: {
        field: "cityname",
        size: 14,
        color: "#ffffff",
        font: ["Guttman Hatzvi", "Noto Sans Regular"],
        haloColor: "#fafafa",
        haloSize: 1,
        colorOpacity: 1,
      },
    },
  };
  const result = irToMapLibreLayers("projector_base.שמות_יישובים", "src", layerConfig);
  expect(result.find((L) => L.type === "symbol")).toBeUndefined();
});
```

Keep the existing projection case that passes `{ applyProjectionHatchPresentation: true }` and still emits labels.

Impact outline width — add to `maplibre-investigation-polygons.test.js` (renderer already constructed with `{ lineWidthMultiplier: 1 }`; add a projection-profile sibling):

```javascript
it("uses the same impact outline width on GIS and projection profiles", () => {
  const gisMap = makeMap();
  const projMap = makeMap();
  const gis = createInvestigationPolygonRenderer(gisMap, { lineWidthMultiplier: 1 });
  const proj = createInvestigationPolygonRenderer(projMap, { lineWidthMultiplier: 1.2 });
  gis.sync({ frame: idleFrame, features: [], settlementFeatures: [settlement] });
  proj.sync({ frame: idleFrame, features: [], settlementFeatures: [settlement] });
  const gisLayer = gisMap.getLayer("nli-investigation-settlement-impact-outline");
  const projLayer = projMap.getLayer("nli-investigation-settlement-impact-outline");
  expect(gisLayer.paint["line-color"]).toBe("#c31f4f");
  expect(projLayer.paint["line-color"]).toBe("#c31f4f");
  expect(gisLayer.paint["line-width"]).toBe(1.8);
  expect(projLayer.paint["line-width"]).toBe(1.8);
});
```

Wire `idleFrame` / `settlement` / `makeMap` from fixtures already in that file. If `sync` names differ, use the same `update`/`apply` method the existing settlement tests call.

Pack outline color: if GIS vs projection `projector_base.ישובים` `line-color` already matches for the same IR stroke, assert equality (no color rewrite). If hatch currently diverges `line-color`, fix GIS to the projection stroke color in `symbolLayerToMapLibre` without joining sidecar OBJECTIDs.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd otef-interactive && npm test -- tests/shared/gis-layer-filter.test.js tests/map/maplibre-style-bridge.test.js tests/shared/maplibre-investigation-polygons.test.js`

Expected: FAIL allowlist still includes שמות / Locations_Lines; GIS still emits שמות labels; projection impact width is `1.8 * 1.2`.

- [ ] **Step 3: Write minimal implementation**

`gis-layer-filter.js`:

```javascript
const PROJECTOR_BASE_GIS_LAYERS = new Set([
  "Tkuma_Area_LIne",
  "ישובים",
]);
```

Update the file comment to match (temporary mute of names + leaders).

`shouldRenderMapLabelsFromStyle` in `maplibre-style-bridge.js`: `*.people_names` still always emit. `*.שמות_יישובים` emit only when `styleOptions.applyProjectionHatchPresentation === true` (projection). GIS default does not emit.

`maplibre-investigation-polygons.js` settlement overlay paint: `"line-width": 1.8` (drop `* Number(displayProfile.lineWidthMultiplier || 1)` on `SETTLEMENT_LAYER_ID` only). Keep `line-color` as `NLI_VISUAL_TOKENS.incidentRed`. Category outline motion may still use `lineWidthMultiplier`.

Do not change `keepSettlementNames`. Do not join sidecar OBJECTIDs.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd otef-interactive && npm test -- tests/shared/gis-layer-filter.test.js tests/map/maplibre-style-bridge.test.js tests/shared/maplibre-investigation-polygons.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add otef-interactive/frontend/src/shared/gis-layer-filter.js otef-interactive/frontend/src/shared/maplibre-style-bridge.js otef-interactive/frontend/src/shared/maplibre-investigation-polygons.js otef-interactive/tests/shared/gis-layer-filter.test.js otef-interactive/tests/map/maplibre-style-bridge.test.js otef-interactive/tests/shared/maplibre-investigation-polygons.test.js
git commit -m "feat(nli): mute GIS settlement names; match impact width"
```

---

### Task 3: Category color tokens + shared legend overlay

**Files:**
- Modify: `otef-interactive/frontend/src/shared/nli-investigation-theme.js`
- Create: `otef-interactive/frontend/src/shared/nli-investigation-legend.js`
- Modify: `otef-interactive/frontend/css/styles.css`
- Modify: `otef-interactive/frontend/src/entries/map-main.js`
- Modify: `otef-interactive/frontend/src/entries/projection-main.js`
- Test: `otef-interactive/tests/shared/nli-investigation-visual-state.test.js`
- Test: `otef-interactive/tests/shared/nli-investigation-legend.test.js` (create)

**Interfaces:**
- Consumes: `NLI_VISUAL_TOKENS.polygonCategories`; `INVESTIGATION_POLYGONS_FULL_ID` (`nli.investigation_polygons`)
- Produces: `mountNliInvestigationLegend(container) => { host, syncVisibility }`; `NLI_LEGEND_SHORT_LABELS` `{ "מרחב לחימה - קרב": "קרב", "מוקד חטיפה": "חטיפה", "שריפה": "שריפה" }`; `syncVisibility(polygonGroupEnabled: boolean)` sets `hidden`

- [ ] **Step 1: Write the failing tests**

Invert token fills in `nli-investigation-visual-state.test.js` (`polygonCategories` block):

```javascript
"מרחב לחימה - קרב": {
  fill: "#3d9a8c",
  outline: "#2a6b62",
  fillOpacity: 0.55,
  periodMs: 4000,
  fillOpacityMin: 0.45,
  fillOpacityMax: 0.62,
},
"מוקד חטיפה": {
  fill: "#e8a4b4",
  outline: "#c47388",
  fillOpacity: 0.55,
  periodMs: 2800,
  lineWidthMin: 1.4,
  lineWidthMax: 2.2,
  fillOpacityMin: 0.5,
  fillOpacityMax: 0.62,
},
"שריפה": {
  fill: "#d85a1f",
  outline: "#a33d12",
  fillOpacity: 0.55,
  periodMs: 1800,
  fillOpacityMin: 0.42,
  fillOpacityMax: 0.7,
},
```

Assert fills are not `#c31f4f` / `#f5c542` / `#c4a35a` / `#6b2d5b`.

Create `nli-investigation-legend.test.js`:

```javascript
import { describe, expect, it } from "vitest";
import { NLI_VISUAL_TOKENS } from "../../frontend/src/shared/nli-investigation-theme.js";
import {
  mountNliInvestigationLegend,
  NLI_LEGEND_SHORT_LABELS,
} from "../../frontend/src/shared/nli-investigation-legend.js";

function fakeContainer() {
  const children = [];
  return {
    children,
    querySelector(sel) {
      return children.find((c) => c.id === String(sel).replace(/^#/, "")) || null;
    },
    appendChild(child) {
      children.push(child);
      return child;
    },
  };
}

function fakeEl(id) {
  return {
    id,
    className: "",
    hidden: false,
    innerHTML: "",
    style: {},
    children: [],
    querySelector() { return null; },
    appendChild(child) { this.children.push(child); return child; },
  };
}

describe("nli investigation legend", () => {
  it("renders three short Hebrew swatches from category fill tokens", () => {
    const documentRef = { createElement: (tag) => fakeEl(tag) };
    const { host, syncVisibility } = mountNliInvestigationLegend(fakeContainer(), {
      documentRef,
      hostId: "nliInvestigationLegend",
    });
    expect(host.id).toBe("nliInvestigationLegend");
    const html = host.innerHTML;
    expect(html).toContain("קרב");
    expect(html).toContain("חטיפה");
    expect(html).toContain("שריפה");
    expect(html).toContain(NLI_VISUAL_TOKENS.polygonCategories["מרחב לחימה - קרב"].fill);
    expect(html).toContain(NLI_VISUAL_TOKENS.polygonCategories["מוקד חטיפה"].fill);
    expect(html).toContain(NLI_VISUAL_TOKENS.polygonCategories["שריפה"].fill);
    expect(NLI_LEGEND_SHORT_LABELS["מרחב לחימה - קרב"]).toBe("קרב");
    syncVisibility(false);
    expect(host.hidden).toBe(true);
    syncVisibility(true);
    expect(host.hidden).toBe(false);
  });
});
```

Source-scan both entries for `mountNliInvestigationLegend` and `nliInvestigationLegend`. CSS: `#nliInvestigationLegend` has `background: transparent` (or no opaque rgba card) and text-shadow; not `rgba(12, 16, 22, 0.62)`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd otef-interactive && npm test -- tests/shared/nli-investigation-visual-state.test.js tests/shared/nli-investigation-legend.test.js`

Expected: FAIL gold/purple tokens; missing legend module.

- [ ] **Step 3: Write minimal implementation**

Update `polygonCategories` fills/outlines only (keep fillOpacity and period fields).

`nli-investigation-legend.js`:

```javascript
import { NLI_VISUAL_TOKENS } from "./nli-investigation-theme.js";
import { INVESTIGATION_POLYGONS_FULL_ID } from "./nli-investigation-beats.js";

export const NLI_LEGEND_HOST_ID = "nliInvestigationLegend";
export const NLI_LEGEND_SHORT_LABELS = Object.freeze({
  "מרחב לחימה - קרב": "קרב",
  "מוקד חטיפה": "חטיפה",
  "שריפה": "שריפה",
});

export function polygonGroupEnabled(layerGroups) {
  const groups = Array.isArray(layerGroups) ? layerGroups : [];
  for (const group of groups) {
    if (group?.id !== "nli") continue;
    for (const layer of group.layers || []) {
      if (`${group.id}.${layer.id}` === INVESTIGATION_POLYGONS_FULL_ID) return layer.enabled === true;
    }
  }
  return false;
}

export function mountNliInvestigationLegend(container, options = {}) {
  const doc = options.documentRef || document;
  const hostId = options.hostId || NLI_LEGEND_HOST_ID;
  let host = container?.querySelector?.(`#${hostId}`);
  if (!host) {
    host = doc.createElement("div");
    host.id = hostId;
    host.className = "nli-investigation-legend";
    container.appendChild(host);
  }
  const cats = NLI_VISUAL_TOKENS.polygonCategories;
  host.innerHTML = Object.keys(NLI_LEGEND_SHORT_LABELS)
    .map((notes) => {
      const fill = cats[notes].fill;
      const label = NLI_LEGEND_SHORT_LABELS[notes];
      return `<span class="nli-investigation-legend__item"><i class="nli-investigation-legend__swatch" style="background:${fill}"></i>${label}</span>`;
    })
    .join("");
  function syncVisibility(enabled) {
    host.hidden = enabled !== true;
  }
  return { host, syncVisibility };
}
```

CSS (transparent, white/light text, text-shadow, no opaque card). Position as a small overlay (e.g. top-start on GIS, same module on projection — `%`/px is fine; not MapLibre).

Mount from `map-main.js` and `projection-main.js` next to the clock host. On `layerGroups` subscribe, `syncVisibility(polygonGroupEnabled(groups))`. Initial call with current groups.

Do not route this through `map-legend.js` / uniqueValue.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd otef-interactive && npm test -- tests/shared/nli-investigation-visual-state.test.js tests/shared/nli-investigation-legend.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add otef-interactive/frontend/src/shared/nli-investigation-theme.js otef-interactive/frontend/src/shared/nli-investigation-legend.js otef-interactive/frontend/css/styles.css otef-interactive/frontend/src/entries/map-main.js otef-interactive/frontend/src/entries/projection-main.js otef-interactive/tests/shared/nli-investigation-visual-state.test.js otef-interactive/tests/shared/nli-investigation-legend.test.js
git commit -m "feat(nli): teal/pink categories and shared legend"
```

---

### Task 4: Archive BroadcastChannel + remote closed-wins

**Files:**
- Modify: `otef-interactive/frontend/src/map/nli-archive-window.js`
- Modify: `otef-interactive/frontend/src/remote/remote-people-archive-controller.js`
- Test: `otef-interactive/tests/map/nli-archive-window.test.js`
- Test: `otef-interactive/tests/remote/remote-people-archive-controller.test.js`

**Interfaces:**
- Consumes: `createNliArchiveWindowController({ windowOpen, focus, onStateChange, broadcastChannel })`; `createNliArchiveCommandBridge({ windowController, emitResult, ... })`; `handleArchiveResult`
- Produces: `NLI_ARCHIVE_CHANNEL_NAME = "otef-nli-archive"`; close fans out `{ type: "close" }` to other same-origin controllers; controller `close()` with `handle === null` returns `{ ok: false, reason: "silent" }` and the bridge **does not** `emitResult`; `{ ok: true }` only if that handle `closed === true`; remote applies `closed` even after an earlier `unavailable` for the same `requestId`

- [ ] **Step 1: Write the failing tests**

Keep every existing honesty test (`no-op` → unavailable + handle retained; `closed === true` → `{ ok: true }`; no `window.open("", name)`). Add fan-out:

```javascript
import {
  createNliArchiveCommandBridge,
  createNliArchiveWindowController,
  NLI_ARCHIVE_CHANNEL_NAME,
} from "../../frontend/src/map/nli-archive-window.js";

function makeChannelPair() {
  const listenersA = [];
  const listenersB = [];
  const a = {
    name: NLI_ARCHIVE_CHANNEL_NAME,
    postMessage(msg) { listenersB.forEach((fn) => fn({ data: msg })); },
    addEventListener(_type, fn) { listenersA.push(fn); },
    close() {},
  };
  const b = {
    name: NLI_ARCHIVE_CHANNEL_NAME,
    postMessage(msg) { listenersA.forEach((fn) => fn({ data: msg })); },
    addEventListener(_type, fn) { listenersB.push(fn); },
    close() {},
  };
  return { a, b };
}

test("BroadcastChannel close fans out to a sibling live handle", () => {
  const { a, b } = makeChannelPair();
  const handleB = { closed: false, close: vi.fn(() => { handleB.closed = true; }), location: { replace: vi.fn() } };
  const gisA = createNliArchiveWindowController({ windowOpen: () => null, broadcastChannel: a });
  const gisB = createNliArchiveWindowController({ windowOpen: () => handleB, broadcastChannel: b });
  expect(gisB.navigate("https://www.nli.org.il/he/authorities/11")).toEqual({ ok: true });
  expect(gisA.close()).toEqual({ ok: false, reason: "silent" });
  expect(handleB.close).toHaveBeenCalled();
  expect(handleB.closed).toBe(true);
});

test("bridge stays silent when close has no handle", async () => {
  const results = vi.fn();
  const bridge = createNliArchiveCommandBridge({
    windowController: createNliArchiveWindowController({ windowOpen: () => null }),
    resolvePerson: async () => ({ nliUrl: "https://www.nli.org.il/he/authorities/11" }),
    getPersonSelection: () => ({ personId: "11", datasetVersion: "v1" }),
    emitResult: results,
  });
  await bridge.handleCommand({ action: "close", personId: "11", datasetVersion: "v1", requestId: "r-close", sourceId: "remote" });
  expect(results).not.toHaveBeenCalled();
});
```

Remote closed-wins — in `remote-people-archive-controller.test.js`, after an open, fire `unavailable` then `closed` for the **same** close `requestId`:

```javascript
it("prefers closed over unavailable for the same archive requestId", async () => {
  const dataContext = {
    archiveWindowCommand: vi.fn().mockResolvedValue({ acknowledged: true }),
    subscribe: (topic, fn) => {
      subscriptions[topic] = fn;
      return () => {};
    },
    getInvestigationClock: () => ({ phase: "idle" }),
  };
  // mount controller with the same helper the file already uses
  archiveButton.click(); // open
  const openId = dataContext.archiveWindowCommand.mock.calls[0][3];
  subscriptions.archiveWindowResult({ requestId: openId, personId: "11", datasetVersion: "v1", outcome: "navigation_attempted" });
  archiveButton.click(); // close
  const closeId = dataContext.archiveWindowCommand.mock.calls[1][3];
  subscriptions.archiveWindowResult({ requestId: closeId, personId: "11", datasetVersion: "v1", outcome: "unavailable" });
  subscriptions.archiveWindowResult({ requestId: closeId, personId: "11", datasetVersion: "v1", outcome: "closed" });
  expect(navigationSection.classList.contains("is-archive-open")).toBe(false);
  expect(status.textContent).toBe("");
});
```

Reuse the file’s existing `subscriptions` / `archiveButton` / `navigationSection` / `status` setup (the open/close test around the `navigation_attempted` then `closed` case). The new assertion is: `unavailable` first must not stick after `closed`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd otef-interactive && npm test -- tests/map/nli-archive-window.test.js tests/remote/remote-people-archive-controller.test.js`

Expected: FAIL missing channel export; no-handle still emits `unavailable`; remote first-result wins.

- [ ] **Step 3: Write minimal implementation**

`nli-archive-window.js`:

```javascript
export const NLI_ARCHIVE_CHANNEL_NAME = "otef-nli-archive";
```

Controller: optional `broadcastChannel` (default `new BroadcastChannel(NLI_ARCHIVE_CHANNEL_NAME)` when defined). On construct, `addEventListener("message", ...)`: if `event.data?.type === "close"`, run the honesty close sequence on the local handle and **do not** `window.open("", name)`.

`close()`:

- If `handle` is null: `postMessage({ type: "close" })` so siblings close; return `{ ok: false, reason: "silent" }` (do not `onStateChange` as unavailable in a way the bridge emits).
- If handle exists: existing honesty sequence; then `postMessage({ type: "close" })`; `{ ok: true }` only when `handle.closed === true`.

Bridge `handleCommand` close: if `closeResult?.reason === "silent"`, **do not** `emitResult`. If `ok === true`, emit `"closed"`. If `ok === false` and reason is `"unavailable"`, emit `"unavailable"`.

Remote `handleArchiveResult`: remember `lastRequestId`. If `outcome === "closed"` and `requestId` matches `archive.requestId` **or** `lastRequestId`, apply closed (clear pending, `is-archive-open` false, empty status) even when a prior unavailable already ran. If `outcome === "unavailable"` and that `requestId` already applied `closed`, return. Do not invent leases/iframes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd otef-interactive && npm test -- tests/map/nli-archive-window.test.js tests/remote/remote-people-archive-controller.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add otef-interactive/frontend/src/map/nli-archive-window.js otef-interactive/frontend/src/remote/remote-people-archive-controller.js otef-interactive/tests/map/nli-archive-window.test.js otef-interactive/tests/remote/remote-people-archive-controller.test.js
git commit -m "fix(nli): archive close fans out; remote prefers closed"
```

---

### Task 5: people_names viewport, size 8, halo 0.12, wider radial, pack-prep

**Files:**
- Modify: `otef-interactive/scripts/nli_pack_prep.py`
- Modify: `otef-interactive/scripts/otef_layer_processing/styles.py`
- Test: `otef-interactive/scripts/tests/test_nli_pack_prep.py`
- Test: `otef-interactive/tests/map/maplibre-style-bridge.test.js`

**Interfaces:**
- Consumes: `apply_people_name_offsets(features)`; `_apply_people_names_label_ir(label_config, lyrx_path)`
- Produces: IR `labels.size = 8`, `haloSize = 0.12`, `textRotationAlignment = "viewport"`, `offsetArrayProperty = "otef_map_text_offset_em"`; radial `r = min(1.8 + 0.45 * (n - 2), 4.5)` grouped by `round(source_lon, 6), round(source_lat, 6)`

- [ ] **Step 1: Write the failing tests**

Invert `test_people_names_lyrx_is_labels_only_point_with_name_and_force_visible`:

```python
self.assertEqual(float(labels["size"]), 8.0)
self.assertAlmostEqual(float(labels.get("haloSize") or 0), 0.12)
self.assertEqual(labels.get("textRotationAlignment"), "viewport")
self.assertEqual(labels["offsetArrayProperty"], "otef_map_text_offset_em")
self.assertIsNot(labels.get("offsetEmFromProperties"), True)
```

Invert cluster radius in `test_shared_source_coords_get_opposite_offsets_despite_jittered_geometry` (keep opposite-sum-zero; add magnitude):

```python
import math
self.assertAlmostEqual(math.hypot(off0[0], off0[1]), 1.8, places=6)
self.assertAlmostEqual(math.hypot(off1[0], off1[1]), 1.8, places=6)
```

Add a cap test:

```python
def test_radial_offset_radius_caps_at_4_5(self):
    features = [_point(34.47, 31.40, oct7_pid=i) for i in range(20)]
    apply_people_name_offsets(features)
    radii = [
        math.hypot(*feat["properties"]["otef_map_text_offset_em"])
        for feat in features
    ]
    self.assertTrue(all(abs(r - 4.5) < 1e-6 for r in radii))
```

Invert `maplibre-style-bridge.test.js` people_names fixture + assertions (`size: 8`, `haloSize: 0.12`, `textRotationAlignment: "viewport"`; `text-size` 8, `text-halo-width` 0.12, `text-rotation-alignment` `"viewport"`, `text-rotate` 0). Keep `forceVisible`, Regular font, `offsetArrayProperty`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd otef-interactive/scripts && python -m unittest tests.test_nli_pack_prep.JitterTests tests.test_nli_pack_prep.LyrxBuilderTests`

Then: `cd otef-interactive && npm test -- tests/map/maplibre-style-bridge.test.js`

Expected: FAIL size 11 / map / r=1.15.

- [ ] **Step 3: Write minimal implementation**

`nli_pack_prep.py` `apply_people_name_offsets`:

```python
radius = min(1.8 + 0.45 * (n - 2), 4.5) if n >= 2 else 0.0
```

Keep grouping on `round(lon, 6), round(lat, 6)` from `source_lon`/`source_lat`, pid sort, singletons `[0.0, 0.0]`.

`styles.py` `_apply_people_names_label_ir`:

```python
label_config["size"] = 8.0
label_config["haloSize"] = 0.12
label_config["textRotationAlignment"] = "viewport"
```

Keep Regular Guttman + Noto, white, `forceVisible`, `offsetArrayProperty`, pop `offsetEmFromProperties`. Update the function docstring (no “size 11” / “map rotation”).

Re-prep the accepted NLI pack on the lab machine after this lands. Do not hand-edit gitignored geojson.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd otef-interactive/scripts && python -m unittest tests.test_nli_pack_prep`

Run: `cd otef-interactive && npm test -- tests/map/maplibre-style-bridge.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add otef-interactive/scripts/nli_pack_prep.py otef-interactive/scripts/otef_layer_processing/styles.py otef-interactive/scripts/tests/test_nli_pack_prep.py otef-interactive/tests/map/maplibre-style-bridge.test.js
git commit -m "feat(nli): viewport people names size 8 with wider fans"
```

---

### Task 6: Route 232 brown/bold + hatch exemption

**Files:**
- Modify: `otef-interactive/scripts/nli_pack_prep.py`
- Modify: `otef-interactive/frontend/src/shared/maplibre-style-bridge.js`
- Test: `otef-interactive/scripts/tests/test_nli_pack_prep.py`
- Test: `otef-interactive/tests/map/maplibre-style-bridge.test.js`

**Interfaces:**
- Consumes: `ROUTE_232_*` constants; `scaleLineWidthPaintForProjection(lineWidth, hatchPresentation, fullLayerId)`
- Produces: `ROUTE_232_STROKE_COLOR = (135, 62, 35)`; `ROUTE_232_STROKE_WIDTH_PT = 2.0`; `ROUTE_232_STROKE_ALPHA = 100`; `ROUTE_232_LABEL_FILL = (255, 224, 210)`; `irToMapLibreLayers("nli.ציר_232", ..., { applyProjectionHatchPresentation: true })` line-width equals GIS (no `* 0.3`)

- [ ] **Step 1: Write the failing tests**

Invert `Route232OverlayTests.test_restyle_uses_thin_sand_stroke_without_casing` (rename in the test to brown, not sand):

```python
self.assertEqual(tuple(ROUTE_232_STROKE_COLOR), (135, 62, 35))
self.assertEqual(ROUTE_232_STROKE_WIDTH_PT, 2.0)
self.assertEqual(ROUTE_232_STROKE_ALPHA, 100)
self.assertEqual(strokes[0]["color"], "#873e23")
self.assertAlmostEqual(strokes[0]["opacity"], 1.0)
self.assertEqual(strokes[0]["width"], ROUTE_232_STROKE_WIDTH_PT * (96 / 72))
```

If a test asserts `ROUTE_232_LABEL_FILL == (255, 232, 196)`, invert to `(255, 224, 210)`.

Invert style-bridge `"applies the projection stroke scale to nli highway 232"`:

```javascript
it("does not apply the projection stroke scale to nli highway 232", () => {
  const layerConfig = {
    geometryType: "line",
    style: {
      renderer: "simple",
      defaultSymbol: {
        symbolLayers: [
          { type: "stroke", color: "#873e23", width: 2, opacity: 1 },
        ],
      },
    },
  };
  const gis = irToMapLibreLayers("nli.ציר_232", "nli__ציר_232", layerConfig);
  const proj = irToMapLibreLayers("nli.ציר_232", "nli__ציר_232", layerConfig, {
    applyProjectionHatchPresentation: true,
  });
  const lineG = gis.find((l) => l.type === "line");
  const lineP = proj.find((l) => l.type === "line");
  expect(lineG.paint["line-width"]).toBe(2);
  expect(lineP.paint["line-width"]).toBe(2);
  expect(lineP.paint["line-width"]).not.toBeCloseTo(2 * PROJECTION_MAPLIBRE_STROKE_WIDTH_SCALE);
});
```

Keep the generic pack-layer test that still scales other lines by `PROJECTION_MAPLIBRE_STROKE_WIDTH_SCALE`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd otef-interactive/scripts && python -m unittest tests.test_nli_pack_prep.Route232OverlayTests`

Run: `cd otef-interactive && npm test -- tests/map/maplibre-style-bridge.test.js`

Expected: FAIL sand RGB / scaled projection width.

- [ ] **Step 3: Write minimal implementation**

`nli_pack_prep.py`:

```python
ROUTE_232_STROKE_WIDTH_PT = 2.0
ROUTE_232_STROKE_COLOR = (135, 62, 35)
ROUTE_232_STROKE_ALPHA = 100
ROUTE_232_LABEL_FILL = (255, 224, 210)
```

Keep label halo `(20, 16, 12)` alpha 80 in `_tint_text_symbol`. Do not restyle investigation `nli.lines`.

`maplibre-style-bridge.js`: thread `fullLayerId` into `scaleLineWidthPaintForProjection`. If `String(fullLayerId) === "nli.ציר_232"`, return `lineWidth` unchanged even when `applyProjectionHatchPresentation` is true. `irToMapLibreLayers` already has `fullLayerId`; pass it through `symbolLayerToMapLibre` / simple+unique builders.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd otef-interactive/scripts && python -m unittest tests.test_nli_pack_prep.Route232OverlayTests`

Run: `cd otef-interactive && npm test -- tests/map/maplibre-style-bridge.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add otef-interactive/scripts/nli_pack_prep.py otef-interactive/scripts/tests/test_nli_pack_prep.py otef-interactive/frontend/src/shared/maplibre-style-bridge.js otef-interactive/tests/map/maplibre-style-bridge.test.js
git commit -m "feat(nli): brown Route 232 with matching GIS/table width"
```

---

### Task 7: Highlight opacity fade across zoom 13

**Files:**
- Modify: `otef-interactive/frontend/src/projection/maplibre-projection-viewport-geojson.js`
- Modify: `otef-interactive/frontend/src/projection/maplibre-projection.js`
- Modify: `otef-interactive/frontend/src/shared/nli-investigation-theme.js`
- Test: `otef-interactive/tests/projection/projection-bounds-rotation-maplibre-contract.test.js`
- Test: `otef-interactive/tests/shared/nli-investigation-visual-state.test.js`

**Interfaces:**
- Consumes: `viewportToHighlightGeoJSON(viewport, modelBounds)`; `updateHighlightFromViewport(map, viewport, modelBounds, highlightEl)`; `ensureProjectionHighlightLayers(map)`; `setProjectionHighlightVisibility(map, visible)`
- Produces: `NLI_VISUAL_TOKENS.highlightOpacityTransitionMs = 400`; GeoJSON **keeps** polygon features below zoom 13; paint fill/line opacity 0 below minzoom or full-extent, else fill `0.05` / line opacity `1`; transitions `{ duration: 400 }`; slideshow still `visibility: none`

- [ ] **Step 1: Write the failing tests**

Add token `highlightOpacityTransitionMs: 400` to the visual-state token matchObject.

Invert `"hides highlight below zoom 13"` — geometry stays:

```javascript
test("keeps highlight geometry below zoom 13", async () => {
  const { viewportToHighlightGeoJSON } = await import(
    "../../frontend/src/projection/maplibre-projection-viewport-geojson.js",
  );
  stubHighlightProj4();
  const fc = viewportToHighlightGeoJSON(
    { bbox: HIGHLIGHT_SMALL_BBOX, zoom: 12, corners: HIGHLIGHT_VALID_CORNERS },
    HIGHLIGHT_MODEL_BOUNDS,
  );
  expect(fc.features.length).toBe(1);
  expect(fc.features[0].geometry.type).toBe("Polygon");
  const atDefaultGisZoom = viewportToHighlightGeoJSON(
    { bbox: HIGHLIGHT_SMALL_BBOX, zoom: 11, corners: HIGHLIGHT_VALID_CORNERS },
    HIGHLIGHT_MODEL_BOUNDS,
  );
  expect(atDefaultGisZoom.features.length).toBe(1);
  delete globalThis.proj4;
});
```

Keep `"shows highlight at zoom 13 when not full extent"` as features.length === 1.

Invert missing-zoom tests: if bbox is valid, still return a polygon (opacity handles hide). Full-extent may still return geometry (opacity 0) — do **not** require an empty FC.

Add paint tests on `ensureProjectionHighlightLayers` / `updateHighlightFromViewport`:

```javascript
test("highlight layers fade opacity across zoom 13 instead of emptying the source", async () => {
  const {
    ensureProjectionHighlightLayers,
    updateHighlightFromViewport,
    PROJECTION_HIGHLIGHT_FILL_LAYER_ID,
    PROJECTION_HIGHLIGHT_LINE_LAYER_ID,
    PROJECTION_HIGHLIGHT_SOURCE_ID,
  } = await loadProjectionHighlightModule();
  stubHighlightProj4();
  const paints = new Map();
  const setData = vi.fn();
  const mockMap = {
    getSource: vi.fn((id) => (id === PROJECTION_HIGHLIGHT_SOURCE_ID ? { setData } : null)),
    getLayer: vi.fn((id) => paints.has(id) || true),
    addSource: vi.fn(),
    addLayer: vi.fn((layer) => paints.set(layer.id, layer.paint)),
    setPaintProperty: vi.fn((id, key, value) => {
      const paint = paints.get(id) || {};
      paint[key] = value;
      paints.set(id, paint);
    }),
    getContainer: vi.fn(() => ({ clientWidth: 800, clientHeight: 600 })),
  };
  ensureProjectionHighlightLayers(mockMap);
  const fill = [...paints.values()][0] || mockMap.addLayer.mock.calls[0][0].paint;
  expect(mockMap.addLayer.mock.calls[0][0].paint["fill-opacity-transition"]).toEqual({ duration: 400 });
  expect(mockMap.addLayer.mock.calls[1][0].paint["line-opacity-transition"]).toEqual({ duration: 400 });
  updateHighlightFromViewport(
    mockMap,
    { bbox: HIGHLIGHT_SMALL_BBOX, zoom: 12, corners: HIGHLIGHT_VALID_CORNERS },
    HIGHLIGHT_MODEL_BOUNDS,
    null,
  );
  expect(setData.mock.calls.at(-1)[0].features.length).toBe(1);
  expect(mockMap.setPaintProperty).toHaveBeenCalledWith(
    PROJECTION_HIGHLIGHT_FILL_LAYER_ID,
    "fill-opacity",
    0,
  );
  updateHighlightFromViewport(
    mockMap,
    { bbox: HIGHLIGHT_SMALL_BBOX, zoom: 13, corners: HIGHLIGHT_VALID_CORNERS },
    HIGHLIGHT_MODEL_BOUNDS,
    null,
  );
  expect(setData.mock.calls.at(-1)[0].features.length).toBe(1);
  expect(mockMap.setPaintProperty).toHaveBeenCalledWith(
    PROJECTION_HIGHLIGHT_FILL_LAYER_ID,
    "fill-opacity",
    0.05,
  );
  void fill;
  void PROJECTION_HIGHLIGHT_LINE_LAYER_ID;
  delete globalThis.proj4;
});
```

If `ensureProjectionHighlightLayers` returns early when the source already exists in this mock, call it on a map whose `getSource` is null first, then swap in `setData`. Slideshow tests that assert `setLayoutProperty(..., "visibility", "none")` stay.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd otef-interactive && npm test -- tests/projection/projection-bounds-rotation-maplibre-contract.test.js tests/shared/nli-investigation-visual-state.test.js`

Expected: FAIL empty FC below zoom 13; missing opacity-transition.

- [ ] **Step 3: Write minimal implementation**

`nli-investigation-theme.js`: `highlightOpacityTransitionMs: 400`.

`viewportToHighlightGeoJSON`: delete the early empty-FC return for `zoom < highlightMinZoom`. Valid bbox/corners still build a polygon. Invalid inputs still `null`. Full-extent: return geometry (do not empty); opacity handles hide.

`ensureProjectionHighlightLayers`: add `"fill-opacity-transition": { duration: NLI_VISUAL_TOKENS.highlightOpacityTransitionMs }`, `"line-opacity-transition": { duration: ... }`, and `"line-opacity": 1` (or 0 initial — first `updateHighlightFromViewport` sets it).

`updateHighlightFromViewport` MapLibre path: if `viewportToHighlightGeoJSON` returns `null`, return without `setData([])`. Otherwise `setData(geojson)` (always with features when valid). Then `setPaintProperty` fill-opacity / line-opacity: `0` when zoom is non-finite, `< highlightMinZoom`, or full-extent; else fill `NLI_VISUAL_TOKENS.highlightFillOpacity` and line-opacity `1`. Do not change Tesuga. Leave `setProjectionHighlightVisibility` for slideshow.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd otef-interactive && npm test -- tests/projection/projection-bounds-rotation-maplibre-contract.test.js tests/shared/nli-investigation-visual-state.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add otef-interactive/frontend/src/projection/maplibre-projection-viewport-geojson.js otef-interactive/frontend/src/projection/maplibre-projection.js otef-interactive/frontend/src/shared/nli-investigation-theme.js otef-interactive/tests/projection/projection-bounds-rotation-maplibre-contract.test.js otef-interactive/tests/shared/nli-investigation-visual-state.test.js
git commit -m "feat(nli): fade GIS highlight across zoom 13"
```

---

### Task 8: Docs — Stop paragraph + exhibit gates

**Files:**
- Modify: `otef-interactive/AGENTS.md`
- Modify: `otef-interactive/docs/nli-exhibit-verification.md`

**Interfaces:**
- Consumes: spec §1 Stop complete-story; Owner lab lock 2026-09-07 exhibit list
- Produces: AGENTS.md Stop sentence matches complete-story + alarms idle/off; verification doc rows for legend, clocks, names, archive-two-GIS, 232, highlight fade, GIS name mute

- [ ] **Step 1: Write the failing check (doc assertions via existing text scans if present; otherwise edit then verify by reading)**

If a test currently snapshots the AGENTS.md Stop sentence, invert it. Otherwise this task is the edit itself plus a grep gate in `nli-explainer-debug.test.js` or a small docs test is **not** required — the spec says Task 8 updates these two files.

Replace the AGENTS.md interaction bullet that currently says Stop resets polygons/outlines/alarms with:

```
- **Pause** freezes narrative reveal but completed-line flow continues.
  **Stop** / `idle` shows the complete investigation story (all category polygons,
  settlement impact outlines, completed route flow). Alarms stay idle/off.
```

Add a subsection to `nli-exhibit-verification.md` titled `2026-09-07 lab follow-up exhibit gates` with this table (date, operator, surface, pass/fail/blocker, notes):

| Gate | Must record |
|---|---|
| Clocks | GIS + projection: transparent caption, type sized from `fontPx`, GIS rotate handle works, committed parks match the spec JSON |
| Legend | `קרב` / `חטיפה` / `שריפה` readable at table distance; hidden when investigation polygons row is off |
| Names | Screen-horizontal from the **bottom of the projection**; dense clusters readable; GIS matches projection |
| GIS settlements | Outlines on; `שמות_יישובים` + leaders off GIS; projection names/leaders still on |
| Route 232 | Brown `#873e23`, not sand; same width on GIS and table; not investigation red `nli.lines` |
| Highlight | Zooming across 13 fades; no geometry pop |
| Archive two GIS | Two same-origin GIS documents: close fans out; remote does not stick on `unavailable` while a named window remains. Note localhost vs 127.0.0.1 as a remaining origin split |
| Crop | No Tesuga edits this pass; prior UV / TD blocker still stands |

Also update the stale remote check that still says GIS zoom `15` to zoom `16` if that line remains.

- [ ] **Step 2: Confirm the files contain the new sentences**

Run: `cd otef-interactive && npm test -- tests/projection/nli-explainer-debug.test.js`

Expected: PASS (no source-scan of the old Stop sentence). Manually confirm AGENTS.md and the verification table.

- [ ] **Step 3: No production JS beyond the two docs**

Do not change investigation renderers in this task.

- [ ] **Step 4: Re-read spec for leftover contradictions**

Confirm the docs do not say GIS `enableRotation: false`, GIS shows `שמות`, size 11, map-alignment, gold/purple fills, empty-FC highlight, or sand 232.

- [ ] **Step 5: Commit**

```bash
git add otef-interactive/AGENTS.md otef-interactive/docs/nli-exhibit-verification.md
git commit -m "docs(nli): Stop complete-story and 2026-09-07 exhibit gates"
```
