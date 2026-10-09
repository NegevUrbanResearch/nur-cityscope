import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncInvestigationTimelineToMap, getInvestigationTimelineRenderSnapshot,
  prepareInvestigationTimelineForStyleReload, disposeInvestigationTimelineForMap } from '../../frontend/src/shared/maplibre-investigation-timeline.js';
import { idleNliClock } from '../../frontend/src/shared/nli-investigation-clock.js';
import { HOME_CUE, FOCUS_LAYER_IDS } from '../../frontend/src/remote/nli-staff-script.js';

const maps = [];
afterEach(() => { maps.forEach(disposeInvestigationTimelineForMap); maps.length = 0; vi.useRealTimers(); });
function groups(ids) {
  const result = new Map();
  for (const fullId of ids) {
    const [group, id] = fullId.split('.');
    if (!result.has(group)) result.set(group, { id: group, layers: [] });
    result.get(group).layers.push({ id, enabled: true });
  }
  return [...result.values()];
}
function setup() {
  const map = { getStyle: () => ({ layers: [] }), getLayer: () => null, getSource: () => null,
    getContainer: () => ({ querySelector: () => null }), setPaintProperty() {}, setLayoutProperty() {}, on() {}, off() {} };
  maps.push(map);
  let html = '', writes = 0, nowMs = 0;
  const caption = { hidden: true, setAttribute() {}, get innerHTML() { return html; }, set innerHTML(value) { html = value; writes += 1; } };
  const sync = (clock, ids, narrativeFocus = null, options = {}) => syncInvestigationTimelineToMap(map, clock, groups(ids), {
    captionEl: caption, allowMapCaption: false, nliCaptionMode: 'clock-only', settlementFeatures: [],
    getLayerDataUrl: () => null, now: () => nowMs, monotonicNow: () => nowMs, narrativeFocus, ...options,
  });
  return { map, caption, sync, writes: () => writes, now: value => { nowMs = value; } };
}

describe('committed NLI clock presentation', () => {
  it('reduced motion settles a held flip without showing the incoming scene time', async () => {
    const p = setup();
    await p.sync(idleNliClock(), HOME_CUE.layers);
    await p.sync(idleNliClock(), FOCUS_LAYER_IDS, { id: 'segev' });
    expect(getInvestigationTimelineRenderSnapshot(p.map).motion.active).toBe(true);
    p.now(200);
    await p.sync(idleNliClock({ presentationPendingUntilMs: 15000 }), HOME_CUE.layers, null, { motionMode: 'reduced' });
    expect(getInvestigationTimelineRenderSnapshot(p.map).model.clockLabel).toBe('06:41');
    expect(getInvestigationTimelineRenderSnapshot(p.map).motion).toMatchObject({ toLabel: '06:41', active: false });
  });
  it('keeps the last visible time through groups-before-narrative and commits only the destination', async () => {
    const p = setup();
    await p.sync(idleNliClock(), HOME_CUE.layers);
    await p.sync(idleNliClock({ presentationPendingUntilMs: 15000 }), FOCUS_LAYER_IDS);
    expect(p.caption.hidden).toBe(false);
    expect(getInvestigationTimelineRenderSnapshot(p.map).model.clockLabel).toBe('06:29');
    await p.sync(idleNliClock({ presentationPendingUntilMs: 15000 }), FOCUS_LAYER_IDS, { id: 'segev' });
    expect(getInvestigationTimelineRenderSnapshot(p.map).model.clockLabel).toBe('06:29');
    await p.sync(idleNliClock(), FOCUS_LAYER_IDS, { id: 'segev' });
    expect(getInvestigationTimelineRenderSnapshot(p.map).model.clockLabel).toBe('06:41');
    expect(getInvestigationTimelineRenderSnapshot(p.map).motion).toMatchObject({ fromLabel: '06:29', toLabel: '06:41', active: true });
  });

  it('intentional hiding wins even during a pending scene', async () => {
    const p = setup();
    await p.sync(idleNliClock(), HOME_CUE.layers);
    await p.sync(idleNliClock({ presentationPendingUntilMs: 15000, hiddenDisplays: ['gis'] }), FOCUS_LAYER_IDS);
    expect(p.caption.hidden).toBe(true);
    expect(getInvestigationTimelineRenderSnapshot(p.map).visible).toBe(false);
  });

  it('a failed or abandoned scene expires its hold without another state update', async () => {
    vi.useFakeTimers();
    const p = setup();
    await p.sync(idleNliClock(), HOME_CUE.layers);
    await p.sync(idleNliClock({ presentationPendingUntilMs: 1000 }), FOCUS_LAYER_IDS, { id: 'segev' });
    expect(getInvestigationTimelineRenderSnapshot(p.map).model.clockLabel).toBe('06:29');
    p.now(1001);
    await vi.advanceTimersByTimeAsync(1001);
    expect(getInvestigationTimelineRenderSnapshot(p.map).model.clockLabel).toBe('06:41');
  });

  it('identical idle synchronizations do not replace unchanged clock HTML', async () => {
    const p = setup();
    await p.sync(idleNliClock(), FOCUS_LAYER_IDS, { id: 'segev' });
    const writes = p.writes();
    await p.sync(idleNliClock(), FOCUS_LAYER_IDS, { id: 'segev' });
    expect(p.writes()).toBe(writes);
  });

  it('reschedules the expiry wake if corrected time moved backward', async () => {
    vi.useFakeTimers();
    const p = setup();
    await p.sync(idleNliClock(), HOME_CUE.layers);
    await p.sync(idleNliClock({ presentationPendingUntilMs: 1000 }), FOCUS_LAYER_IDS, { id: 'segev' });
    p.now(500);
    await vi.advanceTimersByTimeAsync(1001);
    expect(getInvestigationTimelineRenderSnapshot(p.map).model.clockLabel).toBe('06:29');
    p.now(1001);
    await vi.advanceTimersByTimeAsync(501);
    expect(getInvestigationTimelineRenderSnapshot(p.map).model.clockLabel).toBe('06:41');
  });

  it('publishes the same hidden state to DOM and projection while a style is unavailable', async () => {
    const p = setup();
    await p.sync(idleNliClock(), FOCUS_LAYER_IDS, { id: 'segev' });
    prepareInvestigationTimelineForStyleReload(p.map);
    await p.sync(idleNliClock(), FOCUS_LAYER_IDS);
    expect(p.caption.hidden).toBe(true);
    expect(getInvestigationTimelineRenderSnapshot(p.map).visible).toBe(false);
  });
});
