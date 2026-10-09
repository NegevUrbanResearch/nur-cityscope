import { createFakeMapLibreMap } from "./fake-maplibre-map.js";
import { getLayerLifecycleRuntime, addPaintWriteObserver } from "../../frontend/src/shared/layer-lifecycle-fade.js";
import { createNliSceneDisplayBinding } from "../../frontend/src/shared/nli-scene-display-binding.js";
import { createGisNarrativeController } from "../../frontend/src/map/nli-narrative-controller.js";
import { createProjectionNarrativeController } from "../../frontend/src/projection/projection-narrative-controller.js";
import { createNliNameFieldController } from "../../frontend/src/shared/nli-name-field-controller.js";
import { filterGroupsForGisMap } from "../../frontend/src/shared/gis-layer-filter.js";
import { isolateLayersWhileVictimNamesShown } from "../../frontend/src/shared/nli-victim-name-layer-isolation.js";
import { createNliRevealPresentation } from "../../frontend/src/map/nli-reveal-presentation.js";
import { validateNliPresentationManifest } from "../../frontend/src/shared/nli-presentation-manifest.js";
import rawManifest from "../../public/presentation/nli-presentation-manifest.json";
import { SHELTER_SCENE_ID, shelterSceneIds } from "../../frontend/src/shared/nli-shelter-scene.js";

// Only the external slide engine and decoded asset data are controlled here.
// Scene orchestration, name rendering, filters, viewer and opacity remain real.
class SlideEngine {
  constructor(root) { this.root = root; this.handlers = new Map(); this.index = 0; }
  async initialize() { this.slide(0); }
  slide(index) {
    this.index = index;
    [...this.root.querySelectorAll("section")].forEach((el, i) => el.classList.toggle("present", i === index));
    this.handlers.get("slidechanged")?.({ currentSlide: this.root.querySelector("section.present") });
  }
  getIndices() { return { h: this.index, v: 0 }; }
  on(name, fn) { this.handlers.set(name, fn); }
  destroy() {}
}
const collection = () => ({ type: "FeatureCollection", features: [] });
function nameField() {
  const feature = { type: "Feature", properties: { pid: "p1", name: "Person", visible_spans: ["left"] }, geometry: { type: "Point", coordinates: [34.4, 31.4] } };
  return { geojson: { type: "FeatureCollection", features: [feature] }, byPid: new Map([["p1", { feature, sourceCoordinates: [34.4, 31.4] }]]), diagnostics: { total: 1, placed: 1, unplaced: [] }, datasetVersion: "fixture", fontSize: 12, referenceZoom: 10, heading: 0 };
}
export async function createRenderedFollower(context, surface, emitResult) {
  const root = document.createElement("div"); document.body.append(root);
  const map = createFakeMapLibreMap();
  map.getContainer = () => root; map.getZoom = () => 10; map.getBearing = () => 0; map.getPitch = () => 0; map.getCenter = () => ({ lng: 34.4, lat: 31.4 });
  map.setFilter = (id, filter) => { map.getLayer(id).filter = filter; };
  const runtime = getLayerLifecycleRuntime(map, { now: () => Date.now(), requestFrame: cb => map.requestAnimationFrame(cb), cancelFrame: id => map.cancelAnimationFrame(id) });
  const paints = [], removals = [], results = [];
  const unobserve = addPaintWriteObserver(map, event => paints.push({ ...event, time: Date.now() }));
  const remove = map.removeLayer.bind(map);
  map.removeLayer = id => { removals.push({ id, time: Date.now(), opacity: map.getPaintProperty(id, "circle-opacity") }); return remove(id); };
  const narrative = surface === "gis" ? createGisNarrativeController({ map, managedScene: true, dataContext: context }) : createProjectionNarrativeController({ map });
  const names = surface === "projection" ? createNliNameFieldController({ map, context, managedScene: true, loadField: async () => nameField() }) : null;
  const viewer = surface === "gis" ? createNliRevealPresentation(root, { manifest: validateNliPresentationManifest(rawManifest), RevealClass: SlideEngine,
    emitResult(result) { results.push({ ...result, time: Date.now() }); emitResult(result); },
  }) : null;
  let preparationGate = null, failedPreparation = false;
  const binding = await createNliSceneDisplayBinding({ map, dataContext: context, runtime, narrativeController: narrative,
    filterGroups: surface === "gis" ? filterGroupsForGisMap : isolateLayersWhileVictimNamesShown,
    getPresentationCommand: () => viewer?.getSceneCommand(),
    getDisplaySceneIds: snapshot => viewer?.getSceneIds(snapshot) || [],
    async refreshLayers({ groupsOverride }) {
      for (const group of groupsOverride) for (const layer of group.layers || []) {
        if (!layer.enabled || layer.id === "people_names") continue;
        const id = `${group.id}.${layer.id}`, renderedId = id.replaceAll(".", "__");
        const definition = { id: renderedId, source: id, type: "circle", paint: { "circle-opacity": .8, "circle-radius": 4 } };
        const { stagedLayerDef } = runtime.stageMapLayer(id, definition, { sourceId: id, onTeardown() {
          if (map.getLayer(renderedId)) map.removeLayer(renderedId);
          if (map.getSource(id)) map.removeSource(id);
        } });
        if (!map.getSource(id)) map.addSource(id, { type: "geojson", data: collection() });
        if (!map.getLayer(renderedId)) map.addLayer(stagedLayerDef);
        runtime.markMemberReady(id);
      }
    },
    async syncTimeline(snapshot, { joinBatch } = {}) {
      if (!joinBatch || !shelterSceneIds(snapshot.enabledIds, snapshot.narrativeState?.id ?? null).length) return;
      const renderedId = SHELTER_SCENE_ID.replaceAll(".", "__");
      const definition = { id: renderedId, source: SHELTER_SCENE_ID, type: "circle", paint: { "circle-opacity": .8 } };
      const { stagedLayerDef } = runtime.stageMapLayer(SHELTER_SCENE_ID, definition, { sourceId: SHELTER_SCENE_ID, onTeardown() {
        if (map.getLayer(renderedId)) map.removeLayer(renderedId);
        if (map.getSource(SHELTER_SCENE_ID)) map.removeSource(SHELTER_SCENE_ID);
      } });
      if (!map.getSource(SHELTER_SCENE_ID)) map.addSource(SHELTER_SCENE_ID, { type: "geojson", data: collection() });
      if (!map.getLayer(renderedId)) map.addLayer(stagedLayerDef);
      runtime.markMemberReady(SHELTER_SCENE_ID);
    },
    async prepareDisplay(snapshot, options) {
      if (preparationGate) await preparationGate;
      if (failedPreparation) throw new Error("controlled asset failure");
      return { names: await names?.prepareScene(snapshot, options), presentation: await viewer?.prepareScene(snapshot, options) };
    },
    applyDisplay(prepared, options) { names?.applyScene(prepared?.names, { ...options, runtime }); viewer?.applyScene(prepared?.presentation, { ...options, runtime }); },
    discardDisplay(prepared) { names?.discardScene(prepared?.names); viewer?.discardScene(prepared?.presentation); },
    onSceneSettled: snapshot => viewer?.settleScene(snapshot),
  });
  return { map, runtime, binding, root, paints, removals, results, viewer,
    command: command => viewer?.handleCommand(command, { managedScene: true }),
    gate(promise) { preparationGate = promise; }, fail(value) { failedPreparation = value; },
    drive() { for (let i = 0; i < 8; i++) map.driveAnimationFrame(Date.now()); },
    dispose() { binding.dispose(); names?.dispose(); narrative.dispose(); viewer?.dispose(); unobserve(); runtime.dispose(); root.remove(); },
  };
}
