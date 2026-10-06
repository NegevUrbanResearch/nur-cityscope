// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createProjectionMatchCursor, readProjectionMatchLaunch, bindProjectionMatchCursor } from '../../frontend/src/projection/projection-match-cursor.js';
import { isProjectionMatchCommand, isProjectionMatchAck, MAX_CURSOR_HZ, CURSOR_RENEW_MS, CURSOR_EXPIRY_MS } from '../../frontend/src/shared/projection-match-protocol.js';

const OUTPUT = '11111111-1111-4111-8111-111111111111';
const SOURCE = '22222222-2222-4222-8222-222222222222';
const SESSION = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
function command(overrides = {}) {
  return { type: 'otef_projection_match_cursor', table: 'otef', output: 'left', instanceId: OUTPUT,
    sourceId: SOURCE, sessionId: SESSION, sequence: 1, revision: 12, sourceFrameIdentity: 'frame',
    mode: 'cursor', pointId: 1, targetPx: [410, 295], sourcePx: [390, 310], ...overrides };
}
function ack(overrides = {}) {
  return { type: 'otef_projection_match_ack', table: 'otef', output: 'left', instanceId: OUTPUT,
    sourceId: SOURCE, sessionId: SESSION, sequence: 1, revision: 12, sourceFrameIdentity: 'frame',
    displaySide: 'left', reversed: false, success: true, error: null, ...overrides };
}
function harness(contextOverrides = {}) {
  const queue = [], sent = [];
  const host = document.createElement('main');
  host.innerHTML = '<div class="projection-browser-surface" style="z-index:2000"></div>';
  document.body.replaceChildren(host);
  const context = { revision: 12, configIdentity: 'config', sourceFrameIdentity: 'frame', stable: true,
    route: 'browser', displaySide: 'left', reversed: false, ...contextOverrides };
  const cursor = createProjectionMatchCursor({ document, host, output: 'left', instanceId: OUTPUT,
    readContext: () => context, sendAck: message => sent.push(message),
    requestFrame: fn => { queue.push(fn); return queue.length; }, cancelFrame: vi.fn(), clock: globalThis });
  return { cursor, context, host, sent, frame: () => queue.shift()?.(), paint() { this.frame(); this.frame(); } };
}
beforeEach(() => { vi.useFakeTimers(); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); });
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

describe('strict match protocol', () => {
  test('exports shared scheduling bounds and accepts the exact contracts', () => {
    expect([MAX_CURSOR_HZ, CURSOR_RENEW_MS, CURSOR_EXPIRY_MS]).toEqual([20, 1000, 3000]);
    expect(isProjectionMatchCommand(command())).toBe(true);
    expect(isProjectionMatchAck(ack())).toBe(true);
    for (const mode of ['probe', 'off']) expect(isProjectionMatchCommand(command({ mode, pointId: 0, targetPx: null, sourcePx: null }))).toBe(true);
  });
  test.each([{ extra: true }, { sequence: true }, { revision: Infinity }, { sequence: -1 },
    { sequence: Number.MAX_SAFE_INTEGER + 1 }, { sourceId: 'invalid' }, { sessionId: [] }, { instanceId: '' },
    { output: [] }, { table: 'nli' }, { sourceFrameIdentity: 'x'.repeat(4097) }, { sourceFrameIdentity: '' },
    { targetPx: [NaN, 1] }, { targetPx: [1, Infinity] }, { targetPx: [-1, 1] }, { targetPx: [1, 1081] },
    { sourcePx: [1921, 2] }, { targetPx: [1, 2, 3] }, { pointId: 0 }, { pointId: true }, { mode: 'probe' }])('rejects command %j', change => {
    expect(isProjectionMatchCommand(command(change))).toBe(false);
  });
  test.each([{ extra: true }, { sequence: false }, { revision: -1 }, { instanceId: 'invalid' },
    { displaySide: 'both' }, { reversed: 1 }, { success: 1 }, { error: 'error' },
    { success: false, error: null }, { success: false, error: 'x'.repeat(241) }])('rejects acknowledgement %j', change => {
    expect(isProjectionMatchAck(ack(change))).toBe(false);
  });
});

describe('final output cursor', () => {
  test('a drawn source reload rejects that local session even when portable identity is unchanged', () => {
    const h = harness(); h.cursor.receive(command()); h.paint();
    h.cursor.invalidateSource('Drawn model image reloaded; restart point capture.');
    expect(h.sent.at(-1)).toMatchObject({success:false,error:expect.stringMatching(/reloaded/)});
    expect(h.host.querySelector('.projection-match-cursor')).toBeNull();
    h.cursor.receive(command({sequence:2})); h.paint(); expect(h.sent.at(-1).success).toBe(false);
    h.cursor.receive(command({sessionId:OTHER,sequence:1})); h.paint(); expect(h.sent.at(-1).success).toBe(true); h.cursor.dispose();
  });
  test('updates on one frame and acknowledges only after the next paint opportunity', () => {
    const h = harness(); h.cursor.receive(command()); expect(h.sent).toEqual([]);
    h.frame(); expect(h.sent).toEqual([]);
    const overlay = h.host.querySelector('svg');
    expect(overlay.getAttribute('viewBox')).toBe('0 0 1920 1080');
    expect(overlay.parentElement).toBe(h.host);
    expect(overlay.style.pointerEvents).toBe('none');
    expect(Number(overlay.style.zIndex)).toBeGreaterThan(Number(h.host.querySelector('.projection-browser-surface').style.zIndex));
    expect(overlay.querySelector('[data-match-target]').getAttribute('transform')).toBe('translate(410 295)');
    expect(overlay.querySelector('text').textContent).toBe('1');
    h.frame(); expect(h.sent).toEqual([ack()]); h.cursor.dispose();
  });
  test('ignores different instances, logical outputs and protocol extras', () => {
    const h = harness();
    for (const change of [{ instanceId: OTHER }, { output: 'right' }, { extra: 1 }]) h.cursor.receive(command(change));
    h.paint(); expect(h.sent).toEqual([]); expect(h.host.querySelector('svg')).toBeNull(); h.cursor.dispose();
  });
  test('rejects stale sequence and competing sender/session; duplicate only renews expiry', () => {
    const h = harness(); h.cursor.receive(command({ sequence: 2 })); h.paint();
    for (const change of [{ sequence: 1 }, { sequence: 2 }, { sequence: 3, sessionId: OTHER }, { sequence: 3, sourceId: OTHER }]) h.cursor.receive(command(change));
    h.paint(); expect(h.sent).toHaveLength(1); h.cursor.dispose();
  });
  test('superseding a command between frames prevents the earlier success', () => {
    const h = harness(); h.cursor.receive(command()); h.frame();
    h.cursor.receive(command({ sequence: 2, targetPx: [700, 500] }));
    h.frame(); expect(h.sent).toEqual([]); h.paint();
    expect(h.sent).toEqual([ack({ sequence: 2 })]); h.cursor.dispose();
  });
  test.each([{ revision: 13 }, { sourceFrameIdentity: 'changed' }, { stable: false }, { route: 'td' }])('rejects mismatched context %j and removes owned overlay', change => {
    const h = harness(); h.cursor.receive(command()); h.paint(); Object.assign(h.context, change);
    h.cursor.receive(command({ sequence: 2 })); expect(h.host.querySelector('svg')).toBeNull();
    expect(h.sent.at(-1)).toMatchObject({ sequence: 2, success: false }); h.cursor.dispose();
  });
  test.each(['revision', 'configIdentity', 'sourceFrameIdentity', 'route', 'stable', 'displaySide', 'reversed'])('rechecks %s between frames', key => {
    const h = harness(); h.cursor.receive(command()); h.frame();
    h.context[key] = typeof h.context[key] === 'boolean' ? !h.context[key] : `${h.context[key]} changed`;
    h.frame(); expect(h.sent.some(item => item.success)).toBe(false);
    expect(h.host.querySelector('svg')).toBeNull(); h.cursor.dispose();
  });
  test('cleans up on visibility change, clear/disconnect and disposal, including queued callbacks', () => {
    for (const action of ['hide', 'clear', 'dispose']) {
      const h = harness(); h.cursor.receive(command()); h.frame();
      if (action === 'hide') { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }
      else h.cursor[action]();
      h.paint(); expect(h.sent.some(item => item.success)).toBe(false); expect(h.host.querySelector('svg')).toBeNull();
      h.cursor.dispose(); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    }
  });
  test('expires after 3000 ms without renewal and permits a new sender', () => {
    const h = harness(); h.cursor.receive(command()); h.paint(); vi.advanceTimersByTime(2500);
    h.cursor.receive(command()); vi.advanceTimersByTime(2999); expect(h.host.querySelector('svg')).not.toBeNull();
    vi.advanceTimersByTime(1); expect(h.host.querySelector('svg')).toBeNull();
    h.cursor.receive(command({ sessionId: OTHER })); h.paint(); expect(h.sent.at(-1)).toMatchObject({ sessionId: OTHER, success: true }); h.cursor.dispose();
  });
  test('off clears its own session after geometry changes; another session cannot clear it', () => {
    const h = harness(); h.cursor.receive(command()); h.paint(); h.context.revision = 99;
    const off = command({ mode: 'off', pointId: 0, targetPx: null, sourcePx: null, sequence: 2 });
    h.cursor.receive({ ...off, sessionId: OTHER }); expect(h.host.querySelector('svg')).not.toBeNull();
    h.cursor.receive(off); expect(h.host.querySelector('svg')).toBeNull(); h.paint();
    expect(h.sent.filter(item => item.sequence === 2 && item.success)).toHaveLength(0); h.cursor.dispose();
  });
  test('probe reports actual physical side/reversal without drawing a marker', () => {
    const h = harness({ displaySide: 'right', reversed: true });
    h.cursor.receive(command({ mode: 'probe', pointId: 0, targetPx: null, sourcePx: null })); h.paint();
    expect(h.sent).toEqual([ack({ displaySide: 'right', reversed: true })]); expect(h.host.querySelector('svg')).toBeNull(); h.cursor.dispose();
  });
  test('marker remains in final reference pixels when the compositor warp changes', () => {
    const h = harness(); h.cursor.receive(command()); h.paint();
    const marker = h.host.querySelector('[data-match-target]');
    h.host.querySelector('.projection-browser-surface').style.transform = 'matrix(2,0,0,2,90,20)';
    expect(marker.getAttribute('transform')).toBe('translate(410 295)'); h.cursor.dispose();
  });
  test('contextChanged clears stale overlays immediately', () => {
    const h = harness(); h.cursor.receive(command()); h.paint(); h.context.configIdentity = 'new';
    h.cursor.contextChanged(); expect(h.host.querySelector('svg')).toBeNull(); h.cursor.dispose();
  });
  test('a delayed command from a cleared session cannot revive its old target', () => {
    const h = harness(); h.cursor.receive(command()); h.paint(); h.cursor.clear();
    h.cursor.receive(command()); h.paint(); expect(h.host.querySelector('svg')).toBeNull(); expect(h.sent).toHaveLength(1);
    h.cursor.receive(command({ sequence: 2 })); h.paint(); expect(h.sent.at(-1)).toMatchObject({ sequence: 2 }); h.cursor.dispose();
  });
  test('off retires its sequence so older delayed movement stays cleared', () => {
    const h = harness(); h.cursor.receive(command()); h.paint();
    h.cursor.receive(command({ sequence: 3, mode: 'off', pointId: 0, targetPx: null, sourcePx: null }));
    h.cursor.receive(command({ sequence: 2 })); h.paint(); expect(h.host.querySelector('svg')).toBeNull(); h.cursor.dispose();
  });
  test('off after clear retires its known session before delayed movement arrives', () => {
    const h = harness(); h.cursor.receive(command()); h.paint(); h.cursor.clear();
    h.cursor.receive(command({ sequence: 3, mode: 'off', pointId: 0, targetPx: null, sourcePx: null }));
    h.cursor.receive(command({ sequence: 2 })); h.paint();
    expect(h.host.querySelector('svg')).toBeNull(); expect(h.sent.map(item => item.sequence)).toEqual([1]); h.cursor.dispose();
  });
  test('retiring a cleared owner cannot clear another active owner', () => {
    const h = harness(); h.cursor.receive(command()); h.paint(); h.cursor.clear();
    h.cursor.receive(command({ sessionId: OTHER, targetPx: [700, 500] })); h.paint();
    h.cursor.receive(command({ sequence: 3, mode: 'off', pointId: 0, targetPx: null, sourcePx: null }));
    expect(h.host.querySelector('[data-match-target]').getAttribute('transform')).toBe('translate(700 500)');
    h.cursor.clear(); h.cursor.receive(command({ sequence: 2 })); h.paint();
    expect(h.host.querySelector('svg')).toBeNull(); expect(h.sent).toHaveLength(2); h.cursor.dispose();
  });
});

test('launch metadata comes from the open route, including normal windows with saved reverse preference', () => {
  expect(readProjectionMatchLaunch({ spanId: 'left', search: '?reverse=1' })).toEqual({ displaySide: 'left', reversed: false });
  expect(readProjectionMatchLaunch({ spanId: 'right', search: '?matchDisplaySide=left&matchReversed=1' })).toEqual({ displaySide: 'left', reversed: true });
  expect(readProjectionMatchLaunch({ spanId: 'left', search: '?matchDisplaySide=left&matchReversed=1' })).toBeNull();
  expect(readProjectionMatchLaunch({ spanId: 'left', search: '?matchDisplaySide=right' })).toBeNull();
});

test('live binding combines completed geometry with injected source readiness and cleans socket handlers', () => {
  const listeners = new Map(), sent = [], queue = [];
  const socket = { on: (name, fn) => listeners.set(name, fn), off: name => listeners.delete(name), send: message => sent.push(message) };
  const host = document.createElement('main'); document.body.replaceChildren(host);
  const geometry = { revision: 12, configIdentity: 'config', pending: false, failed: false, suspended: false, stopped: false };
  let source = null;
  const binding = bindProjectionMatchCursor({ document, host, output: 'left', instanceId: OUTPUT, socket,
    runtime: { getAppliedGeometryState: () => geometry }, launch: { displaySide: 'left', reversed: false },
    readSourceContext: () => source, requestFrame: fn => { queue.push(fn); return queue.length; }, cancelFrame: vi.fn(), clock: globalThis });
  listeners.get('otef_projection_match_cursor')(command()); expect(sent.at(-1).success).toBe(false);
  source = { sourceFrameIdentity: 'frame', stable: true };
  listeners.get('otef_projection_match_cursor')(command({ sequence: 2 })); queue.shift()(); queue.shift()();
  expect(sent.at(-1)).toEqual(ack({ sequence: 2 })); expect(listeners.has('otef_projection_match_ack')).toBe(true);
  geometry.pending = true; binding.contextChanged(); expect(host.querySelector('svg')).toBeNull();
  geometry.pending = false; listeners.get('otef_projection_match_cursor')(command({ sequence: 3 })); queue.shift()();
  listeners.get('disconnect')(); queue.shift()(); expect(sent.filter(item => item.success)).toHaveLength(1);
  binding.dispose(); expect(listeners.size).toBe(0);
});
