# Shemot Yeshuvim (projector_base) Projection Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reprocess and render the `projector_base.שמות_יישובים` layer on the **projection** page only, with label text styled from the new `שמות_יישובים.lyrx`, offset label placement, and **required connector lines**, with **no** full multi-pack layer processing run.

**Architecture:** (1) Extend the Python layer CLI so a single pack/layer can be transformed and merged into existing `public/processed/layers/projector_base/` manifest and `styles.json` without dropping sibling layers. (2) Extend `irToMapLibreLayers` and `addLayerToMap` so `style.labels` from processed JSON becomes MapLibre `symbol` (text) layers and required `line` layers for connectors, fixing the empty-`symbolLayers` rollback path. (3) Add MapLibre `glyphs` to the projection map style and map LYRX font fields to a `text-font` stack that the glyph server can serve. (4) Implement leader-line semantics as part of the same delivery, with explicit processed-style contract and renderer tests.

**Tech Stack:** Python 3.8+ (`otef-interactive/scripts/otef_layer_processing`), Vitest, MapLibre GL JS 5.x (`otef-interactive/frontend`, `otef-interactive/frontend/src/projection/maplibre-projection.js`), existing `parse_lyrx_style` in `otef-interactive/scripts/otef_layer_processing/styles.py`, `layerRegistry` + `otef-interactive/frontend/src/map/maplibre-layer-manager.js`.

---

**Projection-only policy (this plan):** All user-visible labeling work targets the **projection** map entry (`projection.html` / `otef-interactive/frontend/src/projection/maplibre-projection.js` and related loaders). **Do not** change GIS map construction, basemap wiring, or shared GIS behavior as part of this plan. The settlements name layer remains a **projector_base** concern. **Acceptance:** GIS must show **no new** projector-only layers and **no regression** in existing GIS layer lists/visibility (Task 7) — the **only** exception is Task 7’s **minimal** registry/filter tweak **if** `שמות_יישובים` incorrectly appears on GIS (match existing `projector_base` hidden patterns).

**Repository constraints for this work:** Do **not** add git commits or git worktrees as part of execution; verify locally only. Keep automated tests **minimal and targeted** (extend `otef-interactive/tests/map/maplibre-style-bridge.test.js` and, if needed, one small pure helper test file).

**Validated root causes encoded here:**
- CLI (`otef-interactive/scripts/otef_layer_processing/cli.py`) has `--metadata-only` and full `process_all` only — **no single-layer mode**.
- `style.labels` is populated in Python (`StyleConfig.to_dict` / `styles.json`) but **`irToMapLibreLayers` ignores it** (`otef-interactive/frontend/src/shared/maplibre-style-bridge.js` only reads `defaultSymbol` / `uniqueValues`).
- Label-only LYRX can yield **no drawable `symbolLayers`**, so `buildSimpleLayers` returns `[]` and `addLayerToMap` **rolls back** the GeoJSON source (`otef-interactive/frontend/src/map/maplibre-layer-manager.js` around the `addedLayerIds.length === 0` check).
- **Leader/callout** semantics are not parsed end-to-end from Maplex in `otef-interactive/scripts/otef_layer_processing/styles.py` (only text symbol fields and basic `maplexLabelPlacementProperties.featureType` for geometry); **wiring** to the frontend is absent.
- Projection map is constructed with a **minimal style** (no `glyphs`); **text** layers require a valid `glyphs` URL on the map style (`otef-interactive/frontend/src/projection/maplibre-projection.js`).

**Data paths (authoritative for this plan):**
- Source GIS: `otef-interactive/public/source/layers/projector_base/gis/שמות_יישובים.json` — **annotation-style polygons** (`type: Polygon` / `MultiPolygon`); label text lives in **`properties.TextString`**, not centroid points. Python `labels.field` / bridge `text-field` must resolve to that property (e.g. `TextString` or `textstring` per case variants), not a generic `NAME` field.
- New style: `otef-interactive/public/source/layers/projector_base/styles/שמות_יישובים.lyrx`
- Processed output (to refresh): `otef-interactive/public/processed/layers/projector_base/שמות_יישובים.geojson` (file name must match the GIS file stem; the layer **id** in manifest remains the stem from the source file — follow existing pack conventions after inspecting current `public/processed/layers/projector_base/manifest.json` if present)

---

## File map (ownership)

| File | Role |
|------|------|
| `otef-interactive/scripts/otef_layer_processing/cli.py` | Add `--pack` and `--layer` (or `--only`) arguments; call new orchestrator entry point. |
| `otef-interactive/scripts/otef_layer_processing/orchestrator.py` | Implement `process_single_layer_merged(pack_id, layer_stem, ...)` with **merge** into existing manifest/styles; root `layers-manifest.json` from output subdirs. |
| `otef-interactive/scripts/otef_layer_processing/styles.py` | Extend label parsing from `maplexLabelPlacementProperties` (offset, leader) into `labels` dict; **ensure** `labels.field` matches GeoJSON (e.g. `TextString` for שמות_יישובים), and set a stable `labels.leaderLine` contract. |
| `otef-interactive/frontend/src/shared/maplibre-style-bridge.js` | When `style.labels` is set, append MapLibre layers: `type: "symbol"` (text) and required `line` layer for leaders when `labels.leaderLine` is true. |
| `otef-interactive/frontend/src/map/maplibre-layer-manager.js` | If needed: allow label-only paths (no symbol IR) without rollback; ensure `text-field` / paint are valid. |
| `otef-interactive/frontend/src/projection/maplibre-projection.js` | Set `map.setStyle` or initial style with `glyphs` for Hebrew-capable fonts. |
| `otef-interactive/tests/map/maplibre-style-bridge.test.js` | New cases: labels → non-empty `symbol` layer; polygon + `TextString` field; halo/color/font mapping. |
| `otef-interactive/frontend/src/shared/gis-layer-filter.js` | No change required if `projector_base` remains GIS-hidden for this layer (already excludes most `projector_base` layers from GIS). |

---

### Task 1: Inspect current processed manifest and LYRX

**Files:**
- Read: `otef-interactive/public/processed/layers/projector_base/manifest.json` (if missing, note in work log)
- Read: `otef-interactive/public/source/layers/projector_base/styles/שמות_יישובים.lyrx` (top-level `layerDefinitions[0]`; *this file is `CIMAnnotationLayer` — see Task 1 note for presence/absence of `labelClasses` / `maplexLabelPlacementProperties`*)

- [x] **Step 1: Open processed manifest**

Using PowerShell from the repo root:

```powershell
Get-Content -Path "d:\Projects\Nur\nur-cityscope\otef-interactive\public\processed\layers\projector_base\manifest.json" -Raw -ErrorAction SilentlyContinue
```

**Expected:** JSON with `"layers": [...]` including entries with `"id"` fields; confirm exact string for the settlements layer id (Hebrew filename stem vs transliteration).

- [x] **Step 2: Preview LYRX label-related JSON**

```powershell
python -c "import json, pathlib; p=pathlib.Path(r'd:\Projects\Nur\nur-cityscope\otef-interactive\public\source\layers\projector_base\styles\שמות_יישובים.lyrx'); d=json.loads(p.read_text(encoding='utf-8')); print(json.dumps(d.get('layerDefinitions',[{}])[0].get('labelClasses'), ensure_ascii=False, indent=2)[:4000])"
```

**Expected (generic LYRX):** A `labelClasses` array with `textSymbol`, `expression`, and possibly `maplexLabelPlacementProperties` (capture whether **offset/leader** keys exist for Task 4).
**Repository snapshot note:** For this repo/version, `layerDefinitions[0].get("labelClasses")` is expected to be `null` because this file is `CIMAnnotationLayer`.

**Task 1 inspection (2026-04-25) — this repo’s `שמות_יישובים.lyrx`:** `layerDefinitions[0].type` is `CIMAnnotationLayer` (not a `labelClasses` + Maplex map-label stack). The document has **neither** a `labelClasses` key **nor** any `maplexLabelPlacementProperties` (verified: those substrings are absent in the full JSON). The one-liner above therefore prints `null` for `labelClasses`. Offset-related evidence is in the **annotation feature table** as field names `XOffset`, `YOffset` (plus `Angle`, `HorizontalAlignment`, `VerticalAlignment`) under `layerDefinitions[0].featureTable.fieldDescriptions`. A `featureTemplate` named **“Text Note Callout”** sets `SymbolID: 3` (callout class by symbol id, not a leader JSON blob). For Task 4, do not assume Maplex keys in this file; use per-feature offset fields, symbol/callout semantics, or generated `LineString`s per the **Rollback / fallback summary**.

---

## Work log

| When | Task | Notes |
|------|------|--------|
| 2026-04-25 | Task 1 | **Manifest** `otef-interactive/public/processed/layers/projector_base/manifest.json` **present**. Entry for שמות_יישובים: `"id": "שמות_יישובים"`, `"name": "שמות_יישובים"`, `"file": "שמות_יישובים.geojson"`, `"format": "geojson"`, `"geometryType": "polygon"`. **LYRX** `שמות_יישובים.lyrx`: no `labelClasses`, no `maplexLabelPlacementProperties`; `layerDefinitions[0]` keys include `featureTable`, `featureTemplates`, `drawGeometryLineSymbol`, `drawGeometryPointSymbol`, `subLayers`. Offset fields: `XOffset`/`YOffset` in `featureTable.fieldDescriptions`. Callout hint: template **Text Note Callout** + `SymbolID` 3. |

---

### Task 2: Add CLI + orchestrator single-layer reprocess (merge, not clobber)

**Files:**
- Modify: `otef-interactive/scripts/otef_layer_processing/cli.py`
- Modify: `otef-interactive/scripts/otef_layer_processing/orchestrator.py`
- Reference: `otef-interactive/scripts/process_layers.py` (wrapper; no change required if new flags are passed through `argv`)

**Design:** New flags (single-layer mode is **all-or-nothing**):

```text
--pack projector_base
--layer שמות_יישובים
```

**CLI invariant (required):** Exactly one of `--pack` or `--layer` is **invalid** — users must pass **both** together for single-layer reprocess, or **neither** (full `process_all` / existing flows). If only one flag is set, `argparse` must exit with a clear `parser.error(...)` (no silent ignore, no default).

When both are set, the orchestrator:
1. Resolves `geo_file = <source> / pack / gis / {layer}.json` (or `.geojson` if that is the only match — implement `glob` for exact stem).
2. Runs the same per-layer transform used for one file inside `process_all` for that file only (respect `--no-cache` for that layer’s cache key).
3. **Loads** existing `output_dir / pack / manifest.json` and `pack / styles.json` if they exist; **merges in memory** — replace the single layer entry by `id` or append; sort keys/entries to match `process_all` conventions. Rebuild in memory the root manifest payload: scan subdirectories of `output_dir` that contain `pack/manifest.json` (list pack ids), same shape as `generate_root_manifest`: `{"packs": ["...", "..."]}` sorted.
4. **Single-writer, ordered artifacts + failure semantics (required):** Never truncate live JSON in place. For every on-disk target, **write temp in same directory → `os.replace` / `Path.replace` onto the final name** so readers never see a partial file mid-write. **Single-layer write order (do not reorder without updating this contract):**
   1. **Layer body:** processed `.../{layer_stem}.geojson` (temp+replace; same for any derived sidecar, e.g. leader `LineString`s in Phase B).
   2. **Per-layer cache** (if the pipeline writes a cache file keyed to this layer): temp+replace **after** GeoJSON is fully committed (manifest must not list a file that failed mid-write).
   3. **Pack** `styles.json` (merged entry for the layer) — temp+replace.
   4. **Pack** `manifest.json` — temp+replace (now references the layer + updated style entry).
   5. **Root** `layers-manifest.json` under `output_dir` — temp+replace last (globally lists packs).

   **On exception / crash:** If step *k* throws, steps *1..k-1* may already have been replaced. **Do not** leave a half-written *final* filename (temp+replace avoids torn reads). **Recovery:** re-run the same CLI command (`--no-cache` if cache must be ignored); the merge is idempotent for that layer. If GeoJSON was updated but pack JSON was not, the next run still merges style/manifest; if pack JSON was updated but root manifest was not, re-run to refresh root. **Optional manual safety:** copy `pack/manifest.json` to `manifest.json.bak` before the first run on a precious tree (no git; local copy).

   (Single-writer assumption: do not run two CLIs against the same `output_dir` concurrently.)

- [ ] **Step 1: Add argparse entries**

In `cli.py`, after existing `parser.add_argument("--debug", ...)` add:

```python
parser.add_argument(
    "--pack",
    type=str,
    default=None,
    metavar="PACK_ID",
    help="When used with --layer, process only this pack id (e.g. projector_base).",
)
parser.add_argument(
    "--layer",
    type=str,
    default=None,
    metavar="LAYER_STEM",
    help="When used with --pack, process only this GIS file stem (e.g. שמות_יישובים).",
)
```

**Immediately after** `args = parser.parse_args()` (or equivalent), **enforce the invariant:**

```python
if (args.pack is None) != (args.layer is None):
    parser.error(
        "Single-layer mode requires both --pack and --layer. "
        "Omit both flags for a full run."
    )
```

And branch **before** `orchestrator.process_all`:

```python
if args.pack and args.layer:
    orchestrator.process_single_layer_merged(args.pack, args.layer, stuck_timeout=args.stuck_timeout)
elif args.metadata_only:
    ...
```

- [ ] **Step 2: Run single-layer reprocess (no git)**

Activate venv if present, then from `d:\Projects\Nur\nur-cityscope\otef-interactive\scripts`:

```powershell
.\.venv\Scripts\python.exe process_layers.py --no-cache --pack projector_base --layer שמות_יישובים
```

If `.venv` is missing, use `py -3 process_layers.py ...` and install deps per `README.md` (pyproj, tqdm, etc.).

**Expected console:** Log lines indicating one layer transformed; **no** "Scanning N packs" full buffer for *all* geo files across all packs (implementation must short-circuit to one task).

- [ ] **Step 3: Verify outputs on disk**

```powershell
Get-Item "d:\Projects\Nur\nur-cityscope\otef-interactive\public\processed\layers\projector_base\שמות_יישובים.geojson" | Select-Object Name, Length, LastWriteTime
python -c "import json, pathlib; s=json.loads(pathlib.Path(r'd:\Projects\Nur\nur-cityscope\otef-interactive\public\processed\layers\projector_base\styles.json').read_text(encoding='utf-8')); k='שמות_יישובים'; print(k in s, s.get(k,{}).get('labels'))"
```

**Expected:** GeoJSON mtime updated; `styles.json` has key `שמות_יישובים` with non-null `"labels": { "field": "...", "font": "...", "size": ... }`.

---

### Task 3: MapLibre style bridge — consume `style.labels`

**Files:**
- Modify: `otef-interactive/frontend/src/shared/maplibre-style-bridge.js`
- Test: `otef-interactive/tests/map/maplibre-style-bridge.test.js`

**Assumptions (שמות_יישובים — validated on source JSON):** Features are **annotation-style**: **`Polygon` / `MultiPolygon` envelopes** around each label, with the visible string in **`properties.TextString`**. The bridge must not assume **point** geometries or a `NAME`-style field. MapLibre `symbol` layers support polygon sources: text is placed at a **default position** (typically centroid / pole of inaccessibility behavior per the implementation); that matches “label in place” for these outline polygons.

**Design:** In `irToMapLibreLayers`, after the appropriate base build (`buildSimpleLayers` or `buildUniqueValueLayers`), if `style.labels` is a non-null object **and** the layer’s **geometry type supports label symbols**, append label layers. **Gate:** `buildLabelSymbolLayer` runs when `geometryType` is **point-like** (`point`, `multipoint`, and Esri point variants) **or** **polygon-like** (`polygon`, `multipolygon`, and Esri polygon variants) — the shapes used by `שמות_יישובים.json`. **Do not** emit text `symbol` layers from `style.labels` for **line-only** (or `multilinestring`) unless a future layer supplies line-annotation data and product asks for it (avoids surprising placement). **Both renderer paths must include the same label pass:** for `renderer === "simple"`, run it immediately after `buildSimpleLayers`; for `renderer === "uniqueValue"`, run it immediately after `buildUniqueValueLayers` (do not implement labels only on the simple branch).

1. Build a `symbol` layer with:
   - `id`: `${idBase}__labels`
   - `type`: `"symbol"`
   - `layout`: `text-field` as `["to-string", ["get", <field>]]` with case variants like `fieldNameCaseVariants` elsewhere — for this layer, `<field>` must resolve to **`TextString`** (from processed `labels.field` / LYRX-driven config)
   - `text-size`: from `labels.size` (points → px scaling consistent with map zoom; for projection, fixed scale is OK — use literal first)
   - `text-font`: e.g. `["Noto Sans Regular"]` or stack derived from `labels.font` (see Task 5)
   - `text-offset`: from parsed placement (default `[0, 0]`) in ems
   - `text-anchor`, `text-justify` from LYRX horizontal alignment; optional **`text-rotate`** if `labels.angle` / `Angle` is mapped later
2. **Paint:** `text-color`, `text-halo-color`, `text-halo-width` from `labels.color`, `haloColor`, `haloSize`
3. Append **after** the layer’s last non-label paint layer (e.g. **after** `circle` for points, **after** `fill` for polygons) so text draws on top (order in array = paint order)

If `defaultSymbol` produced **zero** MapLibre layers but `labels` is present, return **only** the symbol layer (critical for avoiding rollback).

**Note:** `fieldNameCaseVariants` exists at module scope in `maplibre-style-bridge.js` but is not exported. Either **export** it for tests (optional) or **duplicate** a 4-line variant list inside `buildLabelSymbolLayer` to keep the module API unchanged.

**Concrete snippet (new code inside `irToMapLibreLayers`, before return):**

```javascript
function isLabelSymbolGeometry(geometryType) {
  if (!geometryType) return false;
  const g = String(geometryType).toLowerCase().replace(/_/g, "");
  return (
    g === "point" ||
    g === "multipoint" ||
    g === "esrigeometrypoint" ||
    g === "esrigeometrymultipoint" ||
    g === "polygon" ||
    g === "multipolygon" ||
    g === "esrigeometrypolygon" ||
    g === "esrigeometrymultipolygon"
  );
}
function buildLabelSymbolLayer(idBase, fullLayerId, style, geometryType) {
  if (!isLabelSymbolGeometry(geometryType)) return [];
  const labels = style && style.labels;
  if (!labels || typeof labels !== "object") return [];
  const field = labels.field || "TextString";
  const variants = fieldNameCaseVariants(field);
  const textField =
    variants.length === 1
      ? ["to-string", ["get", variants[0]]]
      : ["to-string", ["coalesce", ...variants.map((v) => ["get", v])]];
  return [
    {
      id: `${idBase}__labels`,
      type: "symbol",
      layout: {
        "text-field": textField,
        "text-size": Number(labels.size) > 0 ? Number(labels.size) : 12,
        "text-font": ["Noto Sans Regular"],
        "text-offset": [0, 0],
        "text-anchor": "center",
      },
      paint: {
        "text-color": labels.color || "#000000",
        "text-halo-color": labels.haloColor || "#ffffff",
        "text-halo-width": Number(labels.haloSize) > 0 ? Number(labels.haloSize) : 0,
        "text-opacity": labels.colorOpacity != null ? Number(labels.colorOpacity) : 1,
      },
    },
  ];
}
```

Call site:

```javascript
const baseLayers = renderer === "uniqueValue" && uniqueValues
  ? buildUniqueValueLayers(idBase, uniqueValues, defaultSymbol, hatchPresentation)
  : buildSimpleLayers(idBase, defaultSymbol, hatchPresentation);
const labelLayers = buildLabelSymbolLayer(
  idBase,
  fullLayerId,
  style,
  layerConfig.geometryType
);
return [...baseLayers, ...labelLayers];
```

(Adjust **spread order** if points use circles + labels, or polygons use fill + labels: keep **labels last**. Pass the real `geometryType` from the `layerConfig` / IR object available in `irToMapLibreLayers`.)

- [ ] **Step 1: Add failing test**

In `otef-interactive/tests/map/maplibre-style-bridge.test.js`, add a test that matches **processed** שמות_יישובים: **polygon** IR + **empty** `symbolLayers` + **`TextString`**. (Optional second `it` for `geometryType: "point"` if you want a minimal point-only regression, but the **required** case is polygon + `TextString`.)

```javascript
it("emits a symbol layer from TextString when style.labels is set (polygon annotation geometry)", () => {
  const layerConfig = {
    geometryType: "polygon",
    style: {
      renderer: "simple",
      defaultSymbol: { symbolLayers: [] },
      labels: {
        field: "TextString",
        size: 11,
        color: "#202020",
        haloColor: "#fafafa",
        haloSize: 1.2,
        colorOpacity: 1,
      },
    },
  };
  const result = irToMapLibreLayers("projector_base.שמות_יישובים", "src", layerConfig);
  const sym = result.find((L) => L.type === "symbol");
  expect(sym).toBeDefined();
  expect(sym.layout["text-field"][0]).toBe("to-string");
  const tf = sym.layout["text-field"];
  expect(JSON.stringify(tf)).toMatch(/TextString/i);
  expect(sym.paint["text-color"]).toBe("#202020");
});
```

- [ ] **Step 2: Run test (expect FAIL until implementation)**

```powershell
cd d:\Projects\Nur\nur-cityscope\otef-interactive
npm run test -- tests/map/maplibre-style-bridge.test.js
```

**Expected (before fix):** FAIL — no `symbol` layer or empty result.

- [ ] **Step 3: Implement `buildLabelSymbolLayer` and wire-up; run test again**

```powershell
npm run test -- tests/map/maplibre-style-bridge.test.js
```

**Expected:** PASS.

---

### Task 4: Required leader lines — LYRX → IR → GeoJSON + MapLibre `line`

**Strict implementation path:** Task 4 is **required** for completion. Connector/leader lines must render in projection for this layer.

**Files:**
- Modify: `otef-interactive/scripts/otef_layer_processing/styles.py`
- Modify: reprocess step in `otef-interactive/scripts/otef_layer_processing/orchestrator.py` (e.g. post-process GeoJSON)
- Modify: `otef-interactive/frontend/src/shared/maplibre-style-bridge.js` (emit required `line` + filter when `labels.leaderLine` is true; **symbol** half uses the **same** `isLabelSymbolGeometry` gating as Task 3)

**Required path (Task 1 carry-forward):** This layer is `CIMAnnotationLayer` without `labelClasses` / `maplexLabelPlacementProperties`; do **not** require Maplex-first extraction. Implement leader/offset from annotation fields (`XOffset` / `YOffset`, alignment/angle, symbol/callout cues) and generate deterministic leaders when endpoints are unavailable, then emit `labels.offsetEm` + **`labels.leaderLine: true`** in processed `styles.json`. Prefer **preprocessing** over invalid GeoJSON:
- For each point feature, compute label anchor in WGS84 (point + offset in map units) using the same simple math the Canvas engine would use, **or** use ArcGIS "May not offset" and store the leader as a `LineString` in properties — **only if** source data has leader endpoints.

**Implementation staging (required):**

1. **Phase A (intermediate):** Establish text + `text-offset` and the processed `labels.leaderLine` contract.
2. **Phase B (required to complete):** Add `LineString` features to processed GeoJSON with property `otef_label_leader: true` and a `line` layer in the bridge filtered by that property. (One `FeatureCollection` mixing points/polygons and lines is acceptable.)
3. **Phase C (defer):** Full Maplex leader curvature / collision engine remains out of scope.

- [ ] **Step 1: Decide leader source from Task 1 LYRX snapshot**

Choose one concrete leader-source path and keep it in scope:
- If LYRX has usable leader/offset fields, parse them and map directly.
- If LYRX lacks stable leader endpoints, generate deterministic leader `LineString`s from feature geometry + label offset during processing.
Document the chosen path in a short code comment near implementation.

- [ ] **Step 2: Implement leader-line contract and bridge line layer (required)**

**Contract (required):** Processed `style.labels` includes boolean `leaderLine: true` when a leader/connector `line` layer must be emitted. The bridge emits one `line` and one `symbol` with distinct `id` values. The **`symbol`** uses the same geometry gate as Task 3, and the `line` layer is filtered to `["==", ["get", "otef_label_leader"], true]`.

**Appendix A — copy-pastable Vitest: required line + symbol**

Add exactly one test in `otef-interactive/tests/map/maplibre-style-bridge.test.js` as part of this task.

```javascript
it("emits line and symbol when style.labels.leaderLine is true (point-like)", () => {
  const layerConfig = {
    geometryType: "point",
    style: {
      renderer: "simple",
      defaultSymbol: { symbolLayers: [] },
      labels: {
        field: "TextString",
        leaderLine: true,
        size: 11,
        color: "#202020",
        haloColor: "#fafafa",
        haloSize: 1.2,
        colorOpacity: 1,
      },
    },
  };
  const result = irToMapLibreLayers("projector_base.שמות_יישובים", "src", layerConfig);
  const line = result.find((L) => L.type === "line");
  const sym = result.find((L) => L.type === "symbol");
  expect(line).toBeDefined();
  expect(sym).toBeDefined();
  expect(line.id).not.toBe(sym.id);
  const src = new Set([line.source, sym.source]);
  expect(src.size).toBe(1);
  expect((line.filter || []).length).toBeGreaterThan(0);
});
```

*(Adjust `line.filter` and `id` suffixes to match the actual bridge implementation, e.g. `...__leader` / `...__labels`.)*

---

### Task 5: Projection map `glyphs` and font stack

**Files:**
- Modify: `otef-interactive/frontend/src/projection/maplibre-projection.js`

**Design:** The initial `style` in `new maplibregl.Map({ style: { ... } })` must include:

```javascript
glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
```

**After** `map` loads, optionally `map.setGlyphUrl` is **not** in the public API on all versions — prefer setting on initial style. If the MapLibre version used supports `setGlyphsUrl`, you may call it in `map.once("load", ...)` instead.

**Font stack (bridge default):** Keep `text-font: ["Noto Sans Regular"]` in Task 3 so requests resolve against the demo glyph endpoint.

**Validation checkpoint (required before calling Task 5 done):**

1. **Network:** With the projection page open and labels enabled, DevTools → Network → filter by `pbf` (or the glyph URL prefix). Every font range request for the active `text-font` entry must return **HTTP 200** (no 404s for the chosen stack).
2. **Render:** At least one on-screen label must display Hebrew characters correctly (no tofu / missing-glyph boxes for typical settlement names).

**Fallback if Hebrew fails (apply in order, stop when checkpoint passes):**

1. **Adjust `text-font` only** (in `otef-interactive/frontend/src/shared/maplibre-style-bridge.js`): try ordered stacks that still 200 on the same `glyphs` URL, e.g. `["Noto Sans Regular", "Open Sans Semibold", "Open Sans Regular"]` — order by what the Network tab shows succeeding for the needed Unicode ranges.
2. If Hebrew still fails after (1), **change `glyphs` in `otef-interactive/frontend/src/projection/maplibre-projection.js` only** to another MapLibre-compatible glyph endpoint that serves fonts with Hebrew coverage, and re-run steps 1–2. Add a **short comment** next to the final `glyphs` URL and default `text-font` recording the **working pair** (URL + stack) for the next maintainer.
3. Do **not** add GIS-side glyph changes; projection-only.

- [ ] **Step 1: Add glyphs to projection style object**

```javascript
style: {
  version: 8,
  sources: {},
  layers: [],
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
},
```

- [ ] **Step 2: Manual verification (includes checkpoint + fallback)**

Run dev server per project:

```powershell
cd d:\Projects\Nur\nur-cityscope\otef-interactive
npm run dev:frontend
```

Open `projection.html` (per README: `http://localhost:5173/otef-interactive/projection.html` or the path Vite prints), enable `projector_base.שמות_יישובים`, confirm **Hebrew labels** render on the **annotation polygon** features (source is **not** point-only). Run the **Validation checkpoint** above; if needed, apply **Fallback** and re-test.

**Expected:** No MapLibre console error *"Style must include glyphs property"*; text visible; Hebrew validation satisfied or documented working `glyphs` + `text-font` pair in code.

---

### Task 6: Layer manager safety for label-only layers

**Files:**
- Read first: `otef-interactive/frontend/src/map/maplibre-layer-manager.js` (`addLayerToMap`)

**If** Task 3 always returns at least one layer when `labels` exists, the `addedLayerIds.length === 0` rollback may already be fixed. If symbol layer `addLayer` can still throw (invalid paint), add a narrow guard: catch and log, **do not** remove source if a partial add occurred (existing rollback already handles partial).

- [ ] **Step 1: Re-run a focused test suite**

```powershell
cd d:\Projects\Nur\nur-cityscope\otef-interactive
npm run test -- tests/map/maplibre-style-bridge.test.js tests/map/maplibre-layer-manager.test.js
```

**Expected:** All tests pass; no new failures.

---

### Task 7: End-to-end projection-only check

**Project scope:** Primary acceptance for **Projection-only policy** (header): the **only** user-visible change must be on the **projection** map (labels for this layer + projection `glyphs` as needed). **GIS visibility and behavior are a regression gate:** they must remain **as before this work** for all non-target layers, and the settlements layer must **not** become discoverable on GIS.

**Files:**
- Reference: `otef-interactive/frontend/src/shared/gis-layer-filter.js` (confirms `projector_base` layers are hidden on GIS except `Tkuma_Area_LIne`)
- Reference: `otef-interactive/frontend/src/entries/projection-main.js` (`loadCuratedLayerToMapLibre` / `syncProjectionLayers`)

- [ ] **Step 1: GIS — explicit non-regression (required)**

1. **Visibility:** `שמות_יישובים` is **not** in the effective GIS layer list (registry + `gis-layer-filter` + any legend flags). It must not appear as togglable or on-canvas for the GIS page after this work.
2. **No collateral GIS change:** Other GIS layers’ visibility, order, and default on/off state match pre-change behavior (smoke: toggle 2–3 known GIS layers; no new console errors on GIS load).
3. **If** the layer **incorrectly** surfaces on GIS, apply the **minimal** registry/`hideInLegend`/`format` tweak to match other projector-only layers (same as header policy). Document the one-liner in the work log if touched.

- [ ] **Step 2: Projection — functional acceptance**

With the layer enabled in projection UI/state, `שמות_יישובים` loads and **name labels + leader lines** render together (not text-only). **Required:** at least one on-screen label with correct Hebrew (Task 5 checkpoint), and at least one visible connector line linked to its label placement; projection page must not show *"Style must include glyphs"*` if labels are on.

---

## Rollback / fallback summary

| Risk | Mitigation |
|------|------------|
| LYRX leader extraction is unreliable | Use deterministic generated leader `LineString`s from geometry + label offset during processing; keep `labels.leaderLine=true` contract and line filter stable. |
| Hebrew glyphs 404 | Adjust `text-font` stack and `glyphs` URL pair empirically; document working pair in a code comment. |
| `addLayer` throws on `symbol` | Validate all paint/layout keys against MapLibre spec; add Vitest for produced object shape. |
| Single-layer CLI merges wrong / partial state | **Ordered writes + temp+replace** (Task 2): GeoJSON (+ cache) before pack `styles.json` / `manifest.json` / root `layers-manifest.json`; re-run same CLI to heal after a crash. Optional local `manifest.json.bak` before first run. |
| Wrong flags (`--pack` without `--layer` or the reverse) | **Invariant:** `parser.error` — both required together for single-layer mode. |
| Accidental `symbol` labels on line-only features | **Geometry gate:** `style.labels` → `symbol` only when `isLabelSymbolGeometry` (Task 3) — **polygon** + `TextString` is **in scope** for שמות_יישובים; skip **line**/**multiline** unless a future product adds line-annotation. |
| GIS page shows projector-only layer | **Task 7 Step 1** regression gate; minimal filter/registry fix only if needed. |

---

## Plan review (optional)

If using the writing-plans **review loop**, dispatch a plan reviewer with context: this file path; spec: user-validated root causes in the conversation. Max three iterations, then ask a human.

---

## Execution handoff (after implementation)

**Plan complete and saved to** `otef-interactive/docs/superpowers/plans/2026-04-25-shemot-yeshuvim-projection-support.md`. Two execution options:

1. **Subagent-Driven (recommended)** — @superpowers:subagent-driven-development — fresh subagent per task, review between tasks.  
2. **Inline** — @superpowers:executing-plans — batch with checkpoints.

**Which approach?**

---

## Reference: exact npm test one-liner for CI-style local verification

```powershell
cd d:\Projects\Nur\nur-cityscope\otef-interactive
npm run test -- tests/map/maplibre-style-bridge.test.js tests/map/maplibre-layer-manager.test.js
```

**Expected final output line:** `Test Files  2 passed` (or a Vitest success summary; exact wording varies by version).
