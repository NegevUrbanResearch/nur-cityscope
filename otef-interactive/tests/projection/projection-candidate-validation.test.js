import { describe, expect, test, vi } from 'vitest';
import { DEFAULT_PROJECTION_CONFIG } from '../../frontend/src/shared/projection-config-schema.js';
import { createIdentityProjectionMesh } from '../../frontend/src/shared/projection-warp-geometry.js';
import { createProjectionCandidateValidator, createProjectionGeometryValidator, prepareProjectionPairMeshes, projectionCandidateResult, readProjectionCandidateInputs } from '../../frontend/src/projection/projection-candidate-validation.js';

const config = () => structuredClone(DEFAULT_PROJECTION_CONFIG);
const inputs = { heading: 35, datasetVersion: 'validation-fixture' };
function field(candidate = config()) {
  const requestedFontPx = candidate.namesWall.profiles[candidate.namesWall.activeMode].requestedFontPx;
  return { datasetVersion: inputs.datasetVersion, heading: inputs.heading, digest: 'a'.repeat(64), diagnostics: {
    state: 'valid', expected: 1, placed: 1, missing: 0, extra: 0, duplicate: 0, left: 1, right: 0,
    requestedFontPx, effectiveFontPx: requestedFontPx,
  } };
}
function fixture(overrides = {}) {
  const candidate = config();
  const loadBaseline = vi.fn(async (side) => ({ mesh: { side }, manifest: { assets: {} } }));
  const prepareWall = vi.fn(async () => field(candidate));
  const readInputs = vi.fn(async () => inputs);
  const disposePreparation = vi.fn();
  const validator = createProjectionCandidateValidator({ loadBaseline, prepareWall, readInputs, disposePreparation, ...overrides });
  const request = () => ({ config: candidate, identity: JSON.stringify(candidate), revision: 3, generation: 1 });
  return { candidate, loadBaseline, prepareWall, readInputs, disposePreparation, validator, request };
}

describe('candidate result', () => {
  test('accepts one complete current wall and bounds diagnostics', () => {
    const candidate = config();
    expect(projectionCandidateResult(candidate, field(candidate), JSON.stringify(candidate))).toMatchObject({
      valid: true, wall: { datasetVersion: inputs.datasetVersion, digest: 'a'.repeat(64), expected: 1, placed: 1, mode: candidate.namesWall.activeMode },
    });
  });
  test.each([
    ['duplicate', { diagnostics: { duplicate: 1 } }],
    ['missing', { diagnostics: { missing: 1, placed: 0 } }],
    ['extra', { diagnostics: { extra: 1 } }],
    ['wrong dataset', { datasetVersion: 'other' }],
    ['wrong mode', { mode: 'other' }],
    ['wrong active mode', { diagnostics: { activeMode: 'other' } }],
    ['bad digest', { digest: 'bad' }],
  ])('rejects %s', (_label, change) => {
    const candidate = config(); const value = field(candidate);
    if (change.diagnostics) Object.assign(value.diagnostics, change.diagnostics);
    else Object.assign(value, change);
    expect(projectionCandidateResult(candidate, value, JSON.stringify(candidate), inputs.datasetVersion).valid).toBe(false);
  });
  test('rejects a complete result computed for another heading', () => {
    const candidate = config(); const value = field(candidate); value.heading = 36;
    const result = projectionCandidateResult(candidate, value, JSON.stringify(candidate), inputs.datasetVersion, inputs.heading);
    expect(result).toMatchObject({ valid: false, reason: expect.stringMatching(/heading/i) });
    expect(result.diagnostics).toBeUndefined();
  });
  test('treats contradictory valid counts as unavailable computation', () => {
    const candidate = config(); const value = field(candidate);
    value.diagnostics.left = 0; value.diagnostics.right = 0;
    const result = projectionCandidateResult(candidate, value, JSON.stringify(candidate), inputs.datasetVersion, inputs.heading);
    expect(result).toMatchObject({ valid: false, reason: expect.stringMatching(/inconsistent/i) });
    expect(result.diagnostics).toBeUndefined();
  });
  test('keeps worker-reported invalid geometry distinct from unavailable computation', () => {
    const candidate = config(); const value = field(candidate);
    value.diagnostics.state = 'invalid'; value.diagnostics.extra = 1;
    expect(projectionCandidateResult(candidate, value, JSON.stringify(candidate), inputs.datasetVersion, inputs.heading)).toMatchObject({
      valid: false, diagnostics: { state: 'invalid' },
    });
  });
});

describe('current candidate inputs', () => {
  test('reads dataset identity only and ignores stored rotation', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ release: { datasetVersion: 'release-2' } }) }));
    expect(await readProjectionCandidateInputs({ storage: { getItem: () => '42' }, fetchImpl, signal: undefined })).toEqual({ datasetVersion: 'release-2' });
    expect(fetchImpl).toHaveBeenCalledWith('/otef-interactive/public/processed/layers/nli/release-metadata.json', expect.objectContaining({ cache: 'no-store' }));
  });
  test('fails closed when release metadata is missing', async () => {
    await expect(readProjectionCandidateInputs({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }) })).rejects.toThrow(/dataset identity/);
    await expect(readProjectionCandidateInputs({ fetchImpl: async () => ({ ok: false }) })).rejects.toThrow(/metadata unavailable/);
  });
});

describe('candidate validator', () => {
  test('prepares one pair and one field with both meshes and current inputs', async () => {
    const f = fixture();
    const result = await f.validator.validateCandidate(f.request());
    expect(result.valid).toBe(true);
    expect(f.prepareWall).toHaveBeenCalledOnce();
    expect(f.prepareWall.mock.calls[0][0]).toMatchObject({ config: f.candidate, meshes: { left: expect.any(Object), right: expect.any(Object) }, datasetVersion: inputs.datasetVersion });
    expect(f.prepareWall.mock.calls[0][0]).not.toHaveProperty('heading');
    expect(f.readInputs).toHaveBeenCalledTimes(2);
    f.validator.dispose();
  });
  test('rejects stale JSON and schema before preparation', async () => {
    const f = fixture();
    expect((await f.validator.validateCandidate({ ...f.request(), identity: '{}' })).valid).toBe(false);
    const invalid = { ...f.request(), config: { ...f.candidate, schemaVersion: 99 } };
    expect((await f.validator.validateCandidate({ ...invalid, identity: JSON.stringify(invalid.config) })).valid).toBe(false);
    expect(f.prepareWall).not.toHaveBeenCalled(); f.validator.dispose();
  });
  test('detects input changes during preparation even with identical candidate JSON', async () => {
    let version = inputs.datasetVersion;
    const f = fixture({ readInputs: async () => ({ heading: 35, datasetVersion: version }), prepareWall: async () => { version = 'next'; return field(); } });
    expect((await f.validator.validateCandidate(f.request())).valid).toBe(false);
    f.validator.dispose();
  });
  test('rejects a delayed old-angle result against the candidate rotation, not stored heading', async () => {
    let prepared;
    const readInputs = vi.fn(async () => ({ heading: 35, datasetVersion: inputs.datasetVersion }));
    const f = fixture({
      prepareWall: async (request) => { prepared = request; return { ...field(), heading: 35 }; },
      readInputs,
    });
    f.candidate.namesWall.rotateDeg = 70;
    const result = await f.validator.validateCandidate({ config: f.candidate, identity: JSON.stringify(f.candidate), revision: 3, generation: 1 });
    expect(result).toMatchObject({ valid: false, reason: expect.stringMatching(/heading/i) });
    expect(prepared).not.toHaveProperty('heading');
    expect(prepared.config.namesWall.rotateDeg).toBe(70);
    expect(readInputs).toHaveBeenCalledTimes(2);
    f.validator.dispose();
  });
  test('a failed rotation preparation keeps the previous complete inputs', async () => {
    const f = fixture();
    expect((await f.validator.validateCandidate(f.request())).valid).toBe(true);
    const previous = f.validator.getLastInputs();
    expect(previous).toEqual({ datasetVersion: inputs.datasetVersion });
    const turned = structuredClone(f.candidate);
    turned.namesWall.rotateDeg = 70;
    f.prepareWall.mockImplementation(async () => { throw new Error('wall failed'); });
    const failed = await f.validator.validateCandidate({ config: turned, identity: JSON.stringify(turned), revision: 4, generation: 2 });
    expect(failed.valid).toBe(false);
    expect(f.validator.getLastInputs()).toEqual(previous);
    f.validator.dispose();
  });
  test('rejects complete preparation for a different heading when current inputs stay unchanged', async () => {
    const f = fixture({ prepareWall: async () => ({ ...field(), heading: 36 }) });
    const result = await f.validator.validateCandidate(f.request());
    expect(result).toMatchObject({ valid: false, reason: expect.stringMatching(/heading/i) });
    expect(f.readInputs).toHaveBeenCalledTimes(2);
    f.validator.dispose();
  });
  test('terminates owned work on supersession before starting its replacement', async () => {
    let started = 0; let release;
    const f = fixture({ prepareWall: vi.fn(async ({ signal }) => {
      started++;
      if (started === 1) await new Promise((resolve) => { release = resolve; signal.addEventListener('abort', resolve); });
      return field();
    }) });
    const first = f.validator.validateCandidate(f.request());
    await vi.waitFor(() => expect(started).toBe(1));
    const second = f.validator.validateCandidate({ ...f.request(), generation: 2 });
    expect(f.disposePreparation).toHaveBeenCalledTimes(1);
    expect((await first).valid).toBe(false);
    expect((await second).valid).toBe(true);
    expect(f.disposePreparation).toHaveBeenCalledTimes(1);
    release(); f.validator.dispose();
  });
  test('times out, aborts, and disposes underlying preparation', async () => {
    vi.useFakeTimers();
    const f = fixture({ timeoutMs: 10, prepareWall: () => new Promise(() => {}) });
    const pending = f.validator.validateCandidate(f.request());
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toMatchObject({ valid: false, reason: expect.stringMatching(/timed out/i) });
    expect(f.disposePreparation).toHaveBeenCalledOnce();
    f.validator.dispose(); vi.useRealTimers();
  });
  test('dispose cancels an active request and does not permit later calls', async () => {
    const f = fixture({ prepareWall: () => new Promise(() => {}) });
    const pending = f.validator.validateCandidate(f.request());
    await vi.waitFor(() => expect(f.readInputs).toHaveBeenCalled());
    f.validator.dispose();
    expect((await pending).valid).toBe(false);
    expect((await f.validator.validateCandidate(f.request())).valid).toBe(false);
  });
  test('dispose releases completed preparation owned by this document once', async () => {
    const f = fixture();
    expect((await f.validator.validateCandidate(f.request())).valid).toBe(true);
    expect(f.disposePreparation).not.toHaveBeenCalled();
    f.validator.dispose(); f.validator.dispose();
    expect(f.disposePreparation).toHaveBeenCalledOnce();
  });
});

describe('pair mesh preparation', () => {
  test('geometry preflight validates both meshes without reading release metadata or placing names', async () => {
    const candidate = config();
    const assets = Object.fromEntries(['left', 'right'].map((side) => [side, {
      assetId: `${side}-id`, sha256: side === 'left' ? 'a'.repeat(64) : 'b'.repeat(64), logicalGrid: { columns: side === 'left' ? 7 : 8, rows: 7 },
    }]));
    for (const side of ['left', 'right']) candidate.outputs[side].warp.baseline = {
      type: 'tdMesh', assetId: assets[side].assetId, sha256: assets[side].sha256,
      width: 1920, height: 1080, origin: 'top-left',
    };
    const manifest = { schemaVersion: 1, width: 1920, height: 1080,
      assets: Object.fromEntries(Object.entries(assets).map(([side, asset]) => [side, { ...asset, path: `${side}.json` }])),
      framing: { path: 'framing.json', sha256: 'c'.repeat(64) } };
    const loadBaseline = vi.fn(async (side) => ({ mesh: createIdentityProjectionMesh({ side }), manifest }));
    const readInputs = vi.fn(async () => { throw new Error('release metadata unavailable'); });
    const prepareWall = vi.fn(async () => { throw new Error('name worker must not run'); });
    const validator = createProjectionGeometryValidator({ loadBaseline, readInputs, prepareWall });

    const result = await validator.validateCandidate({ config: candidate, identity: JSON.stringify(candidate), generation: 1, revision: 3 });

    expect(result).toMatchObject({ valid: true, identity: JSON.stringify(candidate) });
    expect(loadBaseline).toHaveBeenCalledTimes(2);
    expect(readInputs).not.toHaveBeenCalled();
    expect(prepareWall).not.toHaveBeenCalled();
    validator.dispose();
  });

  test('identity and disabled warps need no source mesh', async () => {
    const candidate = config();
    candidate.outputs.left.warp.enabled = false;
    const loadBaseline = vi.fn();
    const meshes = await prepareProjectionPairMeshes({ config: candidate, loadBaseline });
    expect(meshes).toMatchObject({ left: expect.any(Object), right: expect.any(Object) });
    expect(loadBaseline).not.toHaveBeenCalled();
  });
  test('rejects missing and mixed baselines', async () => {
    const candidate = config();
    candidate.outputs.left.warp.baseline = { type: 'tdMesh', assetId: 'left-id', sha256: 'a'.repeat(64), width: 1920, height: 1080, origin: 'top-left' };
    candidate.outputs.right.warp.baseline = { type: 'tdMesh', assetId: 'right-id', sha256: 'b'.repeat(64), width: 1920, height: 1080, origin: 'top-left' };
    await expect(prepareProjectionPairMeshes({ config: candidate, loadBaseline: async () => null })).rejects.toThrow();
    const loadBaseline = async (side) => ({ mesh: { side }, manifest: { marker: side } });
    await expect(prepareProjectionPairMeshes({ config: candidate, loadBaseline })).rejects.toThrow();
  });
  test('verifies both TD meshes against one manifest and rejects an invalid mesh', async () => {
    const candidate = config();
    const assets = Object.fromEntries(['left', 'right'].map((side) => [side, {
      assetId: `${side}-id`, sha256: side === 'left' ? 'a'.repeat(64) : 'b'.repeat(64),
      logicalGrid: { columns: side === 'left' ? 7 : 8, rows: 7 },
    }]));
    for (const side of ['left', 'right']) candidate.outputs[side].warp.baseline = {
      type: 'tdMesh', assetId: assets[side].assetId, sha256: assets[side].sha256,
      width: 1920, height: 1080, origin: 'top-left',
    };
    const manifest = { schemaVersion: 1, width: 1920, height: 1080,
      assets: Object.fromEntries(Object.entries(assets).map(([side, asset]) => [side, { ...asset, path: `${side}.json` }])),
      framing: { path: 'framing.json', sha256: 'c'.repeat(64) } };
    const loadBaseline = vi.fn(async (side) => ({ manifest, mesh: createIdentityProjectionMesh({ side }) }));
    expect(await prepareProjectionPairMeshes({ config: candidate, loadBaseline })).toMatchObject({ left: expect.any(Object), right: expect.any(Object) });
    expect(loadBaseline).toHaveBeenCalledTimes(2);
    await expect(prepareProjectionPairMeshes({ config: candidate, loadBaseline: async (side) => ({ manifest, mesh: { side } }) })).rejects.toThrow(/baseline rejected/);
    await expect(prepareProjectionPairMeshes({ config: candidate, loadBaseline: async (side) => ({
      manifest: { ...manifest, capture: side }, mesh: createIdentityProjectionMesh({ side }),
    }) })).rejects.toThrow(/different manifests/);
  });

  test('rejects a selected catalog mesh whose origin disagrees with the trusted asset', async () => {
    const candidate = config();
    const assets = Object.fromEntries(['left', 'right'].map((side) => [side, {
      assetId: `${side}-id`, path: `${side}.json`, sha256: side === 'left' ? 'a'.repeat(64) : 'b'.repeat(64),
      logicalGrid: { columns: side === 'left' ? 7 : 8, rows: 7 },
    }]));
    const selected = { assetId: 'capture-left', path: 'captures/left.json', sha256: 'd'.repeat(64), logicalGrid: { columns: 7, rows: 7 }, origin: 'top-left' };
    const manifest = { schemaVersion: 1, width: 1920, height: 1080,
      assets,
      catalog: { left: [selected], right: [] },
      framing: { path: 'framing.json', sha256: 'c'.repeat(64) } };
    candidate.outputs.left.warp.baseline = {
      type: 'tdMesh', assetId: selected.assetId, sha256: selected.sha256, width: 1920, height: 1080, origin: 'top-left',
    };
    candidate.outputs.right.warp.baseline = {
      type: 'tdMesh', assetId: assets.right.assetId, sha256: assets.right.sha256, width: 1920, height: 1080, origin: 'top-left',
    };
    const loadBaseline = async (side) => {
      const mesh = createIdentityProjectionMesh({ side });
      if (side === 'left') mesh.origin = 'bottom-left';
      else mesh.logicalGrid = { columns: 8, rows: 7 };
      return { manifest, mesh };
    };

    await expect(prepareProjectionPairMeshes({ config: candidate, loadBaseline })).rejects.toThrow(/origin does not match the trusted manifest/);
  });
});

test('pair baseline callbacks receive the candidate TD reference as their third argument', async () => {
  const candidate = config();
  const references = {};
  const manifest = { schemaVersion: 1, width: 1920, height: 1080, assets: {
    left: { assetId: 'left-selected', path: 'left.json', sha256: 'a'.repeat(64), logicalGrid: { columns: 7, rows: 7 } },
    right: { assetId: 'right-selected', path: 'right.json', sha256: 'b'.repeat(64), logicalGrid: { columns: 8, rows: 7 } },
  }, framing: { path: '../framing.json', sha256: 'c'.repeat(64) } };
  const loadBaseline = vi.fn(async (side, _signal, baselineReference) => {
    references[side] = baselineReference;
    const mesh = createIdentityProjectionMesh({ side });
    mesh.logicalGrid = manifest.assets[side].logicalGrid;
    return { manifest, mesh };
  });
  candidate.outputs.left.warp.baseline = { type: 'tdMesh', assetId: 'left-selected', sha256: 'a'.repeat(64), width: 1920, height: 1080, origin: 'top-left' };
  candidate.outputs.right.warp.baseline = { type: 'tdMesh', assetId: 'right-selected', sha256: 'b'.repeat(64), width: 1920, height: 1080, origin: 'top-left' };
  await prepareProjectionPairMeshes({ config: candidate, loadBaseline });
  expect(references).toEqual({ left: candidate.outputs.left.warp.baseline, right: candidate.outputs.right.warp.baseline });
});
