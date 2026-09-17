export const KIDNAP_SURVIVOR_STATUS = "Kidnap survivor";

export const EXCLUDE_SURVIVOR_FILTER = Object.freeze([
  "!=",
  Object.freeze(["get", "status"]),
  KIDNAP_SURVIVOR_STATUS,
]);

export const HOSTAGES_PEOPLE_FILTER = Object.freeze([
  "==",
  Object.freeze(["get", "status"]),
  KIDNAP_SURVIVOR_STATUS,
]);

export const NOVA_PEOPLE_FILTER = Object.freeze([
  "any",
  Object.freeze(["==", Object.freeze(["get", "location"]), "Nova"]),
  Object.freeze(["==", Object.freeze(["get", "status"]), KIDNAP_SURVIVOR_STATUS]),
]);

export function peopleFilterForNarrative(narrativeId) {
  if (narrativeId === "nova") return NOVA_PEOPLE_FILTER;
  if (narrativeId === "hostages") return HOSTAGES_PEOPLE_FILTER;
  return EXCLUDE_SURVIVOR_FILTER;
}

export function peopleLegendClassVisible(narrativeId, classValue) {
  const value = String(classValue ?? "");
  if (narrativeId === "hostages") return value === KIDNAP_SURVIVOR_STATUS;
  if (narrativeId === "nova") return true;
  return value !== KIDNAP_SURVIVOR_STATUS;
}

export function applyNarrativePeopleFilter(map, narrativeId) {
  if (!map || typeof map.getStyle !== "function" || typeof map.getLayer !== "function" ||
    typeof map.setFilter !== "function") return 0;

  let style;
  try {
    style = map.getStyle();
  } catch (_) {
    return 0;
  }
  if (!Array.isArray(style?.layers)) return 0;

  const filter = peopleFilterForNarrative(narrativeId);
  let updated = 0;
  for (const layer of style.layers) {
    if (!layer || layer.source !== "nli.people" || typeof layer.id !== "string") continue;
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
