export const GIS_BASEMAP_IDS = Object.freeze([
  "osm",
  "satellite",
  "satellite_bw",
  "dark",
]);

export const GIS_BASEMAP_FADE_MS = 400;
export const GIS_BASEMAP_SOURCE_WAIT_MS = 2000;

export function isGisBasemapId(value) {
  return GIS_BASEMAP_IDS.includes(value);
}

export function normalizeGisBasemap(value) {
  return isGisBasemapId(value) ? value : "osm";
}

export function isSatelliteBasemap(value) {
  return value === "satellite" || value === "satellite_bw";
}
