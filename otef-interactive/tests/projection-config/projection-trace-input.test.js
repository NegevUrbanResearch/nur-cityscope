// @vitest-environment jsdom
import { expect, test, vi } from 'vitest';
import { bindProjectionTraceInput, recordProjectionTrace } from '../../frontend/src/projection-config/projection-trace-input.js';
import { bindWarpPointerInput } from '../../frontend/src/projection-config/warp-pointer-input.js';
import { createWarpEditor } from '../../frontend/src/projection-config/warp-editor.js';
import { DEFAULT_PROJECTION_CONFIG } from '../../frontend/src/shared/projection-config-schema.js';

function event(target, type, fields = {}) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { pointerId: 7, pointerType: 'touch', isPrimary: true, buttons: 1, button: 0, clientX: 240, clientY: 135, ...fields });
  target.dispatchEvent(e);
  return e;
}

function surface() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 1920 1080');
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 960, height: 540 });
  svg.setPointerCapture = vi.fn(); svg.releasePointerCapture = vi.fn(); svg.hasPointerCapture = () => false;
  document.body.append(svg);
  return svg;
}

test('trace listeners record touch and capture without changing default or capture, then detach', () => {
  const svg = surface(); const trace = { enabled: true, record: vi.fn() };
  const dispose = bindProjectionTraceInput({ surface: svg, surfaceName: 'warp', trace,
    readGeometry: () => ({ mode: 'grid', side: 'left', selection: { kind: 'point', index: 2, indices: [2] }, viewBox: { x: 0, y: 0, width: 1920, height: 1080 } }) });
  expect(event(svg, 'pointerdown').defaultPrevented).toBe(false);
  event(svg, 'gotpointercapture'); event(svg, 'pointercancel');
  expect(trace.record.mock.calls.some(([kind, d]) => kind === 'pointer' && d.pointerType === 'touch' && d.rectWidth === 960 && d.viewWidth === 1920 && d.indices[0] === 2)).toBe(true);
  expect(trace.record.mock.calls.some(([kind, d]) => kind === 'capture' && d.phase === 'gotpointercapture')).toBe(true);
  expect(svg.setPointerCapture).not.toHaveBeenCalled();
  dispose(); const count = trace.record.mock.calls.length; event(svg, 'pointerdown');
  expect(trace.record).toHaveBeenCalledTimes(count); svg.remove();
});

test('disabled tracing does not read geometry or install listeners', () => {
  const svg = surface(); const trace = { enabled: false, record: vi.fn() }; const readGeometry = vi.fn();
  const dispose = bindProjectionTraceInput({ surface: svg, surfaceName: 'graph', trace, readGeometry });
  event(svg, 'pointerdown'); expect(readGeometry).not.toHaveBeenCalled(); expect(trace.record).not.toHaveBeenCalled(); dispose(); svg.remove();
});

test('graph header events use the actual rendered header role without recording text', () => {
  const graph = document.createElement('div'); graph.innerHTML = '<article class="config-node"><h3>Private arbitrary title</h3></article>';
  graph.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 500 }); document.body.append(graph);
  const trace = { enabled: true, record: vi.fn() }; const dispose = bindProjectionTraceInput({ surface: graph, surfaceName: 'graph', trace });
  event(graph.querySelector('h3'), 'pointerdown');
  expect(trace.record.mock.calls).toContainEqual(['pointer', expect.objectContaining({ role: 'node_header' })]);
  expect(JSON.stringify(trace.record.mock.calls)).not.toContain('Private'); dispose(); graph.remove();
});

test('failed diagnostics cannot interrupt existing touch drag behavior', () => {
  const svg = surface(); const trace = { enabled: true, record() { throw new Error('diagnostic failed'); } };
  const onStart = vi.fn(), onMove = vi.fn(), onEnd = vi.fn();
  const binder = bindWarpPointerInput({ surface: svg, trace, readGeometry: () => ({ rect: svg.getBoundingClientRect(), viewBox: { x: 0, y: 0, width: 1920, height: 1080 }, handles: [{ x: .25, y: .25 }], side: 'left', mode: 'grid', selection: { indices: [0] } }), onStart, onMove, onEnd, onCancel: vi.fn(), onSelect: vi.fn() });
  expect(() => recordProjectionTrace(trace, 'gesture', { phase: 'start' })).not.toThrow();
  event(svg, 'pointerdown'); event(svg, 'pointermove', { clientX: 245 }); event(svg, 'pointerup', { clientX: 245 });
  expect(onStart).toHaveBeenCalledOnce(); expect(onMove).toHaveBeenCalledOnce(); expect(onEnd).toHaveBeenCalledOnce(); binder.dispose(); svg.remove();
});

test('explicit capture failure and cancellation reasons are distinguishable', () => {
  const svg = surface(); const trace = { enabled: true, record: vi.fn() }; const onCancel = vi.fn();
  const binder = bindWarpPointerInput({ surface: svg, trace, readGeometry: () => ({ rect: svg.getBoundingClientRect(), viewBox: { x: 0, y: 0, width: 1920, height: 1080 }, handles: [{ x: .25, y: .25 }], side: 'left', mode: 'grid', selection: { indices: [0] } }), onStart: vi.fn(), onMove: vi.fn(), onEnd: vi.fn(), onCancel, onSelect: vi.fn() });
  svg.setPointerCapture.mockImplementationOnce(() => { throw new Error('secret error message'); });
  event(svg, 'pointerdown');
  expect(trace.record.mock.calls).toContainEqual(['capture', expect.objectContaining({ accepted: false, reason: 'capture_failed' })]);
  event(svg, 'pointerdown'); event(svg, 'pointercancel');
  expect(trace.record.mock.calls).toContainEqual(['gesture', expect.objectContaining({ phase: 'cancel', reason: 'pointercancel' })]);
  expect(onCancel).toHaveBeenCalledOnce(); expect(JSON.stringify(trace.record.mock.calls)).not.toContain('secret error'); binder.dispose(); svg.remove();
});

test('geometry diagnostics distinguish accepted motion and unavailable TD baseline', () => {
  const trace = { enabled: true, record: vi.fn() };
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  config.outputs.left.warp.baseline = { type: 'identity', width: 1920, height: 1080, origin: 'top-left' };
  const editor = createWarpEditor({ config, trace });
  editor.pointerStart({ x: 0, y: 0 });
  expect(editor.pointerMove({ x: 2, y: 1 })).toBe(true);
  expect(trace.record.mock.calls).toContainEqual(['geometry', expect.objectContaining({ accepted: true, phase: 'move' })]);
  editor.pointerEnd();
  const tdConfig = structuredClone(DEFAULT_PROJECTION_CONFIG);
  tdConfig.outputs.left.warp.baseline = { type: 'tdMesh', assetId: 'mesh', sha256: 'a'.repeat(64), width: 1920, height: 1080, origin: 'top-left' };
  const td = createWarpEditor({ config: tdConfig, trace }); td.pointerStart({ x: 0, y: 0 });
  expect(td.pointerMove({ x: 2, y: 1 })).toBe(false);
  expect(trace.record.mock.calls).toContainEqual(['geometry', expect.objectContaining({ accepted: false, reason: 'baseline_unavailable' })]);
});
