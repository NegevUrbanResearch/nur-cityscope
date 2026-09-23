/**
 * While NLI victim names are on, map surfaces draw only that layer.
 * Stored remote state is left unchanged so other layers return when names turn off.
 */

const VICTIM_NAMES_GROUP_ID = "nli";
const VICTIM_NAMES_LAYER_ID = "people_names";

function asGroupList(layerGroups) {
  if (Array.isArray(layerGroups)) return layerGroups;
  if (layerGroups && typeof layerGroups === "object") return Object.values(layerGroups);
  return [];
}

/** Same gate as the name-field controller: nli.people_names with enabled === true. */
export function victimNamesAreShown(layerGroups) {
  return asGroupList(layerGroups).some((group) => group?.id === VICTIM_NAMES_GROUP_ID
    && (group.layers || []).some((layer) => layer?.id === VICTIM_NAMES_LAYER_ID && layer.enabled === true));
}

/**
 * @param {unknown} layerGroups
 * @returns {unknown}
 */
export function isolateLayersWhileVictimNamesShown(layerGroups) {
  const groups = asGroupList(layerGroups);
  if (!victimNamesAreShown(groups)) {
    return layerGroups;
  }
  return groups.map((group) => {
    if (!group || !Array.isArray(group.layers)) return group;
    let changed = false;
    const layers = group.layers.map((layer) => {
      if (!layer || layer.enabled !== true) return layer;
      if (group.id === VICTIM_NAMES_GROUP_ID && layer.id === VICTIM_NAMES_LAYER_ID) return layer;
      changed = true;
      return { ...layer, enabled: false };
    });
    return changed ? { ...group, layers } : group;
  });
}
