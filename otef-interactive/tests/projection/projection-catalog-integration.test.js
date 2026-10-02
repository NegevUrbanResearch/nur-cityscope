import { afterEach, expect, test, vi } from 'vitest';
import { createProjectionBaselineCatalogLoader } from '../../frontend/src/projection/projection-captured-baseline.js';
import { createProjectionBrowserSurface } from '../../frontend/src/projection/projection-browser-route.js';
import { createProjectionConfigRuntime } from '../../frontend/src/projection/projection-config-runtime.js';
import { createProjectionGeometryValidator } from '../../frontend/src/projection/projection-candidate-validation.js';
import { DEFAULT_PROJECTION_CONFIG } from '../../frontend/src/shared/projection-config-schema.js';
import { createBaselineSampler } from '../../frontend/src/shared/projection-baseline-sampler.js';
import { sha256Hex } from '../../frontend/src/shared/sha256-hex.js';
import { projectionCatalog, clone, bytes, deferred, response } from '../fixtures/projection-catalog.js';

afterEach(() => vi.unstubAllGlobals());
const DEFAULT_BASE = '/otef-interactive/public/projection-calibration/td-baselines/';

async function surfaceHarness(f, side, config = f.config(), fetchImpl = f.fetchImpl) {
  vi.stubGlobal('document', { createElement: () => ({ style: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, remove() {} }) });
  let currentMesh;
  const draws = [];
  const surface = await createProjectionBrowserSurface({ host: { appendChild() {} }, spanId: side,
    image: { complete: true, naturalWidth: 10, style: {} }, initialConfig: config, fetchImpl,
    rendererFactory: ({ mesh }) => { currentMesh = mesh; return { setMesh: (next) => { currentMesh = next; }, draw: () => { draws.push(currentMesh); return true; }, isContextLost: () => false, dispose() {} }; } });
  return { surface, draws, getMesh: () => currentMesh };
}

async function runtimeHarness(f, side, fetchImpl = f.fetchImpl) {
  const h = await surfaceHarness(f, side, f.config(), fetchImpl);
  let listener;
  const frames = [], sent = [], handlers = new Map(), commits = [];
  const runtime = createProjectionConfigRuntime({ spanId: side, route: 'browser', instanceId: `${side}-instance`,
    map: { on: (event, fn) => handlers.set(event, fn), off: (event) => handlers.delete(event), triggerRepaint() {}, getEffectiveProjectionConfig: () => h.surface.getConfig() },
    client: { subscribe: (fn) => { listener = fn; return () => { listener = null; }; }, start: async () => {} },
    socket: { on() {}, off() {}, send: (message) => sent.push(message) },
    requestFrame: (fn) => { frames.push(fn); return frames.length; }, cancelFrame() {},
    baseline: () => h.surface.getBaselineIdentity(), prepareGeometry: (config, _revision, signal) => h.surface.preparePair(config, signal),
    applyConfig: (_config, revision, pair) => { if (pair) { h.surface.commitPair(pair); commits.push(revision); } },
    rollbackGeometry: (pair) => h.surface.rollbackPair(pair), finalizeGeometry: (pair) => h.surface.finalizePair(pair),
    drawCompletion: () => h.surface.draw(),
  });
  await runtime.start();
  return { ...h, runtime, sent, commits,
    receive(revision, config) { listener?.({ snapshot: { revision, config } }); frames.shift()?.(); },
    async settle(revision) { await vi.waitFor(() => expect(commits).toContain(revision)); handlers.get('render')?.({}); await vi.waitFor(() => expect(sent.some((m) => m.type === 'otef_projection_applied' && m.revision === revision && m.success)).toBe(true)); },
    dispose() { runtime.stop(); h.surface.dispose(); } };
}

function assertGeometry(mesh, scale) {
  const sample = createBaselineSampler(mesh);
  for (const [s, t] of [[0, 0], [0.13, 0.27], [0.51, 0.72], [1, 1]]) {
    expect(sample(s, t).x).toBeCloseTo(s * scale, 9); expect(sample(s, t).y).toBeCloseTo(t, 9);
  }
}

test.each(['isolated', 'absent peer'])('known wrong hash rejects without refresh: %s', async (peer) => {
  const f = await projectionCatalog();
  const loader = createProjectionBaselineCatalogLoader({ fetchImpl: f.fetchImpl, base: f.base, initialSnapshot: f.snapshotA });
  const config = f.config('historical', peer === 'isolated' ? 'historical' : 'selected');
  config.outputs.left.warp.baseline.sha256 = f.entries.selected.left.sha256;
  const changedManifest = clone(f.manifestB); changedManifest.assets.left.sha256 = f.entries.selected.left.sha256;
  f.payloads.set(`${f.base}manifest.json`, bytes(changedManifest));
  f.payloads.set(`${f.base}historical/left.json`, f.payloads.get(`${f.base}selected/left.json`));
  await expect(loader.prepare(config)).rejects.toThrow(/trusted manifest/);
  expect(f.count('manifest.json')).toBe(0);
  expect(loader.getSnapshot()).toBe(f.snapshotA);
});

test.each(['left', 'right'])('surface %s boots on additional bytes and switches both ways while preserving the peer', async (side) => {
  const f = await projectionCatalog(DEFAULT_BASE);
  const h = await surfaceHarness(f, side, f.config('selected', 'selected'));
  try {
    assertGeometry(h.draws.at(-1), f.scales.selected[side]);
    for (const kind of ['historical', 'selected', 'historical']) {
      const config = side === 'left' ? f.config(kind, 'selected') : f.config('selected', kind);
      config.pre.tx = 0.123; config.outputs[side === 'left' ? 'right' : 'left'].post.ty = -0.14;
      const peer = clone(config.outputs[side === 'left' ? 'right' : 'left']);
      const prepared = await h.surface.preparePair(config);
      h.surface.commitPair(prepared); expect(h.surface.draw()).toBe(true); h.surface.finalizePair(prepared);
      assertGeometry(h.draws.at(-1), f.scales[kind][side]);
      assertGeometry(prepared.meshes[side === 'left' ? 'right' : 'left'], f.scales.selected[side === 'left' ? 'right' : 'left']);
      expect(h.surface.getConfig().outputs[side === 'left' ? 'right' : 'left']).toEqual(peer);
      expect(h.surface.getBaselineIdentity().assetId).toBe(f.entries[kind][side].assetId);
    }
    const same = clone(h.surface.getConfig()); same.outputs[side].warp.baseline.sha256 = same.outputs[side].warp.baseline.sha256.toUpperCase();
    await h.surface.preparePair(same);
    expect(f.count('manifest.json')).toBe(1);
    for (const kind of ['historical', 'selected']) expect(f.count(`${kind}/${side}.json`)).toBe(1);
  } finally { h.surface.dispose(); }
});

test.each(['left', 'right'])('runtime %s acknowledges selected identity only after matching geometry draws, across fresh catalog and switchback', async (side) => {
  const f = await projectionCatalog(DEFAULT_BASE); f.payloads.set(`${f.base}manifest.json`, bytes(f.manifestA));
  const h = await runtimeHarness(f, side);
  try {
    h.receive(1, f.config()); await h.settle(1);
    f.payloads.set(`${f.base}manifest.json`, bytes(f.manifestB));
    const selected = side === 'left' ? f.config('selected') : f.config('historical', 'selected');
    h.receive(2, selected); await vi.waitFor(() => expect(h.commits).toContain(2));
    expect(h.sent.some((m) => m.type === 'otef_projection_applied' && m.revision === 2 && m.success)).toBe(false);
    await h.settle(2); assertGeometry(h.draws.at(-1), f.scales.selected[side]);
    expect(h.sent.find((m) => m.type === 'otef_projection_applied' && m.revision === 2).baseline).toEqual({ type: 'tdMesh', assetId: f.entries.selected[side].assetId, sha256: f.entries.selected[side].sha256 });
    const current = await h.surface.preparePair(selected);
    expect(current.loaded.left.manifest).toBe(current.loaded.right.manifest); expect(current.snapshot.manifest).toEqual(f.manifestB);
    const edited = clone(selected); edited.outputs[side].warp.grid.offsets[0] = [0.001, 0];
    h.receive(3, edited); await h.settle(3);
    h.receive(4, f.config()); await h.settle(4); assertGeometry(h.draws.at(-1), f.scales.historical[side]);
    expect(f.count('manifest.json')).toBe(2); expect(f.count('framing.json')).toBe(2);
  } finally { h.dispose(); }
});

test.each(['switchback', 'dispose'])('deferred fresh framing cannot change output, catalog or success acknowledgment after %s', async (operation) => {
  const f = await projectionCatalog(DEFAULT_BASE); f.payloads.set(`${f.base}manifest.json`, bytes(f.manifestA));
  const gate = deferred(); let deferFraming = false;
  const fetchImpl = (url, options) => deferFraming && url.endsWith('framing.json') ? gate.promise : f.fetchImpl(url, options);
  const h = await runtimeHarness(f, 'left', fetchImpl);
  try {
    h.receive(1, f.config()); await h.settle(1);
    const mesh = clone(h.getMesh()); const count = h.draws.length;
    f.payloads.set(`${f.base}manifest.json`, bytes(f.manifestB)); deferFraming = true;
    h.receive(2, f.config('selected'));
    await vi.waitFor(() => expect(f.count('manifest.json')).toBe(2));
    if (operation === 'switchback') { h.receive(3, f.config()); await h.settle(3); }
    else h.dispose();
    gate.resolve(response(f.payloads.get(`${f.base}framing.json`))); await new Promise((done) => setTimeout(done, 10));
    expect(h.getMesh()).toEqual(mesh); expect(h.commits).not.toContain(2);
    expect(h.sent.some((m) => m.type === 'otef_projection_applied' && m.revision === 2 && m.success)).toBe(false);
    if (operation === 'dispose') expect(h.draws.length).toBe(count);
    else { deferFraming = false; h.receive(4, f.config('selected')); await h.settle(4); expect(f.count('manifest.json')).toBe(3); }
  } finally { h.dispose(); }
});

test.each(['manifest', 'framing hash', 'framing config', 'absent', 'mesh hash', 'mesh fold'])('failed fresh %s retains rendered geometry and succeeds on explicit retry without a refresh loop', async (failure) => {
  const f = await projectionCatalog(DEFAULT_BASE); f.payloads.set(`${f.base}manifest.json`, bytes(f.manifestA));
  const h = await runtimeHarness(f, 'left');
  try {
    h.receive(1, f.config()); await h.settle(1);
    const prior = clone(h.getMesh()), manifest = clone(f.manifestB);
    if (failure === 'manifest') manifest.catalog.left[0].path = '../unsafe.json';
    if (failure === 'framing hash') manifest.framing.sha256 = 'b'.repeat(64);
    if (failure === 'absent') manifest.catalog.left = [];
    if (failure === 'framing config') { const invalid = bytes({ bad: true }); manifest.framing.sha256 = await sha256Hex(invalid); f.payloads.set(`${f.base}framing.json`, invalid); }
    if (failure === 'mesh hash') f.payloads.set(`${f.base}selected/left.json`, bytes({ broken: true }));
    if (failure === 'mesh fold') { const folded = clone(f.meshes.selected.left); folded.vertices[1].x = -0.5; const encoded = bytes(folded); manifest.catalog.left[0].sha256 = await sha256Hex(encoded); f.payloads.set(`${f.base}selected/left.json`, encoded); }
    f.payloads.set(`${f.base}manifest.json`, bytes(manifest));
    const selected = f.config('selected'); if (failure === 'mesh fold') selected.outputs.left.warp.baseline.sha256 = manifest.catalog.left[0].sha256;
    h.receive(2, selected);
    await vi.waitFor(() => expect(h.sent.some((m) => m.type === 'otef_projection_applied' && m.revision === 2 && !m.success)).toBe(true));
    expect(h.getMesh()).toEqual(prior); expect(h.surface.getConfig()).toEqual(f.config());
    expect(f.count('manifest.json')).toBe(2); h.surface.draw(); expect(f.count('manifest.json')).toBe(2);
    f.payloads.set(`${f.base}manifest.json`, bytes(f.manifestB));
    f.payloads.set(`${f.base}framing.json`, bytes(f.snapshotA.framing));
    f.payloads.set(`${f.base}selected/left.json`, bytes(f.meshes.selected.left));
    h.receive(3, f.config('selected')); await h.settle(3); assertGeometry(h.draws.at(-1), 0.72);
    expect(f.count('manifest.json')).toBe(3);
  } finally { h.dispose(); }
});

test('rejected current-snapshot mesh cache entry is evicted for explicit retry', async () => {
  const f = await projectionCatalog();
  const loader = createProjectionBaselineCatalogLoader({ fetchImpl: f.fetchImpl, base: f.base, initialSnapshot: f.snapshotB });
  const valid = f.payloads.get(`${f.base}selected/left.json`); f.payloads.set(`${f.base}selected/left.json`, bytes({ bad: true }));
  await expect(loader.prepare(f.config('selected'))).rejects.toThrow(/hash mismatch/);
  f.payloads.set(`${f.base}selected/left.json`, valid);
  const prepared = await loader.prepare(f.config('selected')); assertGeometry(prepared.loaded.left.mesh, 0.72);
  expect(f.count('selected/left.json')).toBe(2); expect(f.count('manifest.json')).toBe(0);
});

test('identity and disabled TD sides skip all catalog and mesh fetching', async () => {
  const fetchImpl = vi.fn(async () => { throw new Error('must not fetch'); });
  const loader = createProjectionBaselineCatalogLoader({ fetchImpl });
  const config = clone(DEFAULT_PROJECTION_CONFIG);
  config.outputs.right.warp.enabled = false;
  config.outputs.right.warp.baseline = { type: 'tdMesh', assetId: 'unregistered-disabled', sha256: 'a'.repeat(64), width: 1920, height: 1080, origin: 'top-left' };
  expect(await loader.prepare(config)).toEqual({ snapshot: null, loaded: {} });
  expect(fetchImpl).not.toHaveBeenCalled();
});

test.each(['superseded', 'disposed'])('preflight %s during fresh framing never promotes the stale catalog', async (operation) => {
  const f = await projectionCatalog(), gate = deferred(); let deferFraming = true;
  const loader = createProjectionBaselineCatalogLoader({ base: f.base, initialSnapshot: f.snapshotA,
    fetchImpl: (url, options) => deferFraming && url.endsWith('framing.json') ? gate.promise : f.fetchImpl(url, options) });
  const promote = vi.spyOn(loader, 'promote'), validator = createProjectionGeometryValidator({ baselineCatalogLoader: loader });
  const validate = (config) => validator.validateCandidate({ config, identity: JSON.stringify(config) });
  try {
    const pending = validate(f.config('selected'));
    await vi.waitFor(() => expect(f.count('manifest.json')).toBe(1));
    if (operation === 'superseded') expect((await validate(f.config())).valid).toBe(true);
    else validator.dispose();
    gate.resolve(response(f.payloads.get(`${f.base}framing.json`)));
    expect((await pending).valid).toBe(false); expect(loader.getSnapshot()).toBe(f.snapshotA);
    expect(promote).toHaveBeenCalledTimes(operation === 'superseded' ? 1 : 0);
    if (operation === 'superseded') { deferFraming = false; expect((await validate(f.config('selected'))).valid).toBe(true); expect(f.count('manifest.json')).toBe(2); }
  } finally { validator.dispose(); }
});

test.each(['hash', 'dimensions', 'type'])('malformed absent reference rejects without refresh: %s', async (field) => {
  const f = await projectionCatalog();
  const loader = createProjectionBaselineCatalogLoader({ fetchImpl: f.fetchImpl, base: f.base, initialSnapshot: f.snapshotA });
  const config = f.config('selected');
  if (field === 'hash') config.outputs.left.warp.baseline.sha256 = 'invalid';
  if (field === 'dimensions') config.outputs.left.warp.baseline.width = 42;
  if (field === 'type') config.outputs.left.warp.baseline.type = 'other';
  await expect(loader.prepare(config)).rejects.toThrow();
  expect(f.count('manifest.json')).toBe(0);
});
