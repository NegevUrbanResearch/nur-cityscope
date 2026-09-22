export const EMPTY_ESCAPE_OVERLAY = Object.freeze({
  individual: false,
  overlap: false,
  mor: false,
});

export const NOVA_ENTER_ESCAPE_OVERLAY = Object.freeze({
  individual: false,
  overlap: false,
  mor: false,
});

function asBool(value) {
  return value === true;
}

export function normalizeEscapeOverlay(raw, narrativeId, options = {}) {
  if (narrativeId !== "nova") return { ...EMPTY_ESCAPE_OVERLAY };
  if (!raw || typeof raw !== "object") {
    return options.applyEnterDefaults === true
      ? { ...NOVA_ENTER_ESCAPE_OVERLAY }
      : { ...EMPTY_ESCAPE_OVERLAY };
  }
  return {
    individual: asBool(raw.individual),
    overlap: asBool(raw.overlap),
    mor: asBool(raw.mor),
  };
}

export function getEscapeOverlay(raw, narrativeId) {
  return normalizeEscapeOverlay(raw, narrativeId);
}
