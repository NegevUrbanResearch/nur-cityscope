import placeCatalog from "../shared/place-navigation/place-catalog.generated.js";

export const DARK_BASEMAP_TEXT_FIELD = Object.freeze([
  "coalesce",
  ["get", "name:he"],
  ["get", "name:en"],
  ["get", "name"],
]);

export const DARK_BASEMAP_TEXT_COLOR = "#ffffff";

export const DARK_BASEMAP_PLACE_TEXT_FONT = Object.freeze([
  "Guttman Hatzvi",
  "Arial",
]);

export const DARK_BASEMAP_GUTTMAN_FONT_FACE_URL = "./fonts/Guttman-Hatzvi.ttf";

/** Match projector_base שמות_יישובים label size on projection. */
export const DARK_BASEMAP_KNOWN_PLACE_TEXT_SIZE = 14;

export const DARK_BASEMAP_UNKNOWN_PLACE_SIZE_SCALE = 0.82;

export const DARK_BASEMAP_UNKNOWN_PLACE_TEXT_OPACITY = 0.78;

const PLACE_SOURCE_LAYER = "place";
const ROAD_NAME_SOURCE_LAYER = "transportation_name";
const KIBBUTZ_PREFIX = "קיבוץ ";
const HEBREW_CHAR = /[\u0590-\u05FF]/;
const KNOWN_PLACE_TYPES = new Set(["yeshuv", "custom"]);

/** Nearby cities that are not in שמות_יישובים; GIS name styling only, no outlines. */
const GIS_EXTRA_KNOWN_PLACES = Object.freeze([
  { he: "נתיבות", en: ["Netivot"] },
  { he: "אופקים", en: ["Ofakim", "Ofaqim"] },
  { he: "אשקלון", en: ["Ashkelon", "Ashqelon"] },
]);

export const GIS_NOVA_PLACE_LABEL_LAYER_ID = "gis-nova-place-label";
const GIS_NOVA_PLACE_SOURCE_ID = GIS_NOVA_PLACE_LABEL_LAYER_ID;
const GIS_NOVA_CITYCODE = "nvaP";
const GIS_NOVA_TEXT_OFFSET_EM = Object.freeze([2, -0.5]);

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

function addKnownPlaceName(names, value) {
  const text = String(value ?? "").trim();
  if (!text) return;
  names.add(text);
  if (text.startsWith(KIBBUTZ_PREFIX)) {
    const stripped = text.slice(KIBBUTZ_PREFIX.length).trim();
    if (stripped) names.add(stripped);
    return;
  }
  if (HEBREW_CHAR.test(text)) names.add(`${KIBBUTZ_PREFIX}${text}`);
}

function labelsForCatalogPlace(place) {
  return [
    place?.name?.he,
    place?.name?.en,
    ...(place?.aliases?.he || []),
    ...(place?.aliases?.en || []),
  ];
}

export function collectKnownBasemapPlaceNames(catalog = placeCatalog) {
  const names = new Set();
  for (const place of catalog?.entries || []) {
    if (!place?.selectable) continue;
    if (!KNOWN_PLACE_TYPES.has(place.type)) continue;
    for (const label of labelsForCatalogPlace(place)) addKnownPlaceName(names, label);
  }
  for (const place of GIS_EXTRA_KNOWN_PLACES) {
    const text = String(place?.he ?? "").trim();
    if (text) names.add(text);
    for (const alias of place?.en || []) {
      const english = String(alias ?? "").trim();
      if (english) names.add(english);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, "he"));
}

function scaleUnknownPlaceSize(size) {
  const scale = DARK_BASEMAP_UNKNOWN_PLACE_SIZE_SCALE;
  if (typeof size === "number" && Number.isFinite(size)) return size * scale;
  if (Array.isArray(size)) return ["*", scale, size];
  return 10 * scale;
}

function isZoomInput(expr) {
  return Array.isArray(expr) && expr[0] === "zoom";
}

function knownOrUnknownSize(knownMatch, unknownSize) {
  return ["case", cloneJson(knownMatch), DARK_BASEMAP_KNOWN_PLACE_TEXT_SIZE, unknownSize];
}

/**
 * `zoom` may only be the input of a top-level `interpolate` or `step`.
 * Put the known/unknown case inside stop outputs instead of wrapping the curve.
 */
function placeTextSizeExpression(baseSize, knownMatch) {
  if (Array.isArray(baseSize) && baseSize[0] === "interpolate" && isZoomInput(baseSize[2])) {
    const next = cloneJson(baseSize);
    for (let i = 4; i < next.length; i += 2) {
      next[i] = knownOrUnknownSize(knownMatch, scaleUnknownPlaceSize(next[i]));
    }
    return next;
  }
  if (Array.isArray(baseSize) && baseSize[0] === "step" && isZoomInput(baseSize[1])) {
    const next = cloneJson(baseSize);
    next[2] = knownOrUnknownSize(knownMatch, scaleUnknownPlaceSize(next[2]));
    for (let i = 4; i < next.length; i += 2) {
      next[i] = knownOrUnknownSize(knownMatch, scaleUnknownPlaceSize(next[i]));
    }
    return next;
  }
  return knownOrUnknownSize(knownMatch, scaleUnknownPlaceSize(baseSize));
}

function knownPlaceNameMatch(knownPlaceNames) {
  return ["in", cloneJson(DARK_BASEMAP_TEXT_FIELD), ["literal", knownPlaceNames]];
}

export function applyDarkBasemapLabelPolicy(style, options = {}) {
  if (!style || !Array.isArray(style.layers)) return style;
  const next = cloneJson(style);
  delete next.glyphs;
  const knownPlaceNames = Array.isArray(options.knownPlaceNames)
    ? options.knownPlaceNames.map((name) => String(name)).filter(Boolean)
    : collectKnownBasemapPlaceNames();

  next["font-faces"] = {
    ...(next["font-faces"] || {}),
    "Guttman Hatzvi": [{ url: DARK_BASEMAP_GUTTMAN_FONT_FACE_URL }],
  };

  next.layers = next.layers.map((layer) => {
    if (!layer || layer.type !== "symbol" || layer.layout?.["text-field"] == null) return layer;
    const layout = { ...(layer.layout || {}) };
    layout["text-font"] = layer["source-layer"] === PLACE_SOURCE_LAYER
      ? [...DARK_BASEMAP_PLACE_TEXT_FONT]
      : ["Arial"];
    if (!shouldRewriteLabelLayer(layer)) return { ...layer, layout };
    layout["text-field"] = cloneJson(DARK_BASEMAP_TEXT_FIELD);
    if (layout["text-transform"] === "uppercase") {
      delete layout["text-transform"];
    }
    const paint = { ...(layer.paint || {}) };
    paint["text-color"] = DARK_BASEMAP_TEXT_COLOR;
    if (layer["source-layer"] === PLACE_SOURCE_LAYER) {
      if (knownPlaceNames.length > 0) {
        const knownMatch = knownPlaceNameMatch(knownPlaceNames);
        layout["text-size"] = placeTextSizeExpression(layout["text-size"], knownMatch);
        paint["text-opacity"] = [
          "case",
          knownMatch,
          1,
          DARK_BASEMAP_UNKNOWN_PLACE_TEXT_OPACITY,
        ];
      }
    }
    return { ...layer, layout, paint };
  });
  return next;
}

const FOREGROUND_OVERLAY_PREFIXES = Object.freeze([
  "nli__people_names",
  "nli-name-field",
  "nli-name-place",
  "otef-person-selection",
]);

function styleLayers(map) {
  try {
    const layers = map?.getStyle?.()?.layers;
    return Array.isArray(layers) ? layers : [];
  } catch {
    return [];
  }
}

function moveLayerToTop(map, id) {
  if (!id || typeof map?.moveLayer !== "function") return;
  if (typeof map.getLayer === "function" && !map.getLayer(id)) return;
  try {
    map.moveLayer(id);
  } catch {
    /* style layer was already removed */
  }
}

function isBasemapPlaceLabelLayer(layer) {
  if (layer?.id === GIS_NOVA_PLACE_LABEL_LAYER_ID) return true;
  return layer?.type === "symbol" && layer["source-layer"] === PLACE_SOURCE_LAYER;
}

function isForegroundOverlayLayer(layer) {
  const id = typeof layer?.id === "string" ? layer.id : "";
  return FOREGROUND_OVERLAY_PREFIXES.some((prefix) => id.startsWith(prefix));
}

function novaPlaceFeature(catalog = placeCatalog) {
  const place = (catalog?.entries || []).find((entry) => entry?.citycode === GIS_NOVA_CITYCODE);
  const lng = Number(place?.cameraHint?.center?.lng);
  const lat = Number(place?.cameraHint?.center?.lat);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const he = String(place?.name?.he || "נובה").trim() || "נובה";
  return {
    type: "Feature",
    properties: {
      citycode: GIS_NOVA_CITYCODE,
      "name:he": he,
      "name:en": String(place?.name?.en || "Nova"),
      name: he,
    },
    geometry: { type: "Point", coordinates: [lng, lat] },
  };
}

/** GIS-only Nova name: OSM has no place feature, unlike Be'eri and Re'im. */
export function ensureGisNovaPlaceLabel(map) {
  if (!map || typeof map.addLayer !== "function") return;
  const feature = novaPlaceFeature();
  if (!feature) return;
  const collection = { type: "FeatureCollection", features: [feature] };
  const existingSource = typeof map.getSource === "function" ? map.getSource(GIS_NOVA_PLACE_SOURCE_ID) : null;
  if (!existingSource) {
    try {
      map.addSource(GIS_NOVA_PLACE_SOURCE_ID, { type: "geojson", data: collection });
    } catch (_) {
      return;
    }
  } else if (typeof existingSource.setData === "function") {
    existingSource.setData(collection);
  }
  if (typeof map.getLayer === "function" && map.getLayer(GIS_NOVA_PLACE_LABEL_LAYER_ID)) return;
  try {
    map.addLayer({
      id: GIS_NOVA_PLACE_LABEL_LAYER_ID,
      type: "symbol",
      source: GIS_NOVA_PLACE_SOURCE_ID,
      layout: {
        "text-field": feature.properties["name:he"],
        "text-font": [...DARK_BASEMAP_PLACE_TEXT_FONT],
        "text-size": DARK_BASEMAP_KNOWN_PLACE_TEXT_SIZE,
        "text-offset": [...GIS_NOVA_TEXT_OFFSET_EM],
        "text-anchor": "center",
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": DARK_BASEMAP_TEXT_COLOR,
        "text-halo-color": "rgba(0,0,0,0.7)",
        "text-halo-width": 1,
        "text-opacity": 1,
      },
    });
  } catch (_) {
    /* style was replaced mid-sync */
  }
}

/**
 * Keep OSM / dark-basemap place names above pack fills (black ground, polygons)
 * so settlement labels stay readable. People-name and person-selection overlays
 * remain in front of those place labels.
 */
export function raiseDarkBasemapPlaceLabels(map) {
  if (!map) return;
  ensureGisNovaPlaceLabel(map);
  const layers = styleLayers(map);
  const placeIds = layers.filter(isBasemapPlaceLabelLayer).map((layer) => layer.id);
  const overlayIds = layers.filter(isForegroundOverlayLayer).map((layer) => layer.id);
  for (const id of placeIds) moveLayerToTop(map, id);
  for (const id of overlayIds) moveLayerToTop(map, id);
}
