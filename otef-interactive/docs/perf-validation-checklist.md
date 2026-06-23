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
