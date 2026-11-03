import { OTEF_API } from "../api-client.js";
import { OTEFDataContextInternals } from "./index.js";

function fallbackLogger() {
  return {
    debug: () => {},
    info: () => {},
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };
}

const getLogger = OTEFDataContextInternals.getLogger || fallbackLogger;

async function saveBounds(ctx, polygon, viewerAngleDeg) {
  if (!Array.isArray(polygon) || polygon.length < 3) {
    getLogger().warn("[OTEFDataContext] saveBounds called with invalid polygon");
    return { ok: false, error: "Invalid polygon" };
  }

  const previous = ctx._bounds;
  ctx._setBounds(polygon);

  try {
    const result = await OTEF_API.saveBounds(ctx._tableName, polygon, viewerAngleDeg);
    if (result && (result.bounds_polygon || result.polygon)) {
      ctx._setBounds(result.bounds_polygon || result.polygon);
    }
    if (typeof result.viewer_angle_deg === "number") {
      ctx._setViewerAngleDeg(result.viewer_angle_deg);
    }
    return { ok: true, result };
  } catch (err) {
    getLogger().error("[OTEFDataContext] Failed to save bounds:", err);
    ctx._setBounds(previous || null);
    return { ok: false, error: err };
  }
}

function isViewportInsideBounds(ctx, viewport) {
  const polygon = ctx._bounds;
  if (!Array.isArray(polygon) || polygon.length < 3) return true;

  const bbox = viewport && viewport.bbox;
  if (!bbox || bbox.length !== 4) return true;

  const [minX, minY, maxX, maxY] = bbox;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return pointInPolygon({ x: centerX, y: centerY }, polygon);
}

function pointInPolygon(point, polygon) {
  const { x, y } = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const onEdge =
      ((yi > y) !== (yj > y)) === false &&
      Math.abs((xj - xi) * (y - yi) - (yj - yi) * (x - xi)) < 1e-9 &&
      x >= Math.min(xi, xj) &&
      x <= Math.max(xi, xj) &&
      y >= Math.min(yi, yj) &&
      y <= Math.max(yi, yj);
    if (onEdge) return true;

    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + (yj === yi ? 1e-12 : 0)) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

OTEFDataContextInternals.bounds = {
  saveBounds,
  isViewportInsideBounds,
  pointInPolygon,
};

export { saveBounds, isViewportInsideBounds, pointInPolygon };
