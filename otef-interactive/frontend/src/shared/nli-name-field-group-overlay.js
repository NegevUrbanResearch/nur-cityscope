/** Place lookup for Wall of Names dim. No marker, pointer, or overlay chrome. */
export function createNameGroupOverlay({ field } = {}) {
  const groups = field?.groupGeojson?.features || [];
  let selected = null;
  return {
    setOpacity(value) {
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('invalid place overlay opacity');
    },
    groupForPlace(placeId) {
      return groups.find(feature => feature.properties?.place_ids?.includes(placeId))?.properties?.group_id || null;
    },
    update(groupId) {
      selected = groups.find(feature => feature.properties?.group_id === groupId &&
        feature.geometry?.type === 'Point' && feature.geometry.coordinates?.length >= 2) || null;
    },
    dispose() {
      selected = null;
    },
  };
}
