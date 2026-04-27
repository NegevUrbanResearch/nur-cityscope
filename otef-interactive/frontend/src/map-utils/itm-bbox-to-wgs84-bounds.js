export function itmBboxToWgs84SwNe(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || typeof proj4 !== "function") {
    return null;
  }

  if (!bbox.every((coord) => Number.isFinite(coord))) {
    return null;
  }

  const [minX, minY, maxX, maxY] = bbox;
  const corners = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];

  const projected = [];
  for (const corner of corners) {
    let point;
    try {
      point = proj4("EPSG:2039", "EPSG:4326", corner);
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

  const lngs = projected.map(([lng]) => lng);
  const lats = projected.map(([, lat]) => lat);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}
