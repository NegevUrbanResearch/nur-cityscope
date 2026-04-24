/**
 * Creates and manages the MapLibre instance for the projection display.
 * Transparent background, no basemap, overlaid on model image.
 */
import { itmBboxToWgs84SwNe } from "../map-utils/itm-bbox-to-wgs84-bounds.js";

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
  const hull = itmBboxToWgs84SwNe(bbox);
  if (!hull) {
    return [NaN, NaN, NaN, NaN];
  }
  return hull;
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
    if (highlightEl.dataset) {
      highlightEl.dataset.highlightShape = "hidden_full_extent";
    }
    return;
  }

  const container = highlightEl.parentElement;
  const mb = modelBounds.itm;
  const cw = container?.clientWidth ?? 0;
  const ch = container?.clientHeight ?? 0;
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

  const corners = getValidCorners(viewport.corners);
  if (corners) {
    const points = corners.map((corner) => ({
      x: toPixelX(corner.x),
      y: toPixelY(corner.y),
    }));
    const allPointsFinite = points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (allPointsFinite) {
      const minX = Math.min(...points.map((point) => point.x));
      const maxX = Math.max(...points.map((point) => point.x));
      const minY = Math.min(...points.map((point) => point.y));
      const maxY = Math.max(...points.map((point) => point.y));
      const width = maxX - minX;
      const height = maxY - minY;
      if (width > 0 && height > 0) {
        box.style.left = `${minX}px`;
        box.style.top = `${minY}px`;
        box.style.width = `${width}px`;
        box.style.height = `${height}px`;
        const polygon = points
          .map((point) => `${point.x - minX}px ${point.y - minY}px`)
          .join(", ");
        box.style.clipPath = `polygon(${polygon})`;
        box.style.webkitClipPath = `polygon(${polygon})`;
        if (highlightEl.dataset) {
          highlightEl.dataset.highlightShape = "quad";
        }
        return;
      }
    }
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
  box.style.clipPath = "";
  box.style.webkitClipPath = "";
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

