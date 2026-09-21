import { validateWarpMesh } from './projection-warp-geometry.js';
import { SIDES } from './projection-warp-schema.js';

const HASH = /^[0-9a-f]{64}$/i;

export function validateProjectionBaselineManifest(manifest) {
  const errors = {};
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return { manifest: 'must be an object' };
  if (manifest.schemaVersion !== 1) errors.schemaVersion = 'must equal 1';
  if (manifest.width !== 1920) errors.width = 'must equal 1920';
  if (manifest.height !== 1080) errors.height = 'must equal 1080';
  if (!manifest.assets || typeof manifest.assets !== 'object' || Array.isArray(manifest.assets)) {
    errors.assets = 'must be an object';
  }
  for (const side of Object.keys(SIDES)) {
    const asset = manifest.assets?.[side];
    if (!manifest.assets || typeof manifest.assets !== 'object' || Array.isArray(manifest.assets)) continue;
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) { errors[`assets.${side}`] = 'is required'; continue; }
    if (typeof asset.assetId !== 'string' || !asset.assetId) errors[`assets.${side}.assetId`] = 'must be a non-empty string';
    if (typeof asset.path !== 'string' || !asset.path) errors[`assets.${side}.path`] = 'must be a non-empty string';
    if (typeof asset.sha256 !== 'string' || !HASH.test(asset.sha256.replace(/^sha256:/i, ''))) errors[`assets.${side}.sha256`] = 'must be a 64-character SHA-256 hex digest';
    const expected = SIDES[side];
    if (asset.logicalGrid?.columns !== expected.columns) errors[`assets.${side}.logicalGrid.columns`] = `must equal ${expected.columns}`;
    if (asset.logicalGrid?.rows !== expected.rows) errors[`assets.${side}.logicalGrid.rows`] = `must equal ${expected.rows}`;
  }
  if (!manifest.framing || typeof manifest.framing !== 'object' || Array.isArray(manifest.framing)) {
    errors.framing = 'must be an object';
  } else {
    if (typeof manifest.framing.path !== 'string' || !manifest.framing.path) errors['framing.path'] = 'is required';
    if (typeof manifest.framing.sha256 !== 'string' || !HASH.test(manifest.framing.sha256.replace(/^sha256:/i, ''))) errors['framing.sha256'] = 'must be a 64-character SHA-256 hex digest';
  }
  return errors;
}

export function validateProjectionBaselineMesh(mesh, { side, manifest = null, baseline = null } = {}) {
  const errors = {};
  try { validateWarpMesh(mesh); } catch (error) { errors.mesh = error.message; return errors; }
  if (side && mesh.side !== side) errors.side = 'does not match the requested span';
  if (manifest && side) {
    const asset = manifest.assets?.[side];
    if (!asset) errors.asset = 'is not present in the trusted manifest';
    else {
      if (baseline?.assetId !== asset.assetId) errors.assetId = 'does not match the trusted manifest';
      if (baseline?.sha256?.toLowerCase().replace(/^sha256:/, '') !== asset.sha256?.toLowerCase().replace(/^sha256:/, '')) errors.sha256 = 'does not match the trusted manifest';
      if (mesh.logicalGrid?.columns !== asset.logicalGrid?.columns || mesh.logicalGrid?.rows !== asset.logicalGrid?.rows) errors.logicalGrid = 'does not match the trusted manifest';
    }
  }
  return errors;
}
