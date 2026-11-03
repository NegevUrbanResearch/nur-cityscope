# NLI presenter timeline source verification

Status: **660-key production manifest source-checked; 442 targeted NLI tests and build pass; UI refinements reviewed by GPT-6.1 Sol; physical-device and hardware checks remain open** (2026-09-30).

## Current UI refinements (2026-09-30)

Back to now turns yellow in browse mode and returns to its outlined appearance in follow mode. Opening minutes and Nova have no rail; their event lists still scroll. The rest-of-day rail remains, with its omitted-range marker and accessible description, but no visible 14–18 caption. Existing additional details occur only in six Nova membership records and now appear directly in the scrollable event text. The details button and dialog were removed. The caption manifest, its record digest, and accepted runtime data are unchanged.

Presentation Next slide is absent at the acknowledged last slide of the current scene's inclusive range. Previous and Close remain available; Next returns after an earlier slide is acknowledged. Scene navigation is unchanged. Focused failing tests preceded behavior changes, and GPT-6.1 Sol independently passed both task reviews.

| Check | Current evidence |
| --- | --- |
| Targeted frontend regression | PASS: 442/442 tests across 21 files, including presenter, presentation, clocks, reveal, Nova, staff integration, and manual transport. |
| Content/source verifier | PASS: nine requests; 660 keys; accepted polygon, route, and alarm hashes unchanged. Record digest remains `b0a75be8999bd1f6ce74048eb31359e2921ad9abbd16918805ec940ab131e85d`. |
| Frontend build | PASS: Vite 5.4.21, 262 modules, 12.81 seconds; existing large-bundle warnings remain. |
| Complete frontend run | 3,486/3,493 passed. The five unrelated assertion failures listed in the previous follow-up remain. Native-entry and Nova escape-index checks also timed out at 5 seconds during the concurrent run; both passed in the final targeted rerun. This is not a full-suite PASS. |
| Django | 75/76 passed; the existing Nova error-string mismatch remains. No backend files changed. |
| Browser browsing | Opening minutes has no rail. Scrolling changes Back to now to yellow; returning restores its outlined appearance and leaves the applied time unchanged. Rest-of-day keeps the rail, removes visible gap text, and also shows yellow while browsing. |
| Browser inline details | Hebrew and English Nova details render inline with no dialog or details button. Confirmed actual 800x1280, 1280x800, and 960x540 viewports at 100%; card controls and footer fit. Long English text scrolls within the short-PC card. Nova list scrolling remains available. |
| Browser presentation | With the live GIS viewer connected, the scene deck acknowledged 8/8: slide Next was absent, Previous/Close and scene Next remained. Previous acknowledged 7/8 and restored slide Next. Presentation closed and remote returned Home. |
| Remaining acceptance | OPEN: physical Galaxy Tab viewport/touch/inertia, screen reader/reduced motion, and projector fit/reveal/performance. The previously recorded optional built-HTML asset mapping limitation remains open. Phone and text scaling remain outside the agreed scope. |

## Previous UI follow-up evidence (superseded where stated above)

The UI follow-up removes routine scene-status messages, retains failure/retry handling, removes redundant Nova location wording, adds a dismissible details dialog and playback icons, hides Nova's rail while preserving list scrolling, and fixes occupied-minute rail spacing and marker visibility. Details retain the opened event's context while playback continues. Close, outside click, and Escape dismiss the dialog without a clock command. Hiding the presenter clears the dialog and focus trap.

GPT-6.1 Sol reviewed the rail, scene-status handling, source-copy delta, and presenter view, including fixes from review. The source-copy delta changes only the Hebrew/English summaries of six Nova membership records (three events in two memberships); the other 654 records, all titles/details/time labels/source references, accepted identities, and runtime GeoJSON are unchanged. The current record digest is `b0a75be8999bd1f6ce74048eb31359e2921ad9abbd16918805ec940ab131e85d`. This is independent source/code review, not owner release or physical-device acceptance.

| Check | Current evidence |
| --- | --- |
| Final targeted NLI regression | PASS: 405/405 tests across 19 files, including clock/reveal/Nova/manual transport, scene integration, Home transitions, overlay, and status handling. |
| Content/source verifier | PASS: nine requests; accepted polygon, route, and alarm byte/feature hashes unchanged. |
| Final frontend build | PASS: Vite 5.4.21, 262 modules, 7.31 seconds; existing large-bundle warnings remain. |
| Complete frontend run during this follow-up | 3,487/3,492 passed. Five failures in untouched checks are listed below; this is not a full-suite PASS. Final overlay/stacking/RTL fixes were subsequently checked by the targeted suite above. |
| Django | 75/76 passed; the existing Nova error-string assertion mismatch remains. No presenter backend files changed. |
| Browser profiles | Rendered staff UI checked at 800x1280 portrait, 1280x800 landscape, and 960x540 PC at 100%. Card/control/list regions fit; Nova rail is absent and the short-PC list scrolls. Hebrew and English controls, icons, and gap labels checked. |
| Browser rail behavior | Opening rail shows actual minute endpoints. Rest-of-day applied/browse markers have explicit stacking above ordinary/hour ticks; combined white-center/yellow-outline marker and separated marker lanes are visible. Browsing from applied 06:46 to 19:57 leaves the applied event unchanged. |
| Details dialog | Visible bounded text panel with event context and explicit Close; underlying card remains visible. Browser Close, Escape, and outside-click dismissal checked; outside dismissal restores focus to Details and leaves the applied event unchanged. LTR isolation fixes Hebrew time ranges and omitted-hour ranges. Automated regressions cover focus, dismissal, stable captured text, and zero dialog clock writes. |
| GIS/projection follow-up smoke | Both surfaces rendered the paused Nova scene, maps/model, and legends. This is a browser smoke check, not projector fit/reveal/performance acceptance. |
| Physical acceptance | OPEN: actual Galaxy Tab viewport/touch/inertia, screen reader/reduced motion, and projector fit/reveal/performance. Phone and text scaling remain outside the agreed scope. |

The five complete-suite failures are `entry-bootstrap-contract.test.js` (projection curated source signature), `nli-segev-narrative-contract.test.js` (GIS camera source pattern), `legend-content.test.js` (route dash array), `nli-name-wall-config.test.js` (additional stroke-width default), and `nli-name-wall-current-data.test.js` (model stroke width). Neither these tests nor their projection/GIS/legend/name-wall production paths were edited in this follow-up. Preserve these unrelated changes; their test expectations require separate work.

The configured native-source staff URL remains the tested URL. The earlier optional built-HTML `/assets` mapping limitation below remains open; this follow-up did not change server mapping or publish a build.

## Earlier implementation verification (superseded where stated above)

This section records the current evidence and supersedes conflicting release, manifest, browser, and test claims in the historical Task 8 entries below. The production manifest contains 660 keys and 1,320 localized title/time-label values across nine membership/narrative requests. Sol source-checked the original batches (early 80, later 78, alarms 144, Nova 5); the five new alarm-bearing Nova membership keys exactly reuse the five reviewed bilingual Nova records and source references. All 655 original manifest records are unchanged. The resulting record digest is `e07bd68b0e3c0ace95df1f513fbd1ded13a282c86d10ed72a2bb121798e6072d`. The focused caption-integration suite passes 23/23 tests, and the default content verifier passes all nine requests. The approved-package comparison covers the production GeoJSON copy; the 12 unconfirmed approach/connector routes remain visual augmentation and are excluded from presenter wording. These source checks do not by themselves establish release or hardware acceptance.

The configured production staff URL `/otef-interactive/nli-staff-remote.html` serves the native source entry and renders the populated presenter. The 07:00 event was a representative event used for source comparison, not the first event. The observed design structure matches the reviewed visual reference: yellow time, card at the top, central play control, rounded event rows, and a weighted rail. The optional built HTML URL `/otef-interactive/dist/frontend/nli-staff-remote.html` currently renders empty because it requests `/assets/nliStaffRemote-Cgt2uLOd.js`, which returns HTTP 404 from the running nginx mapping. This does not affect the configured source-served production URL; nginx was not changed and the built URL was not treated as visually verified. The configured release scope is Galaxy Tab 11 or PC at normal 100% text size. The 320×480 phone profile and text scaling are outside this deployment gate. At 200%, the current-card body can collapse; this known limitation is recorded and does not require a fix for the agreed scope.

| Browser profile at 100% | Locales | Rendered titles | Row geometry | Result |
| --- | --- | --- | --- | --- |
| 800×1280 portrait | Hebrew and English | All 660 fit at 16px Heebo and Arial fallback | Uniform 61px rows | PASS |
| 1280×800 landscape | Hebrew and English | All 660 fit at 16px Heebo and Arial fallback | Uniform 61px rows | PASS |
| 960×540 PC | Hebrew and English | All 660 fit at 16px Heebo and Arial fallback | Uniform 106px rows | PASS |

Across all 12 profile/locale/font runs, all 660 records rendered with zero title overflows, and rows used one height per profile. These are browser viewport checks; physical tablet acceptance and confirmation of the tablet's actual CSS viewport remain open. Sol approved the supported 100% scope and performance cache/font invalidation review.

| Integration gate | Current result |
| --- | --- |
| Focused caption-integration tests | PASS: 23/23. |
| Default content verifier | PASS: all nine membership/narrative requests and manifest/source checks. |
| Full frontend suite | PASS: 368 tests across 17 files. |
| Frontend build | PASS: Vite 5.4.21, 262 modules, 6.34 seconds; existing bundle warnings for MapLibre (about 1,054 kB) and the staff bundle (about 1,241 kB). |
| Production manifest and source checks | PASS for 660 keys and reviewed bilingual source records. The added five Nova keys exactly reuse the reviewed source records; the original 655 are unchanged. This does not establish hardware acceptance. |
| Running UI: browse and playback | PASS for observed browser interactions. Browsing to 19:57 leaves the applied event unchanged; Back to now centers the current row; Next advances to 08:45 and pauses; Previous returns to 08:40; playback advances 09:30 to 10:50 while browsing remains at 19:57 and the list remains at scrollTop 11,293 CSS pixels (109 rows). |
| Nova details | PASS: live Nova step 1 is idle at 08:03; step 2 presents five captions and working controls. Opening/closing details leaves the 1280×800 card (504.015625px) and controls (68px) rectangles unchanged; closing restores focus to the details trigger. |
| Command side effects | The command spy in focused tests verifies browsing causes zero writes. UI observations are consistent; no captured HTTP request count or network trace is claimed. |
| GIS, projection, and manual Layers | PASS for a rendered smoke check: GIS map/legend/timeline, projection model/map/legend, and connected Layers controls rendered without observed console errors. This does not verify projector motion or hardware behavior. |
| Physical tablet, Galaxy Tab actual CSS viewport, reduced motion, screen reader, touch inertia, projector fit/reveal performance | OPEN. |
| Django | 75/76 pass; one pre-existing Nova error-string mismatch (`unsupported segmentId` vs `narrative has no presentation`). No presenter backend files changed. |
| Whole-branch review | Sol whole-branch review passed with no Critical or Important findings. Astra review was waived by the user on 2026-09-30. |
| Release decision | Device/accessibility/projector checks remain open; automated frontend and source verification are complete. |

## Previous verification history (superseded where stated above)

## Earlier source-only assessment (superseded by current evidence above)

The pinned beat export is `nli-full-beats-source.json`, SHA-256 `ec806708e478426efa1b0b793784dac3257ca78fd742f49ca382130475400fcf`. The export declares stored `timeline_minutes` as its time basis and warns that historical times may be approximate. The generated navigation fixture contains 116 minutes: 7 at or before minute 401 and 109 at or after 402; it includes 453, 454, and 1197. Occupied hours are 6, 7, 8, 9, 10, 11, 12, 13, and 19. These are fixture facts, not production constants.

The ignored `public/processed/layers/nli/release-metadata.json` declares source SHA-256 `431b9e853e1fc4719125da7a96135c7d1a0b854c3395389b45d0212e1bdf0ebe`, dataset version `sha256:0a3b59aa4b2f6925357eff129c79dcc2316d0c0a1a26eb9d78647ad4cb2ec1cc`, source date `2026-08-30`, and review decision IDs `import-contract-2026-08-30` and `owner-approval-2026-08-31`. The local `public/source.zip` hashes to `cc36975c66cdf6f8202d1ced0d4e26eb48b390acf70c9280b431ec0e57b6fee0`, which does not match that declared source SHA. The declaration is evidence of a previous approval, but does not identify acceptance of the current runtime route additions.

| Processed artifact | Current byte SHA-256 | Feature-array SHA-256 | Release metadata reference |
| --- | --- | --- | --- |
| `investigation_polygons.geojson` | `1ea19c33ffc98d094df295ce4a7bae3851381b07b0f65b79ab2d78bc15daa49e` | `d9965d240a7d2ef7c66f5faee30085a6b9f793b08038e14a09e41fc7bb7ab902` | declared file hash `8AFA5006250D060A22D59AFE2FD7A796FC4B06D3A70BDD6721470D8EBF542232`; pinned fingerprint matches current bytes |
| `lines.geojson` | `934bd4be7a1d6a4f1b6a0f62337384d06624e571a6efe44da366ab6062afa3c1` | `44bce88717e20c667a207da00085acee184a73efcbd2547c4766cdc1151baf16` | metadata records 68 lines and runtime hash `B44F19BCA5292468A10EB967A56576789DE5CD8FFFBAF037FEB4E35521F1C502`; current file has 80 features and does not match the pinned fingerprint |
| `alarms.geojson` | `850ffd4cb89b62fef0a85b1c0562969bf0d829e2172f61ccc7bb2e54297b4189` | `063ccd35f3b058bee93e9dd05e9768c9aa973b64138e2d43aa1b8dbbb54dcad7` | pinned fingerprint matches current bytes; metadata records 190 alarms |

The polygon and alarm current byte hashes match the design’s pinned hashes. The current route hash does not. The release metadata records approved import, line-direction, location-map, and PID-map reviews for its declared release. I found no accepted override record tying the current 80-route artifact to that release, and no route override evidence sufficient to establish the added routes’ provenance. I did not change source or processed runtime files. Therefore the current additions' provenance and editorial acceptance remain unverified.

## Task 8 verification (2026-09-30)

**Release status: BLOCKED.** Frontend code checks pass, but the presenter release gate fails for missing accepted source/override provenance and 1,310 localized title/time-label records. Production route data was read only. No accepted captions were added and no processed artifact was edited.

| Gate | Result | Evidence |
| --- | --- | --- |
| 8.1 focused frontend tests | PASS | Exact Task 8 command; 15 files, 343 tests passed. |
| 8.1 content verifier | FAIL (expected release gate) | Exact command against `public/processed/layers/nli` and `frontend/src/remote/nli-presenter-content.json`; exit 1. Reports source ZIP mismatch, 1,310 missing localized records, missing manifest identities/feature hashes/review evidence, and missing route override evidence. |
| 8.1 frontend build | PASS | `npm run build:frontend`; Vite 5.4.21, 262 modules, built successfully. Existing large-chunk warning (1,054.10 kB maplibre bundle). |
| 8.1 Django tests | FAIL | Exact requested Docker command; 76 tests run, one failure: `test_presentation_open_for_nova_is_400` expected `narrative has no presentation`, got `unsupported segmentId`. Other 75 passed. Django source is `nur-io/django_api`; project is `/app` inside `nur-api`. |
| 8.1 `git diff --check` | PASS | Exit 0, no output. |
| 8.2 staff URL as specified | FAIL | `http://localhost:80/otef-interactive/frontend/nli-staff-remote.html` returns 404. Active nginx config aliases the page at `http://localhost:80/otef-interactive/nli-staff-remote.html`, which returns 200. |
| 8.2 deployed entry/manifest/runtime URLs | PARTIAL | Mapped staff HTML, `src/entries/nli-staff-remote-main.js`, `src/remote/nli-presenter-content.json`, release metadata, polygons, lines, and alarms return HTTP 200 through localhost:80. Manifest is 127 bytes and intentionally has no accepted release identity/records. HTTP success does not establish accepted data identity. Built HTML at `/otef-interactive/dist/frontend/nli-staff-remote.html` also returns 200. |
| 8.2 rendered staff remote | PASS after source fix; release remains blocked | The initial blank-page observation was a native module-graph failure and is superseded by the follow-up browser check below. After the fix, the mapped nginx source page renders Home and its nine navigation cards. Opened the Timeline item: presenter panel reports `Accepted presenter dataset identity is missing`; Previous, Play/Replay, Next, and rail are disabled. Retry and Return-to-now remain enabled. No console errors. |
| 8.2 manual Layers | PASS (smoke only) | Existing manual remote at `http://localhost:80/otef-interactive/remote-controller.html` rendered at 1280×720. Its Hebrew “שכבות” tab showed background choices, package groups, active count, package toggle, and layer buttons. No layer state was changed. |
| 8.3 viewport/title geometry | PARTIAL / OPEN | The presenter shows its explicit unavailable state and no event rows because the accepted manifest is empty. Follow-up measured fixed-region/control rectangles at all four requested viewport sizes in Hebrew and English at default text scale; see table below. The 150%/200% text scales, approved title inventory, line boxes, title fit, hit-target comparisons, and actual tablet viewport remain unmeasured. Browser DPR was 1. No synthetic-caption mode established. |
| 8.4 controls/command traces | PARTIAL / OPEN | Clicked Timeline from Home and observed “scene sent”; presenter accurately remained unavailable and disabled Previous, playback, Next, and rail controls. Did not exercise playback or browsing since no accepted event rows exist. Scene race, replay, and touch-inertia traces remain open. Returned staff UI to Home. |
| 8.5 accessibility/device/GIS/projection | OPEN | No screen-reader, reduced-motion, scaling, tablet touch, GIS reveal, projection motion, or kiosk hardware acceptance. Real exhibit tablet/GIS/projector unavailable for this run. |
| 8.6 release decision | BLOCKED | Pending accepted source identity and route override approval, complete accepted English/Hebrew captions and Nova labels, profile geometry/interaction evidence, and real exhibit hardware acceptance. The staff shell now renders; accepted event rows correctly remain unavailable. |

### Task 8 provenance references and command evidence

- Local `public/source.zip`: SHA-256 `cc36975c66cdf6f8202d1ced0d4e26eb48b390acf70c9280b431ec0e57b6fee0`; metadata declares `431b9e853e1fc4719125da7a96135c7d1a0b854c3395389b45d0212e1bdf0ebe`.
- Metadata declares 68 lines and runtime route hash `B44F19BCA5292468A10EB967A56576789DE5CD8FFFBAF037FEB4E35521F1C502`; current route has 80 features and SHA-256 `934bd4be7a1d6a4f1b6a0f62337384d06624e571a6efe44da366ab6062afa3c1`. No accepted override record for the added routes was found in reviewed evidence.
- Current polygon/alarm byte hashes are `1ea19c33ffc98d094df295ce4a7bae3851381b07b0f65b79ab2d78bc15daa49e` and `850ffd4cb89b62fef0a85b1c0562969bf0d829e2172f61ccc7bb2e54297b4189`. The verifier says neither matches accepted release metadata and the manifest lacks feature hashes.
- Runtime manifest returned HTTP 200 but 127 bytes; missing identities and coverage remain a hard gate. No record text was copied here.
- Docker was already running (`nginx-front` port 80, `nur-api` healthy). Django tests ran inside `nur-api` and created/destroyed their test database. No service was started or reconfigured.
- Initial in-sandbox frontend tests/build failed before execution because parent-directory access was denied; verifier could not read ignored NLI artifacts (`EPERM`). Retried commands with filesystem access produced the results above.
- Follow-up diagnosis: the nginx source entry is native ESM and `nli-staff-remote.js` plus `nli-presenter-view.js` imported the JSON manifest without `type: "json"`. Native Node import reproduced `ERR_IMPORT_ATTRIBUTE_MISSING`; nginx logs showed the JSON response but no browser GET to the OTEF state API, proving the entry graph stopped before Home initialization. Added JSON import attributes to both modules. The mapped source page then rendered Home and the Timeline unavailable panel. No runtime source/deployment configuration was changed.
- The incidental built HTML URL `/otef-interactive/dist/frontend/nli-staff-remote.html` is not the configured staff URL: its Vite HTML references `/assets/...`, which nginx returns as 404 (the generated asset is under `/otef-interactive/dist/assets/`). The active nginx staff alias serves the native source HTML and was the target used for the repaired browser check. No nginx configuration or publication change was made.
- Follow-up regression test `tests/remote/nli-staff-native-entry.test.js` failed before the fix with `ERR_IMPORT_ATTRIBUTE_MISSING`, then passed. After both imports were corrected, the native regression, presenter content/view, and staff integration suites passed: 4 files, 53 tests. `npm run build:frontend` passed (262 modules; same existing 1,054.10 kB chunk warning).
- Django failure classification: the expected error assertion is from `a6888702` (2026-09-15), while current `segmentId` validation returning `unsupported segmentId` was added by `f5b89d0c` (2026-09-25), before Task 7. Task 7 changes did not modify the failing test or this validation. Treat it as a pre-existing backend test/behavior mismatch; backend files were not changed.

### Task 8 changed-file accounting

The initial Task 8 commit added 33 lines to this document. The native JSON-import follow-up added 9 lines and removed 5 here; this compact viewport follow-up adds 32 net lines. The compact CSS changes are 4 insertions/4 deletions; the native-entry test grows by 29 net lines, and the new compact CSS regression adds 23 lines. The earlier two JSON import-attribute changes add no net module lines. No source ZIP or processed data changed. `git diff --check` passed after the follow-up edits.

### Task 8 compact viewport and entry-chain follow-up

The Browser skill's configured Chrome tab at `http://localhost/otef-interactive/nli-staff-remote.html` now loads the native source module graph and renders the Home shell. On Timeline, Hebrew and English both show the unavailable state (`Accepted presenter dataset identity is missing` / `Timeline unavailable`); Previous, Play/Pause, Next, and the rail remain disabled. Retry and Back-to-now are enabled. No accepted rows or titles were presented.

| CSS viewport / locale | Presenter rect (x,y,w,h) | Controls rect | Footer rect | Result |
| --- | --- | --- | --- | --- |
| 320×480 / he | `(0,126,320,306)` | `(0,222,320,48)` | `(0,384,320,48)` | PASS: footer ends at 432 CSS px, exactly the dock's top; Retry and Back-to-now visible. |
| 320×480 / en | `(0,126,320,306)` | `(0,222,320,48)` | `(0,384,320,48)` | PASS: same bounds; locale layout places the visible Retry control at the left edge. |
| 800×1280 / he/en | `(32,239.2,736,937.8)` | `(32,566.3,736,48)` | `(32,1129,736,48)` | PASS: presenter/footer end at 1177 CSS px, within the viewport. |
| 1280×800 / he/en | `(28,201.8,1224,504)` | `(646,657.8,606,48)` | `(28,657.8,606,48)` | PASS: presenter ends at 705.8 CSS px, within the viewport. |
| 960×540 / he | `(23,173.4,913.9,308.6)` | `(486,434,451,48)` | `(23,434,451,48)` | PASS: footer ends at 482 CSS px, within the viewport. |
| 960×540 / en | `(23,173.4,913.9,308.6)` | `(23,434,451,48)` | `(486,434,451,48)` | PASS: same bounds; locale swaps the two columns. |

Before the CSS correction, the 320×480 presenter extended to y=486 and the 960×540 presenter to y=593.4; controls/footer were below the viewport. Ancestor measurements showed the short-landscape `#playerKit` was `flex:0 0 auto`, forcing the presenter to the 420px viewport-derived minimum and overflowing the 444px player body. In short portrait, a fixed viewport-derived presenter minimum and `.nli-presenter-browser { min-height:160px }` forced a 6px footer overflow into the dock. Compact rules now let the presenter and browser shrink to the available area. A focused CSS contract test was run red against the old rules, then passed after this correction; the browser measurements were rerun after page reload.

At all four default-scale profiles, `.nli-presenter` reported `--presenter-text-scale: 1`; body controls measured 16px font / 22.4px line height. Browser exposes page evaluation as read-only and this staff screen has no scale control, so 150%/200% scoped-scale checks were not performed. No synthetic accepted captions were introduced. Browser tab sequence reached Retry and Back-to-now by keyboard; both have focus outlines. Disabled playback/navigation controls were skipped by tab order. No presenter retry, browse, row, rail, or clock control was activated. Tablet hardware, reduced-motion, GIS/projector, row/title fit and focus-removal behavior remain OPEN.

The native-ESM test now reads the configured source HTML, resolves its module script to `src/entries/nli-staff-remote-main.js`, resolves the entry's `initNliStaffRemote` import, checks entry syntax, and imports both the entry and staff module under Node native ESM. This exercises the static JSON module graph/import attributes. The entry's DOM bootstrap reports the expected caught `window is not defined` when run under Node; this test does not claim to validate nginx MIME behavior. The browser HTTP smoke is the separate nginx/bootstrap check.

Final verification commands/results (test and build commands ran outside sandbox after Vite/esbuild could not read the parent workspace configuration in sandbox):

```powershell
npm test -- tests/remote/nli-presenter-content.test.js tests/remote/nli-presenter-snapshot.test.js tests/remote/nli-presenter-commands.test.js tests/remote/nli-presenter-rail.test.js tests/remote/nli-presenter-browse.test.js tests/remote/nli-presenter-view.test.js tests/remote/nli-staff-scene-integration.test.js tests/remote/nli-timeline-transport.test.js tests/shared/nli-investigation-clock.test.js tests/shared/nli-investigation-visual-state.test.js tests/shared/nli-timeline-beat-duration.test.js tests/shared/nli-nova-story.test.js tests/shared/nli-nova-virtual-membership.test.js tests/map/nli-reveal-presentation.test.js tests/projection/nli-explainer-overlay.test.js tests/remote/nli-presenter-compact-layout.test.js tests/remote/nli-staff-native-entry.test.js
npm run build:frontend
node scripts/verify-nli-presenter-content.mjs --data-root public/processed/layers/nli --manifest frontend/src/remote/nli-presenter-content.json
```

Results: tests PASS (17 files, 345 tests); build PASS (Vite 5.4.21, 262 modules, existing 1,054.10 kB MapLibre chunk warning); verifier FAILs as expected for the release gate, including source ZIP mismatch, 1,310 missing localized records, absent manifest/release identity and artifact hashes/reviews, and missing route override approval. The exact requested Docker Django command was rerun: 76 tests, 75 pass, one pre-existing `unsupported segmentId` vs `narrative has no presentation` assertion mismatch. `git diff --check` PASS. The exact commands are recorded in the ignored Task 8 report.

Exact repository-root Django command and result:

```powershell
docker compose exec -T nur-api python manage.py test backend.tests.test_otef_investigation_clock_api backend.tests.test_otef_narrative_api backend.tests.test_otef_nli_clock_layout_api backend.tests.test_otef_projection_slideshow_api backend.tests.test_otef_escape_overlay_api --verbosity 2
```

Exit 1: 76 tests ran, 75 passed, one pre-existing failure in `test_presentation_open_for_nova_is_400`: actual `unsupported segmentId`, expected `narrative has no presentation`. The assertion was added in `a6888702` (2026-09-15); the current validation response was added in `f5b89d0c` (2026-09-25), before Task 7. No backend code was changed.

No caption/source/override artifacts, route data, manifest, or Django backend code were modified. Source ZIP/runtime route identity mismatch, missing accepted override evidence, and missing localized caption/title records remain hard release gates. Browser screenshots were not saved as workspace files; the viewport rectangles above are direct DOM measurements. Device/browser platform was Chrome extension at DPR 1; actual tablet was unavailable.

## Earlier implementation and test state (historical)

`nli-presenter-content.js` implements exact membership/minute lookup, locale-specific required title and authored time-label validation, coverage reporting, and an asynchronous cache-reference hash gate. The manifest intentionally has no accepted release identity or records until the evidence above is resolved; runtime readiness must remain false. Synthetic unit-test copy is independent of the ignored dataset.

Changed files for Task 1:

- `otef-interactive/frontend/src/remote/nli-presenter-content.js`
- `otef-interactive/frontend/src/remote/nli-presenter-content.json`
- `otef-interactive/scripts/verify-nli-presenter-content.mjs`
- `otef-interactive/tests/remote/nli-presenter-content.test.js`
- `otef-interactive/tests/fixtures/nli-presenter-navigation.json`
- `docs/nli-presenter-timeline-verification.md`

The requested red run failed first because the module did not exist. The next green command and output are recorded in the Task 1 report. The source verification command is:

```powershell
node scripts/verify-nli-presenter-content.mjs --data-root public/processed/layers/nli
```

It exits nonzero while localized coverage and accepted release identity are missing. `--write-fixture` writes only the new minute-only fixture; it does not rewrite source artifacts.
