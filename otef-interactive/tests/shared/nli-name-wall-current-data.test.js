import { readFileSync } from 'node:fs';
import proj4 from 'proj4';
import { test, expect, vi } from 'vitest';
import { evaluateWarpMesh } from '../../frontend/src/shared/projection-warp-geometry.js';
import { evaluateNameWallCoverage, rectCoveredByPieces, ringContainsGuardedRect } from '../../frontend/src/shared/nli-name-wall-coverage.js';
import { createNameFieldGeometry } from '../../frontend/src/shared/nli-name-field-geometry.js';
import { prepareMemorialNameRecords } from '../../frontend/src/shared/nli-name-field-data.js';
import { buildNamesWallLayout } from '../../frontend/src/shared/nli-name-wall-layout.js';
import { migrateNamesWallToV5 } from '../../frontend/src/shared/nli-name-wall-config.js';
import { sha256Hex } from '../../frontend/src/shared/sha256-hex.js';
import { nameRevealSchedule } from '../../frontend/src/shared/nli-name-field-animation.js';
import { createProjectionNameCanvasAdapter } from '../../frontend/src/projection/projection-name-canvas-adapter.js';
import { planeToOutputUv } from '../../frontend/src/shared/projection-config-geometry.js';

const snapshotPath = '../.superpowers/sdd/memorial-wall-revision-699-snapshot.json';
const metricsPaths = [
  '../.superpowers/sdd/memorial-wall-browser-guttman-metrics-center-middle-rtl.json',
  '../.superpowers/sdd/memorial-wall-browser-guttman-metrics-4-8-center-middle-rtl.json',
];
const sourcePath = 'public/processed/layers/nli/people_names.geojson';
const metadataPath = 'public/processed/layers/nli/release-metadata.json';
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));

test('captured current wall keeps every PID whole, safe, and stable in both modes', async () => {
  proj4.defs('EPSG:2039', '+proj=tmerc +lat_0=31.73439361111111 +lon_0=35.20451694444445 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=-24.0024,-17.1032,-17.8444,0.33077,-1.85269,1.66969,5.4248 +units=m +no_defs');
  const saved = read(snapshotPath);
  const config = migrateNamesWallToV5(saved.config || saved);
  const meshes = Object.fromEntries(['left', 'right'].map((side) => [side, evaluateWarpMesh(
    read(`public/projection-calibration/td-baselines/${side}.json`), config.outputs[side].warp,
  )]));
  const logicalPlane = { heading: 35, planeScale: config.pre.scale * Math.min(config.outputs.left.post.scale, config.outputs.right.post.scale) };
  const coverageStart = performance.now();
  const coverage = evaluateNameWallCoverage({ config, meshes, logicalPlane });
  const coverageMs = Math.round(performance.now() - coverageStart);
  const model = read('frontend/data/model-bounds.json');
  const convert = (x, y) => proj4('EPSG:2039', 'EPSG:4326', [x, y]);
  const bounds = [convert(model.west, model.south), convert(model.east, model.north)];
  const records = prepareMemorialNameRecords(read(sourcePath));
  const captures = metricsPaths.map(read);
  for (const capture of captures) {
    expect(capture.fontCheck).toBe(true);
    expect(capture.count).toBe(records.length);
  }
  const sizes = { ...captures[0].sizes, ...captures[1].sizes };
  const metrics = Object.entries(sizes).map(([size, values]) => {
    const byPid = new Map(values.map((value) => [String(value.pid), value]));
    return [Number(size), records.map((record) => {
      const value = byPid.get(record.pid);
      expect(value).toBeDefined();
      return [record.name, { width: value.width, left: value.actualBoundingBoxLeft, right: value.actualBoundingBoxRight,
        ascent: value.actualBoundingBoxAscent, descent: value.actualBoundingBoxDescent }];
    })];
  });
  const maxSize = Math.max(...metrics.map(([size]) => size));
  config.namesWall.activeMode = 'wall';
  config.namesWall.profiles.wall.requestedFontPx = maxSize;
  const input = { records, metrics, coverage, meshes, namesWall: config.namesWall, geometry: { bounds, projectionConfig: config },
    logicalPlane, datasetVersion: read(metadataPath).datasetVersion };
  const layoutStart = performance.now();
  const first = await buildNamesWallLayout(input);
  const layoutMs = Math.round(performance.now() - layoutStart);
  console.info('Current regular wall', { coverageMs, layoutMs, packMs: Math.round(first.diagnostics.packMs), state: first.diagnostics.state,
    reason: first.diagnostics.reason, fontPx: first.fontSize, placed: first.diagnostics.placed,
    left: first.diagnostics.left, right: first.diagnostics.right, digest: first.digest });
  const expectedIds = new Set(records.map((record) => record.pid));
  const assertComplete = (field, mode) => {
    expect(field.diagnostics.state).toBe('valid');
    expect(field.placements).toHaveLength(records.length);
    expect(new Set(field.placements.map((p) => p.id))).toEqual(expectedIds);
    expect(field.placements.filter((p) => p.output === 'left')).toHaveLength(Math.ceil(records.length / 2));
    expect(field.placements.filter((p) => p.output === 'right')).toHaveLength(Math.floor(records.length / 2));
    expect(field.fontSize).toBeGreaterThanOrEqual(1);
    expect(field).not.toHaveProperty('drawPieces');
    expect(field.diagnostics).toMatchObject({ missing: 0, extra: 0, duplicate: 0, overlap: 0, invalidCoverage: 0 });
    if (mode === 'wall') for (const side of ['left', 'right']) {
      const page = field.pages[side];
      expect(page.singleton).toBe(false);
      expect(page.worstGap).toBeGreaterThanOrEqual(config.namesWall.profiles.wall.spacingPx);
      expect(rectCoveredByPieces({ x: (page.left + page.right) / 2, y: (page.y0 + page.y1) / 2,
        width: page.right - page.left, height: page.y1 - page.y0 }, coverage.pieces[side])).toBe(true);
      const rows = Map.groupBy(field.placements.filter((p) => p.output === side), (p) => p.y);
      for (const names of rows.values()) {
        expect(names.length).toBeGreaterThanOrEqual(2);
        expect(Math.min(...names.map((p) => p.x - p.width / 2))).toBeCloseTo(page.left, 5);
        expect(Math.max(...names.map((p) => p.x + p.width / 2))).toBeCloseTo(page.right, 5);
      }
    }
    const projectedRing = mode === 'model'
      ? ring.map(createNameFieldGeometry({ bounds, projectionConfig: config, heading: logicalPlane.heading }).project)
      : null;
    for (const placement of field.placements) {
      const inset = config.namesWall.profiles[mode].edgeInsetPx;
      const guarded = { ...placement, width: placement.width + 2 * inset, height: placement.height + 2 * inset };
      expect(rectCoveredByPieces(guarded, coverage.pieces[placement.output])).toBe(true);
      if (projectedRing) expect(ringContainsGuardedRect(projectedRing, placement, inset)).toBe(true);
    }
  };
  const ring = read('public/processed/layers/projector_base/Tkuma_Area_LIne.geojson').features[0].geometry.coordinates;
  assertComplete(first, 'wall');
  const moved = [];
  for (const percent of [50, 100]) {
    const adjusted = structuredClone(config.namesWall);
    adjusted.profiles.wall.inwardShiftPercent = percent;
    const field = await buildNamesWallLayout({ ...input, namesWall: adjusted });
    assertComplete(field, 'wall');
    expect(field.fontSize).toBe(first.fontSize);
    expect(field.placements.map((p) => [p.id, p.name, p.output, p.x, p.width, p.height]))
      .toEqual(first.placements.map((p) => [p.id, p.name, p.output, p.x, p.width, p.height]));
    for (let i = 0; i < field.placements.length; i++) {
      const side = field.placements[i].output;
      expect(field.placements[i].y - first.placements[i].y).toBeCloseTo(field.pages[side].inwardTravel * percent / 100, 6);
    }
    expect(field.pages.left.rowOrigin).toBe(first.pages.left.rowOrigin);
    expect(field.pages.right.rowOrigin).toBeGreaterThan(first.pages.right.rowOrigin);
    moved.push(field);
  }
  expect(new Set([first.digest, ...moved.map((field) => field.digest)]).size).toBe(3);
  const reordered = await buildNamesWallLayout({ ...input, records: records.slice().reverse() });
  expect(reordered.digest).toBe(first.digest);
  expect(reordered.placements).toEqual(first.placements);
  const ringHash = await sha256Hex(new TextEncoder().encode(JSON.stringify(ring)));
  const modelWall = { ...config.namesWall, activeMode: 'model', profiles: {
    ...config.namesWall.profiles, model: { ...config.namesWall.profiles.model, requestedFontPx: maxSize },
  } };
  const modelStart = performance.now();
  const modeled = await buildNamesWallLayout({ ...input, namesWall: modelWall, ring, ringHash });
  console.info('Current model wall', { layoutMs: Math.round(performance.now() - modelStart),
    packMs: Math.round(modeled.diagnostics.packMs), state: modeled.diagnostics.state,
    reason: modeled.diagnostics.reason, fontPx: modeled.fontSize, placed: modeled.diagnostics.placed });
  assertComplete(modeled, 'model');
  const schedule = nameRevealSchedule(records.map((record) => record.pid));
  for (const field of [first, modeled]) for (const side of ['left', 'right']) {
    const ctx = { save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(), clearRect: vi.fn(),
      strokeText: vi.fn(), fillText: vi.fn() };
    const adapter = createProjectionNameCanvasAdapter({ output: side, document: {
      createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
    } });
    adapter.prepare({ config, placements: field.placements, fontPx: field.fontSize, logicalPlane });
    adapter.commit();
    const descriptor = adapter.descriptor();
    const own = field.placements.filter((placement) => placement.output === side);
    expect(own).toHaveLength(614);
    expect(descriptor.revealVertices).toHaveLength(own.length * 24);
    expect(ctx.fillText).toHaveBeenCalledTimes(own.length);
    for (let index = 0; index < own.length; index++) {
      const placement = own[index];
      const identity = schedule.get(placement.id);
      const offset = index * 24;
      const topLeft = planeToOutputUv([placement.x - placement.width / 2,
        placement.y - placement.height / 2], config, side, logicalPlane);
      expect(Array.from(descriptor.revealVertices.slice(offset, offset + 4))).toEqual([
        Math.fround(topLeft.u), Math.fround(topLeft.v), Math.fround(identity.delayMs / 1000), identity.index,
      ]);
    }
    const painted = ctx.fillText.mock.calls.length;
    const staticVertices = descriptor.revealVertices;
    adapter.setRevealSeconds(4.4); adapter.setOpacity(0.5);
    expect(adapter.descriptor().revealVertices).toBe(staticVertices);
    expect(adapter.descriptor().contentVersion).toBe(descriptor.contentVersion);
    expect(ctx.fillText).toHaveBeenCalledTimes(painted);
    adapter.dispose();
  }
  const modelWithMovedWall = await buildNamesWallLayout({ ...input, namesWall: { ...modelWall,
    profiles: { ...modelWall.profiles, wall: { ...modelWall.profiles.wall, inwardShiftPercent: 100 } } }, ring, ringHash });
  expect(modelWithMovedWall.placements).toEqual(modeled.placements);
  expect(modelWithMovedWall.digest).toBe(modeled.digest);
  expect(modeled.placements.map((p) => [p.id, p.output])).toEqual(first.placements.map((p) => [p.id, p.output]));
  const leftInsetConfig = structuredClone(config);
  leftInsetConfig.namesWall.innerEdgeInsetPx.left = 16;
  const leftInsetCoverage = evaluateNameWallCoverage({ config: leftInsetConfig, meshes, logicalPlane });
  expect(leftInsetCoverage.pieces.right).toEqual(coverage.pieces.right);
  expect(leftInsetCoverage.pieces.left).not.toEqual(coverage.pieces.left);
  const rightInsetConfig = structuredClone(config);
  rightInsetConfig.namesWall.innerEdgeInsetPx.right = 16;
  const rightInsetCoverage = evaluateNameWallCoverage({ config: rightInsetConfig, meshes, logicalPlane });
  expect(rightInsetCoverage.pieces.left).toEqual(coverage.pieces.left);
  expect(rightInsetCoverage.pieces.right).not.toEqual(coverage.pieces.right);
  for (const [insetConfig, insetCoverage] of [[leftInsetConfig, leftInsetCoverage],
    [rightInsetConfig, rightInsetCoverage]]) {
    const insetField = await buildNamesWallLayout({ ...input, coverage: insetCoverage,
      namesWall: insetConfig.namesWall, geometry: { bounds, projectionConfig: insetConfig } });
    expect(insetField.diagnostics).toMatchObject({ state: 'valid', placed: records.length,
      left: 614, right: 614, missing: 0, duplicate: 0, invalidCoverage: 0 });
    expect(new Set(insetField.placements.map((p) => p.id))).toEqual(expectedIds);
    for (const placement of insetField.placements)
      expect(rectCoveredByPieces(placement, insetCoverage.pieces[placement.output])).toBe(true);
  }
}, 180_000);
