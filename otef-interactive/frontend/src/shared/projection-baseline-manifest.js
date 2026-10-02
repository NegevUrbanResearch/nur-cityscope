const SIDES = ['left', 'right'];
const HASH = /^[0-9a-f]{64}$/i;
const validCount = (value) => Number.isSafeInteger(value) && value >= 2;

export function normalizeProjectionBaselineHash(value) {
  return typeof value === 'string' ? value.replace(/^sha256:/i, '').toLowerCase() : '';
}

export function isSafeProjectionBaselinePath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || /[:\\?#%\u0000-\u001f\u007f]/.test(value)) return false;
  const parts = value.split('/');
  return parts.every((part) => part && part !== '.' && part !== '..');
}

function validLogicalGrid(grid) {
  return Boolean(grid && typeof grid === 'object' && !Array.isArray(grid) &&
    validCount(grid.columns) && validCount(grid.rows) && grid.columns * grid.rows <= 65536);
}

function validateAsset(asset, path, errors) {
  if (!asset || typeof asset !== 'object' || Array.isArray(asset)) { errors[path] = 'must be an object'; return; }
  if (typeof asset.assetId !== 'string' || !asset.assetId) errors[`${path}.assetId`] = 'must be a non-empty string';
  if (!isSafeProjectionBaselinePath(asset.path)) errors[`${path}.path`] = 'must be a safe relative mesh path';
  if (!HASH.test(normalizeProjectionBaselineHash(asset.sha256))) errors[`${path}.sha256`] = 'must be a 64-character SHA-256 hex digest';
  if (!validLogicalGrid(asset.logicalGrid)) errors[`${path}.logicalGrid`] = 'must contain integer columns/rows >= 2 with at most 65536 points';
  if (Object.hasOwn(asset, 'width') && asset.width !== 1920) errors[`${path}.width`] = 'must equal 1920';
  if (Object.hasOwn(asset, 'height') && asset.height !== 1080) errors[`${path}.height`] = 'must equal 1080';
  if (Object.hasOwn(asset, 'origin') && asset.origin !== 'top-left') errors[`${path}.origin`] = 'must equal top-left';
}

export function validateProjectionBaselineManifest(manifest) {
  const errors = {};
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return { manifest: 'must be an object' };
  if (manifest.schemaVersion !== 1) errors.schemaVersion = 'must equal 1';
  if (manifest.width !== 1920) errors.width = 'must equal 1920';
  if (manifest.height !== 1080) errors.height = 'must equal 1080';
  if (!manifest.assets || typeof manifest.assets !== 'object' || Array.isArray(manifest.assets)) errors.assets = 'must be an object';
  for (const side of SIDES) {
    const asset = manifest.assets?.[side];
    const path = `assets.${side}`;
    if (!manifest.assets || typeof manifest.assets !== 'object' || Array.isArray(manifest.assets)) continue;
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) { errors[path] = 'is required'; continue; }
    validateAsset(asset, path, errors);
  }
  if (Object.hasOwn(manifest, 'catalog')) {
    const catalog = manifest.catalog;
    if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog) || Object.keys(catalog).some((side) => !SIDES.includes(side)) || SIDES.some((side) => !Object.hasOwn(catalog, side))) {
      errors.catalog = 'must contain exactly left and right arrays';
    } else {
      for (const side of SIDES) {
        if (!Array.isArray(catalog[side])) { errors[`catalog.${side}`] = 'must be an array'; continue; }
        for (let index = 0; index < catalog[side].length; index += 1) validateAsset(catalog[side][index], `catalog.${side}[${index}]`, errors);
      }
    }
  }
  const framing = manifest.framing;
  if (!framing || typeof framing !== 'object' || Array.isArray(framing)) errors.framing = 'must be an object';
  else {
    if (typeof framing.path !== 'string' || !framing.path) errors['framing.path'] = 'is required';
    if (typeof framing.sha256 !== 'string' || !HASH.test(normalizeProjectionBaselineHash(framing.sha256))) errors['framing.sha256'] = 'must be a 64-character SHA-256 hex digest';
  }
  if (manifest.assets && typeof manifest.assets === 'object' && !Array.isArray(manifest.assets)) {
    for (const side of SIDES) {
      const ids = new Set();
      for (const asset of [manifest.assets[side], ...(Array.isArray(manifest.catalog?.[side]) ? manifest.catalog[side] : [])]) {
        if (!asset || typeof asset !== 'object' || Array.isArray(asset) || typeof asset.assetId !== 'string' || !asset.assetId) continue;
        if (ids.has(asset.assetId)) errors[`catalog.${side}`] = 'contains a duplicate asset ID';
        ids.add(asset.assetId);
      }
    }
  }
  return errors;
}

export function resolveProjectionBaselineAsset(manifest, side, baseline = null) {
  if (!SIDES.includes(side)) throw new Error('projection baseline side must be left or right');
  const errors = validateProjectionBaselineManifest(manifest);
  if (Object.keys(errors).length) throw new Error('invalid projection baseline manifest: ' + Object.entries(errors).map(([path, message]) => `${path} ${message}`).join('; '));
  if (baseline == null) return manifest.assets[side];
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline) || typeof baseline.assetId !== 'string' || !baseline.assetId || !HASH.test(normalizeProjectionBaselineHash(baseline.sha256))) {
    throw new Error(`projection ${side} baseline reference is malformed`);
  }
  const entries = [manifest.assets[side], ...(manifest.catalog?.[side] || [])];
  const asset = entries.find((candidate) => candidate.assetId === baseline.assetId && normalizeProjectionBaselineHash(candidate.sha256) === normalizeProjectionBaselineHash(baseline.sha256));
  if (!asset) throw new Error(`projection ${side} baseline is not present in the trusted manifest`);
  return asset;
}
