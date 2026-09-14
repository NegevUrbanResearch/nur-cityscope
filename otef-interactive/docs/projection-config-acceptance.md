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
| TD/GPU performance | Exhibit TD/projectors | Compare identical baseline scene and calibrated scene | No GPU/FPS comparison collected | Pending |
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
- Input-to-physical-projector latency and GPU/TD FPS comparison against an identical baseline; the localhost browser timing does not establish either.
- Full curation submissions retrieval remains environmentally blocked by external Supabase DNS.

Final review fixes add explicit settings-check retry, visible preview errors, zoom-limit detection with last-good rollback, and keyboard node selection. The eight covering suites passed 100 tests; the build and independent re-review passed.

After the final code patch, each TD Web Browser source was refreshed once to load that deployment (in addition to the earlier development deployment). The new left/right instances then applied unsaved pre-X 4% and Revert without another refresh. Original was restored at revision 214. Evidence: `final-td-live-1.jpg`, `final-td-live-2.jpg`, `final-restored-state.json`. No TD URLs, keystone/grid-warp settings or project files were changed.

Physical acceptance requires direct observation on the exhibit hardware and network. Software evidence must not be presented as proof of phone reachability, projector alignment, downstream clipping, or GPU performance. Migration application and nginx image deployment are one-time deployment steps; ordinary calibration Save does not require either.

## Node workspace correction — 2026-09-14

The editor now uses a full-window desktop canvas with floating actions, draggable node headers, attached wires, pan/zoom/Fit, inline decimal entry, and fine nudges. Phone controls open directly at touch size. Root browser checks moved both Content and Shared pre nodes and observed wire path/position changes; manual scale 1.234 committed on Enter and fine nudge produced 1.235. Phone viewport had no horizontal overflow and 44px controls.

The old model-image thumbnails were rejected and removed. Left/Right Output offers one opt-in instance of the actual projection renderer, receiving validated local drafts without the calibration runtime or projector acknowledgements. It retains active content subscriptions. The preview excludes downstream TD warp; intermediate render-stage previews remain unimplemented. Root visually compared its dark map/orange roads/white names content with the TD projector windows, tested Live-off left post-scale 2.123 while the server retained 2, and restored the local draft to Saved. The user continued calibrating during this work, so earlier revision423 is not a final restoration target.

Five focused editor/canvas/preview suites passed 13 tests. This correction does not establish physical alignment or frame-rate performance. The preview is explicitly opt-in and can be closed to release its renderer. No TD source refresh, warp changes, or container restart is required for this editor correction.
