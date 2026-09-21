const SIDES = Object.freeze({ left: { columns: 7, rows: 7 }, right: { columns: 8, rows: 7 } });
const SAFETY_MIN = -1;
const SAFETY_MAX = 2;
const HASH = /^[0-9a-f]{64}$/i;
const BASELINE_HASHES = Object.freeze({
  left: 'e625d3cac525d9b4b5c3f2eb306d89e85d104eecb26d313512cad9a6d9b9c331',
  right: '6156d5a18dc1cc627a6085bc53939d1e1edb997992e416cb17a239b91ada52d4',
});

function ownKeys(value, keys, path, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { errors[path] = 'must be an object'; return false; }
  for (const key of keys) if (!Object.hasOwn(value, key)) errors[path ? `${path}.${key}` : key] = 'is required';
  for (const key of Object.keys(value)) if (!keys.includes(key)) errors[path ? `${path}.${key}` : key] = 'unknown field';
  return true;
}

function number(value, path, errors, min = SAFETY_MIN, max = SAFETY_MAX) {
  if (typeof value !== 'number' || !Number.isFinite(value)) { errors[path] = 'must be a finite number'; return false; }
  if (value < min || value > max) errors[path] = `must be between ${min} and ${max}`;
  return value >= min && value <= max;
}

function legacyFields(config, errors, options) {
  if (ownKeys(config.pre, ['scale', 'rotateDeg', 'tx', 'ty'], 'pre', errors)) {
    number(config.pre.scale, 'pre.scale', errors, 0.1, 8);
    number(config.pre.rotateDeg, 'pre.rotateDeg', errors, -180, 180);
    number(config.pre.tx, 'pre.tx', errors, -2, 2);
    number(config.pre.ty, 'pre.ty', errors, -2, 2);
  }
  if (!ownKeys(config.outputs, ['left', 'right'], 'outputs', errors)) return;
  for (const side of ['left', 'right']) {
    const base = `outputs.${side}`;
    const output = config.outputs[side];
    if (!ownKeys(output, ['crop', 'post', 'presentationEffect', 'warp'], base, errors)) continue;
    const crop = output.crop;
    if (ownKeys(crop, ['x0', 'x1', 'y0', 'y1'], `${base}.crop`, errors)) {
      for (const key of ['x0', 'x1', 'y0', 'y1']) number(crop[key], `${base}.crop.${key}`, errors, 0, 1);
      if ([crop.x0, crop.x1].every((value) => typeof value === 'number') && crop.x1 - crop.x0 < 0.01 - 1e-12) errors[`${base}.crop`] = 'x extent must be at least 0.01';
      if ([crop.y0, crop.y1].every((value) => typeof value === 'number') && crop.y1 - crop.y0 < 0.01 - 1e-12) errors[`${base}.crop`] = 'y extent must be at least 0.01';
    }
    const post = output.post;
    if (ownKeys(post, ['scale', 'tx', 'ty'], `${base}.post`, errors)) {
      number(post.scale, `${base}.post.scale`, errors, 0.1, 8);
      number(post.tx, `${base}.post.tx`, errors, -2, 2);
      number(post.ty, `${base}.post.ty`, errors, -2, 2);
    }
    const presentation = output.presentationEffect;
    if (ownKeys(presentation, ['enabled', 'mode'], `${base}.presentationEffect`, errors)) {
      if (typeof presentation.enabled !== 'boolean') errors[`${base}.presentationEffect.enabled`] = 'must be a boolean';
      if (presentation.mode !== 'passthrough') errors[`${base}.presentationEffect.mode`] = 'must equal passthrough';
    }
    const warpErrors = validateProjectionWarp(output.warp, side, options);
    for (const [path, message] of Object.entries(warpErrors)) errors[`${base}.${path}`] = message;
  }
}

export function validateProjectionWarp(value, side, { trustedManifest = null } = {}) {
  const errors = {};
  const expected = SIDES[side];
  if (!expected) { errors.side = 'must be left or right'; return errors; }
  if (!ownKeys(value, ['enabled', 'baseline', 'keystone', 'grid'], '', errors)) return errors;
  if (typeof value.enabled !== 'boolean') errors.enabled = 'must be a boolean';
  const baselineKeys = value?.baseline?.type === 'identity' ? ['type', 'width', 'height', 'origin'] : ['type', 'assetId', 'sha256', 'width', 'height', 'origin'];
  if (ownKeys(value.baseline, baselineKeys, 'baseline', errors)) {
    if (value.baseline.type !== 'tdMesh' && value.baseline.type !== 'identity') errors['baseline.type'] = 'must equal tdMesh or identity';
    if (value.baseline.type === 'tdMesh' && (typeof value.baseline.assetId !== 'string' || !value.baseline.assetId)) errors['baseline.assetId'] = 'must be a non-empty string';
    if (value.baseline.type === 'tdMesh' && (typeof value.baseline.sha256 !== 'string' || !HASH.test(value.baseline.sha256))) errors['baseline.sha256'] = 'must be a 64-character SHA-256 hex digest';
    if (value.baseline.width !== 1920) errors['baseline.width'] = 'must equal 1920';
    if (value.baseline.height !== 1080) errors['baseline.height'] = 'must equal 1080';
    if (value.baseline.origin !== 'top-left') errors['baseline.origin'] = 'must equal top-left';
    const asset = trustedManifest?.assets?.[side];
    if (value.baseline.type === 'tdMesh' && trustedManifest && (!asset || typeof asset !== 'object' || Array.isArray(asset))) {
      errors['baseline.assetId'] = 'is not present in the trusted manifest';
      errors['baseline.sha256'] = 'is not present in the trusted manifest';
    } else if (value.baseline.type === 'tdMesh' && asset) {
      if (value.baseline.assetId !== asset.assetId) errors['baseline.assetId'] = 'is not present in the trusted manifest';
      if (value.baseline.sha256?.toLowerCase() !== String(asset.sha256 || '').toLowerCase().replace(/^sha256:/, '')) errors['baseline.sha256'] = 'is not present in the trusted manifest';
      if (asset.width != null && value.baseline.width !== asset.width) errors['baseline.width'] = 'does not match the trusted manifest';
      if (asset.height != null && value.baseline.height !== asset.height) errors['baseline.height'] = 'does not match the trusted manifest';
    }
  }
  if (ownKeys(value.keystone, ['corners'], 'keystone', errors)) {
    if (!Array.isArray(value.keystone.corners) || value.keystone.corners.length !== 4) errors['keystone.corners'] = 'must contain four corners';
    else value.keystone.corners.forEach((point, index) => {
      if (!Array.isArray(point) || point.length !== 2) { errors[`keystone.corners[${index}]`] = 'must contain two coordinates'; return; }
      point.forEach((coordinate, axis) => number(coordinate, `keystone.corners[${index}][${axis}]`, errors));
    });
  }
  if (ownKeys(value.grid, ['columns', 'rows', 'offsets'], 'grid', errors)) {
    if (value.grid.columns !== expected.columns) errors['grid.columns'] = `must equal ${expected.columns}`;
    if (value.grid.rows !== expected.rows) errors['grid.rows'] = `must equal ${expected.rows}`;
    const expectedCount = expected.columns * expected.rows;
    if (!Array.isArray(value.grid.offsets) || value.grid.offsets.length !== expectedCount) errors['grid.offsets'] = `must contain ${expectedCount} offsets`;
    else value.grid.offsets.forEach((point, index) => {
      if (!Array.isArray(point) || point.length !== 2) { errors[`grid.offsets[${index}]`] = 'must contain two coordinates'; return; }
      point.forEach((coordinate, axis) => number(coordinate, `grid.offsets[${index}][${axis}]`, errors));
    });
  }
  return errors;
}

export function validateProjectionConfigV2(value, options = {}) {
  const errors = {};
  if (!ownKeys(value, ['schemaVersion', 'pre', 'outputs'], '', errors)) return errors;
  if (value.schemaVersion !== 2 || typeof value.schemaVersion !== 'number') errors.schemaVersion = 'must equal 2';
  legacyFields(value, errors, options);
  return errors;
}

function identityBaseline(side, source) {
  if (!source?.assetId) return { type: 'identity', width: 1920, height: 1080, origin: 'top-left' };
  const value = source;
  return {
    type: 'tdMesh',
    assetId: value.assetId || `otef-${side}-td-2026-09-21`,
    sha256: String(value.sha256 || BASELINE_HASHES[side]),
    width: value.width || 1920,
    height: value.height || 1080,
    origin: value.origin || 'top-left',
  };
}

export function migrateProjectionConfigToV2(config, baselines = {}) {
  if (!config || config.schemaVersion !== 1) throw new Error('projection config must be schema version 1');
  const result = structuredClone(config);
  result.schemaVersion = 2;
  for (const side of ['left', 'right']) {
    const { columns, rows } = SIDES[side];
    result.outputs[side] = {
      ...result.outputs[side],
      presentationEffect: { enabled: false, mode: 'passthrough' },
      warp: {
        enabled: true,
        baseline: identityBaseline(side, baselines[side]),
        keystone: { corners: [[0, 0], [1, 0], [0, 1], [1, 1]] },
        grid: { columns, rows, offsets: Array.from({ length: columns * rows }, () => [0, 0]) },
      },
    };
  }
  return result;
}

export { BASELINE_HASHES, SAFETY_MAX, SAFETY_MIN, SIDES };
