import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import proj4 from 'proj4';
import { evaluateWarpMesh } from '../frontend/src/shared/projection-warp-geometry.js';
import { evaluateNameWallCoverage, rectCoveredByPieces } from '../frontend/src/shared/nli-name-wall-coverage.js';
import { prepareMemorialNameRecords } from '../frontend/src/shared/nli-name-field-data.js';
import { buildNamesWallLayout } from '../frontend/src/shared/nli-name-wall-layout.js';
import { migrateNamesWallToV5 } from '../frontend/src/shared/nli-name-wall-config.js';
import { NLI_LABEL_HEADING_DEFAULT } from '../frontend/src/shared/nli-label-heading.js';
import { sha256Hex } from '../frontend/src/shared/sha256-hex.js';

proj4.defs('EPSG:2039', '+proj=tmerc +lat_0=31.73439361111111 +lon_0=35.20451694444445 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=-24.0024,-17.1032,-17.8444,0.33077,-1.85269,1.66969,5.4248 +units=m +no_defs');
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
if (process.argv.length !== 5) throw new Error('usage: node scripts/benchmark-name-wall-layout.mjs <projection snapshot> <8-12px browser metrics> <4-8px browser metrics>');
const saved = read(process.argv[2]);
const config = migrateNamesWallToV5(saved.config || saved);
const captures = [read(process.argv[3]), read(process.argv[4])];
const records = prepareMemorialNameRecords(read('public/processed/layers/nli/people_names.geojson'));
for (const capture of captures) {
  assert.equal(capture.fontCheck, true, 'actual Guttman font must be loaded');
  assert.equal(capture.count, records.length, 'metric capture must match included records');
}
const meshes = Object.fromEntries(['left', 'right'].map((side) => [side, evaluateWarpMesh(
  read(`public/projection-calibration/td-baselines/${side}.json`), config.outputs[side].warp,
)]));
const logicalPlane = { heading: Number(process.env.NLI_NAME_WALL_HEADING ?? NLI_LABEL_HEADING_DEFAULT), planeScale: config.pre.scale * Math.min(config.outputs.left.post.scale, config.outputs.right.post.scale) };
const coverageStart = performance.now();
const coverage = evaluateNameWallCoverage({ config, meshes, logicalPlane });
const coverageMs = Math.round(performance.now() - coverageStart);
const model = read('frontend/data/model-bounds.json');
const convert = (x, y) => proj4('EPSG:2039', 'EPSG:4326', [x, y]);
const bounds = [convert(model.west, model.south), convert(model.east, model.north)];
const metadata = read('public/processed/layers/nli/release-metadata.json');
const sizes = { ...captures[0].sizes, ...captures[1].sizes };
const metrics = Object.entries(sizes).map(([size, values]) => {
  const byPid = new Map(values.map((value) => [String(value.pid), value]));
  return [Number(size), records.map((record) => {
    const value = byPid.get(record.pid);
    assert.ok(value, `missing captured metric ${record.pid} at ${size}px`);
    return [record.name, { width: value.width, left: value.actualBoundingBoxLeft, right: value.actualBoundingBoxRight,
      ascent: value.actualBoundingBoxAscent, descent: value.actualBoundingBoxDescent }];
  })];
});
const ring = read('public/processed/layers/projector_base/Tkuma_Area_LIne.geojson').features[0].geometry.coordinates;
const ringHash = await sha256Hex(new TextEncoder().encode(JSON.stringify(ring)));
const expectedIds = new Set(records.map((record) => record.pid));
const orderedIds = records.slice().sort((a, b) => a.orderKey.localeCompare(b.orderKey, 'he',
  { sensitivity: 'base', numeric: true }) || a.pid.localeCompare(b.pid)).map((record) => record.pid);
for (const mode of ['wall', 'model']) {
  config.namesWall.activeMode = mode;
  config.namesWall.profiles[mode].requestedFontPx = Math.max(...metrics.map(([size]) => size));
  const start = performance.now();
  const field = await buildNamesWallLayout({ records, metrics, coverage, meshes, namesWall: config.namesWall, ring, ringHash,
    geometry: { bounds, projectionConfig: config }, logicalPlane, datasetVersion: metadata.datasetVersion });
  const layoutMs = Math.round(performance.now() - start);
  assert.equal(field.diagnostics.state, 'valid', `${mode}: ${field.diagnostics.reason}`);
  assert.equal(field.placements.length, records.length);
  assert.deepEqual(new Set(field.placements.map((p) => p.id)), expectedIds);
  assert.deepEqual(field.placements.map((p) => p.id), orderedIds, `${mode}: global scan order`);
  if (mode === 'wall') {
    assert.equal(field.diagnostics.left, Math.ceil(records.length / 2));
    assert.equal(field.diagnostics.right, Math.floor(records.length / 2));
  } else {
    assert.ok(field.diagnostics.left > 0 && field.diagnostics.right > 0);
    assert.ok(field.diagnostics.modelUsedSpans >= field.diagnostics.modelSafeSpans - 2);
  }
  assert.ok(field.fontSize >= 1);
  assert.ok(!Object.hasOwn(field, 'drawPieces'));
  for (const placement of field.placements) assert.ok(rectCoveredByPieces(placement, coverage.pieces[placement.output]));
  console.log(JSON.stringify({ mode, heading: logicalPlane.heading, revision: saved.revision, included: records.length, coverageMs, layoutMs,
    totalMs: coverageMs + layoutMs, state: field.diagnostics.state, effectiveFontPx: field.fontSize,
    left: field.diagnostics.left, right: field.diagnostics.right, packMs: Math.round(field.diagnostics.packMs),
    pages: field.pages && Object.fromEntries(Object.entries(field.pages).map(([side, page]) => [side,
      { rows: page.rows, width: Math.round((page.right - page.left) * 100) / 100,
        height: Math.round((page.y1 - page.y0) * 100) / 100,
        worstGap: Math.round(page.worstGap * 100) / 100 }])), digest: field.digest }));
}
