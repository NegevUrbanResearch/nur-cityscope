/**
 * Map GeoJSON layer loader.
 *
 * Extracted from leaflet-control-with-basemap.js so that the main file can act
 * as a thin orchestrator. This module is still Leaflet/OTEF-specific and
 * relies on the same globals (map, CoordUtils, LayerFactory, VisibilityUtils,
 * VisibilityController, LayerStateHelper, MapProjectionConfig).
 */

/**
 * Load a GeoJSON layer from the registry.
 *
 * @param {string} fullLayerId
 * @param {Object} layerConfig
 * @param {string} dataUrl
 * @param {Function} registerLoadedLayer - callback to register the created Leaflet layer
 */
async function loadGeoJSONLayer(fullLayerId, layerConfig, dataUrl, registerLoadedLayer) {
  try {
    const response = await fetch(dataUrl);
    if (!response.ok) {
      throw new Error(`Failed to load layer data: ${response.status}`);
    }

    let geojson = await response.json();

    // Check CRS and transform to WGS84 if needed
    // Processed layers should already be in WGS84, but handle edge cases
    const crs = geojson.crs?.properties?.name || "";
    if (crs.includes("2039") || crs.includes("ITM")) {
      // Transform from EPSG:2039 (ITM) to WGS84
      geojson = CoordUtils.transformGeojsonToWgs84(geojson);
    } else if (crs.includes("3857") || crs.includes("Web Mercator")) {
      // Transform from EPSG:3857 (Web Mercator) to WGS84
      geojson = CoordUtils.transformGeojsonFrom3857ToWgs84(geojson);
    }
    // If already WGS84 or no CRS (assume WGS84), no transformation needed

    // Create Leaflet layer (style + popups) via LayerFactory
    const leafletLayer =
      typeof LayerFactory !== "undefined"
        ? LayerFactory.createGeoJsonLayer({
            fullLayerId,
            layerConfig,
            geojson,
            map,
          })
        : null;

    if (!leafletLayer) {
      console.warn(`[Map] Failed to create GeoJSON layer for ${fullLayerId}`);
      return;
    }

    // Apply minScale/maxScale visibility based on zoom level
    const scaleRange = layerConfig.style?.scaleRange;
    if (scaleRange) {
      const minScale = scaleRange.minScale;
      const maxScale = scaleRange.maxScale;

      // Prefer shared visibility-utils conversion when available
      const convertScaleToZoom = (scale) => {
        if (!scale) return null;
        if (
          typeof VisibilityUtils !== "undefined" &&
          typeof VisibilityUtils.scaleToZoom === "function"
        ) {
          return VisibilityUtils.scaleToZoom(scale);
        }
        // Fallback to legacy inline formula (kept for safety)
        return Math.log2(591657550 / scale);
      };

      const minZoom = convertScaleToZoom(minScale);
      const maxZoom = convertScaleToZoom(maxScale);

      if (
        typeof MapProjectionConfig !== "undefined" &&
        MapProjectionConfig.ENABLE_MAP_VISIBILITY_DEBUG
      ) {
        console.log(
          `[Map] Scale range for ${fullLayerId}: scale[${minScale || "-"}, ${
            maxScale || "-"
          }] -> zoom[${minZoom?.toFixed(1) || "-"}, ${
            maxZoom?.toFixed(1) || "-"
          }]`,
        );
      }

      try {
        if (leafletLayer.setZIndex) leafletLayer.setZIndex(1000);
      } catch (e) {}

      // Also handle visibility on zoom change using visibility controller
      const updateLayerVisibility = () => {
        const currentZoom = map.getZoom();

        if (
          typeof VisibilityController !== "undefined" &&
          typeof LayerStateHelper !== "undefined"
        ) {
          const allowed = VisibilityController.shouldLayerBeVisible({
            fullLayerId,
            scaleRange,
            zoom: currentZoom,
            layerStateHelper: LayerStateHelper,
          });

          if (!allowed) {
            if (map.hasLayer(leafletLayer)) {
              console.log(
                `[Map] Hiding ${fullLayerId} at zoom ${currentZoom.toFixed(
                  1,
                )} (range ${minZoom?.toFixed(1) || "-"} to ${
                  maxZoom?.toFixed(1) || "-"
                })`,
              );
              map.removeLayer(leafletLayer);
            }
          } else if (!map.hasLayer(leafletLayer)) {
            console.log(
              `[Map] Showing ${fullLayerId} at zoom ${currentZoom.toFixed(1)}`,
            );
            map.addLayer(leafletLayer);
          }
        }
      };

      map.on("zoomend", updateLayerVisibility);
      updateLayerVisibility(); // Initial check
    } else {
      // No scale restrictions - use normal visibility logic
      if (typeof LayerStateHelper !== "undefined") {
        const state = LayerStateHelper.getLayerState(fullLayerId);
        if (state && state.enabled) {
          map.addLayer(leafletLayer);
        }
      }
    }

    // Store layer reference via callback
    if (typeof registerLoadedLayer === "function") {
      registerLoadedLayer(fullLayerId, leafletLayer);
    }

    // Initial addition to map if enabled and in range
    if (
      typeof VisibilityController !== "undefined" &&
      typeof LayerStateHelper !== "undefined"
    ) {
      const currentZoom = map.getZoom();
      const allowed = VisibilityController.shouldLayerBeVisible({
        fullLayerId,
        scaleRange,
        zoom: currentZoom,
        layerStateHelper: LayerStateHelper,
      });

      if (
        typeof MapProjectionConfig !== "undefined" &&
        MapProjectionConfig.ENABLE_MAP_VISIBILITY_DEBUG
      ) {
        const minZ =
          scaleRange && scaleRange.minScale
            ? Math.log2(591657550 / scaleRange.minScale)
            : null;
        const maxZ =
          scaleRange && scaleRange.maxScale
            ? Math.log2(591657550 / scaleRange.maxScale)
            : null;
        console.log(
          `[Map] Visibility Check ${fullLayerId}: Zoom=${currentZoom.toFixed(
            2,
          )}, Range=[${minZ?.toFixed(2) || "-"}, ${
            maxZ?.toFixed(2) || "-"
          }], Visible=${allowed}`,
        );
      }

      if (allowed) {
        map.addLayer(leafletLayer);
      }
    }
  } catch (error) {
    console.error(`[Map] Error loading GeoJSON layer ${fullLayerId}:`, error);
    throw error;
  }
}

export { loadGeoJSONLayer };

