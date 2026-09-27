export const KIDNAP_SURVIVOR_STATUS = "Kidnap survivor";
export const MURDERED_IN_CAPTIVITY_STATUS = "Murdered in captivity";

export const EXCLUDE_SURVIVOR_FILTER = Object.freeze([
  "!=",
  Object.freeze(["get", "status"]),
  KIDNAP_SURVIVOR_STATUS,
]);

export const HOSTAGES_PEOPLE_FILTER = Object.freeze([
  "any",
  Object.freeze(["==", Object.freeze(["get", "status"]), KIDNAP_SURVIVOR_STATUS]),
  Object.freeze(["==", Object.freeze(["get", "status"]), MURDERED_IN_CAPTIVITY_STATUS]),
]);

const locationFilter = (location) => Object.freeze(["==", Object.freeze(["get", "location"]), location]);

export const NOVA_PEOPLE_FILTER = locationFilter("Nova");
export const NIR_OZ_PEOPLE_FILTER = locationFilter("Nir Oz");
const NO_HOUSE_FILTER = Object.freeze([
  "==",
  Object.freeze(["literal", 1]),
  Object.freeze(["literal", 0]),
]);

export function peopleFilterForNarrative(narrativeId) {
  if (narrativeId === "nova") return NOVA_PEOPLE_FILTER;
  if (narrativeId === "hostages") return NIR_OZ_PEOPLE_FILTER;
  if (narrativeId === "hostages_all") return HOSTAGES_PEOPLE_FILTER;
  return EXCLUDE_SURVIVOR_FILTER;
}

export function houseOutlineFilterForNarrative(id) {
  if (id === "segev") return ["==", ["get", "note"], "בית משפחת שגב"];
  if (id === "sderot") return ["==", ["get", "note"], "תחנת משטרה שדרות"];
  if (id === "hostages") return ["==", ["get", "note"], "בית משפחת פרי"];
  return NO_HOUSE_FILTER;
}

export function peopleLegendClassVisible(narrativeId, classValue) {
  const value = String(classValue ?? "");
  if (narrativeId === "hostages_all") {
    return value === KIDNAP_SURVIVOR_STATUS || value === MURDERED_IN_CAPTIVITY_STATUS;
  }
  if (narrativeId === "nova" || narrativeId === "hostages") return true;
  return value !== KIDNAP_SURVIVOR_STATUS;
}

function applyNarrativeSourceFilter(map, sourceId, filter) {
  if (!map || typeof map.getStyle !== "function" || typeof map.getLayer !== "function" ||
    typeof map.setFilter !== "function") return 0;

  let style;
  try {
    style = map.getStyle();
  } catch (_) {
    return 0;
  }
  if (!Array.isArray(style?.layers)) return 0;

  let updated = 0;
  for (const layer of style.layers) {
    if (!layer || layer.source !== sourceId || typeof layer.id !== "string") continue;
    let currentLayer;
    try {
      currentLayer = map.getLayer(layer.id);
    } catch (_) {
      continue;
    }
    if (!currentLayer) continue;
    map.setFilter(layer.id, filter);
    updated += 1;
  }
  return updated;
}

export function applyNarrativePeopleFilter(map, narrativeId) {
  return applyNarrativeSourceFilter(map, "nli.people", peopleFilterForNarrative(narrativeId));
}

export function applyNarrativeHouseOutlineFilter(map, narrativeId) {
  return applyNarrativeSourceFilter(map, "nli.narrative_polygon", houseOutlineFilterForNarrative(narrativeId));
}
