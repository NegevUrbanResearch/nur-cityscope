import { migrateProjectionConfigToV2 } from './projection-warp-schema.js';

const profile = () => Object.freeze({ requestedFontPx: 12, spacingPx: 2, edgeInsetPx: 0 });
export const DEFAULT_NAMES_WALL = Object.freeze({
  activeMode: 'wall',
  innerEdgeInsetPx: Object.freeze({ left: 0, right: 0 }),
  profiles: Object.freeze({ wall: profile(), model: profile() }),
});
export const LEGACY_NAMES_WALL = Object.freeze({ activeMode: 'wall', profiles: {
  wall: { requestedFontPx: 12, minimumFontPx: 8, spacingPx: 2, edgeInsetPx: 0, seamGapPx: 0 },
  model: { requestedFontPx: 12, minimumFontPx: 8, spacingPx: 2, edgeInsetPx: 0, seamGapPx: 0 },
} });

function keys(value, expected, path, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { errors[path] = 'must be an object'; return false; }
  for (const key of expected) if (!Object.hasOwn(value, key)) errors[`${path}.${key}`] = 'is required';
  for (const key of Object.keys(value)) if (!expected.includes(key)) errors[`${path}.${key}`] = 'unknown field';
  return true;
}

function integer(value, path, min, max, errors) {
  if (!Number.isInteger(value) || value < min || value > max) errors[path] = `must be an integer between ${min} and ${max}`;
}

export function validateNamesWall(value, path = 'namesWall', errors = {}) {
  if (!keys(value, ['activeMode', 'innerEdgeInsetPx', 'profiles'], path, errors)) return errors;
  if (value.activeMode !== 'wall' && value.activeMode !== 'model') errors[`${path}.activeMode`] = 'must equal wall or model';
  if (keys(value.innerEdgeInsetPx, ['left', 'right'], `${path}.innerEdgeInsetPx`, errors)) {
    for (const side of ['left', 'right']) integer(value.innerEdgeInsetPx[side], `${path}.innerEdgeInsetPx.${side}`, 0, 960, errors);
  }
  if (!keys(value.profiles, ['wall', 'model'], `${path}.profiles`, errors)) return errors;
  for (const mode of ['wall', 'model']) {
    const profilePath = `${path}.profiles.${mode}`;
    const profile = value.profiles[mode];
    if (!keys(profile, ['requestedFontPx', 'spacingPx', 'edgeInsetPx'], profilePath, errors)) continue;
    integer(profile.requestedFontPx, `${profilePath}.requestedFontPx`, 1, 48, errors);
    integer(profile.spacingPx, `${profilePath}.spacingPx`, 0, 32, errors);
    integer(profile.edgeInsetPx, `${profilePath}.edgeInsetPx`, 0, 256, errors);
  }
  return errors;
}

export function validateNamesWallV3(value, path = 'namesWall', errors = {}) {
  if (!keys(value, ['activeMode', 'profiles'], path, errors)) return errors;
  if (value.activeMode !== 'wall' && value.activeMode !== 'model') errors[`${path}.activeMode`] = 'must equal wall or model';
  if (!keys(value.profiles, ['wall', 'model'], `${path}.profiles`, errors)) return errors;
  for (const mode of ['wall', 'model']) {
    const profilePath = `${path}.profiles.${mode}`;
    const profile = value.profiles[mode];
    if (!keys(profile, ['requestedFontPx', 'minimumFontPx', 'spacingPx', 'edgeInsetPx', 'seamGapPx'], profilePath, errors)) continue;
    integer(profile.requestedFontPx, `${profilePath}.requestedFontPx`, 4, 48, errors);
    integer(profile.minimumFontPx, `${profilePath}.minimumFontPx`, 4, 48, errors);
    integer(profile.spacingPx, `${profilePath}.spacingPx`, 0, 32, errors);
    integer(profile.edgeInsetPx, `${profilePath}.edgeInsetPx`, 0, 256, errors);
    integer(profile.seamGapPx, `${profilePath}.seamGapPx`, 0, 256, errors);
    if (!errors[`${profilePath}.minimumFontPx`] && !errors[`${profilePath}.requestedFontPx`] && profile.minimumFontPx > profile.requestedFontPx) errors[`${profilePath}.minimumFontPx`] = 'must not exceed requestedFontPx';
  }
  return errors;
}

export function migrateNamesWallToV3(config) {
  if (!config || ![1, 2, 3].includes(config.schemaVersion)) throw new Error('projection config must be schema version 1, 2, or 3');
  if (config.schemaVersion === 3) return structuredClone(config);
  const result = config.schemaVersion === 1 ? migrateProjectionConfigToV2(config) : structuredClone(config);
  result.schemaVersion = 3;
  result.namesWall = structuredClone(LEGACY_NAMES_WALL);
  return result;
}

export function migrateNamesWallToV4(config, warnings = []) {
  if (!config || ![1, 2, 3, 4].includes(config.schemaVersion)) throw new Error('projection config must be schema version 1, 2, 3, or 4');
  if (config.schemaVersion === 4) return structuredClone(config);
  const result = migrateNamesWallToV3(config);
  for (const mode of ['wall', 'model']) {
    if (result.namesWall.profiles[mode].seamGapPx) warnings.push(`The ${mode} seam gap needs readjustment in final-output pixels.`);
  }
  result.namesWall = {
    activeMode: result.namesWall.activeMode,
    innerEdgeInsetPx: { left: 0, right: 0 },
    profiles: Object.fromEntries(['wall', 'model'].map((mode) => {
      const { requestedFontPx, spacingPx, edgeInsetPx } = result.namesWall.profiles[mode];
      return [mode, { requestedFontPx, spacingPx, edgeInsetPx }];
    })),
  };
  result.schemaVersion = 4;
  return result;
}
