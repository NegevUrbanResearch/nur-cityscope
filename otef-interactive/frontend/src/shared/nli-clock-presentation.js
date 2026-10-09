import { createNliClockMotion } from './nli-clock-motion.js';
import { createNliClockDomRenderer } from './nli-clock-dom.js';
import { nliExplainerInnerHtml, NLI_CAPTION_MODE_CLOCK_ONLY } from './nli-explainer-model.js';

export function nliClockPresentationPending(state) {
  return state.clockPresentationDeadline > state.now();
}

/** Wake an idle display too if the staff client disappears during a cue. */
export function syncNliClockPresentationPending(state, clock, retry) {
  const deadline = Number(clock.presentationPendingUntilMs) || 0;
  state.clockPresentationRetry = retry;
  if (deadline === state.clockPresentationDeadline && state.clockPresentationTimer != null && deadline > state.now()) return;
  clearTimeout(state.clockPresentationTimer);
  state.clockPresentationDeadline = deadline;
  state.clockPresentationTimer = null;
  if (deadline > state.now()) {
    state.clockPresentationTimer = setTimeout(() => {
      state.clockPresentationTimer = null;
      state.clockPresentationRetry?.();
    }, deadline - state.now() + 1);
  }
}

function presentationFor(state) {
  if (!state.clockPresentation) state.clockPresentation = { motion: createNliClockMotion(), rafId: null, element: null, renderer: null };
  return state.clockPresentation;
}

function cancelMotionFrame(state) {
  const presentation = state.clockPresentation;
  if (presentation?.rafId != null) state.cancelAnimationFrame?.(presentation.rafId);
  if (presentation) presentation.rafId = null;
}

function paintClockFrame(state) {
  const presentation = presentationFor(state);
  if (!state.captionRenderSnapshot?.visible) return;
  const frame = presentation.motion.sample(state.monotonicNow());
  state.captionRenderSnapshot.motion = frame;
  presentation.renderer?.render(frame);
  state.rendererDeps?.onClockPresentationFrame?.();
  if (frame.active && presentation.rafId == null && state.requestAnimationFrame) {
    presentation.rafId = state.requestAnimationFrame(() => {
      presentation.rafId = null;
      paintClockFrame(state);
    });
  }
}

export function settleNliClockReducedMotion(state) {
  if (state.motionMode !== 'reduced' || !state.captionRenderSnapshot?.visible || !state.clockPresentation) return;
  cancelMotionFrame(state);
  state.clockPresentation.motion.setTarget(state.captionRenderSnapshot.model.clockLabel, state.monotonicNow(), { motionMode: 'reduced' });
  paintClockFrame(state);
}

/** Time, visibility, and animation pose are published together to projection. */
export function renderNliClockCaption(state, model) {
  const el = state.captionEl;
  if (!el) return;
  el.hidden = false;
  state.captionRenderSnapshot = { model, visible: true, phase: state.clockPhase };
  if (state.nliCaptionMode !== NLI_CAPTION_MODE_CLOCK_ONLY) {
    cancelMotionFrame(state);
    const html = nliExplainerInnerHtml(model);
    if (el.innerHTML !== html) el.innerHTML = html;
    return;
  }
  const presentation = presentationFor(state);
  if (presentation.element !== el || (presentation.renderer && !presentation.renderer.isMounted())) {
    presentation.element = el;
    presentation.renderer = el.ownerDocument?.createElement && el.replaceChildren
      ? createNliClockDomRenderer(el) : null;
  }
  presentation.motion.setTarget(model.clockLabel, state.monotonicNow(), { motionMode: state.motionMode });
  if (!presentation.renderer) {
    const html = nliExplainerInnerHtml(model, { nliCaptionMode: state.nliCaptionMode });
    if (el.innerHTML !== html) el.innerHTML = html;
  }
  paintClockFrame(state);
}

export function hideNliClockCaption(state) {
  cancelMotionFrame(state);
  state.clockPresentation?.motion.setTarget('', state.monotonicNow(), { visible: false });
  if (state.captionEl) {
    state.captionEl.hidden = true;
    // Real digit nodes remain mounted; DOM-shaped adapters still clear their HTML.
    if (!state.clockPresentation?.renderer && state.captionEl.innerHTML) state.captionEl.innerHTML = '';
  }
  state.captionRenderSnapshot = { model: null, visible: false, phase: state.clockPhase };
  state.rendererDeps?.onClockPresentationFrame?.();
}

export function disposeNliClockPresentation(state) {
  cancelMotionFrame(state);
  clearTimeout(state.clockPresentationTimer);
  state.clockPresentationRetry = null;
  state.clockPresentation = null;
}
