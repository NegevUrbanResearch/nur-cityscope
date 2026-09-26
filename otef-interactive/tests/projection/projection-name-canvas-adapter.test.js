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
