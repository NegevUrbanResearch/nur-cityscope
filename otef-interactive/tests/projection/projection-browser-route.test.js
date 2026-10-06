import { expect, test, vi } from "vitest";
import {
  createProjectionBrowserSurface,
  loadCapturedProjectionBaseline,
  resolveProjectionOutputMode,
} from "../../frontend/src/projection/projection-browser-route.js";
import { sha256Hex } from "../../frontend/src/shared/sha256-hex.js";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { createIdentityProjectionMesh, evaluateWarpPoint } from "../../frontend/src/shared/projection-warp-geometry.js";
import { validateProjectionBaselineMesh } from "../../frontend/src/shared/projection-warp-assets.js";
import { migrateProjectionConfigToV2 } from "../../frontend/src/shared/projection-warp-schema.js";
import { createProjectionBaselineCatalogLoader, loadCapturedProjectionAsset } from "../../frontend/src/projection/projection-captured-baseline.js";
import { createProjectionImageDescriptor } from "../../frontend/src/projection/projection-span-view.js";
import { prepareProjectionPairMeshes } from "../../frontend/src/projection/projection-candidate-validation.js";
import { createBaselineSampler } from "../../frontend/src/shared/projection-baseline-sampler.js";
import { variableTdMesh } from "../fixtures/td-variable-grid.js";

const framingConfig = {
  schemaVersion: 1,
  pre: { scale: 1, rotateDeg: 0, tx: 0, ty: 0 },
  outputs: {
    left: { crop: { x0: 0, x1: 1, y0: 0, y1: 1 }, post: { scale: 1, tx: 0, ty: 0 } },
    right: { crop: { x0: 0, x1: 1, y0: 0, y1: 1 }, post: { scale: 1, tx: 0, ty: 0 } },
  },
};

function completeBaselineManifest(manifest) {
  manifest.schemaVersion ??= 1;
  for (const side of ["left", "right"]) {
    manifest.assets[side] ??= { path: `${side}.json`, sha256: "a".repeat(64) };
    Object.assign(manifest.assets[side], {
      assetId: manifest.assets[side].assetId || `fixture-${side}`,
      logicalGrid: manifest.assets[side].logicalGrid || { columns: side === "left" ? 7 : 8, rows: 7 },
    });
  }
  return manifest;
}

test("selects browser mode only for the explicit outputMode query", () => {
  expect(resolveProjectionOutputMode("?span=left")).toBe("td");
  expect(resolveProjectionOutputMode("?span=left&outputMode=browser")).toBe("browser");
});

test('explicit 4K browser output uses a 4K canvas with the canonical identity mesh', async () => {
  const doc = { createElement() { return { style: {}, dataset: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, remove() {} }; } };
  const rendererFactory = vi.fn(() => ({ draw() {}, isContextLost: () => false, dispose() {} }));
  const surface = await createProjectionBrowserSurface({
    host: { ownerDocument: doc, appendChild() {} }, spanId: 'left',
    image: { complete: true, naturalWidth: 10, style: {} },
    initialConfig: structuredClone(DEFAULT_PROJECTION_CONFIG),
    fetchImpl: async () => ({ ok: false }), rendererFactory,
    search: '?outputMode=browser&outputResolution=4k',
  });
  const options = rendererFactory.mock.calls[0][0];
  expect([options.canvas.width, options.canvas.height]).toEqual([3840, 2160]);
  expect([options.mesh.width, options.mesh.height]).toEqual([1920, 1080]);
  surface.dispose();
});

test('production output ignores the seam-proof query', async () => {
  vi.stubEnv('DEV', false);
  const oldDocument = globalThis.document;
  let nameCanvases = 0;
  const draws = [];
  globalThis.document = { createElement() { return { style: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, remove() {}, getContext() { nameCanvases++; return {}; } }; } };
  try {
    const surface = await createProjectionBrowserSurface({
      host: { appendChild() {} }, spanId: 'left', search: '?outputMode=browser',
      image: { complete: true, naturalWidth: 10, style: {} },
      initialConfig: structuredClone(DEFAULT_PROJECTION_CONFIG),
      fetchImpl: async () => ({ ok: false }),
      rendererFactory: () => ({ draw(scene) { draws.push(scene); }, isContextLost: () => false, dispose() {} }),
    });
    expect(draws.at(-1).layers.some((layer) => layer.id === 'names')).toBe(false);
    expect(nameCanvases).toBe(0);
    surface.dispose();
  } finally {
    globalThis.document = oldDocument;
    vi.unstubAllEnvs();
  }
});

test('browser surface boots when the unused table photo cannot be decoded', async () => {
  const oldDocument = globalThis.document;
  const draws = [];
  const image = {
    complete: true,
    naturalWidth: 0,
    naturalHeight: 0,
    src: '',
    currentSrc: '',
    getAttribute(name) { return name === 'src' ? '' : null; },
    style: {},
    decode: async () => {
      throw new Error('The source image cannot be decoded.');
    },
  };
  globalThis.document = { createElement() { return { style: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, remove() {} }; } };
  try {
    const surface = await createProjectionBrowserSurface({
      host: { appendChild() {} },
      spanId: 'left',
      image,
      getScene: () => ({ image: null, map: null }),
      initialConfig: structuredClone(DEFAULT_PROJECTION_CONFIG),
      fetchImpl: async () => ({ ok: false }),
      rendererFactory: () => ({ draw(scene) { draws.push(scene); }, isContextLost: () => false, dispose() {} }),
    });
    expect(draws.at(-1).layers.some((layer) => layer.id === 'image')).toBe(false);
    surface.dispose();
  } finally {
    globalThis.document = oldDocument;
  }
});

test('an explicit unready image removes a previously drawn image layer', async () => {
  const oldDocument = globalThis.document;
  const draws = [];
  let imageReady = true;
  const image = { complete: true, naturalWidth: 10, naturalHeight: 10, style: {} };
  globalThis.document = { createElement() { return { style: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, remove() {} }; } };
  try {
    const surface = await createProjectionBrowserSurface({
      host: { appendChild() {} }, spanId: 'left', image,
      getScene: () => ({ image: imageReady ? { source: image, contentVersion: 1 } : null, map: null }),
      initialConfig: structuredClone(DEFAULT_PROJECTION_CONFIG), fetchImpl: async () => ({ ok: false }),
      rendererFactory: () => ({ draw(scene) { draws.push(scene); }, isContextLost: () => false, dispose() {} }),
    });
    expect(draws.at(-1).layers.some((layer) => layer.id === 'image')).toBe(true);
    imageReady = false;
    surface.draw();
    expect(draws.at(-1).layers.some((layer) => layer.id === 'image')).toBe(false);
    surface.dispose();
  } finally { globalThis.document = oldDocument; }
});

test('a stale local pair rollback cannot replace the newer browser mesh', async () => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElement() { return { style: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, remove() {} }; } };
  let currentMesh;
  try {
    const surface = await createProjectionBrowserSurface({
      host: { appendChild() {} }, spanId: 'left', image: { complete: true, naturalWidth: 10, style: {} },
      initialConfig: structuredClone(DEFAULT_PROJECTION_CONFIG), fetchImpl: async () => ({ ok: false }),
      rendererFactory: ({ mesh }) => { currentMesh = mesh; return { draw: () => true, setMesh: (next) => { currentMesh = next; }, isContextLost: () => false, dispose() {} }; },
    });
    const first = { config: { first: true }, mesh: { tag: 'first' } };
    const second = { config: { second: true }, mesh: { tag: 'second' } };
    surface.commitPair(first); surface.finalizePair(first);
    surface.commitPair(second);
    surface.rollbackPair(first);
    expect(currentMesh).toBe(second.mesh);
    expect(surface.getConfig()).toBe(second.config);
    surface.rollbackPair(second);
    expect(currentMesh).toBe(first.mesh);
    surface.dispose();
  } finally { globalThis.document = oldDocument; }
});

test("uses geographic projective placement and viewport normalization for the image layer", () => {
  const map = {
    _otefProjectionImage: { corners: [[0, 0], [1, 0], [1, 1], [0, 1]], width: 800, height: 400 },
    project(point) {
      const x = point[0];
      const y = point[1];
      return {
        x: 100 + x * 1540 + y * 80 - x * y * 20,
        y: 80 + x * 40 + y * 820 - x * y * 10,
      };
    },
    getContainer() { return { clientWidth: 1920, clientHeight: 1080 }; },
  };
  const image = { style: { opacity: "0.5" } };
  const descriptor = createProjectionImageDescriptor({ map, imageEl: image, spanId: "left" });
  expect(descriptor.opacity).toBe(0.5);
  expect(descriptor.clip).toEqual([0, 0, 1, 1]);
  const mapSourceToOutput = (u, v) => {
    const m = descriptor.matrix;
    const denominator = m[2] * u + m[5] * v + m[8];
    return [
      (m[0] * u + m[3] * v + m[6]) / denominator,
      (m[1] * u + m[4] * v + m[7]) / denominator,
    ];
  };
  expect(mapSourceToOutput(0, 0)[0]).toBeCloseTo(100 / 1920);
  expect(mapSourceToOutput(0, 0)[1]).toBeCloseTo(80 / 1080);
  expect(mapSourceToOutput(1, 0)[0]).toBeCloseTo(1640 / 1920);
  expect(mapSourceToOutput(1, 0)[1]).toBeCloseTo(120 / 1080);
  expect(mapSourceToOutput(1, 1)[0]).toBeCloseTo(1700 / 1920);
  expect(mapSourceToOutput(1, 1)[1]).toBeCloseTo(930 / 1080);
  expect(mapSourceToOutput(0, 1)[0]).toBeCloseTo(180 / 1920);
  expect(mapSourceToOutput(0, 1)[1]).toBeCloseTo(900 / 1080);
});

test("loads the captured 1920x1080 asset for the requested span", async () => {
  const framing = new TextEncoder().encode(JSON.stringify(framingConfig));
  const meshValue = createIdentityProjectionMesh({ side: 'left' });
  meshValue.logicalGrid = { columns: 7, rows: 7 };
  const mesh = new TextEncoder().encode(JSON.stringify(meshValue));
  const manifest = completeBaselineManifest({ width: 1920, height: 1080, assets: { left: { path: "left.json", sha256: await sha256Hex(mesh) } }, framing: { path: "../td-source-config.json", sha256: await sha256Hex(framing) } });
  const fetchImpl = vi.fn(async (url) => ({ ok: true, async arrayBuffer() { return url.endsWith("manifest.json") ? new TextEncoder().encode(JSON.stringify(manifest)).buffer : (url.endsWith("td-source-config.json") ? framing : mesh).buffer; } }));
  const result = await loadCapturedProjectionBaseline({ fetchImpl, spanId: "left", base: "/baseline/" });
  expect(result.manifest.width).toBe(1920); expect(fetchImpl).toHaveBeenLastCalledWith("/baseline/left.json", { cache: "no-store" });
  expect(fetchImpl.mock.calls.every(([, options]) => options.cache === "no-store")).toBe(true);
});

test('loads byte-hashed variable TD assets through pair preflight and preserves framing and source UV mapping', async () => {
  const framing = new TextEncoder().encode(JSON.stringify(framingConfig));
  const assets = {};
  const meshBytes = {};
  for (const side of ['left', 'right']) {
    meshBytes[side] = new TextEncoder().encode(JSON.stringify(variableTdMesh(side)));
    const mesh = variableTdMesh(side);
    assets[side] = { assetId: `variable-${side}`, path: `${side}.json`, sha256: await sha256Hex(meshBytes[side]), logicalGrid: mesh.logicalGrid };
  }
  const manifest = { schemaVersion: 1, width: 1920, height: 1080, assets,
    framing: { path: '../td-source-config.json', sha256: await sha256Hex(framing) } };
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  const fetchImpl = vi.fn(async (url) => ({ ok: true, async arrayBuffer() {
    if (url.endsWith('manifest.json')) return bytes.buffer;
    if (url.endsWith('td-source-config.json')) return framing.buffer;
    return meshBytes[url.endsWith('left.json') ? 'left' : 'right'].buffer;
  } }));
  const loaded = await loadCapturedProjectionBaseline({ fetchImpl, spanId: 'left', base: '/fixture/' });
  expect(loaded.mesh.logicalGrid).toEqual({ columns: 3, rows: 4 });
  expect(loaded.framing).toEqual(framingConfig);

  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  const originalFraming = { pre: structuredClone(config.pre), outputs: structuredClone(config.outputs), namesWall: structuredClone(config.namesWall) };
  for (const [side, columnKnot, rowKnot, offset] of [['left', 3, 3, [0.012, -0.009]], ['right', 4, 2, [-0.006, 0.008]]]) {
    const warp = config.outputs[side].warp;
    warp.grid.columnPositions[columnKnot] += side === 'left' ? -0.025 : -0.02;
    warp.grid.rowPositions[rowKnot] += side === 'left' ? 0.03 : -0.025;
    warp.grid.offsets[Math.floor(warp.grid.offsets.length / 2)] = offset;
    warp.baseline = {
      type: 'tdMesh', assetId: assets[side].assetId, sha256: assets[side].sha256,
      width: 1920, height: 1080, origin: 'top-left',
    };
  }
  const expectedWarps = Object.fromEntries(['left', 'right'].map((side) => [side, structuredClone(config.outputs[side].warp)]));
  const pair = await prepareProjectionPairMeshes({ config, loadBaseline: async (side) =>
    loadCapturedProjectionAsset({ fetchImpl, spanId: side, base: '/fixture/', captured: loaded }) });
  expect(config.pre).toEqual(originalFraming.pre);
  expect(config.namesWall).toEqual(originalFraming.namesWall);
  expect(config.outputs.left).toEqual(expect.objectContaining({ crop: originalFraming.outputs.left.crop, post: originalFraming.outputs.left.post }));
  expect(config.outputs.right).toEqual(expect.objectContaining({ crop: originalFraming.outputs.right.crop, post: originalFraming.outputs.right.post }));
  for (const side of ['left', 'right']) expect(config.outputs[side].warp).toEqual(expectedWarps[side]);
  for (const side of ['left', 'right']) {
    const expected = variableTdMesh(side);
    const result = pair[side];
    const sourceSampler = createBaselineSampler(expected);
    const preparedSampler = createBaselineSampler(result);
    for (const [s, t] of [[0, 0], [.37, .44], [1, 1]]) {
      const sourcePoint = sourceSampler(s, t);
      const renderedPoint = preparedSampler(s, t);
      const expectedPoint = evaluateWarpPoint(sourcePoint.x, sourcePoint.y, expectedWarps[side], s, t,
        { side, schemaVersion: 7, mesh: expected });
      expect(renderedPoint.u).toBeCloseTo(sourcePoint.u, 11);
      expect(renderedPoint.v).toBeCloseTo(sourcePoint.v, 11);
      expect(Math.abs(renderedPoint.x - expectedPoint[0]) * 1920).toBeLessThanOrEqual(0.45);
      expect(Math.abs(renderedPoint.y - expectedPoint[1]) * 1080).toBeLessThanOrEqual(0.45);
    }
  }
  expect(fetchImpl.mock.calls.some(([url]) => url.endsWith('left.json'))).toBe(true);
  expect(fetchImpl.mock.calls.some(([url]) => url.endsWith('right.json'))).toBe(true);
});

test('loads the exact selected catalog asset from its actual hashed bytes', async () => {
  const mesh = variableTdMesh('left');
  const defaultBytes = new TextEncoder().encode(JSON.stringify(mesh));
  const selectedBytes = new TextEncoder().encode(JSON.stringify({ ...mesh, catalogMarker: 'selected' }));
  const selectedHash = await sha256Hex(selectedBytes);
  const manifest = completeBaselineManifest({ width: 1920, height: 1080,
    assets: { left: { assetId: 'legacy-left', path: 'left.json', sha256: await sha256Hex(defaultBytes), logicalGrid: mesh.logicalGrid } },
    catalog: { left: [{ assetId: 'capture-left', path: 'captures/unique/left.json', sha256: selectedHash, logicalGrid: mesh.logicalGrid }], right: [] },
    framing: { path: '../td-source-config.json', sha256: await sha256Hex(new TextEncoder().encode(JSON.stringify(framingConfig))) },
  });
  const framingBytes = new TextEncoder().encode(JSON.stringify(framingConfig));
  const fetchImpl = vi.fn(async (url) => ({ ok: true, async arrayBuffer() {
    if (url.endsWith('manifest.json')) return new TextEncoder().encode(JSON.stringify(manifest)).buffer;
    if (url.endsWith('td-source-config.json')) return framingBytes.buffer;
    if (url.endsWith('captures/unique/left.json')) return selectedBytes.buffer;
    return defaultBytes.buffer;
  } }));
  const loaded = await loadCapturedProjectionBaseline({ fetchImpl, spanId: 'left', base: '/baseline/' });
  const selected = await loadCapturedProjectionAsset({ fetchImpl, spanId: 'left', baseline: { assetId: 'capture-left', sha256: selectedHash }, base: '/baseline/', captured: loaded });
  expect(selected.mesh.catalogMarker).toBe('selected');
  expect(selected.asset.assetId).toBe('capture-left');
  expect(fetchImpl).toHaveBeenLastCalledWith('/baseline/captures/unique/left.json', { cache: 'no-store' });
  await expect(loadCapturedProjectionAsset({ fetchImpl, spanId: 'left', baseline: { assetId: 'unknown', sha256: selectedHash }, base: '/baseline/', captured: loaded })).rejects.toThrow(/trusted|baseline|asset/i);
});

test('refreshes one coherent catalog snapshot for a newly registered ID and reuses it for later edits', async () => {
  const framing = new TextEncoder().encode(JSON.stringify(framingConfig));
  const makeMesh = (side, scale) => {
    const mesh = createIdentityProjectionMesh({ side });
    mesh.logicalGrid = { columns: side === 'left' ? 7 : 8, rows: 7 };
    mesh.vertices.forEach((point) => { point.x *= scale; });
    return new TextEncoder().encode(JSON.stringify(mesh));
  };
  const oldLeftBytes = makeMesh('left', 0.95);
  const newLeftBytes = makeMesh('left', 0.81);
  const rightBytes = makeMesh('right', 0.9);
  const entry = async (side, assetId, path, bytes) => ({ assetId, path, sha256: await sha256Hex(bytes), logicalGrid: { columns: side === 'left' ? 7 : 8, rows: 7 } });
  const oldLeft = await entry('left', 'historical-left', 'historical/left.json', oldLeftBytes);
  const newLeft = await entry('left', 'new-left', 'captures/new/left.json', newLeftBytes);
  const right = await entry('right', 'historical-right', 'historical/right.json', rightBytes);
  const manifestA = completeBaselineManifest({ schemaVersion: 1, width: 1920, height: 1080,
    assets: { left: oldLeft, right }, framing: { path: '../td-source-config.json', sha256: await sha256Hex(framing) } });
  const manifestB = { ...manifestA, assets: { left: oldLeft, right }, catalog: { left: [newLeft], right: [] } };
  const initialSnapshot = { manifest: manifestA, framing: framingConfig };
  const payloads = new Map([
    ['/baseline/manifest.json', new TextEncoder().encode(JSON.stringify(manifestB))],
    ['/td-source-config.json', framing],
    ['/baseline/captures/new/left.json', newLeftBytes],
    ['/baseline/historical/left.json', oldLeftBytes],
    ['/baseline/historical/right.json', rightBytes],
  ]);
  const fetchImpl = vi.fn(async (url) => ({ ok: payloads.has(url), async arrayBuffer() { return payloads.get(url).buffer; } }));
  const loader = createProjectionBaselineCatalogLoader({ fetchImpl, base: '/baseline/', initialSnapshot });
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  config.outputs.left.warp.baseline = { type: 'tdMesh', assetId: newLeft.assetId, sha256: newLeft.sha256, width: 1920, height: 1080, origin: 'top-left' };
  config.outputs.right.warp.baseline = { type: 'tdMesh', assetId: right.assetId, sha256: right.sha256, width: 1920, height: 1080, origin: 'top-left' };
  const prepared = await loader.prepare(config);
  expect(prepared.snapshot.manifest).toEqual(manifestB);
  expect(prepared.loaded.left.manifest).toBe(prepared.loaded.right.manifest);
  expect(prepared.loaded.left.asset.assetId).toBe('new-left');
  expect(prepared.loaded.right.asset.assetId).toBe('historical-right');
  expect(fetchImpl.mock.calls.filter(([url]) => url.endsWith('manifest.json'))).toHaveLength(1);
  loader.promote(prepared.snapshot);
  config.outputs.left.warp.grid.offsets[0] = [0.01, 0];
  const edited = await loader.prepare(config);
  expect(edited.snapshot).toBe(prepared.snapshot);
  expect(fetchImpl.mock.calls.filter(([url]) => url.endsWith('manifest.json'))).toHaveLength(1);
  expect(fetchImpl.mock.calls.filter(([url]) => url.endsWith('.json') && !url.endsWith('manifest.json'))).toHaveLength(3);
});

test('a canceled preparation cannot abort the same selected mesh load for its replacement', async () => {
  const leftMesh = createIdentityProjectionMesh({ side: 'left' });
  leftMesh.logicalGrid = { columns: 7, rows: 7 };
  const rightMesh = createIdentityProjectionMesh({ side: 'right' });
  rightMesh.logicalGrid = { columns: 8, rows: 7 };
  const leftBytes = new TextEncoder().encode(JSON.stringify(leftMesh));
  const rightBytes = new TextEncoder().encode(JSON.stringify(rightMesh));
  const manifest = completeBaselineManifest({ width: 1920, height: 1080, assets: {
    left: { assetId: 'left-cache', path: 'left-cache.json', sha256: await sha256Hex(leftBytes), logicalGrid: leftMesh.logicalGrid },
    right: { assetId: 'right-cache', path: 'right-cache.json', sha256: await sha256Hex(rightBytes), logicalGrid: rightMesh.logicalGrid },
  }, framing: { path: '../td-source-config.json', sha256: 'a'.repeat(64) } });
  let releaseLeft;
  let leftStarted;
  const started = new Promise((resolve) => { leftStarted = resolve; });
  const fetchImpl = vi.fn(async (url) => {
    if (url.endsWith('left-cache.json')) { leftStarted(); return new Promise((resolve) => { releaseLeft = () => resolve({ ok: true, async arrayBuffer() { return leftBytes.buffer; } }); }); }
    if (url.endsWith('right-cache.json')) return { ok: true, async arrayBuffer() { return rightBytes.buffer; } };
    return { ok: true, async arrayBuffer() { return new Uint8Array().buffer; } };
  });
  const loader = createProjectionBaselineCatalogLoader({ fetchImpl, base: '/baseline/', initialSnapshot: { manifest, framing: framingConfig } });
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  config.outputs.left.warp.baseline = { type: 'tdMesh', assetId: 'left-cache', sha256: manifest.assets.left.sha256, width: 1920, height: 1080, origin: 'top-left' };
  config.outputs.right.warp.baseline = { type: 'tdMesh', assetId: 'right-cache', sha256: manifest.assets.right.sha256, width: 1920, height: 1080, origin: 'top-left' };
  const firstController = new AbortController();
  const first = loader.prepare(config, firstController.signal);
  await started;
  firstController.abort();
  await expect(first).rejects.toMatchObject({ name: 'AbortError' });
  config.outputs.right.warp.grid.offsets[0] = [0.01, 0];
  const second = loader.prepare(config);
  await vi.waitFor(() => expect(releaseLeft).toEqual(expect.any(Function)));
  releaseLeft();
  const result = await second;
  expect(result.loaded.left.asset.assetId).toBe('left-cache');
  expect(result.loaded.right.asset.assetId).toBe('right-cache');
  expect(fetchImpl.mock.calls.filter(([url]) => url.endsWith('left-cache.json'))).toHaveLength(1);
});

test('rejects the exact selected catalog mesh when its optional trusted origin disagrees', async () => {
  const mesh = variableTdMesh('left');
  mesh.origin = 'bottom-left';
  const meshBytes = new TextEncoder().encode(JSON.stringify(mesh));
  const meshHash = await sha256Hex(meshBytes);
  const selected = { assetId: 'capture-left', path: 'captures/unique/left.json', sha256: meshHash, logicalGrid: mesh.logicalGrid, origin: 'top-left' };
  const manifest = completeBaselineManifest({ width: 1920, height: 1080,
    assets: { left: { assetId: 'legacy-left', path: 'left.json', sha256: 'a'.repeat(64), logicalGrid: mesh.logicalGrid }, right: { assetId: 'legacy-right', path: 'right.json', sha256: 'b'.repeat(64), logicalGrid: { columns: 5, rows: 3 } } },
    catalog: { left: [selected], right: [] },
    framing: { path: 'framing.json', sha256: 'c'.repeat(64) },
  });
  const fetchImpl = vi.fn(async () => ({ ok: true, async arrayBuffer() { return meshBytes.buffer; } }));

  await expect(loadCapturedProjectionAsset({
    fetchImpl, spanId: 'left', base: '/baseline/', captured: { manifest },
    baseline: { assetId: selected.assetId, sha256: selected.sha256 },
  })).rejects.toThrow(/origin does not match the trusted manifest/);
});

test("rejects matching malformed logical metadata during fetched and supplied baseline loading", async () => {
  const framing = new TextEncoder().encode(JSON.stringify(framingConfig));
  const meshValue = createIdentityProjectionMesh({ side: "left" });
  meshValue.logicalGrid = { columns: true, rows: 3 };
  const mesh = new TextEncoder().encode(JSON.stringify(meshValue));
  const meshHash = await sha256Hex(mesh);
  const manifest = completeBaselineManifest({
    schemaVersion: 1, width: 1920, height: 1080,
    assets: Object.fromEntries(["left", "right"].map((side) => [side, {
      assetId: `fixture-${side}`, path: `${side}.json`, sha256: side === "left" ? meshHash : "a".repeat(64),
      logicalGrid: { columns: true, rows: 3 },
    }])),
    framing: { path: "../td-source-config.json", sha256: await sha256Hex(framing) },
  });
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const fetchImpl = vi.fn(async (url) => ({
    ok: true,
    async arrayBuffer() {
      if (url.endsWith("manifest.json")) return manifestBytes.buffer;
      if (url.endsWith("td-source-config.json")) return framing.buffer;
      return mesh.buffer;
    },
  }));

  await expect(loadCapturedProjectionBaseline({ fetchImpl, spanId: "left" }))
    .rejects.toThrow(/baseline manifest invalid: assets\.left\.logicalGrid/);

  const captured = { manifest, framing: framingConfig };
  await expect(loadCapturedProjectionAsset({ fetchImpl, spanId: "left", captured }))
    .rejects.toThrow(/baseline manifest invalid: assets\.left\.logicalGrid/);
  expect(fetchImpl.mock.calls.some(([url]) => url.endsWith("left.json"))).toBe(false);

  const errors = validateProjectionBaselineMesh(meshValue, {
    side: "left", manifest, baseline: { assetId: "fixture-left", sha256: manifest.assets.left.sha256 },
  });
  expect(errors).toHaveProperty("manifest.assets.left.logicalGrid");
});

test("verifies the manifest-selected mesh and pinned framing bytes", async () => {
  const framing = new TextEncoder().encode(JSON.stringify(framingConfig));
  const meshValue = createIdentityProjectionMesh({ side: 'left' });
  meshValue.logicalGrid = { columns: 7, rows: 7 };
  const mesh = new TextEncoder().encode(JSON.stringify(meshValue));
  const manifest = completeBaselineManifest({
    width: 1920,
    height: 1080,
    assets: { left: { path: "left.json", sha256: await sha256Hex(mesh) } },
    framing: { path: "../td-source-config.json", sha256: await sha256Hex(framing) },
  });
  const fetchImpl = vi.fn(async (url) => ({
    ok: true,
    async arrayBuffer() {
      if (url.endsWith("manifest.json")) return new TextEncoder().encode(JSON.stringify(manifest)).buffer;
      return (url.endsWith("td-source-config.json") ? framing : mesh).buffer;
    },
  }));
  const result = await loadCapturedProjectionBaseline({ fetchImpl, spanId: "left", base: "/baseline/" });
  expect(result.framing).toEqual(framingConfig);
  expect(result.mesh).toEqual(meshValue);
  expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
    "/baseline/manifest.json",
    "/td-source-config.json",
    "/baseline/left.json",
  ]);
});

test("rejects a stale mesh or framing digest before browser rendering", async () => {
  const fetchImpl = vi.fn(async (url) => ({
    ok: true,
    async arrayBuffer() {
      if (url.endsWith("manifest.json")) return new TextEncoder().encode(JSON.stringify({
        width: 1920,
        height: 1080,
        assets: { left: { path: "left.json", sha256: "stale" } },
        framing: { path: "../td-source-config.json", sha256: "stale" },
      })).buffer;
      return new TextEncoder().encode("{}").buffer;
    },
  }));
  await expect(loadCapturedProjectionBaseline({ fetchImpl, spanId: "left", base: "/baseline/" }))
    .rejects.toThrow(/hash mismatch|digest/i);
});

test("composes only actual scene descriptors and restores source visibility on dispose", async () => {
  const draws = [];
  const host = { children: [], appendChild(node) { this.children.push(node); node.parentElement = this; }, removeChild(node) { this.children = this.children.filter((item) => item !== node); } };
  const image = { complete: true, naturalWidth: 10, style: { visibility: "visible" } };
  const mapCanvas = { style: { visibility: "visible" } };
  const legend = { style: { visibility: "visible" } };
  const oldDocument = globalThis.document;
  globalThis.document = { createElement() { return { style: {}, setAttribute() {}, remove() { this.removed = true; } }; } };
  const surface = await createProjectionBrowserSurface({
    host,
    spanId: "left",
    image,
    mapCanvas,
    hideTargets: [image, mapCanvas, legend],
    fetchImpl: async (url) => ({
      ok: true,
      async arrayBuffer() {
        const framing = new TextEncoder().encode(JSON.stringify(framingConfig));
        const mesh = new TextEncoder().encode(JSON.stringify({ width: 1920, height: 1080, vertices: [{ s: 0, t: 0, x: 0, y: 0, u: 0, v: 0 }, { s: 1, t: 0, x: 1, y: 0, u: 1, v: 0 }, { s: 0, t: 1, x: 0, y: 1, u: 0, v: 1 }], triangles: [0, 1, 2] }));
        const manifest = completeBaselineManifest({ width: 1920, height: 1080, assets: { left: { path: "left.json", sha256: await sha256Hex(mesh) } }, framing: { path: "../td-source-config.json", sha256: await sha256Hex(framing) } });
        return (url.endsWith("manifest.json") ? new TextEncoder().encode(JSON.stringify(manifest)) : url.endsWith("td-source-config.json") ? framing : mesh).buffer;
      },
    }),
    rendererFactory: () => ({ draw(scene) { draws.push(scene); }, dispose() {} }),
    scene: { image: { source: image }, map: { source: mapCanvas }, caption: null, pattern: null, legend: { source: legend } },
  });
  expect(draws[0].layers.map((layer) => layer.id)).toEqual(["image", "map", "legend"]);
  expect(image.style.visibility).toBe("hidden");
  expect(mapCanvas.style.visibility).toBe("hidden");
  surface.dispose();
  expect(image.style.visibility).toBe("visible");
  expect(legend.style.visibility).toBe("visible");
  globalThis.document = oldDocument;
});

test("identity startup tolerates an unavailable optional TD mesh preload", async () => {
  const host = { children: [], appendChild(node) { this.children.push(node); }, removeChild() {} };
  const image = { complete: true, naturalWidth: 10, style: { visibility: "visible" } };
  const oldDocument = globalThis.document;
  globalThis.document = { createElement() { return { style: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, remove() {} }; } };
  const framing = new TextEncoder().encode(JSON.stringify(framingConfig));
  const manifest = completeBaselineManifest({ width: 1920, height: 1080, assets: { left: { path: "left.json", sha256: "a".repeat(64) } }, framing: { path: "../td-source-config.json", sha256: await sha256Hex(framing) } });
  let initialMesh;
  const fetchImpl = vi.fn(async (url) => ({ ok: !url.endsWith("left.json"), async arrayBuffer() { return url.endsWith("manifest.json") ? new TextEncoder().encode(JSON.stringify(manifest)).buffer : framing.buffer; } }));
  const surface = await createProjectionBrowserSurface({
    host, spanId: "left", image, initialConfig: framingConfig,
    fetchImpl,
    rendererFactory: ({ mesh }) => { initialMesh = mesh; return { draw: () => true, setMesh: vi.fn(), isContextLost: () => false, dispose() {} }; },
  });
  expect(initialMesh.vertices.length).toBe(49);
  expect(surface.getBaselineIdentity()).toEqual({ type: "identity" });
  expect(fetchImpl.mock.calls.some(([url]) => url.endsWith("left.json"))).toBe(false);
  surface.dispose();
  globalThis.document = oldDocument;
});

test("identity startup survives unavailable framing and manifest bytes", async () => {
  const host = { children: [], appendChild(node) { this.children.push(node); }, removeChild() {} };
  const image = { complete: true, naturalWidth: 10, style: { visibility: "visible" } };
  const oldDocument = globalThis.document;
  globalThis.document = { createElement() { return { style: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, remove() {} }; } };
  for (const disabled of [false, true]) {
    let initialMesh;
    const initialConfig = structuredClone(DEFAULT_PROJECTION_CONFIG);
    initialConfig.outputs.left.warp.enabled = !disabled;
    expect(initialConfig.schemaVersion).toBe(7);
    expect(initialConfig.namesWall.rotateDeg).toBe(35);
    const surface = await createProjectionBrowserSurface({
      host, spanId: "left", image, initialConfig,
      fetchImpl: async () => ({ ok: false }),
      rendererFactory: ({ mesh }) => { initialMesh = mesh; return { draw: () => true, setMesh: vi.fn(), isContextLost: () => false, dispose() {} }; },
    });
    expect(initialMesh.vertices.length).toBeGreaterThan(0);
    expect(surface.getBaselineIdentity()).toEqual({ type: "identity" });
    expect(surface.draw()).toBe(true);
    surface.dispose();
  }
  globalThis.document = oldDocument;
});

test("disabled warp evaluates a diagnostic quad when its optional TD preload fails", async () => {
  const host = { children: [], appendChild(node) { this.children.push(node); }, removeChild() {} };
  const image = { complete: true, naturalWidth: 10, style: { visibility: "visible" } };
  const oldDocument = globalThis.document;
  globalThis.document = { createElement() { return { style: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, remove() {} }; } };
  const framing = new TextEncoder().encode(JSON.stringify(framingConfig));
  const mesh = new TextEncoder().encode(JSON.stringify({ width: 1920, height: 1080, vertices: [{ s: 0, t: 0, x: 0, y: 0, u: 0, v: 0 }, { s: 1, t: 0, x: 1, y: 0, u: 1, v: 0 }, { s: 0, t: 1, x: 0, y: 1, u: 0, v: 1 }], triangles: [0, 1, 2] }));
  const manifest = completeBaselineManifest({ width: 1920, height: 1080, assets: { left: { path: "left.json", sha256: await sha256Hex(mesh) } }, framing: { path: "../td-source-config.json", sha256: await sha256Hex(framing) } });
  let appliedMesh;
  const disabled = structuredClone((await import("../../frontend/src/shared/projection-warp-schema.js")).migrateProjectionConfigToV2(framingConfig));
  disabled.outputs.left.warp.enabled = false;
  const fetchImpl = vi.fn(async (url) => ({ ok: true, async arrayBuffer() { return url.endsWith("manifest.json") ? new TextEncoder().encode(JSON.stringify(manifest)).buffer : url.endsWith("td-source-config.json") ? framing.buffer : mesh.buffer; } }));
  const surface = await createProjectionBrowserSurface({
    host, spanId: "left", image, initialConfig: disabled,
    fetchImpl,
    rendererFactory: ({ mesh: initial }) => ({ draw: () => true, setMesh: (next) => { appliedMesh = next; }, isContextLost: () => false, dispose() {} }),
  });
  surface.applyConfig(disabled);
  expect(appliedMesh.vertices).toHaveLength(4);
  expect(surface.getBaselineIdentity()).toEqual({ type: "identity" });
  expect(fetchImpl.mock.calls.some(([url]) => url.endsWith("left.json"))).toBe(false);
  surface.dispose();
  globalThis.document = oldDocument;
});

test("captured v1 startup preloads TD mesh for saved apply and disable/re-enable", async () => {
  const host = { children: [], appendChild(node) { this.children.push(node); }, removeChild() {} };
  const image = { complete: true, naturalWidth: 10, style: { visibility: "visible" } };
  const oldDocument = globalThis.document;
  globalThis.document = { createElement() { return { style: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, remove() {} }; } };
  const framing = new TextEncoder().encode(JSON.stringify(framingConfig));
  const mesh = createIdentityProjectionMesh({ side: "left" });
  const meshBytes = new TextEncoder().encode(JSON.stringify(mesh));
  const asset = {
    path: "left.json",
    assetId: "fixture-left",
    sha256: await sha256Hex(meshBytes),
    logicalGrid: { columns: 7, rows: 7 },
  };
  const manifest = completeBaselineManifest({
    width: 1920,
    height: 1080,
    assets: { left: asset },
    framing: { path: "../td-source-config.json", sha256: await sha256Hex(framing) },
  });
  const fetchImpl = vi.fn(async (url) => ({
    ok: true,
    async arrayBuffer() {
      return (url.endsWith("manifest.json")
        ? new TextEncoder().encode(JSON.stringify(manifest))
        : url.endsWith("td-source-config.json") ? framing : meshBytes).buffer;
    },
  }));
  const setMesh = vi.fn();
  const surface = await createProjectionBrowserSurface({
    host,
    spanId: "left",
    image,
    initialConfig: framingConfig,
    fetchImpl,
    rendererFactory: () => ({ draw: () => true, setMesh, isContextLost: () => false, dispose() {} }),
  });
  const tdMeshConfig = migrateProjectionConfigToV2(framingConfig, { left: asset });
  const disabledConfig = structuredClone(tdMeshConfig);
  disabledConfig.outputs.left.warp.enabled = false;

  let pair = await surface.preparePair(tdMeshConfig);
  surface.commitPair(pair); surface.finalizePair(pair);
  expect(setMesh).toHaveBeenLastCalledWith(expect.objectContaining({ logicalGrid: { columns: 7, rows: 7 } }));
  surface.applyConfig(disabledConfig);
  expect(setMesh.mock.lastCall[0].vertices).toHaveLength(4);
  pair = await surface.preparePair(tdMeshConfig);
  surface.commitPair(pair); surface.finalizePair(pair);
  expect(setMesh.mock.lastCall[0].vertices).toHaveLength(49);
  expect(fetchImpl.mock.calls.filter(([url]) => url.endsWith("left.json"))).toHaveLength(1);
  surface.dispose();
  globalThis.document = oldDocument;
});

test("cancels pending baseline readiness before creating a browser surface", async () => {
  const controller = new AbortController();
  let resolveManifest;
  const manifestPending = new Promise((resolve) => { resolveManifest = resolve; });
  const fetchImpl = vi.fn(() => manifestPending);
  const createElement = vi.fn(() => ({ style: {}, setAttribute() {} }));
  const host = { ownerDocument: { createElement }, appendChild() {} };

  const pending = createProjectionBrowserSurface({
    host,
    spanId: "left",
    image: { complete: true, naturalWidth: 10 },
    fetchImpl,
    signal: controller.signal,
    rendererFactory: vi.fn(),
  });
  await Promise.resolve();
  expect(fetchImpl.mock.calls[0][1]).toEqual({ signal: controller.signal, cache: "no-store" });
  controller.abort();
  resolveManifest({ ok: false });
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(createElement).not.toHaveBeenCalled();
});

test("cancels image decoding before creating a browser surface", async () => {
  const controller = new AbortController();
  let resolveImage;
  const image = {
    decode: () => new Promise((resolve) => { resolveImage = resolve; }),
  };
  const createElement = vi.fn(() => ({ style: {}, setAttribute() {} }));
  const host = { ownerDocument: { createElement }, appendChild() {} };
  const framing = new TextEncoder().encode(JSON.stringify(framingConfig));
  const mesh = new TextEncoder().encode('{"width":1920,"height":1080}');
  const manifest = completeBaselineManifest({
    width: 1920,
    height: 1080,
    assets: { left: { path: "left.json", sha256: await sha256Hex(mesh) } },
    framing: { path: "../td-source-config.json", sha256: await sha256Hex(framing) },
  });
  const fetchImpl = vi.fn(async (url) => ({
    ok: true,
    async arrayBuffer() {
      if (url.endsWith("manifest.json")) return new TextEncoder().encode(JSON.stringify(manifest)).buffer;
      return (url.endsWith("td-source-config.json") ? framing : mesh).buffer;
    },
  }));
  const pending = createProjectionBrowserSurface({
    host,
    spanId: "left",
    image,
    fetchImpl,
    signal: controller.signal,
    rendererFactory: vi.fn(),
  });
  await Promise.resolve();
  controller.abort();
  resolveImage?.();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(createElement).not.toHaveBeenCalled();
});

test("surfaces baseline failures before a renderer or canvas exists", async () => {
  const children = [];
  const errorElement = { style: {}, setAttribute() {}, remove() {} };
  const host = {
    children,
    ownerDocument: { createElement: vi.fn(() => errorElement) },
    appendChild(node) { children.push(node); },
    querySelector() { return null; },
  };
  await expect(createProjectionBrowserSurface({
    host,
    spanId: "left",
    image: { complete: true, naturalWidth: 10 },
    fetchImpl: async () => ({ ok: false }),
    rendererFactory: vi.fn(),
  })).rejects.toThrow(/baseline manifest unavailable/i);
  expect(children).toContain(errorElement);
  expect(errorElement.className).toBe("projection-browser-error");
});

test("browser surface exposes video protection state and schedules map redraws only while playback is active", async () => {
  vi.useFakeTimers();
  const oldDocument = globalThis.document;
  const draws = [];
  globalThis.document = { createElement() { return { style: {}, dataset: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, remove() {} }; } };
  try {
    const surface = await createProjectionBrowserSurface({
      host: { appendChild() {} }, spanId: "left", image: { complete: true, naturalWidth: 10, style: {} },
      initialConfig: structuredClone(DEFAULT_PROJECTION_CONFIG), fetchImpl: async () => ({ ok: false }),
      rendererFactory: () => ({ draw(scene) { draws.push(scene); return true; }, isContextLost: () => false, dispose() {} }),
    });
    expect(surface.canvas.dataset.videoPlaybackProtection).toBe("inactive");
    surface.setVideoPlaybackActive(true);
    surface.requestDraw();
    surface.requestDraw();
    expect(draws).toHaveLength(1);
    vi.advanceTimersByTime(49);
    expect(draws).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(draws).toHaveLength(2);
    expect(surface.canvas.dataset.videoPlaybackProtection).toBe("active");
    surface.setVideoPlaybackActive(false);
    surface.requestDraw();
    expect(draws).toHaveLength(3);
    expect(surface.canvas.dataset.videoPlaybackProtection).toBe("inactive");
    surface.dispose();
  } finally {
    globalThis.document = oldDocument;
    vi.useRealTimers();
  }
});

test("cancels capped draws during context loss and redraws the latest scene on restoration", async () => {
  vi.useFakeTimers();
  const oldDocument = globalThis.document;
  const listeners = new Map(); const draws = [];
  let contextLost = false;
  globalThis.document = { createElement() { return {
    style: {}, dataset: {}, setAttribute() {}, remove() {},
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type) { listeners.delete(type); },
  }; } };
  try {
    const surface = await createProjectionBrowserSurface({
      host: { appendChild() {} }, spanId: "left", image: { complete: true, naturalWidth: 10, style: {} },
      initialConfig: structuredClone(DEFAULT_PROJECTION_CONFIG), fetchImpl: async () => ({ ok: false }),
      rendererFactory: () => ({ draw(scene) { draws.push(scene); return true; }, isContextLost: () => contextLost, dispose() {} }),
    });
    surface.setVideoPlaybackActive(true);
    surface.requestDraw();
    contextLost = true;
    listeners.get("webglcontextlost")?.({ preventDefault() {} });
    surface.requestDraw();
    vi.advanceTimersByTime(100);
    expect(draws).toHaveLength(1);
    contextLost = false;
    listeners.get("webglcontextrestored")?.();
    expect(draws).toHaveLength(2);
    surface.dispose();
  } finally {
    globalThis.document = oldDocument;
    vi.useRealTimers();
  }
});
