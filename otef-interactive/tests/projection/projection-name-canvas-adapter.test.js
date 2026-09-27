import { expect, test, vi } from 'vitest';
import { createProjectionNameCanvasAdapter } from '../../frontend/src/projection/projection-name-canvas-adapter.js';
import { DEFAULT_PROJECTION_CONFIG } from '../../frontend/src/shared/projection-config-schema.js';
import { planeToOutputUv } from '../../frontend/src/shared/projection-config-geometry.js';

function fakeCanvas() {
  const ctx = Object.fromEntries(['save','restore','setTransform','fillText','strokeText','clearRect']
    .map((key) => [key, vi.fn()]));
  return { canvas: { width: 0, height: 0, getContext: () => ctx }, ctx };
}
const plane = { heading: 17, planeScale: 1 };
const placements = [
  { id: 'a', name: 'אביגיל בן דוד', output: 'left', x: 0, y: 0, width: 40, height: 20 },
  { id: 'b', name: 'תמר', output: 'right', x: 10, y: 10, width: 20, height: 10 },
];

test('draws whole names only for the owned output with the exact logical plane', () => {
  const f = fakeCanvas();
  const adapter = createProjectionNameCanvasAdapter({ document: { createElement: () => f.canvas }, output: 'left' });
  adapter.prepare({ config: DEFAULT_PROJECTION_CONFIG, placements, fontPx: 6, logicalPlane: plane });
  expect(adapter.descriptor()).toBeNull();
  adapter.commit();
  expect(f.ctx.fillText).toHaveBeenCalledExactlyOnceWith('אביגיל בן דוד', 0, 0);
  const origin = planeToOutputUv([0,0], DEFAULT_PROJECTION_CONFIG, 'left', plane);
  const xUnit = planeToOutputUv([1,0], DEFAULT_PROJECTION_CONFIG, 'left', plane);
  const yUnit = planeToOutputUv([0,1], DEFAULT_PROJECTION_CONFIG, 'left', plane);
  expect(f.ctx.setTransform).toHaveBeenCalledWith((xUnit.u-origin.u)*1920, (xUnit.v-origin.v)*1080,
    (yUnit.u-origin.u)*1920, (yUnit.v-origin.v)*1080, origin.u*1920, origin.v*1080);
  const descriptor = adapter.descriptor();
  expect(descriptor.revealVertices).toBeInstanceOf(Float32Array);
  expect(descriptor.revealVertices).toHaveLength(24);
  const topLeft = planeToOutputUv([-20, -10], DEFAULT_PROJECTION_CONFIG, 'left', plane);
  expect(Array.from(descriptor.revealVertices.slice(0, 2))).toEqual([Math.fround(topLeft.u), Math.fround(topLeft.v)]);
  expect(new Set(Array.from({ length: 6 }, (_, i) => descriptor.revealVertices[i * 4 + 2])).size).toBe(1);
  expect(new Set(Array.from({ length: 6 }, (_, i) => descriptor.revealVertices[i * 4 + 3])).size).toBe(1);
});

test('model text uses a thinner outline while wall text keeps its existing outline', () => {
  const widths = [];
  for (const mode of ['wall', 'model']) {
    const f = fakeCanvas();
    f.ctx.strokeText.mockImplementation(() => widths.push([mode, f.ctx.lineWidth]));
    const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
    config.namesWall.activeMode = mode;
    const adapter = createProjectionNameCanvasAdapter({ document: { createElement: () => f.canvas }, output: 'left' });
    adapter.prepare({ config, placements, logicalPlane: plane });
  }
  expect(widths).toEqual([['wall', 3], ['model', 1]]);
});

test('global delays, selected bypass, and reveal clock change no painted pixels or static vertices', () => {
  const f = fakeCanvas();
  const adapter = createProjectionNameCanvasAdapter({ document: { createElement: () => f.canvas }, output: 'right' });
  adapter.prepare({ config: DEFAULT_PROJECTION_CONFIG, placements, logicalPlane: plane });
  adapter.commit();
  const first = adapter.descriptor();
  const paintCount = f.ctx.fillText.mock.calls.length;
  adapter.setRevealSeconds(3.2);
  adapter.setSelectedPid('b');
  expect(adapter.descriptor()).toMatchObject({ contentVersion: first.contentVersion, revealSeconds: 3.2 });
  expect(adapter.descriptor().selectedIndex).toBeGreaterThanOrEqual(0);
  expect(adapter.descriptor().revealVertices).toBe(first.revealVertices);
  adapter.setOpacity(0.5);
  expect(f.ctx.fillText).toHaveBeenCalledTimes(paintCount);
  expect(adapter.descriptor().revealVertices).toBe(first.revealVertices);
});

test('opacity reuses the canvas without painting text', () => {
  const f = fakeCanvas();
  const adapter = createProjectionNameCanvasAdapter({ document: { createElement: () => f.canvas }, output: 'left' });
  adapter.prepare({ config: DEFAULT_PROJECTION_CONFIG, placements, fontPx: 6, logicalPlane: plane });
  adapter.commit();
  const before = adapter.descriptor();
  f.ctx.fillText.mockClear();
  for (const opacity of [0.8, 0.4, 0, 0.3, 1]) adapter.setOpacity(opacity);
  expect(f.ctx.fillText).not.toHaveBeenCalled();
  expect(adapter.descriptor()).toMatchObject({ source: before.source, contentVersion: before.contentVersion, opacity: 1 });
  expect(() => adapter.setOpacity(1.1)).toThrow(/opacity/);
});

test('focus can repaint while visibility cannot change content version', () => {
  const f = fakeCanvas();
  const adapter = createProjectionNameCanvasAdapter({ document: { createElement: () => f.canvas }, output: 'left' });
  adapter.prepare({ config: DEFAULT_PROJECTION_CONFIG, placements, logicalPlane: plane });
  adapter.commit();
  const before = adapter.descriptor();
  adapter.setPresentation({ alphaFor: (id) => id === 'a' ? 0.5 : 1 });
  expect(adapter.descriptor().contentVersion).toBeGreaterThan(before.contentVersion);
  const focused = adapter.descriptor();
  adapter.setOpacity(0);
  expect(adapter.descriptor().contentVersion).toBe(focused.contentVersion);
});

test('candidate rollback restores the previous source and disposed source is absent', () => {
  const adapter = createProjectionNameCanvasAdapter({ document: { createElement: () => fakeCanvas().canvas }, output: 'left' });
  const candidate = { config: DEFAULT_PROJECTION_CONFIG, placements, logicalPlane: plane };
  const first = adapter.prepare(candidate).source;
  adapter.commit(); adapter.finalize();
  const second = adapter.prepare(candidate).source;
  expect(adapter.descriptor().source).toBe(first);
  adapter.commit();
  expect(adapter.descriptor().source).toBe(second);
  adapter.rollback();
  expect(adapter.descriptor().source).toBe(first);
  adapter.dispose();
  expect(adapter.descriptor()).toBeNull();
});
