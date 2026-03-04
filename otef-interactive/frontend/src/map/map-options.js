import { MAP_CONFIG } from "../config/map-config.js";

function buildMapOptions(gisPerf) {
  const perf = gisPerf || {};
  return {
    minZoom: MAP_CONFIG.zoom.min,
    maxZoom: MAP_CONFIG.zoom.max,
    zoomControl: MAP_CONFIG.mapOptions.zoomControl,
    maxBoundsViscosity: MAP_CONFIG.mapOptions.maxBoundsViscosity,
    preferCanvas: !!perf.ENABLE_PREFER_CANVAS,
  };
}

if (typeof window !== "undefined") {
  window.MapOptions = { buildMapOptions };
}

export { buildMapOptions };
