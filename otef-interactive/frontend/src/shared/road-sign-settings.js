export const ROAD_SIGN_BASE_WIDTH = 114;
export const ROAD_SIGN_ASPECT = 524 / 381;

const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SIGN_KEYS = ['id', 'x', 'y', 'scale', 'rotateDeg', 'theme', 'visible', 'leader'];

export function emptyRoadSignSettings() {
  return { version: 1, outputs: { left: [], right: [] } };
}

export function createRoadSign({ id, x, y }) {
  return {
    id,
    x,
    y,
    scale: 0.7,
    rotateDeg: 0,
    theme: 'dark',
    visible: true,
    leader: { enabled: false, x, y },
  };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isNumberInRange(value, minimum, maximum) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function validateSign(sign, seenIds) {
  if (!isRecord(sign) || !hasExactKeys(sign, SIGN_KEYS)) return 'Each sign must contain exactly the supported fields.';
  if (typeof sign.id !== 'string' || !UUID_PATTERN.test(sign.id)) return 'Sign id must be a UUID.';
  const normalizedId = sign.id.toLowerCase();
  if (seenIds.has(normalizedId)) return 'Sign ids must be unique.';
  seenIds.add(normalizedId);
  if (!isNumberInRange(sign.x, 0, 1920) || !isNumberInRange(sign.y, 0, 1080)) {
    return 'Sign center must be within the source output.';
  }
  if (!isNumberInRange(sign.scale, 0.01, 3)) return 'Scale must be between 0.01 and 3.';
  if (!isNumberInRange(sign.rotateDeg, -180, 180)) return 'Rotation must be between -180 and 180 degrees.';
  if (sign.theme !== 'dark' && sign.theme !== 'original') return 'Theme must be dark or original.';
  if (typeof sign.visible !== 'boolean') return 'Visible must be a boolean.';
  if (!isRecord(sign.leader) || !hasExactKeys(sign.leader, ['enabled', 'x', 'y'])) {
    return 'Leader must contain exactly enabled, x, and y.';
  }
  if (typeof sign.leader.enabled !== 'boolean') return 'Leader enabled must be a boolean.';
  if (!isNumberInRange(sign.leader.x, 0, 1920) || !isNumberInRange(sign.leader.y, 0, 1080)) {
    return 'Leader endpoint must be within the source output.';
  }
  return null;
}

export function validateRoadSignSettings(raw) {
  if (isRecord(raw) && Object.keys(raw).length === 0) {
    return { valid: true, settings: emptyRoadSignSettings(), error: null };
  }
  if (!isRecord(raw) || !hasExactKeys(raw, ['version', 'outputs']) || raw.version !== 1) {
    return { valid: false, settings: null, error: 'Settings must be a version 1 document.' };
  }
  if (!isRecord(raw.outputs) || !(hasExactKeys(raw.outputs, ['left', 'right']) || hasExactKeys(raw.outputs, ['left', 'right', 'gis']))) {
    return { valid: false, settings: null, error: 'Outputs must contain left and right, with optional gis.' };
  }

  const seenIds = new Set();
  const outputs = { left: [], right: [] };
  for (const output of ['left', 'right', ...(Object.hasOwn(raw.outputs, 'gis') ? ['gis'] : [])]) {
    const signs = raw.outputs[output];
    if (!Array.isArray(signs) || signs.length > 64) {
      return { valid: false, settings: null, error: `${output} must contain at most 64 signs.` };
    }
    outputs[output] = [];
    for (const sign of signs) {
      const error = validateSign(sign, seenIds);
      if (error) return { valid: false, settings: null, error };
      outputs[output].push({
        id: sign.id,
        x: sign.x,
        y: sign.y,
        scale: sign.scale,
        rotateDeg: sign.rotateDeg,
        theme: sign.theme,
        visible: sign.visible,
        leader: { enabled: sign.leader.enabled, x: sign.leader.x, y: sign.leader.y },
      });
    }
  }
  return { valid: true, settings: { version: 1, outputs }, error: null };
}

export function shouldShowRoadSigns({ effectiveGroups = [], calibrationActive = false, patternActive = false } = {}) {
  if (calibrationActive || patternActive) return false;
  const groups = Array.isArray(effectiveGroups) ? effectiveGroups : Object.values(effectiveGroups || {});
  // Match map rendering: visibility follows layer toggles, not the group header flag.
  return groups.some((group) => {
    return (group?.layers || []).some((layer) => {
      if (layer?.enabled !== true) return false;
      const ids = [layer.fullId, ...(Array.isArray(layer.fullLayerIds) ? layer.fullLayerIds : [])]
        .filter((id) => typeof id === "string");
      if (group?.id === "nli" && layer?.id === "ציר_232") ids.push("nli.ציר_232");
      if (typeof layer?.id === "string" && layer.id.includes(".")) ids.push(layer.id);
      return ids.includes("nli.ציר_232");
    });
  });
}
