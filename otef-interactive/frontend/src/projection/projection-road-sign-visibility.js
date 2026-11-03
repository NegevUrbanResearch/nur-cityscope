import { filterGazaBorderVisibility } from "../shared/gaza-border-style.js";
import { isolateLayersWhileVictimNamesShown } from "../shared/nli-victim-name-layer-isolation.js";
import { resolvePresentationOverlayVisibility } from "../shared/slideshow-pack-runtime.js";
import { shouldShowRoadSigns } from "../shared/road-sign-settings.js";

function asGroups(groups) {
  return Array.isArray(groups) ? groups : Object.values(groups || {});
}

export function resolveProjectionRoadSignVisibility({ liveGroups, incomingGroups, presentationActive,
  gazaBorderVisible, keepSettlementNames, excludedPresentationPackIds,
  calibrationActive = false, patternActive = false } = {}) {
  const filteredLiveGroups = filterGazaBorderVisibility(
    isolateLayersWhileVictimNamesShown(asGroups(liveGroups)), gazaBorderVisible,
  );
  const overlayGroups = resolvePresentationOverlayVisibility({
    presentationActive,
    incomingGroups,
    liveGroups: filteredLiveGroups,
    keepSettlementNames,
    excludedPresentationPackIds,
  });
  const effectiveGroups = isolateLayersWhileVictimNamesShown(overlayGroups);
  return {
    overlayGroups,
    eligible: shouldShowRoadSigns({ effectiveGroups, calibrationActive, patternActive }),
  };
}
