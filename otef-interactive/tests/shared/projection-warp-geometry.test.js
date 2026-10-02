import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createFullFrameProjectionMesh, createIdentityProjectionMesh, compareRenderedLayouts, evaluateWarpPoint, evaluateWarpMesh, interpolateGridOffset, validateWarpMesh } from '../../frontend/src/shared/projection-warp-geometry.js';
import { migrateProjectionConfigToV7 } from '../../frontend/src/shared/projection-config-schema.js';
import { compileSourceProbeState, prepareGridWarpMesh } from '../../frontend/src/shared/projection-grid-mesh.js';
import { createBaselineSampler } from '../../frontend/src/shared/projection-baseline-sampler.js';
import { variableTdMesh } from '../fixtures/td-variable-grid.js';

const golden = JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/projection-warp-golden.json', import.meta.url)));
const warp = golden.identity.warp;
const mesh = golden.identity.mesh;

test('identity homography preserves all four corners', () => {
  for (const [input, expected] of golden.samples.identityCorners.map((point) => [point, point])) {
    expect(evaluateWarpPoint(input[0], input[1], warp)).toEqual(expected);
  }
});

test('grid interpolation uses interior logical offsets and clamps at boundaries', () => {
  const value = structuredClone(warp);
  const sample = golden.samples.oneCell;
  value.grid.offsets[0] = sample.cornerOffsets[0];
  value.grid.offsets[1] = sample.cornerOffsets[1];
  value.grid.offsets[7] = sample.cornerOffsets[2];
  value.grid.offsets[8] = sample.cornerOffsets[3];
  expect(interpolateGridOffset(...sample.point, value.grid)).toEqual([0.09600000000000003, 0.12000000000000002]);
  expect(interpolateGridOffset(-1, -1, value.grid)).toEqual([0, 0]);
});

test('mesh evaluation changes destination coordinates but preserves sampled UV and topology', () => {
  const value = structuredClone(warp);
  value.grid.offsets[golden.samples.bilinearCenter.index] = [0.01, 0];
  const result = evaluateWarpMesh(mesh, value);
  expect(result.triangles).toEqual(mesh.triangles);
  expect(result.vertices.map(({ u, v }) => [u, v])).toEqual(mesh.vertices.map(({ u, v }) => [u, v]));
  expect(result.vertices[golden.samples.bilinearCenter.index]).toMatchObject({ x: 0.51, y: 0.5 });
  expect(validateWarpMesh(result)).toBe(result);
});

test('identity baseline supplies fixed left and right logical mesh topologies', () => {
  const left = evaluateWarpMesh(null, golden.identity.warp);
  const right = evaluateWarpMesh(null, golden.rightIdentity.warp);
  expect(left.vertices).toEqual(golden.identity.mesh.vertices);
  expect(left.triangles).toEqual(golden.identity.mesh.triangles);
  expect(right.vertices).toEqual(golden.rightIdentity.mesh.vertices);
  expect(right.triangles).toEqual(golden.rightIdentity.mesh.triangles);

  const changed = structuredClone(golden.identity.warp);
  changed.grid.offsets[golden.samples.bilinearCenter.index] = [0.01, 0];
  const moved = evaluateWarpMesh(null, changed);
  expect(moved.vertices[golden.samples.bilinearCenter.index].x).toBeCloseTo(0.51);
});

test('projective corner samples use the shared golden fixture', () => {
  const value = structuredClone(warp);
  value.keystone.corners = golden.samples.projectiveCorners.corners;
  for (const sample of golden.samples.projectiveCorners.points) {
    const result = evaluateWarpPoint(...sample.point, value);
    expect(result[0]).toBeCloseTo(sample.expected[0]);
    expect(result[1]).toBeCloseTo(sample.expected[1]);
  }
});

test('rejects inverted or degenerate evaluated triangles', () => {
  const invalid = structuredClone(mesh);
  invalid.vertices[1].x = 0;
  expect(() => validateWarpMesh(invalid)).toThrow(/degenerate|inverted/i);
});

test('disabled warp returns a fixed full-frame quad without loading baseline geometry', () => {
  const value = structuredClone(warp);
  value.enabled = false;
  const result = evaluateWarpMesh(null, value);
  expect(result).toEqual(createFullFrameProjectionMesh({ side: 'left' }));

  const right = structuredClone(golden.rightIdentity.warp);
  right.enabled = false;
  expect(evaluateWarpMesh(null, right)).toEqual(createFullFrameProjectionMesh({ side: 'right' }));
});

test('malformed non-object baseline without a mesh fails with a controlled validation error', () => {
  for (const baseline of [null, 'identity', []]) {
    const value = structuredClone(warp);
    value.baseline = baseline;
    expect(() => evaluateWarpMesh(null, value)).toThrow(Error);
  }
});

test('v7 uniform grid preserves legacy geometry and nonuniform rendering prepares a mesh', () => {
  const config = migrateProjectionConfigToV7(JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/projection-config-v1.json', import.meta.url))).valid);
  const v7 = config.outputs.left.warp;
  const before = structuredClone(config);
  expect(() => evaluateWarpMesh(null, v7, { schemaVersion: 7 })).toThrow(/explicit side/);
  const legacy = structuredClone(v7);
  delete legacy.grid.columnPositions; delete legacy.grid.rowPositions;
  expect(evaluateWarpMesh(null, v7, { side: 'left', schemaVersion: 7 })).toEqual(evaluateWarpMesh(null, legacy, { side: 'left' }));
  const rightV7 = config.outputs.right.warp;
  const rightLegacy = structuredClone(rightV7);
  delete rightLegacy.grid.columnPositions; delete rightLegacy.grid.rowPositions;
  expect(evaluateWarpMesh(null, rightV7, { side: 'right', schemaVersion: 7 })).toEqual(evaluateWarpMesh(null, rightLegacy, { side: 'right' }));
  expect(config).toEqual(before);
  const custom = structuredClone(v7);
  custom.grid.columnPositions[2] += 0.01;
  expect(evaluateWarpMesh(null, custom, { side: 'left', schemaVersion: 7 }).validationProfile).toBe('relative-source-v1');
  const disabled = structuredClone(custom); disabled.enabled = false;
  expect(evaluateWarpMesh(null, disabled, { side: 'left', schemaVersion: 7 })).toEqual(createFullFrameProjectionMesh({ side: 'left' }));
  expect(evaluateWarpPoint(0.25, 0.75, disabled, 0.5, 0.5, { side: 'left', schemaVersion: 7 })).toEqual([0.25, 0.75]);
  const malformed = structuredClone(v7); malformed.grid.rowPositions.pop();
  expect(() => evaluateWarpMesh(null, malformed, { side: 'left', schemaVersion: 7 })).toThrow(/invalid warp/);
});

test('v7 point evaluation matches both legacy sides and requires a source mesh for custom grids', () => {
  const config = migrateProjectionConfigToV7(JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/projection-config-v1.json', import.meta.url))).valid);
  for (const side of ['left', 'right']) {
    const warp = config.outputs[side].warp;
    const legacy = structuredClone(warp); delete legacy.grid.columnPositions; delete legacy.grid.rowPositions;
    const before = structuredClone(warp);
    expect(evaluateWarpPoint(0.31, 0.62, warp, 0.2, 0.8, { side, schemaVersion: 7 }))
      .toEqual(evaluateWarpPoint(0.31, 0.62, legacy, 0.2, 0.8));
    expect(warp).toEqual(before);
  }
  const custom = structuredClone(config.outputs.left.warp); custom.grid.columnPositions[2] += 0.01;
  const before = structuredClone(custom);
  expect(() => evaluateWarpPoint(0.3, 0.6, custom, 0.2, 0.8, { side: 'left', schemaVersion: 7 })).toThrow('configurable grid point evaluation requires a trusted source mesh');
  expect(evaluateWarpPoint(0.3, 0.6, custom, 0.2, 0.8, { side: 'left', schemaVersion: 7, mesh: createIdentityProjectionMesh({ side: 'left' }) })).toHaveLength(2);
  expect(custom).toEqual(before);
  delete custom.grid.columnPositions;
  expect(() => evaluateWarpPoint(0.3, 0.6, custom, 0.2, 0.8, { side: 'left', schemaVersion: 7 })).toThrow(/invalid warp/);
});

test('nonuniform v7 knots produce relative-source render topology with exact control vertices', () => {
  const config = migrateProjectionConfigToV7(JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/projection-config-v1.json', import.meta.url))).valid);
  const warp = config.outputs.left.warp;
  warp.grid.columnPositions = [0, 0.17, 1]; warp.grid.columns = 3;
  warp.grid.rowPositions = [0, 0.61, 1]; warp.grid.rows = 3;
  warp.grid.offsets = Array.from({ length: 9 }, (_, index) => [index % 3 === 1 ? 0.04 : 0, Math.floor(index / 3) === 1 ? -0.03 : 0]);
  const before = structuredClone(warp);
  const mesh = evaluateWarpMesh(null, warp, { side: 'left', schemaVersion: 7 });
  expect(mesh.validationProfile).toBe('relative-source-v1');
  expect(mesh.vertices.length).toBeLessThanOrEqual(65536);
  expect(mesh.sampledMaxErrorPx).toBeLessThanOrEqual(0.5);
  for (const t of warp.grid.rowPositions) for (const s of warp.grid.columnPositions) {
    expect(mesh.vertices.some((point) => point.s === s && point.t === t)).toBe(true);
  }
  expect(warp).toEqual(before);
});

test('compact shared grid-render fixture fixes deterministic topology across runtimes', () => {
  const fixture=JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/projection-grid-render-parity.json',import.meta.url)));
  const result=evaluateWarpMesh(fixture.mesh,fixture.warp,{side:'left',schemaVersion:7});
  expect(result.vertices).toHaveLength(fixture.expected.vertexCount);
  expect(result.triangles).toHaveLength(fixture.expected.triangleCount*3);
  expect(result.triangles).toEqual(fixture.expected.triangles);
  expect(result.sampledMaxErrorPx).toBeLessThanOrEqual(.5);
  for(const t of fixture.warp.grid.rowPositions)for(const s of fixture.warp.grid.columnPositions)
    expect(result.vertices.some(p=>p.s===s&&p.t===t)).toBe(true);
});

test('uniform browser knots are prepared on changed TD captures', () => {
  const source = variableTdMesh('left');
  const config = migrateProjectionConfigToV7(JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/projection-config-v1.json', import.meta.url))).valid);
  const value = structuredClone(config.outputs.left.warp);
  value.baseline = { type: 'tdMesh', assetId: 'changed', sha256: 'a'.repeat(64), width: 1920, height: 1080, origin: 'top-left' };
  value.grid.offsets = value.grid.offsets.map(() => [0, 0]);
  // Include disconnected vertices at every browser knot so eligibility must
  // check triangle connectivity rather than mere coordinate presence.
  for (const t of value.grid.rowPositions) for (const s of value.grid.columnPositions) {
    source.vertices.push({ s, t, x: s, y: t, u: s, v: t });
  }

  const result = evaluateWarpMesh(source, value, { side: 'left', schemaVersion: 7 });
  const sample = createBaselineSampler(source);
  const connected = new Set(result.triangles);
  for (const t of value.grid.rowPositions) for (const s of value.grid.columnPositions) {
    const vertex = result.vertices.find((point, index) => connected.has(index) && Math.abs(point.s - s) <= 1e-12 && Math.abs(point.t - t) <= 1e-12);
    expect(vertex).toBeDefined();
    const baseline = sample(s, t);
    const point = evaluateWarpPoint(baseline.x, baseline.y, value, s, t, { side: 'left', schemaVersion: 7 });
    expect(point[0]).toBeCloseTo(vertex.x, 5);
    expect(point[1]).toBeCloseTo(vertex.y, 5);
  }
  const malformed = structuredClone(source);
  malformed.triangles[0] = malformed.vertices.length;
  expect(() => evaluateWarpMesh(malformed, value, { side: 'left', schemaVersion: 7 })).toThrow(/invalid index/);
  const missingDomain = variableTdMesh('left');
  missingDomain.triangles = missingDomain.triangles.slice(0, 6);
  expect(() => evaluateWarpMesh(missingDomain, value, { side: 'left', schemaVersion: 7 })).toThrow(/source point.*covered/);
});

test.each([
  ['5x5', [0, .25, .5, .75, 1], [0, .25, .5, .75, 1]],
  ['16x16', Array.from({ length: 16 }, (_, index) => index / 15), Array.from({ length: 16 }, (_, index) => index / 15)],
  ['rectangular nonuniform', [0, .37, 1], [0, .2, .55, .78, 1]],
])('changed sparse captures prepare %s browser layouts', (_name, columnPositions, rowPositions) => {
  const source = variableTdMesh('left');
  const config = migrateProjectionConfigToV7(JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/projection-config-v1.json', import.meta.url))).valid);
  const value = structuredClone(config.outputs.left.warp);
  value.baseline = { type: 'tdMesh', assetId: 'changed', sha256: 'a'.repeat(64), width: 1920, height: 1080, origin: 'top-left' };
  value.grid.columns = columnPositions.length; value.grid.rows = rowPositions.length;
  value.grid.columnPositions = columnPositions; value.grid.rowPositions = rowPositions;
  value.grid.offsets = Array.from({ length: columnPositions.length * rowPositions.length }, () => [0, 0]);
  const result = evaluateWarpMesh(source, value, { side: 'left', schemaVersion: 7 });
  const connected = new Set(result.triangles);
  for (const t of rowPositions) for (const s of columnPositions) {
    expect(result.vertices.some((point, index) => connected.has(index) && Math.abs(point.s - s) <= 1e-12 && Math.abs(point.t - t) <= 1e-12)).toBe(true);
  }
});

test.each(['left', 'right'])('historical uniform %s TD capture keeps its prepared mesh exactly', (side) => {
  const source = JSON.parse(readFileSync(new URL(`../../public/projection-calibration/td-baselines/${side}.json`, import.meta.url), 'utf8'));
  const config = migrateProjectionConfigToV7(JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/projection-config-v1.json', import.meta.url))).valid);
  const value = structuredClone(config.outputs[side].warp);
  value.baseline = { type: 'tdMesh', assetId: 'historical', sha256: 'a'.repeat(64), width: 1920, height: 1080, origin: 'top-left' };
  const legacy = structuredClone(value); delete legacy.grid.columnPositions; delete legacy.grid.rowPositions;
  expect(evaluateWarpMesh(source, value, { side, schemaVersion: 7 })).toEqual(evaluateWarpMesh(source, legacy, { side }));
});

test('sampled render error compares double targets with interpolated Float32 vertices',()=>{
  const fixture=JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/projection-grid-render-parity.json',import.meta.url)));
  fixture.warp.grid.offsets=fixture.warp.grid.offsets.map(()=>[.123456,.031415]);
  const result=evaluateWarpMesh(fixture.mesh,fixture.warp,{side:'left',schemaVersion:7});
  expect(result.sampledMaxErrorPx).toBeGreaterThan(0);
  expect(result.sampledMaxErrorPx).toBeLessThanOrEqual(.5);
});

test('nonuniform point sampling matches prepared knot vertices and rejects near-degenerate axes/folds',()=>{
  const fixture=JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/projection-grid-render-parity.json',import.meta.url)));
  const rendered=evaluateWarpMesh(fixture.mesh,fixture.warp,{side:'left',schemaVersion:7});
  for(const t of fixture.warp.grid.rowPositions)for(const s of fixture.warp.grid.columnPositions){
    const point=evaluateWarpPoint(0,0,fixture.warp,s,t,{side:'left',schemaVersion:7,mesh:fixture.mesh});
    const vertex=rendered.vertices.find(item=>item.s===s&&item.t===t);expect(point).toEqual([vertex.x,vertex.y]);
  }
  const tiny=structuredClone(fixture.warp);tiny.grid.columnPositions=[0,5e-11,1];
  expect(()=>evaluateWarpMesh(fixture.mesh,tiny,{side:'left',schemaVersion:7})).toThrow('source grid is numerically degenerate');
  const folded=structuredClone(fixture.warp);folded.grid.offsets=Array.from({length:9},(_,i)=>[i%3===1?-.8:0,0]);
  expect(()=>evaluateWarpMesh(fixture.mesh,folded,{side:'left',schemaVersion:7})).toThrow('grid warp folds or collapses a triangle');
  const pole=structuredClone(fixture.warp);const slope=1/.513,scale=.001;pole.keystone.corners=[[0,0],[scale/(1-slope),0],[0,scale],[scale/(1-slope),scale/(1-slope)]];
  expect(()=>evaluateWarpMesh(fixture.mesh,pole,{side:'left',schemaVersion:7})).toThrow(/projective denominator/);
});

test('global source sampling retains coverage on a near-bin-boundary interior knot',()=>{
  const fixture=JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/projection-grid-render-parity.json',import.meta.url)));
  const warp=structuredClone(fixture.warp);warp.grid.columns=3;warp.grid.rows=2;
  warp.grid.columnPositions=[0,.5-1e-14,1];warp.grid.rowPositions=[0,1];warp.grid.offsets=Array.from({length:6},()=>[0,0]);
  const mesh=evaluateWarpMesh(fixture.mesh,warp,{side:'left',schemaVersion:7});
  expect(mesh.triangles.length).toBeGreaterThan(0);
  expect(mesh.sampledMaxErrorPx).toBeLessThanOrEqual(.5);
  expect(evaluateWarpPoint(0,0,warp,.5,.5,{side:'left',schemaVersion:7,mesh:fixture.mesh})).toEqual([.5,.5]);
});

test('compiled global probe retains every tolerance-incident face at a bin edge',()=>{
  const vertices=[{s:0,t:0,x:0,y:0,u:0,v:0},{s:1,t:0,x:1,y:0,u:1,v:0},{s:0,t:1,x:0,y:1,u:0,v:1},{s:1,t:1,x:1,y:1,u:1,v:1}];
  const faces=[{v:[0,1,2],tri:0,cell:0},{v:[0,1,2],tri:0,cell:1},{v:[2,1,3],tri:1,cell:0},{v:[2,1,3],tri:1,cell:1}];
  const state=compileSourceProbeState(vertices,faces,[0,.5-1e-14,1],[0,1],(s,t,triangleId)=>({s,t,x:s,y:t,u:s,v:t,triangleId}));
  const check=state.globalChecks.find(item=>item.s===.5&&item.t===.5);
  expect(check.incident.map(item=>item.faceId)).toEqual([0,1,2,3]);
});

test('refinement hard limit rejects without returning partial topology',()=>{
  const fixture=JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/projection-grid-render-parity.json',import.meta.url)));
  fixture.warp.grid.offsets=fixture.warp.grid.offsets.map((_,i)=>[i===4?.01:0,0]);
  expect(()=>prepareGridWarpMesh(fixture.mesh,fixture.warp,{side:'left',tolerancePx:1e-9})).toThrow(/vertex capacity exceeded|refinement did not meet/);
});

test('nonuniform residual grids prepare both trusted dense TD outputs within sampled tolerance',()=>{
  const config=migrateProjectionConfigToV7(JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/projection-config-v1.json',import.meta.url))).valid);
  for(const side of ['left','right']){
    const baseline=JSON.parse(readFileSync(new URL(`../../public/projection-calibration/td-baselines/${side}.json`,import.meta.url)));
    const warp=structuredClone(config.outputs[side].warp),positions=[0,.16,.52,.77,1];
    warp.keystone.corners=[[0,0],[1,0],[0,1],[1,1]];
    warp.grid.columns=5;warp.grid.rows=5;warp.grid.columnPositions=positions;warp.grid.rowPositions=[0,.22,.54,.8,1];
    warp.grid.offsets=Array.from({length:25},(_,i)=>{const c=i%5,r=Math.floor(i/5);return [.001*c*r,-.001*c*r];});
    const before=structuredClone(warp),rendered=evaluateWarpMesh(baseline,warp,{side,schemaVersion:7});
    expect(rendered.side).toBe(side);expect(rendered.validationProfile).toBe('relative-source-v1');
    expect(rendered.vertices.length).toBeLessThanOrEqual(65536);expect(rendered.sampledMaxErrorPx).toBeLessThanOrEqual(.5);
    for(const t of warp.grid.rowPositions)for(const s of positions)expect(rendered.vertices.some(p=>p.s===s&&p.t===t)).toBe(true);
    expect(warp).toEqual(before);
  }
});

test('zero corrections preserve source mapping and UVs at independent samples on variable TD meshes', () => {
  const warp = migrateProjectionConfigToV7(JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/projection-config-v1.json', import.meta.url))).valid).outputs.left.warp;
  const source = variableTdMesh('left');
  warp.baseline = { type: 'tdMesh', assetId: 'variable-left', sha256: 'a'.repeat(64), width: 1920, height: 1080, origin: 'top-left' };
  const result = evaluateWarpMesh(source, warp, { side: 'left', schemaVersion: 7 });
  const preparedSampler = createBaselineSampler(result);
  const samples = [[0,0],[.5,1/3],[1,1],[.25,.5]];
  for (const [s,t] of samples) {
    const expected = createBaselineSampler(source)(s,t);
    const rendered = preparedSampler(s,t);
    expect(rendered.x).toBeCloseTo(expected.x, 11);
    expect(rendered.y).toBeCloseTo(expected.y, 11);
    expect(rendered.u).toBeCloseTo(expected.u, 11);
    expect(rendered.v).toBeCloseTo(expected.v, 11);
    const actual = evaluateWarpPoint(expected.x, expected.y, warp, s, t, { side: 'left', schemaVersion: 7, mesh: source });
    expect(actual[0]).toBeCloseTo(expected.x, 11);
    expect(actual[1]).toBeCloseTo(expected.y, 11);
  }
  expect(result.validationProfile).toBe('relative-source-v1');
});

test('rendered-layout comparison reports deterministic sampled pixel differences',()=>{
  const fixture=JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/projection-grid-render-parity.json',import.meta.url)));
  const same=compareRenderedLayouts(fixture.mesh,fixture.warp,fixture.warp,{side:'left'});
  expect(same.maximumDifferencePx).toBe(0);expect(same.comparison).toBe('sampled-only');
  const changed=structuredClone(fixture.warp);changed.grid.offsets[4]=[.01,.005];
  const different=compareRenderedLayouts(fixture.mesh,fixture.warp,changed,{side:'left'});
  expect(different.maximumDifferencePx).toBeGreaterThan(0);expect(different.sampleCount).toBeGreaterThan(1000);
});

test('rectangular 3-by-5 grid keeps row-major cells and control sampling aligned',()=>{
  const fixture=JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/projection-grid-render-parity.json',import.meta.url)));
  const warp=structuredClone(fixture.warp),xs=[0,.37,1],ys=[0,.2,.55,.78,1];
  warp.grid.columns=3;warp.grid.rows=5;warp.grid.columnPositions=xs;warp.grid.rowPositions=ys;
  warp.grid.offsets=Array.from({length:15},(_,i)=>[.0005*(i%3)*Math.floor(i/3),-.0003*(i%3)*Math.floor(i/3)]);
  const mesh=evaluateWarpMesh(fixture.mesh,warp,{side:'left',schemaVersion:7});
  expect(mesh.sampledMaxErrorPx).toBeLessThanOrEqual(.5);
  for(const t of ys)for(const s of xs){const v=mesh.vertices.find(p=>p.s===s&&p.t===t);expect(v).toBeTruthy();expect(evaluateWarpPoint(0,0,warp,s,t,{side:'left',schemaVersion:7,mesh:fixture.mesh})).toEqual([v.x,v.y]);}
});

test('accepted nonidentity refinement matches the shared all-attribute cross-runtime fixture', () => {
  const expected = JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/projection-grid-refinement-parity.json', import.meta.url)));
  const result = evaluateWarpMesh(expected.mesh, expected.warp, { side: 'left', schemaVersion: 7 });
  expect(result.triangles).toEqual(expected.triangles);
  expect(result.vertices).toHaveLength(expected.vertices.length);
  for (let index = 0; index < result.vertices.length; index += 1) {
    for (const key of ['s', 't', 'x', 'y', 'u', 'v']) expect(result.vertices[index][key]).toBeCloseTo(expected.vertices[index][key], 10);
  }
  expect(result.sampledMaxErrorPx).toBeLessThanOrEqual(0.5);
});

test('configurable identity without an imported mesh uses the full-frame source topology', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/projection-grid-render-parity.json', import.meta.url)));
  const identity = structuredClone(fixture.warp);
  identity.grid.offsets = identity.grid.offsets.map(() => [0, 0]);
  const implicit = evaluateWarpMesh(null, identity, { side: 'left', schemaVersion: 7 });
  const explicit = evaluateWarpMesh(createFullFrameProjectionMesh({ side: 'left' }), identity, { side: 'left', schemaVersion: 7 });
  expect(implicit.vertices).toEqual(explicit.vertices);
  expect(implicit.triangles).toEqual(explicit.triangles);
});

test('relative-source validation rejects insufficient Float32 area ratio consistently', () => {
  const mesh = { width: 1920, height: 1080, validationProfile: 'relative-source-v1', vertices: [
    { s: 0, t: 0, x: .6113237719982862, y: .9376534202601761, u: 0, v: 0 },
    { s: 1, t: 0, x: .7954265424050391, y: .6015647205058485, u: 1, v: 0 },
    { s: 0, t: 1, x: .7312631888714295, y: .7186981057826362, u: 0, v: 1 },
  ], triangles: [0, 1, 2] };
  expect(() => validateWarpMesh(mesh)).toThrow('render precision collapses or inverts a grid triangle');
});

test('candidate cache returns defensive results and fingerprints mutable baseline data', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/projection-grid-render-parity.json', import.meta.url)));
  const baseline = structuredClone(fixture.mesh);
  const candidate = structuredClone(fixture.warp);
  const original = evaluateWarpMesh(baseline, candidate, { side: 'left', schemaVersion: 7 });
  const expectedUv = original.vertices.find((point) => point.s === 0 && point.t === 0).u;
  original.vertices[0].x = 999;
  for (let index = 1; index <= 4; index += 1) {
    const changed = structuredClone(candidate);
    changed.grid.offsets[4] = [index * 1e-4, index * -1e-4];
    evaluateWarpMesh(baseline, changed, { side: 'left', schemaVersion: 7 });
  }
  const afterEviction = evaluateWarpMesh(baseline, candidate, { side: 'left', schemaVersion: 7 });
  expect(afterEviction.vertices[0].x).not.toBe(999);
  expect(afterEviction.vertices.find((point) => point.s === 0 && point.t === 0).u).toBe(expectedUv);
  const changedKeystone = structuredClone(candidate);
  changedKeystone.keystone.corners = [[0, 0], [.98, .02], [.02, .97], [1, 1]];
  const changedResult = evaluateWarpMesh(baseline, changedKeystone, { side: 'left', schemaVersion: 7 });
  const freshResult = evaluateWarpMesh(structuredClone(baseline), structuredClone(changedKeystone), { side: 'left', schemaVersion: 7 });
  expect(changedResult.triangles).toEqual(freshResult.triangles);
  expect(changedResult.vertices).toEqual(freshResult.vertices);
  baseline.vertices[0] = { ...baseline.vertices[0], u: baseline.vertices[0].u + .01 };
  const afterBaselineMutation = evaluateWarpMesh(baseline, candidate, { side: 'left', schemaVersion: 7 });
  const freshBaseline = evaluateWarpMesh(structuredClone(baseline), structuredClone(candidate), { side: 'left', schemaVersion: 7 });
  expect(afterBaselineMutation.vertices).toEqual(freshBaseline.vertices);
  expect(afterBaselineMutation.triangles).toEqual(freshBaseline.triangles);
  expect(afterBaselineMutation.sampledMaxErrorPx).toBe(freshBaseline.sampledMaxErrorPx);
  expect(afterBaselineMutation.vertices.find((point) => point.s === 0 && point.t === 0).u).toBeCloseTo(expectedUv + .01, 10);
});

test('public point evaluation rebuilds sampler after replacing baseline destination coordinates', () => {
  const fixture=JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/projection-grid-render-parity.json',import.meta.url)));
  const baseline=structuredClone(fixture.mesh);
  evaluateWarpPoint(0,0,fixture.warp,0,0,{side:'left',schemaVersion:7,mesh:baseline});
  baseline.vertices[0]={...baseline.vertices[0],x:baseline.vertices[0].x+.01};
  const actual=evaluateWarpPoint(0,0,fixture.warp,0,0,{side:'left',schemaVersion:7,mesh:baseline});
  const expected=evaluateWarpPoint(0,0,fixture.warp,0,0,{side:'left',schemaVersion:7,mesh:structuredClone(baseline)});
  expect(actual).toEqual(expected);
});
