# NLI exhibit verification

After moving the PC or changing projectors, complete the [video playback commissioning check](nli-video-playback-commissioning.md), including all six videos on the actual fullscreen displays. Laboratory playback results do not replace this check.

## Local Reveal presentation setup and acceptance

From an elevated PowerShell session on the GIS exhibit machine, install the
local Chrome policies:

```powershell
cd C:\Users\owner\Desktop\city-scope\nur-cityscope\otef-interactive
.\scripts\configure-chrome-popup-policy.ps1 -Mode Install
.\scripts\configure-chrome-popup-policy.ps1 -Mode Status
```

Quit every Chrome process, then relaunch GIS from its normal shortcut so the
autoplay allowlist is loaded. Check that the status output shows
`http://localhost:80` under both the popup allowlist and autoplay allowlist.
Use the staff remote for all slide navigation. Confirm all six segments open
at their first slide and Previous/Next stop at the segment boundaries:
Segev 1–8, Mor Levy 9–11, Nova memorial 12–16, Sderot 17–21, Shura 22–28,
and Hostages 29–34.

Check audible autoplay with the remote on video slides 2, 10, 18, 21, 23, and 24.
Confirm audio stops and rewinds when leaving each video slide or closing the
presentation. Confirm Shura opens after its cue. Confirm Close on Shura and
Hostages (like every segment) stays on the current step and offers Open again;
Scene Next on the Hostages presentation step continues to Nir Oz people.
Scene Back, Scene Next, and Home must close the overlay before changing step. Confirm that
slides stay on GIS and do not appear on projection. Opening and closing must
leave GIS mounted in place without reloading the map or switching applications.

Repeat the checks with external network access disconnected. Record each
hardware/browser result below; automated tests do not count as exhibit checks.

| Check | Date | Operator | Browser / display | pass/fail | Notes |
|---|---|---|---|---|---|
| Six segment starts and boundary clamping |  |  |  | pending |  |
| Slides remain on GIS, not projection |  |  |  | pending |  |
| Open/close causes no GIS reload or application switch |  |  |  | pending |  |
| Slides 2, 10, 18, 21, 23, 24 autoplay audibly |  |  |  | pending |  |
| Leaving a video slide or closing stops and rewinds audio |  |  |  | pending |  |
| Shura and Hostages Close stays on step and offers Open again |  |  |  | pending |  |
| Scene Back/Next and Home close the overlay before changing step |  |  |  | pending |  |
| External network disconnected; fresh Chrome launch |  |  |  | pending |  |

After the exhibit and when the source terms require removal, delete
`otef-interactive/public/local/presentations/nli/` and the retained downloaded
source files `C:\Users\owner\Downloads\מצגת מודל נור (1).pdf` and
`C:\Users\owner\Downloads\מצגת מודל נור (3).pptx`.

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

- [ ] Confirm `http://localhost/` redirects (`302`) to
  `/otef-interactive/launcher.html`, and that these return `200`:
  `http://localhost/otef-interactive/` (GIS),
  `http://localhost/otef-interactive/projection.html`,
  `http://localhost/otef-interactive/projection-config.html`,
  `http://localhost/otef-interactive/remote-controller.html`,
  `http://localhost/otef-interactive/nli-staff-remote.html`,
  `http://localhost/otef-interactive/nli-staff.webmanifest`, and
  `http://localhost/otef-interactive/qr.html` (printable QR).
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
  **End**, and timeline-off/full-timeline/slideshow **idle** animates every
  visible route as completed. GIS Stop stays in its scene window. Confirm
  reduced-motion mode uses static directional dashes.
- [ ] Confirm a polygon-only beat activates at its authored beat, while a
  polygon sharing a route beat waits until that route reveal completes. Confirm
  route geometry alone never activates an investigation polygon.
- [ ] Confirm settlement outlines activate through both paths: a revealing
  route reaches or crosses the boundary, and an associated investigation
  polygon turns red.
- [ ] In remote **Navigation**, select a person and confirm the GIS animates
  to zoom `16` over `1600 ms`, shows one name/location bubble, dims the other
  people points on GIS and projection (no halo overlay), and keeps the
  suggestions closed after acknowledgement.
- [ ] In the Hebrew remote, confirm the archive action reads
  `פתיחת ארכיון הספרייה`.
- [ ] In projection, confirm the NLI timeline caption shows only the readable
  `HH:MM` story clock. Confirm the remote **Presentation** tab, slideshow, and
  `presentationActive` behavior remain unchanged.
- [ ] Confirm Home and Timeline share the GIS `start` clock; identity search,
  names wall, blank, and unrelated views have no idle clock. Confirm narrative
  playback and presentation suppression/restore remain unchanged.
- [ ] Confirm the projection clock uses the saved left slot for each scene and
  appears only at `span=left`. Confirm the runtime does not write clock or
  legend placement settings.
- [ ] Confirm the GIS Clock and Projection Clock / Legend nodes retain local
  drafts through preview scene changes and show Saved only after matching
  server acknowledgement. Use **Show on exhibit** as the explicit scene action.

## NLI clock relevance matrix (Task 6)

Run every applicable row on both GIS and projection. Record the observed
visibility and story clock; the expected result is the same unless a row is
marked GIS-only.

| Case | GIS | Projection | Expected result |
|---|---|---|---|
| No relevant layer/no narrative | [ ] | [ ] | Clock absent. |
| Exact Home cue layer set | [ ] | [ ] | Idle `06:29`; Home IDs plus any unrelated enabled layer are not Home. |
| Timeline cue | [ ] | N/A | Shares the GIS `start` slot and idle clock. |
| Victims names / `nli.people_names` alone | [ ] | [ ] | Clock absent. |
| Another unrelated NLI layer only | [ ] | [ ] | Clock absent. |
| Segev or Nova with relevant chips off | [ ] | [ ] | Clock remains visible: Segev idle/Stop is `06:41`; Nova idle/Stop is `08:03`, while Play starts beat 1 at zero reveal without an `08:03` lead-in. |
| Projection slideshow warmup/crossfade (projection only) | N/A | [ ] | Warmup/staging do not change relevance; visibility changes only at reveal. Right span is blank. |
| Preview, switch scene, close preview | [ ] | [ ] | No exhibit scene, playback, viewport, or layout write occurs. |

For slideshow rows, verify that projection consumes the committed revealed pack.
Clock and legend changes are made in their config nodes and persist through
acknowledged Django writes and revision checks.

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
- [ ] Confirm the GIS shows one name/location bubble and both GIS and
  projection dim the other people points.
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
The old Canva iframe has been removed. Slide playback on the Reveal.js viewer
is checked in **Local Reveal presentation setup and acceptance** above.
Leave every row unchecked until it has been observed by the exhibit operator.

- [ ] From the basemap control in the remote **Layers** tab, manually select
  **Satellite Color** and **Satellite B&W** and confirm the intended basemap
  appears on the GIS.
- [ ] Start the Segev narrative from the staff remote and confirm entry targets the exact house at
  zoom `18`; confirm no zoom-`19` request or visible zoom-`19` stop occurs.
- [ ] Confirm the narrative does not open a Mila victim popup, select a victim,
  or create NLI archive state.
- [ ] Confirm the Hebrew `משפחת שגב` focus label is legible on both GIS and
  projection.
- [ ] Confirm Be'eri is bright while other settlement outlines remain dim.
- [ ] Confirm Be'eri glows on projection while Segev is active (no house viewport quad).
- [ ] Staff/exhibit: the traveling GIS viewport quad is not shown on projection.
- [ ] Regular remote: the projection viewport quad is still shown (zoom-13 fade).
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
- Segev Be'eri glow on projection (no house viewport quad): pass / fail
- Staff/exhibit: no projection viewport quad: pass / fail
- Regular remote: projection viewport quad still shown: pass / fail
- Segev house-locked timeline Play/Pause/Stop/Loop/step/scrub at zoom 18: pass / fail
- Segev exit returns to dark bounds center zoom 10: pass / fail
- Segev refresh/reconnect convergence: pass / fail
- Notes:

## Nova, Sderot, and Hostages narrative matrix

Run from the staff remote in kiosk Chrome with the physical projection. The
expected behavior is in the [staff remote guide](nli-staff-remote-steps.md).
Every row is pending until the exhibit operator observes it.

| Check | Date | Operator | pass/fail | Notes |
|---|---|---|---|---|
| Nova entry fits the reviewed extent and shows 08:03 before Play |  |  | pending |  |
| Nova compounds play five four-second beats; Stop returns to 08:03 |  |  | pending |  |
| Nova escape routes, Mor Levy route and slides, and memorial slides |  |  | pending |  |
| Sderot entry focuses the police station; slides stay on GIS |  |  | pending |  |
| Hostages: Nir Oz and Peri home, slides, Nir Oz people, all hostages |  |  | pending |  |

## Later exhibit acceptance

These checks complete acceptance after the integration and window checks:

- Run the full timeline interaction matrix on GIS and projection together.
- Review route direction, red carrier and dash contrast, settlement outlines,
  alarm scaling/ripple, bubble legibility, people dimming, clock placement,
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

Crop and transform are now adjusted live in `projection-config.html` (see [browser projector operation](browser-projector-warp-operations.md)), not by editing constants. This record does not authorize edits to `PROJECTION_SPAN`, Tesuga, or `model-bounds`. Physical fit on the model remains pending.

## Staff remote scene sequence (2026-09-27)

The live nginx/browser pass was not performed. Remote, GIS, and projection were not opened together. The roughly 800×1280 and 1280×800 Hebrew/English viewport inspection was not performed. Physical Galaxy Tab 11 touch and mis-tap acceptance was not performed. Normal-motion, reduced-motion, and cold-asset transitions were not observed on a display. Those gates stay open. The hardware rows already in this document stay pending and are unchanged.

Automated checks from the worktree, 2026-09-27:

| Command | Result |
|---|---|
| `npx vitest run tests/remote/nli-staff-scene-integration.test.js` | 6 passed |
| `npx vitest run tests/remote tests/shared tests/map tests/projection tests/contracts` | 213 files passed, 8 failed; 2400 tests passed, 5 failed, 1 skipped; 1 unhandled rejection |
| `python -m pytest backend/tests/test_otef_escape_overlay_api.py backend/tests/test_otef_narrative_api.py backend/tests/test_otef_investigation_clock_api.py -q` | 51 passed, 5 failed, 1 skipped, 21 subtests passed |
| `npm run build:frontend` | passed |
| `git diff --check` | passed (existing git attribute warnings only) |

The five Django failures are environment failures, not a pass. Four presentation tests miss `nli-presentation-manifest.json` and then Python 3.14 crashes while logging that error. `test_exit_leaves_playing_clock_unchanged` cannot reach Redis at `redis:6379`. The remaining frontend failures are missing processed style or GeoJSON files, a missing memorial-wall snapshot, a Nova index CLI timeout, a legend dash assertion, and an unhandled `Failed to update state: 500` from the data-context actions file. Those files were not edited for this sequence check. The Nova compounds five-beat contract is not outstanding: commit `779ee4d` restored the compounds note, and `tests/contracts/nli-nova-narrative-contract.test.js` passed.

## Staff remote repair verification — 2026-09-27 follow-up

This follow-up supersedes the earlier staff-sequence paragraph saying that no live browser pass was performed. The owner authorized tests against the running PC. Codex exercised the nginx staff remote, GIS and projection follower without restarting services or changing TouchDesigner/projection configuration.

- Home → first minutes → complete timeline → Home worked. Pending transport buttons disabled and became available after the scene command completed.
- Segev's combined scene opened its presentation on GIS; Home removed it. Nova was left during its second playback beat, and GIS reached the terminal state before the routes scene. Routes and Mor exposed only their own controls. Memorial opened its presentation automatically; the projection follower rendered the memorial scene without console errors. Home cleared the presentation.
- Live GIS revealed an invalid no-match house-outline filter that the old mocked test missed. The corrected filter passes the installed MapLibre compiler and the repeated Home/timeline journey produced no new GIS filter errors.
- Home was measured in Hebrew and English at simulated CSS sizes 480×800, 600×900, 800×1280, 960×540 and 1280×800. All ten cases had complete labels, equal narrative/victim card widths, a 3:1 lead row, and no horizontal overflow. Short-landscape presentation content scrolls; an actual scroll and pointer Close succeeded with the scene dock remaining visible.
- Home Layers preserved a manual layer choice through close/reopen, and the test choice was restored. The control is absent on scene pages. A browser fullscreen enter/exit gesture cycle updated its accessible state.

Final combined frontend run: `npx vitest run tests/remote tests/shared tests/map tests/projection tests/contracts` — **2593 passed, 1 failed**, across 225 passing files and one failing file. The sole failure is the unchanged baseline `tests/map/legend-content.test.js:181` dash expectation (`[6,6]` versus `[9,12]`), also present before this repair. No new failure appeared. The focused remote/contracts run passed all 420 tests. `npm run build:frontend` and `git diff --check` passed; the existing MapLibre chunk-size warning remains. Built manifest, start URL, scope and unchanged 100×100 icon were resolved against the emitted files, rather than relying only on the build exit code. No backend code changed in this repair, so backend tests were not rerun.

After that combined run, a small fullscreen-error translation fix passed all 31 focused fullscreen/locale tests, including its new regression. The frontend build and whitespace check were rerun successfully afterward.

Evidence: `../../docs/reviews/2026-09-27-nli-review/layout-metrics.json`, `home-after-*.png`, `presentation-slides-*.png`, `live-segev-presentation.png`, `live-nova-memorial-projection.png`, and before/after GIS error records in that directory. Detailed task reports and the final test log were kept locally and are not in the repository.

The device is a **Galaxy Tab A11**; these browser dimensions are simulations, not measurements of its Chrome viewport. Physical tablet touch/install acceptance, physical TD output, reduced-motion display observation and frame-by-frame cold-load WebGL capture remain unverified. Unit tests cover delayed renderer assets and reduced-motion lifecycle behavior; sampled browser frames cannot prove that no single-frame flash ever occurs. The current HTTP tablet URL does not establish promoted PWA installation: HTTPS and suitable larger original icons may still be needed. No offline service worker or certificate/deployment change was added.

## Recorded exhibit gates (Task 14)

Spec exhibit gates that unit tests cannot replace. Every cell below is a
recorded result. Empty checkboxes are not a record. A fail that is an
exhibit/TD blocker is labeled **blocker**, not a silent pass.

Slideshow uses the idle complete-story presentation, like the full-timeline
cue. GIS Stop on opening-minutes or rest-of-day rewinds that scene instead.

| Gate | Date | Operator | Surface | pass/fail/blocker | notes/screenshot path |
|---|---|---|---|---|---|
| Archive open/close on **kiosk Chrome** with the popup allowlist (`configure-chrome-popup-policy.ps1`) | 2026-09-06 | exhibit owner | kiosk Chrome (GIS + remote) | pending | Must record: remote never shows closed while `otef-nli-archive` is still open; close honesty matches Task 11; kiosk Chrome with popup allowlist (`configure-chrome-popup-policy.ps1`). Owner will record on kiosk Chrome + table; do not invent pass/fail. |
| Archive paging on **kiosk Chrome** (dedicated GIS profile + pager) | 2026-10-01 | exhibit owner | kiosk Chrome (GIS + staff remote) | pending | Nir Oz + search kit (Identity database). Open, then Scroll down/up must move the live NLI column on the wall; Back to map closes. GIS must not pan. Closed archive POST must not move GIS. If the live NLI column does not move with the locked pager algorithm, stop — do not add cookie-banner clicking. Owner will record on kiosk Chrome; do not invent pass/fail. |
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
| Clock left park | 2026-09-08 | lab | GIS + projection | pending | Must record: the committed default `NLI_EXPLAINER_LAYOUT.left` in `frontend/src/shared/map-projection-config.js` is `leftPct 22.100834647739227, topPct 31.61002744422372, widthPct 8.886423224258024, heightPct 8.323215088627478, fontPx 56, rotateDeg 91.18739188335852`; a saved Projection Clock node value overrides it. Full/right unchanged. Keys `.v2`. Transparent caption, `fontPx`, GIS rotate. |
| Legend in `#mapLegend` both surfaces | 2026-09-07 afternoon | lab | GIS + projection | pending | Must record: the shared bilingual NLI legend in the existing `#mapLegend` on GIS **and** projection, with no pack heading (see [legend verification](legend-verification.md)). GIS retains its existing paging. Projection must show the complete legend on one page, fitting its saved panel with equal-width columns and shrink-to-fit; Auto evaluates one to three columns and prefers fewer on ties. Verify requested labels, symbols, no clipping, right-span hidden behavior, and unchanged GIS pagination. The investigation polygon categories appear only while that layer is on. No `#nliInvestigationLegend` overlay. This updated projection layout still needs normal-browser and exhibit-display review. |
| 232 brown on LIVE processed | 2026-09-07 afternoon | lab | GIS + table | pending | Must record: live `public/processed/layers/nli/styles.json` stroke `#873e23` (or rgb 135,62,35), opacity 1, width ~2.667px. Re-prep ran; not residual. |
| Highlight no bounce after search | 2026-09-07 afternoon | lab | GIS fly + projection highlight | pending | Must record: person search flyTo does not bounce the table highlight. Keep-geometry + 400 ms fade across zoom 13. No highlight-geometry lerp. |
| One heading | 2026-09-08 | lab | GIS people_names + projection people_names and שמות | pending | Must record: one integer heading, default 41 (`שמות_label_overrides` v2), snap 1°, `text-rotation-alignment: map`. Per-feature offsets stay. GIS שמות stay muted. |
| GIS settlements | 2026-09-07 | lab | GIS (outlines); projection (names/leaders) | pending | Must record: outlines on GIS; `שמות_יישובים` + leaders off GIS; projection names/leaders still on. Owner will record on kiosk Chrome + table; do not invent pass/fail. |
| Archive two GIS | 2026-09-07 | lab | two same-origin GIS + remote | pending | Must record: two same-origin GIS documents: close fans out; remote does not stick on `unavailable` while a named window remains. Note localhost vs 127.0.0.1 as a remaining origin split. Owner will record; do not invent pass/fail. |
| Crop | 2026-09-07 | lab | projection / TD | blocker | No Tesuga edits this pass; prior UV / TD blocker still stands. Crop Tesuga still deferred. Copy: Zikim UV in-rect skip; remaining table black is TD exhibit blocker. See **Zikim / sea crop UV record (Task 12)**. |
