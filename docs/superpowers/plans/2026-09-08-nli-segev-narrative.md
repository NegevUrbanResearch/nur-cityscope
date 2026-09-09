# NLI Segev Narrative and Satellite Variants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add synchronized Color/B&W satellite variants and a remotely controlled Segev-family NLI narrative with GIS/projection focus, Be'eri emphasis, and an embedded Canva presentation.

**Architecture:** Persist a small revisioned `narrative_state` beside the existing OTEF state and mutate it through atomic backend commands that also own clock, person-selection, basemap, and slideshow conflicts. Each transition returns and broadcasts one captured scene snapshot that OTEFDataContext installs atomically. Frontend clients resolve the trusted `segev` definition locally; Canva open/close remains an ephemeral correlated command so reload starts safely closed.

**Tech Stack:** Django/DRF/Channels, vanilla ES modules, MapLibre GL JS, Vitest, HTML/CSS, Canva public embed.

## Global Constraints

- Preserve the existing GIS, projection, and three-tab remote applications.
- Do not commit, push, create a branch, or create a worktree without explicit owner authorization.
- Preserve unrelated dirty-tree changes, including the current edits in `otef-interactive/frontend/src/map/maplibre-person-selection.js` and its test.
- Narrative ID is exactly `segev`; label is exactly `משפחת שגב`.
- Narrative coordinate is exactly `[34.48647925700004, 31.422958191000077]`; entry zoom is exactly `18`.
- Exit scene is dark basemap at the configured OTEF-bounds center, zoom `10`; fallback center is `[34.5, 31.4]`.
- Canva embed URL is exactly `https://www.canva.com/design/DAHUaRcI6lI/Of1TuYlj0yaPV-r3UDQOKw/view?embed` and is resolved only from trusted local configuration.
- Narrative activation must not select PID 60, render Mila Cohen's popup, or expose her archive affordance.
- Both GIS and projection render `משפחת שגב`; only GIS mounts Canva.
- Closing Canva preserves the active narrative scene. Exiting or replacing a narrative closes Canva. Canva open state and slide progress do not survive GIS reload.
- B&W satellite uses the existing Esri World Imagery source with `raster-saturation: -1`; do not add another imagery provider.
- Timeline semantics and NLI source/processed artifacts remain unchanged.
- UI changes require rendered remote/GIS/projection verification in addition to automated tests.

---

## File Structure

New focused units:

- `otef-interactive/frontend/src/shared/nli-narratives.js`: trusted narrative registry and state normalization.
- `nur-io/django_api/backend/otef_narrative.py`: backend normalization and revisioned transition rules.
- `nur-io/django_api/backend/migrations/0019_otefviewportstate_narrative_state.py`: persisted shared field.
- `otef-interactive/frontend/src/remote/nli-narrative-controls.js`: narrative HTML and delegated remote actions.
- `otef-interactive/frontend/src/shared/maplibre-narrative-focus.js`: reusable GIS/projection source and layers.
- `otef-interactive/frontend/src/map/nli-narrative-presentation.js`: allowlisted Canva iframe lifecycle.
- `otef-interactive/frontend/src/map/nli-narrative-controller.js`: GIS scene and camera lifecycle.
- `otef-interactive/frontend/src/projection/projection-narrative-controller.js`: projection marker and settlement focus.

Existing integration files remain coordinators; do not move unrelated behavior into the new modules.

### Task 1: Add the B&W satellite basemap contract

**Files:**
- Modify: `otef-interactive/frontend/src/shared/gis-basemap.js`
- Modify: `otef-interactive/frontend/src/map/maplibre-map.js`
- Modify: `otef-interactive/tests/shared/gis-basemap.test.js`
- Modify: `otef-interactive/tests/map/maplibre-map-basemap.test.js`
- Modify: `nur-io/django_api/backend/views.py`
- Modify: `nur-io/django_api/backend/tests/test_otef_basemap_state_api.py`

**Interfaces:**
- Produces: `GIS_BASEMAP_IDS` containing `"satellite_bw"`.
- Produces: `isSatelliteBasemap(value): boolean` for parent-button UI state.
- Produces: `BASEMAP_STYLES.satellite_bw`, sharing Esri tile configuration and applying grayscale paint.

- [ ] **Step 1: Extend failing frontend basemap tests**

Add assertions equivalent to:

```js
expect(GIS_BASEMAP_IDS).toEqual(["osm", "satellite", "satellite_bw", "dark"]);
expect(normalizeGisBasemap("satellite_bw")).toBe("satellite_bw");
expect(isSatelliteBasemap("satellite")).toBe(true);
expect(isSatelliteBasemap("satellite_bw")).toBe(true);
expect(isSatelliteBasemap("dark")).toBe(false);
expect(BASEMAP_STYLES.satellite_bw.layers[0].paint).toEqual({
  "raster-saturation": -1,
});
expect(BASEMAP_STYLES.satellite_bw.sources.esri.tiles).toEqual(
  BASEMAP_STYLES.satellite.sources.esri.tiles,
);
```

- [ ] **Step 2: Extend the failing Django basemap test**

PATCH `{"basemap": "satellite_bw"}` and assert HTTP 200, persisted value `satellite_bw`, and an `otef_basemap_changed` broadcast carrying the same value. Keep the unknown-value rejection test.

- [ ] **Step 3: Run the focused tests and verify RED**

Run from `otef-interactive/`:

```powershell
npm.cmd test -- tests/shared/gis-basemap.test.js tests/map/maplibre-map-basemap.test.js
```

Expected: FAIL because `satellite_bw` and `isSatelliteBasemap` do not exist.

Run from `nur-io/django_api/`:

```powershell
python manage.py test backend.tests.test_otef_basemap_state_api -v 2
```

Expected: FAIL with HTTP 400 for `satellite_bw`.

- [ ] **Step 4: Implement the shared and rendered basemap variants**

Use one tile-array constant so the variants cannot drift:

```js
export const GIS_BASEMAP_IDS = Object.freeze([
  "osm",
  "satellite",
  "satellite_bw",
  "dark",
]);

export function isSatelliteBasemap(value) {
  return value === "satellite" || value === "satellite_bw";
}
```

Build both raster styles from the same Esri source factory; only `satellite_bw` gets `paint: { "raster-saturation": -1 }`. Extend the Django allowlist and exact validation error text to include `satellite_bw`.

- [ ] **Step 5: Run both focused suites and verify GREEN**

Expected: all selected Vitest and Django tests pass.

### Task 2: Persist and atomically transition narrative state

**Files:**
- Create: `nur-io/django_api/backend/otef_narrative.py`
- Create: `nur-io/django_api/backend/migrations/0019_otefviewportstate_narrative_state.py`
- Create: `nur-io/django_api/backend/tests/test_otef_narrative_api.py`
- Modify: `nur-io/django_api/backend/models.py`
- Modify: `nur-io/django_api/backend/serializers.py`
- Modify: `nur-io/django_api/backend/views.py`

**Interfaces:**
- Produces: `empty_narrative_state(revision=0) -> dict`.
- Produces: `normalize_narrative_state(raw) -> dict`.
- Produces command actions `set_narrative`, `narrative_presentation`, and `narrative_presentation_result`.
- `set_narrative` consumes `narrativeId: "segev" | null` and required `expectedRevision`.
- `narrative_presentation` consumes `presentationAction: "open" | "close"`, `narrativeId: "segev"`, and `requestId: string`.
- `narrative_presentation_result` consumes `outcome: "opened" | "closed" | "unavailable"`, `narrativeId`, and `requestId`.
- Produces one `scene` response/event shape: `{ sceneRevision, narrativeState, basemap, investigationClock, personSelection }`.

- [ ] **Step 1: Write normalization and migration tests**

Cover these exact normalized shapes:

```python
{"id": None, "transition": "initial", "revision": 0}
{"id": "segev", "transition": "enter", "revision": 4}
{"id": None, "transition": "exit", "revision": 5}
```

Assert malformed state and unsupported IDs normalize to revision-zero initial state. Assert `transition` agrees with the target ID and replacement uses `replace`.

- [ ] **Step 2: Write failing API transition tests**

Test all of the following:

- Activation persists active Segev state, increments revision, sets basemap `satellite_bw`, stops the clock at idle, and clears selected person in one request.
- Activation returns and broadcasts one captured scene snapshot after commit; it does not emit separately reread field snapshots for this transition.
- Toggling off persists the empty narrative state, increments revision, and sets basemap `dark`.
- Presentation open/close relays ephemeral correlated commands/results without mutating `narrative_state`.
- Presentation open without the matching active narrative returns 409.
- Unknown narrative ID returns 400.
- Stale `expectedRevision` returns 409 with current normalized narrative state.
- Non-idle clock or person-selection mutations while narrative is active return 409.
- Narrative activation while `projection_slideshow.type == "start"` returns 409.
- Projection slideshow Start and generic basemap PATCH while narrative is active return 409.
- Two concurrent requests based on the same revision produce one 200 and one 409.
- `GET /api/otef_viewport/by-table/otef/` includes normalized `narrative_state`.

- [ ] **Step 3: Run the narrative API tests and verify RED**

```powershell
python manage.py test backend.tests.test_otef_narrative_api -v 2
```

Expected: FAIL because the model field, migration, and commands do not exist.

- [ ] **Step 4: Add the model field and migration**

Add:

```python
narrative_state = models.JSONField(default=dict, blank=True)
```

Migration `0019` depends on `0018_otefviewportstate_person_selection` and adds the same JSON field. Add normalized `narrative_state` to `OTEFViewportStateSerializer`.

- [ ] **Step 5: Implement the backend narrative transition helper**

Keep the accepted IDs closed:

```python
NARRATIVE_IDS = frozenset({"segev"})

def empty_narrative_state(revision=0):
    revision = max(0, int(revision or 0))
    return {
        "id": None,
        "transition": "initial" if revision == 0 else "exit",
        "revision": revision,
    }
```

Implement strict ID/string/revision validation. Make `expectedRevision` mandatory. The transition function receives a row already locked with `select_for_update()`, overrides the latest coupled values by narrative ownership, and returns a captured scene dictionary before leaving the transaction. Use the same person-selection normalizer/transition helper already used by clock changes.

- [ ] **Step 6: Wire atomic commands and broadcasts**

Route the three narrative actions before general pan/zoom handling. Activation/exit must lock `OTEFViewportState`, mutate coupled fields inside one `transaction.atomic()` block, capture the final scene, and schedule exactly that captured dictionary with `transaction.on_commit()` as `otef_narrative_scene_changed`. Return the same `scene` to the initiating client.

Use this response/event payload contract on both enter and exit:

```json
{
  "scene": {
    "sceneRevision": 4,
    "narrativeState": {"id": "segev", "transition": "enter", "revision": 4},
    "basemap": "satellite_bw",
    "investigationClock": {"phase": "idle", "revision": 8},
    "personSelection": {"personId": null, "datasetVersion": null, "revision": 3}
  }
}
```

`sceneRevision` equals `narrativeState.revision`. Capture the dictionary before leaving the lock; do not have the on-commit callback reread the row.

Guard existing non-idle `investigation_clock`, person selection, projection-slideshow Start, and generic basemap PATCH when normalized narrative state has an ID. Every conflicting path must acquire the same row lock before its guard and mutation. Return HTTP 409 without partial writes. Add ephemeral command/result broadcasters patterned after archive window transport, but validate only the active narrative ID and bounded correlation fields.

- [ ] **Step 7: Run migrations checks and backend tests**

```powershell
python manage.py makemigrations --check --dry-run
python manage.py test backend.tests.test_otef_narrative_api backend.tests.test_otef_basemap_state_api backend.tests.test_otef_person_selection_api backend.tests.test_otef_investigation_clock_api -v 2
```

Expected: no uncommitted migration changes; all selected tests pass.

### Task 3: Add narrative state to the frontend data context

**Files:**
- Create: `otef-interactive/frontend/src/shared/nli-narratives.js`
- Create: `otef-interactive/tests/shared/nli-narratives.test.js`
- Create: `otef-interactive/tests/shared/narrative-state-transport.test.js`
- Modify: `otef-interactive/frontend/src/shared/message-protocol.js`
- Modify: `otef-interactive/frontend/src/shared/api-client.js`
- Modify: `otef-interactive/frontend/src/shared/OTEFDataContext.js`
- Modify: `otef-interactive/frontend/src/shared/otef-data-context/OTEFDataContext-actions.js`
- Modify: `otef-interactive/frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js`

**Interfaces:**
- Produces: `NLI_NARRATIVES`, `NLI_NARRATIVE_EXIT_SCENE`.
- Produces: `normalizeNarrativeState(value)` and `getNliNarrative(id)`.
- Produces data-context subscription key `narrativeState`.
- Produces `getNarrativeState()`, `setNarrative(id)`, `narrativePresentationCommand(action, id, requestId)`, and `narrativePresentationResult(outcome, id, requestId)`.
- Produces internal `_applyNarrativeScene(scene)` which installs every coupled value before emitting subscriber notifications.

- [ ] **Step 1: Write registry tests with the exact trusted definition**

Assert the `segev` entry and exit scene exactly match the spec. Assert `getNliNarrative("unknown") === null`, inactive presentation normalizes closed, unsupported IDs normalize inactive, and revision comparison prevents older WebSocket state replacing newer state.

- [ ] **Step 2: Write failing transport tests**

Assert:

```js
await context.setNarrative("segev");
expect(OTEF_API.executeCommand).toHaveBeenCalledWith("otef", {
  action: "set_narrative",
  narrativeId: "segev",
  expectedRevision: context.getNarrativeState().revision,
  sourceId: expect.any(String),
  timestamp: expect.any(Number),
});
```

Also cover ephemeral presentation command/results, REST bootstrap, `otef_narrative_scene_changed`, reconnect snapshots, stale revisions, subscriptions, and cleanup. Assert the initiating client hydrates basemap, clock, person, and narrative from the command response even when its same-source WebSocket event is ignored. Assert subscribers run only after all getters expose the new scene.

- [ ] **Step 3: Run the focused tests and verify RED**

```powershell
npm.cmd test -- tests/shared/nli-narratives.test.js tests/shared/narrative-state-transport.test.js
```

Expected: FAIL because the new interfaces do not exist.

- [ ] **Step 4: Implement the registry and transport**

Freeze registry definitions and nested coordinate arrays. Add:

```js
NARRATIVE_SCENE_CHANGED: "otef_narrative_scene_changed",
NARRATIVE_PRESENTATION_COMMAND: "otef_narrative_presentation_command",
NARRATIVE_PRESENTATION_RESULT: "otef_narrative_presentation_result",
```

to the message protocol. Normalize through `normalizeNarrativeState` and never copy URL/coordinate data from WebSocket payloads. `_applyNarrativeScene()` assigns `_narrativeState`, `_basemap`, `_investigationClock`, and `_personSelection` first, then notifies their subscribers in that order-independent fully installed state.

- [ ] **Step 5: Run focused and adjacent transport suites**

```powershell
npm.cmd test -- tests/shared/nli-narratives.test.js tests/shared/narrative-state-transport.test.js tests/shared/person-selection-transport.test.js tests/shared/otef-data-context-actions.test.js
```

Expected: all selected tests pass.

### Task 4: Build remote basemap variants and narrative controls

**Files:**
- Create: `otef-interactive/frontend/src/remote/nli-narrative-controls.js`
- Create: `otef-interactive/tests/remote/nli-narrative-controls.test.js`
- Modify: `otef-interactive/frontend/src/remote/remote-place-navigation.js`
- Modify: `otef-interactive/frontend/src/remote/remote-people-archive-controller.js`
- Modify: `otef-interactive/tests/remote/remote-people-selection-controller.test.js`
- Modify: `otef-interactive/frontend/remote-controller.html`
- Modify: `otef-interactive/frontend/css/remote-styles.css`
- Modify: `otef-interactive/frontend/src/remote/remote-controller.js`
- Modify: `otef-interactive/frontend/src/remote/layer-sheet-controller.js`
- Modify: `otef-interactive/frontend/src/remote/nli-timeline-transport.js`
- Modify: `otef-interactive/frontend/src/remote/remote-locale.js`
- Modify: `otef-interactive/tests/contracts/html-entrypoint-contract.test.js`
- Modify: `otef-interactive/tests/remote/remote-locale.test.js`
- Modify: `otef-interactive/tests/remote/remote-tab-panels-hidden-contract.test.js`
- Modify: `otef-interactive/tests/remote/nli-timeline-transport.test.js`

**Interfaces:**
- Produces: `nliNarrativeControlsHtml(selectedPack, narrativeState, disabledReason)`.
- Produces: `consumeNliNarrativeButtonClick(event, host): boolean`.
- Consumes host methods `setNarrative(id)` and `runNarrativePresentation(action, id)`.

- [ ] **Step 1: Write failing basemap DOM and locale tests**

Require the parent Satellite control plus a child group containing exact `data-basemap="satellite"` and `data-basemap="satellite_bw"` buttons. Test expansion for either satellite value, collapse for OSM/Dark, parent active state, child `aria-pressed`, Hebrew/English strings, and disabled state while narrative is active.

- [ ] **Step 2: Write failing narrative-control tests**

Cover inactive, active/presentation-closed, active/presentation-open, slideshow-disabled, delegated toggle, correlated presentation open/close result, timeout/unavailable, failure rollback, and translated accessible labels. Assert timeline buttons and remote person search/selection/archive affordances are disabled while narrative is active.

- [ ] **Step 3: Run the remote tests and verify RED**

```powershell
npm.cmd test -- tests/contracts/html-entrypoint-contract.test.js tests/remote/remote-locale.test.js tests/remote/remote-tab-panels-hidden-contract.test.js tests/remote/nli-timeline-transport.test.js tests/remote/nli-narrative-controls.test.js
```

Expected: FAIL because variant and narrative controls are absent.

- [ ] **Step 4: Implement the two-level basemap UI**

Keep click delegation inside `#basemapControl`. A top-level Satellite click selects `satellite`; child buttons set their exact values. `updateBasemapUI()` derives parent state through `isSatelliteBasemap()` and controls the child group's `hidden` attribute. Disable all basemap buttons whenever normalized narrative state is active.

- [ ] **Step 5: Implement the narrative row as a focused module**

Build `narrativeSheet` separately and place it with `nliSheet` inside one bottom-anchored wrapper:

```html
<div class="nli-bottom-dock">
  ${narrativeSheet}
  ${nliSheet}
</div>
```

Only render the wrapper for selected pack `nli`. Move absolute bottom positioning from `.nli-tl-sheet` to `.nli-bottom-dock`; keep `.nli-tl-sheet` as the bottom child and render the compact full-width narrative row directly above it. Increase the NLI tile area's reserved bottom padding to the measured dock height so short screens scroll the layer area without covering tiles. The visual order is NLI layer tiles, narrative controls, timeline controls, and the timeline remains against the bottom navigation. Prevent horizontal overflow. Use stable attributes:

```html
<button data-nli-narrative="segev" aria-pressed="true">משפחת שגב</button>
<button data-nli-narrative-presentation="close">סגור מצגת</button>
```

Subscribe `LayerSheetController` to `narrativeState`, clear optimistic state on acknowledgement/failure, and rerender. Use a small remote presentation controller patterned after the archive controller for request IDs, result correlation, and timeout. Disable timeline transport and the remote people controller via explicit `narrativeActive` inputs rather than teaching the clock or person model about narratives.

- [ ] **Step 6: Run the remote suites and verify GREEN**

Expected: all selected tests pass with keyboard focus-visible and 40px-or-larger narrative tap targets.

### Task 5: Add the shared narrative marker and focused settlement paint

**Files:**
- Create: `otef-interactive/frontend/src/shared/maplibre-narrative-focus.js`
- Create: `otef-interactive/tests/shared/maplibre-narrative-focus.test.js`
- Modify: `otef-interactive/frontend/src/shared/nli-settlement-orientation.js`
- Modify: `otef-interactive/tests/shared/nli-settlement-orientation.test.js`
- Modify: `otef-interactive/frontend/src/shared/nli-investigation-theme.js`

**Interfaces:**
- Produces: `createNarrativeFocusRenderer(map, { profile })` with `show(definition)`, `clear()`, `onStyleLoad()`, and `dispose()`.
- Extends: `applySettlementOrientationPaint(map, options)` with `focusCityname`, `focusOutlineObjectId`, and `mode: "narrative"`.

- [ ] **Step 1: Write failing marker lifecycle tests**

Assert dedicated IDs, exact coordinate/label GeoJSON, GIS/projection profile sizes, idempotent `show`, style reload reconstruction, non-interactivity, `clear`, and disposer cleanup. Explicitly assert no `Popup`, `personId`, or `otef-person-selection` identifier is used.

- [ ] **Step 2: Write failing settlement-focus tests**

Provide mocked settlement layers/features and assert label expressions keep `cityname === "בארי"` at normal opacity, polygon expressions keep `OBJECTID === 19` at normal opacity, and other features use existing dim tokens. Assert `Locations_Lines` is unchanged. Assert `mode: "idle"` or cleanup restores normal host paint and narrative mode wins over idle clock paint.

- [ ] **Step 3: Run focused tests and verify RED**

```powershell
npm.cmd test -- tests/shared/maplibre-narrative-focus.test.js tests/shared/nli-settlement-orientation.test.js
```

Expected: FAIL because narrative focus interfaces are missing.

- [ ] **Step 4: Implement dedicated MapLibre narrative layers**

Use a GeoJSON source with one Point feature and separate halo and symbol layers. The symbol text comes from the trusted definition's `label`; use `text-allow-overlap: true` and display-profile tokens rather than hard-coded duplicate GIS/projection styles.

- [ ] **Step 5: Extend settlement paint with an explicit narrative branch**

Extend the existing orientation render path so it composes narrative focus instead of racing a second writer. Match labels by `cityname`, polygons by `OBJECTID`, and leave unkeyed leaders unchanged. Pass current narrative focus into timeline orientation rendering while active, and trigger one normal timeline resync on exit; do not claim a nonexistent generic paint-capture mechanism or fake achieved timeline beats.

- [ ] **Step 6: Run focused and timeline regression suites**

```powershell
npm.cmd test -- tests/shared/maplibre-narrative-focus.test.js tests/shared/nli-settlement-orientation.test.js tests/shared/maplibre-investigation-timeline.test.js
```

Expected: all selected tests pass and existing timeline dimming is unchanged.

### Task 6: Implement the GIS narrative scene and Canva overlay

**Files:**
- Create: `otef-interactive/frontend/src/map/nli-narrative-presentation.js`
- Create: `otef-interactive/frontend/src/map/nli-narrative-controller.js`
- Create: `otef-interactive/tests/map/nli-narrative-presentation.test.js`
- Create: `otef-interactive/tests/map/nli-narrative-controller.test.js`
- Modify: `otef-interactive/frontend/src/entries/map-main.js`
- Modify: `otef-interactive/frontend/src/entries/map-main-style-lifecycle.js`
- Modify: `otef-interactive/frontend/src/map/maplibre-gis-person-controller.js`
- Modify: `otef-interactive/frontend/css/styles.css`
- Modify: `otef-interactive/tests/map/map-main-style-lifecycle.test.js`

**Interfaces:**
- Produces: `createNarrativePresentation(container, options)` with `open(definition)`, `close()`, `isOpen()`, and `dispose()`.
- Produces: `createGisNarrativeController({ map, dataContext, viewportSync, personVisual })` with `apply(state)`, `onStyleLoad()`, `isActive()`, and `dispose()`.

- [ ] **Step 1: Write failing Canva overlay tests**

Assert only the exact trusted `www.canva.com` design/path with `?embed` mounts; arbitrary definitions/URLs are rejected. Assert iframe title, `allow="fullscreen"`, fullscreen attribute, full-viewport class, idempotent open, close, and dispose. Closing must not invoke basemap, camera, marker, or narrative-state APIs.

- [ ] **Step 2: Write failing GIS scene tests**

Activation must call:

```js
viewportSync.beginCameraTravel("narrative-segev");
map.flyTo({
  center: [34.48647925700004, 31.422958191000077],
  zoom: 18,
  essential: true,
  duration: 1600,
});
```

Exit must close presentation, clear focus visuals, restore settlement paint, resolve the configured bounds center, and fly there at zoom 10, falling back to `[34.5, 31.4]`. Test that presentation close while state remains active changes none of those scene calls. Cover initial inactive revision zero (no flight), active reconnect, inactive exit revision handled once per session, duplicate revisions, and rapid enter/exit cancellation via `map.stop()` plus a style-generation token.

- [ ] **Step 3: Write failing person-suppression tests**

Assert map person clicks and person-selection renders are ignored/cleared while `narrativeController.isActive()` is true, and ordinary behavior resumes after exit. Preserve any owner edits in `maplibre-person-selection.js`; prefer the person controller integration seam unless a minimal overlap is unavoidable. Inject and assert an idempotent `closeArchive()` callback on entry, replacement, and exit so clearing selection cannot leave the named archive window open.

- [ ] **Step 4: Run the GIS tests and verify RED**

```powershell
npm.cmd test -- tests/map/nli-narrative-presentation.test.js tests/map/nli-narrative-controller.test.js tests/map/map-main-style-lifecycle.test.js tests/map/maplibre-person-selection.test.js
```

Expected: FAIL because narrative controllers are absent.

- [ ] **Step 5: Implement the iframe and GIS scene controllers**

Mount the overlay inside the GIS map shell, not inside MapLibre's canvas. Use CSS equivalent to:

```css
.nli-narrative-presentation {
  position: absolute;
  inset: 0;
  z-index: 10000;
  background: #000;
}

.nli-narrative-presentation iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}
```

Resolve every scene value from `getNliNarrative(state.id)`. The iframe command bridge is separate from narrative revisions and survives MapLibre style reload unchanged. Add an Escape handler that closes the overlay and emits a correlated `closed` result when a request is active.

- [ ] **Step 6: Wire `map-main.js` and interaction guards**

Subscribe once to `narrativeState`, pass the existing `viewportSync.beginCameraTravel`, configured bounds getter, `archiveWindow.close`, and register all disposers. Track handled scene revisions in `sessionStorage`; camera entry/exit runs only for an unhandled scene transition, never for presentation commands. Ensure active narrative state is applied after initial layer/style readiness. Pass an `isNarrativeActive` predicate into the GIS person controller instead of importing global state there.

Replace the one-shot style reload accumulation with one generation-aware coordinator. On a new basemap change, increment generation, detach the prior `style.load` listener, and let only the current generation run: base style → host/curated layers → timeline orientation using current narrative focus → narrative marker/outline. Add a rapid enter→exit test where the satellite style has not loaded before dark is requested.

- [ ] **Step 7: Run GIS and lifecycle regression suites**

```powershell
npm.cmd test -- tests/map/nli-narrative-presentation.test.js tests/map/nli-narrative-controller.test.js tests/map/map-main-style-lifecycle.test.js tests/map/maplibre-person-selection.test.js tests/map/nli-archive-window.test.js tests/map/maplibre-map-basemap.test.js
```

Expected: all selected tests pass.

### Task 7: Render narrative focus on projection

**Files:**
- Create: `otef-interactive/frontend/src/projection/projection-narrative-controller.js`
- Create: `otef-interactive/tests/projection/projection-narrative-controller.test.js`
- Modify: `otef-interactive/frontend/src/entries/projection-main.js`
- Modify: `otef-interactive/tests/projection/projection-bounds-rotation-maplibre-contract.test.js`

**Interfaces:**
- Produces: `createProjectionNarrativeController({ map })` with `apply(state)`, `onStyleLoad()`, and `dispose()`.
- Consumes: shared narrative registry, shared focus renderer with projection profile, and narrative settlement focus.

- [ ] **Step 1: Write failing projection narrative tests**

Assert active Segev state renders both marker and exact `משפחת שגב` label, applies Be'eri focus, does not mount an iframe, does not change projection camera, survives style/layer rebuild, and clears on exit/replacement.

- [ ] **Step 2: Add a projection entry contract test**

Assert `projection-main.js` subscribes to `narrativeState` and leaves `syncProjectionHighlight(viewport)` as the only focus-camera path. The narrative controller must not call `flyTo`, `jumpTo`, or `easeTo`.

- [ ] **Step 3: Run projection tests and verify RED**

```powershell
npm.cmd test -- tests/projection/projection-narrative-controller.test.js tests/projection/projection-bounds-rotation-maplibre-contract.test.js
```

Expected: FAIL because the controller and subscription do not exist.

- [ ] **Step 4: Implement and wire the projection controller**

Use `createNarrativeFocusRenderer(map, { profile: "projection" })`. Apply settlement focus only after projection layer synchronization has made orientation targets available, and reapply it after layer rebuild. Keep Canva code out of the projection dependency graph.

- [ ] **Step 5: Run projection and shared visual regression suites**

```powershell
npm.cmd test -- tests/projection/projection-narrative-controller.test.js tests/projection/projection-bounds-rotation-maplibre-contract.test.js tests/projection/projection-person-halo.test.js tests/shared/maplibre-investigation-timeline.test.js
```

Expected: all selected tests pass.

### Task 8: Verify the complete state machine and document exhibit acceptance

**Files:**
- Create: `otef-interactive/tests/contracts/nli-segev-narrative-contract.test.js`
- Modify: `otef-interactive/docs/nli-exhibit-verification.md`
- Modify: `otef-interactive/README.md`

**Interfaces:**
- Verifies all earlier interfaces as one feature; produces no new runtime API.

- [ ] **Step 1: Add cross-surface contract tests**

Assert the trusted coordinate, zoom 18, zoom-10 exit, `satellite_bw`, Canva embed path, GIS-only iframe import, dual-surface Hebrew label, NLI-sheet control ownership, and narrative subscription wiring. Assert no narrative module imports PID 60 or the victim archive controller.

- [ ] **Step 2: Run the complete frontend suite**

```powershell
npm.cmd test
```

Expected: all Vitest suites pass.

- [ ] **Step 3: Run the complete Django suite**

From `nur-io/django_api/`:

```powershell
python manage.py test backend.tests -v 2
```

Expected: all backend tests pass.

- [ ] **Step 4: Build and run static checks**

From `otef-interactive/`:

```powershell
npm.cmd run build:frontend
```

From repository root:

```powershell
git diff --check
git status --short
```

Expected: frontend build succeeds, `git diff --check` is silent, and status lists only intended work plus the owner's pre-existing person-selection edits.

- [ ] **Step 5: Update manual verification documentation**

Add an unchecked Segev narrative matrix to `nli-exhibit-verification.md` covering:

- Satellite Color/B&W manual selection.
- Entry at the exact house through zoom 18 with no zoom-19 request.
- No Mila victim popup/archive state.
- GIS and projection `משפחת שגב` legibility.
- Be'eri bright and other settlements dim.
- Projection viewport highlight centered on the house.
- Canva presentation-mode load without login, `no-referrer` behavior, Escape recovery, and remote command/result correlation.
- Remote close preserving the narrative map scene.
- Narrative toggle-off closing Canva and returning to dark, configured OTEF-bounds center at zoom 10.
- Refresh/reconnect convergence on durable active/inactive narrative state, with Canva intentionally closed after reload.

Do not record pass/fail until tested in the normal kiosk Chrome and physical projection setup.

- [ ] **Step 6: Perform rendered desktop smoke verification**

Run the normal frontend/deployment stack and inspect the remote and GIS together. Confirm control expansion, RTL labels, iframe stacking, camera transitions, and close-vs-exit behavior. Record only observable desktop results; leave projector/hardware gates pending.

## Plan Self-Review Results

- Spec coverage: every acceptance criterion maps to Tasks 1-8.
- Placeholder scan: no deferred implementation placeholders are present.
- Type consistency: `narrativeState`, `setNarrative`, `runNarrativePresentation`, `createNarrativeFocusRenderer`, and the GIS/projection controller methods use the same names throughout.
- Scope: basemap variants and the first narrative are one end-to-end feature because narrative entry depends on the B&W variant; no unrelated refactor is included.
- Repository policy: commit steps from the generic writing-plans template are intentionally omitted because `otef-interactive/AGENTS.md` forbids commits without explicit owner authorization.
