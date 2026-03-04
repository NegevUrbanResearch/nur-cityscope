export const MAP_CONFIG = Object.freeze({
  zoom: Object.freeze({
    min: 10,
    max: 19,
    default: 15,
  }),
  mapOptions: Object.freeze({
    zoomControl: false,
    maxBoundsViscosity: 1.0,
  }),
  viewportSync: Object.freeze({
    centerDiffThreshold: 0.0005,
    zoomDiffThreshold: 0.5,
    minApplyIntervalMs: 33,
  }),
  basemaps: Object.freeze({
    waybackImagery:
      "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/13192/{z}/{y}/{x}",
  }),
});
