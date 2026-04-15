/**
 * Single source of truth for Moreshet-axis + pink-line parking UX state.
 * Parking is a synthetic layer id under the merged remote group `curated_moresht_axis`.
 */

const MORESHET_AXIS_GROUP_ID = "curated_moresht_axis";
const PINK_LINE_PARKING_LAYER_ID = "pink_line_parking";
const PINK_LINE_PARKING_FULL_LAYER_ID = `${MORESHET_AXIS_GROUP_ID}.${PINK_LINE_PARKING_LAYER_ID}`;

function isPinkLineParkingLayerId(layerId) {
  return layerId === PINK_LINE_PARKING_LAYER_ID;
}

/**
 * Published / GIS-backed Moreshet rows only (excludes parking companion toggle).
 *
 * @param {Array<{ id?: string, layers?: Array<{ id?: string }> }>} layerGroups
 * @returns {Array<{ id?: string }>}
 */
function getMoreshetAxisContentLayers(layerGroups) {
  const g = Array.isArray(layerGroups)
    ? layerGroups.find((x) => x && x.id === MORESHET_AXIS_GROUP_ID)
    : null;
  const layers = g && Array.isArray(g.layers) ? g.layers : [];
  return layers.filter((l) => l && !isPinkLineParkingLayerId(String(l.id || "")));
}

function hasAnyEnabledMoreshetContentLayer(layerGroups) {
  return getMoreshetAxisContentLayers(layerGroups).some((l) => !!l.enabled);
}

/**
 * User intent for parking overlay (checkbox). When the parking row is absent from API
 * state, default true so existing tables behave as before the dedicated toggle existed.
 *
 * @param {Array} layerGroups
 * @returns {boolean}
 */
function isPinkLineParkingUserEnabled(layerGroups) {
  const g = Array.isArray(layerGroups)
    ? layerGroups.find((x) => x && x.id === MORESHET_AXIS_GROUP_ID)
    : null;
  if (!g || !Array.isArray(g.layers)) return true;
  const p = g.layers.find((l) => l && isPinkLineParkingLayerId(String(l.id || "")));
  if (!p) return true;
  return !!p.enabled;
}

function computePinkLineBaseLayerVisible(layerGroups) {
  return hasAnyEnabledMoreshetContentLayer(layerGroups);
}

function computePinkLineParkingOverlayVisible(layerGroups) {
  return (
    hasAnyEnabledMoreshetContentLayer(layerGroups) &&
    isPinkLineParkingUserEnabled(layerGroups)
  );
}

/**
 * Ensure API-shaped layerGroups keep parking aligned: when no visible Moreshet
 * content remains enabled, parking cannot stay enabled.
 *
 * @param {Array} layerGroups — deep-cloned mutable copy is expected
 * @returns {Array}
 */
function applyMoreshetParkingCoherenceToLayerGroups(layerGroups) {
  if (!Array.isArray(layerGroups)) return layerGroups;
  const idx = layerGroups.findIndex((g) => g && g.id === MORESHET_AXIS_GROUP_ID);
  if (idx < 0) return layerGroups;
  const group = layerGroups[idx];
  const layers = Array.isArray(group.layers) ? group.layers : [];
  const content = layers.filter((l) => l && !isPinkLineParkingLayerId(String(l.id || "")));
  const hasContentOn = content.some((l) => !!l.enabled);
  if (hasContentOn) return layerGroups;
  const nextLayers = layers.map((l) => {
    if (!l || !isPinkLineParkingLayerId(String(l.id || ""))) return l;
    return { ...l, enabled: false };
  });
  const nextGroup = { ...group, layers: nextLayers };
  const out = layerGroups.slice();
  out[idx] = nextGroup;
  return out;
}

/**
 * Mutates a deep-cloned layerGroups list so API-shaped state includes
 * `pink_line_parking` whenever the Moreshet axis group has published content rows.
 * Without this row, remote toggles target a layer id that does not exist in raw
 * `_layerGroups` and PATCH no-ops until a LayerState row is created elsewhere.
 *
 * @param {Array} layerGroups
 * @returns {Array}
 */
function ensurePinkLineParkingRowInMoreshetAxisGroup(layerGroups) {
  if (!Array.isArray(layerGroups)) return layerGroups;
  const idx = layerGroups.findIndex((g) => g && g.id === MORESHET_AXIS_GROUP_ID);
  if (idx < 0) return layerGroups;
  const group = layerGroups[idx];
  const layers = Array.isArray(group.layers) ? group.layers : [];
  const contentLayers = layers.filter(
    (l) => l && !isPinkLineParkingLayerId(String(l.id || "")),
  );
  if (contentLayers.length === 0) return layerGroups;
  if (layers.some((l) => l && isPinkLineParkingLayerId(String(l.id || "")))) {
    return layerGroups;
  }
  const parkingLayer = {
    id: PINK_LINE_PARKING_LAYER_ID,
    displayName: "Parking lots",
    enabled: true,
  };
  const out = layerGroups.slice();
  out[idx] = { ...group, layers: layers.concat([parkingLayer]) };
  return out;
}

/**
 * After coalescing, drop an empty Moreshet pack (no published rows) from remote/UI lists.
 * When there is published content, ensure the parking toggle row exists.
 *
 * @param {Array} groups
 * @returns {Array}
 */
function finalizeMoreshetAxisPackForRemote(groups) {
  if (!Array.isArray(groups) || groups.length === 0) return groups;
  const idx = groups.findIndex((g) => g && g.id === MORESHET_AXIS_GROUP_ID);
  if (idx < 0) return groups;
  const g = groups[idx];
  const rawLayers = Array.isArray(g.layers) ? g.layers : [];
  const contentLayers = rawLayers.filter(
    (l) => l && !isPinkLineParkingLayerId(String(l.id || "")),
  );
  if (contentLayers.length === 0) {
    return groups.filter((_, i) => i !== idx);
  }
  const parkingRow = rawLayers.find((l) => l && isPinkLineParkingLayerId(String(l.id || "")));
  const hasContentOn = contentLayers.some((l) => !!l.enabled);
  const parkingEnabled =
    hasContentOn && (parkingRow ? !!parkingRow.enabled : true);
  const parkingLayer = {
    id: PINK_LINE_PARKING_LAYER_ID,
    name: "Parking lots",
    displayName: (parkingRow && parkingRow.displayName) || "Parking lots",
    enabled: parkingEnabled,
  };
  const nextLayers = contentLayers.concat([parkingLayer]);
  const allOn = nextLayers.length > 0 && nextLayers.every((l) => !!l.enabled);
  const copy = groups.slice();
  copy[idx] = { ...g, layers: nextLayers, enabled: allOn };
  return copy;
}

export {
  MORESHET_AXIS_GROUP_ID,
  PINK_LINE_PARKING_LAYER_ID,
  PINK_LINE_PARKING_FULL_LAYER_ID,
  isPinkLineParkingLayerId,
  getMoreshetAxisContentLayers,
  hasAnyEnabledMoreshetContentLayer,
  isPinkLineParkingUserEnabled,
  computePinkLineBaseLayerVisible,
  computePinkLineParkingOverlayVisible,
  applyMoreshetParkingCoherenceToLayerGroups,
  ensurePinkLineParkingRowInMoreshetAxisGroup,
  finalizeMoreshetAxisPackForRemote,
};
