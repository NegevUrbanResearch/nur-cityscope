/** Leaf adapter for the existing investigation coordinator; owns no clock. */
import { createShelterDataLoader } from "./nli-shelter-data.js";
import {
  buildShelterContactIndex,
  deriveShelterImpactIds,
  SHELTER_CONTACT_METERS,
} from "./nli-shelter-contacts.js";
import { createShelterRenderer } from "./maplibre-nli-shelters.js";
import { SHELTER_SCENE_ID } from "./nli-shelter-scene.js";
import { peekLayerLifecycleRuntime } from "./layer-lifecycle-fade.js";
import { orientInvestigationLineFeature } from "./nli-investigation-route-geometry.js";
import { splitCompositeLineFrame } from "./nli-unconfirmed-route-progress.js";
import { deriveShelterVictimImpactIds, getNovaShelterDestinations,
  subscribeNovaShelterDestinations } from "./nli-shelter-nova-state.js";
const EMPTY = [];

export function createShelterTimeline(map, getDeps) {
  const loader = createShelterDataLoader();
  const diagnose = (error) =>
    (
      getDeps().onShelterDiagnostic ||
      ((e) => console.warn("[NLI shelters]", e.message))
    )(error);
  let renderer = null,
    visible = false,
    cache = null,
    lastInputs = null,
    lastImpactedIds = [],
    intermediateColorFrames = 0,
    indexBuilds = 0;
  const unsubscribeDestinations = subscribeNovaShelterDestinations(map, () => {
    if (lastInputs) render(lastInputs);
  });
  function publishDiagnostics() {
    const canvas = map.getCanvas?.();
    if (canvas?.dataset)
      canvas.dataset.nliShelters = JSON.stringify({
        status: loader.status,
        visible,
        count: loader.features.length,
        indexBuilds,
        impactedIds: lastImpactedIds,
      });
  }
  function mountRenderer() {
    renderer?.dispose();
    const deps = getDeps();
    renderer = createShelterRenderer(map, {
      getDisplayProfile: () => getDeps().displayProfile || "gis",
      getMotionMode: () => getDeps().motionMode || "full",
      getSceneManaged: () => getDeps().joinBatch === true ||
        peekLayerLifecycleRuntime(map)?.getDesiredIds().includes(SHELTER_SCENE_ID) === true,
      onColorFrame: (states) => {
        if (states.some(state => state.value > 0 && state.value < 1)) intermediateColorFrames++;
        const canvas = map.getCanvas?.();
        if (canvas?.dataset) canvas.dataset.nliShelterColors = JSON.stringify({
          intermediateFrames: intermediateColorFrames, states,
        });
      },
      getProjectionPresentation: () =>
        getDeps().getShelterProjectionPresentation?.(),
      imageFactory: deps.shelterImageFactory,
      onDiagnostic: diagnose,
      onPlacement: (layout) => {
        const canvas = map.getCanvas?.();
        if (canvas?.dataset)
          canvas.dataset.nliShelterPlacement = JSON.stringify(
            [...layout].map(([id, row]) => ({
              id,
              size: row.size,
              rotationDeg: row.rotationDeg,
              outside: row.outsideFootprint === true,
            })),
          );
        getDeps().onShelterPlacement?.(layout);
      },
    });
  }
  mountRenderer();
  function configure(deps, on) {
    visible = on;
    loader.configure({ ...deps, onShelterDiagnostic: diagnose }, on);
    if (on && deps.joinBatch === true) renderer?.prepareScene();
    if (!on || loader.status !== "ready") {
      renderer?.reset({ sceneDeparture: !on && deps.joinBatch === true });
      lastImpactedIds = [];
    }
    publishDiagnostics();
  }
  async function load(deps, isCurrent) {
    await loader.load({ ...deps, onShelterDiagnostic: diagnose }, isCurrent);
    publishDiagnostics();
  }
  function render(inputs) {
    lastInputs = inputs;
    const { frame, lineFrame, data, polygonVisible, lineVisible,
      narrativeId, peopleVisible, timelineVisible } = inputs;
    if (!visible) return;
    if (!loader.features.length) {
      renderer?.reset();
      return;
    }
    const deps = getDeps(),
      polygons = data.polygonFeatures || EMPTY,
      lines = data.lineFeatures || EMPTY;
    const tolerance = deps.shelterContactMeters ?? SHELTER_CONTACT_METERS;
    let impactedIds = new Set();
    try {
      if (
        !cache ||
        cache.version !== loader.version ||
        cache.shelters !== loader.features ||
        cache.polygons !== polygons ||
        cache.lines !== lines ||
        cache.revision !== data.dataRevision ||
        cache.tolerance !== tolerance ||
        cache.dataVersion !== data.dataVersion
      ) {
        cache = {
          version: loader.version,
          shelters: loader.features,
          polygons,
          lines,
          revision: data.dataRevision,
          tolerance,
          dataVersion: data.dataVersion,
          index: buildShelterContactIndex({
            shelters: loader.features,
            polygonFeatures: polygons,
            lineFeatures: lines,
            toleranceMeters: tolerance,
          }),
        };
        indexBuilds++;
      }
      const oriented = lineVisible
        ? {
            activeFeatures: (lineFrame.activeFeatures || EMPTY).map(
              orientInvestigationLineFeature,
            ),
            completedFeatures: (lineFrame.completedFeatures || EMPTY).map(
              orientInvestigationLineFeature,
            ),
            activeProgress: lineFrame.activeProgress ?? frame.activeProgress,
          }
        : {};
      impactedIds = deriveShelterImpactIds({
        frame,
        polygonVisible,
        contactIndex: cache.index,
        ...splitCompositeLineFrame(oriented),
      });
    } catch (error) {
      diagnose(error);
    }
    for (const id of deriveShelterVictimImpactIds({
      shelters: loader.features, frame, narrativeId, peopleVisible, timelineVisible,
      expectedRouteSHA256: loader.novaRoutesSHA256,
      destinations: getNovaShelterDestinations(map),
    })) impactedIds.add(id);
    const selection = narrativeId == null && peopleVisible && !timelineVisible
      ? deps.getPersonSelection?.() : null;
    renderer?.render({ visible, shelters: loader.features, impactedIds,
      focusPersonId: selection?.personId ?? selection?.pid ?? null });
    lastImpactedIds = [...impactedIds];
    publishDiagnostics();
  }
  return {
    configure,
    load,
    render,
    mountRenderer,
    disposeRenderer() {
      renderer?.dispose();
      renderer = null;
    },
    dispose() {
      unsubscribeDestinations();
      lastInputs = null;
      renderer?.dispose();
      loader.invalidate();
      cache = null;
    },
    get renderer() {
      return renderer;
    },
    get needsLoad() {
      return visible && ["not-loaded", "loading"].includes(loader.status);
    },
    get diagnostics() {
      return { status: loader.status, indexBuilds };
    },
  };
}
