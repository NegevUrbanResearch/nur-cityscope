/**
 * Map PMTiles layer loader.
 *
 * Extracted from leaflet-control-with-basemap.js so that the main file can act
 * as a thin orchestrator. This module still relies on Leaflet/OTEF globals for
 * map and visibility helpers.
 */

/**
 * Load a PMTiles layer from the registry.
 *
 * @param {string} fullLayerId
 * @param {Object} layerConfig
 * @param {string} dataUrl
 * @param {{ registerLoadedLayer: Function, registerPmtilesPopupLayer: Function }} deps
 */
async function loadPMTilesLayer(fullLayerId, layerConfig, dataUrl, deps) {
  const { registerLoadedLayer, registerPmtilesPopupLayer } = deps || {};
  try {
    // Create vector tile layer from PMTiles file with custom pane for z-ordering
    const pmtilesLayer =
      typeof LayerFactory !== "undefined"
        ? LayerFactory.createPmtilesLayer({
            fullLayerId,
            layerConfig,
            dataUrl,
          })
        : null;

    if (!pmtilesLayer) {
      console.warn(`[Map] Failed to create PMTiles layer for ${fullLayerId}`);
      return;
    }

    // Apply scale ranges if present
    const scaleRange = layerConfig.style?.scaleRange;
    if (scaleRange) {
      const getZoomFromScale = (scale) =>
        scale ? Math.log2(591657550 / scale) : null;
      const minZoom = getZoomFromScale(scaleRange.minScale);
      const maxZoom = getZoomFromScale(scaleRange.maxScale);

      const updatePmtilesVisibility = () => {
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
            if (map.hasLayer(pmtilesLayer)) map.removeLayer(pmtilesLayer);
          } else if (!map.hasLayer(pmtilesLayer)) {
            map.addLayer(pmtilesLayer);
          }
        }
      };

      map.on("zoomend", updatePmtilesVisibility);
      // Initial check will be handled by the context listener or below
    }

    // Register with global map click handler for popups if config exists
    const popupConfig = layerConfig.ui?.popup;
    if (popupConfig && typeof registerPmtilesPopupLayer === "function") {
      if (typeof window !== "undefined" && window.DEBUG_PMTILES_POPUPS) {
        console.log(`[Map] Registering PMTiles layer ${fullLayerId} for popups`);
      }
      registerPmtilesPopupLayer(
        fullLayerId,
        pmtilesLayer,
        layerConfig,
        popupConfig,
      );
    }

    // Store layer reference
    if (typeof registerLoadedLayer === "function") {
      registerLoadedLayer(fullLayerId, pmtilesLayer);
    }

    // Initial addition to map if enabled (and in range)
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

      if (allowed) {
        map.addLayer(pmtilesLayer);
      }
    }
  } catch (error) {
    console.error(`[Map] Error loading PMTiles layer ${fullLayerId}:`, error);
  }
}

export { loadPMTilesLayer };

