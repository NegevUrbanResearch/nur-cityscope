const DIM = 0.18;
import { refreshMemorialSettlementFocus, setMemorialSettlementFocus } from './nli-settlement-orientation.js';

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

export function createNliNameFocusPresentation({ map, field } = {}) {
  return {
    update({ selectedPid, selectedGroup } = {}) {
      const groupId = getRelevantPlaceGroup(field, selectedPid, selectedGroup);
      const group = field?.groupGeojson?.features?.find(feature => feature.properties?.group_id === groupId);
      const placeName = group?.properties?.name;
      setMemorialSettlementFocus(map, { active: true, placeName });
      refreshMemorialSettlementFocus(map);
    },
    dispose() { setMemorialSettlementFocus(map, { active: false }); },
  };
}
