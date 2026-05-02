/**
 * Viewport → GeoJSON highlight geometry (WGS84) for MapLibre sources.
 * Uses global `proj4` (EPSG:2039 → EPSG:4326), matching maplibre-projection.js.
 */

const DEFAULT_FULL_EXTENT_TOLERANCE = 10;

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
 * ITM → WGS84 lon/lat pair; mirrors itmPointToLngLat in maplibre-projection.js.
 * @returns {[number, number] | null}
 */
function itmPointToLonLat(itmX, itmY) {
  if (typeof proj4 === "undefined") {
    return null;
  }
  let out;
  try {
    out = proj4("EPSG:2039", "EPSG:4326", [itmX, itmY]);
  } catch {
    return null;
  }
  if (
    !Array.isArray(out) ||
    out.length < 2 ||
    !Number.isFinite(out[0]) ||
    !Number.isFinite(out[1])
  ) {
    return null;
  }
  return [out[0], out[1]];
}

function ringFromItmPoints(itmPoints) {
  const ring = [];
  for (const p of itmPoints) {
    const ll = itmPointToLonLat(p.x, p.y);
    if (!ll) {
      return null;
    }
    ring.push(ll);
  }
  if (ring.length < 4) {
    return null;
  }
  const [firstLon, firstLat] = ring[0];
  ring.push([firstLon, firstLat]);
  return ring;
}

function isFullExtent(bbox, modelBounds) {
  const tol =
    (typeof MapProjectionConfig !== "undefined" && MapProjectionConfig.PROJECTION_FULL_EXTENT_TOLERANCE) ||
    DEFAULT_FULL_EXTENT_TOLERANCE;
  const mb = modelBounds.itm;
  return (
    Math.abs(bbox[0] - mb.west) < tol &&
    Math.abs(bbox[1] - mb.south) < tol &&
    Math.abs(bbox[2] - mb.east) < tol &&
    Math.abs(bbox[3] - mb.north) < tol
  );
}

/**
 * Build a GeoJSON FeatureCollection for the viewport highlight, or null if inputs/proj4 are invalid.
 * @param {object | null | undefined} viewport
 * @param {object | null | undefined} modelBounds
 * @returns {import("geojson").FeatureCollection | null}
 */
export function viewportToHighlightGeoJSON(viewport, modelBounds) {
  if (!viewport || !Array.isArray(viewport.bbox) || viewport.bbox.length !== 4 || !modelBounds?.itm) {
    return null;
  }

  if (isFullExtent(viewport.bbox, modelBounds)) {
    return { type: "FeatureCollection", features: [] };
  }

  const mb = modelBounds.itm;
  if (mb.east === mb.west || mb.north === mb.south) {
    return null;
  }

  const bboxCornersItm = () => {
    const [minE, minN, maxE, maxN] = viewport.bbox;
    return [
      { x: minE, y: minN },
      { x: maxE, y: minN },
      { x: maxE, y: maxN },
      { x: minE, y: maxN },
    ];
  };

  const corners = getValidCorners(viewport.corners);
  let itmLoop;
  if (corners) {
    itmLoop = corners.map((c) => ({ x: c.x, y: c.y }));
  } else {
    itmLoop = bboxCornersItm();
  }

  let coordinates = ringFromItmPoints(itmLoop);
  if (!coordinates && corners) {
    coordinates = ringFromItmPoints(bboxCornersItm());
  }
  if (!coordinates) {
    return null;
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [coordinates],
        },
      },
    ],
  };
}
