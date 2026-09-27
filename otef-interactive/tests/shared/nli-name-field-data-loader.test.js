import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROJECTION_CONFIG } from '../../frontend/src/shared/projection-config-schema.js';
import { createFullFrameProjectionMesh } from '../../frontend/src/shared/projection-warp-geometry.js';

const { runNameFieldWorker } = vi.hoisted(() => ({
  runNameFieldWorker: vi.fn((payload) => Promise.resolve({ geometry: payload.geometry })),
}));
vi.mock('../../frontend/src/shared/nli-name-field-worker-client.js', () => ({ runNameFieldWorker }));

const model = {
  west: 34.1,
  south: 31.1,
  east: 34.9,
  north: 31.8,
  bounds_polygon: [{ x: 34.1, y: 31.1 }, { x: 34.9, y: 31.1 }, { x: 34.9, y: 31.8 }],
};
const data = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [34.5, 31.4] }, properties: { pid: '1', status: 'Murdered', hebrew_name: 'תמר' } }],
};
const metadata = { datasetVersion: 'test-version' };

function installLoaderGlobals() {
  const ctx = { font: '', measureText: vi.fn(() => ({ width: 24, actualBoundingBoxLeft: 12, actualBoundingBoxRight: 12, actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 2 })) };
  globalThis.fetch = vi.fn((url) => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(url.includes('model-bounds') ? model : url.includes('release-metadata') ? metadata : data),
  }));
  globalThis.proj4 = vi.fn((_from, _to, point) => point);
  globalThis.document = {
    fonts: { load: vi.fn(() => Promise.resolve()) },
    createElement: vi.fn(() => ({ getContext: () => ctx })),
  };
  globalThis.localStorage = { getItem: vi.fn(() => null) };
}

describe('loadNliNameField', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    runNameFieldWorker.mockReset();
    runNameFieldWorker.mockImplementation((payload) => Promise.resolve({ geometry: payload.geometry }));
    installLoaderGlobals();
  });

  it('caches source inputs while rebuilding the worker field for each projection config', async () => {
    const { loadNliNameField } = await import('../../frontend/src/shared/nli-name-field-data.js');
    const changedConfig = structuredClone(DEFAULT_PROJECTION_CONFIG);
    changedConfig.pre.tx = 0.2;

    const first = await loadNliNameField();
    const second = await loadNliNameField({ projectionConfig: changedConfig });

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls.filter(([url]) => url.includes('people_names'))).toHaveLength(1);
    expect(runNameFieldWorker).toHaveBeenCalledTimes(2);
    expect(first.geometry.projectionConfig).toEqual(DEFAULT_PROJECTION_CONFIG);
    expect(second.geometry.projectionConfig).toEqual(changedConfig);
    expect(first.geometry.projectionConfig).not.toBe(second.geometry.projectionConfig);
    expect(runNameFieldWorker.mock.calls[0][0]).not.toHaveProperty('revision');
    expect(runNameFieldWorker.mock.calls[1][0]).not.toHaveProperty('revision');
  });

  it('passes the default projection config when called without options', async () => {
    const { loadNliNameField } = await import('../../frontend/src/shared/nli-name-field-data.js');

    await loadNliNameField();

    expect(runNameFieldWorker).toHaveBeenCalledOnce();
    expect(runNameFieldWorker.mock.calls[0][0].geometry.projectionConfig).toEqual(DEFAULT_PROJECTION_CONFIG);
  });
});

describe('versioned wall inputs', () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks(); installLoaderGlobals();
    runNameFieldWorker.mockReset();
    runNameFieldWorker.mockImplementation((payload) => Promise.resolve({ geometry: payload.geometry }));
    document.fonts.load = vi.fn(() => Promise.resolve([{ family: 'Guttman Hatzvi', status: 'loaded' }]));
    document.fonts.check = vi.fn(() => true);
  });

  it('reuses an unchanged preparation after a preview caller aborts', async () => {
    const { prepareProjectionNameWall } = await import('../../frontend/src/shared/nli-name-field-data.js');
    let finish;
    const pending = new Promise((resolve) => { finish = resolve; });
    const preparedField = { placements: [{ id: '1', output: 'left' }], logicalPlane: { heading: 41, planeScale: 1 },
      fontSize: 8, geojson: data, groupGeojson: data, byPid: new Map([['1', {}]]),
      datasetVersion: 'test-version', digest: 'same', diagnostics: { state: 'valid', expected: 1, placed: 1 } };
    runNameFieldWorker.mockResolvedValue(preparedField);
    runNameFieldWorker.mockImplementationOnce(() => pending);
    const request = { config: DEFAULT_PROJECTION_CONFIG,
      meshes: { left: createFullFrameProjectionMesh({ side: 'left' }),
        right: createFullFrameProjectionMesh({ side: 'right' }) }, datasetVersion: 'test-version', heading: 41 };
    const activeCalls = () => runNameFieldWorker.mock.calls.filter(([payload]) => payload.namesWall.activeMode === 'wall');
    const preview = new AbortController();
    const first = prepareProjectionNameWall({ ...request, signal: preview.signal });
    const settledPreview = first.catch(() => {});
    await vi.waitFor(() => expect(activeCalls()).toHaveLength(1));
    const second = prepareProjectionNameWall(request);
    preview.abort();
    await settledPreview;
    expect(activeCalls()).toHaveLength(1);
    expect(activeCalls()[0][2].aborted).toBe(false);
    finish(preparedField);
    const field = await second;
    expect(field).toBe(preparedField);
    expect(await prepareProjectionNameWall(request)).toBe(field);
    expect(activeCalls()).toHaveLength(1);
  });

  it('shares preview/runtime preparation under profile change without restoring an old prewarm', async () => {
    const { prepareProjectionNameWall } = await import('../../frontend/src/shared/nli-name-field-data.js');
    const tkuma = { type: 'FeatureCollection', crs: { properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
      features: [{ geometry: { type: 'LineString', coordinates: [[34,31],[35,31],[35,32],[34,32],[34,31]] } }] };
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn((url) => url.includes('Tkuma_Area')
      ? Promise.resolve({ ok: true, json: () => Promise.resolve(tkuma) }) : original(url));
    const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
    const meshes = { left: createFullFrameProjectionMesh({ side: 'left' }),
      right: createFullFrameProjectionMesh({ side: 'right' }) };
    const request = { config, meshes, datasetVersion: 'test-version', heading: 41 };
    const pending = new Map();
    runNameFieldWorker.mockImplementation((payload, _worker, signal) => new Promise((resolve) => {
      pending.set(`${payload.namesWall.activeMode}:${payload.namesWall.profiles.model.requestedFontPx}`,
        { resolve, signal });
    }));
    const previewPrepare = prepareProjectionNameWall(request);
    await vi.waitFor(() => expect(runNameFieldWorker).toHaveBeenCalledTimes(1));
    const changed = structuredClone(config);
    changed.namesWall.activeMode = 'model';
    changed.namesWall.profiles.model.requestedFontPx = 8;
    const runtimePrepare = prepareProjectionNameWall({ ...request, config: changed });
    await vi.waitFor(() => expect(runNameFieldWorker).toHaveBeenCalledTimes(2));
    const model = { id: 'model-8', datasetVersion: 'test-version' };
    pending.get('wall:12').resolve({ id: 'wall-12', datasetVersion: 'test-version' });
    await previewPrepare;
    await Promise.resolve();
    expect(runNameFieldWorker).toHaveBeenCalledTimes(2);
    expect(pending.get('model:8').signal.aborted).toBe(false);
    pending.get('model:8').resolve(model);
    expect(await runtimePrepare).toBe(model);
    expect(await prepareProjectionNameWall({ ...request, config: changed })).toBe(model);
    expect(runNameFieldWorker).toHaveBeenCalledTimes(2);
  });

  it('cancels an obsolete mode worker when that profile changes', async () => {
    const { prepareProjectionNameWall } = await import('../../frontend/src/shared/nli-name-field-data.js');
    const tkuma = { type: 'FeatureCollection', crs: { properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
      features: [{ geometry: { type: 'LineString', coordinates: [[34,31],[35,31],[35,32],[34,32],[34,31]] } }] };
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn((url) => url.includes('Tkuma_Area')
      ? Promise.resolve({ ok: true, json: () => Promise.resolve(tkuma) }) : original(url));
    const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
    const meshes = { left: createFullFrameProjectionMesh({ side: 'left' }),
      right: createFullFrameProjectionMesh({ side: 'right' }) };
    const request = { config, meshes, datasetVersion: 'test-version', heading: 41 };
    const calls = [];
    runNameFieldWorker.mockImplementation((payload, _worker, signal) => new Promise((resolve) => {
      calls.push({ payload, signal, resolve });
    }));
    const first = prepareProjectionNameWall(request);
    const settledFirst = first.catch(() => {});
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const changed = structuredClone(config);
    changed.namesWall.profiles.wall.requestedFontPx = 8;
    const second = prepareProjectionNameWall({ ...request, config: changed });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0].signal.aborted).toBe(true);
    calls[0].resolve({ id: 'old' });
    await settledFirst;
    await Promise.resolve();
    expect(calls).toHaveLength(2);
    calls[1].resolve({ id: 'new' });
    expect((await second).id).toBe('new');
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2].payload.namesWall.activeMode).toBe('model');
    expect(calls[2].signal.aborted).toBe(false);
    const model = { id: 'prewarmed-model' };
    calls[2].resolve(model);
    const modelConfig = structuredClone(changed);
    modelConfig.namesWall.activeMode = 'model';
    expect(await prepareProjectionNameWall({ ...request, config: modelConfig })).toBe(model);
    expect(calls).toHaveLength(3);
  });

  it('reuses model preparation and font metrics when only regular page spacing changes', async () => {
    const { prepareProjectionNameWall } = await import('../../frontend/src/shared/nli-name-field-data.js');
    const tkuma = { type: 'FeatureCollection', crs: { properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
      features: [{ geometry: { type: 'LineString', coordinates: [[34,31],[35,31],[35,32],[34,32],[34,31]] } }] };
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn((url) => url.includes('Tkuma_Area')
      ? Promise.resolve({ ok: true, json: () => Promise.resolve(tkuma) }) : original(url));
    const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
    const meshes = { left: createFullFrameProjectionMesh({ side: 'left' }),
      right: createFullFrameProjectionMesh({ side: 'right' }) };
    const request = { config, meshes, datasetVersion: 'test-version', heading: 35 };
    runNameFieldWorker.mockImplementation((payload) => Promise.resolve({
      id: `${payload.namesWall.activeMode}:${payload.namesWall.profiles.wall.inwardShiftPercent}`,
      datasetVersion: 'test-version',
    }));
    expect((await prepareProjectionNameWall(request)).id).toBe('wall:0');
    await vi.waitFor(() => expect(runNameFieldWorker).toHaveBeenCalledTimes(2));
    const measured = document.createElement().getContext().measureText;
    const measureCount = measured.mock.calls.length;
    const changed = structuredClone(config);
    changed.namesWall.profiles.wall.inwardShiftPercent = 50;
    expect((await prepareProjectionNameWall({ ...request, config: changed })).id).toBe('wall:50');
    expect(runNameFieldWorker.mock.calls.map(([payload]) => payload.namesWall.activeMode)).toEqual(['wall', 'model', 'wall']);
    expect(measured).toHaveBeenCalledTimes(measureCount);
    const modelConfig = structuredClone(changed);
    modelConfig.namesWall.activeMode = 'model';
    expect((await prepareProjectionNameWall({ ...request, config: modelConfig })).id).toBe('model:0');
    expect(runNameFieldWorker).toHaveBeenCalledTimes(3);
  });

  it('reloads source and metadata for a new requested version and rejects mismatched metadata', async () => {
    const { loadNliNameField } = await import('../../frontend/src/shared/nli-name-field-data.js');
    await loadNliNameField({ datasetVersion: 'test-version' });
    expect(fetch).toHaveBeenCalledTimes(3);
    await expect(loadNliNameField({ datasetVersion: 'other-version' })).rejects.toThrow(/dataset version/i);
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it('measures all integer sizes for wall mode and fetches Tkuma only for model mode', async () => {
    const tkuma = { type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
      features: [{ geometry: { type: 'LineString', coordinates: [[34,31],[35,31],[35,32],[34,32],[34,31]] } }] };
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn((url) => url.includes('Tkuma_Area') ? Promise.resolve({ ok: true, json: () => Promise.resolve(tkuma) }) : original(url));
    const { loadNliNameField } = await import('../../frontend/src/shared/nli-name-field-data.js');
    const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
    config.namesWall.profiles.wall.requestedFontPx = 10;
    await loadNliNameField({ projectionConfig: config, coverage: { pieces: {} }, datasetVersion: 'test-version' });
    const wallPayload = runNameFieldWorker.mock.lastCall[0];
    expect(wallPayload.metrics.map(([size]) => size)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(wallPayload).not.toHaveProperty('ring');
    expect(fetch.mock.calls.some(([url]) => url.includes('Tkuma_Area'))).toBe(false);
    config.namesWall.activeMode = 'model';
    await loadNliNameField({ projectionConfig: config, coverage: { pieces: {} }, datasetVersion: 'test-version' });
    expect(fetch.mock.calls.filter(([url]) => url.includes('Tkuma_Area'))).toHaveLength(1);
    expect(runNameFieldWorker.mock.lastCall[0].ringHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a missing projection font before starting the worker', async () => {
    document.fonts.load = vi.fn(() => Promise.resolve([])); document.fonts.check = vi.fn(() => false);
    const { loadNliNameField } = await import('../../frontend/src/shared/nli-name-field-data.js');
    await expect(loadNliNameField({ coverage: { pieces: {} }, datasetVersion: 'test-version' })).rejects.toThrow(/Guttman Hatzvi/);
    expect(runNameFieldWorker).not.toHaveBeenCalled();
  });
  it('does not start a wall worker after its preparation was cancelled', async () => {
    const { loadNliNameField } = await import('../../frontend/src/shared/nli-name-field-data.js');
    const controller = new AbortController();
    controller.abort();
    await expect(loadNliNameField({ coverage: { pieces: {} }, datasetVersion: 'test-version', signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(runNameFieldWorker).not.toHaveBeenCalled();
    await expect(loadNliNameField({ coverage: { pieces: {} }, datasetVersion: 'test-version' })).resolves.toBeDefined();
    expect(runNameFieldWorker).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('reuses same-version source inputs after aborting a running wall worker', async () => {
    const { loadNliNameField } = await import('../../frontend/src/shared/nli-name-field-data.js');
    const controller = new AbortController();
    runNameFieldWorker.mockImplementationOnce((_payload, _constructor, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true });
    }));
    const first = loadNliNameField({ coverage: { pieces: {} }, datasetVersion: 'test-version', signal: controller.signal });
    await vi.waitFor(() => expect(runNameFieldWorker).toHaveBeenCalledOnce());
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(loadNliNameField({ coverage: { pieces: {} }, datasetVersion: 'test-version' })).resolves.toBeDefined();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(runNameFieldWorker).toHaveBeenCalledTimes(2);
  });

  it('rejects a worker result superseded by explicit dataset invalidation', async () => {
    let finish;
    runNameFieldWorker.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { loadNliNameField, invalidateNliNameFieldInputs } = await import('../../frontend/src/shared/nli-name-field-data.js');
    const pending = loadNliNameField({ datasetVersion: 'test-version' });
    await vi.waitFor(() => expect(runNameFieldWorker).toHaveBeenCalledOnce());
    invalidateNliNameFieldInputs();
    finish({ datasetVersion: 'test-version' });
    await expect(pending).rejects.toThrow(/stale.*worker/i);
  });

  it('reloads the source collection when the accepted dataset version changes', async () => {
    let version = 'test-version';
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn((url) => url.includes('release-metadata') ? Promise.resolve({ ok: true, json: () => Promise.resolve({ datasetVersion: version }) }) : original(url));
    const { loadNliNameField, invalidateNliNameFieldInputs } = await import('../../frontend/src/shared/nli-name-field-data.js');
    await loadNliNameField({ datasetVersion: version });
    version = 'next-version';
    invalidateNliNameFieldInputs();
    await loadNliNameField({ datasetVersion: version });
    expect(fetch.mock.calls.filter(([url]) => url.includes('people_names'))).toHaveLength(2);
    expect(runNameFieldWorker.mock.lastCall[0].datasetVersion).toBe('next-version');
  });

  it('supersedes an in-flight worker when a different requested version arrives', async () => {
    let finish;
    let version = 'test-version';
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn((url) => url.includes('release-metadata') ? Promise.resolve({ ok: true, json: () => Promise.resolve({ datasetVersion: version }) }) : original(url));
    runNameFieldWorker.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { loadNliNameField } = await import('../../frontend/src/shared/nli-name-field-data.js');
    const first = loadNliNameField({ datasetVersion: version });
    await vi.waitFor(() => expect(runNameFieldWorker).toHaveBeenCalledOnce());
    version = 'next-version';
    const next = loadNliNameField({ datasetVersion: version });
    finish({ datasetVersion: 'test-version' });
    await expect(first).rejects.toThrow(/stale/i);
    await expect(next).resolves.toBeDefined();
  });

  it('rasterizes missing ink bounds under the draw state and includes asymmetric pixels', async () => {
    const rasterContext = { font: '', textAlign: '', textBaseline: '', direction: '', fillStyle: '',
      fillText: vi.fn(), getImageData: vi.fn((_x, _y, width, height) => {
        const data = new Uint8ClampedArray(width * height * 4);
        const [, originX, originY] = rasterContext.fillText.mock.lastCall;
        for (let y = originY - 7; y < originY + 2; y++) for (let x = originX - 15; x < originX + 5; x++) data[(y * width + x) * 4 + 3] = 255;
        return { data };
      }) };
    const measureContext = { font: '', measureText: vi.fn(() => ({ width: 24 })) };
    let created = 0;
    document.createElement = vi.fn(() => ({ getContext: () => created++ === 0 ? measureContext : rasterContext }));
    const { measureNamesWallMetrics } = await import('../../frontend/src/shared/nli-name-field-data.js');
    const result = await measureNamesWallMetrics([{ name: 'תמר' }], { requestedFontPx: 8, minimumFontPx: 8 });
    const metric = result.metrics[0][1][0][1];
    expect(metric.fallback).toBe(true);
    expect(metric).toMatchObject({ left: 15, right: 5, ascent: 7, descent: 2 });
    expect([rasterContext.textAlign, rasterContext.textBaseline, rasterContext.direction]).toEqual(['center', 'middle', 'rtl']);
  });

  it('rejects missing ink bounds when the raster fallback cannot inspect pixels', async () => {
    document.createElement = vi.fn(() => ({ getContext: () => ({ font: '', measureText: () => ({ width: 24 }) }) }));
    const { measureNamesWallMetrics } = await import('../../frontend/src/shared/nli-name-field-data.js');
    await expect(measureNamesWallMetrics([{ name: 'תמר' }], { requestedFontPx: 8, minimumFontPx: 8 })).rejects.toThrow(/ink bounds/i);
  });

  it('rejects invalid Tkuma CRS before worker submission', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn((url) => url.includes('Tkuma_Area') ? Promise.resolve({ ok: true, json: () => Promise.resolve({
      type: 'FeatureCollection', crs: { properties: { name: 'EPSG:2039' } }, features: [],
    }) }) : original(url));
    const { loadNliNameField } = await import('../../frontend/src/shared/nli-name-field-data.js');
    const config = structuredClone(DEFAULT_PROJECTION_CONFIG); config.namesWall.activeMode = 'model';
    await expect(loadNliNameField({ projectionConfig: config, coverage: { pieces: {} }, datasetVersion: 'test-version' })).rejects.toThrow(/Tkuma CRS/);
    expect(runNameFieldWorker).not.toHaveBeenCalled();
  });

  it('detects a new metadata version before reusing unversioned GIS source inputs', async () => {
    let version = 'test-version';
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn((url) => url.includes('release-metadata') ? Promise.resolve({ ok: true, json: () => Promise.resolve({ datasetVersion: version }) }) : original(url));
    const { loadNliNameField } = await import('../../frontend/src/shared/nli-name-field-data.js');
    await loadNliNameField();
    version = 'next-version';
    await loadNliNameField();
    expect(fetch.mock.calls.filter(([url]) => url.includes('people_names'))).toHaveLength(2);
    expect(runNameFieldWorker.mock.lastCall[0].datasetVersion).toBe('next-version');
  });

  it('rejects cached input when another dataset supersedes its pending metadata check', async () => {
    const original = globalThis.fetch;
    let releaseHeldMetadata;
    let metadataRequests = 0;
    globalThis.fetch = vi.fn((url, options) => {
      if (!url.includes('release-metadata')) return original(url, options);
      metadataRequests++;
      if (metadataRequests === 2) return new Promise((resolve) => {
        releaseHeldMetadata = () => resolve({ ok: true, json: () => Promise.resolve({ datasetVersion: 'test-version' }) });
      });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ datasetVersion: metadataRequests === 1 ? 'test-version' : 'next-version' }) });
    });
    const { loadNliNameField } = await import('../../frontend/src/shared/nli-name-field-data.js');
    await loadNliNameField();
    const stale = loadNliNameField();
    await vi.waitFor(() => expect(releaseHeldMetadata).toBeTypeOf('function'));
    await loadNliNameField({ datasetVersion: 'next-version' });
    releaseHeldMetadata();
    await expect(stale).rejects.toThrow(/stale/i);
    expect(runNameFieldWorker.mock.lastCall[0].datasetVersion).toBe('next-version');
  });

  it('reloads Tkuma and changes its hash when the canonical asset changes', async () => {
    let offset = 0;
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn((url) => url.includes('Tkuma_Area') ? Promise.resolve({ ok: true, json: () => Promise.resolve({
      type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
      features: [{ geometry: { type: 'LineString', coordinates: [[34 + offset,31],[35,31],[35,32],[34 + offset,32],[34 + offset,31]] } }],
    }) }) : original(url));
    const { loadNliNameField } = await import('../../frontend/src/shared/nli-name-field-data.js');
    const config = structuredClone(DEFAULT_PROJECTION_CONFIG); config.namesWall.activeMode = 'model';
    await loadNliNameField({ projectionConfig: config, coverage: { pieces: {} }, datasetVersion: 'test-version' });
    const firstHash = runNameFieldWorker.mock.lastCall[0].ringHash;
    offset = 0.01;
    await loadNliNameField({ projectionConfig: config, coverage: { pieces: {} }, datasetVersion: 'test-version' });
    expect(fetch.mock.calls.filter(([url]) => url.includes('Tkuma_Area'))).toHaveLength(2);
    expect(runNameFieldWorker.mock.lastCall[0].ringHash).not.toBe(firstHash);
  });

  it('measures under the same RTL center and middle Canvas text state as drawing', async () => {
    const ctx = { font: '', textAlign: 'start', textBaseline: 'alphabetic', direction: 'ltr', measureText: vi.fn(function () {
      expect([this.textAlign, this.textBaseline, this.direction]).toEqual(['center', 'middle', 'rtl']);
      return { width: 20, actualBoundingBoxLeft: 16, actualBoundingBoxRight: 4, actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 2 };
    }) };
    document.createElement = vi.fn(() => ({ getContext: () => ctx }));
    const { measureNamesWallMetrics } = await import('../../frontend/src/shared/nli-name-field-data.js');
    await measureNamesWallMetrics([{ name: 'אב 12' }], { requestedFontPx: 8, minimumFontPx: 8 });
    expect(ctx.measureText).toHaveBeenCalledTimes(8);
  });
});
