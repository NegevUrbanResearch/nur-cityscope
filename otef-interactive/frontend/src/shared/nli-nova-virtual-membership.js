import {
  INVESTIGATION_LINES_FULL_ID,
  INVESTIGATION_POLYGONS_FULL_ID,
  NLI_PLAYABLE_IDS,
  isNliPlayableFullId,
} from "./nli-investigation-beats.js";

const NOVA_VIRTUAL_PHASES = new Set(["playing", "paused", "ended"]);

export function novaVirtualMembership(chipIds, narrativeId, clock) {
  const chips = [];
  const seen = new Set();
  for (const id of Array.isArray(chipIds) ? chipIds : []) {
    const key = String(id);
    if (!isNliPlayableFullId(key) || seen.has(key)) continue;
    seen.add(key);
    chips.push(key);
  }
  if (narrativeId !== "nova" || !NOVA_VIRTUAL_PHASES.has(clock?.phase)) return chips;
  const union = new Set(chips);
  union.add(INVESTIGATION_POLYGONS_FULL_ID);
  union.add(INVESTIGATION_LINES_FULL_ID);
  return NLI_PLAYABLE_IDS.filter((id) => union.has(id));
}
