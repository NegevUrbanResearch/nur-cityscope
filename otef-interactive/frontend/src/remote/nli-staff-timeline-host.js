import { getEffectiveLayerGroups } from "../shared/layer-state-helper.js";
import { NLI_PLAYABLE_IDS } from "../shared/nli-investigation-beats.js";
import { nliTimelineHostMethods } from "./nli-timeline-transport.js";

export function createNliStaffTimelineHost({ sheet, getGroups, render } = {}) {
  return Object.assign(
    {
      focusedGroupId: "nli",
      _nliFeatureCache: Object.create(null),
      _nliOptimisticClock: null,
      _nliScrub: null,
      _nliScrubEl: null,
      _nliPlayheadTimer: null,
      _nliEndTimer: null,
      sheet,
      getEffectiveGroupsForView() {
        try {
          const groups = typeof getGroups === "function" ? getGroups() : getEffectiveLayerGroups();
          return groups || [];
        } catch {
          return [];
        }
      },
      render() {
        if (typeof render === "function") render();
      },
    },
    nliTimelineHostMethods,
    {
      _visibleNliPlayableIds() {
        return NLI_PLAYABLE_IDS.slice();
      },
      _nliCacheReady(ids) {
        const wanted = Array.isArray(ids) && ids.length ? ids : NLI_PLAYABLE_IDS;
        const cache = this._nliFeatureCache || {};
        return wanted.some((id) => Array.isArray(cache[id]) && cache[id].length > 0);
      },
    },
  );
}
