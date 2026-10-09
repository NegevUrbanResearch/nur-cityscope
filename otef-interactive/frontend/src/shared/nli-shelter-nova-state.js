/** Narrative incident reveal, never a reconstructed shelter attack timestamp. */
const destinationsByMap = new WeakMap();
const listenersByMap = new WeakMap();

export function getNovaShelterDestinations(map) {
  return destinationsByMap.get(map) || null;
}

export function publishNovaShelterDestinations(map, value) {
  const next = value ? {
    routeSHA256: value.routeSHA256 || null,
    completedRouteIds: [...new Set(value.completedRouteIds.map(String))].sort(),
  } : null;
  if (JSON.stringify(next) === JSON.stringify(getNovaShelterDestinations(map))) return;
  if (next) destinationsByMap.set(map, next);
  else destinationsByMap.delete(map);
  const canvas = map.getCanvas?.();
  if (canvas?.dataset) canvas.dataset.nliShelterDestinations = JSON.stringify(next);
  for (const listener of listenersByMap.get(map) || []) listener();
}

export function subscribeNovaShelterDestinations(map, listener) {
  let listeners = listenersByMap.get(map);
  if (!listeners) listenersByMap.set(map, listeners = new Set());
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Owner-selected narrative fallback: the final authored Nova beat starts at 12:00.
export const NOVA_SHELTER_REVEAL_MINUTE = 720;

export function deriveShelterVictimImpactIds({ shelters, frame, narrativeId,
  peopleVisible, timelineVisible, expectedRouteSHA256, destinations }) {
  const allVictimShelters = peopleVisible && !timelineVisible &&
    (narrativeId === "nova" || narrativeId == null);
  const generalTimelineReachedNova = narrativeId == null && timelineVisible && (
    frame?.narrative?.phase === "idle" ||
    (frame?.activeBeat != null && frame.activeBeat >= NOVA_SHELTER_REVEAL_MINUTE) ||
    (frame?.completedBeats || []).some(minute => minute >= NOVA_SHELTER_REVEAL_MINUTE)
  );
  const reachedRoutes = narrativeId === "nova" && expectedRouteSHA256 &&
    destinations?.routeSHA256 === expectedRouteSHA256
    ? new Set(destinations.completedRouteIds) : new Set();
  return new Set(shelters.filter(shelter => {
    const properties = shelter.properties || {};
    if (!properties.personPids?.length) return false;
    return allVictimShelters || generalTimelineReachedNova ||
      (properties.novaRouteObjectIds || []).some(id => reachedRoutes.has(String(id)));
  }).map(shelter => shelter.id));
}
