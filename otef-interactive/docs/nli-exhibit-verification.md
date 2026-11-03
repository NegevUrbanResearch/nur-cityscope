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
Use the staff remote for all slide navigation. Confirm all seven slide segments open
at their first slide and Previous/Next stop at the segment boundaries:
Segev 1–8, Mor Levy 9–11, Nova memorial 12–16, Sderot 17–21, Shura 22–28,
Hostages 29–33, and Credits 34.

Check audible autoplay with the remote on video slides 2, 10, 18, 21, 23, and 24.
Confirm audio stops and rewinds when leaving each video slide or closing the
presentation. Confirm Shura and the Hostages presentation step open after their cues. Confirm Close on Shura and
Hostages (like every segment) stays on the current step and offers Open again;
Scene Next on the Hostages presentation step continues to Nir Oz people.
Scene Back, Scene Next, and Home stage Close under the cue hold and dispatch the destination cue before visible-close acknowledgement. Outgoing GIS pixels remain mounted until their scene fade reaches zero. Confirm that
slides stay on GIS and do not appear on projection. Opening and closing must
leave GIS mounted in place without reloading the map or switching applications.

Repeat the checks with external network access disconnected. Record each
hardware/browser result below; automated tests do not count as exhibit checks.

| Check | Date | Operator | Browser / display | pass/fail | Notes |
|---|---|---|---|---|---|
| Seven slide segment starts and boundary clamping |  |  |  | pending |  |
| Names Wall → Credits keeps the names visible on projection and automatically opens slide 34 on GIS only |  |  |  | pending |  |
| Credits has no slide controls; Next/Back switches the GIS image without closing or resetting the scene |  |  |  | pending |  |
| Credits Finish and Home close the GIS image and restore Home layers |  |  |  | pending |  |
| Slides remain on GIS, not projection |  |  |  | pending |  |
| Open/close causes no GIS reload or application switch |  |  |  | pending |  |
| Slides 2, 10, 18, 21, 23, 24 autoplay audibly |  |  |  | pending |  |
| Leaving a video slide or closing stops and rewinds audio |  |  |  | pending |  |
| Shura and Hostages Close stays on step and offers Open again |  |  |  | pending |  |
| Hostages presentation opens automatically after its scene is ready |  |  |  | pending |  |
| Nova Memorial route control starts stopped; Start replays routes and Stop restores settled intersections |  |  |  | pending |  |
| Scene Back/Next and Home coordinate destination changes with overlay exit and visible-close acknowledgement |  |  |  | pending |  |
| External network disconnected; fresh Chrome launch |  |  |  | pending |  |

After the exhibit and when the source terms require removal, delete
`otef-interactive/public/local/presentations/nli/` and the retained downloaded
source files `C:\Users\owner\Downloads\מצגת מודל נור (3).pdf` and
`C:\Users\owner\Downloads\מצגת מודל נור (5).pptx`.

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
| Nova compounds play five eight-second beats; Stop returns to 08:03 |  |  | pending |  |
| Nova escape routes, Mor Levy route and slides, and memorial slides |  |  | pending |  |
| Sderot entry focuses the police station; slides stay on GIS |  |  | pending |  |
| Hostages: Nir Oz and Peri home, slides, Nir Oz people, all hostages |  |  | pending |  |

## Nova polygon explainer cards

Pending until an operator records these on the exhibit GIS with the real
dataset. Leave every row pending until that check is actually performed.
jsdom cannot prove card readability on the wall.

| Check | Date | Operator | Result | Notes |
|---|---|---|---|---|
| Playback of five beats; names wrap; the fourth beat widens; all 14 names are visible at the end |  |  | pending |  |
| Pause, seek backwards, and Stop |  |  | pending |  |
| Leave and re-enter Nova and Mor while paused and while ended |  |  | pending |  |
| Authored Close and Wide layouts stay clear of the clock, people plaque, and map controls; manual zoom does not switch the layout |  |  | pending |  |
| Editor moves and resets Close and Wide independently; keyboard X/Y; GIS reload; conflict Retry and Load saved |  |  | pending |  |
| Ordinary GIS clock preview and projection preview still work; projection has no explainer host |  |  | pending |  |
| Closing and reopening the editor does not duplicate hosts or listeners |  |  | pending |  |

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


## Coordinated scene transition laboratory evidence — 2026-10-08

**Historical observations; acceptance reopened after the local `dev` merge.** The owner reported broken route replay, presentation controls, basemap transitions, settlement-label timing, and unwanted intermediate scenes after merge `b2ff1ec2`. The earlier cue-level drivers and private state setters did not cover the public staff-control and clock-wrapper paths, completed route replay, manual basemap ownership, or selected-person cleanup. The table below records those earlier observations and does not establish acceptance of the merged application.

At source commit `4b70bb9e5727ec922eb13c58aa8387b1b8478db8`, the full frontend run passed 5,181 tests across 369 passing suites, with one existing current-data test/suite skipped. The production frontend build and whitespace check passed. The backend contract run passed 64 tests with one skip against an isolated in-memory database and channels layer; it did not use the live database or Redis.

Deterministic staff-to-follower integration exercises the complete show, nested narratives, Back, Home, hold expiry, cancellation, preparation failure/retry, and reduced motion through the real scene binding, lifecycle, names controller, narrative filters, and GIS viewer. Catalog geometry and decoded media are controlled fixtures in these tests. Focused regressions reproduce and verify the ownership, readiness, transport, and rendering fixes described below.

Browser observations used installed headless Chrome at 1440×1000 with its default GPU backend, the actual mounted application modules and staff cue runner, and accepted read-only assets served by isolated nginx. A clean Home snapshot, private local state setters, fake WebSocket, and local fulfillment of API writes kept shared exhibit state unchanged. These observations establish laboratory behavior, not physical exhibit acceptance.

| Observed laboratory gate | Source provenance | Result |
|---|---|---|
| Complete SHOW: all 17 entries and nested narrative branches forward, backward, then Home | GIS at `4b70bb9e`; legacy projection and browser left/right at `8e88af92` | Passed 35 requests per surface; GIS recorded 4,557 frames and projection 3,101 / 3,114 / 3,117 frames. |
| Native GIS staged presentations, including Shura, Mor, names wall, credits, and Close | `4b70bb9e` | Passed: 12 correlated `ready`, 12 `opened`, and 7 `closed` results; no `unavailable` or `ignored` result. |
| Identity → Home, Home ↔ Wall, and reduced motion | GIS at `4b70bb9e`; projection at `8e88af92` | Passed; names rendered on projection and map content returned after exit. Reduced-motion writes had no fractional scene factors. |
| Delayed/failed required resource and shared-group timeout restoration | GIS at `4b70bb9e`; projection at `8e88af92` | Passed; incoming content stayed at zero, distinct failures retained Home, and shared replacement restored captured Home content and readiness. |
| Retained Mor route after a failed incoming scene | All four surfaces at `8e88af92` | Passed; the same route source remained at factor 1 and actual `setData` head coordinates advanced. This injected a distinct registry-source readiness timeout after Mor apply, not a refresh/mount throw. |
| First Home → Segev, shared Satellite Color ↔ B&W, inverse Home, and 200 ms preparation reversal | GIS at `4b70bb9e` | Passed with physical `esri` source / `esri-tiles` layer, drawable tiles, evaluated opacity 1, correct saturation, and preserved shared source/tile-cache identity. Saturation changed only at scene factor zero; inverse/reversal removed the satellite resource at zero and settled on Home. |
| Reduced-motion rendered paint after Wall → Home | Legacy projection at `8e88af92` | Passed; evaluated opacity remained 1 and sampled Sea pixels stayed RGBA `(98,108,112,255)` immediately and at the nominal 500 ms / 1,200 ms captures. The earlier independent MapLibre opacity tween is absent. |

The final GIS runs recorded identical start/end commit and 12 source hashes, including `frontend/src/map/gis-basemap-transition.js` SHA-256 `239be40b6f562c5dac6259ce9dd540a84d851f0f3b67006da84df2ec41286fdc`. Projection and all-four Mor observations retain their actual `8e88af92a608603eba0e11c2b64be272effe4f02` provenance: the subsequent commit changed only the GIS basemap controller, so those unchanged paths were reused rather than relabeled as new runs. Selected logs, source hashes, screenshots, video, and ownership audits are retained in local ignored verification artifacts; they are not repository documentation links.

The waiter checked virtual Nova polygons, Mor, escape, focus, caption, presentation, and basemap members as well as catalog layers. Mor required actual route line/head geometry and both physical layers at factor 1. GIS required the physical satellite layer and evaluated raster opacity, preventing a restored old scene or lifecycle readiness alone from counting as the requested scene. The previously white first-Segev background is corrected: 25 sampled terrain pixels changed from uniform white (mean 255) to textured grayscale imagery (mean 84.24, range 5–214); pixel `(50,50)` changed from RGB `(255,255,255)` to `(107,107,107)`.

Paint-observer ownership, live layout visibility, paint/evaluated paint, desired membership, and clock phase were recorded at layer removal. The final GIS SHOW recorded 922 mapped paint-owned removals; the projection SHOW runs recorded 642 / 640 / 640. No mapped non-idle scene removal had a positive recorded owner factor. Each surface also recorded 46 positive last-factor removals caused by explicit idle/Stop semantic controls: 28 line clears and 18 polygon clears. Those controls remain allowed and are distinct from scene-departure cleanup. Some auxiliary name-field/registry source cleanup has no directly observed own factor, so this record makes no blanket zero-factor claim for every resource removal. Pre-removal evaluated paint can also retain the preceding render frame's value while the scene actor and authored paint are already zero.

The verified fixes cover replaced Home navigation ownership and pending-control recovery; current staged presentation ownership across raw narrative exits; stale lifecycle bindings and readiness renewal without recapturing scaled opacity; bounded scene reconstruction and compatible retained-scene Pause/Stop behavior; preservation of effective Nova overlays through exit; and registry readiness on render. Authored MapLibre opacity transitions now restore after style commit, avoiding a second tween after reduced-motion completion. Managed GIS basemap preparation protects current source/layer ownership across zero, validates the live insertion anchor and assignment identity, and acknowledges readiness only for the required physical resource. Framing JSON preserves the exact accepted manifest bytes; parsed calibration, manifest, and hashes are unchanged.

Diagnostics remain explicit. Final GIS SHOW recorded the existing missing captivity sprite warning and 15 late narrative-focus tile-manager diagnostics; final scenes remained ready, and the missing ESRI layer/style errors were absent. Fault runs recorded expected restoration warnings, and some isolated projection runs recorded disconnected fake-WebSocket warnings. No page exceptions were recorded. These results do not claim a clean console.

All verification browser contexts and owned browser processes are closed. Physical projector output, audible media autoplay, kiosk focus/popup placement and input, disconnected-network commissioning, and sustained performance on the exhibit hardware remain pending. Muted laboratory decoding, screenshots, and sampled frames do not certify those gates or rule out every possible single-frame flash. Historical hardware rows and crop blockers above remain unchanged. No merge, push, deployment, live service restart, or shared data change is part of this laboratory record.

## Transition regression revalidation — 2026-10-08

**Owner follow-up reopened visual acceptance for Identity → Wall and Dark → B&W.** The laboratory observations below precede that follow-up. The final two corrections finish the marker scene before activating the names field, install the GIS blackout at that zero boundary, and preserve an opaque dark underlay throughout the raster dissolve. They retain the existing Home-to-wall transition. Source digest `090d488ca32fdc9d924c3633bed059d3fa78c8a51d1b455a2cc3094577c12499` passes 5,276 frontend tests (one existing skip), the production build, and whitespace checks. These final two visuals await the owner's check; they are not marked visually accepted by the earlier browser results.

The correction separates membership, producer content, and playback intent. Unchanged participants retain their physical resources. Changed shared content exits before replacement, including a still-visible departing route during rapid Stop/Start. Settlement outlines, names, and leaders use the same orientation policy. Manual basemap completion hands its current physical resources back to the scene owner. Staff navigation acquires the public cue hold before clearing person or place focus; cue-less junctions preserve the existing scene. Mor establishes initial source readiness before advancing its existing reveal; impact geometry is published only when its drawn IDs or physical source change.

The final source review passed against frozen frontend digest `ccafc73359337bedcde9ddb925fdc9e19d941cff4b5f1b35dfc6cb67a5c66926`. The full frontend suite passed 5,274 tests with one existing skip; the production build and whitespace check passed. Backend contracts passed 69 tests with one skip in a disposable container with networking disabled, SQLite in memory, and in-memory channels.

Browser checks used actual staff and regular-remote controls, the public context methods, and installed headless Chrome. Fake WebSockets and local API responses isolated writes; responses followed commit, WebSocket delivery, then HTTP acknowledgement. Project code came from frozen source with recorded observation-only instrumentation. Completed replay, labels, and manual-basemap captures used freeze `13d014900af15eee06264a849bdf04ca1b1672fa2701807ed4bdcaebb55d65ed`. Selected cleanup and presentation controls used freeze `91774be26cd6441fc80b10604e62466f044d3162f6d48cd8646c2d2010ff6c97`. Their label, basemap, and remote-control modules remain unchanged. The final freeze adds the Mor readiness and impact-publication corrections, checked through fresh cold entries and the full show.

The preceding full-show check exposed a first-entry readiness failure that aggregate ready snapshots missed. On projection, Mor sent 371 geometry updates while every source event remained unloaded; impact geometry had 74 repeated updates. Fresh cold treatment shows Mor loaded after 42.3 ms, before its first animation update at 49.7 ms, and impact geometry had three actual updates. Both displays' actor batches complete successfully. The existing 1,200 ms readiness deadline is unchanged.

The observed regression checks are recorded below. They establish laboratory behavior through the public controls; the physical exhibit checks remain pending.

| Observed check | Result | Evidence limit |
|---|---|---|
| Projection fleeing routes: initial playback, completed replay, 200 ms Stop/Start, and scene reentry | Passed; the visible outgoing geometry stays fixed until zero, then the new run reveals from its start. | Overlap-sibling replay is additionally covered by real producer/binding integration tests; the staff remote has no overlap button. |
| Nova polygons across fleeing controls and return to compounds | Passed; polygon factors stay at 1 and their resources are retained. | Does not certify physical-projector gradient performance. |
| Projection settlement outlines, names, and connectors | Passed; 238 comparable browser frames have equal lifecycle factors, with canvas opacity following exit and entry. | Legacy leaders when present are covered by the producer-cohort integration tests. |
| GIS presentation controls, names wall, credits, and Home | Passed through automatic open, manual close/reopen, Previous/Next, wall/credits replacement, and Home exit. | Audible autoplay and kiosk focus remain hardware checks. |
| Selected person/place Identity → Wall | Passed with immediate and 200 ms delayed cleanup acknowledgement; outgoing focus remains visible through the hold, with no intermediate Home scene. | The destination overview camera applies under zero-opacity blackout. |
| Manual Dark/OSM/Satellite/B&W and subsequent scene/Home transitions | Passed at ten settled checkpoints; context, physical resources, displayed snapshot, and lifecycle agree. ESRI color/B&W retains its cache; Home removes departing rasters. | Deferred adoption during an overlapping semantic tween is covered by an integration test; that collision was not reproduced through actual controls. |
| Full show and nested branches with GIS and projection together | All 17 declared cue entries observed; all narrative choices, names wall, credits, and Finish exercised. Seven choice/return checks preserve the scene without an undeclared mutation. First and repeated Mor entries reach the required actor readiness on projection. | Repeated paths add 14 duplicate cue observations; choice junctions are not counted as extra cue entries. Physical exhibit acceptance remains pending. |

## Nova navigation corrections — 2026-10-08

Back from the Nova branch selected the general timeline step but armed its clock before leaving Nova. The transport consequently chose Nova's five beats and omitted the general timeline's start window. The cue now exits the narrative under its existing hold before arming playback. A staff-button regression checks both followers' original beats, 06:42 lead-in, playable membership, and cleared escape overlays.

Nova Memorial → Shura had a separate command-order failure. The API requires Shura's active narrative to be null, but the remote requested its presentation while Nova was still active. Earlier private browser fixtures bypassed that API validation and falsely accepted the Open command. Automatic presentation preparation now stages the destination narrative under the same cue hold, and the later cue avoids a duplicate null exit. The regression reproduces the API rejection before the correction and verifies one acknowledged exit before Shura Open.

The corrected private browser checks exercise the actual Back and Nova Memorial → Shura controls. The Shura fixture enforces the API's active-narrative rule: Open succeeds with no rejection, the GIS shows Shura's first slide, and projection receives the idle full-timeline scene with escape overlays cleared. Source digest `a95272155b95bf4b8b27f3278205dc0077f874a1d4fe35e097ea02c7267503c6` passes 5,277 frontend tests with one existing skip, the production build, and 69 isolated backend contracts with one skip. Physical exhibit acceptance remains with the owner.

## Gaza border-route release: offline Task 6 — 2026-10-08

The copied worktree baseline and a fresh audit-only candidate were checked against the frozen review preview. The baseline has 80 routes (68 confirmed and 12 unconfirmed). The candidate has 89 (68 confirmed and 21 unconfirmed): nine additions (`1013`–`1021`) and nine edits (`1001`, `1002`, `1005`, `1006`, `1008`, `1009`, `1010`, `1011`, `1012`). All 18 preview operations passed the 2 m comparison; the largest measured deviation was 0.006586 m. The confirmed-feature digest remains `c2d3ec3f50f0c016e6665b39ed93ed758020cf0c2a8339153cb1f51326039358`. After the final F1 correction, the eight origin-direction children contain only the border hit and exact original parent origin; the refreshed candidate runtime byte and feature digests are `b631e63fa6d3eaeb889a0efd88c6229f446ab7b2a3a75bf1c98da810b7b7a2c1` and `f31c9ae3b323454829a43f030b13c74751ff62f2fb414fafc5d9708aac5e86a5`. The earlier `2cfae6b47dd929c147b5795042a57d68e9f21f33ce43872dfbd66ea3d69d1447` / `97db91f303bba202d62833214de07c6626a569a7e7b3bf2e5ea9177335af1a20` candidate is superseded and must not be applied. The confirmed-feature digest remains unchanged.

The full presenter verifier remains strict. Both baseline and candidate produce the same 112 beat minutes, but both differ from the tracked navigation fixture by the missing minutes `572`, `636`, `724`, and `1197`; neither has extra minutes. The fresh bundle is `audit_only` and `publishable: false`. Standard `--prepare` and publication remain blocked until this readiness mismatch is resolved through an authorized fixture decision. Do not regenerate or weaken the fixture, mark this audit ready, or apply this bundle. Presenter records and source references, editorial evidence, accepted caption contracts, accepted source/package digests, and dataset version match the baseline. The refreshed bundle changes route-derived artifact evidence only.

The isolated frontend production build passed after confirming `frontend/dist` and the generated version file resolve inside the worktree and `dist` was not a link. The relevant 203 frontend tests passed at the exact current code in Task 5. The isolated Django integration run passed 29 tests using the worktree runner's in-memory database, channel layer, and cache. These are offline checks; they do not establish served-file hashes or exhibit acceptance.

### Future show-break release procedure

The following commands are templates for a later, explicitly authorized show break. Replace `$repoRoot`, `$python`, and `$preview` with the actual target checkout, its configured Python interpreter with the GIS dependencies, and a reviewed preview JSON that matches that target's original 80-route baseline. First make the reviewed code available in the target checkout. Prepare a new bundle there; a bundle prepared in this worktree is bound to this worktree and cannot be applied to another checkout. The current strict readiness blocker must be resolved before standard preparation can succeed.

Before preparation, verify the target's source/runtime hashes, recipe, canonical border, road input, presenter package, and preview identity. Close GIS, both projection outputs, presenter, and any GIS editing tools before application. Confirm all consumers will be reopened after the served files are verified. Do not proceed from an `audit_only` bundle.

```powershell
$repoRoot = 'C:\Users\owner\Desktop\city-scope\nur-cityscope'
$python = '<configured Python 3.11 executable with pyogrio and shapely>'
$preview = '<reviewed preview JSON for this exact target baseline>'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$bundle = Join-Path $repoRoot "artifacts\sdd\gaza-border-route-connections\show-break-$stamp"
$cli = Join-Path $repoRoot 'otef-interactive\scripts\curate_nli_border_routes.py'

& $python $cli --repo-root $repoRoot --prepare --staging-dir $bundle --preview-reference $preview
if ($LASTEXITCODE -ne 0) { throw 'Strict preparation failed; do not apply.' }
```

Inspect the prepared manifest, lock, route counts, 18-operation preview result, and strict presenter verification. Run the approved frontend and isolated Django checks for that target. Then close all outputs and apply the exact bundle:

```powershell
$journal = $null
$applyJson = & $python $cli --repo-root $repoRoot --apply --prepared-dir $bundle --outputs-closed
if ($LASTEXITCODE -ne 0) { throw 'Application failed; keep consumers closed and follow interrupted apply recovery below.' }
$applyResult = $applyJson | ConvertFrom-Json
if ($applyResult.status -ne 'published') { throw "Unexpected apply status: $($applyResult.status)" }
$journal = $applyResult.journal
```

Before any HTTP request or consumer reload, verify the installed release in the target tree. Both commands must succeed. A nonzero result means keep all consumers closed and recover using the journal instructions below:

```powershell
& $python $cli --repo-root $repoRoot --check --preview-reference $preview
if ($LASTEXITCODE -ne 0) { throw 'Installed curation validation failed; keep consumers closed and recover.' }
& node (Join-Path $repoRoot 'otef-interactive/scripts/verify-nli-presenter-content.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Installed presenter verification failed; keep consumers closed and recover.' }
```

Keep the journal until digital and physical acceptance pass. Check the served route and metadata hashes through exhibit nginx before reloading GIS, projection-left, projection-right, and presenter. Application moves the staged lock into the target repository, so read the installed canonical lock after apply and compare its route hash with the still-present prepared manifest. The served route bytes must match that lock, and the served metadata bytes must match the prepared manifest:

```powershell
$tempLines = Join-Path $env:TEMP "nli-lines-$stamp.geojson"
$tempMetadata = Join-Path $env:TEMP "nli-release-metadata-$stamp.json"
Invoke-WebRequest 'http://localhost/otef-interactive/public/processed/layers/nli/lines.geojson' -OutFile $tempLines
Invoke-WebRequest 'http://localhost/otef-interactive/public/processed/layers/nli/release-metadata.json' -OutFile $tempMetadata
$installedLockPath = Join-Path $repoRoot 'otef-interactive/scripts/nli-border-route-curation.lock.json'
$lock = Get-Content $installedLockPath -Raw | ConvertFrom-Json
$manifest = Get-Content (Join-Path $bundle 'prepared-manifest.json') -Raw | ConvertFrom-Json
$expectedLineCandidate = ($manifest.targets | Where-Object role -eq 'processed_lines').candidateSha256
$expectedMetadata = ($manifest.targets | Where-Object role -eq 'release_metadata').candidateSha256
$expectedLines = $lock.curation.runtimeByteSha256
if ($expectedLines -ne $expectedLineCandidate) { throw 'Installed lock does not match the prepared route candidate.' }
$servedLines = (Get-FileHash $tempLines -Algorithm SHA256).Hash.ToLowerInvariant()
$servedMetadata = (Get-FileHash $tempMetadata -Algorithm SHA256).Hash.ToLowerInvariant()
if ($servedLines -ne $expectedLines) { throw 'Served route hash does not match the installed lock.' }
if ($servedMetadata -ne $expectedMetadata) { throw 'Served metadata hash does not match the prepared bundle.' }
```

After both hashes match, reload every consuming surface so none retains the earlier 80-route data or presenter content. Record the served hashes, browser reloads, and physical results. On both projection outputs and GIS, inspect retained border position, nine aligned existing approaches, nine separate unconfirmed additions, confirmed/unconfirmed styling, continuous joins, direction of reveal, pause/idle/completed flow, and unaffected settlements and presenter captions. Record operator, date, display, and outcome. A successful build, verifier, or HTTP hash check does not substitute for these observations.

If the served hashes or acceptance checks fail, close all consuming surfaces and restore the journal's preimages:

```powershell
& $python $cli --repo-root $repoRoot --rollback $journal
if ($LASTEXITCODE -ne 0) { throw 'Rollback failed; preserve the journal and stop deployment.' }
```

### Interrupted apply recovery

If `--apply` exits without returning successful `published` JSON, keep GIS, both projections, presenter, and editing tools closed. Do not reuse a previous shell value for `$journal`, retry apply, remove the unfinished marker, or delete journals or backups. The apply snippet initializes `$journal` to `$null`; use the marker below to locate the current transaction explicitly.

```powershell
$recoveryMarker = Join-Path $repoRoot 'otef-interactive/public/processed/layers/.nli-route-release-unfinished.json'
if (-not (Test-Path -LiteralPath $recoveryMarker)) {
  Write-Output 'No unfinished marker. A preflight rejection creates no transaction; an automatic rollback removes the marker after restoring preimages. Inspect apply output and verify every target against its recorded preimage before deciding which occurred.'
  throw 'Stop with consumers closed; do not retry apply or select an older journal.'
}
$controlDirectory = (Resolve-Path (Split-Path -Parent $recoveryMarker)).Path
$markerData = Get-Content -LiteralPath $recoveryMarker -Raw | ConvertFrom-Json
$journalName = [string]$markerData.journal
if ([IO.Path]::IsPathRooted($journalName) -or [IO.Path]::GetFileName($journalName) -ne $journalName -or $journalName -notmatch '^\.nli-route-release-[0-9a-f]{32}\.json$') { throw 'Marker journal name is invalid or outside the control directory.' }
$journalCandidate = [IO.Path]::GetFullPath((Join-Path $controlDirectory $journalName))
$controlPrefix = $controlDirectory.TrimEnd([char]92) + [char]92
if (-not $journalCandidate.StartsWith($controlPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Journal path escapes the release control directory.' }
$recoveryJournal = (Resolve-Path -LiteralPath $journalCandidate).Path
$transaction = Get-Content -LiteralPath $recoveryJournal -Raw | ConvertFrom-Json
$expectedRepo = (Resolve-Path -LiteralPath $repoRoot).Path
$expectedProcessed = [IO.Path]::GetFullPath((Join-Path $repoRoot 'otef-interactive/public/processed/layers/nli'))
$expectedJournalName = ".nli-route-release-$($transaction.transactionID).json"
if ($transaction.transactionID -ne $markerData.transactionID -or [IO.Path]::GetFileName($recoveryJournal) -ne $expectedJournalName) { throw 'Marker and journal transaction identities differ.' }
if ([IO.Path]::GetFullPath($transaction.repoRoot) -ne $expectedRepo -or [IO.Path]::GetFullPath($transaction.processedLayersRoot) -ne $expectedProcessed) { throw 'Journal repository or processed-root identity differs from this target.' }
& $python $cli --repo-root $repoRoot --rollback $recoveryJournal
if ($LASTEXITCODE -ne 0) { throw 'Recovery failed; preserve the marker, journal, and backups and stop.' }
```

With no marker, a failing preflight means publication never began. A failed replacement followed by completed automatic rollback means the publisher restored the recorded preimages and removed the marker; confirm all target hashes before proceeding. If the apply result is `unchanged`, verify that the exact expected release is installed and compare target hashes. If the marker exists, use only the matching verified journal. Never remove the marker manually or delete backups.

After rollback, verify the original route and metadata hashes from the journal preimages and confirm the derived lock is absent or restored to its recorded preimage. Reopen consumers only after those checks pass. Preserve the journal and backups if rollback reports an error.

A future change to the border's geographic geometry requires regenerating only the selected approaches from the saved original 80-route baseline, with a revised recipe and border identity followed by fresh visual reconciliation. Do not apply repeated trims or extensions to an already-curated 89-route file. The original confirmed route geometries remain unchanged. A whole-projection calibration moves the border and routes together and does not require geographic route regeneration.

Served nginx verification, consumer reload, show-break application, rollback exercise, GIS inspection, projector inspection, and physical acceptance remain deferred. No live service, browser, public NLI file, or exhibit display was changed for this offline task.

## Gaza border-route release applied on local dev — 2026-10-09

This record resolves the offline navigation blocker above. The four missing moments (572, 636, 724, 1197) contain only fire polygons. Commit `89de6644` already excluded fire polygons from playback. The owner confirmed that removal; the tracked navigation reference now preserves the original 116 source minutes and records exactly these four exclusions. Current playback has 112 beats (7 opening and 105 remaining). The pinned export digest, source/package identity, presenter text and references, and caption contracts remain unchanged. Sol 6.1 approved the focused reference correction.

The feature branch was merged into local `dev` as `b2bee9c8`. A fresh standard preparation passed the full presenter verifier and all 18 frozen preview operations; maximum preview deviation was 0.006586 m. The earlier audit-only bundle was not applied. With the two observed exhibit tabs unloaded, the validated release was published as transaction `717e481966b032a735d234784995ca10`. The installed proof check and full presenter verifier passed, and nginx served the exact locked runtime digest `b631e63fa6d3eaeb889a0efd88c6229f446ab7b2a3a75bf1c98da810b7b7a2c1`. The tabs were reopened with cache disabled during navigation.

The active dataset has 89 routes: 68 unchanged confirmed routes and 21 unconfirmed routes. Every added connection is unconfirmed. Route 30 uses its short local connection; route 32 follows the reviewed road 4 geometry. Browser checks against the actual nginx URLs, without candidate interception, rendered the expected confirmed and unconfirmed sources on GIS and both projection host frames, with no page exceptions. Screenshots were inspected. These private browser checks did not alter shared playback state and do not certify the physical projector/model fit.

Post-publication verification passed 234 frontend tests across eight relevant files and `npm run build:frontend`. Earlier merged-tree checks passed 189 route/processing tests, 35 buffered-gradient tests, and 29 isolated Django contracts. Existing build chunk-size warnings remain. No container restart or remote push occurred.

Evidence is retained in `artifacts/verification/2026-10-09-gaza-dev/`: preparation/application records, installed proof and presenter results, released nginx bytes, browser results/screenshots, and test/build logs. The rollback journal and its backups are retained at `otef-interactive/public/processed/layers/.nli-route-release-717e481966b032a735d234784995ca10.json`; use the documented rollback CLI with this journal if needed.
