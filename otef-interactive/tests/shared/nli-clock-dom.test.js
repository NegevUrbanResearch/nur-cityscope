// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createNliClockDomRenderer } from '../../frontend/src/shared/nli-clock-dom.js';
import { renderNliClockCaption } from '../../frontend/src/shared/nli-clock-presentation.js';

function setup() {
  const caption = document.createElement('div');
  document.body.append(caption);
  return { caption, renderer: createNliClockDomRenderer(caption) };
}

describe('NLI clock DOM rendering', () => {
  it('remounts its clock if a full explainer replaced the same caption host', () => {
    const caption = document.createElement('div');
    const state = { captionEl: caption, nliCaptionMode: 'clock-only', clockPhase: 'idle',
      monotonicNow: () => 0, motionMode: 'reduced' };
    renderNliClockCaption(state, { clockLabel: '06:29', rows: [] });
    state.nliCaptionMode = 'full';
    renderNliClockCaption(state, { clockLabel: '06:41', rows: [] });
    state.nliCaptionMode = 'clock-only';
    renderNliClockCaption(state, { clockLabel: '08:03', rows: [] });
    expect(caption.firstElementChild.getAttribute('aria-label')).toBe('08:03');
  });
  it('keeps digits mounted and the colon still while only changed halves rotate', () => {
    const { caption, renderer } = setup();
    renderer.render({ fromLabel: '06:29', toLabel: '06:29', progress: 1, active: false });
    const root = caption.firstElementChild;
    const first = root.children[0];
    const colon = root.children[2].firstElementChild;
    renderer.render({ fromLabel: '06:29', toLabel: '06:41', progress: .25, active: true });
    expect(caption.firstElementChild).toBe(root);
    expect(root.children[0]).toBe(first);
    expect(root.children[2].firstElementChild).toBe(colon);
    expect(root.getAttribute('aria-label')).toBe('06:41');
    const halves = root.children[3].querySelectorAll('.nli-clock-half');
    expect(halves).toHaveLength(2);
    expect(halves[0].style.transform).toBe('scaleY(1)');
    expect(halves[1].style.transform).not.toBe('scaleY(1)');
    expect(halves[0].textContent).toBe('2');
    renderer.render({ fromLabel: '06:29', toLabel: '06:41', progress: .75, active: true });
    expect(root.children[3].querySelector('.nli-clock-half').textContent).toBe('4');
    renderer.render({ fromLabel: '06:41', toLabel: '06:41', progress: 1, active: false });
    expect(root.children[3].textContent).toBe('4');
    expect(root.querySelectorAll('.nli-clock-half')).toHaveLength(0);
    caption.remove();
  });
});
