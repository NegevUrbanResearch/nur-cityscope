import { getEffectiveLayerGroups } from "../shared/layer-state-helper.js";
import { finiteClockMinutes, isNliPlayableFullId } from "../shared/nli-investigation-beats.js";
import { nliPlayableIdsFromGroups } from "../shared/nli-investigation-clock.js";
import { nliTimelineHostMethods } from "./nli-timeline-transport.js";

function playableMembership(ids) {
  const seen = new Set();
  const out = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    const key = String(id);
    if (!isNliPlayableFullId(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function staffPlaybackConfig({ clock, cue, groups, manualFree = false } = {}) {
  const phase = clock?.phase || "idle";
  if (phase !== "idle") {
    const membership = playableMembership(clock?.membership);
    const cueMembership = playableMembership(cue?.layers);
    const window = cue?.clock && typeof cue.clock === "object" ? cue.clock : null;
    const matches = membership.length > 0 && membership.length === cueMembership.length
      && membership.every((id) => cueMembership.includes(id));
    const from = finiteClockMinutes(clock?.leadInMinutes)
      ?? (!manualFree && matches && window ? finiteClockMinutes(window.from) : null);
    return { membership, ...(from != null ? { from } : {}) };
  }
  const window = cue?.clock && typeof cue.clock === "object" ? cue.clock : null;
  const cueMembership = playableMembership(cue?.layers);
  if (cue && (cueMembership.length || window)) {
    const from = Number(window?.from);
    const to = Number(window?.to);
    return {
      membership: cueMembership,
      ...(Number.isFinite(from) ? { from } : {}),
      ...(Number.isFinite(to) ? { to } : {}),
    };
  }
  if (manualFree) return { membership: nliPlayableIdsFromGroups(groups) };
  return { membership: [] };
}

export function nliGroupWithPlaybackMembership(group, membership) {
  const enabled = new Set(playableMembership(membership));
  if (!group || !Array.isArray(group.layers) || group.layers.length === 0) {
    return {
      id: "nli",
      layers: [...enabled].map((fullId) => ({
        id: fullId.replace(/^nli\./, ""),
        enabled: true,
      })),
    };
  }
  return {
    ...group,
    layers: group.layers.map((layer) => {
      const fullId = `nli.${layer.id}`;
      if (!isNliPlayableFullId(fullId)) return layer;
      return { ...layer, enabled: enabled.has(fullId) };
    }),
  };
}

export function createNliStaffTimelineHost({
  sheet,
  getGroups,
  render,
  getPlaybackConfig,
  isManualMutationAllowed,
  paintPlayhead,
  cacheChanged,
} = {}) {
  return Object.assign(
    {
      focusedGroupId: "nli",
      _nliFeatureCache: Object.create(null),
      _nliOptimisticClock: null,
      _nliScrub: null,
      _nliScrubEl: null,
      _nliScrubPointerId: null,
      _nliTransportEpoch: 0,
      _nliTransportPending: 0,
      _nliPlayheadTimer: null,
      _nliEndTimer: null,
      _nliStaffPaintPlayhead: paintPlayhead,
      _nliStaffCacheChanged: cacheChanged,
      sheet,
      getPlaybackConfig,
      isManualMutationAllowed,
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
  );
}
