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

test('4K people names keep logical positions, reveal quads and font size with double-density painting', () => {
  const a = fakeCanvas(), b = fakeCanvas();
  const lab = createProjectionNameCanvasAdapter({ document: { createElement: () => a.canvas }, output: 'left' });
  const exhibit = createProjectionNameCanvasAdapter({ document: { createElement: () => b.canvas }, output: 'left', rasterScale: 2 });
  for (const adapter of [lab, exhibit]) { adapter.prepare({ config: DEFAULT_PROJECTION_CONFIG, placements, fontPx: 6, logicalPlane: plane }); adapter.commit(); }
  expect([b.canvas.width, b.canvas.height]).toEqual([3840, 2160]);
  expect(b.ctx.setTransform.mock.calls.at(-1)).toEqual(a.ctx.setTransform.mock.calls.at(-1).map(value => value * 2));
  expect(b.ctx.fillText.mock.calls).toEqual(a.ctx.fillText.mock.calls);
  expect(b.ctx.font).toBe(a.ctx.font);
  expect(exhibit.descriptor().revealVertices).toEqual(lab.descriptor().revealVertices);
});

test('a changed wall heading repacks the matrix and does not start reveal', () => {
  const created = [];
  const document = { createElement: () => { const next = fakeCanvas(); created.push(next); return next.canvas; } };
  const settlement = fakeCanvas();
  settlement.ctx.fillText('שדרות', 12, 24);
  const settlementFills = settlement.ctx.fillText.mock.calls.length;
  const settlementClears = settlement.ctx.clearRect.mock.calls.length;
  const adapter = createProjectionNameCanvasAdapter({ document, output: 'left' });
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  const settlementStyle = { rotateDeg: -15, fontPx: 18 };
  config.settlementNameStyle = settlementStyle;
  const captured = { heading: config.namesWall.rotateDeg, planeScale: 1 };
  adapter.prepare({ config, placements, logicalPlane: captured });
  expect(adapter.descriptor()).toBeNull();
  const turned = { heading: 70, planeScale: 1 };
  const repacked = [{ ...placements[0], x: 18, y: 6, width: 36, height: 16 }, placements[1]];
  adapter.prepare({ config, placements: repacked, logicalPlane: turned });
  adapter.commit();
  const painted = created.at(-1);
  expect(painted.ctx.fillText).toHaveBeenCalledExactlyOnceWith('אביגיל בן דוד', 18, 6);
  expect(painted.ctx.fillText).not.toHaveBeenCalledWith('אביגיל בן דוד', 0, 0);
  const origin = planeToOutputUv([0, 0], config, 'left', turned);
  const xUnit = planeToOutputUv([1, 0], config, 'left', turned);
  expect(painted.ctx.setTransform).toHaveBeenLastCalledWith((xUnit.u - origin.u) * 1920, (xUnit.v - origin.v) * 1080,
    expect.any(Number), expect.any(Number), origin.u * 1920, origin.v * 1080);
  const topLeft = planeToOutputUv([0, -2], config, 'left', turned);
  expect(Array.from(adapter.descriptor().revealVertices.slice(0, 2))).toEqual([Math.fround(topLeft.u), Math.fround(topLeft.v)]);
  const committed = adapter.descriptor();
  expect(committed.opacity).toBe(0);
  expect(committed.revealSeconds).toBe(0);
  expect(adapter.descriptor().contentVersion).toBe(committed.contentVersion);
  expect(config.pre.rotateDeg).toBe(DEFAULT_PROJECTION_CONFIG.pre.rotateDeg);
  expect(config.settlementNameStyle).toEqual(settlementStyle);
  expect(settlement.ctx.fillText).toHaveBeenCalledTimes(settlementFills);
  expect(settlement.ctx.clearRect).toHaveBeenCalledTimes(settlementClears);
  expect(created).toHaveLength(2);
});

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

test('each names wall mode paints black outlines at its own configured width before fill', () => {
  const widths = [];
  for (const [mode, width] of [['wall', 5], ['model', 1]]) {
    const f = fakeCanvas();
    f.ctx.strokeText.mockImplementation(() => widths.push([mode, f.ctx.lineWidth, f.ctx.strokeStyle]));
    const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
    config.namesWall.activeMode = mode;
    config.namesWall.profiles[mode].strokeWidthPx = width;
    const adapter = createProjectionNameCanvasAdapter({ document: { createElement: () => f.canvas }, output: 'left' });
    adapter.prepare({ config, placements, logicalPlane: plane });
    expect(f.ctx.strokeText.mock.invocationCallOrder[0]).toBeLessThan(f.ctx.fillText.mock.invocationCallOrder[0]);
  }
  expect(widths).toEqual([['wall', 5, '#000000'], ['model', 1, '#000000']]);
});

test('geometry remap reuses installed placements and repaints through the new output transform', () => {
  const created = [];
  const document = { createElement: () => { const next = fakeCanvas(); created.push(next); return next.canvas; } };
  const adapter = createProjectionNameCanvasAdapter({ document, output: 'left' });
  adapter.prepare({ config: DEFAULT_PROJECTION_CONFIG, placements, logicalPlane: plane }); adapter.commit();
  const before = adapter.descriptor();
  const nextConfig = structuredClone(DEFAULT_PROJECTION_CONFIG); nextConfig.outputs.left.crop.x1 = 0.65;
  expect(adapter.applyGeometry({ config: nextConfig, logicalPlane: plane })).toBe(true);
  const after = adapter.descriptor();
  expect(created).toHaveLength(2);
  expect(created[1].ctx.fillText).toHaveBeenCalledExactlyOnceWith(placements[0].name, placements[0].x, placements[0].y);
  expect(after.source).not.toBe(before.source);
  expect(after.contentVersion).toBeGreaterThan(before.contentVersion);
  expect(Array.from(after.revealVertices.slice(0, 2))).not.toEqual(Array.from(before.revealVertices.slice(0, 2)));
});

test('model offsets move both paint calls while reveal quads stay at the guarded rectangle', () => {
  const f = fakeCanvas();
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  config.namesWall.activeMode = 'model';
  const placement = { ...placements[0], textOffsetX: -2, textOffsetY: 2.5 };
  const adapter = createProjectionNameCanvasAdapter({ document: { createElement: () => f.canvas }, output: 'left' });
  adapter.prepare({ config, placements: [placement], logicalPlane: plane });
  expect(f.ctx.strokeText).toHaveBeenCalledExactlyOnceWith(placement.name, -2, 2.5);
  expect(f.ctx.fillText).toHaveBeenCalledExactlyOnceWith(placement.name, -2, 2.5);
  const topLeft = planeToOutputUv([placement.x - placement.width / 2, placement.y - placement.height / 2], config, 'left', plane);
  adapter.commit();
  expect(Array.from(adapter.descriptor().revealVertices.slice(0, 2))).toEqual([Math.fround(topLeft.u), Math.fround(topLeft.v)]);
});

test('present offsets must be finite while omitted and zero offsets remain valid', () => {
  for (const item of [{ ...placements[0] }, { ...placements[0], textOffsetX: 0, textOffsetY: 0 }]) {
    const adapter = createProjectionNameCanvasAdapter({ document: { createElement: () => fakeCanvas().canvas }, output: 'left' });
    expect(() => adapter.prepare({ config: DEFAULT_PROJECTION_CONFIG, placements: [item], logicalPlane: plane })).not.toThrow();
  }
  for (const key of ['textOffsetX', 'textOffsetY']) for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const adapter = createProjectionNameCanvasAdapter({ document: { createElement: () => fakeCanvas().canvas }, output: 'left' });
    expect(() => adapter.prepare({ config: DEFAULT_PROJECTION_CONFIG,
      placements: [{ ...placements[0], [key]: bad }], logicalPlane: plane })).toThrow(/placement/);
  }
});

test('global delays, selected bypass, and reveal clock change no painted pixels or static vertices', () => {
  const f = fakeCanvas();
  const adapter = createProjectionNameCanvasAdapter({ document: { createElement: () => f.canvas }, output: 'right' });
  adapter.prepare({ config: DEFAULT_PROJECTION_CONFIG, placements, logicalPlane: plane });
  adapter.commit();
  const first = adapter.descriptor();
  const paintCount = f.ctx.fillText.mock.calls.length;
  adapter.setRevealSeconds(3.2);
  adapter.setRevealSeconds(20);
  expect(() => adapter.setRevealSeconds(20.001)).toThrow(/reveal time/);
  for (const invalid of [-0.001, Number.NaN, Number.POSITIVE_INFINITY])
    expect(() => adapter.setRevealSeconds(invalid)).toThrow(/reveal time/);
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
