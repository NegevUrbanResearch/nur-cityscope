function buildMapOptions(gisPerf) {
  const perf = gisPerf || {};
  return {
    minZoom: 10,
    maxZoom: 19,
    zoomControl: false, // Zoom controlled by remote controller only
    maxBoundsViscosity: 1.0, // Prevent dragging outside bounds
    preferCanvas: !!perf.ENABLE_PREFER_CANVAS,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildMapOptions };
}

if (typeof window !== "undefined") {
  window.MapOptions = { buildMapOptions };
}
