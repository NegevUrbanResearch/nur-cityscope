const HOME_WIDTH = 1920;
const HOME_HEIGHT = 1080;

export function gisRoadSignHomeCamera(snapshot, project) {
  const points = (snapshot.bounds_polygon || []).filter(point => Number.isFinite(point?.x) && Number.isFinite(point?.y));
  let center = [34.5, 31.4];
  if (points.length && typeof project === "function") {
    const xs = points.map(point => point.x), ys = points.map(point => point.y);
    const projected = project("EPSG:2039", "EPSG:4326", [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]);
    if (projected?.every(Number.isFinite)) center = projected;
  }
  return { center, zoom: 10 };
}

/** Resolve saved Home-editor pixels against its fixed, north-up Mercator camera. */
export function gisRoadSignCoordinate(point, homeCamera) {
  const [lng, lat] = homeCamera.center;
  const worldSize = 512 * 2 ** homeCamera.zoom;
  const centerY = Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  return [
    lng + (point.x - HOME_WIDTH / 2) * 360 / worldSize,
    (2 * Math.atan(Math.exp(centerY - (point.y - HOME_HEIGHT / 2) * 2 * Math.PI / worldSize)) - Math.PI / 2) * 180 / Math.PI,
  ];
}

export function projectGisRoadSigns(signs, map, homeCamera, width, height) {
  const project = point => {
    const pixel = map.project(gisRoadSignCoordinate(point, homeCamera));
    return { x: pixel.x * HOME_WIDTH / width, y: pixel.y * HOME_HEIGHT / height };
  };
  return signs.map(sign => ({ ...sign, ...project(sign),
    leader: { ...sign.leader, ...project(sign.leader) } }));
}
