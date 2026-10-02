import { validateWarpMesh } from './projection-warp-geometry.js';
import { normalizeProjectionBaselineHash, resolveProjectionBaselineAsset, validateProjectionBaselineManifest } from './projection-baseline-manifest.js';

export { resolveProjectionBaselineAsset, validateProjectionBaselineManifest };

export function validateProjectionBaselineMesh(mesh, { side, manifest = null, baseline = null } = {}) {
  const errors = {};
  try { validateWarpMesh(mesh); } catch (error) { errors.mesh = error.message; return errors; }
  if (side && mesh.side !== side) errors.side = 'does not match the requested span';
  if (manifest) {
    const manifestErrors = validateProjectionBaselineManifest(manifest);
    for (const [path, message] of Object.entries(manifestErrors)) errors[`manifest.${path}`] = message;
    if (Object.keys(manifestErrors).length) return errors;
  }
  if (manifest && side) {
    let asset;
    try { asset = resolveProjectionBaselineAsset(manifest, side, baseline); }
    catch (error) {
      if (/manifest/.test(error.message)) errors.manifest = error.message;
      errors.assetId = 'is not present in the trusted manifest';
      errors.sha256 = 'is not present in the trusted manifest';
      return errors;
    }
    if (baseline && baseline.assetId !== asset.assetId) errors.assetId = 'does not match the trusted manifest';
    if (baseline && normalizeProjectionBaselineHash(baseline.sha256) !== normalizeProjectionBaselineHash(asset.sha256)) errors.sha256 = 'does not match the trusted manifest';
    if (mesh.logicalGrid?.columns !== asset.logicalGrid?.columns || mesh.logicalGrid?.rows !== asset.logicalGrid?.rows) errors.logicalGrid = 'does not match the trusted manifest';
    if (asset.origin != null && mesh.origin !== asset.origin) errors.origin = 'does not match the trusted manifest';
  }
  return errors;
}
