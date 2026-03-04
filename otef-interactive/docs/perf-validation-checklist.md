# Performance Validation Checklist

## Baseline Capture
- Record baseline metrics from the current deployment before migration rollout.
- Capture p95 applyViewportMs, p95 zoomApplyMs, p95 panApplyMs, and p95 syncDriftPx.
- Capture heavy layer time-to-visible for representative layers.
- Capture desync duration across map/projection/remote interactions.
- Record qualitative notes for Zoom feel.

## Post-Change Capture
- Repeat all baseline probes in the migrated frontend build.
- Compare p95 applyViewportMs, p95 zoomApplyMs, p95 panApplyMs, and p95 syncDriftPx against baseline.
- Re-check heavy layer time-to-visible and desync duration.
- Re-evaluate Zoom feel under sustained pan/zoom input.

## Pass Criteria
- At least 25% improvement in p95 applyViewportMs in stressed scenarios.
- p95 zoomApplyMs and p95 panApplyMs remain stable or improve.
- Drift target: p95 syncDriftPx remains within acceptable visual tolerance.
- No regression in heavy layer time-to-visible.
- No regression in desync duration.
