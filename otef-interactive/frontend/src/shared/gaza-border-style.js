import geometry from "./gaza-border-geometry.js";
import { NLI_VISUAL_TOKENS } from "./nli-investigation-theme.js";

export const GAZA_BORDER_FULL_ID = "gaza.gaza_border";
export const GAZA_BORDER_LAYER = Object.freeze({
  id: "gaza_border",
  name: "גבול עזה",
  format: "geojson",
  geometryType: "line",
  data: geometry,
});

export const GAZA_BORDER_STYLE = Object.freeze({
  type: "line",
  renderer: "simple",
  defaultSymbol: {
    symbolLayers: [
      { type: "stroke", color: NLI_VISUAL_TOKENS.routeReveal, width: 2.4, opacity: 1, lineJoin: "round", lineCap: "round" },
    ],
  },
});

/** Older server snapshots do not yet have a toggle for the frontend-authored border. */
export function ensureGazaBorderStateRow(groups) {
  if (!Array.isArray(groups)) return groups;
  return groups.map((group) => {
    if (group.id !== "gaza" || !Array.isArray(group.layers)
      || group.layers.some((layer) => layer.id === GAZA_BORDER_LAYER.id)) return group;
    return { ...group, layers: [...group.layers, { id: GAZA_BORDER_LAYER.id, name: GAZA_BORDER_LAYER.name, enabled: false }] };
  });
}

/** A display-only override; scene layer state remains available when the override is lifted. */
export function filterGazaBorderVisibility(groups, visible = false) {
  if (visible === true) return groups;
  return groups.map(group => group.id === "gaza" ? {
    ...group,
    layers: (group.layers || []).map(layer => layer.id === GAZA_BORDER_LAYER.id ? { ...layer, enabled: false } : layer),
  } : group);
}
