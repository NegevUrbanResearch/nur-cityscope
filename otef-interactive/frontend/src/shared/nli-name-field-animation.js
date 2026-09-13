export const NAME_FIELD_MOTION = Object.freeze({
  spreadMs: 2200,
  revealMs: 400,
  hideMs: 600,
  focusMs: 350,
  frameMs: 33,
});
const clamp = (value) => Math.max(0, Math.min(1, value));
const product = (a, b) => a === 1 ? b : b === 1 ? a
  : typeof a === 'number' && typeof b === 'number' ? a * b : ['*', a, b];
const blend = (a, b, t) => t >= 1 ? b : t <= 0 ? a
  : ['+', product(a, 1 - t), product(b, t)];
function hash(id) {
  let value = 2166136261;
  for (const character of String(id)) value = Math.imul(value ^ character.codePointAt(0), 16777619);
  return value >>> 0;
}

/** Stable random-looking reveal order, independent of display order and projector. */
export function withNameRevealDelays(geojson) {
  const ids = geojson.features.map((feature) => String(feature.properties.pid));
  ids.sort((a, b) => hash(a) - hash(b) || a.localeCompare(b));
  const delays = new Map(ids.map((id, index) => [
    id, index / Math.max(1, ids.length - 1) * NAME_FIELD_MOTION.spreadMs,
  ]));
  return {
    ...geojson,
    features: geojson.features.map((feature) => ({
      ...feature,
      properties: { ...feature.properties, reveal_delay: delays.get(String(feature.properties.pid)) },
    })),
  };
}

/** One cancellable clock composes reveal, focus and exit; no timer per name. */
export function createNameFieldAnimation({ apply, motionMode = 'full', now = () => performance.now() }) {
  const reduced = motionMode === 'reduced';
  let timer = null;
  let disposed = false;
  let shown = false;
  let revealStart = 0;
  let frozenReveal = null;
  let visibility = 0;
  let fromVisibility = 0;
  let targetVisibility = 0;
  let visibilityStart = 0;
  let focus = 1;
  let fromFocus = 1;
  let focusStart = 0;
  let focusMix = 1;
  let onHidden = null;
  let interruptedFocusTransitions = 0;
  const stop = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const revealAt = (time) => {
    const elapsed = frozenReveal ?? Math.max(0, time - revealStart);
    if (reduced || elapsed >= NAME_FIELD_MOTION.spreadMs + NAME_FIELD_MOTION.revealMs) return 1;
    return [
      'interpolate', ['linear'],
      ['-', elapsed, ['coalesce', ['get', 'reveal_delay'], 0]],
      0, 0, NAME_FIELD_MOTION.revealMs, 1,
    ];
  };
  const tick = () => {
    stop();
    if (disposed) return;
    const time = now();
    const visibilityMix = reduced ? 1 : clamp((time - visibilityStart) / NAME_FIELD_MOTION.hideMs);
    visibility = fromVisibility + (targetVisibility - fromVisibility) * visibilityMix;
    focusMix = reduced ? 1 : clamp((time - focusStart) / NAME_FIELD_MOTION.focusMs);
    if (focusMix === 1) interruptedFocusTransitions = 0;
    const reveal = revealAt(time);
    const alpha = product(reveal, visibility);
    apply({
      baseOpacity: product(alpha, blend(fromFocus, focus, focusMix)),
      selectedOpacity: visibility,
      connectorOpacity: visibility,
    });
    if (targetVisibility === 0 && visibilityMix === 1 && onHidden) {
      const complete = onHidden;
      onHidden = null;
      complete();
      return;
    }
    const revealing = shown && frozenReveal === null &&
      time - revealStart < NAME_FIELD_MOTION.spreadMs + NAME_FIELD_MOTION.revealMs;
    if (!reduced && (visibilityMix < 1 || focusMix < 1 || revealing)) {
      timer = setTimeout(tick, NAME_FIELD_MOTION.frameMs);
    }
  };
  return {
    show({ restart = true } = {}) {
      if (disposed) return;
      onHidden = null;
      if (restart || !shown) {
        revealStart = now();
        visibility = 1;
      } else if (frozenReveal !== null) {
        revealStart = now() - frozenReveal;
      }
      shown = true;
      frozenReveal = null;
      fromVisibility = visibility;
      targetVisibility = 1;
      visibilityStart = now();
      tick();
    },
    setFocus(next) {
      if (disposed || JSON.stringify(next) === JSON.stringify(focus)) return;
      // Bound expression depth when a presenter changes focus repeatedly mid-fade.
      fromFocus = interruptedFocusTransitions >= 3 ? focus : blend(fromFocus, focus, focusMix);
      interruptedFocusTransitions = interruptedFocusTransitions >= 3 ? 0 : interruptedFocusTransitions + 1;
      focus = next;
      focusStart = now();
      tick();
    },
    hide(complete) {
      if (disposed) return;
      frozenReveal = Math.max(0, now() - revealStart);
      fromVisibility = visibility;
      targetVisibility = 0;
      visibilityStart = now();
      onHidden = complete;
      tick();
    },
    dispose() {
      disposed = true;
      onHidden = null;
      stop();
    },
  };
}
