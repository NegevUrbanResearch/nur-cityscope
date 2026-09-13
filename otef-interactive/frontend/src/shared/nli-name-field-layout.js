const DEFAULT_GAP = 2;
const DEFAULT_STEP = 4;

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
}

function validate(items, polygons, gap, step) {
  if (!Array.isArray(items)) throw new TypeError("items must be an array");
  if (!Array.isArray(polygons)) throw new TypeError("polygons must be an array");
  finite(gap, "gap");
  finite(step, "step");
  if (gap < 0 || step <= 0) throw new RangeError("gap must be nonnegative and step must be positive");
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item.id !== "string") throw new TypeError("item id must be a string");
    if (ids.has(item.id)) throw new TypeError(`duplicate item id: ${item.id}`);
    ids.add(item.id);
    for (const key of ["x", "y", "width", "height"]) finite(item[key], `item ${item.id} ${key}`);
    if (item.width <= 0 || item.height <= 0) throw new RangeError(`item ${item.id} width and height must be positive`);
  }
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length < 3) throw new TypeError("polygon must have at least three points");
    for (const point of polygon) {
      if (!Array.isArray(point) || point.length < 2) throw new TypeError("polygon point must be [x, y]");
      finite(point[0], "polygon x"); finite(point[1], "polygon y");
    }
  }
}

function pointOnSegment(px, py, ax, ay, bx, by) {
  const cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax);
  if (Math.abs(cross) > 1e-9) return false;
  return px >= Math.min(ax, bx) - 1e-9 && px <= Math.max(ax, bx) + 1e-9 && py >= Math.min(ay, by) - 1e-9 && py <= Math.max(ay, by) + 1e-9;
}

function pointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]; const [xj, yj] = polygon[j];
    if (pointOnSegment(x, y, xi, yi, xj, yj)) return true;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function properSegmentCross(a, b, c, d) {
  const orient = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const abC = orient(a, b, c); const abD = orient(a, b, d);
  const cdA = orient(c, d, a); const cdB = orient(c, d, b);
  return ((abC > 1e-9 && abD < -1e-9) || (abC < -1e-9 && abD > 1e-9)) && ((cdA > 1e-9 && cdB < -1e-9) || (cdA < -1e-9 && cdB > 1e-9));
}

function insideAllowed(rect, polygons, polygonBounds) {
  const corners = [[rect.x - rect.width / 2, rect.y - rect.height / 2], [rect.x + rect.width / 2, rect.y - rect.height / 2], [rect.x + rect.width / 2, rect.y + rect.height / 2], [rect.x - rect.width / 2, rect.y + rect.height / 2]];
  return polygons.some((polygon, index) => {
    const bounds = polygonBounds[index];
    if (corners[0][0] < bounds.minX || corners[1][0] > bounds.maxX || corners[0][1] < bounds.minY || corners[2][1] > bounds.maxY) return false;
    if (!corners.every((corner) => pointInPolygon(corner, polygon))) return false;
    for (let i = 0; i < corners.length; i += 1) {
      const from = corners[i]; const to = corners[(i + 1) % corners.length];
      for (let j = 0; j < polygon.length; j += 1) {
        if (properSegmentCross(from, to, polygon[j], polygon[(j + 1) % polygon.length])) return false;
      }
    }
    return true;
  });
}

/** Return whether a rectangle is fully contained by at least one allowed polygon. */
export function nameRectangleFits(rect, polygons) {
  if (!rect || !Array.isArray(polygons) || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return false;
  const polygonBounds = polygons.map((polygon) => polygon.reduce((bounds, [x, y]) => ({
    minX: Math.min(bounds.minX, x), maxX: Math.max(bounds.maxX, x), minY: Math.min(bounds.minY, y), maxY: Math.max(bounds.maxY, y),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }));
  return insideAllowed(rect, polygons, polygonBounds);
}

function compareOrder(a, b, orderBy) {
  const left = String(orderBy ? a[orderBy] ?? a.id : a.id);
  const right = String(orderBy ? b[orderBy] ?? b.id : b.id);
  return left.localeCompare(right, "he", { sensitivity: "base", numeric: true }) || a.id.localeCompare(b.id);
}

function rowIntervals(polygons, y) {
  const intervals = [];
  for (const polygon of polygons) {
    const xs = [];
    for (let i = 0; i < polygon.length; i += 1) {
      const a = polygon[i]; const b = polygon[(i + 1) % polygon.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) intervals.push([xs[i], xs[i + 1]]);
  }
  return intervals.sort((a, b) => a[0] - b[0]);
}

/** Pack whole labels on stable reading rows inside individual projector domains. */
function placeScanline(items, polygons, { gap, step, orderBy, readingOrder, minRowWidth }) {
  if (!items.length || !polygons.length) return { placements: [], unplaced: items.map(item => item.id) };
  const bounds = polygons.map(polygon => polygon.reduce((b, [x, y]) => ({
    minX: Math.min(b.minX, x), maxX: Math.max(b.maxX, x),
    minY: Math.min(b.minY, y), maxY: Math.max(b.maxY, y),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }));
  const minY = Math.min(...bounds.map(b => b.minY));
  const maxY = Math.max(...bounds.map(b => b.maxY));
  const height = Math.max(...items.map(item => item.height));
  const rowPitch = Math.ceil((height + gap) / step) * step;
  const rtl = readingOrder !== "ltr";
  const shelves = [];
  for (let y = minY + height / 2; y <= maxY - height / 2 + 1e-8; y += rowPitch) {
    const intervals = polygons.flatMap(polygon => {
      const top = rowIntervals([polygon], y - height / 2 + 1e-8);
      const bottom = rowIntervals([polygon], y + height / 2 - 1e-8);
      return top.flatMap(([l, r]) => bottom.map(([a, b]) => [Math.max(l, a), Math.min(r, b)]))
        .filter(([l, r]) => r - l >= minRowWidth);
    }).sort((a, b) => a[0] - b[0]);
    // Overlapping domains share one reading row, but containment below still
    // requires each complete label to fit a single projector.
    const merged = [];
    for (const interval of intervals) {
      const previous = merged[merged.length - 1];
      if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]);
      else merged.push(interval.slice());
    }
    if (rtl) merged.reverse();
    for (const [left, right] of merged) shelves.push({ y, left, right, cursor: rtl ? right : left });
  }
  const placements = [], unplaced = [];
  let activeShelf = 0;
  for (const item of items.slice().sort((a, b) => compareOrder(a, b, orderBy))) {
    let found = null;
    for (; activeShelf < shelves.length && !found; activeShelf++) {
      const shelf = shelves[activeShelf];
      const start = rtl ? shelf.cursor - item.width / 2 : shelf.cursor + item.width / 2;
      const end = rtl ? shelf.left + item.width / 2 : shelf.right - item.width / 2;
      // Finite geometric extent, without an arbitrary candidate-count cap.
      for (let x = start; rtl ? x >= end - 1e-8 : x <= end + 1e-8; x += rtl ? -1 : 1) {
        const candidate = { id: item.id, x, y: shelf.y, width: item.width, height: item.height };
        if (!insideAllowed(candidate, polygons, bounds)) continue;
        found = candidate;
        shelf.cursor = x + (rtl ? -1 : 1) * (item.width / 2 + gap);
        break;
      }
      if (found) break;
    }
    if (found) placements.push(found); else unplaced.push(item.id);
  }
  return { placements, unplaced };
}

export function placeNameField(items, options = {}) {
  const { polygons, gap = DEFAULT_GAP, step = DEFAULT_STEP, minRowWidth = 0 } = options;
  validate(items, polygons, gap, step);
  finite(minRowWidth, "minRowWidth");
  if (minRowWidth < 0) throw new RangeError("minRowWidth must be nonnegative");
  return placeScanline(items, polygons, { gap, step, minRowWidth, orderBy: options.orderBy, readingOrder: options.readingOrder });
}
