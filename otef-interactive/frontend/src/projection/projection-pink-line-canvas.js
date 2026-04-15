/**
 * Canvas projection: pink-line base polylines + parking point layer.
 * Keeps async attach guards and dual visibility (axis vs parking) in one place.
 */

import {
  fetchPinkLinePaths,
  resolvePinkLinePackStyleBundle,
} from "../shared/curated-layer-service.js";
import {
  PINK_LINE_PARKING_ICON_URL,
  fetchPinkLineParkingLotsGeojson,
  enrichParkingGeojsonForProjection,
} from "../map-utils/pink-line-parking.js";

const PINK_LINE_BASE_LAYER_ID = "pink_line_base";
/** Canvas renderer layer id (not the OTEF fullLayerId curated_moresht_axis.pink_line_parking). */
const PINK_LINE_CANVAS_PARKING_LAYER_ID = "pink_line_parking";

/**
 * @param {{ getCanvasRenderer: () => unknown, loadedLayers: Record<string, unknown> }} options
 */
function createProjectionPinkLineCanvasController(options) {
  const getCanvasRenderer = options.getCanvasRenderer;
  const loadedLayers = options.loadedLayers;

  let projectionPinkParkingAttachGeneration = 0;
  let projectionPinkLineBaseVisibleIntent = true;
  let projectionPinkLineParkingVisibleIntent = true;

  async function ensureProjectionPinkLineBaseLayer() {
    if (loadedLayers[PINK_LINE_BASE_LAYER_ID]) return;
    const canvasRenderer = getCanvasRenderer();
    try {
      const [{ basePaths }, styleBundle] = await Promise.all([
        fetchPinkLinePaths(),
        resolvePinkLinePackStyleBundle(),
      ]);
      if (basePaths.length === 0) return;
      const features = basePaths.map((path) => ({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: path.map(([lat, lng]) => [lng, lat]),
        },
        properties: {},
      }));
      const wgs84Geojson = { type: "FeatureCollection", features };
      const itmGeojson = CoordUtils.transformGeojsonToItm(wgs84Geojson);
      const layerConfig = styleBundle.styleConfigForProjection;
      const styleFunction = styleBundle.styleFunction;
      loadedLayers[PINK_LINE_BASE_LAYER_ID] = {
        originalGeojson: itmGeojson,
        styleFunction,
        styleConfig: layerConfig,
        geometryType: styleBundle.geometryType || "line",
      };
      if (canvasRenderer) {
        canvasRenderer.setLayer(
          PINK_LINE_BASE_LAYER_ID,
          itmGeojson,
          styleFunction,
          styleBundle.geometryType || "line",
          layerConfig,
        );
        canvasRenderer.setLayerVisibility(PINK_LINE_BASE_LAYER_ID, true);
        projectionPinkLineBaseVisibleIntent = true;
      }
      if (projectionPinkLineParkingVisibleIntent) {
        await ensureProjectionPinkLineParkingLayer();
      }
    } catch (err) {
      if (
        typeof MapProjectionConfig !== "undefined" &&
        MapProjectionConfig &&
        MapProjectionConfig.ENABLE_PROJECTION_DEBUG
      ) {
        console.warn("[Projection pink-line canvas] base layer load failed:", err);
      }
    }
  }

  async function ensureProjectionPinkLineParkingLayer() {
    if (loadedLayers[PINK_LINE_CANVAS_PARKING_LAYER_ID]) return;
    const canvasRenderer = getCanvasRenderer();
    if (!canvasRenderer) return;
    const attachGen = projectionPinkParkingAttachGeneration;
    try {
      const parkingWgs = await fetchPinkLineParkingLotsGeojson();
      if (attachGen !== projectionPinkParkingAttachGeneration) return;
      if (!loadedLayers[PINK_LINE_BASE_LAYER_ID]) return;
      if (!projectionPinkLineBaseVisibleIntent || !projectionPinkLineParkingVisibleIntent) return;
      if (!parkingWgs || !parkingWgs.features || !parkingWgs.features.length) return;
      const enriched = enrichParkingGeojsonForProjection(
        parkingWgs,
        PINK_LINE_PARKING_ICON_URL,
      );
      if (!enriched.features.length) return;
      const itmGeojson = CoordUtils.transformGeojsonToItm(enriched);
      if (attachGen !== projectionPinkParkingAttachGeneration) return;
      if (!loadedLayers[PINK_LINE_BASE_LAYER_ID]) return;
      if (!projectionPinkLineBaseVisibleIntent || !projectionPinkLineParkingVisibleIntent) return;
      if (loadedLayers[PINK_LINE_CANVAS_PARKING_LAYER_ID]) return;
      const customStyleFunction = (feature) =>
        feature.properties && feature.properties._curatedStyle
          ? feature.properties._curatedStyle
          : { fillColor: "#888", color: "#fff", weight: 1, fillOpacity: 0.8, radius: 5 };
      const layerConfig = { style: { type: "simple" } };
      loadedLayers[PINK_LINE_CANVAS_PARKING_LAYER_ID] = {
        originalGeojson: itmGeojson,
        styleFunction: customStyleFunction,
        styleConfig: layerConfig,
        geometryType: "Point",
      };
      canvasRenderer.setLayer(
        PINK_LINE_CANVAS_PARKING_LAYER_ID,
        itmGeojson,
        customStyleFunction,
        "Point",
        layerConfig,
      );
      canvasRenderer.setLayerVisibility(
        PINK_LINE_CANVAS_PARKING_LAYER_ID,
        !!(projectionPinkLineBaseVisibleIntent && projectionPinkLineParkingVisibleIntent),
      );
    } catch (err) {
      if (
        typeof MapProjectionConfig !== "undefined" &&
        MapProjectionConfig &&
        MapProjectionConfig.ENABLE_PROJECTION_DEBUG
      ) {
        console.warn("[Projection pink-line canvas] parking layer load failed:", err);
      }
    }
  }

  function setProjectionPinkLineAxisGlyphsVisible(baseVisible, parkingVisible) {
    projectionPinkLineBaseVisibleIntent = !!baseVisible;
    projectionPinkLineParkingVisibleIntent = !!parkingVisible;

    if (!baseVisible) {
      projectionPinkParkingAttachGeneration += 1;
    }

    const canvasRenderer = getCanvasRenderer();
    if (!canvasRenderer || !loadedLayers[PINK_LINE_BASE_LAYER_ID]) {
      return;
    }

    canvasRenderer.setLayerVisibility(PINK_LINE_BASE_LAYER_ID, !!baseVisible);

    if (loadedLayers[PINK_LINE_CANVAS_PARKING_LAYER_ID]) {
      canvasRenderer.setLayerVisibility(
        PINK_LINE_CANVAS_PARKING_LAYER_ID,
        !!(baseVisible && parkingVisible),
      );
    } else if (baseVisible && parkingVisible) {
      void ensureProjectionPinkLineParkingLayer();
    }
  }

  return {
    ensureProjectionPinkLineBaseLayer,
    ensureProjectionPinkLineParkingLayer,
    setProjectionPinkLineAxisGlyphsVisible,
  };
}

export {
  createProjectionPinkLineCanvasController,
  PINK_LINE_BASE_LAYER_ID,
  PINK_LINE_CANVAS_PARKING_LAYER_ID,
};
