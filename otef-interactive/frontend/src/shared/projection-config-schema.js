const DEFAULT_PROJECTION_CONFIG = {
  schemaVersion: 1,
  pre: { scale: 1.41, rotateDeg: -50, tx: 0.01, ty: 0 },
  outputs: {
    left: { crop: { x0: 0, x1: 0.6, y0: 0, y1: 1 }, post: { scale: 2, tx: 0, ty: -0.049 } },
    right: { crop: { x0: 0.4, x1: 1, y0: 0, y1: 1 }, post: { scale: 2, tx: 0, ty: -0.049 } },
  },
};

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
freeze(DEFAULT_PROJECTION_CONFIG);

const ownKeys = (value, keys, path, errors) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors[path] = 'must be an object';
    return false;
  }
  const fieldPath = (key) => path ? `${path}.${key}` : key;
  for (const key of keys) if (!Object.hasOwn(value, key)) errors[fieldPath(key)] = 'is required';
  for (const key of Object.keys(value)) if (!keys.includes(key)) errors[fieldPath(key)] = 'unknown field';
  return true;
};
const number = (value, path, min, max, errors) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) { errors[path] = 'must be a finite number'; return; }
  if (value < min || value > max) errors[path] = `must be between ${min} and ${max}`;
};

export function validateProjectionConfig(value) {
  const errors = {};
  if (!ownKeys(value, ['schemaVersion', 'pre', 'outputs'], '', errors)) return errors;
  if (value.schemaVersion !== 1 || typeof value.schemaVersion !== 'number') errors.schemaVersion = 'must equal 1';
  if (ownKeys(value.pre, ['scale', 'rotateDeg', 'tx', 'ty'], 'pre', errors)) {
    number(value.pre.scale, 'pre.scale', 0.1, 8, errors); number(value.pre.rotateDeg, 'pre.rotateDeg', -180, 180, errors);
    number(value.pre.tx, 'pre.tx', -2, 2, errors); number(value.pre.ty, 'pre.ty', -2, 2, errors);
  }
  if (ownKeys(value.outputs, ['left', 'right'], 'outputs', errors)) for (const side of ['left', 'right']) {
    const base = `outputs.${side}`;
    if (!ownKeys(value.outputs[side], ['crop', 'post'], base, errors)) continue;
    const crop = value.outputs[side].crop;
    if (ownKeys(crop, ['x0', 'x1', 'y0', 'y1'], `${base}.crop`, errors)) {
      for (const key of ['x0', 'x1', 'y0', 'y1']) number(crop[key], `${base}.crop.${key}`, 0, 1, errors);
      if (typeof crop.x0 === 'number' && typeof crop.x1 === 'number' && crop.x1 - crop.x0 < 0.01 - 1e-12) errors[`${base}.crop`] = 'x extent must be at least 0.01';
      if (typeof crop.y0 === 'number' && typeof crop.y1 === 'number' && crop.y1 - crop.y0 < 0.01 - 1e-12) errors[`${base}.crop`] = 'y extent must be at least 0.01';
    }
    const post = value.outputs[side].post;
    if (ownKeys(post, ['scale', 'tx', 'ty'], `${base}.post`, errors)) { number(post.scale, `${base}.post.scale`, 0.1, 8, errors); number(post.tx, `${base}.post.tx`, -2, 2, errors); number(post.ty, `${base}.post.ty`, -2, 2, errors); }
  }
  return errors;
}

export function parseProjectionImport(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > 65536) throw new Error('import exceeds 64 KiB');
  let document;
  try { document = JSON.parse(text); } catch (error) { throw new Error(`invalid JSON: ${error.message}`); }
  const errors = {};
  if (!ownKeys(document, ['schemaVersion', 'name', 'config'], '', errors)) throw new Error(formatErrors(errors));
  if (document.schemaVersion !== 1) errors.schemaVersion = 'must equal 1';
  if (typeof document.name !== 'string' || document.name.trim().length < 1 || document.name.trim().length > 80) errors.name = 'must be 1–80 characters';
  Object.assign(errors, Object.fromEntries(Object.entries(validateProjectionConfig(document.config)).map(([key, value]) => [`config.${key}`, value])));
  if (Object.keys(errors).length) throw new Error(formatErrors(errors));
  return { name: document.name.trim(), config: document.config };
}
const formatErrors = (errors) => `invalid projection config: ${Object.entries(errors).map(([path, message]) => `${path || 'document'} ${message}`).join('; ')}`;
export function serializeProjectionExport(name, config) {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  const errors = validateProjectionConfig(config);
  if (!trimmed || trimmed.length > 80) errors.name = 'must be 1–80 characters';
  if (Object.keys(errors).length) throw new Error(formatErrors(errors));
  return JSON.stringify({ schemaVersion: 1, name: trimmed, config });
}

export { DEFAULT_PROJECTION_CONFIG };
