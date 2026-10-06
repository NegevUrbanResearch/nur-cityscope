import { expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fitProjectionKeystone, measureProjectionLandmarks, pickProjectionLandmark } from '../../frontend/src/shared/projection-point-fit.js';
import { createBaselineSampler } from '../../frontend/src/shared/projection-baseline-sampler.js';
import { createFullFrameProjectionMesh, evaluateWarpMesh } from '../../frontend/src/shared/projection-warp-geometry.js';
import { migrateProjectionConfigToV7 } from '../../frontend/src/shared/projection-config-schema.js';
import { prepareProjectionSideMesh } from '../../frontend/src/projection/projection-candidate-validation.js';
import { variableTdMesh } from '../fixtures/td-variable-grid.js';

const roadJunctions = [[0.213, 0.237], [0.787, 0.193], [0.181, 0.773], [0.819, 0.827]];
const perspective = [[0.06, 0.03], [0.91, 0.13], [0.13, 0.91], [0.83, 0.82]];
function configFixture() {
  const config = migrateProjectionConfigToV7(JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/projection-config-v1.json', import.meta.url))).valid);
  for (const side of ['left', 'right']) config.outputs[side].warp.baseline = { type: 'identity', width: 1920, height: 1080, origin: 'top-left' };
  return config;
}
function prepared(config, baselineMesh = null, output = 'left') {
  const warp = config.outputs[output].warp;
  return evaluateWarpMesh(warp.baseline.type === 'tdMesh' ? baselineMesh : null, warp, { side: output, schemaVersion: config.schemaVersion });
}
function anchorsFor(config, baselineMesh = null, output = 'left') {
  const sample = createBaselineSampler(prepared(config, baselineMesh, output));
  return roadJunctions.map(([s, t], i) => {
    const p = sample(s, t);
    return { id: i + 1, s, t, targetPx: [p.x * 1920, p.y * 1080], recorded: true };
  });
}
// Independent, unnormalized elimination for the zero-grid identity fixture.
// This constructs the analytic seed so the regression proves its render error.
function identityAlgebraicSeed(anchors) {
  const rows = anchors.flatMap(({s:x,t:y,targetPx:[px,py]}) => {
    const u=px/1920,v=py/1080;
    return [[x,y,1,0,0,0,-x*u,-y*u,u],[0,0,0,x,y,1,-x*v,-y*v,v]];
  });
  for(let column=0;column<8;column++) {
    let pivot=column;
    for(let i=column+1;i<8;i++)if(Math.abs(rows[i][column])>Math.abs(rows[pivot][column]))pivot=i;
    [rows[column],rows[pivot]]=[rows[pivot],rows[column]];
    const divisor=rows[column][column];
    rows[column]=rows[column].map(v=>v/divisor);
    for(let i=0;i<8;i++)if(i!==column) {
      const factor=rows[i][column];
      rows[i]=rows[i].map((v,k)=>v-factor*rows[column][k]);
    }
  }
  const h=rows.map(row=>row[8]);
  return [[0,0],[1,0],[0,1],[1,1]].map(([x,y])=>{
    const d=h[6]*x+h[7]*y+1;
    return [(h[0]*x+h[1]*y+h[2])/d,(h[3]*x+h[4]*y+h[5])/d];
  });
}
async function assertFit(config, candidate, baselineMesh = null, options = {}) {
  const anchors = anchorsFor(candidate, baselineMesh, options.output);
  const before = structuredClone({ config, anchors, baselineMesh });
  const result = await fitProjectionKeystone({ config, output: 'left', baselineMesh, anchors, ...options });
  expect(result, result.message).toMatchObject({ ok: true });
  const errors = measureProjectionLandmarks({ preparedMesh: prepared(result.config, baselineMesh, options.output), anchors });
  expect(Math.max(...errors.map(p => p.errorPx))).toBeLessThanOrEqual(0.5);
  expect(result.renderedErrorsPx).toEqual(errors.map(p => p.errorPx));
  expect(result.maxRenderedErrorPx).toBe(Math.max(...result.renderedErrorsPx));
  const restored = structuredClone(result.config);
  restored.outputs[options.output || 'left'].warp.keystone = config.outputs[options.output || 'left'].warp.keystone;
  expect(restored).toEqual(config);
  expect({ config, anchors, baselineMesh }).toEqual(before);
  return result;
}

test('identity fit preserves the complete source config and reaches texture-interior anchors', async () => {
  const config = configFixture();
  const result = await assertFit(config, config);
  expect(result.config).toEqual(config);
});

test('joint fit reaches four non-corner road junction targets instead of copying them into corners', async () => {
  const config = configFixture(), candidate = structuredClone(config);
  candidate.outputs.left.warp.keystone.corners = perspective;
  const seed=structuredClone(config),anchors=anchorsFor(candidate);
  seed.outputs.left.warp.keystone.corners=identityAlgebraicSeed(anchors);
  const seedError=Math.max(...measureProjectionLandmarks({preparedMesh:prepared(seed),anchors}).map(p=>p.errorPx));
  expect(seedError).toBeGreaterThan(.5);
  let yields = 0;
  const result = await assertFit(config, candidate, null, { yieldControl: async () => { yields++; } });
  expect(yields).toBeGreaterThan(0); // The algebraic seed needs rendered-triangle correction.
  const targets = anchorsFor(candidate).map(p => [p.targetPx[0] / 1920, p.targetPx[1] / 1080]);
  for (let i = 0; i < 4; i++) expect(Math.hypot(...result.config.outputs.left.warp.keystone.corners[i].map((v, k) => v - targets[i][k]))).toBeGreaterThan(0.1);
});

test('imported unequal u/v and s/t mesh fits source landmarks without changing UVs or framing', async () => {
  const config = configFixture(), baselineMesh = variableTdMesh('left');
  config.outputs.left.warp.baseline = { type: 'tdMesh', assetId: 'fixture-left', sha256: 'a'.repeat(64), width: 1920, height: 1080, origin: 'top-left' };
  const candidate = structuredClone(config);
  candidate.outputs.left.warp.keystone.corners = perspective;
  expect(baselineMesh.vertices.some(p => p.u !== p.s || p.v !== p.t)).toBe(true);
  await assertFit(config, candidate, baselineMesh);
});

test('nonuniform identity grid uses the real null-source dispatch even with a retained TD mesh', async () => {
  const config = configFixture();
  config.outputs.left.warp.grid.columnPositions[2] += 0.035;
  config.outputs.left.warp.grid.rowPositions[3] -= 0.025;
  config.outputs.left.warp.grid.offsets[16] = [0.008, -0.006];
  const candidate = structuredClone(config);
  candidate.outputs.left.warp.keystone.corners = perspective;
  const result = await assertFit(config, candidate, variableTdMesh('left'));
  expect(prepared(result.config)).toEqual(prepareProjectionSideMesh(result.config, 'left').mesh);
});

test('right-side fit preserves left output and reference pixel measurements', async () => {
  const config = configFixture(), candidate = structuredClone(config);
  candidate.outputs.right.warp.keystone.corners = perspective;
  await assertFit(config, candidate, null, { output: 'right' });
});

test.each([
  ['duplicate', [[.2,.2],[.2,.2],[.8,.2],[.8,.8]]],
  ['collinear', [[.2,.2],[.4,.4],[.6,.6],[.8,.8]]],
  ['nearly collinear triple', [[.2,.2],[.4,.40000001],[.6,.6],[.8,.3]]],
  ['clustered', [[.2,.2],[.200001,.2],[.2,.200001],[.200001,.200001]]],
])('rejects %s landmarks without exposing a candidate', async (_, points) => {
  const anchors = points.map(([s,t],i) => ({ id: i+1, s, t, targetPx: [s*1920,t*1080], recorded: true }));
  expect(await fitProjectionKeystone({ config: configFixture(), output: 'left', anchors })).toMatchObject({ ok: false, reason: 'conditioning' });
});

test('optional measured checkpoints do not participate in the four-anchor solve', async () => {
  const config = configFixture(), anchors = anchorsFor(config);
  anchors.push({ id: 5, s: .4, t: .5, targetPx: [0,0], recorded: true });
  const result = await fitProjectionKeystone({ config, output: 'left', anchors });
  expect(result.ok).toBe(true);
  expect(result.renderedErrorsPx).toHaveLength(4);
  expect(measureProjectionLandmarks({ preparedMesh: prepared(result.config), anchors })[4].errorPx).toBeGreaterThan(100);
});

test('finite out-of-frame targets clamp to reference pixels without mutating captured anchors', async () => {
  const config = configFixture(), anchors = anchorsFor(config);
  anchors[0].targetPx = [-0.01, anchors[0].targetPx[1]];
  const before = structuredClone(anchors);
  const result = await fitProjectionKeystone({ config, output: 'left', anchors });
  expect(result.ok).toBe(true);
  expect(anchors).toEqual(before);
  const measured = measureProjectionLandmarks({ preparedMesh: prepared(result.config), anchors: [{ ...anchors[0], targetPx: [0, anchors[0].targetPx[1]] }] });
  expect(measured[0].errorPx).toBeLessThanOrEqual(.5);
});

test('warp bypass, malformed anchors and invalid meshes fail with bounded messages', async () => {
  const config = configFixture(), anchors = anchorsFor(config);
  config.outputs.left.warp.enabled = false;
  expect(await fitProjectionKeystone({ config, output: 'left', anchors })).toMatchObject({ ok: false, reason: 'bypassed' });
  config.outputs.left.warp.enabled = true;
  for (const malformed of [anchors.slice(1), anchors.map(p => ({...p, recorded: false})), [{...anchors[0], targetPx:[NaN,0]},...anchors.slice(1)]]) {
    const result = await fitProjectionKeystone({ config, output: 'left', anchors: malformed });
    expect(result.ok).toBe(false); expect(result.config).toBeUndefined(); expect(result.message.length).toBeLessThanOrEqual(240);
  }
  config.outputs.left.warp.baseline = {type:'tdMesh',assetId:'test',sha256:'a'.repeat(64),width:1920,height:1080,origin:'top-left'};
  expect(await fitProjectionKeystone({ config, output:'left', anchors, baselineMesh: {} })).toMatchObject({ ok:false, reason:'mesh' });
});

test('aborted and changed inputs during a yield cannot return a candidate', async () => {
  const config = configFixture(), candidate = structuredClone(config);
  candidate.outputs.left.warp.keystone.corners = perspective;
  const anchors = anchorsFor(candidate), controller = new AbortController();
  controller.abort();
  expect(await fitProjectionKeystone({ config, output:'left', anchors, signal:controller.signal })).toMatchObject({ok:false, reason:'cancelled'});
  expect(await fitProjectionKeystone({ config, output:'left', anchors, yieldControl: async () => { anchors[0].targetPx[0]++; } })).toMatchObject({ok:false,reason:'stale'});
  const midFit = new AbortController();
  expect(await fitProjectionKeystone({ config, output:'left', anchors, signal:midFit.signal, yieldControl: async () => { midFit.abort(); } })).toMatchObject({ok:false,reason:'cancelled'});
});

test.each(['left', 'right'])('legacy containing-triangle correction has full-render parity on historical %s assets', async output => {
  const baselineMesh = JSON.parse(readFileSync(new URL(`../../public/projection-calibration/td-baselines/${output}.json`, import.meta.url)));
  const manifest = JSON.parse(readFileSync(new URL('../../public/projection-calibration/td-baselines/manifest.json', import.meta.url)));
  const config = configFixture(), asset = manifest.assets[output];
  config.outputs[output].warp.baseline = {type:'tdMesh',assetId:asset.assetId,sha256:asset.sha256,width:1920,height:1080,origin:'top-left'};
  config.outputs[output].warp.grid.offsets[16] = [.004, -.003];
  const candidate = structuredClone(config); candidate.outputs[output].warp.keystone.corners = perspective;
  const result = await assertFit(config, candidate, baselineMesh, {output, maxErrorPx: .00001});
  expect(result.maxRenderedErrorPx).toBeLessThanOrEqual(.00001);
});

test('baseline metadata changed during a yield is stale even when source vertices are unchanged', async () => {
  const config = configFixture(), baselineMesh = variableTdMesh('left');
  config.outputs.left.warp.baseline = {type:'tdMesh',assetId:'test',sha256:'a'.repeat(64),width:1920,height:1080,origin:'top-left'};
  const candidate = structuredClone(config); candidate.outputs.left.warp.keystone.corners = perspective;
  const anchors = anchorsFor(candidate, baselineMesh);
  const result = await fitProjectionKeystone({config,output:'left',baselineMesh,anchors,yieldControl:async()=>{baselineMesh.side='right';}});
  expect(result).toMatchObject({ok:false,reason:'stale'});
});

test('wrong-side trusted baseline is rejected before fitting', async () => {
  const config = configFixture(), anchors = anchorsFor(config);
  config.outputs.left.warp.baseline = {type:'tdMesh',assetId:'test',sha256:'a'.repeat(64),width:1920,height:1080,origin:'top-left'};
  expect(await fitProjectionKeystone({config,output:'left',baselineMesh:variableTdMesh('right'),anchors})).toMatchObject({ok:false,reason:'mesh'});
});

test('crossed landmark targets fail geometry validation without exposing a candidate', async () => {
  const config = configFixture(), anchors = anchorsFor(config);
  [anchors[1].targetPx, anchors[2].targetPx] = [anchors[2].targetPx, anchors[1].targetPx];
  const result = await fitProjectionKeystone({config,output:'left',anchors});
  expect(result.ok).toBe(false); expect(result.config).toBeUndefined();
});

test('adaptive nonuniform identity corrections retain actual-render accuracy', async () => {
  const config=configFixture();
  config.outputs.left.warp.grid={columns:3,rows:3,columnPositions:[0,.42,1],rowPositions:[0,.57,1],offsets:Array.from({length:9},()=>[0,0])};
  config.outputs.left.warp.grid.offsets[4]=[.004,-.003];
  const candidate=structuredClone(config);candidate.outputs.left.warp.keystone.corners=perspective;
  // Only elapsed time is controlled: every preparation, triangle, Jacobian
  // and final measurement stays real. Deadline rejection is tested separately.
  const timer=vi.spyOn(performance,'now').mockReturnValue(0);
  try {
    let yields=0;
    const result=await assertFit(config,candidate,null,{maxErrorPx:.05,yieldControl:async()=>{yields++;}});
    expect(result.maxRenderedErrorPx).toBeLessThanOrEqual(.05);
    expect(yields).toBeGreaterThan(2); // More than current + algebraic preparation.
  } finally { timer.mockRestore(); }
});

test('adaptive fitting rejects expired work without returning partially fitted geometry', async () => {
  const config=configFixture();config.outputs.left.warp.grid.columnPositions[2]+=.035;
  const anchors=anchorsFor(config);
  let elapsed=0;
  const timer=vi.spyOn(performance,'now').mockImplementation(()=>elapsed);
  try {
    const result=await fitProjectionKeystone({config,output:'left',anchors,yieldControl:async()=>{elapsed=2001;}});
    expect(result).toMatchObject({ok:false,reason:'performance'});
    expect(result.config).toBeUndefined();
    expect(result.message.length).toBeLessThanOrEqual(240);
  } finally { timer.mockRestore(); }
});

test('landmark picker uses rendered source parameters and preserves inversion rejection outcomes', () => {
  const mesh = variableTdMesh('left'), p = createBaselineSampler(mesh)(.213,.237);
  expect(pickProjectionLandmark({ evaluatedMesh:mesh, outputPointPx:[p.x*1920,p.y*1080] })).toMatchObject({ok:true,s:expect.closeTo(.213,8),t:expect.closeTo(.237,8)});
  expect(pickProjectionLandmark({ evaluatedMesh:mesh, outputPointPx:[-1920,-1080] })).toEqual({ok:false,reason:'outside'});
  expect(pickProjectionLandmark({ evaluatedMesh:{}, outputPointPx:[0,0] })).toEqual({ok:false,reason:'degenerate'});
  const overlap = createFullFrameProjectionMesh();
  overlap.vertices.push(...overlap.vertices.map(p => ({...p,s:p.s*.5,t:p.t*.5})));
  overlap.triangles.push(4,5,6,6,5,7);
  expect(pickProjectionLandmark({ evaluatedMesh:overlap, outputPointPx:[400,300] })).toEqual({ok:false,reason:'ambiguous'});
});

test('measuring returns independent pixel residuals for checkpoints', () => {
  const anchors = [{id:5,s:.25,t:.5,targetPx:[483,544]}];
  expect(measureProjectionLandmarks({preparedMesh:createFullFrameProjectionMesh(),anchors})).toEqual([{id:5,renderedPx:[480,540],targetPx:[483,544],errorPx:5}]);
});
