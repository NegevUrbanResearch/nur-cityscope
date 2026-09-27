export const EMPTY_ESCAPE_OVERLAY = Object.freeze({
  individual: false,
  overlap: false,
  mor: false,
  settled: false,
});

export const NOVA_ENTER_ESCAPE_OVERLAY = Object.freeze({
  individual: false,
  overlap: false,
  mor: false,
  settled: false,
});

function requireBool(raw, key) {
  if (!Object.prototype.hasOwnProperty.call(raw, key)) return false;
  const value = raw[key];
  if (typeof value !== "boolean") {
    throw new TypeError(`${key} must be a boolean`);
  }
  return value;
}

export function normalizeEscapeOverlay(raw, narrativeId, options = {}) {
  if (narrativeId !== "nova") return { ...EMPTY_ESCAPE_OVERLAY };
  if (!raw || typeof raw !== "object") {
    return options.applyEnterDefaults === true
      ? { ...NOVA_ENTER_ESCAPE_OVERLAY }
      : { ...EMPTY_ESCAPE_OVERLAY };
  }
  const overlay = {
    individual: requireBool(raw, "individual"),
    overlap: requireBool(raw, "overlap"),
    mor: requireBool(raw, "mor"),
    settled: requireBool(raw, "settled"),
  };
  if (overlay.settled) {
    return { individual: false, overlap: false, mor: false, settled: true };
  }
  return overlay;
}

export function getEscapeOverlay(raw, narrativeId) {
  return normalizeEscapeOverlay(raw, narrativeId);
}
