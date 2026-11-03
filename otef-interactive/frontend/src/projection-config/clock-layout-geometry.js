import { projectionOverlayMatrix, OUTPUT_HEIGHT, OUTPUT_WIDTH } from "../projection/projection-overlay-placement.js";
import { normalizeLegendColumns } from "../projection/legend-layout.js";

const BARYCENTRIC_EPSILON = 1e-7;
const DEGENERATE_EPSILON = 1e-12;
const HIT_EPSILON = 1e-7;
const MIN_BOX_PCT = 2;
const MIN_FONT_PX = 8;
const MAX_FONT_PX = 64;

function finitePoint(point, keys) {
  return point && keys.every((key) => typeof point[key] === "number" && Number.isFinite(point[key]));
}

function triangles(mesh) {
  if (!mesh || mesh.width !== OUTPUT_WIDTH || mesh.height !== OUTPUT_HEIGHT
      || !Array.isArray(mesh.vertices) || !Array.isArray(mesh.triangles)) return [];
  const result = [];
  for (let index = 0; index + 2 < mesh.triangles.length; index += 3) {
    const ids = mesh.triangles.slice(index, index + 3);
    if (!ids.every((id) => Number.isInteger(id) && id >= 0 && id < mesh.vertices.length)) continue;
    const points = ids.map((id) => mesh.vertices[id]);
    if (points.every((point) => finitePoint(point, ["u", "v", "x", "y"]))) result.push(points);
  }
  return result;
}

function barycentric(a, b, c, point, xKey, yKey) {
  const denominator = (b[yKey] - c[yKey]) * (a[xKey] - c[xKey])
    + (c[xKey] - b[xKey]) * (a[yKey] - c[yKey]);
  if (Math.abs(denominator) <= DEGENERATE_EPSILON) return null;
  const wa = ((b[yKey] - c[yKey]) * (point.x - c[xKey]) + (c[xKey] - b[xKey]) * (point.y - c[yKey])) / denominator;
  const wb = ((c[yKey] - a[yKey]) * (point.x - c[xKey]) + (a[xKey] - c[xKey]) * (point.y - c[yKey])) / denominator;
  const wc = 1 - wa - wb;
  if ([wa, wb, wc].some((weight) => weight < -BARYCENTRIC_EPSILON || weight > 1 + BARYCENTRIC_EPSILON)) return null;
  return [wa, wb, wc];
}

function interpolate(points, weights, xKey, yKey) {
  return {
    [xKey]: points.reduce((sum, point, index) => sum + weights[index] * point[xKey], 0),
    [yKey]: points.reduce((sum, point, index) => sum + weights[index] * point[yKey], 0),
  };
}

function uniquePoint(points, candidate, xKey, yKey) {
  if (!points.some((point) => Math.abs(point[xKey] - candidate[xKey]) <= HIT_EPSILON
    && Math.abs(point[yKey] - candidate[yKey]) <= HIT_EPSILON)) points.push(candidate);
}

export function mapSourceUvToOutput(mesh, uv) {
  if (!finitePoint(uv, ["u", "v"])) return null;
  const hits = [];
  for (const points of triangles(mesh)) {
    const weights = barycentric(points[0], points[1], points[2], { x: uv.u, y: uv.v }, "u", "v");
    if (weights) uniquePoint(hits, interpolate(points, weights, "x", "y"), "x", "y");
  }
  return hits.length === 1 ? hits[0] : null;
}

export function mapOutputToSourceUv(mesh, output) {
  if (!finitePoint(output, ["x", "y"])) return null;
  const hits = [];
  for (const points of triangles(mesh)) {
    const weights = barycentric(points[0], points[1], points[2], output, "x", "y");
    if (weights) uniquePoint(hits, interpolate(points, weights, "u", "v"), "u", "v");
  }
  return hits.length === 1 ? hits[0] : null;
}

export function copyProjectionMesh(mesh) {
  if (!mesh || mesh.width !== OUTPUT_WIDTH || mesh.height !== OUTPUT_HEIGHT
      || !Array.isArray(mesh.vertices) || !Array.isArray(mesh.triangles)) return null;
  const vertices = mesh.vertices.map((point) => {
    if (!finitePoint(point, ["u", "v", "x", "y"])) throw new TypeError("projection mesh vertex must contain finite u/v and x/y coordinates");
    return Object.freeze({ u: point.u, v: point.v, x: point.x, y: point.y });
  });
  const indices = mesh.triangles.map((index) => {
    if (!Number.isInteger(index) || index < 0 || index >= vertices.length) throw new TypeError("projection mesh triangle index is invalid");
    return index;
  });
  return Object.freeze({ width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT, vertices: Object.freeze(vertices), triangles: Object.freeze(indices) });
}

function cross(a, b) { return a.x * b.y - a.y * b.x; }
function subtract(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }

function segmentIntersectionParameter(start, end, edgeStart, edgeEnd) {
  const direction = subtract(end, start);
  const edge = subtract(edgeEnd, edgeStart);
  const denominator = cross(direction, edge);
  if (Math.abs(denominator) <= DEGENERATE_EPSILON) return [];
  const offset = subtract(edgeStart, start);
  const t = cross(offset, edge) / denominator;
  const u = cross(offset, direction) / denominator;
  if (t < -HIT_EPSILON || t > 1 + HIT_EPSILON || u < -HIT_EPSILON || u > 1 + HIT_EPSILON) return [];
  return [Math.min(1, Math.max(0, t))];
}

function pointOnTriangle(points, uv) {
  return barycentric(points[0], points[1], points[2], { x: uv.u, y: uv.v }, "u", "v");
}

export function mapOverlayOutline(mesh, layout) {
  const matrix = projectionOverlayMatrix(layout);
  const localCorners = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const corners = localCorners.map(([u, v]) => ({
    u: matrix[0] * u + matrix[3] * v + matrix[6],
    v: matrix[1] * u + matrix[4] * v + matrix[7],
  }));
  const meshTriangles = triangles(mesh);
  const result = [];
  for (let edgeIndex = 0; edgeIndex < corners.length; edgeIndex += 1) {
    const start = corners[edgeIndex];
    const end = corners[(edgeIndex + 1) % corners.length];
    const cuts = [0, 1];
    for (const triangle of meshTriangles) {
      for (let side = 0; side < 3; side += 1) {
        const edgeStart = { x: triangle[side].u, y: triangle[side].v };
        const edgeEndVertex = triangle[(side + 1) % 3];
        const edgeEnd = { x: edgeEndVertex.u, y: edgeEndVertex.v };
        cuts.push(...segmentIntersectionParameter({ x: start.u, y: start.v }, { x: end.u, y: end.v }, edgeStart, edgeEnd));
      }
    }
    cuts.sort((a, b) => a - b);
    const uniqueCuts = cuts.filter((value, index) => index === 0 || Math.abs(value - cuts[index - 1]) > HIT_EPSILON);
    for (let index = 0; index + 1 < uniqueCuts.length; index += 1) {
      const t0 = uniqueCuts[index]; const t1 = uniqueCuts[index + 1];
      if (t1 - t0 <= HIT_EPSILON) continue;
      const sourceAt = (t) => ({ u: start.u + (end.u - start.u) * t, v: start.v + (end.v - start.v) * t });
      const midpoint = sourceAt((t0 + t1) / 2);
      const triangle = meshTriangles.find((points) => pointOnTriangle(points, midpoint));
      if (!triangle) continue;
      const mapOnTriangle = (uv) => {
        const weights = pointOnTriangle(triangle, uv);
        return weights ? interpolate(triangle, weights, "x", "y") : null;
      };
      const mappedStart = mapOnTriangle(sourceAt(t0));
      const mappedEnd = mapOnTriangle(sourceAt(t1));
      if (mappedStart && mappedEnd) result.push({ start: mappedStart, end: mappedEnd, sourceStart: sourceAt(t0), sourceEnd: sourceAt(t1) });
    }
  }
  return result;
}

function number(value, fallback) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
export function normalizeEditableLayout(layout) {
  const widthPct = clamp(number(layout.widthPct, 2), MIN_BOX_PCT, 100);
  const heightPct = clamp(number(layout.heightPct, 2), MIN_BOX_PCT, 100);
  return {
    ...layout, widthPct, heightPct,
    leftPct: clamp(number(layout.leftPct, 0), 0, 100 - widthPct),
    topPct: clamp(number(layout.topPct, 0), 0, 100 - heightPct),
    fontPx: clamp(number(layout.fontPx, 22), MIN_FONT_PX, MAX_FONT_PX),
    rotateDeg: clamp(number(layout.rotateDeg, 0), -180, 180),
    ...(layout.dwellSeconds == null ? {} : { dwellSeconds: clamp(number(layout.dwellSeconds, 8), 4, 30) }),
    ...(Object.hasOwn(layout, "columns") ? { columns: normalizeLegendColumns(layout.columns) } : {}),
  };
}
function dimensions(layout) {
  return {
    width: clamp(number(layout.widthPct, 2), MIN_BOX_PCT, 100) * OUTPUT_WIDTH / 100,
    height: clamp(number(layout.heightPct, 2), MIN_BOX_PCT, 100) * OUTPUT_HEIGHT / 100,
    centerX: (number(layout.leftPct, 0) + number(layout.widthPct, 2) / 2) * OUTPUT_WIDTH / 100,
    centerY: (number(layout.topPct, 0) + number(layout.heightPct, 2) / 2) * OUTPUT_HEIGHT / 100,
    radians: number(layout.rotateDeg, 0) * Math.PI / 180,
  };
}

function constrainedLayout(layout, centerX, centerY, width, height, fontPx = layout.fontPx) {
  const widthPct = clamp(width / OUTPUT_WIDTH * 100, MIN_BOX_PCT, 100);
  const heightPct = clamp(height / OUTPUT_HEIGHT * 100, MIN_BOX_PCT, 100);
  return {
    ...layout,
    leftPct: clamp((centerX - widthPct * OUTPUT_WIDTH / 200) / OUTPUT_WIDTH * 100, 0, 100 - widthPct),
    topPct: clamp((centerY - heightPct * OUTPUT_HEIGHT / 200) / OUTPUT_HEIGHT * 100, 0, 100 - heightPct),
    widthPct,
    heightPct,
    ...(fontPx === undefined ? {} : { fontPx: clamp(fontPx, MIN_FONT_PX, MAX_FONT_PX) }),
  };
}

export function moveLayout(layout, deltaPx = {}) {
  const dx = number(deltaPx?.x, 0); const dy = number(deltaPx?.y, 0);
  const widthPct = clamp(number(layout.widthPct, 2), MIN_BOX_PCT, 100);
  const heightPct = clamp(number(layout.heightPct, 2), MIN_BOX_PCT, 100);
  return {
    ...layout,
    leftPct: clamp(number(layout.leftPct, 0) + dx / OUTPUT_WIDTH * 100, 0, 100 - widthPct),
    topPct: clamp(number(layout.topPct, 0) + dy / OUTPUT_HEIGHT * 100, 0, 100 - heightPct),
  };
}

function cornerSigns(corner) {
  const value = String(corner).toLowerCase().replaceAll("_", "-");
  const horizontal = value.includes("left") || value === "nw" || value === "sw" ? -1 : 1;
  const vertical = value.includes("top") || value === "nw" || value === "ne" ? -1 : 1;
  return [horizontal, vertical];
}

function resize(layout, corner, deltaPx, uniform) {
  const { width, height, centerX, centerY, radians } = dimensions(layout);
  const [sx, sy] = cornerSigns(corner);
  const dx = number(deltaPx?.x, 0); const dy = number(deltaPx?.y, 0);
  const cos = Math.cos(radians); const sin = Math.sin(radians);
  const localX = dx * cos + dy * sin;
  const localY = -dx * sin + dy * cos;
  let nextWidth = width; let nextHeight = height;
  let nextFont = number(layout.fontPx, 22);
  if (uniform) {
    const ratioDelta = (sx * localX * width + sy * localY * height) / (width * width + height * height);
    const minScale = Math.max(MIN_BOX_PCT * OUTPUT_WIDTH / 100 / width, MIN_BOX_PCT * OUTPUT_HEIGHT / 100 / height, MIN_FONT_PX / nextFont);
    const maxScale = Math.min(OUTPUT_WIDTH / width, OUTPUT_HEIGHT / height, MAX_FONT_PX / nextFont);
    const scale = clamp(1 + ratioDelta, minScale, maxScale);
    nextWidth = width * scale; nextHeight = height * scale; nextFont *= scale;
  } else {
    nextWidth = clamp(width + sx * localX, MIN_BOX_PCT * OUTPUT_WIDTH / 100, OUTPUT_WIDTH);
    nextHeight = clamp(height + sy * localY, MIN_BOX_PCT * OUTPUT_HEIGHT / 100, OUTPUT_HEIGHT);
  }
  const anchorLocalX = -sx * width / 2;
  const anchorLocalY = -sy * height / 2;
  const anchorX = centerX + anchorLocalX * cos - anchorLocalY * sin;
  const anchorY = centerY + anchorLocalX * sin + anchorLocalY * cos;
  const nextCenterX = anchorX + sx * nextWidth / 2 * cos - sy * nextHeight / 2 * sin;
  const nextCenterY = anchorY + sx * nextWidth / 2 * sin + sy * nextHeight / 2 * cos;
  return constrainedLayout(layout, nextCenterX, nextCenterY, nextWidth, nextHeight, uniform ? nextFont : layout.fontPx);
}

export function resizeClockLayout(layout, corner, deltaPx) { return resize(layout, corner, deltaPx, true); }
export function resizeLegendLayout(layout, corner, deltaPx) { return resize(layout, corner, deltaPx, false); }
