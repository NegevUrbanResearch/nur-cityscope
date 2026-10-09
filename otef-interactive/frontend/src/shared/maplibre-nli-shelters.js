/** Owned decorative symbol layer; shared coordinator supplies visibility/state. */
import { NLI_VISUAL_TOKENS } from "./nli-investigation-theme.js";
import { SHELTER_SCENE_ID } from "./nli-shelter-scene.js";
import { peekLayerLifecycleRuntime } from "./layer-lifecycle-fade.js";
import { addInvestigationOverlayLayer, completeInvestigationOverlayMount,
  deferInvestigationOverlaySceneExit } from "./investigation-overlay-lifecycle.js";
import { shelterImageSpec, shelterSymbolImage, REIM_WEST_SHELTER_ID } from "./nli-shelter-symbol.js";
import {
  resolveShelterPresentation,
  layoutShelterOffsets,
} from "./nli-shelter-presentation.js";

export const SHELTER_SOURCE_ID = "nli-shelters-232";
export const SHELTER_LAYER_ID = "nli-shelters-232-symbol";
const IMAGES = {
  neutral: "nli-shelter-concrete-neutral",
  red: "nli-shelter-concrete-red",
};
const MURAL_IMAGES = { neutral: "nli-shelter-mural-neutral", red: "nli-shelter-mural-red" };
const variantFor = id => id === REIM_WEST_SHELTER_ID ? "mural" : "normal";
const imagesFor = id => id === REIM_WEST_SHELTER_ID ? MURAL_IMAGES : IMAGES;
const available = new WeakMap();
export function sheltersVisibleOnMap(map) {
  return available.get(map) === true;
}
export function ensureShelterLayerOrder(map) {
  if (!map?.getLayer?.(SHELTER_LAYER_ID)) return;
  const layers = map.getStyle?.()?.layers || [];
  const protectedLayers = layers.filter(
    (layer) =>
      layer.id !== SHELTER_LAYER_ID &&
      (layer.id.startsWith("nli__people") ||
        layer.id.startsWith("otef-person-selection") ||
        layer.type === "symbol"),
  );
  const activityLayers = layers.filter(
    (layer) =>
      layer.id !== SHELTER_LAYER_ID && !protectedLayers.includes(layer),
  );
  const desired = [
    ...activityLayers.map((layer) => layer.id),
    SHELTER_LAYER_ID,
    ...protectedLayers.map((layer) => layer.id),
  ];
  if (desired.every((id, index) => layers[index]?.id === id)) return;
  map.moveLayer?.(SHELTER_LAYER_ID);
  for (const layer of protectedLayers) map.moveLayer?.(layer.id);
}

export function createShelterRenderer(map, options = {}) {
  let disposed = false,
    lastFrame = null,
    signature = null,
    layout = null,
    layoutKey = null,
    lastShelters = null,
    lastMesh = null,
    focusKey = null;
  const ownedImages = new Set();
  let hideGeneration = 0;
  let sceneOwned = false;
  const colors = new Map();
  const requestFrame = options.requestAnimationFrame || globalThis.requestAnimationFrame?.bind(globalThis);
  const cancelFrame = options.cancelAnimationFrame || globalThis.cancelAnimationFrame?.bind(globalThis);
  const now = options.now || (() => globalThis.performance.now());
  let animation = null;
  const spritePairs = new Map();
  function spritesFor(id) {
    const variant = variantFor(id);
    if (!spritePairs.has(variant)) spritePairs.set(variant,
      Object.fromEntries(Object.keys(IMAGES).map(state => [state,
        (options.imageFactory || shelterSymbolImage)(state === "red" ? NLI_VISUAL_TOKENS.incidentRed : NLI_VISUAL_TOKENS.annotationInk, variant),
      ])));
    return spritePairs.get(variant);
  }
  const imageId = (id) => `nli-shelter-concrete-${id}`;
  function stopColors() {
    if (animation !== null) cancelFrame?.(animation);
    animation = null;
    colors.clear();
  }
  function paintColor(id, value) {
    const sprites = spritesFor(id);
    const data = new Uint8Array(sprites.neutral.data.length);
    for (let i = 0; i < data.length; i++)
      data[i] = Math.round(sprites.neutral.data[i] + (sprites.red.data[i] - sprites.neutral.data[i]) * value);
    map.updateImage(imageId(id), { width: sprites.neutral.width, height: sprites.neutral.height, data });
  }
  function tickColors(time) {
    animation = null;
    if (disposed || !map.getSource(SHELTER_SOURCE_ID)) { stopColors(); return; }
    let pending = false;
    for (const [id, state] of colors) {
      if (!map.hasImage(imageId(id))) continue;
      const progress = Math.min(1, Math.max(0, (time - state.start) / NLI_VISUAL_TOKENS.shelterColorTransitionMs));
      state.value = state.from + (state.target - state.from) * progress;
      paintColor(id, state.value);
      pending ||= progress < 1;
    }
    options.onColorFrame?.([...colors].map(([id, state]) => ({ id, value: state.value, target: state.target })));
    if (pending) animation = requestFrame(tickColors);
  }
  function updateColors(frame) {
    if (!map.updateImage || !requestFrame) return false;
    const time = now();
    const presentIds = new Set(frame.shelters.map((shelter) => shelter.id));
    for (const id of colors.keys()) if (!presentIds.has(id)) colors.delete(id);
    const reduced = options.getMotionMode?.() === "reduced" || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    let pending = false;
    for (const shelter of frame.shelters) {
      const sprites = spritesFor(shelter.id);
      const target = frame.impactedIds?.has(shelter.id) ? 1 : 0;
      const id = imageId(shelter.id);
      let state = colors.get(shelter.id);
      if (!state || !map.hasImage(id)) {
        state = { value: target, from: target, target, start: time };
        colors.set(shelter.id, state);
        if (!map.hasImage(id)) {
          map.addImage(id, target ? sprites.red : sprites.neutral, { pixelRatio: shelterImageSpec().pixelRatio, sdf: false });
          ownedImages.add(id);
        } else paintColor(shelter.id, target);
      } else if (state.target !== target) {
        const progress = Math.min(1, Math.max(0, (time - state.start) / NLI_VISUAL_TOKENS.shelterColorTransitionMs));
        state.value = state.from + (state.target - state.from) * progress;
        Object.assign(state, { from: state.value, target, start: time });
      }
      if (reduced) {
        Object.assign(state, { value: target, from: target });
        paintColor(shelter.id, target);
      }
      pending ||= state.value !== target;
    }
    if (pending && animation === null) animation = requestFrame(tickColors);
    if (!pending && animation !== null) { cancelFrame?.(animation); animation = null; }
    return true;
  }
  function mount() {
    const spec = shelterImageSpec();
    for (const shelterId of [null, REIM_WEST_SHELTER_ID]) {
      const sprites = spritesFor(shelterId);
      for (const [state, id] of Object.entries(imagesFor(shelterId))) {
        if (!map.hasImage?.(id)) {
          map.addImage(
            id,
            sprites[state],
            { pixelRatio: spec.pixelRatio, sdf: false },
          );
          ownedImages.add(id);
        }
      }
    }
    if (!map.getSource(SHELTER_SOURCE_ID)) {
      map.addSource(SHELTER_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      signature = null;
    }
    if (!map.getLayer(SHELTER_LAYER_ID) || options.getSceneManaged?.()) {
      const layer = {
        id: SHELTER_LAYER_ID,
        type: "symbol",
        source: SHELTER_SOURCE_ID,
        paint: { "icon-opacity": 1 },
        layout: {
          "icon-image": ["get", "iconImage"],
          "icon-size": ["get", "iconSize"],
          "icon-offset": ["get", "iconOffset"],
          "icon-rotate": ["get", "iconRotation"],
          "icon-anchor": "center",
          "icon-rotation-alignment": "viewport",
          "icon-pitch-alignment": "viewport",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-padding": 0,
          "symbol-sort-key": ["get", "shelterPriority"],
          "symbol-z-order": "source",
        },
      };
      if (options.getSceneManaged?.()) addInvestigationOverlayLayer(map, SHELTER_SCENE_ID, layer);
      else map.addLayer(layer);
      ensureShelterLayerOrder(map);
    }
  }
  function announce(value) {
    if (available.get(map) === value) return;
    available.set(map, value);
    options.onAvailabilityChange?.(value);
    map.fire?.("nli-shelters-change", { visible: value });
  }
  function reset({ sceneDeparture = false } = {}) {
    const generation = ++hideGeneration;
    lastFrame = null;
    if (sceneDeparture && deferInvestigationOverlaySceneExit(map, SHELTER_SCENE_ID, () => {
      if (generation === hideGeneration) reset();
    })) return;
    stopColors();
    signature = null;
    focusKey = null;
    lastFrame = null;
    if (map.getLayer?.(SHELTER_LAYER_ID))
      map.setLayoutProperty(SHELTER_LAYER_ID, "visibility", "none");
    announce(false);
  }
  function render(frame = {}) {
    if (disposed) return;
    sceneOwned ||= options.getSceneManaged?.() === true;
    // Camera events and old clock ticks can arrive between scene exit and entry.
    // Keep departing pixels for the fade, but never reclaim an undesired member.
    if (sceneOwned && !peekLayerLifecycleRuntime(map)?.getDesiredIds().includes(SHELTER_SCENE_ID)) return;
    lastFrame = frame;
    hideGeneration++;
    if (!frame.visible || !frame.shelters?.length) {
      stopColors();
      if (map.getLayer?.(SHELTER_LAYER_ID))
        map.setLayoutProperty(SHELTER_LAYER_ID, "visibility", "none");
      announce(false);
      return;
    }
    const profile =
      options.getDisplayProfile?.() || options.displayProfile || "gis";
    const mapping = options.getProjectionPresentation?.();
    if (profile === "projection" &&
      (!(mapping?.inputCapture || mapping?.mesh) ||
        !(mapping?.sourceDimensions?.width > 0) || !(mapping?.sourceDimensions?.height > 0) ||
        !(mapping?.outputResolution?.width > 0) || !(mapping?.outputResolution?.height > 0))) {
      // The map canvas/warp may not yet exist. Retain the frame for its resize or
      // presentation event; the staged GeoJSON layer remains a valid scene member.
      layoutKey = null;
      if (map.getLayer?.(SHELTER_LAYER_ID)) map.setLayoutProperty(SHELTER_LAYER_ID, "visibility", "none");
      announce(false);
      return;
    }
    const viewport = JSON.stringify([
      profile,
      mapping?.inputCapture,
      mapping?.sourceDimensions,
      map.getCenter?.(),
      map.getZoom?.(),
      map.getBearing?.(),
      map.getPitch?.(),
      map.getCanvas?.()?.clientWidth,
      map.getCanvas?.()?.clientHeight,
      mapping?.outputResolution,
      mapping?.mapDescriptor?.matrix,
    ]);
    try {
      if (
        layoutKey !== viewport ||
        lastShelters !== frame.shelters ||
        lastMesh !== mapping?.mesh ||
        !layout
      ) {
        const presentation = resolveShelterPresentation({
          displayProfile: profile,
          zoom: map.getZoom?.(),
          ...mapping,
        });
        layout = layoutShelterOffsets(
          frame.shelters.map((s) => ({
            id: s.id,
            anchor: map.project(s.geometry.coordinates),
          })),
          presentation,
        );
        layoutKey = viewport;
        lastShelters = frame.shelters;
        lastMesh = mapping?.mesh;
        options.onPlacement?.(layout);
      }
      mount();
      const personId = frame.focusPersonId == null ? "" : String(frame.focusPersonId).trim();
      const matchingIds = personId ? frame.shelters.filter((shelter) =>
        shelter.properties?.personPids?.some((pid) => String(pid) === personId)).map((shelter) => shelter.id) : [];
      const nextFocusKey = JSON.stringify([personId !== "", matchingIds]);
      if (nextFocusKey !== focusKey) {
        const opacity = !personId ? 1 : matchingIds.length
          ? ["case", ["in", ["get", "shelterId"], ["literal", matchingIds]], 1, 0] : 0;
        const runtime = peekLayerLifecycleRuntime(map);
        if (!runtime?.updateEffectivePaint(SHELTER_SCENE_ID, SHELTER_LAYER_ID, "icon-opacity", opacity,
          { tweenMs: NLI_VISUAL_TOKENS.highlightOpacityTransitionMs })) {
          map.setPaintProperty(SHELTER_LAYER_ID, "icon-opacity-transition",
            { duration: NLI_VISUAL_TOKENS.highlightOpacityTransitionMs, delay: 0 });
          map.setPaintProperty(SHELTER_LAYER_ID, "icon-opacity", opacity);
        }
        focusKey = nextFocusKey;
      }
      const animated = updateColors(frame);
      const features = frame.shelters.map((s) => ({
        type: "Feature",
        id: s.id,
        geometry: s.geometry,
        properties: {
          shelterId: s.id,
          iconImage: animated ? imageId(s.id) : imagesFor(s.id)[frame.impactedIds?.has(s.id) ? "red" : "neutral"],
          shelterPriority: s.id === REIM_WEST_SHELTER_ID ? 1 : 0,
          impacted: frame.impactedIds?.has(s.id) === true,
          iconSize: layout.get(s.id)?.size || 0,
          iconOffset: layout.get(s.id)?.offset || [0, 0],
          iconRotation: layout.get(s.id)?.rotationDeg || 0,
        },
      }));
      const next = JSON.stringify(features);
      if (signature !== next) {
        map
          .getSource(SHELTER_SOURCE_ID)
          .setData({ type: "FeatureCollection", features });
        signature = next;
      }
      if (
        map.getLayoutProperty?.(SHELTER_LAYER_ID, "visibility") !== "visible"
      ) {
        map.setLayoutProperty(SHELTER_LAYER_ID, "visibility", "visible");
        ensureShelterLayerOrder(map);
      }
      announce(true);
      if (options.getSceneManaged?.()) completeInvestigationOverlayMount(map, SHELTER_SCENE_ID);
    } catch (error) {
      reset();
      options.onDiagnostic?.(error);
    }
  }
  const reposition = () => {
    layoutKey = null;
    if (lastFrame) render(lastFrame);
  };
  map.on?.("move", reposition);
  map.on?.("resize", reposition);
  map.on?.("nli-shelter-presentation-change", reposition);
  return {
    render,
    reset,
    prepareScene() {
      if (disposed || !peekLayerLifecycleRuntime(map)?.getDesiredIds().includes(SHELTER_SCENE_ID)) return;
      sceneOwned = true;
      mount();
      completeInvestigationOverlayMount(map, SHELTER_SCENE_ID);
    },
    ensureOrder: () => ensureShelterLayerOrder(map),
    dispose() {
      disposed = true;
      reset();
      map.off?.("move", reposition);
      map.off?.("resize", reposition);
      map.off?.("nli-shelter-presentation-change", reposition);
      if (map.getLayer?.(SHELTER_LAYER_ID)) map.removeLayer(SHELTER_LAYER_ID);
      if (map.getSource?.(SHELTER_SOURCE_ID))
        map.removeSource(SHELTER_SOURCE_ID);
      for (const id of ownedImages) if (map.hasImage?.(id)) map.removeImage(id);
    },
  };
}
