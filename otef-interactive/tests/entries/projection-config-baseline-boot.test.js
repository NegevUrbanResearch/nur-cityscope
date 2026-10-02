import { expect, test, vi } from 'vitest';
const h = vi.hoisted(() => ({ options: null, meshes: [] }));
vi.mock('../../frontend/src/shared/api-client.js', () => ({ OTEF_API: { getState: async () => ({}) } }));
vi.mock('../../frontend/src/shared/layer-registry.js', () => ({ default: { init: async () => {} } }));
vi.mock('../../frontend/src/projection-config/config-controller.js', () => ({ mountProjectionConfig: (_root, options) => { h.options = options; return { dispose: () => options.candidateValidator.dispose() }; } }));
vi.mock('../../frontend/src/shared/projection-warp-geometry.js', async (original) => {
  const actual = await original();
  return { ...actual, evaluateWarpMesh: (...args) => { const mesh = actual.evaluateWarpMesh(...args); h.meshes.push(mesh); return mesh; } };
});
import { bootProjectionConfig } from '../../frontend/src/entries/projection-config-main.js';
import { projectionCatalog, clone } from '../fixtures/projection-catalog.js';

test('page preflight and editor share selected byte geometry, refreshed peer snapshot, and grid-edit cache', async () => {
  const f = await projectionCatalog('/otef-interactive/public/projection-calibration/td-baselines/');
  const dispose = await bootProjectionConfig({ document: { getElementById: () => ({}) },
    location: { href: 'http://localhost/otef-interactive/projection-config.html' }, socket: { on() {}, off() {} }, fetchImpl: f.fetchImpl });
  try {
    const validate = async (config) => h.options.candidateValidator.validateCandidate({ config, identity: JSON.stringify(config) });
    f.payloads.set(`${f.base}manifest.json`, new TextEncoder().encode(JSON.stringify(f.manifestA)));
    expect((await validate(f.config())).valid).toBe(true);
    f.payloads.set(`${f.base}manifest.json`, new TextEncoder().encode(JSON.stringify(f.manifestB)));
    const config = f.config('selected');
    expect((await validate(config)).valid).toBe(true);
    expect(Math.max(...h.meshes.at(-2).vertices.map((p) => p.x))).toBeCloseTo(0.72);
    expect(Math.max(...h.meshes.at(-1).vertices.map((p) => p.x))).toBeCloseTo(0.9);
    const prepared = await h.options.baselineCatalogLoader.prepare(config);
    expect(prepared.loaded.left.manifest).toBe(prepared.loaded.right.manifest);
    expect(prepared.snapshot.manifest).toEqual(f.manifestB);
    const edited = clone(config); edited.outputs.left.warp.grid.offsets[0] = [0.001, 0];
    expect((await validate(edited)).valid).toBe(true);
    expect(f.count('manifest.json')).toBe(2); expect(f.count('framing.json')).toBe(2);
    expect(f.count('selected/left.json')).toBe(1);
  } finally { dispose(); }
});
