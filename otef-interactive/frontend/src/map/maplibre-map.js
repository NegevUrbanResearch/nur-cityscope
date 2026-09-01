import { normalizeGisBasemap } from "../shared/gis-basemap.js";
import { prepareInvestigationTimelineForStyleReload } from "../shared/maplibre-investigation-timeline.js";

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

const MAPLIBRE_RTL_TEXT_PLUGIN_URL =
  "https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.js";

function ensureMapLibreRTLTextPlugin() {
  if (!maplibregl || typeof maplibregl.setRTLTextPlugin !== "function") {
    return;
  }
  if (typeof maplibregl.getRTLTextPluginStatus === "function") {
    const status = maplibregl.getRTLTextPluginStatus();
    if (status === "loaded" || status === "loading") {
      return;
    }
  }
  try {
    // The third argument defers loading until MapLibre first needs RTL shaping.
    maplibregl.setRTLTextPlugin(MAPLIBRE_RTL_TEXT_PLUGIN_URL, null, true);
  } catch (err) {
    console.warn(
      "[maplibre-map] setRTLTextPlugin failed; Hebrew labels may render incorrectly",
      err,
    );
  }
}

ensureMapLibreRTLTextPlugin();

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
  dark: "https://tiles.openfreemap.org/styles/dark",
};

export function setGISBasemap(map, basemap) {
  const style = BASEMAP_STYLES[basemap];
  if (!map || !style || typeof map.setStyle !== "function") return false;
  prepareInvestigationTimelineForStyleReload(map);
  map.setStyle(style, { diff: false });
  return true;
}

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
    style: BASEMAP_STYLES[normalizeGisBasemap(basemap)],
    center,
    zoom,
    minZoom,
    maxZoom,
    // Integer-step zoom: align with remote/OTEF (zoomSnap:1; Map ctor has no roundZoom—see style “roundZoom” on sources).
    zoomSnap: 1,
    attributionControl: true,
    dragRotate: false,
  });

  map.touchZoomRotate.disableRotation();

  return map;
}

export { maplibregl, pmtilesProtocol, BASEMAP_STYLES };
