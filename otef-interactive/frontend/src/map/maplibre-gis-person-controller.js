const PEOPLE_SOURCE_ID = "nli.people";
const HIT_PADDING_PX = 8;

function personId(feature) {
  const value = feature?.properties?.pid ?? feature?.id;
  return value == null || String(value).trim() === "" ? "" : String(value).trim();
}

/** Return the rendered people feature, regardless of overlapping feature order. */
export function resolveGisPersonHit(features) {
  if (!Array.isArray(features)) return null;
  return features.find((feature) => feature?.source === PEOPLE_SOURCE_ID && personId(feature)) || null;
}

/** Read the full nli.people layer state without inspecting MapLibre style IDs. */
export function isPeopleLayerEnabled(groups) {
  const list = Array.isArray(groups) ? groups : Object.values(groups || {});
  const group = list.find((item) => item?.id === "nli");
  return group?.layers?.some((layer) => layer?.id === "people" && layer.enabled === true) === true;
}

function sameSelection(a, b) {
  return a?.personId === b?.personId && a?.datasetVersion === b?.datasetVersion && a?.revision === b?.revision;
}

/** Connect the acknowledged person-selection state to one I1 visual handle. */
export function createGisPersonController({
  map,
  context,
  visual,
  getLayerGroups,
  isPeopleLayerEnabled: layerPredicate = isPeopleLayerEnabled,
  reducedMotion = false,
} = {}) {
  let disposed = false;
  let generation = 0;
  let snapshot = context?.getPersonSelection?.() || { personId: null, datasetVersion: null, revision: 0 };
  let activePerson = null;
  let cameraGuard = false;
  let clearRevision = null;
  let peopleEnabled = true;
  const readGroups = getLayerGroups || context?.getLayerGroups?.bind(context);

  const requestClear = (expected = snapshot) => {
    if (disposed || !expected?.personId || clearRevision === expected.revision) return;
    clearRevision = expected.revision;
    Promise.resolve(context?.clearPerson?.()).catch(() => {});
  };
  const clear = () => {
    generation += 1;
    activePerson = null;
    cameraGuard = false;
    visual?.hide?.();
    requestClear(context?.getPersonSelection?.() || snapshot);
  };
  const renderSelection = (next) => {
    if (disposed) return;
    snapshot = next || { personId: null, datasetVersion: null, revision: 0 };
    const expected = snapshot;
    generation += 1;
    const token = generation;
    activePerson = null;
    if (!snapshot.personId) {
      cameraGuard = false;
      visual?.hide?.();
      return;
    }
    clearRevision = null;
    Promise.resolve(visual?.resolve?.(expected.personId, expected.datasetVersion)).then((person) => {
      if (disposed || token !== generation || !sameSelection(snapshot, expected)) return;
      if (!person) {
        visual.hide?.();
        requestClear(snapshot);
        return;
      }
      activePerson = person;
      cameraGuard = !(reducedMotion === true || reducedMotion === "reduced");
      visual.show?.(person, { focus: true, reducedMotion });
    }).catch(() => {});
  };
  const onGroups = (groups) => {
    const enabled = typeof layerPredicate === "function" ? layerPredicate(groups) : true;
    peopleEnabled = enabled;
  };
  const handleMapClick = (event, renderedFeatures) => {
    if (disposed || !event?.point) return false;
    const features = Array.isArray(renderedFeatures) ? renderedFeatures : (() => {
      const { x, y } = event.point;
      return map?.queryRenderedFeatures?.([[x - HIT_PADDING_PX, y - HIT_PADDING_PX], [x + HIT_PADDING_PX, y + HIT_PADDING_PX]]) || [];
    })();
    const hit = resolveGisPersonHit(features);
    if (hit && !peopleEnabled) return false;
    if (!hit) {
      clear();
      return false;
    }
    const pid = personId(hit);
    generation += 1;
    visual?.hide?.();
    const token = generation;
    Promise.resolve(visual?.load?.()).then((runtime) => {
      if (disposed || token !== generation || !runtime?.datasetVersion) return;
      return context?.selectPerson?.(pid, runtime.datasetVersion);
    }).catch(() => {});
    return true;
  };
  const onMoveEnd = () => {
    if (disposed || !activePerson) return;
    if (cameraGuard) {
      cameraGuard = false;
      return;
    }
    if (!visual?.isInsidePaddedViewport?.(activePerson, 32)) clear();
  };

  map?.on?.("moveend", onMoveEnd);
  const disposers = [];
  let sawSelection = false;
  onGroups(readGroups ? readGroups() : undefined);
  if (typeof context?.subscribe === "function") {
    disposers.push(context.subscribe("layerGroups", (value) => onGroups(value)));
    disposers.push(context.subscribe("personSelection", (value) => { sawSelection = true; renderSelection(value); }));
  }
  if (!sawSelection) renderSelection(snapshot);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      activePerson = null;
      map?.off?.("moveend", onMoveEnd);
      disposers.forEach((dispose) => dispose?.());
      visual?.dispose?.();
    },
    handleMapClick,
  };
}

export const attachGisPersonController = createGisPersonController;
