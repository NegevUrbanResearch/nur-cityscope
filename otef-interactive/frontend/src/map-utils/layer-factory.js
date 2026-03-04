import StyleApplicator from "./style-applicator.js";
import AdvancedStyleEngine from "./advanced-style-engine.js";
import { createAdvancedPmtilesLayer } from "./advanced-pmtiles-layer.js";
import { renderPopupContent } from "./popup-renderer.js";

// Layer factory helpers for creating Leaflet/PMTiles layers from configs and data.
// These functions are responsible for constructing the visual layer objects, not
// for visibility or OTEFDataContext wiring.

// For browser usage we rely on global L, StyleApplicator, renderPopupContent,
// and protomapsL. For Node/tests we fall back to require where available.

let StyleApplicatorRef;
let AdvancedStyleEngineRef;
let renderPopupContentRef;
let LRef;
let protomapsLRef;
let AdvancedPmtilesLayerRef;

// Helper to (re)initialize browser globals lazily, so that script load order
// does not matter. This is important because layer-factory.js is loaded
// before style-applicator.js in index.html.
function ensureBrowserRefs() {
  if (typeof StyleApplicator !== "undefined" && !StyleApplicatorRef) {
    StyleApplicatorRef = StyleApplicator;
  }
  if (typeof AdvancedStyleEngine !== "undefined" && !AdvancedStyleEngineRef) {
    AdvancedStyleEngineRef = AdvancedStyleEngine;
  }
  if (typeof renderPopupContent === "function" && !renderPopupContentRef) {
    renderPopupContentRef = renderPopupContent;
  }
  if (typeof L !== "undefined" && !LRef) {
    LRef = L;
  }
  if (typeof AdvancedPmtilesLayer !== "undefined" && !AdvancedPmtilesLayerRef) {
    if (
      AdvancedPmtilesLayer &&
      typeof AdvancedPmtilesLayer.createAdvancedPmtilesLayer === "function"
    ) {
      AdvancedPmtilesLayerRef =
        AdvancedPmtilesLayerRef ||
        AdvancedPmtilesLayer.createAdvancedPmtilesLayer;
    }
  }
  if (typeof protomapsL !== "undefined" && !protomapsLRef) {
    protomapsLRef = protomapsL;
  }
}

// Initialize references once at module load (may be refined later by ensureBrowserRefs)
ensureBrowserRefs();

StyleApplicatorRef = StyleApplicatorRef || StyleApplicator;
AdvancedStyleEngineRef = AdvancedStyleEngineRef || AdvancedStyleEngine;
renderPopupContentRef = renderPopupContentRef || renderPopupContent;

/**
 * Create a Leaflet GeoJSON layer (points/lines/polygons) with styling and popup
 * wiring based on the given layerConfig and GeoJSON data.
 *
 * @param {Object} options
 * @param {string} options.fullLayerId
 * @param {Object} options.layerConfig
 * @param {Object} options.geojson
 * @param {Object} options.map - Leaflet map instance (used for popups)
 * @returns {L.GeoJSON} Leaflet GeoJSON layer
 */
function createGeoJsonLayer(options) {
  const { fullLayerId, layerConfig, geojson, map } = options || {};

  // Ensure we see browser globals even if this script loaded first
  ensureBrowserRefs();

  if (!LRef || !StyleApplicatorRef || !geojson || !layerConfig) {
    return null;
  }

  const styleFunction =
    AdvancedStyleEngineRef &&
    typeof AdvancedStyleEngineRef.getLeafletStyleFunction === "function"
      ? AdvancedStyleEngineRef.getLeafletStyleFunction(layerConfig)
      : StyleApplicatorRef.getLeafletStyle(layerConfig);
  const popupConfig = layerConfig.ui?.popup;
  const layerDisplayName =
    layerConfig.name ||
    (typeof LayerStateHelper !== "undefined" &&
    typeof LayerStateHelper.getLayerIdOnly === "function"
      ? LayerStateHelper.getLayerIdOnly(fullLayerId)
      : fullLayerId.split(".").pop());

  // Determine pane based on geometry type
  let layerPane = "overlayPolygon"; // Default
  if (layerConfig.geometryType === "line") layerPane = "overlayLine";
  if (layerConfig.geometryType === "point") layerPane = "overlayPoint";

  const labelsConfig = layerConfig.style?.labels;
  const layerIdOnly = fullLayerId.split(".").pop();
  const isLabelLayer =
    layerConfig.geometryType === "point" &&
    (layerIdOnly === "names" || fullLayerId.endsWith(".names")) &&
    labelsConfig &&
    typeof labelsConfig.field === "string";

  let leafletLayer;
  if (layerConfig.geometryType === "point") {
    if (isLabelLayer) {
      const field = labelsConfig.field;
      const font = labelsConfig.font || "Arial, sans-serif";
      const sizePt = typeof labelsConfig.size === "number" ? labelsConfig.size : 10;
      const sizePx = Math.max(8, (sizePt * 96) / 72);
      const color = labelsConfig.color || "#000000";
      const opacity = labelsConfig.colorOpacity != null ? labelsConfig.colorOpacity : 1;
      const dir = labelsConfig.textDirection === "RTL" ? "rtl" : "ltr";
      const fontWeight = labelsConfig.fontWeight || "normal";
      const fontStyle = labelsConfig.fontStyle || "normal";

      leafletLayer = LRef.geoJSON(geojson, {
        pane: layerPane,
        pointToLayer: (feature, latlng) => {
          const props = feature.properties || {};
          let text = props[field];
          if (text == null) text = "";
          text = String(text).trim();
          const escaped = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
          const styleStr =
            "font-family:" +
            font +
            ";font-size:" +
            sizePx +
            "px;color:" +
            color +
            ";opacity:" +
            opacity +
            ";font-weight:" +
            fontWeight +
            ";font-style:" +
            fontStyle +
            ";white-space:nowrap;pointer-events:none;";
          const html =
            '<span style="' +
            styleStr +
            '" dir="' +
            dir +
            '">' +
            escaped +
            "</span>";
          return LRef.marker(latlng, {
            icon: LRef.divIcon({
              html: html,
              className: "label-layer-icon",
              iconSize: null,
              iconAnchor: [0, 0],
            }),
            pane: layerPane,
          });
        },
        onEachFeature: (feature, layer) => {
          if (popupConfig && typeof renderPopupContentRef === "function" && map) {
            layer.on("click", (e) => {
              const content = renderPopupContentRef(
                feature,
                popupConfig,
                layerDisplayName,
              );
              LRef.popup().setLatLng(e.latlng).setContent(content).openOn(map);
            });
          }
        },
      });
    } else {
      // Use style function for EACH point feature (circle markers)
      leafletLayer = LRef.geoJSON(geojson, {
        pane: layerPane,
        pointToLayer: (feature, latlng) => {
          const style = styleFunction(feature);

          // Targeted normalization for oversized heritage markers only.
          // Other point layers keep their configured radius.
          const isHeritageMarker =
            fullLayerId === "future_development.מורשת-קיים" ||
            fullLayerId === "future_development.מורשת-מוצע" ||
            fullLayerId === "future_development.מורשת_קיים" ||
            fullLayerId === "future_development.מורשת_מוצע";

          const baseRadius = typeof style.radius === "number" ? style.radius : 5;
          const radius = isHeritageMarker ? Math.min(baseRadius, 6) : baseRadius;

          return LRef.circleMarker(latlng, {
            ...style,
            radius,
            color: style.strokeColor || style.color || "#000000",
            weight: style.strokeWidth || style.weight || 1,
            fillColor: style.fillColor || "#808080",
            fillOpacity:
              style.fillOpacity !== undefined ? style.fillOpacity : 0.7,
            pane: layerPane,
          });
        },
        onEachFeature: (feature, layer) => {
          if (popupConfig && typeof renderPopupContentRef === "function" && map) {
            layer.on("click", (e) => {
              const content = renderPopupContentRef(
                feature,
                popupConfig,
                layerDisplayName,
              );
              LRef.popup().setLatLng(e.latlng).setContent(content).openOn(map);
            });
          }
        },
      });
    }
  } else {
    // Use traditional style function for polygons and lines (including advanced
    // layers that have no PMTiles; they render with simple styling as fallback).
    leafletLayer = LRef.geoJSON(geojson, {
      pane: layerPane,
      style: (feature) => {
        const baseStyle = styleFunction(feature);
        const geomType = feature && feature.geometry && feature.geometry.type;

        // Special case: some layers (e.g. שטחים_פתוחים_פגועים) have a line
        // symbol in the .lyrx (stroke only) but polygon geometries in GeoJSON.
        // For these, we want outline-only polygons (no fill) on the GIS map,
        // matching the projection behavior.
        if (
          layerConfig.geometryType === "line" &&
          (geomType === "Polygon" || geomType === "MultiPolygon")
        ) {
          return {
            ...baseStyle,
            fillOpacity: 0,
          };
        }

        return baseStyle;
      },
      onEachFeature: (feature, layer) => {
        if (popupConfig && typeof renderPopupContentRef === "function" && map) {
          layer.on("click", (e) => {
            const content = renderPopupContentRef(
              feature,
              popupConfig,
              layerDisplayName,
            );
            LRef.popup().setLatLng(e.latlng).setContent(content).openOn(map);
          });
        }
      },
    });
  }

  return leafletLayer;
}

/**
 * Create a Protomaps/PMTiles Leaflet layer with paint rules based on style config.
 *
 * @param {Object} options
 * @param {string} options.fullLayerId
 * @param {Object} options.layerConfig
 * @param {string} options.dataUrl
 * @returns {Object|null} pmtilesLayer
 */
function createPmtilesLayer(options) {
  const { fullLayerId, layerConfig, dataUrl } = options || {};

  // Ensure we see browser globals even if this script loaded first
  ensureBrowserRefs();

  if (!protomapsLRef || !StyleApplicatorRef || !layerConfig || !dataUrl) {
    return null;
  }

  // Prefer an injected / browser global advanced PMTiles layer (for tests and browser),
  // but fall back to the imported factory when no global is available.
  const advancedFactory =
    AdvancedPmtilesLayerRef ||
    (typeof createAdvancedPmtilesLayer === "function"
      ? createAdvancedPmtilesLayer
      : null);

  // One path: use advanced PMTiles layer whenever available (engine handles simple styles via defaultStyle).
  if (layerConfig.style && advancedFactory) {
    return advancedFactory({
      fullLayerId,
      layerConfig,
      dataUrl,
    });
  }

  // No advanced PMTiles layer available (e.g. script load order or missing dependency).
  return null;
}

// Attach to window for browser consumers
if (typeof window !== "undefined") {
  window.LayerFactory = {
    createGeoJsonLayer,
    createPmtilesLayer,
  };
}

export { createGeoJsonLayer, createPmtilesLayer };
