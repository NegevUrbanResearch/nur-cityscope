const maplibregl =
  (typeof globalThis !== "undefined" && globalThis.maplibregl) ||
  (typeof window !== "undefined" && window.maplibregl);
const Protocol =
  (typeof globalThis !== "undefined" &&
    globalThis.pmtiles &&
    globalThis.pmtiles.Protocol) ||
  (typeof window !== "undefined" &&
    window.pmtiles &&
    window.pmtiles.Protocol);

if (!maplibregl || !Protocol) {
  throw new Error(
    "[maplibre-map] Missing maplibregl/pmtiles globals. Ensure CDN scripts are loaded before map-main.js.",
  );
}

const pmtilesProtocol = new Protocol();
maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);

const BASEMAP_STYLES = {
  osm: {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: [
          "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
          "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
          "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
        ],
        tileSize: 256,
        attribution: "&copy; OpenStreetMap contributors",
      },
    },
    layers: [{ id: "osm-tiles", type: "raster", source: "osm" }],
  },
  satellite: {
    version: 8,
    sources: {
      esri: {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        attribution: "Esri, Maxar, Earthstar Geographics",
      },
    },
    layers: [{ id: "esri-tiles", type: "raster", source: "esri" }],
  },
};

export function createGISMap(containerId, options = {}) {
  const {
    center = [34.5, 31.4],
    zoom = 11,
    minZoom = 10,
    maxZoom = 19,
    basemap = "osm",
  } = options;

  const map = new maplibregl.Map({
    container: containerId,
    style: BASEMAP_STYLES[basemap] || BASEMAP_STYLES.osm,
    center,
    zoom,
    minZoom,
    maxZoom,
    attributionControl: true,
    dragRotate: false,
  });

  map.touchZoomRotate.disableRotation();

  return map;
}

export { maplibregl, pmtilesProtocol, BASEMAP_STYLES };
