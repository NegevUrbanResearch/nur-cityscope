# NLI playback protection — implementation and laboratory acceptance

Date: 2026-09-27. Workspace baseline: `dev` at `38768f8`, with existing remote fixes preserved. Luna implemented the channel/viewer and draw scheduler; Sol reviewed both and approved the final media-event guard. The parent operated the live exhibit browser.

## Change

All NLI presentation videos publish playback activity locally from GIS. Both browser projection outputs limit ordinary whole-surface draw calls to 20/s while any video source is active. Draw requests coalesce and retain the latest state, including a trailing final update. Initial readiness, calibration completion and context restoration can draw immediately. Normal cadence returns outside video playback. Projection motion has fewer visual updates during a video; timeline duration is unchanged.

Protection begins before `play()`, remains active through buffering, and releases on pause/end/error, failed startup, slide departure, close and disposal. Activation ownership prevents delayed media events/promises from changing a newer video's state. Same-origin BroadcastChannel messages use source identity, sequence numbers, late-join queries and active heartbeats; a disappeared source expires after six seconds.

No media assets, narrative clocks, Home layer configuration or calibration values changed. The internal Chromium/D3D cause remains unproven; this implements the reversible mitigation established in the [investigation](2026-09-27-nli-video-playback-investigation.md).

## Automated verification

- 157 tests passed across ten focused frontend suites: channel, viewer, scheduler, browser route, staff presentation, archive controller, Home transition, scene integration, GIS archive window and presentation deployment contract.
- 33 Django presentation-manifest/narrative API tests passed in an isolated test database.
- Production frontend build passed. Vite retained its existing large-chunk warning.
- `git diff --check` passed; Git retained repository attribute/line-ending warnings.
- Scheduler tests exercised 50, 60 and 120 Hz request streams, coalescing, trailing updates, disposal and context restoration. Unit tests also cover rejected/timed-out playback, stale callbacks, page hide/show, multiple publishers and crash expiry.

## Live laboratory acceptance

Tests use the existing staff remote, GIS and both calibration-launched browser outputs at `http://localhost`, on the existing Chrome profile. Calibration reports both outputs fullscreen active. A native Windows screenshot confirms a fullscreen output without tabs/address bar; Chrome's debugging notification occupies the top 56 pixels. Canvas backing dimensions are 1920 × 1080; automation reports 1920 × 1024 viewport dimensions. See the investigation for the measured 50/60 Hz laboratory display topology and limitations of the automation fullscreen field. This is the same automated fullscreen setup used to reproduce the original failure; a final operator pass without the debugging notification remains part of commissioning.

Read-only observations record media time, ready/paused/ended state, remote controls and each output canvas's protection attribute. Screenshots confirm the presentation is visible and the projection still renders its scene while protected. This verifies application playback, not an acoustic measurement of the room speakers or a GPU frame-presentation trace.

| Clip | Duration | Initial 30/s laboratory result |
|---|---:|---|
| Segev, slide 2 | 64.8 s | Completed; protection released at end. |
| Mor Levi, slide 10 | 46.24 s | Completed; protection released at end. |
| Sderot, slide 18 | 78.08 s | Completed at the initial 30/s setting; protection released at end. |
| Shura, slide 23 | 40.207 s | Completed; protection released at end. |
| Shura, slide 24 | 16.36 s | Completed; protection released at end. |

The final small media-event guard was loaded after the initial Segev/Mor/Shura runs. A subsequent Shura repeat froze at 10.142362 seconds with readyState 2 and protection active on both outputs. Temporary DOM diagnostics then measured 28 successful compositor calls in the preceding second on each output. Reducing the configured limit to 24/s yielded measured counts of 22–23/s but did not recover that already-stalled player. These results rejected 30/s as a sufficiently reliable setting; they did not establish an exact graphics-driver cause.

The protected limit was changed to 20/s at 14:52:33 UTC. The user reopened both projection windows at 14:57:03 UTC and independently reported that Shura, Mor and the other videos worked without freezing. Those newly opened windows are consistent with loading the 20/s version; no runtime target-rate field independently confirms the loaded setting. The user did not state whether every clip was watched to completion. This is user-reported acceptance of the lower limit, separate from the earlier automated full-duration tests. After the report, the parent made only read-only browser checks and left the remote on Home, with protection inactive on both outputs.

The temporary draw counter is removed from the final implementation. Pause/end, slide/scene exit, stale source expiry and late-join behavior have automated coverage. The output-reopen test confirmed that both new outputs acquired active protection while the same GIS video remained open; it did not recover the already-stalled decoder at the 30/s or 24/s settings. A dedicated final-20/s rapid-exit/reopen playback cycle was not completed after the user took over testing.

## Deployment and known limits

The [commissioning checklist](../../otef-interactive/docs/nli-video-playback-commissioning.md) covers reassigned projectors, canonical origin/profile, fullscreen launch, all five videos and recovery checks. The NLI hardware results remain pending; laboratory acceptance cannot certify a different display topology or physical speaker routing.

A separate existing recovery gap was reproduced by reloading GIS during a Home transition: the remote retains the old GIS responder identity, so its Close acknowledgement cannot arrive. Reloading the remote clears that stale session. This was reviewed separately and is not caused by video scheduling. Technicians should reload the remote after reloading GIS; do not reload GIS during an active presentation/Home transition.

## Scope and module growth

The channel is a separate 195-line module and the scheduler a separate 85-line module. Integration adds 6 lines to map entry, 10/removes 4 in projection entry, 27/removes 4 in browser route, and 51/removes 9 in the viewer. The related remote fixes cover archive-button spacing, archive open/close results and presentation responder tracking.
