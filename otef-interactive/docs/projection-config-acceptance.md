# Projection configuration acceptance

This record separates software checks from physical exhibit gates. Evidence files below are stored under `.superpowers/sdd/projection-config/baseline/` on the exhibition PC.

| Gate | Device/site | Action | Evidence | Result |
|---|---|---|---|---|
| Routes and launcher | Exhibit PC | Open GIS, remote, full/left/right projection, config, curation and printable QR | Task 10 route checks and launcher evidence | Routes loaded; curation data limitation recorded separately below |
| Nginx deployment and port | Exhibit PC | Rebuild/recreate nginx, verify root redirect and temporary nondefault port | `task10-launcher-port8512.txt`; root `302`, `nginx -t`, runtime no-cache verification, restored port 80 | Passed; nginx deployment is a one-time release operation separate from ordinary calibration Save |
| Responsive layout | 400px phone viewport; desktop/tablet review | Open launcher/config and inspect overflow and controls | `task8-launcher-phone-400.png`; Task 7 desktop/400/tablet screenshots | Software layout evidence collected |
| Persisted working state | Exhibit API/TD | Change unsaved config, restart API, reconnect, revert | `task10-working-before-restart.json`, `task10-working-after-restart.json`, `task10-api-reconnect-td.json`, `task10-after-reconnect-revert.json` | Passed; TD instance IDs persisted without refresh |
| Editor reconnect and patterns | Exhibit PC/TD | Recreate nginx with unsaved settings and left Grid selected | `task10-final-reconnect-1.jpg`, `task10-final-reconnect-2.jpg`; editor showed Live changes and Live off | Same TD instances acknowledged; Grid renewal resumed beyond its expiry; Grid removed and Original restored |
| Live output | Exhibit TD sources | Drag calibration and revert | Task 6 TD images and drag ledger | Passed for loaded sources; physical alignment remains pending |
| Independent branches | Exhibit TD sources | Change left post X and right crop edge independently, then revert | `task10-left-post.json`, `task10-right-crop.json`; same TD IDs acknowledged | Browser/runtime independence passed; physical fit pending |
| Browser acknowledgement latency | Exhibit PC localhost | 30-second drag run | `task6-td-drag-30s.json`: 1801 inputs, 290 POSTs, 369 completions, median 60.1ms, p95 88ms, empty queue | Passed browser acknowledgement target |
| LAN phone control | Lab/NLI network | Scan QR and operate remote/config from phone/tablet | No physical scan evidence collected | Pending |
| Network transition | Exhibit network | Change DHCP/network while running and reconnect | No direct physical switch evidence collected | Pending |
| Projection parity and clipping | Physical model, Zikim and inland anchor | Compare Original and diagnose coast clipping | Task 3 browser parity and image alignment evidence; no physical mask diagnosis | Browser parity passed; physical diagnosis pending |
| TD/GPU performance | Exhibit TD/projectors | Compare browser output timing and inspect live TD display path | 2026-09-27 compositor captures and TD display sampling documented below | Browser before/after and current TD rAF/cook rates collected; TD before/after, GPU, and projector presentation pending |
| Curation external data | Exhibit/browser | Load curation and published layers | `task10-curation.txt` | Shell/layers loaded; external Supabase submissions blocked by DNS |

Spec-to-task software coverage:

- Tasks 1–2: shared schema, defaults, PostgreSQL persistence, CAS, presets, and broadcast suite passed; 26 backend tests passed.
- Tasks 3–4: camera/geometry parity, name ownership and clipping diagnostics passed in collected controlled evidence.
- Tasks 5–6: runtime application, reconnect, TD acknowledgements, and localhost latency evidence collected.
- Tasks 7–8: editor, launcher, QR, responsive layout, reconnect/Live-off state, and focused frontend coverage collected; final frontend suite passed with 1,454 tests in 177 files (`final-frontend-tests.txt`).
- Tasks 9–10: helper lifecycle, port 8512 exercise/restoration, nginx routes, root redirect, runtime no-cache, and final route/build checks passed.

Explicitly pending or partial gates:

- Direct physical pre-transform, crop, and post-transform fit on the model, including Zikim mask diagnosis and an inland physical anchor.
- Physical label/halo placement and viewport/bounds/resize acceptance on the exhibit.
- Real phone/tablet QR scan and control at the lab and NLI networks, including DHCP/network switching.
- Input-to-physical-projector latency and GPU/TD FPS comparison; the 2026-09-27 physical-output browser rAF and CPU measurements below do not establish either.
- Full curation submissions retrieval remains environmentally blocked by external Supabase DNS.

Final review fixes add explicit settings-check retry, visible preview errors, zoom-limit detection with last-good rollback, and keyboard node selection. The eight covering suites passed 100 tests; the build and independent re-review passed.

After the final code patch, each TD Web Browser source was refreshed once to load that deployment (in addition to the earlier development deployment). The new left/right instances then applied unsaved pre-X 4% and Revert without another refresh. Original was restored at revision 214. Evidence: `final-td-live-1.jpg`, `final-td-live-2.jpg`, `final-restored-state.json`. No TD URLs, keystone/grid-warp settings or project files were changed.

Physical acceptance requires direct observation on the exhibit hardware and network. Software evidence must not be presented as proof of phone reachability, projector alignment, downstream clipping, or GPU performance. Migration application and nginx image deployment are one-time deployment steps; ordinary calibration Save does not require either.

## Node workspace correction — 2026-09-14

The editor now uses a full-window desktop canvas with floating actions, draggable node headers, attached wires, pan/zoom/Fit, inline decimal entry, and fine nudges. Phone controls open directly at touch size. Root browser checks moved both Content and Shared pre nodes and observed wire path/position changes; manual scale 1.234 committed on Enter and fine nudge produced 1.235. Phone viewport had no horizontal overflow and 44px controls.

The old model-image thumbnails were rejected and removed. Left/Right Output offers one opt-in instance of the actual projection renderer, receiving validated local drafts without the calibration runtime or projector acknowledgements. It retains active content subscriptions. The preview excludes downstream TD warp; intermediate render-stage previews remain unimplemented. Root visually compared its dark map/orange roads/white names content with the TD projector windows, tested Live-off left post-scale 2.123 while the server retained 2, and restored the local draft to Saved. The user continued calibrating during this work, so earlier revision423 is not a final restoration target.

Five focused editor/canvas/preview suites passed 13 tests. This correction does not establish physical alignment or frame-rate performance. The preview is explicitly opt-in and can be closed to release its renderer. No TD source refresh, warp changes, or container restart is required for this editor correction.

## Projection compositor and on-demand warp editor — 2026-09-27

The earlier opt-in output preview described above was replaced by a warp editor that creates one projection iframe on explicit Open and removes it on Close. The config page has no projection iframe on fresh load. In the nginx-served desktop browser, all four Left/Right Keystone/Grid Warp graph actions were opened and closed, followed by six more cycles: each of ten openings had one iframe and each Close left zero. A Left Keystone to Grid Warp switch within the Fine panel retained one iframe and changed the title. Fine adjustment began collapsed; expanding it kept the render region and controls separate. With Live unchecked, one 0.25 px right-arrow edit retained the selected corner, and Undo restored its X value. With the editor closed, both model-oriented and regular names-wall drafts completed preflight for all 1,228 names with zero iframes; the regular-wall draft was discarded by reloading the saved model-oriented profile. No Apply or Save was used in that draft-edit check. A subsequent Apply once on the unchanged saved calibration and Live off/on toggle showed no browser error or config iframe; both physical Chrome output windows remained active. Source: `.superpowers/sdd/projection-compositor-warp-editor/task-6-browser-evidence.md`. DOM frame removal was observed; GPU context lifetime was not measured directly.

On the exhibit PC, before (`b7fcac4`) and after (`1388c4c`) captures used Chrome 153 and two fullscreen 1920×1080 physical output windows through nginx. Config was unloaded; Free control Loop timeline ran with names animation off. The same temporary probe used a 10-second warm-up and three 30-second runs per output. Content mode and hardware matched, while the running timeline means sampled frames were not pixel-identical. Values are arithmetic means of each run's percentile, before → after:

| Output | rAF p50 (ms) | rAF p95 (ms) | rAF p99 (ms) | CPU draw p50 (ms) | >33.3 ms gaps, three-run total |
|---|---:|---:|---:|---:|---:|
| Right | 72.17 → 44.40 | 100.10 → 66.77 | 166.67 → 77.87 | 16.07 → 0.60 | 1,253 → 1,523 |
| Left | 72.23 → 44.37 | 100.13 → 66.73 | 122.13 → 77.83 | 15.93 → 0.50 | 1,246 → 1,590 |

Before the change, image, map, and caption uploaded on every draw on both outputs; the left legend did too. After the change, static image uploads were zero, captions uploaded 12 times per run, and map uploads still occurred on every draw (right 2,121 and left 2,098 across three runs). Sources: `.superpowers/sdd/projection-compositor-warp-editor/before-performance.json` and `after-performance.json`; screenshots `before-perf-output-1/2.jpg`, `after-perf-output-1/2.jpg`, and `after-clean-output-1/2.jpg` in the same directory. The temporary probe was removed, the uninstrumented build passed, and both physical output windows were reloaded and visibly rendered without diagnostic text.

rAF intervals measure browser callback cadence; CPU draw time measures synchronous submission, excluding GPU work. Neither establishes projector-presented FPS. Many >33.3 ms gaps remain, and meteor lag has not been shown resolved. The 481-test frontend integration run, frontend build, 47 backend projection tests in the existing API container with `--keepdb`, and `git diff --check` passed. Changed production frontend files grew from 4,950 to 5,402 lines (+452); changed tests grew from 2,307 to 3,084 (+777), including the deletion of the eager preview module and its test. Full commands and scope review are in `.superpowers/sdd/projection-compositor-warp-editor/task-6-integration-evidence.md`.

Still unverified for this change: actual phone and tablet operation in portrait and landscape across all four side/mode combinations; touch gestures, scrolling, interruption, resize/orientation, and native fullscreen outcomes; GPU execution and projector presentation timing; physical model alignment and meteor lag; same-URL image reload while idle, map motion, context recovery, unchanged names animation, overlays/opacity/crop/warp, and changed-draft Apply/Live output acknowledgement, presets, conflict handling, incomplete/unavailable preflight, and computational-to-output mesh parity in the exhibit browser. Existing broader network and TD gates listed above remain open.

## Live TD projector displays — 2026-09-27

The two standalone Chrome windows used for the earlier before/after benchmark were closed. The running TD project, `Tkumap_split_projection_copy.toe`, retained its two 1920×1080 output windows on the exhibit displays. Windows reports displays 2 and 3 at **50 Hz**. TD's left and right Web Render TOPs use the current projection URLs, return HTTP 200, and are configured with `maxrenderrate=30` and `sharedtexture=false` under CEF/Chromium 132.

Three 30-second samples inside each TD Web Render page recorded **901 requestAnimationFrame intervals per run**, with p50 33.3 ms, p95 33.4 ms, and p99 33.4–33.5 ms. The latter two runs had no intervals over 40 ms. TD's left/right Web Render TOPs and output windows cooked at **49.94–49.98 times/s** across three longer sampled intervals, consistent with the 50 Hz displays. TD cook counts are not counts of distinct browser frames. Both Web Render TOPs have a configured 30 FPS maximum, and the measured in-page callback rate was about 30/s; distinct browser frame production was not measured. Final left/right TD output textures visibly contain the map, labels, and orange road without diagnostic text; later Loop timeline pairs show changing route and marker overlays. These are digital output captures rather than photographs of the physical model. The Loop captures followed the rate samples, so the rates do not measure that animation. The temporary in-page measurement changed only the page titles, which were restored. No TD project file or parameter was saved or changed.

Source: `.superpowers/sdd/projection-compositor-warp-editor/task-6-td-hardware-evidence.md`, with raw JSON and `td-output-left.png` / `td-output-right.png` alongside it. This is a current TD-path measurement; no matched TD measurement exists from before the compositor change. The earlier Chrome before/after comparison measures a different output path and cannot establish a TD speedup. GPU completion, distinct frames presented by the projector, input-to-light latency, physical model alignment, and meteor-head position remain unmeasured.
