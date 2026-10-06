export const MAX_CURSOR_HZ = 20;
export const CURSOR_RENEW_MS = 1000;
export const CURSOR_EXPIRY_MS = 3000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMMON = ['type', 'table', 'output', 'instanceId', 'sourceId', 'sessionId', 'sequence', 'revision', 'sourceFrameIdentity'];
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const safeCounter = value => Number.isSafeInteger(value) && value >= 0;
const pixelPair = value => Array.isArray(value) && value.length === 2 &&
  value.every((n, i) => Number.isFinite(n) && n >= 0 && n <= (i ? 1080 : 1920));
const commonValid = value => value.table === 'otef' && ['left', 'right'].includes(value.output) &&
  ['instanceId', 'sourceId', 'sessionId'].every(key => typeof value[key] === 'string' && UUID.test(value[key])) &&
  safeCounter(value.sequence) && safeCounter(value.revision) && typeof value.sourceFrameIdentity === 'string' &&
  value.sourceFrameIdentity.length > 0 && value.sourceFrameIdentity.length <= 4096;

export function isProjectionMatchCommand(value) {
  if (!exactKeys(value, [...COMMON, 'mode', 'pointId', 'targetPx', 'sourcePx']) ||
    value.type !== 'otef_projection_match_cursor' || !commonValid(value)) return false;
  if (value.mode === 'probe' || value.mode === 'off') return value.pointId === 0 && value.targetPx === null && value.sourcePx === null;
  return value.mode === 'cursor' && Number.isInteger(value.pointId) && value.pointId >= 1 && value.pointId <= 6 &&
    pixelPair(value.targetPx) && pixelPair(value.sourcePx);
}

export function isProjectionMatchAck(value) {
  return Boolean(exactKeys(value, [...COMMON, 'displaySide', 'reversed', 'success', 'error']) &&
    value.type === 'otef_projection_match_ack' && commonValid(value) && ['left', 'right'].includes(value.displaySide) &&
    typeof value.reversed === 'boolean' && typeof value.success === 'boolean' &&
    (value.success ? value.error === null : typeof value.error === 'string' && value.error.length <= 240));
}
