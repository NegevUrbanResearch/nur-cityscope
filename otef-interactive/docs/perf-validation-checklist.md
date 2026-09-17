# Performance Validation Checklist

## Baseline Capture
- Record baseline metrics from the current deployment before migration rollout.
- Capture p95 applyViewportMs, p95 zoomApplyMs, p95 panApplyMs, and p95 syncDriftPx.
- Capture heavy layer time-to-visible for representative layers.
- Capture heavy layer time-to-visible for greens/<rivers Hebrew layer id>, greens/<floodplains Hebrew layer id>, and muniplicity_transport/<bike paths Hebrew layer id>.
- Capture MapLibre source add/remove count and MapLibre layer add/remove count during one manual heavy-pack toggle.
- Capture source churn per slideshow tick during one full projection slideshow cycle.
- Capture slideshow loaded source count after warmup and after N slideshow ticks.
- Capture desync duration across map/projection/remote interactions.
- Record qualitative notes for Zoom feel.

## Post-Change Capture
- Repeat all baseline probes in the migrated frontend build.
- Compare p95 applyViewportMs, p95 zoomApplyMs, p95 panApplyMs, and p95 syncDriftPx against baseline.
- Re-check heavy layer time-to-visible and desync duration.
- Re-check MapLibre source add/remove count and MapLibre layer add/remove count during the same heavy-pack toggle.
- Re-check source churn per slideshow tick and slideshow loaded source count using the same pack order and tick count.
- Re-evaluate Zoom feel under sustained pan/zoom input.

## Pass Criteria
- At least 25% improvement in p95 applyViewportMs in stressed scenarios.
- p95 zoomApplyMs and p95 panApplyMs remain stable or improve.
- Drift target: p95 syncDriftPx remains within acceptable visual tolerance.
- No regression in heavy layer time-to-visible.
- After warmup, projection slideshow ticks do not re-add the same retained PMTiles source.
- Source churn per slideshow tick is limited to newly needed packs plus bounded retention eviction.
- Slideshow loaded source count remains bounded by the configured retention limit plus the active pack and non-vector overlays.
- No regression in desync duration.

## NLI investigation scheduler

Serve the normal exhibit through nginx at `http://localhost:80`; do not use a
Vite-only page or a direct filesystem URL for this gate. Run the following
procedure separately for GIS and projection:

1. Open the densest completed general view and wait for warm-up.
2. In the browser console run `MapPerfTelemetry.reset()`.
3. Hold that view until at least 1,000 `nliSchedulerMs` samples have been
   recorded.
4. Record `MapPerfTelemetry.summary().nliSchedulerMs` and require p95 `<=8
   ms` on GIS and projection.
5. Capture effective FPS from the same Chrome DevTools Performance trace used
   for the scheduler samples. Do not combine an FPS result from another run.
6. In the automated fake-map tick, clear `setPaintProperty`, advance one due
   66 ms tick, and require no more than `2 * processedFillLayerIds.length`
   writes without a Nova transition. Every write must target a processed fill
   color or opacity property.

The acceptance record must show zero steady-state `GeoJSONSource.setData`,
source/layer/filter/geometry rebuild, orphaned frame, phase drift,
viewport-regression, or slideshow-regression events. A general **Stop** /
`idle` state may retain exactly one existing shared per-map RAF only while a
visible full-motion approved ambient consumer exists: completed polygon
conveyor, completed route flow, idle alarm, or existing person glow where
applicable. Reduced motion, layer disable, no eligible feature or data,
style/page disposal, and teardown must leave no frame attributable to polygon
motion and no orphaned RAF.

Test 33 ms cadence only if the 66 ms footage visibly steps and all limits
above already pass. Record both cadence and effective FPS in the polygon
gradient lab evidence table in `nli-exhibit-verification.md`.

Confirm steady completed-route flow does not call full-source `setData()`, scan
the full style, or repeatedly call `moveLayer()`. Confirm reduced motion keeps
a stationary directional pattern and does not schedule continuous completed-
route flow. Keep browser-console MapLibre expression errors at zero, and
confirm GIS and projection use the same clock, phase, and entry values; only
the existing profile scale and Nova dimming may differ.

Record GIS and projection results in `nli-exhibit-verification.md`. Physical
lab acceptance is not implied by this checklist: hardware colleague review
and the 1,000-sample measurement are pending until they are recorded on the
actual displays.
