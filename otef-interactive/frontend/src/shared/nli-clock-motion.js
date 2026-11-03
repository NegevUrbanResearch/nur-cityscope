const DURATION_MS = 420;
const clamp = (value) => Math.max(0, Math.min(1, value));
const ease = (value) => value * value * (3 - 2 * value);

/** Opacity of a rotating glyph half; its edge-on streak is never painted. */
export function nliClockHalfOpacity(scale) {
  return ease(clamp((scale - .18) / .2));
}

/** Local presentation only: authored event times and playback stay unchanged. */
export function createNliClockMotion() {
  let label = '';
  let transition = null;
  let pending = null;

  function sample(nowMs) {
    while (transition && nowMs >= transition.startMs + DURATION_MS) {
      label = transition.toLabel;
      const nextStart = transition.startMs + DURATION_MS;
      transition = pending && pending !== label
        ? { fromLabel: label, toLabel: pending, startMs: nextStart }
        : null;
      pending = null;
    }
    if (!transition) return { fromLabel: label, toLabel: label, progress: 1, active: false };
    return {
      fromLabel: transition.fromLabel,
      toLabel: transition.toLabel,
      progress: ease(clamp((nowMs - transition.startMs) / DURATION_MS)),
      active: true,
    };
  }

  function setTarget(nextLabel, nowMs, { visible = true, motionMode = 'full' } = {}) {
    sample(nowMs);
    if (!visible || !label || motionMode === 'reduced') {
      label = visible ? nextLabel : '';
      transition = null;
      pending = null;
    } else if (transition) {
      pending = nextLabel === transition.toLabel ? null : nextLabel;
    } else if (nextLabel !== label) {
      transition = { fromLabel: label, toLabel: nextLabel, startMs: nowMs };
    }
  }
  return { setTarget, sample };
}
