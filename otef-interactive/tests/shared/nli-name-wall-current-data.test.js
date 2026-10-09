import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import proj4 from 'proj4';
import { test, expect, vi } from 'vitest';
import { evaluateWarpMesh } from '../../frontend/src/shared/projection-warp-geometry.js';
import { evaluateNameWallCoverage, nameWallRowSpans, rectCoveredByPieces, ringContainsGuardedRect } from '../../frontend/src/shared/nli-name-wall-coverage.js';
import { createNameFieldGeometry } from '../../frontend/src/shared/nli-name-field-geometry.js';
import { prepareMemorialNameRecords } from '../../frontend/src/shared/nli-name-field-data.js';
import { buildNamesWallLayout } from '../../frontend/src/shared/nli-name-wall-layout.js';
import { validateProjectionConfig } from '../../frontend/src/shared/projection-config-schema.js';
import { validateProjectionBaselineMesh } from '../../frontend/src/shared/projection-warp-assets.js';
import { sha256Hex } from '../../frontend/src/shared/sha256-hex.js';
import { nameRevealSchedule } from '../../frontend/src/shared/nli-name-field-animation.js';
import { createProjectionNameCanvasAdapter } from '../../frontend/src/projection/projection-name-canvas-adapter.js';
import { planeToOutputUv } from '../../frontend/src/shared/projection-config-geometry.js';
import { MODEL_NAME_ANTIALIAS_GUARD } from '../../frontend/src/shared/nli-name-wall-text-bounds.js';
import { nameTextStyle } from '../../frontend/src/shared/nli-name-language.js';

// Optional acceptance artifacts are supplied explicitly outside protected history directories.
// Expected files: wall-snapshot.json, baseline-manifest.json, left-mesh.json,
// right-mesh.json, name-metrics-he-rtl.json, and name-metrics-en-ltr.json.
const acceptanceArtifactDir = process.env.OTEF_NAME_WALL_ACCEPTANCE_ARTIFACT_DIR
  ? resolve(process.env.OTEF_NAME_WALL_ACCEPTANCE_ARTIFACT_DIR)
  : null;
if (acceptanceArtifactDir && /(^|[\\/])(?:\.superpowers|docs[\\/]superpowers)(?:[\\/]|$)/i.test(acceptanceArtifactDir)) {
  throw new Error('Name wall acceptance artifacts must use an allowed fixture directory.');
}
const acceptanceArtifact = (name) => resolve(acceptanceArtifactDir || '.', name);

const sourcePath = 'public/processed/layers/nli/people_names.geojson';
const metadataPath = 'public/processed/layers/nli/release-metadata.json';
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));

function assertCapturedFont(capture, language) {
  const style = nameTextStyle(language);
  expect(capture.textStyle).toEqual(style);
  const identity = JSON.parse(capture.fontIdentity);
  expect(identity).toHaveLength(4);
  expect(identity.slice(0, 3)).toEqual([language, style.direction, style.canvasFontStack]);
  expect(Array.isArray(identity[3])).toBe(true);
  expect(identity[3].every(face => typeof face === 'string')).toBe(true);
  if (language === 'he') expect(identity[3].some(face => face.startsWith('Guttman Hatzvi:') && face.endsWith(':loaded'))).toBe(true);
}

test('capture font validation rejects a mislabeled stack or unrelated identity', () => {
  const textStyle = nameTextStyle('en');
  const fontIdentity = JSON.stringify(['en', 'ltr', textStyle.canvasFontStack, []]);
  expect(() => assertCapturedFont({ textStyle, fontIdentity }, 'en')).not.toThrow();
  expect(() => assertCapturedFont({ textStyle: { ...textStyle, canvasFontStack: nameTextStyle('he').canvasFontStack }, fontIdentity }, 'en')).toThrow();
  expect(() => assertCapturedFont({ textStyle, fontIdentity: '' }, 'en')).toThrow();
  expect(() => assertCapturedFont({ textStyle, fontIdentity: JSON.stringify(['he', 'rtl', textStyle.canvasFontStack, []]) }, 'en')).toThrow();
});

test.skipIf(!acceptanceArtifactDir).each(['he', 'en'])('optional %s name wall artifacts keep every PID whole, safe, and stable in both modes', async language => {
  proj4.defs('EPSG:2039', '+proj=tmerc +lat_0=31.73439361111111 +lon_0=35.20451694444445 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=-24.0024,-17.1032,-17.8444,0.33077,-1.85269,1.66969,5.4248 +units=m +no_defs');
  const saved = read(acceptanceArtifact('wall-snapshot.json'));
  const config = structuredClone(saved.config || saved);
  expect(validateProjectionConfig(config)).toEqual({});
  const manifest = read(acceptanceArtifact('baseline-manifest.json'));
  for (const side of ['left', 'right']) if (config.outputs[side].warp.enabled !== false && config.outputs[side].warp.baseline?.type === 'tdMesh')
    expect(validateProjectionBaselineMesh(read(acceptanceArtifact(side + '-mesh.json')), { side, manifest, baseline: config.outputs[side].warp.baseline })).toEqual({});
  const meshes = Object.fromEntries(['left', 'right'].map((side) => [side, evaluateWarpMesh(
    read(acceptanceArtifact(`${side}-mesh.json`)), config.outputs[side].warp, { side, schemaVersion: config.schemaVersion },
  )]));
  const logicalPlane = { heading: config.namesWall.rotateDeg, planeScale: config.pre.scale * Math.min(config.outputs.left.post.scale, config.outputs.right.post.scale) };
  const coverageStart = performance.now();
  const coverage = evaluateNameWallCoverage({ config, meshes, logicalPlane });
  const coverageMs = Math.round(performance.now() - coverageStart);
  const model = read('frontend/data/model-bounds.json');
  const convert = (x, y) => proj4('EPSG:2039', 'EPSG:4326', [x, y]);
  const bounds = [convert(model.west, model.south), convert(model.east, model.north)];
  const records = prepareMemorialNameRecords(read(sourcePath), language);
  const captures = [read(acceptanceArtifact('name-metrics-' + language + '-' + (language === 'en' ? 'ltr' : 'rtl') + '.json'))];
  for (const capture of captures) {
    expect(capture.language).toBe(language);
    expect(capture.datasetVersion).toBe(read(metadataPath).datasetVersion);
    assertCapturedFont(capture, language);
  }
  const sizes = captures[0].sizes;
  for (let size = 1; size <= Math.max(config.namesWall.profiles.wall.requestedFontPx, config.namesWall.profiles.model.requestedFontPx); size++)
    expect(sizes[size], 'Missing captured size ' + size).toHaveLength(records.length);
  const metrics = Object.entries(sizes).map(([size, values]) => {
    const byPid = new Map(values.map((value) => [String(value.pid), value]));
    return [Number(size), records.map((record) => {
      const value = byPid.get(record.pid);
      expect(value).toBeDefined();
      expect(value.name).toBe(record.name);
      return [record.name, { width: value.width, left: value.actualBoundingBoxLeft, right: value.actualBoundingBoxRight,
        ascent: value.actualBoundingBoxAscent, descent: value.actualBoundingBoxDescent }];
    })];
  });
  config.namesWall.activeMode = 'wall';

  const input = { records, metrics, coverage, meshes, language, textStyle: captures[0].textStyle, fontIdentity: captures[0].fontIdentity, namesWall: config.namesWall, geometry: { bounds, projectionConfig: config },
    logicalPlane, datasetVersion: read(metadataPath).datasetVersion };
  const layoutStart = performance.now();
  const first = await buildNamesWallLayout(input);
  const layoutMs = Math.round(performance.now() - layoutStart);
  console.info('Current regular wall', { coverageMs, layoutMs, packMs: Math.round(first.diagnostics.packMs), state: first.diagnostics.state,
    reason: first.diagnostics.reason, fontPx: first.fontSize, placed: first.diagnostics.placed,
    left: first.diagnostics.left, right: first.diagnostics.right, digest: first.digest });
  const expectedIds = new Set(records.map((record) => record.pid));
  const orderedIds = records.slice().sort((a, b) => a.orderKey.localeCompare(b.orderKey, language,
    { sensitivity: 'base', numeric: true }) || a.pid.localeCompare(b.pid)).map((record) => record.pid);
  const assertComplete = (field, mode, fieldCoverage = coverage) => {
    expect(field.diagnostics.state).toBe('valid');
    expect(field.placements).toHaveLength(records.length);
    expect(new Set(field.placements.map((p) => p.id))).toEqual(expectedIds);
    expect(field.placements.map((p) => p.id)).toEqual(orderedIds);
    if (mode === 'wall') {
      expect(field.placements.filter((p) => p.output === 'left')).toHaveLength(Math.ceil(records.length / 2));
      expect(field.placements.filter((p) => p.output === 'right')).toHaveLength(Math.floor(records.length / 2));
    } else {
      expect(field.diagnostics.modelUsedSpans).toBeLessThanOrEqual(field.diagnostics.modelSafeSpans);
    }
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
    if (projectedRing) {
      const points = [...fieldCoverage.pieces.left, ...fieldCoverage.pieces.right].flatMap((piece) => piece.polygon);
      const inset = field.diagnostics.profile.edgeInsetPx;
      const safeTop = Math.max(Math.min(...points.map((point) => point[1])),
        Math.min(...projectedRing.map((point) => point[1])) + inset) + MODEL_NAME_ANTIALIAS_GUARD;
      const safeBottom = Math.min(Math.max(...points.map((point) => point[1])),
        Math.max(...projectedRing.map((point) => point[1])) - inset) - MODEL_NAME_ANTIALIAS_GUARD;
      const occupiedTop = Math.min(...field.placements.map((p) => p.y - p.height / 2));
      const occupiedBottom = Math.max(...field.placements.map((p) => p.y + p.height / 2));
      // A complete PID set is insufficient: the exhibit must also populate the model's full vertical extent.
      expect((occupiedBottom - occupiedTop) / (safeBottom - safeTop)).toBeGreaterThan(0.9);
      expect(field.diagnostics.modelRowPitch).toBeGreaterThanOrEqual(
        Math.max(...field.placements.map((p) => p.height)) + field.diagnostics.profile.spacingPx);
    }
    for (const placement of field.placements) {
      const inset = config.namesWall.profiles[mode].edgeInsetPx;
      const guard = mode === 'model' ? MODEL_NAME_ANTIALIAS_GUARD : inset;
      const guarded = { ...placement, width: placement.width + 2 * guard, height: placement.height + 2 * guard };
      expect(rectCoveredByPieces(guarded, mode === 'model'
        ? [...fieldCoverage.pieces.left, ...fieldCoverage.pieces.right] : fieldCoverage.pieces[placement.output])).toBe(true);
      if (projectedRing) expect(ringContainsGuardedRect(projectedRing, placement, inset + guard)).toBe(true);
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
    ...config.namesWall.profiles, model: { ...config.namesWall.profiles.model },
  } };
  const modelStart = performance.now();
  const modeled = await buildNamesWallLayout({ ...input, namesWall: modelWall, ring, ringHash });
  console.info('Current model wall', { layoutMs: Math.round(performance.now() - modelStart),
    packMs: Math.round(modeled.diagnostics.packMs), state: modeled.diagnostics.state,
    reason: modeled.diagnostics.reason, fontPx: modeled.fontSize, placed: modeled.diagnostics.placed,
    left: modeled.diagnostics.left, right: modeled.diagnostics.right,
    usedSpans: modeled.diagnostics.modelUsedSpans, safeSpans: modeled.diagnostics.modelSafeSpans });
  assertComplete(modeled, 'model');
  expect(modeled).not.toHaveProperty('pages');
  expect(modeled.fontSize).toBeGreaterThanOrEqual(6);
  expect(modeled.diagnostics.left + modeled.diagnostics.right).toBe(records.length);
  expect(modeled.diagnostics.modelUsedSpans).toBeLessThanOrEqual(modeled.diagnostics.modelSafeSpans);
  console.info('Captured model spacing 2', { fontPx: modeled.fontSize,
    rowHeight: Math.max(...modeled.placements.map((p) => p.height)), packMs: Math.round(modeled.diagnostics.packMs),
    left: modeled.diagnostics.left, right: modeled.diagnostics.right, usedSpans: modeled.diagnostics.modelUsedSpans,
    safeSpans: modeled.diagnostics.modelSafeSpans, missing: modeled.diagnostics.missing,
    duplicate: modeled.diagnostics.duplicate, overlap: modeled.diagnostics.overlap,
    invalidCoverage: modeled.diagnostics.invalidCoverage, digest: modeled.digest });
  const zeroProfile = structuredClone(modelWall);

  zeroProfile.profiles.model.spacingPx = 0;
  const zero = await buildNamesWallLayout({ ...input, namesWall: zeroProfile, ring, ringHash });
  assertComplete(zero, 'model');
  console.info('Captured model spacing 0', { fontPx: zero.fontSize,
    rowHeight: Math.max(...zero.placements.map((p) => p.height)), packMs: Math.round(zero.diagnostics.packMs),
    left: zero.diagnostics.left, right: zero.diagnostics.right, usedSpans: zero.diagnostics.modelUsedSpans,
    safeSpans: zero.diagnostics.modelSafeSpans, missing: zero.diagnostics.missing,
    duplicate: zero.diagnostics.duplicate, overlap: zero.diagnostics.overlap,
    invalidCoverage: zero.diagnostics.invalidCoverage, digest: zero.digest });
  expect(zero.fontSize).toBeGreaterThan(6);
  expect(zero.placements.every((p) => Number.isFinite(p.textOffsetX) && Number.isFinite(p.textOffsetY))).toBe(true);
  const tighterModel = structuredClone(modelWall);
  tighterModel.profiles.model.spacingPx = 1;
  const tighter = await buildNamesWallLayout({ ...input, namesWall: tighterModel, ring, ringHash });
  assertComplete(tighter, 'model');
  console.info('Captured model spacing 1', { fontPx: tighter.fontSize,
    rowHeight: Math.max(...tighter.placements.map((p) => p.height)), packMs: Math.round(tighter.diagnostics.packMs),
    left: tighter.diagnostics.left, right: tighter.diagnostics.right, usedSpans: tighter.diagnostics.modelUsedSpans,
    safeSpans: tighter.diagnostics.modelSafeSpans, missing: tighter.diagnostics.missing,
    duplicate: tighter.diagnostics.duplicate, overlap: tighter.diagnostics.overlap,
    invalidCoverage: tighter.diagnostics.invalidCoverage, digest: tighter.digest });
  expect(tighter.fontSize).toBeGreaterThanOrEqual(modeled.fontSize);
  expect(tighter.digest).not.toBe(modeled.digest);
  const projectedRing = ring.map(createNameFieldGeometry({ bounds, projectionConfig: config,
    heading: logicalPlane.heading }).project);
  const rowHeight = Math.max(...tighter.placements.map((placement) => placement.height));
  let checkedSpans = 0;
  const rows = Map.groupBy(tighter.placements, (placement) => placement.y);
  for (const [y, row] of rows) {
    const spans = nameWallRowSpans(coverage, { outputs: ['left', 'right'], y0: y - rowHeight / 2, y1: y + rowHeight / 2,
      inset: MODEL_NAME_ANTIALIAS_GUARD, ringInset: tighterModel.profiles.model.edgeInsetPx + MODEL_NAME_ANTIALIAS_GUARD,
      ring: projectedRing });
    for (const [left, right] of spans) {
      const names = row.filter((placement) => placement.x - placement.width / 2 >= left - 1e-4 &&
        placement.x + placement.width / 2 <= right + 1e-4);
      if (!names.length) continue;
      checkedSpans++;
      names.sort((a,b) => b.x - a.x);
      if (names.length === 1) expect(names[0].x).toBeCloseTo((left + right) / 2, 4);
      else {
        expect(names[0].x + names[0].width / 2).toBeCloseTo(right, 4);
        expect(names.at(-1).x - names.at(-1).width / 2).toBeCloseTo(left, 4);
      }
      for (let i = 1; i < names.length; i++) expect(names[i - 1].x - names[i - 1].width / 2 -
        (names[i].x + names[i].width / 2)).toBeGreaterThanOrEqual(tighterModel.profiles.model.spacingPx - 1e-7);
    }
  }
  expect(checkedSpans).toBe(tighter.diagnostics.modelUsedSpans);
  const reorderedModel = await buildNamesWallLayout({ ...input, records: records.slice().reverse(),
    namesWall: modelWall, ring, ringHash });
  expect(reorderedModel.digest).toBe(modeled.digest);
  expect(reorderedModel.placements).toEqual(modeled.placements);
  const schedule = nameRevealSchedule(records.map((record) => record.pid));
  for (const [field, mode] of [[first, 'wall'], [modeled, 'model']]) for (const side of ['left', 'right']) {
    const ctx = { save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(), clearRect: vi.fn(),
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), closePath: vi.fn(), clip: vi.fn(),
      strokeText: vi.fn(), fillText: vi.fn() };
    const adapter = createProjectionNameCanvasAdapter({ output: side, document: {
      createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
    } });
    const renderConfig = structuredClone(config);
    renderConfig.namesWall.activeMode = mode;
    adapter.prepare({ config: renderConfig, placements: field.placements, outputMasks: field.outputMasks,
      fontPx: field.fontSize, textStyle: captures[0].textStyle, logicalPlane });
    adapter.commit();
    expect(ctx.font).toBe(`${field.fontSize}px ${nameTextStyle(language).canvasFontStack}`);
    expect(ctx.direction).toBe(nameTextStyle(language).direction);
    const descriptor = adapter.descriptor();
    const own = field.placements.filter((placement) => (placement.outputs || [placement.output]).includes(side));
    if (mode === 'wall') expect(own).toHaveLength(field.diagnostics[side]);
    expect(descriptor.revealVertices).toHaveLength(own.length * 24);
    expect(ctx.fillText).toHaveBeenCalledTimes(own.length);
    for (let index = 0; index < own.length; index++) {
      const placement = own[index];
      const paintAnchor = [placement.x + (placement.textOffsetX ?? 0), placement.y + (placement.textOffsetY ?? 0)];
      expect(ctx.fillText.mock.calls[index].slice(1)).toEqual(paintAnchor);
      expect(ctx.strokeText.mock.calls[index].slice(1)).toEqual(paintAnchor);
      const identity = schedule.get(placement.id);
      const offset = index * 24;
      const topLeft = planeToOutputUv([placement.x - placement.width / 2,
        placement.y - placement.height / 2], config, side, logicalPlane);
      expect(Array.from(descriptor.revealVertices.slice(offset, offset + 4))).toEqual([
        Math.fround(topLeft.u), Math.fround(topLeft.v), Math.fround(identity.delayMs / 1000), identity.index,
      ]);
      expect(ctx.lineWidth).toBe(renderConfig.namesWall.profiles[mode].strokeWidthPx ?? (mode === 'model' ? 2 : 3));
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
  expect(modeled.placements.map((p) => [p.id, p.output])).not.toEqual(first.placements.map((p) => [p.id, p.output]));
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
      left: Math.ceil(records.length / 2), right: Math.floor(records.length / 2), missing: 0, duplicate: 0, invalidCoverage: 0 });
    expect(new Set(insetField.placements.map((p) => p.id))).toEqual(expectedIds);
    for (const placement of insetField.placements)
      expect(rectCoveredByPieces(placement, insetCoverage.pieces[placement.output])).toBe(true);
  }
  for (const [side, pixels] of [['left', 16], ['right', 24]]) {
    const insetConfig = structuredClone(config);
    insetConfig.namesWall.activeMode = 'model';

    insetConfig.namesWall.innerEdgeInsetPx[side] = pixels;
    const insetCoverage = evaluateNameWallCoverage({ config: insetConfig, meshes, logicalPlane });
    expect(insetCoverage.pieces[side]).not.toEqual(coverage.pieces[side]);
    expect(insetCoverage.pieces[side === 'left' ? 'right' : 'left'])
      .toEqual(coverage.pieces[side === 'left' ? 'right' : 'left']);
    const field = await buildNamesWallLayout({ ...input, coverage: insetCoverage, namesWall: insetConfig.namesWall,
      geometry: { bounds, projectionConfig: insetConfig }, ring, ringHash });
    assertComplete(field, 'model', insetCoverage);
    expect(field.diagnostics).toMatchObject({ placed: records.length, missing: 0, duplicate: 0, overlap: 0, invalidCoverage: 0 });
    for (const placement of field.placements)
      expect(rectCoveredByPieces(placement, [...insetCoverage.pieces.left, ...insetCoverage.pieces.right])).toBe(true);
  }
}, 180_000);
