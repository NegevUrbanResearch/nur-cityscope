import { NLI_VISUAL_TOKENS } from "./nli-investigation-theme.js";
import { refreshMemorialSettlementFocus, setMemorialSettlementFocus } from "./nli-settlement-orientation.js";

const DIM = NLI_VISUAL_TOKENS.dimTextOpacity;

export function getRelevantPlaceGroup(field, pid, selectedGroup) {
  if (selectedGroup) return selectedGroup;
  if (!pid) return null;
  return field?.byPid?.get(String(pid))?.feature?.properties?.group_id || null;
}

export function getNameFocusOpacity({ selectedPid, selectedGroup, field } = {}) {
  if (selectedPid) return ['case', ['==', ['get', 'pid'], String(selectedPid)], 1, DIM];
  const group = getRelevantPlaceGroup(field, selectedPid, selectedGroup);
  return group ? ['case', ['==', ['get', 'group_id'], group], 1, DIM] : 1;
}

export function getNameFocusAlpha({ selectedPid, selectedGroup, field } = {}, pid) {
  if (selectedPid) return String(pid) === String(selectedPid) ? 1 : DIM;
  const group = getRelevantPlaceGroup(field, selectedPid, selectedGroup);
  return group && field?.byPid?.get(String(pid))?.feature?.properties?.group_id !== group ? DIM : 1;
}

export function createNliNameFocusPresentation({ map, field } = {}) {
  return {
    update({ selectedPid, selectedGroup, opacity = 1 } = {}) {
      const groupId = getRelevantPlaceGroup(field, selectedPid, selectedGroup);
      const group = field?.groupGeojson?.features?.find(feature => feature.properties?.group_id === groupId);
      const placeName = group?.properties?.name;
      setMemorialSettlementFocus(map, { active: true, placeName, strength: opacity });
      refreshMemorialSettlementFocus(map);
    },
    dispose() { setMemorialSettlementFocus(map, { active: false }); },
  };
}
