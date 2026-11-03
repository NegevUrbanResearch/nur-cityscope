export function itmAxisAlignedBboxFromLngLatBounds(bounds, toItm) {
  if (!bounds || typeof toItm !== "function") return null;
  if (
    typeof bounds.getNorthWest !== "function" ||
    typeof bounds.getNorthEast !== "function" ||
    typeof bounds.getSouthWest !== "function" ||
    typeof bounds.getSouthEast !== "function"
  ) {
    return null;
  }

  const corners = [
    bounds.getNorthWest(),
    bounds.getNorthEast(),
    bounds.getSouthWest(),
    bounds.getSouthEast(),
  ];

  const projected = [];
  for (const corner of corners) {
    if (
      !corner ||
      !Number.isFinite(corner.lng) ||
      !Number.isFinite(corner.lat)
    ) {
      return null;
    }
    let point;
    try {
      point = toItm(corner.lng, corner.lat);
    } catch {
      return null;
    }
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      !Number.isFinite(point[0]) ||
      !Number.isFinite(point[1])
    ) {
      return null;
    }
    projected.push(point);
  }

  const eastings = projected.map(([e]) => e);
  const northings = projected.map(([, n]) => n);
  return [
    Math.min(...eastings),
    Math.min(...northings),
    Math.max(...eastings),
    Math.max(...northings),
  ];
}
