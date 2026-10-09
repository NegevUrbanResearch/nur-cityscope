/** Owned decorative symbol layer; shared coordinator supplies visibility/state. */
import { NLI_VISUAL_TOKENS } from "./nli-investigation-theme.js";
import { shelterImageSpec, shelterSymbolImage } from "./nli-shelter-symbol.js";
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
    lastMesh = null;
  const ownedImages = new Set();
  function mount() {
    const spec = shelterImageSpec();
    for (const [state, id] of Object.entries(IMAGES)) {
      if (!map.hasImage?.(id)) {
        map.addImage(
          id,
          (options.imageFactory || shelterSymbolImage)(
            state === "red"
              ? NLI_VISUAL_TOKENS.incidentRed
              : NLI_VISUAL_TOKENS.annotationInk,
          ),
          { pixelRatio: spec.pixelRatio, sdf: false },
        );
        ownedImages.add(id);
      }
    }
    if (!map.getSource(SHELTER_SOURCE_ID)) {
      map.addSource(SHELTER_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      signature = null;
    }
    if (!map.getLayer(SHELTER_LAYER_ID)) {
      map.addLayer({
        id: SHELTER_LAYER_ID,
        type: "symbol",
        source: SHELTER_SOURCE_ID,
        layout: {
          "icon-image": [
            "case",
            ["get", "impacted"],
            IMAGES.red,
            IMAGES.neutral,
          ],
          "icon-size": ["get", "iconSize"],
          "icon-offset": ["get", "iconOffset"],
          "icon-anchor": "center",
          "icon-rotation-alignment": "viewport",
          "icon-pitch-alignment": "viewport",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-padding": 0,
        },
      });
      ensureShelterLayerOrder(map);
    }
  }
  function announce(value) {
    if (available.get(map) === value) return;
    available.set(map, value);
    options.onAvailabilityChange?.(value);
    map.fire?.("nli-shelters-change", { visible: value });
  }
  function reset() {
    signature = null;
    lastFrame = null;
    if (map.getLayer?.(SHELTER_LAYER_ID))
      map.setLayoutProperty(SHELTER_LAYER_ID, "visibility", "none");
    announce(false);
  }
  function render(frame = {}) {
    if (disposed) return;
    lastFrame = frame;
    if (!frame.visible || !frame.shelters?.length) {
      if (map.getLayer?.(SHELTER_LAYER_ID))
        map.setLayoutProperty(SHELTER_LAYER_ID, "visibility", "none");
      announce(false);
      return;
    }
    const profile =
      options.getDisplayProfile?.() || options.displayProfile || "gis";
    const mapping = options.getProjectionPresentation?.();
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
      const features = frame.shelters.map((s) => ({
        type: "Feature",
        id: s.id,
        geometry: s.geometry,
        properties: {
          impacted: frame.impactedIds?.has(s.id) === true,
          iconSize: layout.get(s.id)?.size || 0,
          iconOffset: layout.get(s.id)?.offset || [0, 0],
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
