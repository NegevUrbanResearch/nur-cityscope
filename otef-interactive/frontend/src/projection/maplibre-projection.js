/**
 * Creates and manages the MapLibre instance for the projection display.
 * Transparent background, no basemap, overlaid on model image.
 */
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

const DEFAULT_FULL_EXTENT_TOLERANCE = 10;

export function createProjectionMap(containerId, modelBounds) {
  const map = new maplibregl.Map({
    container: containerId,
    style: {
      version: 8,
      sources: {},
      layers: [],
    },
    center: modelBounds.center,
    zoom: modelBounds.zoom || 12,
    bearing: modelBounds.bearing || 0,
    interactive: false,
    attributionControl: false,
    preserveDrawingBuffer: true,
    dragRotate: false,
  });

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
  if (typeof proj4 !== "function") {
    return [NaN, NaN, NaN, NaN];
  }

  const sw = proj4("EPSG:2039", "EPSG:4326", [bbox[0], bbox[1]]);
  const ne = proj4("EPSG:2039", "EPSG:4326", [bbox[2], bbox[3]]);
  return [sw[0], sw[1], ne[0], ne[1]];
}

export function updateHighlightFromViewport(viewport, modelBounds, highlightEl) {
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
    return;
  }

  highlightEl.style.display = "";

  const container = highlightEl.parentElement;
  if (!container) return;

  const cw = container.clientWidth;
  const ch = container.clientHeight;
  const mb = modelBounds.itm;
  if (!cw || !ch || mb.east === mb.west || mb.north === mb.south) {
    return;
  }

  const toPixelX = (itmX) => ((itmX - mb.west) / (mb.east - mb.west)) * cw;
  const toPixelY = (itmY) => ((mb.north - itmY) / (mb.north - mb.south)) * ch;

  const x1 = toPixelX(viewport.bbox[0]);
  const x2 = toPixelX(viewport.bbox[2]);
  const y1 = toPixelY(viewport.bbox[3]);
  const y2 = toPixelY(viewport.bbox[1]);

  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);

  let box = highlightEl.querySelector(".highlight-box");
  if (!box) {
    box = document.createElement("div");
    box.className = "highlight-box";
    box.style.cssText =
      "position:absolute;border:3px solid cyan;pointer-events:none;transition:all 0.15s ease-out;";
    highlightEl.appendChild(box);
  }

  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
  box.style.width = `${w}px`;
  box.style.height = `${h}px`;
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

