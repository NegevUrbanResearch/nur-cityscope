# Cityscope pink curation parity (Colab read-only consumer) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. After each implementation task: **spec compliance review** (matches this plan + `docs/superpowers/cityscope-pink-route-visual-parity-agent-prompt.md`), then **code quality review**, then mark the task complete.

**Goal:** Cityscope GIS and projection render curated pink submissions like Nur Colab Map: **stored** `pink_line_route` as the authoritative walked path (no Google / no re-routing), **ghosted removed heritage** from the same geometric rules Colab uses pre-routing, **solid** unchanged heritage, **`submission_batches.display_color`** for proposed stroke and node fill (palette rules), **memorial** `central` / `local` markers, correct **layer order** (halos under strokes), and **live refresh** via a **heartbeat** that re-pulls Supabase into Django and refreshes open pages—**no** Colab → Cityscope `sync-submission` POST (never relied on in production; problematic behind Docker).

**Architecture:** Extend the **already-ported** `buildIntegratedRoute` in `otef-interactive/frontend/src/map-utils/pink-line-route.js` to emit **`removed`** polylines (heritage subpaths replaced by detours) alongside `solid` / `dashed`. **Do not** use `dashed` from that helper for the on-screen “proposed” walk when a `pink_line_route` `LineString` exists in the published GeoJSON—use **vertices from Supabase** only. **Enrich** `FeatureCollection` in Django with `display_color` from `submission_batches` wherever published `GISLayer.data` is built from Supabase (see Task 1). **Live data:** a **periodic heartbeat** calls `GET /api/supabase/curated/pull-from-supabase/?table=…`; Django updates published layers when Supabase payloads change; the frontend, on `updated > 0`, **force-reloads** curated Leaflet/projection layers from `get_otef_layers` (see Task 6). Do **not** depend on Colab calling Cityscope. Port style tokens from `nur-colab-map/src/pages/MapPage/mapLineStyles.ts` and off-road pane behavior from `nur-colab-map/src/map/pinkDetourLeaflet.ts` into focused Cityscope modules (copy allowed; keep license headers consistent).

**Tech stack:** Django (`nur-io/django_api`), Vitest (`otef-interactive`), Leaflet, Canvas projection (`projection-layer-manager.js`), PostgREST via existing `supabase_proxy.py`.

**Reference repos:** `nur-cityscope` (all edits), `nur-colab-map` (read-only: `mapLineStyles.ts`, `pinkDetourLeaflet.ts`, `pinkLineRoute.ts` for parity checks).

---

## File map (what changes)

| Area | Files |
|------|--------|
| Django pull / GeoJSON enrich | `nur-io/django_api/backend/supabase_proxy.py` (`pull_published_curated_layers_from_supabase`, `CuratedSupabasePullView`, enrich helpers); tests targeting **pull-from-supabase** + display_color (replace any tests that only targeted removed `sync-submission`) |
| Route geometry (ghost) | `otef-interactive/frontend/src/map-utils/pink-line-route.js`; new tests `otef-interactive/tests/map-utils/pink-line-route-removed.test.js` |
| Colab-aligned styles | **Create** `otef-interactive/frontend/src/map-utils/pink-route-map-styles.js` (pure objects + `routeLineStylesForDisplayColor(displayColorHex)` ported from Colab) |
| Point filtering | **Modify** `otef-interactive/frontend/src/shared/curated-layer-service.js` — add `extractPinkDetourPointFeatures(geojson)` filtering `feature_type` in `pink_line_node`, `null`, `""` (legacy pink points); **exclude** `central` / `local` from detour math |
| Curated route builder | `otef-interactive/frontend/src/shared/curated-layer-service.js` — new `buildColabAlignedCuratedOverlay(...)` or extend `buildCuratedRouteGeoJSON` to accept stored route + `removed`/`solid` layers |
| Leaflet | `otef-interactive/frontend/src/map/leaflet-curated-layer-loader.js`; possibly `leaflet-curated-layer-loader.js` exports for tests |
| GIS loader orchestration | `otef-interactive/frontend/src/map/leaflet-control-with-basemap.js` — export `reloadCuratedLayerFromServer(fullLayerId)` |
| **Heartbeat → reload curated** | `otef-interactive/frontend/src/shared/curated-supabase-heartbeat.js`; `otef-interactive/frontend/src/map/map-initialization.js` (+ projection entry if needed); `leaflet-curated-layer-loader.js` / `leaflet-control-with-basemap.js` (`reloadCuratedLayerFromServer` or force path); mirror for `projection-layer-manager.js` |
| Projection | `otef-interactive/frontend/src/projection/projection-layer-manager.js`; tests under `otef-interactive/tests/projection/` |
| Spec | Keep `docs/superpowers/cityscope-pink-route-visual-parity-agent-prompt.md` aligned in a **final** task only if behavior diverges from §4 (optional). |

---

### Task 1: Enrich synced submission GeoJSON with `display_color`

**Files:**

- Modify: `nur-io/django_api/backend/supabase_proxy.py` (enrich in the **pull** / publish paths that assign `GISLayer.data`, not a removed Colab-only POST)
- Modify or create: Django tests for enrich + pull (replace legacy `sync-submission`–only tests if still present)

**Contract:** Whenever a `FeatureCollection` is assembled for a published curated layer from Supabase, merge **`display_color`** and **`submission_name`** from `submission_batches` (same `_get` / join pattern as `_fetch_submission_batch_rows`) into **every** feature’s `properties` so Leaflet/projection never need a second HTTP round-trip for color.

- [ ] **Step 1: Write failing Django test**

Add a test that mocks `_get` for `/geo_features` and `/submission_batches`, calls the **enrich helper** (e.g. `enrich_feature_collection_with_submission_batch`) or the pull pipeline, and asserts each feature has `properties["display_color"] == "#FF69B4"` (or normalized via `_sanitize_css_color_signal` reuse).

```python
# nur-io/django_api/backend/tests/test_curated_submission_sync_display_color.py
import pytest
from unittest.mock import patch

def test_enrich_features_with_display_color():
    fc = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [34.0, 31.0]},
                "properties": {"feature_type": "pink_line_node"},
            }
        ],
    }
    batch_rows = [{"submission_id": "550e8400-e29b-41d4-a716-446655440000", "display_color": "#FF69B4", "submission_name": "Test"}]
    # Import the helper once extracted from supabase_proxy (same package as other backend tests).
    from backend.supabase_proxy import enrich_feature_collection_with_submission_batch

    out = enrich_feature_collection_with_submission_batch(
        fc, "550e8400-e29b-41d4-a716-446655440000", batch_rows
    )
    assert out["features"][0]["properties"]["display_color"] == "#FF69B4"
```

- [ ] **Step 2: Run test — expect failure**

Run: `cd nur-io/django_api && python -m pytest backend/tests/test_curated_submission_sync_display_color.py -v`  
Expected: **FAIL** (import or function missing).

- [ ] **Step 3: Implement `enrich_feature_collection_with_submission_batch`**

In `supabase_proxy.py`, add a function that finds the batch row matching `submission_id` (use `_norm_submission_id_key`), then for each feature in `fc["features"]`, set `properties["display_color"]` and `properties["submission_name"]`. Invoke it from **`pull_published_curated_layers_from_supabase`** (and any other path that writes curated `GISLayer.data` from Supabase), immediately before persisting updated `data`.

- [ ] **Step 4: Run test — expect PASS**

Same pytest command → **PASS**.

- [ ] **Step 5: Commit**

```bash
git add nur-io/django_api/backend/supabase_proxy.py nur-io/django_api/backend/tests/test_curated_submission_sync_display_color.py
git commit -m "feat(curation): enrich synced GeoJSON with submission display_color"
```

---

### Task 2: Extend `buildIntegratedRoute` to return `removed` (ghost heritage)

**Files:**

- Modify: `otef-interactive/frontend/src/map-utils/pink-line-route.js`
- Create: `otef-interactive/tests/map-utils/pink-line-route-removed.test.js`

**Geometry rule (match Colab `pinkLineRoute.ts` intent):** For each merged interval `[intr.start, intr.end]` on `basePath`, push **`basePath.slice(intr.start, intr.end + 1)`** as one **removed** polyline (minimum two points when `intr.end > intr.start`). Keep existing `solid` / `dashed` behavior for backward compatibility; add **`removed: []`** when no user points.

- [ ] **Step 1: Failing Vitest**

```javascript
// otef-interactive/tests/map-utils/pink-line-route-removed.test.js
import { describe, it, expect } from "vitest";
import { buildIntegratedRoute } from "../../frontend/src/map-utils/pink-line-route.js";

describe("buildIntegratedRoute removed (ghost)", () => {
  it("emits removed heritage segment for one detour", () => {
    const basePaths = [[[0, 0], [0, 0.01], [0, 0.02], [0, 0.03]]];
    const userPoints = [[0, 0.015]];
    const { removed, solid, dashed } = buildIntegratedRoute(basePaths, userPoints);
    expect(dashed.length).toBeGreaterThan(0);
    expect(removed.length).toBeGreaterThan(0);
    const seg = removed[0];
    expect(seg.length).toBeGreaterThanOrEqual(2);
  });
});
```

Run: `cd otef-interactive && npx vitest run tests/map-utils/pink-line-route-removed.test.js`  
Expected: **FAIL** (`removed` undefined).

- [ ] **Step 2: Implement in `pink-line-route.js`**

Inside the loop `for (const intr of mergedIntervals)`, after computing `dashed.push(...)`, append:

```javascript
if (intr.end > intr.start) {
  removed.push(basePath.slice(intr.start, intr.end + 1));
}
```

Initialize `const removed = [];` at top; `return { solid, dashed, removed };`. Update JSDoc `@returns`.

- [ ] **Step 3: Vitest PASS**

Same vitest command.

- [ ] **Step 4: Commit**

```bash
git add otef-interactive/frontend/src/map-utils/pink-line-route.js otef-interactive/tests/map-utils/pink-line-route-removed.test.js
git commit -m "feat(map-utils): expose removed heritage polylines for ghost layer"
```

---

### Task 3: Port Colab style tokens (`mapLineStyles` subset)

**Files:**

- Create: `otef-interactive/frontend/src/map-utils/pink-route-map-styles.js`
- Create: `otef-interactive/tests/map-utils/pink-route-map-styles.test.js`

Copy numerical constants from `nur-colab-map/src/pages/MapPage/mapLineStyles.ts`: solid pink `#FF69B4`, ghost halo/stroke weights/opacities, proposed halo, proposed default `#ff587b`, dash `3 7`, off-road `#C62828` / dash `6 10`. Export **`routeLineStylesForDisplayColor(displayColorHex)`** returning `{ solidLine, oldHalo, oldLine, proposedHalo, proposedLine, offroadLine }` (Leaflet option objects: `color`, `weight`, `opacity`, `dashArray`, `lineCap: "round"`, `lineJoin: "round"`).

- [ ] **Step 1:** Vitest asserting valid palette hex returns `proposedLine.color === thatHex` and invalid returns default `#ff587b`.

- [ ] **Step 2:** Implement module (paste + adapt from Colab; no network).

- [ ] **Step 3:** `cd otef-interactive && npx vitest run tests/map-utils/pink-route-map-styles.test.js`

- [ ] **Step 4:** Commit `feat(map-utils): add Colab-aligned pink route Leaflet styles`

---

### Task 4: Filter pink detour points vs memorials

**Files:**

- Modify: `otef-interactive/frontend/src/shared/curated-layer-service.js`
- Create: `otef-interactive/tests/architecture/hotspots/curated-pink-point-filter.test.js`

Add **`extractPinkDetourPointFeatures(geojson)`**: same as `extractPointFeatures` but only features where `props.feature_type` is `pink_line_node`, missing, or empty string (treat as legacy pink). **Exclude** `central` and `local` from the returned list used for `buildIntegratedRoute`.

Memorials continue to use **`extractPointFeatures`** (or a thin `extractMemorialPointFeatures`) for markers only.

- [ ] Vitest: FC with one `central` and one `pink_line_node` → detour list length `1`.

- [ ] Commit `fix(curated): exclude memorial points from pink detour geometry`

---

### Task 5: Leaflet — draw stack: solid, ghost, stored route, off-road heuristic, nodes

**Files:**

- Modify: `otef-interactive/frontend/src/map/leaflet-curated-layer-loader.js`
- Modify: `otef-interactive/tests/map/leaflet-curated-layer-loader.memorial-dashed.test.js` or add `leaflet-curated-layer-parity.test.js`

**Behavior when** `basePaths.length > 0` **and** pink detour points exist:

1. Parse **`pink_line_route`** from `geojson.features`: first feature with `properties.feature_type === "pink_line_route"` and `LineString` / `MultiLineString`, else **no** stored line (fallback: only solid+ghost+nodes; log once in dev).
2. `const styles = routeLineStylesForDisplayColor(props.display_color)` using **per-feature** or first line feature’s `display_color`; fallback to `layerData` / `UI_CONFIG` only if missing.
3. Draw order (bottom → top): **solid** polylines → **old halo** → **old (removed)** → **proposed halo** → **proposed** = stored `pink_line_route` coords (WGS84 `[lat,lng]` for Leaflet).
4. **Off-road (optional but in spec):** walk consecutive pairs of stored route; if segment is ~straight two-point and length > `28` m (use **`OFFICIAL_NETWORK_GAP_METERS = 28`** constant in `pink-line-route.js` or styles module), render that segment with `styles.offroadLine` in a **high z-index** pane (mirror `pinkDetourLeaflet.ts` pane name pattern). If this is too tight for v1, gate behind `MapProjectionConfig` / env flag **documented in task commit message**.
5. **Nodes:** non-memorial divIcon fill from palette-valid `display_color`; memorials unchanged.

Remove the branch that draws **`dashed` from `buildIntegratedRoute`** as the main route when `pink_line_route` exists.

- [ ] Manual check: load GIS with a published curated layer that has Supabase line + nodes; compare to Colab screenshot set (product QA).

- [ ] Commit `feat(leaflet): Colab-aligned curated pink stack with stored pink_line_route`

---

### Task 6: Supabase **heartbeat** + curated layer reload (no Colab sync POST)

**Product decision:** Do **not** rely on Colab posting to Cityscope (`sync-submission` was never a dependable contract behind Docker). Instead, **Cityscope pages** periodically ask Django to **re-read Supabase** and merge into published `GISLayer` rows; when anything updates, the **same tab** refetches curated GeoJSON and redraws—no full page reload.

**Backend (already or to verify):**

- `GET /api/supabase/curated/pull-from-supabase/?table=otef` → `CuratedSupabasePullView` → `pull_published_curated_layers_from_supabase(...)`. Response should include at least **`updated`** (count of layers whose `data` changed) and **`ok: true`**.
- **Cleanup:** Remove **`CuratedSubmissionSyncView`**, **`sync-submission`** URL registration, and any tests/docs that exist **only** for that POST. Remove or stub Colab-side `notifyCityscopeSubmissionUpdated` / `cityscopeSync` in **`nur-colab-map`** (separate repo) so editors do not depend on Docker-routable Cityscope. No backward-compat requirement—the POST was unused in production.

**Frontend:**

- **`otef-interactive/frontend/src/shared/curated-supabase-heartbeat.js`** — `startCuratedSupabaseHeartbeat({ table, intervalMs ≥ 5000, onUpdated })` polls the pull endpoint; when `updated > 0`, run reload logic.
- **`reloadCuratedLayerFromServer` / force load path:** `leaflet-curated-layer-loader.js`: if `opts.force === true`, remove layer from map, `loadedLayersMap.delete(fullLayerId)`, then load again from `get_otef_layers`. `leaflet-control-with-basemap.js`: export a function that reloads **all** keys in `loadedLayersMap` starting with `curated.` (or reload each enabled curated id from current layer state).
- **`map-initialization.js`:** start heartbeat after map + loader API exist; `onUpdated` → reload all loaded curated GIS layers. **Projection:** start the same heartbeat (or shared module) from the projection bootstrap so the wall updates too—not GIS-only.
- **`otef_layers_changed`:** optional nicety only; **primary** refresh path is the heartbeat. Do not require websocket ordering for correctness.

**Verification:**

- [ ] Django: `pytest` for `pull-from-supabase` behavior and `updated` count when mocked Supabase rows change.
- [ ] Vitest: heartbeat calls `fetch` with expected URL; `onUpdated` invoked when `updated > 0` (mock `fetch`).
- [ ] Manual: edit submission in Colab → save to Supabase → within ~1–2 heartbeat intervals, GIS + projection show new geometry/colors without refresh.

- [ ] Commit `feat(otef): curated live refresh via Supabase heartbeat; remove sync-submission`

---

### Task 7: Projection canvas — parity with Leaflet stack

**Files:**

- Modify: `otef-interactive/frontend/src/projection/projection-layer-manager.js` (search `loadProjectionCuratedLayerFromAPI`, `buildCuratedRouteGeoJSON` ~250)
- Modify: `otef-interactive/tests/projection/projection-curated-memorial-dashed.test.js` or new parity test

Mirror Task 5: build multi-feature GeoJSON or draw via canvas APIs already used for `_curatedStyle` — **do not** leave projection on “integrated dashed only” when `pink_line_route` exists. Reuse **`buildColabAlignedCuratedOverlay`** from `curated-layer-service.js` if extracted as shared builder.

- [ ] `cd otef-interactive && npx vitest run tests/projection/`

- [ ] Commit `feat(projection): align curated pink rendering with GIS parity`

---

### Task 8: Manual publish path (curation UI) — ensure `display_color` in payload

**Files:**

- Inspect: `otef-interactive/frontend/src/curation/curation-publish-geojson.js`, `curation-api.js`

If manual publish builds GeoJSON client-side **without** going through Django enrich, add **`display_color`** to published features the same way as sync (or always publish via API that enriches). Document chosen path in commit body.

- [ ] Commit `fix(curation): preserve display_color in published curated GeoJSON`

---

### Task 9: Regression suite + Django tests

- [ ] Run: `cd otef-interactive && npm test`  
  Expected: **all PASS**.

- [ ] Run: `cd nur-io/django_api && python -m pytest backend/tests/ -v -k "curated or pull or supabase"` (or the concrete test files that replace legacy sync-only tests)  
  Expected: **all PASS**.

- [ ] Commit `chore: verify curation parity test suite` (only if fixing failures; otherwise no empty commit).

---

## Plan self-review (orchestrator checklist)

| Spec item (`cityscope-pink-route-visual-parity-agent-prompt.md`) | Task |
|------------------------------------------------------------------|------|
| No Google / no re-route in Cityscope | Task 5 uses stored `pink_line_route` |
| `display_color` for proposed / nodes | Tasks 1, 3, 5 |
| Ghost removed heritage | Tasks 2, 5 |
| Solid under ghost under proposed | Task 5 draw order |
| Memorials `central` / `local` | Tasks 4, 5 (markers not in detour math) |
| Live update when Supabase changes (no Colab POST) | Task 6 — heartbeat + pull + reload |
| `[lng,lat]` vs Leaflet `[lat,lng]` | Tasks 5–7 (explicit transforms) |

**Placeholder scan:** None intended; implementers must not leave "TBD" in code.

**Type consistency:** `buildIntegratedRoute` return shape gains `removed`; update every caller (`curated-layer-service.js`, any tests importing it).

---

## Plan complete and saved to `docs/superpowers/plans/2026-04-18-cityscope-pink-curation-parity.md`

**Execution options:**

1. **Subagent-driven (recommended)** — Fresh subagent per task above, spec reviewer then code quality reviewer after each task, per superpowers:subagent-driven-development.

2. **Inline execution** — Run tasks in order in this workspace with human checkpoints, per superpowers:executing-plans.

**Which approach do you want?**
