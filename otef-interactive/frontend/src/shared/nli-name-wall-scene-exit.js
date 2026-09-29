import { NAME_FIELD_MOTION } from "./nli-name-field-animation.js";
import { victimNamesAreShown } from "./nli-victim-name-layer-isolation.js";

const PEOPLE_NAMES_FULL_ID = "nli.people_names";

function asGroupList(layerGroups) {
  if (Array.isArray(layerGroups)) return layerGroups;
  if (layerGroups && typeof layerGroups === "object") return Object.values(layerGroups);
  return [];
}

export function enabledFullIdsFromGroups(layerGroups) {
  const ids = [];
  for (const group of asGroupList(layerGroups)) {
    if (!group?.id || !Array.isArray(group.layers)) continue;
    for (const layer of group.layers) {
      if (layer?.enabled === true && layer.id) ids.push(`${group.id}.${layer.id}`);
    }
  }
  return ids;
}

/** Remote: fade the name wall before the next scene overlay or destination cue. */
export function createNameWallSceneExit({
  getLayerGroups,
  commitLayers,
  hideMs = NAME_FIELD_MOTION.hideMs,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  let inFlight = Promise.resolve();
  let hiding = false;

  function namesAreShown() {
    return victimNamesAreShown(getLayerGroups?.() || []);
  }

  function needsFade() {
    return hiding || namesAreShown();
  }

  async function fadeOutIfShown() {
    if (!needsFade()) return true;
    const previous = inFlight;
    const run = (async () => {
      await previous;
      if (!namesAreShown()) return true;
      hiding = true;
      try {
        const remaining = enabledFullIdsFromGroups(getLayerGroups()).filter((id) => id !== PEOPLE_NAMES_FULL_ID);
        await commitLayers(remaining);
        await wait(hideMs);
        return true;
      } finally {
        hiding = false;
      }
    })();
    inFlight = run.then(() => {}, () => {});
    try {
      return await run;
    } catch {
      hiding = false;
      return false;
    }
  }

  return { fadeOutIfShown, needsFade };
}

/** Displays: keep the current wall on screen until its fade-out finishes. */
export function createNameFieldExitGate(nameFieldController) {
  let namesDrawn = false;
  return {
    holdUntilHidden(groups, isCurrent = () => true) {
      const requested = victimNamesAreShown(groups);
      if (namesDrawn && !requested) {
        return Promise.resolve(nameFieldController?.fadeOut?.()).then(() => {
          if (!isCurrent()) return false;
          namesDrawn = requested;
          return true;
        });
      }
      namesDrawn = requested;
      return true;
    },
  };
}
