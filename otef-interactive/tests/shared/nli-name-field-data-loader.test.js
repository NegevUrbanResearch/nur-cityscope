import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROJECTION_CONFIG } from '../../frontend/src/shared/projection-config-schema.js';

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
  features: [{ properties: { hebrew_name: 'תמר' } }],
};
const metadata = { datasetVersion: 'test-version' };

function installLoaderGlobals() {
  const ctx = { font: '', measureText: vi.fn(() => ({ width: 24 })) };
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
    installLoaderGlobals();
  });

  it('caches source inputs while rebuilding the worker field for each projection config', async () => {
    const { loadNliNameField } = await import('../../frontend/src/shared/nli-name-field-data.js');
    const changedConfig = structuredClone(DEFAULT_PROJECTION_CONFIG);
    changedConfig.pre.tx = 0.2;

    const first = await loadNliNameField();
    const second = await loadNliNameField({ projectionConfig: changedConfig });

    expect(fetch).toHaveBeenCalledTimes(3);
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
