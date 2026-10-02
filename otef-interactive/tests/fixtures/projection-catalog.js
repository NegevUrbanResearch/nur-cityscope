import { vi } from 'vitest';
import { DEFAULT_PROJECTION_CONFIG } from '../../frontend/src/shared/projection-config-schema.js';
import { createIdentityProjectionMesh } from '../../frontend/src/shared/projection-warp-geometry.js';
import { sha256Hex } from '../../frontend/src/shared/sha256-hex.js';

export const clone = (value) => structuredClone(value);
export const bytes = (value) => new TextEncoder().encode(JSON.stringify(value));
export const response = (value) => ({ ok: Boolean(value), arrayBuffer: async () => value.buffer });
export const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
export const reference = (asset) => ({ type: 'tdMesh', assetId: asset.assetId, sha256: asset.sha256, width: 1920, height: 1080, origin: 'top-left' });

/** Same logical topology, distinct geometry and independently hashed bytes. */
export async function projectionCatalog(base = '/baseline/') {
  const payloads = new Map();
  const entries = { historical: {}, selected: {} };
  const meshes = { historical: {}, selected: {} };
  const scales = { historical: { left: 0.95, right: 0.9 }, selected: { left: 0.72, right: 0.68 } };
  for (const kind of ['historical', 'selected']) for (const side of ['left', 'right']) {
    const mesh = createIdentityProjectionMesh({ side });
    mesh.logicalGrid = { columns: side === 'left' ? 7 : 8, rows: 7 };
    mesh.vertices.forEach((point) => { point.x *= scales[kind][side]; });
    const encoded = bytes(mesh);
    const path = `${kind}/${side}.json`;
    entries[kind][side] = { assetId: `${kind}-${side}`, path, sha256: await sha256Hex(encoded), logicalGrid: mesh.logicalGrid };
    meshes[kind][side] = mesh;
    payloads.set(`${base}${path}`, encoded);
  }
  const framing = clone(DEFAULT_PROJECTION_CONFIG);
  const framingBytes = bytes(framing);
  const manifestA = { schemaVersion: 1, width: 1920, height: 1080, assets: entries.historical,
    framing: { path: 'framing.json', sha256: await sha256Hex(framingBytes) } };
  const manifestB = { ...manifestA, catalog: { left: [entries.selected.left], right: [entries.selected.right] } };
  payloads.set(`${base}framing.json`, framingBytes);
  payloads.set(`${base}manifest.json`, bytes(manifestB));
  const fetchImpl = vi.fn(async (url) => response(payloads.get(url)));
  const config = (left = 'historical', right = 'historical') => {
    const value = clone(framing);
    value.outputs.left.warp.baseline = reference(entries[left].left);
    value.outputs.right.warp.baseline = reference(entries[right].right);
    return value;
  };
  const count = (suffix) => fetchImpl.mock.calls.filter(([url]) => url.endsWith(suffix)).length;
  return { base, payloads, entries, meshes, scales, manifestA, manifestB, fetchImpl, config, count,
    snapshotA: { manifest: manifestA, framing }, snapshotB: { manifest: manifestB, framing } };
}
