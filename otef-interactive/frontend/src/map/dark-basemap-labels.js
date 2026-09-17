export const DARK_BASEMAP_TEXT_FIELD = Object.freeze([
  "coalesce",
  ["get", "name:he"],
  ["get", "name:en"],
  ["get", "name"],
]);

export const DARK_BASEMAP_TEXT_COLOR = "#ffffff";

const PLACE_SOURCE_LAYER = "place";
const ROAD_NAME_SOURCE_LAYER = "transportation_name";

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function textFieldGetsRef(textField) {
  return /\[\s*"get"\s*,\s*"ref"\s*\]/.test(JSON.stringify(textField ?? null));
}

function shouldRewriteLabelLayer(layer) {
  if (!layer || layer.type !== "symbol") return false;
  const sourceLayer = layer["source-layer"];
  switch (sourceLayer) {
    case PLACE_SOURCE_LAYER:
      return true;
    case ROAD_NAME_SOURCE_LAYER:
      return !textFieldGetsRef(layer.layout?.["text-field"]);
    default:
      return false;
  }
}

export function applyDarkBasemapLabelPolicy(style) {
  if (!style || !Array.isArray(style.layers)) return style;
  const next = cloneJson(style);
  next.layers = next.layers.map((layer) => {
    if (!shouldRewriteLabelLayer(layer)) return layer;
    const layout = { ...(layer.layout || {}) };
    layout["text-field"] = cloneJson(DARK_BASEMAP_TEXT_FIELD);
    if (layout["text-transform"] === "uppercase") {
      delete layout["text-transform"];
    }
    const paint = { ...(layer.paint || {}) };
    paint["text-color"] = DARK_BASEMAP_TEXT_COLOR;
    return { ...layer, layout, paint };
  });
  return next;
}
