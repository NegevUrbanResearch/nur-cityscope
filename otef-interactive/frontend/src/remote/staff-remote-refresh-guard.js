import { HOME_CUE } from "./nli-staff-script.js";

const ESCAPE_KEYS = ["individual", "overlap", "mor", "settled"];

export function isCanonicalHome(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return false;
  const isApiState = Object.prototype.hasOwnProperty.call(snapshot, "narrative_state");
  const requiredKeys = isApiState
    ? ["narrative_state", "investigation_clock", "layerGroups", "person_selection", "escape_overlay"]
    : ["narrativeState", "investigationClock", "layerGroups", "personSelection", "escapeOverlay"];
  if (!requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(snapshot, key))) return false;
  const narrative = isApiState ? snapshot.narrative_state : snapshot.narrativeState;
  const clock = isApiState ? snapshot.investigation_clock : snapshot.investigationClock;
  const groups = snapshot.layerGroups;
  const selection = isApiState ? snapshot.person_selection : snapshot.personSelection;
  const escape = isApiState ? snapshot.escape_overlay : snapshot.escapeOverlay;
  if (!narrative || narrative.id !== null || narrative.transition !== "exit" ||
      !Number.isSafeInteger(narrative.revision) || narrative.revision <= 0) return false;
  if (!clock || clock.phase !== "idle" || !Number.isSafeInteger(clock.revision) || clock.revision < 0) return false;
  if (clock.presentationPendingUntilMs != null) {
    if (!Number.isFinite(clock.presentationPendingUntilMs)) return false;
    const nowMs = Number.isFinite(snapshot.nowMs) ? snapshot.nowMs : Date.now();
    if (clock.presentationPendingUntilMs > nowMs) return false;
  }
  if (!Array.isArray(groups) || !selection || selection.personId !== null ||
      selection.datasetVersion !== null || !Number.isSafeInteger(selection.revision) || selection.revision < 0 || !escape) return false;
  if (!ESCAPE_KEYS.every((key) => typeof escape[key] === "boolean") || ESCAPE_KEYS.some((key) => escape[key])) return false;

  const enabledIds = [];
  const seenIds = new Set();
  for (const group of groups) {
    if (!group || typeof group.id !== "string" || !Array.isArray(group.layers) ||
        (group.enabled !== undefined && typeof group.enabled !== "boolean")) return false;
    for (const layer of group.layers) {
      if (!layer || typeof layer.id !== "string" || typeof layer.enabled !== "boolean") return false;
      const id = `${group.id}.${layer.id}`;
      if (seenIds.has(id)) return false;
      seenIds.add(id);
      if (layer.enabled) enabledIds.push(id);
    }
  }
  const expected = HOME_CUE.layers;
  return enabledIds.length === expected.length && expected.every((id) => enabledIds.includes(id));
}
