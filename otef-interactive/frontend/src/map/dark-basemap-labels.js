import placeCatalog from "../shared/place-navigation/place-catalog.generated.js";
import openFreeMapDarkStyle from "./basemaps/openfreemap-dark.js";
import { GIS_SETTLEMENT_LABEL_LAYER_ID, installGisSettlementLabels } from './gis-settlement-labels.js';
import { EXCLUDED_SETTLEMENT_CODES } from '../shared/settlement-label-presentation.js';

const DARK_BASEMAP_LAYER_IDS = new Set(
  (openFreeMapDarkStyle.layers || []).map((layer) => layer.id).filter(Boolean),
);

export const DARK_BASEMAP_TEXT_FIELD = Object.freeze([
  "coalesce",
  ["get", "name:he"],
  ["get", "name:en"],
  ["get", "name"],
]);

export const DARK_BASEMAP_TEXT_COLOR = "#ffffff";
const ENGLISH_BASEMAP_TEXT_FIELD = Object.freeze(['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name:latin'], '']);

export const DARK_BASEMAP_PLACE_TEXT_FONT = Object.freeze([
  "Guttman Hatzvi",
  "Arial",
]);

export const DARK_BASEMAP_GUTTMAN_FONT_FACE_URL = "./fonts/Guttman-Hatzvi.ttf";
const gisPlaceLanguages = new WeakMap();

/** Match projector_base שמות_יישובים label size on projection. */
export const DARK_BASEMAP_KNOWN_PLACE_TEXT_SIZE = 14;

export const DARK_BASEMAP_UNKNOWN_PLACE_SIZE_SCALE = 0.82;

export const DARK_BASEMAP_UNKNOWN_PLACE_TEXT_OPACITY = 0.78;

const PLACE_SOURCE_LAYER = "place";
const ROAD_NAME_SOURCE_LAYER = "transportation_name";
const KIBBUTZ_PREFIX = "קיבוץ ";
const HEBREW_CHAR = /[\u0590-\u05FF]/;
const KNOWN_PLACE_TYPES = new Set(["yeshuv", "custom"]);

export const GIS_NOVA_PLACE_LABEL_LAYER_ID = "gis-nova-place-label";
const GIS_NOVA_PLACE_SOURCE_ID = GIS_NOVA_PLACE_LABEL_LAYER_ID;
const GIS_NOVA_CITYCODE = "nvaP";
const GIS_NOVA_TEXT_OFFSET_EM = Object.freeze([2, -0.5]);
const novaBasemapLabelHidden = new WeakMap();

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
    if (EXCLUDED_SETTLEMENT_CODES.has(place.citycode)) continue;
    if (!place?.selectable) continue;
    if (!KNOWN_PLACE_TYPES.has(place.type)) continue;
    for (const label of labelsForCatalogPlace(place)) addKnownPlaceName(names, label);
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
    : collectKnownBasemapPlaceNames({ entries: placeCatalog.entries.filter(place => place.type === 'yeshuv').map(place => ({ ...place, selectable: true })) });

  next["font-faces"] = {
    ...(next["font-faces"] || {}),
    "Guttman Hatzvi": [{ url: DARK_BASEMAP_GUTTMAN_FONT_FACE_URL }],
  };

  next.layers = next.layers.map((layer) => {
    if (!layer || layer.type !== "symbol" || layer.layout?.["text-field"] == null) return layer;
    const layout = { ...(layer.layout || {}) };
    if (options.language === 'en') {
      layout['text-font'] = ['Arial'];
      if (textFieldGetsRef(layout['text-field'])) return { ...layer, layout };
      layout['text-field'] = cloneJson(ENGLISH_BASEMAP_TEXT_FIELD);
    }
    else layout["text-font"] = layer["source-layer"] === PLACE_SOURCE_LAYER
      ? [...DARK_BASEMAP_PLACE_TEXT_FONT]
      : ["Arial"];
    if (!shouldRewriteLabelLayer(layer)) return { ...layer, layout };
    if (options.language !== 'en') layout["text-field"] = cloneJson(DARK_BASEMAP_TEXT_FIELD);
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
          0,
          DARK_BASEMAP_UNKNOWN_PLACE_TEXT_OPACITY,
        ];
      }
    }
    return { ...layer, layout, paint };
  });
  return next;
}

const HEBREW_BASEMAP_LABELS = new Map(applyDarkBasemapLabelPolicy(openFreeMapDarkStyle).layers
  .filter(layer => layer.type === 'symbol' && layer.layout?.['text-field'] != null)
  .map(layer => [layer.id, layer.layout]));

function updateBasemapLanguage(map, language) {
  for (const layer of styleLayers(map)) {
    const original = HEBREW_BASEMAP_LABELS.get(layer.id);
    if (!original || textFieldGetsRef(original['text-field'])) continue;
    map.setLayoutProperty?.(layer.id, 'text-field', language === 'en' ? cloneJson(ENGLISH_BASEMAP_TEXT_FIELD) : original['text-field']);
    map.setLayoutProperty?.(layer.id, 'text-font', language === 'en' ? ['Arial'] : original['text-font']);
  }
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

function rasterBasemapPresent(layers) {
  return layers.some((layer) => layer?.id === "osm-tiles" || layer?.id === "esri-tiles");
}

function darkBasemapPresent(layers) {
  return layers.some((layer) => DARK_BASEMAP_LAYER_IDS.has(layer?.id));
}

function isRaisedPlaceLabel(layer, suppressDarkPlaceLabels) {
  if (layer?.id === GIS_SETTLEMENT_LABEL_LAYER_ID) return true;
  if (layer?.id === GIS_NOVA_PLACE_LABEL_LAYER_ID) return true;
  if (layer?.type !== "symbol" || layer["source-layer"] !== PLACE_SOURCE_LAYER) return false;
  if (suppressDarkPlaceLabels && DARK_BASEMAP_LAYER_IDS.has(layer.id)) return false;
  return true;
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
export function ensureGisNovaPlaceLabel(map, language = 'he') {
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
  const text = feature.properties[language === 'en' ? 'name:en' : 'name:he'];
  const font = language === 'en' ? ['Arial'] : [...DARK_BASEMAP_PLACE_TEXT_FONT];
  if (typeof map.getLayer === "function" && map.getLayer(GIS_NOVA_PLACE_LABEL_LAYER_ID)) {
    map.setLayoutProperty?.(GIS_NOVA_PLACE_LABEL_LAYER_ID, 'text-field', text);
    map.setLayoutProperty?.(GIS_NOVA_PLACE_LABEL_LAYER_ID, 'text-font', font);
    return;
  }
  try {
    map.addLayer({
      id: GIS_NOVA_PLACE_LABEL_LAYER_ID,
      type: "symbol",
      source: GIS_NOVA_PLACE_SOURCE_ID,
      layout: {
        "text-field": text,
        "text-font": font,
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

function hideGisNovaBasemapLabel(options, map) {
  if (options && Object.prototype.hasOwnProperty.call(options, "narrativeId")) {
    return options.narrativeId === "nova";
  }
  return novaBasemapLabelHidden.get(map) === true;
}

function applyGisNovaPlaceLabelVisibility(map, hidden) {
  if (typeof map?.setLayoutProperty !== "function") return;
  if (typeof map.getLayer === "function" && !map.getLayer(GIS_NOVA_PLACE_LABEL_LAYER_ID)) return;
  try {
    map.setLayoutProperty(GIS_NOVA_PLACE_LABEL_LAYER_ID, "visibility", hidden ? "none" : "visible");
  } catch (_) {
    /* style was replaced mid-sync */
  }
}

/**
 * Keep dark place names above investigation fills when dark is the only basemap.
 * While a raster basemap is also on the map, leave those dark place labels in place.
 * Nova and people/selection overlays stay in front on every basemap.
 * During the nova narrative the red settlement-name label is already on, so hide
 * the white GIS-only Nova basemap label.
 */
export function ensureGisSettlementPlaceLabels(map, language = 'he') {
  installGisSettlementLabels(map, { language, font: [...DARK_BASEMAP_PLACE_TEXT_FONT], size: DARK_BASEMAP_KNOWN_PLACE_TEXT_SIZE, color: DARK_BASEMAP_TEXT_COLOR });
}

export function raiseDarkBasemapPlaceLabels(map, options = {}) {
  if (!map) return;
  const language = options.language || gisPlaceLanguages.get(map) || 'he';
  gisPlaceLanguages.set(map, language);
  updateBasemapLanguage(map, language);
  ensureGisSettlementPlaceLabels(map, language);
  ensureGisNovaPlaceLabel(map, language);
  const hidden = hideGisNovaBasemapLabel(options, map);
  novaBasemapLabelHidden.set(map, hidden);
  applyGisNovaPlaceLabelVisibility(map, hidden);
  const layers = styleLayers(map);
  const suppressDarkPlaceLabels = rasterBasemapPresent(layers) && darkBasemapPresent(layers);
  const placeIds = layers
    .filter((layer) => isRaisedPlaceLabel(layer, suppressDarkPlaceLabels))
    .map((layer) => layer.id);
  const overlayIds = layers.filter(isForegroundOverlayLayer).map((layer) => layer.id);
  for (const id of placeIds) moveLayerToTop(map, id);
  for (const id of overlayIds) moveLayerToTop(map, id);
}
