# NLI exhibit verification

Use this checklist on the normal exhibit browser and physical display. Unit
tests cannot prove popup permission, window placement, foreground focus,
cross-origin page load, route-dash visibility, or label readability. No
programmatic check can claim that the cross-origin NLI document loaded.

Automated checks establish local handle acquisition and navigation assignment.
They do not replace the runtime and exhibit gates below.

## Polygon-gradient lab evidence (Task 6)

Complete one row for every category and display after observing the normal
exhibit on the actual display. Do not infer a pass from a unit test, a local
browser window, or a screenshot rendered without the exhibit hardware. The
table is intentionally unfilled until a hardware colleague records the
observation.

| Display (`GIS`, `projection-left`, `projection-right`) | Category | Polygon shape/size | Cycle duration | Band count | Step duration | Cadence | Effective FPS | Sample count | Scheduler p95 | Observer wording | Pass/fail | Explicit adjustments |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| GIS | battle |  |  |  |  |  |  |  |  |  | pending |  |
| GIS | fire |  |  |  |  |  |  |  |  |  | pending |  |
| GIS | hostage |  |  |  |  |  |  |  |  |  | pending |  |
| projection-left | battle |  |  |  |  |  |  |  |  |  | pending |  |
| projection-left | fire |  |  |  |  |  |  |  |  |  | pending |  |
| projection-left | hostage |  |  |  |  |  |  |  |  |  | pending |  |
| projection-right | battle |  |  |  |  |  |  |  |  |  | pending |  |
| projection-right | fire |  |  |  |  |  |  |  |  |  | pending |  |
| projection-right | hostage |  |  |  |  |  |  |  |  |  | pending |  |

Record the authored values and the observed values separately when they
differ. Explicit adjustments must name the changed token or deployment
setting; never write a guessed value into this record.

## Polygon motion and browser acceptance checklist (Task 6)

Run the checklist with battle, fire, and hostage polygons together. Exercise
small, large, concave, multipart, and holed polygon examples. Exercise
**Play**, **Pause**, **End**, replay, seek, **Stop at 06:29**, and reduced
motion. Check labels, terrain, story clock, alarms, and routes at the same
time. Reject any interpretation that looks like breathing, flashing,
targeting, shrinking, or an outward spread; the approved motion is continuous
inward translation: each authored band becomes the next inner geometry, and
the sequence wraps seamlessly.

- [ ] GIS and projection show the same clock, polygon phase, and entry values;
  only the existing profile scale and Nova dimming may differ.
- [ ] The browser console is free of MapLibre expression errors on both
  surfaces.
- [ ] All five polygon shape/size cases remain stable through Play, Pause,
  End, replay, seek, Stop at 06:29, and reduced motion.
- [ ] Battle, fire, and hostage colors, outlines, labels, terrain, clock,
  alarms, and routes remain legible together.
- [ ] The motion does not read as breathing, flashing, targeting, shrinking,
  or an outward spread.

No physical lab acceptance is claimed by this document. Hardware colleague
review and the 1,000-sample measurement remain **pending** unless the result
record names the actual display, operator, date, browser, and trace.

## Recorded automated evidence

The following results are automated evidence. The R4 report records the fresh
commands and outcomes:

- Promoted NLI release validation passed.
- Frontend verification covered 196 files and 1,928 tests; the production
  build succeeded.
- The Django clean-database run still prompts for confirmation and ends at
  EOF in the non-interactive check. The `--keepdb` run passed 216 tests.
- The running nginx deployment returned `200` for the GIS, projection, remote,
  and six NLI runtime artifact endpoints.
- Local tests cover People search, selection recovery, on-demand named-window
  navigation, result-driven remote state, timeout cancellation, **Back to map**,
  unavailable reporting, and selection clearing.
- No current normal-browser result proves popup permission, named-window
  placement, cross-origin load, or the remote return flow. Keep those outcomes
  as manual gates.
- Automated GIS popup observation was inconclusive because the isolated Edge
  session did not complete MapLibre/WebGL initialization.

## Required integration and visual checks

Run these checks against the current Docker/nginx deployment. Record the
browser, display arrangement, console result, and outcome in the result record.

- [ ] Confirm `http://localhost/otef-interactive/`,
  `http://localhost/otef-interactive/projection.html`, and
  `http://localhost/otef-interactive/remote-controller.html` return `200`.
- [ ] Confirm the GIS dark basemap uses the local OpenFreeMap Dark style with
  Hebrew-first white place and road names, and that labels shape and remain
  legible. Record any console error.
- [ ] With the timeline off, during playback, or after **Stop**, confirm every
  visible route remains red. Future and revealing routes use the solid red
  route family, and the active reveal follows its reviewed direction.
- [ ] After completion, confirm every route keeps a solid red carrier and adds
  a black, line-based dashed overlay over the carrier that flows across its full
  geometry in the reviewed direction.
- [ ] Confirm completed route motion remains visible through **Pause** and
  **End**, and that timeline-off and post-**Stop** idle states animate every
  visible route as completed. Confirm reduced-motion mode uses static
  directional dashes.
- [ ] Confirm a polygon-only beat activates at its authored beat, while a
  polygon sharing a route beat waits until that route reveal completes. Confirm
  route geometry alone never activates an investigation polygon.
- [ ] Confirm settlement outlines activate through both paths: a revealing
  route reaches or crosses the boundary, and an associated investigation
  polygon turns red.
- [ ] In remote **Navigation**, select a person and confirm the GIS animates
  to zoom `16` over `1600 ms`, shows one halo and name/location bubble, and
  keeps the suggestions closed after acknowledgement.
- [ ] In the Hebrew remote, confirm the archive action reads
  `פתיחת ארכיון הספרייה`.
- [ ] In projection, confirm the NLI timeline caption shows only the readable
  `HH:MM` story clock. Confirm the remote **Presentation** tab, slideshow, and
  `presentationActive` behavior remain unchanged.
- [ ] Confirm GIS and projection clock parks match the committed 2026-09-07
  owner lab clock park in the default layout and persisted JSON
  (`otef.nliExplainerLayout.v2` / `otef.nliGisClockLayout.v2`): transparent
  caption, type sized from `fontPx`, GIS rotate handle works. Left span:
  `46.90416666666667, 22.113809679110926, 8.886423224258024, 8.323215088627478, 56, 91.18739188335852`
  for `leftPct, topPct, widthPct, heightPct, fontPx, rotateDeg`. Full/right
  unchanged. Full record: **2026-09-07 lab follow-up exhibit gates** Clock left
  park.

## NLI clock relevance matrix (Task 6)

Run every applicable row on both GIS and projection. Record the observed
visibility and story clock; the expected result is the same unless a row is
marked GIS-only.

| Case | GIS | Projection | Expected result |
|---|---|---|---|
| No relevant layer/no narrative | [ ] | [ ] | Clock absent. |
| `nli.alarms` only | [ ] | [ ] | Clock present; outside Nova, Stop is `06:29`. |
| `nli.lines` (infiltration lines) only | [ ] | [ ] | Clock present; outside Nova, Stop is `06:29`. |
| `nli.investigation_polygons` only | [ ] | [ ] | Clock present; outside Nova, Stop is `06:29`. |
| Victims names / `nli.people_names` alone | [ ] | [ ] | Clock absent. |
| Another unrelated NLI layer only | [ ] | [ ] | Clock absent. |
| Segev or Nova with relevant chips off | [ ] | [ ] | Clock remains visible: Segev idle/Stop is `06:29`; Nova idle/Stop is `08:03`, while Play starts beat 1 at zero reveal without an `08:03` lead-in. |
| Projection slideshow warmup/crossfade (projection only) | N/A | [ ] | Warmup/staging do not change relevance; visibility changes only at reveal. Right span is blank. |
| GIS zoomed-out view, press `e`, edit/move the clock, then refresh | [ ] | N/A | Edit/move survives refresh; the `start` layout is used when zoomed out. |

For slideshow rows, verify that projection consumes the committed revealed pack.
For the GIS edit row, verify that the remote map is used for initial load,
rebind, edits, and refresh restoration, with browser storage as fallback.

## Technician browser setup

Before the exhibit session, run the following command from the repository root
in Windows PowerShell as administrator. It installs a machine-wide Chrome popup
allowlist for exactly `http://localhost:80`:

```powershell
& '.\otef-interactive\scripts\configure-chrome-popup-policy.ps1' -Mode Install
```

Running the script without `-Mode Install` only reports policy status. This
one-time allowlist is technician setup. The presenter uses only the remote
controller and never activates the archive from the GIS.

## Required manual window check

Record the browser, operating mode, display arrangement, and result.

- [ ] Open the GIS and remote against the running CityScope deployment.
- [ ] In remote **Navigation**, switch to **People** and select a person with an
  NLI record.
- [ ] Confirm the GIS shows one halo and a name/location bubble.
- [ ] Press **Open NLI record**.
- [ ] Confirm GIS opens or reuses one named top-level `otef-nli-archive` window
  with the validated record URL.
- [ ] Confirm the remote remains pending until GIS emits the matching
  `navigation_attempted` result. Treat that result as local handle acquisition
  and navigation assignment only, not as proof of cross-origin page load.
- [ ] Confirm the NLI record becomes visible on the intended display in the
  normal exhibit browser.
- [ ] Confirm the remote shows **Back to map** only after that matching result.
- [ ] Press **Back to map** and confirm the archive closes and the GIS regains
  focus or is immediately available.
- [ ] Exercise an unavailable or closed context, or let an open request reach
  its timeout. Confirm the pending request is cancelled, the remote returns to
  a usable open or error state, and a later **Open NLI record** request can
  retry after the context becomes available.
- [ ] After returning to the map, select another person or settlement. Confirm
  the previous archive action is gone and the new selection state is correct.
- [ ] Select a person without a linked record. Confirm **No NLI record found**
  appears and no window opens.
- [ ] Close the archive manually, then press **Back to map**. Confirm the action
  is safe and restores the remote Navigation content.

## NLI Segev narrative matrix (Task 8)

Run this matrix in the normal kiosk Chrome and physical projection setup. The
automated contract test covers the narrative registry and scene wiring; it
cannot prove physical projection legibility or the observed camera result.
The old Canva iframe has been removed. Slide playback needs a new acceptance
matrix after the Reveal.js viewer and revised slide mapping are implemented.
Leave every row unchecked until it has been observed by the exhibit operator.

- [ ] From the NLI sheet, manually select **Satellite Color** and **Satellite
  B&W** and confirm the intended basemap appears on the GIS.
- [ ] Start the Segev narrative and confirm entry targets the exact house at
  zoom `18`; confirm no zoom-`19` request or visible zoom-`19` stop occurs.
- [ ] Confirm the narrative does not open a Mila victim popup, select a victim,
  or create NLI archive state.
- [ ] Confirm the Hebrew `משפחת שגב` focus label is legible on both GIS and
  projection.
- [ ] Confirm Be'eri is bright while other settlement outlines remain dim.
- [ ] Confirm the projection viewport highlight is centered on the house.
- [ ] While Segev is active, Play/Pause/Stop/Loop/step/scrub
  the NLI timeline and confirm polygons, alarms, and routes develop around the
  house without the GIS leaving zoom 18.
- [ ] Toggle the narrative off and confirm GIS returns to the dark configured
  OTEF-bounds center at zoom `10`.
- [ ] Refresh or reconnect with durable active and inactive narrative state;
  confirm both GIS and projection converge.

### Result record

- Date and time:
- Browser and version:
- Browser mode or kiosk flags:
- GIS display arrangement:
- Integration endpoints and console errors:
- Timeline route state and flowing-dash direction: pass / fail
- Pause, End, and Stop lifecycle: pass / fail
- Polygon beat sequencing: pass / fail
- Settlement route-boundary trigger: pass / fail
- Settlement investigation-polygon trigger: pass / fail
- Dark basemap and Hebrew labels: pass / fail
- Person zoom and dropdown closure: pass / fail
- Projection clock-only caption and Presentation isolation: pass / fail
- Remote state follows matching GIS result: pass / fail
- Timeout cancellation: pass / fail
- Open retry after unavailable or close: pass / fail
- Popup permission enabled: yes / no
- Named window reused: pass / fail
- Opened on intended display: pass / fail
- **Back to map**: pass / fail
- Selection-change cleanup: pass / fail
- Missing-record behavior: pass / fail
- Manual-close recovery: pass / fail
- Programmatic cross-origin load claim: none (required)
- `navigation_attempted` treated as load proof: no (required)
- Interleaved revision-4 HTTP / revision-5 WebSocket retry: pass / fail
- Segev Satellite Color / B&W selection: pass / fail
- Segev exact-house zoom-18 entry (no zoom-19): pass / fail
- Segev no Mila victim popup/archive state: pass / fail
- Segev GIS + projection Hebrew label: pass / fail
- Segev Be'eri focus and dim other settlements: pass / fail
- Segev projection house highlight: pass / fail
- Segev house-locked timeline Play/Pause/Stop/Loop/step/scrub at zoom 18: pass / fail
- Segev exit returns to dark bounds center zoom 10: pass / fail
- Segev refresh/reconnect convergence: pass / fail
- Notes:

## Later exhibit acceptance

These checks complete acceptance after the integration and window checks:

- Run the full timeline interaction matrix on GIS and projection together.
- Review route direction, red carrier and dash contrast, settlement outlines,
  alarm scaling/ripple, bubble legibility, halo visibility, clock placement,
  and reduced motion on the exhibit hardware.
- Capture at least 1,000 dense-state scheduler samples on each actual display
  and confirm the 95th percentile is at or below 8 ms. This remains pending
  until a hardware colleague records it.
- **Stop** / `idle` may retain exactly one existing shared per-map RAF while a
  visible full-motion approved ambient consumer exists: a completed polygon
  conveyor, completed route flow, idle alarm, or existing person glow where
  applicable. Reduced motion, layer disable, no eligible feature or data,
  style/page disposal, and teardown must leave no frame attributable to
  polygon motion and no orphaned RAF. Confirm that no duplicate source or
  duplicate layer is created.

## Zikim / sea crop UV record (Task 12)

Measurement gate before any crop number edit. Do not change `PROJECTION_SPAN`,
Tesuga constants, or `model-bounds` until this table has **recorded** UV (never
guessed). Live map `project()` UV cannot be faked in Node.

Catalog from spec: Zikim ITM `(154669.92, 613156.77)`, WGS84 `(34.5218, 31.6090)`.
West point is 2.5 km west of Zikim.

How to fill: from `otef-interactive`, run
`node --experimental-detect-module scripts/measure-zikim-span-uv.mjs` (prints
catalog points and committed `getProjectionSpanRect` windows). Then open
`projection.html?span=right` and `projection.html?span=left` in the lab, wait
until the Tesuga span camera is idle, and project Zikim and the west point with
the projection page's `window._maplibreMap.project()`. Divide its pixels by the
map container size to record span-viewport UV. Pass that UV with matching
`--span right|left` plus
`--uv-zikim` / `--uv-west`; the script computes T3 UV with
`spanViewportUvToT3Uv(uv, getProjectionSpanRect(spanId))` before comparing it
to both span rects via `uvInsideSpanRect`. Record both viewport and T3 UV.
Attach screenshot/notes paths. Compare the older full-span TouchDesigner file
as control (does that file still show the coast?).

Lab filled these cells on 2026-09-06 from live TD webrender `projection.html?span=right` / `span=left` (1920×1080), classified with `node --experimental-detect-module scripts/measure-zikim-span-uv.mjs`. Digits are the recorded values; do not invent extra precision.

| Span | Zikim viewport / T3 UV (u, v) | 2.5 km west viewport / T3 UV (u, v) | Zikim vs `getProjectionSpanRect("right")` | Zikim vs `getProjectionSpanRect("left")` | West vs `getProjectionSpanRect("right")` | West vs `getProjectionSpanRect("left")` | Screenshot / notes path | Older full-span TD control |
|---|---|---|---|---|---|---|---|---|
| `right` | viewport `0.665981, 0.036238` → T3 `0.7829905, 0.292619` | viewport `0.625837, -0.047967` → T3 outside live viewport | inside | outside | outside | outside | `docs/nli-exhibit-screenshots/span-right-webrender.png`, `projected-right-null6.png` | Older full-span `old_view` still shows a large sea slab (`old-view-full-null1.png`, `old-view-crop1.png`, `old-view-crop2.png`). Split right shows a thin coastal strip. |
| `left` | viewport `1.465981, 0.036238` → T3 outside live viewport | viewport `1.425837, -0.047967` → T3 outside live viewport | outside | outside | outside | outside | `docs/nli-exhibit-screenshots/span-left-webrender.png`, `projected-left-null2.png` | Zikim and west are outside the live left viewport (not in either span rect). |

- Operator: lab 2026-09-06
- Date: 2026-09-06
- TD file: `C:/Users/owner/Documents/NUR TouchDesigner Tkumap_split_projection_copy.toe`
- Notes: Screenshots live under `otef-interactive/docs/nli-exhibit-screenshots/` (local; paths recorded even if the PNGs stay untracked). Skip key is Zikim UV vs the right rect, not the west sea point.

**Task 13 skip:** Zikim UV in-rect; remaining table black is TD exhibit blocker.

Zikim T3 `0.7829905, 0.292619` is inside `getProjectionSpanRect("right")` and outside left. Do **not** edit `PROJECTION_SPAN`, Tesuga, or `model-bounds` for this miss of the 2.5 km west sea point. Zikim base/sea and name-edge tradeoffs are deferred, not a Tesuga edit.

**Deferred:** `POST_TY` / `POST_SCALE` (and any later projection-crop pass over Tesuga / AABB / `PROJECTION_SPAN`) are out of scope until a later projection board. This record does not authorize those edits.

## Recorded exhibit gates (Task 14)

Spec exhibit gates that unit tests cannot replace. Every cell below is a
recorded result. Empty checkboxes are not a record. A fail that is an
exhibit/TD blocker is labeled **blocker**, not a silent pass.

Slideshow is the idle complete-story look (same as Stop/`idle`), not a separate
visual.

| Gate | Date | Operator | Surface | pass/fail/blocker | notes/screenshot path |
|---|---|---|---|---|---|
| Archive open/close on **kiosk Chrome** with the popup allowlist (`configure-chrome-popup-policy.ps1`) | 2026-09-06 | exhibit owner | kiosk Chrome (GIS + remote) | pending | Must record: remote never shows closed while `otef-nli-archive` is still open; close honesty matches Task 11; kiosk Chrome with popup allowlist (`configure-chrome-popup-policy.ps1`). Owner will record on kiosk Chrome + table; do not invent pass/fail. |
| Densest `people_names` clusters on GIS **and** projection | 2026-09-06 | exhibit owner | GIS and projection | pending | Must record: one integer heading (default 41, snap 1°, `text-rotation-alignment: map`), size 8 readable on GIS **and** projection; dense clusters readable. See **2026-09-07 lab follow-up exhibit gates** One heading. Owner will record on kiosk Chrome + table; do not invent pass/fail. |
| Category motion at **table distance** | 2026-09-06 | exhibit owner | table (GIS and projection) | pending | Must record: three `Notes` colors; battle/kidnap/fire motion slow enough; GIS and projection match. Owner will record at table distance; do not invent pass/fail. |
| Crop (copy from Task 12/13) | 2026-09-06 | lab | projection `span=right` / `span=left` webrender + TD table | blocker | Zikim UV in-rect skip; Tesuga not edited. Zikim T3 `0.7829905, 0.292619` inside `getProjectionSpanRect("right")`, outside left. Remaining table black / coast-base deferred as TD/projection blocker, not a silent pass. UV table and screenshots in **Zikim / sea crop UV record (Task 12)** (`docs/nli-exhibit-screenshots/span-right-webrender.png`, `span-left-webrender.png`, `projected-right-null6.png`, `projected-left-null2.png`). |

## 2026-09-07 lab follow-up exhibit gates

Owner lab lock 2026-09-07 afternoon. Record date, operator, surface,
pass/fail/blocker, and notes. Empty cells are not a record. Do not invent
pass/fail.

Afternoon lock supersedes a separate overlay legend, viewport-only heading, and
leftover pack re-prep. Pack re-prep of `ציר_232` / `people_names` is blocking
and must already have run. GIS mute and two-GIS archive remain pending operator
rows. Crop Tesuga remains deferred; prior UV / TD blocker still stands.

| Gate | Date | Operator | Surface | pass/fail/blocker | notes |
|---|---|---|---|---|---|
| Clock left park | 2026-09-08 | lab | GIS + projection | pending | Must record: `NLI_EXPLAINER_LAYOUT.left` is `46.90416666666667, 22.113809679110926, 8.886423224258024, 8.323215088627478, 56, 91.18739188335852`. Full/right unchanged. Keys `.v2`. Transparent caption, `fontPx`, GIS rotate. |
| Legend in `#mapLegend` both surfaces | 2026-09-07 afternoon | lab | GIS + projection | pending | Must record: three rows קרב / חטיפה / שריפה in existing `#mapLegend` on GIS **and** projection. No `#nliInvestigationLegend` overlay. Hidden when polygons row off. Remote sheet still one glossary row. |
| 232 brown on LIVE processed | 2026-09-07 afternoon | lab | GIS + table | pending | Must record: live `public/processed/layers/nli/styles.json` stroke `#873e23` (or rgb 135,62,35), opacity 1, width ~2.667px. Re-prep ran; not residual. |
| Highlight no bounce after search | 2026-09-07 afternoon | lab | GIS fly + projection highlight | pending | Must record: person search flyTo does not bounce the table highlight. Keep-geometry + 400 ms fade across zoom 13. No highlight-geometry lerp. |
| One heading | 2026-09-08 | lab | GIS people_names + projection people_names and שמות | pending | Must record: one integer heading, default 41 (`שמות_label_overrides` v2), snap 1°, `text-rotation-alignment: map`. Per-feature offsets stay. GIS שמות stay muted. |
| GIS settlements | 2026-09-07 | lab | GIS (outlines); projection (names/leaders) | pending | Must record: outlines on GIS; `שמות_יישובים` + leaders off GIS; projection names/leaders still on. Owner will record on kiosk Chrome + table; do not invent pass/fail. |
| Archive two GIS | 2026-09-07 | lab | two same-origin GIS + remote | pending | Must record: two same-origin GIS documents: close fans out; remote does not stick on `unavailable` while a named window remains. Note localhost vs 127.0.0.1 as a remaining origin split. Owner will record; do not invent pass/fail. |
| Crop | 2026-09-07 | lab | projection / TD | blocker | No Tesuga edits this pass; prior UV / TD blocker still stands. Crop Tesuga still deferred. Copy: Zikim UV in-rect skip; remaining table black is TD exhibit blocker. See **Zikim / sea crop UV record (Task 12)**. |
