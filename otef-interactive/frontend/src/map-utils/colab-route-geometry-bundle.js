/**
 * Parse and validate `submission_batches.colab_route_geometry_bundle` wire JSON.
 * Wire uses RFC 7946 [lng, lat]; returned geometry uses [lat, lng] for Leaflet / curated helpers.
 *
 * @param {unknown} raw
 */

function fail(reason) {
  return { ok: false, reason };
}

function isPlainObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function isFinitePair(p) {
  return (
    Array.isArray(p) &&
    p.length === 2 &&
    typeof p[0] === "number" &&
    typeof p[1] === "number" &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1])
  );
}

/** @param {[number, number]} lngLat */
function toLatLng(lngLat) {
  return [lngLat[1], lngLat[0]];
}

/** @param {unknown} coords */
function normalizeLngLatRing(coords) {
  if (!Array.isArray(coords)) return null;
  const out = [];
  for (const p of coords) {
    if (!isFinitePair(p)) return null;
    out.push(toLatLng(/** @type {[number, number]} */ (p)));
  }
  return out;
}

/**
 * @param {unknown} items
 * @returns {Array<Array<[number, number]>> | null}
 */
function parseLinestringObjectArray(items) {
  if (!Array.isArray(items)) return null;
  const paths = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!isPlainObject(item)) return null;
    if (!Object.prototype.hasOwnProperty.call(item, "coordinates")) return null;
    const ring = normalizeLngLatRing(item.coordinates);
    if (ring === null) return null;
    paths.push(ring);
  }
  return paths;
}

/**
 * @param {unknown} obj
 * @returns {{ roadEnd: [number, number]; target: [number, number] } | null}
 */
function parseOffroadPair(obj) {
  if (!isPlainObject(obj)) return null;
  if (
    !Object.prototype.hasOwnProperty.call(obj, "road_end") ||
    !Object.prototype.hasOwnProperty.call(obj, "target")
  ) {
    return null;
  }
  if (!isFinitePair(obj.road_end) || !isFinitePair(obj.target)) return null;
  return {
    roadEnd: toLatLng(/** @type {[number, number]} */ (obj.road_end)),
    target: toLatLng(/** @type {[number, number]} */ (obj.target)),
  };
}

/**
 * @param {unknown} items
 * @returns {Array<{ roadEnd: [number, number]; target: [number, number] }> | null}
 */
function parseOffroadArray(items) {
  if (!Array.isArray(items)) return null;
  const out = [];
  for (const el of items) {
    const pair = parseOffroadPair(el);
    if (pair === null) return null;
    out.push(pair);
  }
  return out;
}

/**
 * @param {unknown} items
 * @returns {Array<[number, number]> | null}
 */
function parseJunctionsArray(items) {
  if (!Array.isArray(items)) return null;
  const out = [];
  for (const p of items) {
    if (!isFinitePair(p)) return null;
    out.push(toLatLng(/** @type {[number, number]} */ (p)));
  }
  return out;
}

/**
 * @param {unknown} raw
 * @returns
 *   | { ok: true, version: 1, integratedRoute: { solid: Array<Array<[number, number]>>, removed: Array<Array<[number, number]>> }, detourPaint: { road: Array<Array<[number, number]>>, offroad: Array<{ roadEnd: [number, number], target: [number, number] }>, junctions: Array<[number, number]> } }
 *   | { ok: false, reason: string }
 */
export function parseColabRouteGeometryBundle(raw) {
  let obj = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return fail("invalid_json");
    }
  }

  if (!isPlainObject(obj)) {
    return fail("not_object");
  }

  if (!Object.prototype.hasOwnProperty.call(obj, "detour_export_version")) {
    return fail("missing_detour_export_version");
  }
  const ver = obj.detour_export_version;
  const versionOk =
    (typeof ver === "number" && Number.isFinite(ver) && ver === 1) ||
    (typeof ver === "string" && Number.isFinite(Number(ver)) && Number(ver) === 1);
  if (!versionOk) {
    return fail("unsupported_detour_export_version");
  }

  if (!Object.prototype.hasOwnProperty.call(obj, "integrated_route")) {
    return fail("missing_integrated_route");
  }
  const ir = obj.integrated_route;
  if (!isPlainObject(ir)) {
    return fail("integrated_route_not_object");
  }
  if (!Object.prototype.hasOwnProperty.call(ir, "solid") || !Object.prototype.hasOwnProperty.call(ir, "removed")) {
    return fail("integrated_route_missing_solid_or_removed");
  }

  const solid = parseLinestringObjectArray(ir.solid);
  if (solid === null) return fail("invalid_integrated_route_solid");
  const removed = parseLinestringObjectArray(ir.removed);
  if (removed === null) return fail("invalid_integrated_route_removed");

  if (!Object.prototype.hasOwnProperty.call(obj, "detour_paint")) {
    return fail("missing_detour_paint");
  }
  const dp = obj.detour_paint;
  if (!isPlainObject(dp)) {
    return fail("detour_paint_not_object");
  }
  if (
    !Object.prototype.hasOwnProperty.call(dp, "road") ||
    !Object.prototype.hasOwnProperty.call(dp, "offroad") ||
    !Object.prototype.hasOwnProperty.call(dp, "junctions")
  ) {
    return fail("detour_paint_missing_road_offroad_or_junctions");
  }

  const road = parseLinestringObjectArray(dp.road);
  if (road === null) return fail("invalid_detour_paint_road");

  const offroad = parseOffroadArray(dp.offroad);
  if (offroad === null) return fail("invalid_detour_paint_offroad");

  const junctions = parseJunctionsArray(dp.junctions);
  if (junctions === null) return fail("invalid_detour_paint_junctions");

  return {
    ok: true,
    version: 1,
    integratedRoute: { solid, removed },
    detourPaint: { road, offroad, junctions },
  };
}

/**
 * @param {unknown} paths
 * @returns {boolean}
 */
function _pathArrayHasRenderableSegment(paths) {
  return Array.isArray(paths) && paths.some((p) => Array.isArray(p) && p.length >= 2);
}

/**
 * True when parsed bundle has at least one drawable overlay element (paths with ≥2
 * vertices, offroad pairs, or junction points).
 * @param {{ ok: true, integratedRoute: { solid: unknown[], removed: unknown[] }, detourPaint: { road: unknown[], offroad: unknown[], junctions: unknown[] } } | { ok: false }} parsed
 */
export function colabBundleHasRenderableGeometry(parsed) {
  if (!parsed || !parsed.ok) return false;
  const { integratedRoute, detourPaint } = parsed;
  return (
    _pathArrayHasRenderableSegment(integratedRoute.solid) ||
    _pathArrayHasRenderableSegment(integratedRoute.removed) ||
    _pathArrayHasRenderableSegment(detourPaint.road) ||
    (Array.isArray(detourPaint.offroad) && detourPaint.offroad.length > 0) ||
    (Array.isArray(detourPaint.junctions) && detourPaint.junctions.length > 0)
  );
}

/**
 * Whether the bundle implies a “detour” overlay beyond the solid axis (for `planPinkCuratedOverlayLayers.hasDetourPoints`).
 * @param {{ ok: true, integratedRoute: { removed: unknown[] }, detourPaint: { road: unknown[], offroad: unknown[], junctions: unknown[] } } | { ok: false } | null | undefined} parsed
 */
export function colabBundleHasDetourPaint(parsed) {
  if (!parsed || !parsed.ok) return false;
  const { integratedRoute, detourPaint } = parsed;
  return (
    _pathArrayHasRenderableSegment(integratedRoute.removed) ||
    _pathArrayHasRenderableSegment(detourPaint.road) ||
    (Array.isArray(detourPaint.offroad) && detourPaint.offroad.length > 0) ||
    (Array.isArray(detourPaint.junctions) && detourPaint.junctions.length > 0)
  );
}
