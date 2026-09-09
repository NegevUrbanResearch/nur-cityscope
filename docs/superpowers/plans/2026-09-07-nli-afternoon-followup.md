# NLI Afternoon Lab Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the 2026-09-07 afternoon owner lab lock: commit the new left clock park, run blocking NLI pack re-prep for Route 232 and people_names, fold polygon category rows into `#mapLegend` on GIS and projection, make person `flyTo` use `navigationTravelActive` until idle, and drive one shared integer text heading for people_names plus projection שמות.

**Architecture:** Keep the existing NLI clock + MapLibre investigation pipeline. Do not add a second narrative controller, a second legend HUD, or highlight-geometry lerp. Person search reuses the place-travel flag in `maplibre-viewport-sync.js`. One heading module applies a static `text-rotate` to `nli__people_names__labels` and `projector_base__שמות_יישובים__labels`. Pack re-prep writes live processed IR; do not commit gitignored geojson/lyrx.

**Tech Stack:** MapLibre GL, Vitest (`otef-interactive`), `nli_pack_prep.py` / `process_layers.py` / `styles.py` via `.venv` Python, Django unchanged.

**Spec:** `docs/superpowers/specs/2026-09-06-nli-visual-polish-design.md` (Owner lab lock 2026-09-07 afternoon)

## Global Constraints

- Stay on `dev`. Do not push. Do not work on `main`.
- Copy locked product decisions verbatim. Do not reopen clock JSON, legend HUD, pack re-prep, highlight travel, or heading snap.
- Keep storage keys `.v2` (`otef.nliExplainerLayout.v2`, `otef.nliGisClockLayout.v2`).
- Stop complete-story, no future ghosts, alarms idle/off, GIS mute of `שמות_יישובים` + leaders, GIS clock rotate, Tesuga deferred, no `window.open("", name)`, highlight keep-geometry + 400 ms opacity at zoom 13, category fills `#3d9a8c` `#e8a4b4` `#d85a1f`, archive `BroadcastChannel("otef-nli-archive")`.
- Projection never `flyTo` for a person. Do not wire `PROJECTION_LERP_FACTOR` during person flyTo. Do not lerp highlight geometry.
- Do not lift GIS שמות mute. Remote layer sheet stays one glossary row.
- Do not `fetch_data --force`. Do not `--no-cache` other packs. Do not commit gitignored geojson/lyrx.
- Tests from `otef-interactive`: `npm test -- <file>`. Pack-prep: `.\.venv\Scripts\python.exe -m unittest ...`.
- Windows PowerShell for commits: `git commit -m "message"`.

---

## File map

| File | Responsibility |
|---|---|
| `otef-interactive/frontend/src/shared/map-projection-config.js` | Afternoon `NLI_EXPLAINER_LAYOUT` left park; full/right unchanged |
| `otef-interactive/tests/projection/nli-explainer-overlay.test.js` | Assert committed layout JSON |
| `otef-interactive/scripts/otef_layer_processing/styles.py` | people_names IR: `textRotationAlignment: map` (size 8, halo 0.12, `offsetArrayProperty` stay) |
| `otef-interactive/scripts/nli_pack_prep.py` | Already brown 232 + people_names lyrx; **run** it (blocking) |
| `otef-interactive/scripts/process_layers.py` | Process only `nli` layers `ציר_232` and `people_names` |
| `otef-interactive/public/processed/layers/nli/styles.json` | Live processed IR to verify; gitignored; do not commit |
| `otef-interactive/tests/nli/nli-processed-styles-afternoon-lock.test.js` | Read live processed styles when present; report values |
| `otef-interactive/scripts/tests/test_nli_pack_prep.py` | Invert people_names alignment `viewport` → `map` |
| `otef-interactive/frontend/src/map/legend-model-builder.js` | Surface `gis` \| `projection`; three-row investigation polygons; skip GIS-filter on projection |
| `otef-interactive/frontend/src/map/map-legend.js` | `updateMapLegend({ surface })` |
| `otef-interactive/frontend/src/shared/nli-investigation-legend.js` | Keep `NLI_LEGEND_SHORT_LABELS`; add `investigationPolygonLegendItems`; delete `mountNliInvestigationLegend` |
| `otef-interactive/frontend/src/entries/map-main.js` | Remove overlay mount; pass `beginCameraTravel`; `updateMapLegend({ surface: "gis" })`; apply heading |
| `otef-interactive/frontend/src/entries/projection-main.js` | Remove overlay mount; mount `#mapLegend`; apply heading |
| `otef-interactive/frontend/projection.html` | Add `#mapLegend` |
| `otef-interactive/frontend/css/styles.css` | Stop using `#nliInvestigationLegend` as a second overlay |
| `otef-interactive/frontend/src/map/maplibre-viewport-sync.js` | Export `beginCameraTravel` on disposer; person fly shares place-travel flag |
| `otef-interactive/frontend/src/map/maplibre-person-selection.js` | Call `beginCameraTravel` before person `flyTo` |
| `otef-interactive/frontend/src/shared/nli-label-heading.js` | One integer heading: snap 1°, persist, apply to both label layers |
| `otef-interactive/frontend/src/projection/projection-shemot-label-debug.js` | 1° snap; set global heading; export `{ version: 2, headingDeg }`; keep per-feature offsets |
| `otef-interactive/frontend/src/shared/maplibre-style-bridge.js` | people_names + שמות live rotate is static heading, not `angleFromProperties` |
| `otef-interactive/docs/nli-exhibit-verification.md` | Afternoon exhibit gates (Task 6) |

---

### Task 1: Committed left clock JSON

**Files:**
- Modify: `otef-interactive/frontend/src/shared/map-projection-config.js`
- Test: `otef-interactive/tests/projection/nli-explainer-overlay.test.js`

**Interfaces:**
- Consumes: existing `MapProjectionConfig.NLI_EXPLAINER_LAYOUT`, `NLI_EXPLAINER_LAYOUT_STORAGE_KEY` (`otef.nliExplainerLayout.v2`)
- Produces: exact afternoon JSON (left park only changed; full/right unchanged). Storage keys stay `.v2`.

- [ ] **Step 1: Write the failing test**

In `otef-interactive/tests/projection/nli-explainer-overlay.test.js`, replace the committed-layout assertion:

```javascript
it("uses the committed calibrated left layout without changing full or right", () => {
  expect(MapProjectionConfig.NLI_EXPLAINER_LAYOUT).toEqual({
    full: { leftPct: 31.83, topPct: 48.95, widthPct: 16.7, heightPct: 19.75, fontPx: 12, rotateDeg: -48.5 },
    left: {
      leftPct: 47.16458333333333,
      topPct: 14.320176309187765,
      widthPct: 13.572916666666666,
      heightPct: 11.732162458836443,
      fontPx: 15,
      rotateDeg: 91.18739188335852,
    },
    right: { leftPct: 58, topPct: 68, widthPct: 42, heightPct: 26, fontPx: 22, rotateDeg: 0 },
  });
});
```

Keep the existing `.v2` storage-key assertion. Do not bump to `.v3`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd otef-interactive; npm test -- tests/projection/nli-explainer-overlay.test.js`

Expected: FAIL because `left.leftPct` is still `30.810416666666665` (morning park).

- [ ] **Step 3: Write minimal implementation**

In `otef-interactive/frontend/src/shared/map-projection-config.js`, set `NLI_EXPLAINER_LAYOUT` to:

```javascript
NLI_EXPLAINER_LAYOUT: {
  full: { leftPct: 31.83, topPct: 48.95, widthPct: 16.7, heightPct: 19.75, fontPx: 12, rotateDeg: -48.5 },
  left: {
    leftPct: 47.16458333333333,
    topPct: 14.320176309187765,
    widthPct: 13.572916666666666,
    heightPct: 11.732162458836443,
    fontPx: 15,
    rotateDeg: 91.18739188335852,
  },
  right: { leftPct: 58, topPct: 68, widthPct: 42, heightPct: 26, fontPx: 22, rotateDeg: 0 },
},
```

Do not change `NLI_EXPLAINER_LAYOUT_STORAGE_KEY` or `NLI_GIS_CLOCK_LAYOUT_STORAGE_KEY`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd otef-interactive; npm test -- tests/projection/nli-explainer-overlay.test.js tests/projection/nli-explainer-debug.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```powershell
git add otef-interactive/frontend/src/shared/map-projection-config.js otef-interactive/tests/projection/nli-explainer-overlay.test.js
git commit -m "feat(nli): commit afternoon left clock park"
```

---

### Task 2: Run pack re-prep + process 232 and people_names

**Files:**
- Modify: `otef-interactive/scripts/otef_layer_processing/styles.py` (`_apply_people_names_label_ir`: `textRotationAlignment` `"map"`)
- Modify: `otef-interactive/scripts/tests/test_nli_pack_prep.py` (invert viewport → map)
- Modify: `otef-interactive/tests/map/maplibre-style-bridge.test.js` (people_names alignment `map`)
- Create: `otef-interactive/tests/nli/nli-processed-styles-afternoon-lock.test.js`
- Run (do not commit outputs): `otef-interactive/scripts/nli_pack_prep.py`, `process_layers.py --pack nli --layer ציר_232`, `process_layers.py --pack nli --layer people_names`
- Live verify: `otef-interactive/public/processed/layers/nli/styles.json` (gitignored)

**Interfaces:**
- Consumes: existing `ROUTE_232_STROKE_COLOR = (135, 62, 35)`, `ROUTE_232_STROKE_WIDTH_PT = 2.0`, `ROUTE_232_STROKE_ALPHA = 100`; people_names size 8, halo 0.12, `offsetArrayProperty: "otef_map_text_offset_em"`
- Produces: live processed `styles.json` with 232 stroke `#873e23` (or rgb 135,62,35), opacity 1, width ~2.667px (2.0pt × 96/72); people_names size 8, halo 0.12, `offsetArrayProperty`, `textRotationAlignment: "map"`

- [ ] **Step 1: Write the failing tests**

In `otef-interactive/scripts/tests/test_nli_pack_prep.py` `test_people_names_lyrx_is_labels_only_point_with_name_and_force_visible`, change:

```python
self.assertEqual(labels.get("textRotationAlignment"), "map")
```

In `otef-interactive/tests/map/maplibre-style-bridge.test.js` `"emits forceVisible English name labels for nli.people_names on GIS and projection"`, set the fixture `textRotationAlignment: "map"` and assert:

```javascript
expect(sym.layout["text-rotation-alignment"]).toBe("map");
expect(sym.layout["text-rotate"]).toBe(0);
expect(sym.layout["text-size"]).toBe(8);
expect(sym.paint["text-halo-width"]).toBe(0.12);
```

Create `otef-interactive/tests/nli/nli-processed-styles-afternoon-lock.test.js`:

```javascript
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stylesPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../public/processed/layers/nli/styles.json",
);

function asHexOrRgb(color) {
  if (typeof color !== "string") return "";
  const c = color.trim().toLowerCase();
  if (c === "#873e23") return "#873e23";
  if (c.replace(/\s/g, "") === "rgb(135,62,35)") return "#873e23";
  return c;
}

function strokeLayers(entry) {
  const symbolLayers = entry?.defaultSymbol?.symbolLayers || [];
  return symbolLayers.filter((layer) => layer?.type === "stroke");
}

describe("live nli processed styles afternoon lock", () => {
  it("matches 232 brown and people_names IR when processed styles.json is present", () => {
    if (!fs.existsSync(stylesPath)) {
      console.warn(`[afternoon-lock] missing ${stylesPath}; run Task 2 prep on the lab machine`);
      return;
    }
    const styles = JSON.parse(fs.readFileSync(stylesPath, "utf8"));
    const highway = styles["ציר_232"];
    expect(highway).toBeTruthy();
    const strokes = strokeLayers(highway);
    expect(strokes.length).toBeGreaterThan(0);
    const stroke = strokes[0];
    expect(asHexOrRgb(stroke.color)).toBe("#873e23");
    expect(Number(stroke.opacity)).toBe(1);
    expect(Number(stroke.width)).toBeCloseTo(2.0 * (96 / 72), 2);

    const names = styles.people_names;
    expect(names).toBeTruthy();
    const labels = names.labels || {};
    expect(Number(labels.size)).toBe(8);
    expect(Number(labels.haloSize)).toBeCloseTo(0.12, 5);
    expect(labels.offsetArrayProperty).toBe("otef_map_text_offset_em");
    expect(labels.textRotationAlignment).toBe("map");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
cd otef-interactive
.\.venv\Scripts\python.exe -m unittest scripts.tests.test_nli_pack_prep.TestNliPackPrep.test_people_names_lyrx_is_labels_only_point_with_name_and_force_visible
npm test -- tests/map/maplibre-style-bridge.test.js tests/nli/nli-processed-styles-afternoon-lock.test.js
```

Expected: FAIL on `textRotationAlignment` still `"viewport"` in `styles.py`. The live-file test may skip if processed is missing, or fail if processed still has viewport / sand.

- [ ] **Step 3: Write minimal implementation**

In `otef-interactive/scripts/otef_layer_processing/styles.py` `_apply_people_names_label_ir`:

```python
label_config["textRotationAlignment"] = "map"
```

Update the docstring from viewport rotation to map rotation. Keep size 8, halo 0.12, `offsetArrayProperty`, `forceVisible`, and `pop("angleFromProperties")`.

Then from `otef-interactive/scripts` with `.venv` (blocking; do not skip):

```powershell
cd otef-interactive\scripts
.\.venv\Scripts\python.exe .\nli_pack_prep.py
.\.venv\Scripts\python.exe .\process_layers.py --pack nli --layer ציר_232
.\.venv\Scripts\python.exe .\process_layers.py --pack nli --layer people_names
```

Do **not** `fetch_data --force`. Do **not** `--no-cache` other packs. Do **not** commit gitignored geojson/lyrx.

After process, print hashes/values into the task report:

```powershell
Get-FileHash ..\public\processed\layers\nli\styles.json -Algorithm SHA256
.\.venv\Scripts\python.exe -c "import json,pathlib; p=pathlib.Path('../public/processed/layers/nli/styles.json'); d=json.loads(p.read_text(encoding='utf-8')); h=d['ציר_232']; s=[x for x in h['defaultSymbol']['symbolLayers'] if x.get('type')=='stroke'][0]; n=d['people_names']['labels']; print('232', s); print('people_names', {k:n.get(k) for k in ('size','haloSize','offsetArrayProperty','textRotationAlignment')})"
```

Confirm: 232 color `#873e23` or rgb 135,62,35; opacity 1; width ~2.667; people_names size 8, halo 0.12, `offsetArrayProperty`, `textRotationAlignment` `map`.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```powershell
cd otef-interactive
.\.venv\Scripts\python.exe -m unittest scripts.tests.test_nli_pack_prep.TestNliPackPrep.test_people_names_lyrx_is_labels_only_point_with_name_and_force_visible
npm test -- tests/map/maplibre-style-bridge.test.js tests/nli/nli-processed-styles-afternoon-lock.test.js
```

Expected: PASS. Live-file test must run assertions (processed present after prep), not the missing-file warn-return.

- [ ] **Step 5: Commit**

Commit script + test changes only. Do not `git add` `public/processed/**` or source geojson/lyrx.

```powershell
git add otef-interactive/scripts/otef_layer_processing/styles.py otef-interactive/scripts/tests/test_nli_pack_prep.py otef-interactive/tests/map/maplibre-style-bridge.test.js otef-interactive/tests/nli/nli-processed-styles-afternoon-lock.test.js
git commit -m "feat(nli): map-align people_names IR and require live 232 re-prep"
```

Record in the commit body / task report that processed files on disk match (SHA-256 + 232/people_names values). Do not commit those files.

---

### Task 3: Fold category rows into buildLegendModel; mount map-legend on projection; remove overlay

**Files:**
- Modify: `otef-interactive/frontend/src/map/legend-model-builder.js`
- Modify: `otef-interactive/frontend/src/map/map-legend.js`
- Modify: `otef-interactive/frontend/src/shared/nli-investigation-legend.js`
- Modify: `otef-interactive/frontend/src/entries/map-main.js`
- Modify: `otef-interactive/frontend/src/entries/projection-main.js`
- Modify: `otef-interactive/frontend/projection.html`
- Modify: `otef-interactive/frontend/css/styles.css`
- Test: `otef-interactive/tests/map/legend-unique-value.test.js`
- Test: `otef-interactive/tests/shared/nli-investigation-legend.test.js`
- Create: `otef-interactive/tests/map/legend-surface.test.js`

**Interfaces:**
- Consumes: `NLI_VISUAL_TOKENS.polygonCategories`, `NLI_LEGEND_SHORT_LABELS`, `INVESTIGATION_POLYGONS_FULL_ID` (`nli.investigation_polygons`), `shouldShowLayerOnGisMap`
- Produces: `investigationPolygonLegendItems()`; `shouldIncludeLayerInLegend(groupId, layerId, surface)`; `legendLayerFromConfig(config, layer, { fullId, distinctLandUse })`; `buildLegendModel({ surface: "gis" | "projection" })`; `updateMapLegend({ surface })`

- [ ] **Step 1: Write the failing tests**

Add to `otef-interactive/tests/map/legend-unique-value.test.js`:

```javascript
import { NLI_VISUAL_TOKENS } from "../../frontend/src/shared/nli-investigation-theme.js";
import { NLI_LEGEND_SHORT_LABELS } from "../../frontend/src/shared/nli-investigation-legend.js";

it("expands nli.investigation_polygons to three category rows and ignores ui.legendLabel collapse", () => {
  const config = {
    name: "investigation_polygons",
    geometryType: "polygon",
    ui: { legendLabel: "Investigation polygons" },
    style: {
      renderer: "uniqueValue",
      uniqueValues: {
        field: "Notes",
        classes: [
          { value: "x", label: "host orange", symbol: { symbolLayers: [{ type: "fill", color: "#f79009" }] } },
        ],
      },
    },
  };
  const layer = legendLayerFromConfig(config, { id: "investigation_polygons" }, {
    fullId: "nli.investigation_polygons",
  });
  expect(layer.items).toHaveLength(3);
  expect(layer.items.map((item) => item.label)).toEqual(["קרב", "חטיפה", "שריפה"]);
  expect(layer.items.map((item) => item.fill)).toEqual([
    NLI_VISUAL_TOKENS.polygonCategories["מרחב לחימה - קרב"].fill,
    NLI_VISUAL_TOKENS.polygonCategories["מוקד חטיפה"].fill,
    NLI_VISUAL_TOKENS.polygonCategories["שריפה"].fill,
  ]);
  expect(layer.items.every((item) => item.shape === "polygon")).toBe(true);
  expect(layer.items.map((item) => item.fill)).not.toContain("#f79009");
  expect(NLI_LEGEND_SHORT_LABELS["מרחב לחימה - קרב"]).toBe("קרב");
});
```

Keep the existing Gaza-Roads `ui.legendLabel` collapse test (other layers still collapse).

Create `otef-interactive/tests/map/legend-surface.test.js`:

```javascript
import { describe, expect, it } from "vitest";
import { shouldIncludeLayerInLegend } from "../../frontend/src/map/legend-model-builder.js";
import { shouldShowLayerOnGisMap } from "../../frontend/src/shared/gis-layer-filter.js";

describe("shouldIncludeLayerInLegend", () => {
  it("strips projector-only layers on gis and keeps them on projection", () => {
    expect(shouldShowLayerOnGisMap("projector_base", "שמות_יישובים")).toBe(false);
    expect(shouldIncludeLayerInLegend("projector_base", "שמות_יישובים", "gis")).toBe(false);
    expect(shouldIncludeLayerInLegend("projector_base", "שמות_יישובים", "projection")).toBe(true);
    expect(shouldIncludeLayerInLegend("nli", "investigation_polygons", "gis")).toBe(true);
    expect(shouldIncludeLayerInLegend("nli", "investigation_polygons", "projection")).toBe(true);
  });
});
```

In `otef-interactive/tests/shared/nli-investigation-legend.test.js`, invert wiring:

```javascript
it("does not mount #nliInvestigationLegend overlay from GIS or projection entries", () => {
  const mapMain = readFileSync(path.resolve(here, "../../frontend/src/entries/map-main.js"), "utf8");
  const projectionMain = readFileSync(path.resolve(here, "../../frontend/src/entries/projection-main.js"), "utf8");
  const projectionHtml = readFileSync(path.resolve(here, "../../frontend/projection.html"), "utf8");
  expect(mapMain).not.toContain("mountNliInvestigationLegend");
  expect(projectionMain).not.toContain("mountNliInvestigationLegend");
  expect(mapMain).toContain('updateMapLegend({ surface: "gis" })');
  expect(projectionMain).toContain('updateMapLegend({ surface: "projection" })');
  expect(projectionHtml).toContain('id="mapLegend"');
});
```

Change the test file import from `mountNliInvestigationLegend` to `investigationPolygonLegendItems`.

Replace the existing `"renders three short Hebrew swatches from category fill tokens"` test (it currently calls `mountNliInvestigationLegend`) with:

```javascript
it("builds three short Hebrew polygon items from category fill tokens", () => {
  const items = investigationPolygonLegendItems();
  expect(items).toHaveLength(3);
  expect(items.map((item) => item.label)).toEqual(["קרב", "חטיפה", "שריפה"]);
  expect(items.map((item) => item.fill)).toEqual([
    NLI_VISUAL_TOKENS.polygonCategories["מרחב לחימה - קרב"].fill,
    NLI_VISUAL_TOKENS.polygonCategories["מוקד חטיפה"].fill,
    NLI_VISUAL_TOKENS.polygonCategories["שריפה"].fill,
  ]);
  expect(items.every((item) => item.shape === "polygon")).toBe(true);
});
```

Replace the overlay CSS assertion with:

```javascript
it("does not style #nliInvestigationLegend as a second overlay HUD", () => {
  const css = readFileSync(path.resolve(here, "../../frontend/css/styles.css"), "utf8");
  expect(css).not.toMatch(/#nliInvestigationLegend\s*\{/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd otef-interactive; npm test -- tests/map/legend-unique-value.test.js tests/map/legend-surface.test.js tests/shared/nli-investigation-legend.test.js`

Expected: FAIL (`shouldIncludeLayerInLegend` missing; overlay still mounted; investigation polygons still collapse to “Investigation polygons”).

- [ ] **Step 3: Write minimal implementation**

In `nli-investigation-legend.js` keep `NLI_LEGEND_SHORT_LABELS`. Add:

```javascript
export function investigationPolygonLegendItems() {
  return Object.keys(NLI_LEGEND_SHORT_LABELS).map((notes) => ({
    label: NLI_LEGEND_SHORT_LABELS[notes],
    fill: NLI_VISUAL_TOKENS.polygonCategories[notes].fill,
    stroke: NLI_VISUAL_TOKENS.polygonCategories[notes].outline,
    shape: "polygon",
  }));
}
```

Delete `mountNliInvestigationLegend` (and `NLI_LEGEND_HOST_ID` if nothing else needs it). Keep `polygonGroupEnabled` only if still imported; otherwise delete it.

In `legend-model-builder.js`, import `shouldShowLayerOnGisMap` from `../shared/gis-layer-filter.js` (do not rely on the `window` global; the Node test must see the same helper). Import `investigationPolygonLegendItems` from `../shared/nli-investigation-legend.js`.

```javascript
function shouldIncludeLayerInLegend(groupId, layerId, surface = "gis") {
  switch (surface) {
    case "projection":
      return true;
    case "gis":
      return typeof shouldShowLayerOnGisMap !== "function" || shouldShowLayerOnGisMap(groupId, layerId);
    default: {
      throw new Error(`unknown legend surface: ${surface}`);
    }
  }
}
```

At the top of `legendLayerFromConfig`, if `options.fullId === "nli.investigation_polygons"`, return three items from `investigationPolygonLegendItems()` and **do not** uniqueValue the orange host pack or collapse via `ui.legendLabel`.

Change `buildLegendModel(options = {})` to read `surface` (`"gis"` default, `"projection"` when passed). Replace the `shouldShowLayerOnGisMap` continue with `shouldIncludeLayerInLegend(group.id, layer.id, surface)`. Pass `{ distinctLandUse, fullId }` into `legendLayerFromConfig`.

Export `shouldIncludeLayerInLegend`.

In `map-legend.js`:

```javascript
async function updateMapLegend(options = {}) {
  const surface = options.surface === "projection" ? "projection" : "gis";
  try {
    const model = await buildLegendModel({ surface });
    renderLegend(model);
  } catch (e) {
    console.warn("[MapLegend] updateMapLegend failed:", e);
    const el = document.getElementById("mapLegend");
    if (el) {
      el.innerHTML = "";
      el.classList.remove("map-legend-has-content");
    }
  }
}
```

`map-main.js`: delete `mountNliInvestigationLegend` import and the overlay host block. Change legend calls to `updateMapLegend({ surface: "gis" })`.

`projection-main.js`: delete overlay mount. After the explainer host exists, subscribe `layerGroups` and call `updateMapLegend({ surface: "projection" })` (same pattern as map-main, including the initial call).

`projection.html`: add `<div id="mapLegend" class="map-legend"></div>` as a sibling of `#displayContainer` (existing `.map-legend` CSS is `position: fixed; bottom: 20px; right: 20px`).

`styles.css`: remove `#nliInvestigationLegend` / `__item` / `__swatch` overlay rules so they cannot paint a second HUD.

Do **not** change `layer-display-glossary.js` `nli.investigation_polygons` (remote sheet stays one glossary row). Do **not** uniqueValue that layer in the remote sheet.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd otef-interactive; npm test -- tests/map/legend-unique-value.test.js tests/map/legend-surface.test.js tests/shared/nli-investigation-legend.test.js tests/architecture/hotspots/legend-split.test.js tests/shared/layer-name-utils.test.js`

Expected: PASS. Gaza-Roads collapse still works. Glossary test for `nli.investigation_polygons` still one English/Hebrew pair.

- [ ] **Step 5: Commit**

```powershell
git add otef-interactive/frontend/src/map/legend-model-builder.js otef-interactive/frontend/src/map/map-legend.js otef-interactive/frontend/src/shared/nli-investigation-legend.js otef-interactive/frontend/src/entries/map-main.js otef-interactive/frontend/src/entries/projection-main.js otef-interactive/frontend/projection.html otef-interactive/frontend/css/styles.css otef-interactive/tests/map/legend-unique-value.test.js otef-interactive/tests/map/legend-surface.test.js otef-interactive/tests/shared/nli-investigation-legend.test.js
git commit -m "feat(nli): fold polygon legend into mapLegend on both surfaces"
```

---

### Task 4: Person flyTo sets navigationTravelActive until idle

**Files:**
- Modify: `otef-interactive/frontend/src/map/maplibre-viewport-sync.js`
- Modify: `otef-interactive/frontend/src/map/maplibre-person-selection.js`
- Modify: `otef-interactive/frontend/src/entries/map-main.js`
- Test: `otef-interactive/tests/map/maplibre-viewport-sync.test.js`
- Test: `otef-interactive/tests/map/maplibre-person-selection.test.js`

**Interfaces:**
- Consumes: existing place-travel `navigationTravelActive`, `reportNavigationTravelViewport` on `move`, `isLocalViewportEchoDuringNavigation` / `isUnattributedViewportDuringNavigation` skip of `applyAcceptedViewport`
- Produces: `setupViewportSync` disposer function with `.beginCameraTravel(traceId: string): void`. `createGisPersonSelection({ beginCameraTravel })` calls it before `map.flyTo`. Do not export a second lerp path. Do not touch `PROJECTION_LERP_FACTOR`.

- [ ] **Step 1: Write the failing tests**

In `otef-interactive/tests/map/maplibre-viewport-sync.test.js` add (reuse `createMapMock` / `createDataContextMock`):

```javascript
it("person camera travel reports on move and skips self-apply until idle", () => {
  const map = createMapMock({ bounds: [0, 0, 10, 10], zoom: 6, fitBoundsZoom: 14 });
  const dataContext = createDataContextMock();
  dataContext.updateViewportFromUI = vi.fn((viewport) => {
    dataContext.emitViewport({ ...viewport, sourceId: "test-client" });
    return { accepted: true };
  });
  const cleanup = setupViewportSync(map, dataContext);

  expect(typeof cleanup.beginCameraTravel).toBe("function");
  cleanup.beginCameraTravel("person-fly-1");
  map.flyTo({ center: { lng: 5, lat: 5 }, zoom: 16, duration: 1600 });

  map.emit("move");
  vi.advanceTimersByTime(100);
  expect(dataContext.updateViewportFromUI).toHaveBeenCalledWith(
    expect.objectContaining({ zoom: expect.any(Number), bbox: expect.any(Array) }),
    "gis",
    expect.objectContaining({ sharedUpdate: "immediate", traceId: "person-fly-1" }),
  );
  expect(map.fitBoundsCalls).toHaveLength(0);

  map.emit("idle");
  cleanup();
});
```

Keep the existing place-navigation tests. They must still pass after extracting shared travel start.

In `otef-interactive/tests/map/maplibre-person-selection.test.js`, add an optional third `setup` argument and assert on the existing focus test:

```javascript
function setup(
  fetchJson = vi.fn(async (url) => url.includes("index") ? fetched(index()) : url.includes("metadata") ? fetched(metadata()) : fetched(geojson())),
  hashBytes = vi.fn(async () => "geo-hash-v1"),
  extra = {},
) {
  const map = createFakeMapLibreMap();
  Object.assign(map, {
    getCanvas: () => ({ clientWidth: 400, clientHeight: 300 }),
    project: vi.fn(([lng, lat]) => ({ x: lng * 10, y: lat * 10 })),
    flyTo: vi.fn(),
  });
  const bubble = popup();
  const visual = createGisPersonSelection({
    map,
    maplibregl: { Popup: vi.fn(function Popup() { return bubble; }) },
    fetchJson,
    hashBytes,
    ...extra,
  });
  return { map, bubble, visual, fetchJson, hashBytes };
}

test("focus uses camera and delays popup until idle, while hide permits remount", async () => {
  const beginCameraTravel = vi.fn();
  const d = setup(undefined, undefined, { beginCameraTravel });
  const person = await d.visual.resolve("11", "v1");
  d.visual.show(person, { focus: true });
  expect(beginCameraTravel).toHaveBeenCalled();
  expect(d.map.flyTo).toHaveBeenCalledWith(expect.objectContaining({
    center: [30, 20], zoom: 16, duration: 1600, essential: true,
  }));
  expect(d.bubble.addTo).not.toHaveBeenCalled();
  d.map.emit("moveend");
  expect(d.bubble.addTo).toHaveBeenCalledTimes(1);
  d.visual.hide();
  expect(d.map.getLayer(PEOPLE_HALO_LAYER_ID)).toBeNull();
  d.visual.show(person);
  expect(d.map.getLayer(PEOPLE_HALO_LAYER_ID)).toBeTruthy();
});
```

Do **not** add a test that interpolates highlight geometry. Do **not** import `PROJECTION_LERP_FACTOR` here.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd otef-interactive; npm test -- tests/map/maplibre-viewport-sync.test.js tests/map/maplibre-person-selection.test.js`

Expected: FAIL (`cleanup.beginCameraTravel` undefined; person `show` does not call it).

- [ ] **Step 3: Write minimal implementation**

In `maplibre-viewport-sync.js`, extract the flag/idle/report wiring from `applyNavigationCommand` into `startNavigationTravel(traceId)`:

```javascript
const startNavigationTravel = (traceId) => {
  activeNavigationTraceId = traceId || null;
  navigationTravelActive = true;
  clearNavigationReportTimer();
  clearNavigationIdleHandler();
  navigationIdleHandler = () => {
    navigationIdleHandler = null;
    reportToContext(onGISReportInteractionGuard, {
      sharedUpdate: "immediate",
      traceId,
    });
    navigationTravelActive = false;
    activeNavigationTraceId = null;
    clearNavigationReportTimer();
  };
  map.once("idle", navigationIdleHandler);
};
```

`applyNavigationCommand` calls `startNavigationTravel(traceId)` then `map.flyTo` / `jumpTo` as today.

`setupViewportSync` still returns a function (so `registerDisposer(setupViewportSync(...))` keeps working). Attach:

```javascript
const dispose = () => { /* existing cleanup */ };
dispose.beginCameraTravel = (traceId = "person-fly") => {
  startNavigationTravel(traceId);
};
return dispose;
```

Existing echo skips (`isLocalViewportEchoDuringNavigation`, `isUnattributedViewportDuringNavigation`) already no-op `applyAcceptedViewport` while `navigationTravelActive` is true. Reuse them. Do not add highlight lerp.

In `maplibre-person-selection.js` `createGisPersonSelection`, accept `beginCameraTravel`. Inside `show` when `focus` is true, call `beginCameraTravel?.(\`person-fly-${token}\`)` **before** `map.flyTo`. Do not change zoom 16 or duration.

In `map-main.js`:

```javascript
const viewportSync = setupViewportSync(map, OTEFDataContext);
registerDisposer(viewportSync);
const personVisual = createGisPersonSelection({
  map,
  maplibregl,
  beginCameraTravel: viewportSync.beginCameraTravel,
});
```

Projection still must not `flyTo`. Do not call `beginCameraTravel` from projection-main.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd otef-interactive; npm test -- tests/map/maplibre-viewport-sync.test.js tests/map/maplibre-person-selection.test.js tests/projection/projection-person-halo.test.js`

Expected: PASS. Place-travel tests still pass. Projection halo test still has no `flyTo`.

- [ ] **Step 5: Commit**

```powershell
git add otef-interactive/frontend/src/map/maplibre-viewport-sync.js otef-interactive/frontend/src/map/maplibre-person-selection.js otef-interactive/frontend/src/entries/map-main.js otef-interactive/tests/map/maplibre-viewport-sync.test.js otef-interactive/tests/map/maplibre-person-selection.test.js
git commit -m "fix(nli): treat person flyTo as navigation travel until idle"
```

---

### Task 5: Global integer text-rotate via ShemotLabelDebug for people_names + all שמות

**Files:**
- Create: `otef-interactive/frontend/src/shared/nli-label-heading.js`
- Create: `otef-interactive/tests/shared/nli-label-heading.test.js`
- Modify: `otef-interactive/frontend/src/projection/projection-shemot-label-debug.js`
- Modify: `otef-interactive/tests/projection/projection-shemot-label-debug.test.js`
- Modify: `otef-interactive/frontend/src/shared/maplibre-style-bridge.js`
- Modify: `otef-interactive/tests/map/maplibre-style-bridge.test.js`
- Modify: `otef-interactive/frontend/src/entries/map-main.js`
- Modify: `otef-interactive/frontend/src/entries/projection-main.js`

**Interfaces:**
- Consumes: label layer ids `nli__people_names__labels` and `projector_base__שמות_יישובים__labels`; existing Shemot offset properties (`otef_label_offset_em_x` / `_y` / `otef_map_text_offset_em`)
- Produces:

```javascript
export const NLI_LABEL_HEADING_STORAGE_KEY = "otef.nliLabelHeading.v1";
export const NLI_LABEL_HEADING_DEFAULT = 0;
export const PEOPLE_NAMES_LABEL_LAYER_ID = "nli__people_names__labels";
export const SHEMOT_LABEL_LAYER_ID = "projector_base__שמות_יישובים__labels";
export function snapNliLabelHeadingDeg(deg): number
export function readNliLabelHeading(storage): number
export function writeNliLabelHeading(deg, storage): number
export function applyNliSharedTextHeading(map, headingDeg): number
export function buildNliLabelHeadingExport(headingDeg): { version: 2, headingDeg: number }
```

Default heading **0**. Snap **1°**. `text-rotation-alignment: map`. Per-feature offsets stay. GIS שמות stay muted (apply is a no-op if that layer is absent). GIS people_names use the same heading.

- [ ] **Step 1: Write the failing tests**

Create `otef-interactive/tests/shared/nli-label-heading.test.js`:

```javascript
import { describe, expect, it, vi } from "vitest";
import {
  NLI_LABEL_HEADING_DEFAULT,
  NLI_LABEL_HEADING_STORAGE_KEY,
  PEOPLE_NAMES_LABEL_LAYER_ID,
  SHEMOT_LABEL_LAYER_ID,
  applyNliSharedTextHeading,
  buildNliLabelHeadingExport,
  readNliLabelHeading,
  snapNliLabelHeadingDeg,
  writeNliLabelHeading,
} from "../../frontend/src/shared/nli-label-heading.js";

describe("nli shared label heading", () => {
  it("snaps to integer degrees with default 0", () => {
    expect(snapNliLabelHeadingDeg(undefined)).toBe(0);
    expect(snapNliLabelHeadingDeg(NLI_LABEL_HEADING_DEFAULT)).toBe(0);
    expect(snapNliLabelHeadingDeg(14.4)).toBe(14);
    expect(snapNliLabelHeadingDeg(14.6)).toBe(15);
    expect(snapNliLabelHeadingDeg(-0.6)).toBe(-1);
  });

  it("persists one heading and exports a single headingDeg", () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    expect(readNliLabelHeading(storage)).toBe(0);
    writeNliLabelHeading(91.2, storage);
    expect(storage.setItem).toHaveBeenCalledWith(NLI_LABEL_HEADING_STORAGE_KEY, "91");
    storage.getItem = vi.fn(() => "91");
    expect(readNliLabelHeading(storage)).toBe(91);
    expect(buildNliLabelHeadingExport(91.2)).toEqual({ version: 2, headingDeg: 91 });
    expect(buildNliLabelHeadingExport(91.2)).not.toHaveProperty("overrides");
  });

  it("sets static text-rotate and map alignment on people_names and שמות layers", () => {
    const props = {};
    const map = {
      getLayer: (id) => id === PEOPLE_NAMES_LABEL_LAYER_ID || id === SHEMOT_LABEL_LAYER_ID,
      setLayoutProperty: vi.fn((id, key, value) => {
        props[`${id}:${key}`] = value;
      }),
    };
    applyNliSharedTextHeading(map, 12.4);
    expect(props[`${PEOPLE_NAMES_LABEL_LAYER_ID}:text-rotate`]).toBe(12);
    expect(props[`${PEOPLE_NAMES_LABEL_LAYER_ID}:text-rotation-alignment`]).toBe("map");
    expect(props[`${SHEMOT_LABEL_LAYER_ID}:text-rotate`]).toBe(12);
    expect(props[`${SHEMOT_LABEL_LAYER_ID}:text-rotation-alignment`]).toBe("map");
  });
});
```

In `projection-shemot-label-debug.test.js` add (keep offset merge tests; invert live per-feature rotate):

```javascript
import { buildNliLabelHeadingExport, snapNliLabelHeadingDeg } from "../../frontend/src/shared/nli-label-heading.js";

it("export JSON is a single heading, not per-citycode rotate", () => {
  expect(snapNliLabelHeadingDeg(14.6)).toBe(15);
  expect(buildNliLabelHeadingExport(14.6)).toEqual({ version: 2, headingDeg: 15 });
  expect(JSON.stringify(buildNliLabelHeadingExport(14.6))).not.toMatch(/otef_label_rotate_deg|citycode/);
});
```

Offset tests must still merge `otef_label_offset_em_*` / `otef_map_text_offset_em` per citycode. Do not keep a test that requires live `otef_label_rotate_deg` on the MapLibre layer.

In `maplibre-style-bridge.test.js`, for `nli.people_names` keep size 8 / halo 0.12 / `offsetArrayProperty`. Assert `text-rotation-alignment` is `map` and `text-rotate` is a number (0), not an `angleFromProperties` expression.

Add:

```javascript
it("emits static text-rotate for שמות instead of live per-feature otef_label_rotate_deg", () => {
  const layerConfig = {
    geometryType: "point",
    style: {
      renderer: "simple",
      labels: {
        field: "cityname",
        angleFromProperties: true,
        angleProperty: "otef_label_rotate_deg",
        offsetArrayProperty: "otef_map_text_offset_em",
        textRotationAlignment: "map",
      },
    },
  };
  const result = irToMapLibreLayers(
    "projector_base.שמות_יישובים",
    "projector_base__שמות_יישובים",
    layerConfig,
    { applyProjectionHatchPresentation: true },
  );
  const sym = result.find((layer) => layer.type === "symbol");
  expect(sym.layout["text-rotate"]).toBe(0);
  expect(Array.isArray(sym.layout["text-rotate"])).toBe(false);
  expect(sym.layout["text-rotation-alignment"]).toBe("map");
  expect(sym.layout["text-offset"][1]).toEqual(["get", "otef_map_text_offset_em"]);
});
```

Keep a **non-שמות** `angleFromProperties` test so other layers still get data-driven rotate.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd otef-interactive; npm test -- tests/shared/nli-label-heading.test.js tests/projection/projection-shemot-label-debug.test.js tests/map/maplibre-style-bridge.test.js`

Expected: FAIL (module missing; snap still 15; שמות still data-driven `text-rotate`).

- [ ] **Step 3: Write minimal implementation**

Create `nli-label-heading.js` with the exports above. `snapNliLabelHeadingDeg` is `Math.round` of a finite number else `0`. Storage read/write use `NLI_LABEL_HEADING_STORAGE_KEY`. `applyNliSharedTextHeading` loops the two layer ids; if `map.getLayer(id)` is missing, skip (GIS שמות mute). Set `text-rotate` to the snapped integer and `text-rotation-alignment` to `"map"`.

In `maplibre-style-bridge.js` `buildLabelTextRotateValue` / `buildLabelSymbolLayer`: when `fullLayerId` is `nli.people_names` or `projector_base.שמות_יישובים`, emit numeric `text-rotate` `0` and `text-rotation-alignment` `"map"`. Do **not** use live `angleFromProperties` / `otef_label_rotate_deg` for those layers. Keep `offsetArrayProperty` / offset expressions.

In `projection-shemot-label-debug.js`:
- Snap step **1** (`DEFAULT_ROTATION_SNAP_DEG = 1` or the heading helper).
- Rotate handle / +/- buttons set **one** heading via `writeNliLabelHeading` + `applyNliSharedTextHeading(map, heading)`.
- Stop writing `otef_label_rotate_deg` as the live rotate. Per-feature offset drag/export stays.
- Download JSON: `{ version: 2, headingDeg }` from `buildNliLabelHeadingExport`. Do not emit per-citycode rotate. Offsets may still be a separate `offsets` map keyed by citycode if the tool still edits locations; that map must not include rotate.
- `installShemotLabelDebug` return `{ toggle, setVisible, getActive, dispose, getHeading, setHeading }`. `window.ShemotLabelDebug` already assigned in projection-main.

In `map-main.js` and `projection-main.js`, after layers exist (`style.load` and after `applyLayerGroupsToMap` / projection layer sync):

```javascript
applyNliSharedTextHeading(map, readNliLabelHeading(window.localStorage));
```

Optional: listen for `window` `storage` on `NLI_LABEL_HEADING_STORAGE_KEY` so GIS picks up a heading the projection L tool just wrote (same origin). Do not lift GIS שמות mute.

Do not run `process_layers.py` for `projector_base`. Do not change people_names radial formula.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd otef-interactive; npm test -- tests/shared/nli-label-heading.test.js tests/projection/projection-shemot-label-debug.test.js tests/map/maplibre-style-bridge.test.js tests/shared/gis-layer-filter.test.js`

Expected: PASS. GIS filter still rejects `שמות_יישובים`. Offset merge tests still pass.

- [ ] **Step 5: Commit**

```powershell
git add otef-interactive/frontend/src/shared/nli-label-heading.js otef-interactive/tests/shared/nli-label-heading.test.js otef-interactive/frontend/src/projection/projection-shemot-label-debug.js otef-interactive/tests/projection/projection-shemot-label-debug.test.js otef-interactive/frontend/src/shared/maplibre-style-bridge.js otef-interactive/tests/map/maplibre-style-bridge.test.js otef-interactive/frontend/src/entries/map-main.js otef-interactive/frontend/src/entries/projection-main.js
git commit -m "feat(nli): one integer heading for people_names and projection shemot"
```

---

### Task 6: Docs / exhibit gates

**Files:**
- Modify: `otef-interactive/docs/nli-exhibit-verification.md` (replace leftover overlay / viewport-only heading / re-prep-later rows)
- Spec already has afternoon gates in `docs/superpowers/specs/2026-09-06-nli-visual-polish-design.md` (do not reopen product decisions)

**Interfaces:**
- Consumes: afternoon lock §§1–5
- Produces: recorded exhibit-gate table rows (empty pass/fail until the operator fills them; do not invent pass/fail)

- [ ] **Step 1: Write the failing check**

In `otef-interactive/docs/nli-exhibit-verification.md`, the **2026-09-07 lab follow-up exhibit gates** table still describes a separate overlay legend, viewport-horizontal names, leftover pack re-prep, and the morning left clock numbers. Treat that mismatch as the failing doc gate.

Add or replace that section with this table (do not invent pass/fail):

| Gate | Date | Operator | Surface | pass/fail/blocker | notes |
|---|---|---|---|---|---|
| Clock left park | 2026-09-07 afternoon | lab | GIS + projection | pending | Must record: `NLI_EXPLAINER_LAYOUT.left` is `47.16458333333333, 14.320176309187765, 13.572916666666666, 11.732162458836443, 15, 91.18739188335852`. Full/right unchanged. Keys `.v2`. Transparent caption, `fontPx`, GIS rotate. |
| Legend in `#mapLegend` both surfaces | 2026-09-07 afternoon | lab | GIS + projection | pending | Must record: three rows קרב / חטיפה / שריפה in existing `#mapLegend` on GIS **and** projection. No `#nliInvestigationLegend` overlay. Hidden when polygons row off. Remote sheet still one glossary row. |
| 232 brown on LIVE processed | 2026-09-07 afternoon | lab | GIS + table | pending | Must record: live `public/processed/layers/nli/styles.json` stroke `#873e23` (or rgb 135,62,35), opacity 1, width ~2.667px. Re-prep ran; not residual. |
| Highlight no bounce after search | 2026-09-07 afternoon | lab | GIS fly + projection highlight | pending | Must record: person search flyTo does not bounce the table highlight. Keep-geometry + 400 ms fade across zoom 13. No highlight-geometry lerp. |
| One heading | 2026-09-07 afternoon | lab | GIS people_names + projection people_names and שמות | pending | Must record: one integer heading, default 0, snap 1°, `text-rotation-alignment: map`. Per-feature offsets stay. GIS שמות stay muted. |

Also update the earlier clock bullet that still cites morning left `30.810416666666665`. Update the Names recorded-evidence line that still says screen-horizontal / need lab pack re-prep.

- [ ] **Step 2: Run the check to verify it fails**

Search the exhibit file:

```powershell
cd otef-interactive
Select-String -Path docs/nli-exhibit-verification.md -Pattern "nliInvestigationLegend|30.810416666666665|screen-horizontal|need lab pack re-prep|15°"
```

Expected: matches exist before the edit (failing doc gate). After Step 3 those leftover phrases must be gone or clearly marked superseded.

- [ ] **Step 3: Write the doc update**

Apply the table and clock/names wording from Step 1. Do not mark any new row pass/fail. Crop Tesuga remains deferred/blocker from the existing UV record.

- [ ] **Step 4: Re-run the leftover-phrase scan**

```powershell
Select-String -Path docs/nli-exhibit-verification.md -Pattern "nliInvestigationLegend|30.810416666666665|need lab pack re-prep"
```

Expected: no required-overlay / morning-left / re-prep-later leftovers. Afternoon table present with five pending gates.

- [ ] **Step 5: Commit**

```powershell
git add otef-interactive/docs/nli-exhibit-verification.md
git commit -m "docs(nli): record 2026-09-07 afternoon exhibit gates"
```

---

## Self-review

1. **Spec coverage:** Clock left JSON → Task 1. Blocking pack re-prep + live styles.json → Task 2. Legend into `#mapLegend` both surfaces, delete overlay, projection surface argument → Task 3. Person flyTo `navigationTravelActive` until idle → Task 4. One heading, 1° snap, drop live per-feature rotate → Task 5. Exhibit gates → Task 6. Kept locks (Stop complete-story, ghosts, alarms, GIS mute, clock rotate/v2, Tesuga deferred, archive channel, 400 ms highlight fade, category colors) are not reopened.
2. **Placeholder scan:** no TBD / later / similar-to-Task-N.
3. **Type consistency:** `updateMapLegend({ surface })`, `buildLegendModel({ surface })`, `shouldIncludeLayerInLegend`, `dispose.beginCameraTravel`, `NLI_LABEL_HEADING_STORAGE_KEY`, layer ids `nli__people_names__labels` / `projector_base__שמות_יישובים__labels` match across tasks.
