import { validateProjectionConfig } from './projection-config-schema.js';
import { normalizeProjectionBaselineHash } from './projection-baseline-manifest.js';

const SIDES = ['left', 'right'];
const HASH = /^[a-f0-9]{64}$/i;
const IDENTITY_CORNERS = [[0, 0], [1, 0], [0, 1], [1, 1]];
const clone = (value) => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));

function tdReference(asset) {
  const sha256 = normalizeProjectionBaselineHash(asset?.sha256);
  if (!asset || typeof asset.assetId !== 'string' || !asset.assetId || !HASH.test(sha256) ||
    (asset.width != null && asset.width !== 1920) || (asset.height != null && asset.height !== 1080) ||
    (asset.origin != null && asset.origin !== 'top-left')) {
    throw new Error('TD asset reference must contain a trusted ID, SHA-256 hash, and supported dimensions/origin');
  }
  return { type: 'tdMesh', assetId: asset.assetId, sha256, width: 1920, height: 1080, origin: 'top-left' };
}

/** Clone a saved target config and replace selected sides with identity-residual TD baselines. */
export function prepareProjectionTdImport(targetConfig, assetsBySide, { sides = SIDES, grids = {} } = {}) {
  if (!targetConfig || typeof targetConfig !== 'object') throw new Error('saved target config is required');
  const requested = [...new Set(sides)];
  if (!requested.length || requested.some((side) => !SIDES.includes(side))) throw new Error('TD import sides must be left or right');
  const config = clone(targetConfig);
  for (const side of requested) {
    const reference = tdReference(assetsBySide?.[side]);
    const priorWarp = config.outputs?.[side]?.warp;
    if (!priorWarp?.grid || !priorWarp?.keystone) throw new Error(`saved target ${side} warp is unavailable`);
    const grid = grids?.[side] ? clone(grids[side]) : clone(priorWarp.grid);
    if (!Number.isSafeInteger(grid.columns) || grid.columns < 2 || grid.columns > 16 ||
      !Number.isSafeInteger(grid.rows) || grid.rows < 2 || grid.rows > 16) throw new Error(`invalid editable grid for ${side}`);
    grid.offsets = Array.from({ length: grid.columns * grid.rows }, () => [0, 0]);
    config.outputs[side].warp = {
      ...priorWarp,
      enabled: true,
      baseline: reference,
      keystone: { corners: clone(IDENTITY_CORNERS) },
      grid,
    };
  }
  const errors = validateProjectionConfig(config);
  if (Object.keys(errors).length) throw new Error(`invalid editable grid or target config: ${Object.entries(errors).map(([path, message]) => `${path} ${message}`).join('; ')}`);
  return config;
}
