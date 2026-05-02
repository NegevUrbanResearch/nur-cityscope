/**
 * Creates and manages the MapLibre instance for the projection display.
 * Transparent background, no basemap, overlaid on model image.
 */
import { itmBboxToWgs84SwNe } from "../map-utils/itm-bbox-to-wgs84-bounds.js";
import { viewportToHighlightGeoJSON } from "./maplibre-projection-viewport-geojson.js";

export const PROJECTION_HIGHLIGHT_SOURCE_ID = "projection-highlight-source";
export const PROJECTION_HIGHLIGHT_FILL_LAYER_ID = "projection-highlight-fill";
export const PROJECTION_HIGHLIGHT_LINE_LAYER_ID = "projection-highlight-line";

const maplibregl =
  (typeof globalThis !== "undefined" && globalThis.maplibregl) ||
  (typeof window !== "undefined" && window.maplibregl);
const Protocol =
  (typeof globalThis !== "undefined" &&
    globalThis.pmtiles &&
    globalThis.pmtiles.Protocol) ||
  (typeof window !== "undefined" &&
    window.pmtiles &&
    window.pmtiles.Protocol);

if (!maplibregl || !Protocol) {
  throw new Error(
    "[maplibre-projection] Missing maplibregl/pmtiles globals. Ensure CDN scripts are loaded before projection-main.js.",
  );
}

const pmtilesProtocol = new Protocol();
maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);

/**
 * Hebrew (and other RTL) labels need MapLibre’s optional RTL text plugin. Without it,
 * line breaking and glyph order are wrong even with good fonts. Uses the published
 * `@mapbox/mapbox-gl-rtl-text` worker (npm BSD-2-Clause); not proprietary fonts.
 * @see https://maplibre.org/maplibre-gl-js/docs/examples/display-html-clusters-with-custom-properties/
 */
const MAPLIBRE_RTL_TEXT_PLUGIN_URL =
  "https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.js";

function ensureMapLibreRTLTextPlugin() {
  if (!maplibregl || typeof maplibregl.setRTLTextPlugin !== "function") {
    return;
  }
  if (typeof maplibregl.getRTLTextPluginStatus === "function") {
    const status = maplibregl.getRTLTextPluginStatus();
    if (status === "loaded" || status === "loading") {
      return;
    }
  }
  try {
    // Second arg is error callback; third is lazy/deferred init (load before first shaping).
    maplibregl.setRTLTextPlugin(MAPLIBRE_RTL_TEXT_PLUGIN_URL, null, true);
  } catch (err) {
    console.warn(
      "[maplibre-projection] setRTLTextPlugin failed; Hebrew labels may render incorrectly",
      err,
    );
  }
}

ensureMapLibreRTLTextPlugin();

/**
 * Projection wall must not pan/zoom, but the map stays interactive so MapLibre attaches
 * pointer listeners (required for label-debug clicks). Disable navigation handlers after construction.
 * @param {import("maplibre-gl").Map} map
 */
function disableProjectionMapNavigation(map) {
  if (!map) return;
  const handlers = [
    map.dragPan,
    map.scrollZoom,
    map.boxZoom,
    map.doubleClickZoom,
    map.dragRotate,
    map.keyboard,
    map.touchZoomRotate,
    map.touchPitch,
  ];
  for (const h of handlers) {
    if (h && typeof h.disable === "function") {
      try {
        h.disable();
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Projection map intentionally omits style.glyphs (MapLibre GL JS 5.11+): text-font is
 * resolved locally (TinySDF + web fonts). That avoids demotiles 404s for stacks like
 * "Guttman Hatzvi,Noto Sans Regular" and matches @font-face on projection.html. RTL
 * shaping still uses setRTLTextPlugin above.
 */

const DEFAULT_FULL_EXTENT_TOLERANCE = 10;

/**
 * MapLibre defaults `maxCanvasSize` to [4096, 4096], which lowers internal GL resolution
 * for large containers (e.g. 5760×3240 TouchDesigner Web Browser) and looks soft when upscaled.
 * Request a large cap; the runtime clamps to WebGL MAX_TEXTURE_SIZE / safe drawing buffer.
 * @see https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/MapOptions/
 */
const PROJECTION_MAP_MAX_CANVAS_SIZE = [16384, 16384];

/**
 * @param {string} containerId
 * @param {object} modelBounds
 * @param {{ pixelRatio?: number }} [options] If `pixelRatio` is a finite number > 0, passed to MapLibre (supersampling when above devicePixelRatio).
 */
export function createProjectionMap(containerId, modelBounds, options = {}) {
  const { pixelRatio } = options;
  const mapOptions = {
    container: containerId,
    style: {
      version: 8,
      sources: {},
      layers: [],
    },
    center: modelBounds.center,
    zoom: modelBounds.zoom || 12,
    bearing: modelBounds.bearing || 0,
    interactive: true,
    attributionControl: false,
    preserveDrawingBuffer: true,
    dragRotate: false,
    maxCanvasSize: PROJECTION_MAP_MAX_CANVAS_SIZE,
  };
  if (typeof pixelRatio === "number" && Number.isFinite(pixelRatio) && pixelRatio > 0) {
    mapOptions.pixelRatio = pixelRatio;
  }
  const map = new maplibregl.Map(mapOptions);
  disableProjectionMapNavigation(map);

  map.fitBounds(modelBounds.bounds, { animate: false, padding: 0 });

  map.once("load", () => {
    const canvas = map.getCanvas();
    if (canvas) {
      canvas.style.backgroundColor = "transparent";
    }
  });

  return map;
}

export function updateProjectionViewport(map, viewport, modelBounds) {
  if (!map || !viewport || !Array.isArray(viewport.bbox) || viewport.bbox.length !== 4) {
    return;
  }

  const [west, south, east, north] = bboxToWGS84(viewport.bbox);
  if (
    !Number.isFinite(west) ||
    !Number.isFinite(south) ||
    !Number.isFinite(east) ||
    !Number.isFinite(north)
  ) {
    return;
  }

  map.fitBounds(
    [
      [west, south],
      [east, north],
    ],
    {
      animate: false,
      padding: 0,
    },
  );

  if (Number.isFinite(modelBounds?.bearing)) {
    map.setBearing(modelBounds.bearing);
  }
}

function bboxToWGS84(bbox) {
  const hull = itmBboxToWgs84SwNe(bbox);
  if (!hull) {
    return [NaN, NaN, NaN, NaN];
  }
  return hull;
}

/**
 * @param {import("maplibre-gl").Map} map
 */
export function ensureProjectionHighlightLayers(map) {
  if (!map || typeof map.getSource !== "function") {
    return;
  }
  if (map.getSource(PROJECTION_HIGHLIGHT_SOURCE_ID)) {
    return;
  }
  try {
    map.addSource(PROJECTION_HIGHLIGHT_SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    // Match projection `.highlight-box` / `.highlight-box-fill` in frontend/css/styles.css
    map.addLayer({
      id: PROJECTION_HIGHLIGHT_FILL_LAYER_ID,
      type: "fill",
      source: PROJECTION_HIGHLIGHT_SOURCE_ID,
      paint: {
        "fill-color": "#ffffff",
        "fill-opacity": 0.12,
      },
    });
    map.addLayer({
      id: PROJECTION_HIGHLIGHT_LINE_LAYER_ID,
      type: "line",
      source: PROJECTION_HIGHLIGHT_SOURCE_ID,
      paint: {
        "line-color": "rgba(255, 255, 255, 0.6)",
        "line-width": 1,
      },
    });
  } catch (err) {
    console.warn("[maplibre-projection] ensureProjectionHighlightLayers failed", err);
  }
}

/**
 * @param {import("maplibre-gl").Map} map
 */
export function raiseProjectionHighlightLayers(map) {
  if (!map || typeof map.getLayer !== "function" || typeof map.moveLayer !== "function") {
    return;
  }
  if (map.getLayer(PROJECTION_HIGHLIGHT_FILL_LAYER_ID)) {
    try {
      map.moveLayer(PROJECTION_HIGHLIGHT_FILL_LAYER_ID);
    } catch (_) {}
  }
  if (map.getLayer(PROJECTION_HIGHLIGHT_LINE_LAYER_ID)) {
    try {
      map.moveLayer(PROJECTION_HIGHLIGHT_LINE_LAYER_ID);
    } catch (_) {}
  }
}

/**
 * @param {import("maplibre-gl").Map} map
 * @param {boolean} visible
 */
export function setProjectionHighlightVisibility(map, visible) {
  if (!map || typeof map.getLayer !== "function" || typeof map.setLayoutProperty !== "function") {
    return;
  }
  const vis = visible ? "visible" : "none";
  if (map.getLayer(PROJECTION_HIGHLIGHT_FILL_LAYER_ID)) {
    map.setLayoutProperty(PROJECTION_HIGHLIGHT_FILL_LAYER_ID, "visibility", vis);
  }
  if (map.getLayer(PROJECTION_HIGHLIGHT_LINE_LAYER_ID)) {
    map.setLayoutProperty(PROJECTION_HIGHLIGHT_LINE_LAYER_ID, "visibility", vis);
  }
}

function isFinitePoint(point) {
  return (
    point &&
    typeof point === "object" &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  );
}

function getValidCorners(corners) {
  if (!corners || typeof corners !== "object") {
    return null;
  }
  const sw = corners.sw;
  const se = corners.se;
  const ne = corners.ne;
  const nw = corners.nw;
  if (!isFinitePoint(sw) || !isFinitePoint(se) || !isFinitePoint(ne) || !isFinitePoint(nw)) {
    return null;
  }
  return [sw, se, ne, nw];
}

/**
 * ITM easting/northing → WGS84 for MapLibre.project (uses global proj4).
 * @returns {{ lng: number, lat: number } | null}
 */
function itmPointToLngLat(itmX, itmY) {
  if (typeof proj4 === "undefined") {
    return null;
  }
  const out = proj4("EPSG:2039", "EPSG:4326", [itmX, itmY]);
  if (
    !Array.isArray(out) ||
    out.length < 2 ||
    !Number.isFinite(out[0]) ||
    !Number.isFinite(out[1])
  ) {
    return null;
  }
  return { lng: out[0], lat: out[1] };
}

/**
 * MapLibre map pixel space → offset into highlight overlay parent (sibling layout safe).
 */
function projectItmToOverlayPoint(map, highlightEl, itmX, itmY) {
  if (!map || typeof map.project !== "function" || typeof map.getContainer !== "function") {
    return null;
  }
  const lngLat = itmPointToLngLat(itmX, itmY);
  if (!lngLat) {
    return null;
  }
  let mapPoint;
  try {
    mapPoint = map.project([lngLat.lng, lngLat.lat]);
  } catch {
    return null;
  }
  if (!mapPoint || !Number.isFinite(mapPoint.x) || !Number.isFinite(mapPoint.y)) {
    return null;
  }
  const mapEl = map.getContainer();
  if (!mapEl || !highlightEl) {
    return null;
  }
  if (
    typeof mapEl.getBoundingClientRect !== "function" ||
    typeof highlightEl.getBoundingClientRect !== "function"
  ) {
    return { x: mapPoint.x, y: mapPoint.y };
  }
  const mr = mapEl.getBoundingClientRect();
  const hr = highlightEl.getBoundingClientRect();
  return {
    x: mapPoint.x + (mr.left - hr.left),
    y: mapPoint.y + (mr.top - hr.top),
  };
}

function tryHighlightPointsFromMapProject(map, highlightEl, itmPoints) {
  if (!map || !Array.isArray(itmPoints) || itmPoints.length === 0) {
    return null;
  }
  const points = [];
  for (const p of itmPoints) {
    const xy = projectItmToOverlayPoint(map, highlightEl, p.x, p.y);
    if (!xy) {
      return null;
    }
    points.push(xy);
  }
  return points;
}

/**
 * @param {object | null} map MapLibre Map; when null, uses legacy linear ITM→overlay (tests only).
 * @param {object} viewport
 * @param {object} modelBounds
 * @param {HTMLElement} highlightEl
 */
export function updateHighlightFromViewport(map, viewport, modelBounds, highlightEl) {
  if (map?.getSource?.(PROJECTION_HIGHLIGHT_SOURCE_ID)) {
    const geojson = viewportToHighlightGeoJSON(viewport, modelBounds);
    if (geojson === null) {
      return;
    }
    map.getSource(PROJECTION_HIGHLIGHT_SOURCE_ID).setData(geojson);
    return;
  }

  if (
    !viewport ||
    !Array.isArray(viewport.bbox) ||
    viewport.bbox.length !== 4 ||
    !highlightEl ||
    !modelBounds?.itm
  ) {
    return;
  }

  const fullExtent = isFullExtent(viewport.bbox, modelBounds);
  if (fullExtent) {
    highlightEl.style.display = "none";
    if (highlightEl.dataset) {
      highlightEl.dataset.highlightShape = "hidden_full_extent";
    }
    return;
  }

  const container = highlightEl.parentElement;
  const mb = modelBounds.itm;
  const mapEl = map && typeof map.getContainer === "function" ? map.getContainer() : null;
  const cw = mapEl?.clientWidth ?? container?.clientWidth ?? 0;
  const ch = mapEl?.clientHeight ?? container?.clientHeight ?? 0;
  if (
    !container ||
    !cw ||
    !ch ||
    mb.east === mb.west ||
    mb.north === mb.south
  ) {
    highlightEl.style.display = "none";
    if (highlightEl.dataset) {
      highlightEl.dataset.highlightShape = "hidden_invalid_container";
    }
    return;
  }

  highlightEl.style.display = "";

  const toPixelX = (itmX) => ((itmX - mb.west) / (mb.east - mb.west)) * cw;
  const toPixelY = (itmY) => ((mb.north - itmY) / (mb.north - mb.south)) * ch;

  let box = highlightEl.querySelector(".highlight-box");
  if (!box) {
    box = document.createElement("div");
    box.className = "highlight-box";
    highlightEl.appendChild(box);
  }
  let fill = box.querySelector(".highlight-box-fill");
  if (!fill) {
    fill = document.createElement("div");
    fill.className = "highlight-box-fill";
    box.appendChild(fill);
  }

  const applyBoxFromPoints = (points, shape) => {
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const width = maxX - minX;
    const height = maxY - minY;
    if (width <= 0 || height <= 0) {
      return false;
    }
    box.style.left = `${minX}px`;
    box.style.top = `${minY}px`;
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;
    fill.style.left = "0";
    fill.style.top = "0";
    fill.style.width = "100%";
    fill.style.height = "100%";
    if (shape === "quad") {
      const polygon = points
        .map((point) => `${point.x - minX}px ${point.y - minY}px`)
        .join(", ");
      fill.style.clipPath = `polygon(${polygon})`;
      fill.style.webkitClipPath = `polygon(${polygon})`;
    } else {
      fill.style.clipPath = "";
      fill.style.webkitClipPath = "";
    }
    if (highlightEl.dataset) {
      highlightEl.dataset.highlightShape = shape;
    }
    return true;
  };

  const corners = getValidCorners(viewport.corners);
  if (corners) {
    const mapPoints = tryHighlightPointsFromMapProject(
      map,
      highlightEl,
      corners.map((c) => ({ x: c.x, y: c.y })),
    );
    if (mapPoints) {
      if (applyBoxFromPoints(mapPoints, "quad")) {
        return;
      }
    }
    const points = corners.map((corner) => ({
      x: toPixelX(corner.x),
      y: toPixelY(corner.y),
    }));
    const allPointsFinite = points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (allPointsFinite && applyBoxFromPoints(points, "quad")) {
      return;
    }
  }

  const [minE, minN, maxE, maxN] = viewport.bbox;
  const bboxCornersItm = [
    { x: minE, y: minN },
    { x: maxE, y: minN },
    { x: maxE, y: maxN },
    { x: minE, y: maxN },
  ];
  const bboxMapPoints = tryHighlightPointsFromMapProject(map, highlightEl, bboxCornersItm);
  if (bboxMapPoints && applyBoxFromPoints(bboxMapPoints, "bbox")) {
    return;
  }

  const x1 = toPixelX(viewport.bbox[0]);
  const x2 = toPixelX(viewport.bbox[2]);
  const y1 = toPixelY(viewport.bbox[3]);
  const y2 = toPixelY(viewport.bbox[1]);

  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
  box.style.width = `${w}px`;
  box.style.height = `${h}px`;
  fill.style.left = "0";
  fill.style.top = "0";
  fill.style.width = "100%";
  fill.style.height = "100%";
  fill.style.clipPath = "";
  fill.style.webkitClipPath = "";
  if (highlightEl.dataset) {
    highlightEl.dataset.highlightShape = "bbox";
  }
}

function isFullExtent(bbox, modelBounds) {
  const tol =
    (typeof MapProjectionConfig !== "undefined" &&
      MapProjectionConfig.PROJECTION_FULL_EXTENT_TOLERANCE) ||
    DEFAULT_FULL_EXTENT_TOLERANCE;
  const mb = modelBounds.itm;
  return (
    Math.abs(bbox[0] - mb.west) < tol &&
    Math.abs(bbox[1] - mb.south) < tol &&
    Math.abs(bbox[2] - mb.east) < tol &&
    Math.abs(bbox[3] - mb.north) < tol
  );
}

