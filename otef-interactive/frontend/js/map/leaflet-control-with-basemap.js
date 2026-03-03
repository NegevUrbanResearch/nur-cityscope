/**
 * Leaflet-specific layer loaders for the GIS map.
 * Uses LayerRegistry and StyleApplicator only. Legacy road layers removed.
 *
 * Depends on:
 * - map, layerState, modelOverlay (from map-initialization.js)
 * - CoordUtils.transformGeojsonToWgs84 (from coordinate-utils.js)
 * - layerRegistry (from layer-registry.js)
 * - StyleApplicator (from style-applicator.js)
 */

// Store loaded layers by full layer ID (e.g., "map_3_future.mimushim")
const loadedLayersMap = new Map();
const pendingLayerLoads = new Map();
const missingLayerConfigs = new Set();

let pinkLineBaseLayerInstance = null;
const CURATED_LAYER_PALETTE = ["#00b4d8", "#2dc653", "#e9c46a", "#e76f51", "#9b59b6", "#1dd3b0"];
function getCuratedLayerColor(fullLayerId) {
  let h = 0;
  for (let i = 0; i < fullLayerId.length; i++) h = (h << 5) - h + fullLayerId.charCodeAt(i);
  const idx = Math.abs(h) % CURATED_LAYER_PALETTE.length;
  return CURATED_LAYER_PALETTE[idx];
}

function formatNodeTooltip(properties) {
  const p = properties || {};
  const name = p.name || p.reason || p.description || "";
  if (!name) return "Node";
  return String(name).trim().slice(0, 80);
}

function formatNodePopup(properties) {
  const p = properties || {};
  const parts = [];
  ["name", "reason", "description", "note"].forEach((k) => {
    const v = p[k];
    if (v != null && String(v).trim() !== "") {
      let label = k;
      if (k === "name") label = "שם";
      else if (k === "description") label = "תיאור";
      parts.push(
        `<div class="popup-field"><span class="popup-label">${escapeHtml(label)}:</span> <span class="popup-value">${escapeHtml(String(v))}</span></div>`
      );
    }
  });
  if (parts.length === 0) return "<div class=\"popup-content\">—</div>";
  return '<div class="popup-content">' + parts.join("") + "</div>";
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// Store PMTiles layers with their configs for feature picking (global for map click handler)
window.pmtilesLayersWithConfigs = window.pmtilesLayersWithConfigs || new Map();
const pmtilesLayersWithConfigs = window.pmtilesLayersWithConfigs;

/**
 * Helper: register a loaded layer with both internal map and window debug handle.
 * @param {string} fullLayerId
 * @param {Object} layerInstance
 */
function registerLoadedLayer(fullLayerId, layerInstance) {
  if (!fullLayerId || !layerInstance) return;
  const existing = loadedLayersMap.get(fullLayerId);
  if (
    existing &&
    existing !== layerInstance &&
    typeof map !== "undefined" &&
    map &&
    typeof map.hasLayer === "function" &&
    typeof map.removeLayer === "function" &&
    map.hasLayer(existing)
  ) {
    map.removeLayer(existing);
  }
  const key = `layer_${fullLayerId.replace(/\./g, "_")}`;
  window[key] = layerInstance;
  loadedLayersMap.set(fullLayerId, layerInstance);
}

/**
 * Helper: get a loaded layer instance by id.
 * @param {string} fullLayerId
 * @returns {Object|null}
 */
function getLoadedLayer(fullLayerId) {
  return loadedLayersMap.get(fullLayerId) || null;
}

/**
 * Helper: register a PMTiles layer for popup handling.
 * Keeps the public window.pmtilesLayersWithConfigs API intact.
 * @param {string} fullLayerId
 * @param {Object} layerInstance
 * @param {Object} layerConfig
 * @param {Object} popupConfig
 */
function registerPmtilesPopupLayer(
  fullLayerId,
  layerInstance,
  layerConfig,
  popupConfig,
) {
  if (!fullLayerId || !layerInstance || !popupConfig) return;
  if (!window.pmtilesLayersWithConfigs) {
    window.pmtilesLayersWithConfigs = new Map();
  }
  window.pmtilesLayersWithConfigs.set(fullLayerId, {
    layer: layerInstance,
    config: layerConfig,
    popupConfig,
  });
}

/**
 * Load all layers from the layer registry (layer groups only).
 */
async function loadGeoJSONLayers() {
  if (typeof layerRegistry === "undefined") return;
  try {
    await layerRegistry.init();
    if (layerRegistry._initialized) {
      await loadLayerGroups();
    }
    updateMapLegend();
  } catch (error) {
    console.error("[Map] Critical error during layer loading:", error);
  }
}

/**
 * Load all layers from the new layer groups system.
 */
async function loadLayerGroups() {
  if (!layerRegistry || !layerRegistry._initialized) {
    console.warn("[Map] Layer registry not initialized");
    return;
  }

  const groups = layerRegistry.getGroups();

  // Load all layers from all groups (GIS-visible only; see gis-layer-filter.js)
  const loadPromises = [];
  for (const group of groups) {
    for (const layer of group.layers || []) {
      if (
        typeof shouldShowLayerOnGisMap === "function" &&
        !shouldShowLayerOnGisMap(group.id, layer.id)
      ) {
        continue;
      }
      const fullLayerId = `${group.id}.${layer.id}`;
      loadPromises.push(loadLayerFromRegistry(fullLayerId));
    }
  }

  await Promise.all(loadPromises);
}

/**
 * Extract Point features (with properties) and [lat, lng] coords for route building.
 */
function extractPointFeaturesFromGeojson(geojson) {
  const list = [];
  if (!geojson || !geojson.features) return list;
  for (const f of geojson.features) {
    const geom = f.geometry;
    if (!geom || geom.type !== "Point" || !geom.coordinates) continue;
    const c = geom.coordinates;
    list.push({ feature: f, latlng: [c[1], c[0]] });
  }
  return list;
}

async function ensurePinkLineBaseLayer() {
  if (pinkLineBaseLayerInstance && map.hasLayer(pinkLineBaseLayerInstance)) return;
  try {
    const pinkRes = await fetch("/api/pink-line/");
    if (!pinkRes.ok) return;
    const pinkGeojson = await pinkRes.json();
    if (typeof parseDefaultLinePaths !== "function") return;
    const basePaths = parseDefaultLinePaths(pinkGeojson);
    if (basePaths.length === 0) return;
    const group = L.layerGroup();
    const baseStyle = { color: "#ff69b4", weight: 5, opacity: 1 };
    basePaths.forEach((path) => {
      group.addLayer(L.polyline(path, baseStyle));
    });
    group.addTo(map);
    pinkLineBaseLayerInstance = group;
  } catch (_) {}
}

/**
 * Load a curated layer. Each layer is one independent suggestion: base pink line (shared, distinct style)
 * plus this layer's route in its own color. Nodes show name/metadata on hover (tooltip) and click (popup). No numbering.
 */
async function loadCuratedLayerFromAPI(fullLayerId) {
  if (loadedLayersMap.has(fullLayerId)) return;
  const parts = fullLayerId.split(".");
  if (!parts[0].startsWith("curated") || parts.length < 2) return;
  const layerId = parts.slice(1).join(".");

  let response;
  try {
    response = await fetch("/api/actions/get_otef_layers/?table=otef");
    if (!response.ok) throw new Error(response.status);
  } catch (e) {
    console.warn("[Map] Failed to fetch OTEF layers for curated:", e);
    return;
  }

  const list = await response.json();
  const layerData = Array.isArray(list)
    ? list.find((l) => String(l.id) === String(layerId))
    : null;
  if (!layerData || layerData.layer_type !== "geojson") return;

  let geojson = layerData.geojson;
  if (!geojson && layerData.url) {
    const r = await fetch(layerData.url);
    if (!r.ok) throw new Error(r.status);
    geojson = await r.json();
  }
  if (!geojson || !geojson.features) return;

  const crs = geojson.crs?.properties?.name || "";
  if (crs.includes("2039") || crs.includes("ITM")) {
    geojson = CoordUtils.transformGeojsonToWgs84(geojson);
  }

  const pointItems = extractPointFeaturesFromGeojson(geojson);
  const userPoints = pointItems.map((x) => x.latlng);
  let pinkGeojson = null;
  try {
    const pinkRes = await fetch("/api/pink-line/");
    if (pinkRes.ok) pinkGeojson = await pinkRes.json();
  } catch (_) {}

  const hasRouteUtils =
    typeof parseDefaultLinePaths === "function" &&
    typeof buildIntegratedRoute === "function";
  const basePaths = pinkGeojson && hasRouteUtils ? parseDefaultLinePaths(pinkGeojson) : [];
  const usePinkLineProjection =
    basePaths.length > 0 && (userPoints.length > 0 || geojson.features.some((f) => f.geometry && (f.geometry.type === "LineString" || f.geometry.type === "MultiLineString")));

  if (usePinkLineProjection && userPoints.length > 0) {
    await ensurePinkLineBaseLayer();
    const { dashed } = buildIntegratedRoute(basePaths, userPoints);
    const layerColor = getCuratedLayerColor(fullLayerId);
    const group = L.layerGroup();
    const dashedStyle = { color: layerColor, weight: 5, opacity: 0.9, dashArray: "10, 10" };
    dashed.forEach((pts) => {
      group.addLayer(L.polyline(pts, dashedStyle));
    });
    pointItems.forEach(({ feature, latlng }) => {
      const marker = L.marker(latlng, {
        icon: L.divIcon({
          className: "pink-line-node-marker",
          html: `<div class="pink-line-node" style="background:${layerColor}"></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        }),
      });
      const tip = formatNodeTooltip(feature.properties);
      const popupContent = formatNodePopup(feature.properties);
      marker.bindTooltip(tip, { permanent: false, direction: "top", className: "curated-node-tooltip" });
      marker.bindPopup(popupContent, { className: "curated-node-popup" });
      group.addLayer(marker);
    });
    group.addTo(map);
    registerLoadedLayer(fullLayerId, group);
    return;
  }

  if (usePinkLineProjection && basePaths.length > 0 && userPoints.length === 0) {
    await ensurePinkLineBaseLayer();
    const layerColor = getCuratedLayerColor(fullLayerId);
    const group = L.layerGroup();
    const lineFeatures = geojson.features.filter(
      (f) => f.geometry && (f.geometry.type === "LineString" || f.geometry.type === "MultiLineString")
    );
    if (lineFeatures.length > 0) {
      lineFeatures.forEach((f) => {
        const coords = f.geometry.type === "LineString"
          ? f.geometry.coordinates.map((c) => [c[1], c[0]])
          : f.geometry.coordinates.flatMap((line) => line.map((c) => [c[1], c[0]]));
        if (coords.length >= 2) {
          group.addLayer(L.polyline(coords, { color: layerColor, weight: 4, opacity: 0.9, dashArray: "10, 10" }));
        }
      });
    }
    group.addTo(map);
    registerLoadedLayer(fullLayerId, group);
    return;
  }

  const layerConfig = {
    style: {
      type: "simple",
      defaultStyle: {
        fillColor: "#00d4ff",
        fillOpacity: 0.4,
        strokeColor: "#00a8cc",
        strokeWidth: 2,
      },
    },
  };
  const leafletLayer =
    typeof LayerFactory !== "undefined"
      ? LayerFactory.createGeoJsonLayer({
          fullLayerId,
          layerConfig,
          geojson,
          map,
        })
      : null;
  if (!leafletLayer) return;
  leafletLayer.addTo(map);
  registerLoadedLayer(fullLayerId, leafletLayer);
}

/**
 * Load a single layer from the layer registry.
 * @param {string} fullLayerId - Full layer ID (e.g., "map_3_future.mimushim")
 */
async function loadLayerFromRegistry(fullLayerId) {
  if (pendingLayerLoads.has(fullLayerId)) {
    return pendingLayerLoads.get(fullLayerId);
  }

  const loadPromise = (async () => {
  if (loadedLayersMap.has(fullLayerId)) {
    // Skip already loaded layers silently
    return;
  }

  if (!layerRegistry || !layerRegistry._initialized) {
    if (fullLayerId.startsWith("curated")) {
      await loadCuratedLayerFromAPI(fullLayerId);
    }
    return;
  }

  const layerConfig = layerRegistry.getLayerConfig(fullLayerId);
  if (!layerConfig) {
    if (fullLayerId.startsWith("curated")) {
      await loadCuratedLayerFromAPI(fullLayerId);
      return;
    }
    if (!missingLayerConfigs.has(fullLayerId)) {
      missingLayerConfigs.add(fullLayerId);
      console.warn(`[Map] Layer config not found: ${fullLayerId}`);
    }
    return;
  }

  try {
    // Prefer PMTiles for GIS if available, fallback to GeoJSON
    const pmtilesUrl = layerRegistry.getLayerPMTilesUrl(fullLayerId);
    const geojsonUrl = layerRegistry.getLayerDataUrl(fullLayerId);

    if (pmtilesUrl) {
      // Use PMTiles for better performance in GIS
      await loadPMTilesLayer(fullLayerId, layerConfig, pmtilesUrl);
    } else if (geojsonUrl) {
      await loadGeoJSONLayer(fullLayerId, layerConfig, geojsonUrl);
    } else {
      console.warn(`[Map] No data URL for layer: ${fullLayerId}`);
      return;
    }

    // Layer is stored in loadedLayersMap by loadPMTilesLayer or loadGeoJSONLayer
    // Don't set it to true here - wait for the actual layer object
  } catch (error) {
    console.error(`[Map] Error loading layer ${fullLayerId}:`, error);
  }
  })();

  pendingLayerLoads.set(fullLayerId, loadPromise);
  try {
    await loadPromise;
  } finally {
    pendingLayerLoads.delete(fullLayerId);
  }
}

/**
 * Load a GeoJSON layer from the registry.
 */
async function loadGeoJSONLayer(fullLayerId, layerConfig, dataUrl) {
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

    // Store layer reference
    registerLoadedLayer(fullLayerId, leafletLayer);

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
            ? convertScaleToZoom(scaleRange.minScale)
            : null;
        const maxZ =
          scaleRange && scaleRange.maxScale
            ? convertScaleToZoom(scaleRange.maxScale)
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

/**
 * Load a PMTiles layer from the registry.
 */
async function loadPMTilesLayer(fullLayerId, layerConfig, dataUrl) {
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
    if (popupConfig) {
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
    registerLoadedLayer(fullLayerId, pmtilesLayer);

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

/**
 * Update layer visibility for a layer from the registry.
 * @param {string} fullLayerId - Full layer ID
 * @param {boolean} visible - Whether layer should be visible
 */
function updateLayerVisibilityFromRegistry(fullLayerId, visible) {
  const layer = getLoadedLayer(fullLayerId);
  if (!layer) {
    // Layer may not be loaded yet - this is normal during initial load
    return;
  }

  if (visible) {
    if (!map.hasLayer(layer)) {
      // Check scale/zoom constraints before adding
      if (!layer.options) layer.options = {}; // Ensure options exist

      // We need access to the config to check scaleRange.
      // The layer object itself doesn't easily expose the original config unless we stored it.
      // But we can check if the layer has zIndex of 1000 (which we set for scaled layers)
      // or try to find it in loaded configs.

      // Better approach: Re-evaluate the scale check logic here.
      // We stored the layer in loadedLayersMap. Check if we can get the config.
      // NOTE: loadedLayersMap only stores the Leaflet layer instance.

      // Let's retrieve the config from the registry again to be safe.
      let inRange = true;
      if (typeof layerRegistry !== "undefined") {
        const config = layerRegistry.getLayerConfig(fullLayerId);
        if (config && config.style && config.style.scaleRange) {
          const currentZoom = map.getZoom();
          const convertScaleToZoom = (scale) => {
            if (!scale) return null;
            if (
              typeof VisibilityUtils !== "undefined" &&
              typeof VisibilityUtils.scaleToZoom === "function"
            ) {
              return VisibilityUtils.scaleToZoom(scale);
            }
            return Math.log2(591657550 / scale);
          };

          const minZ = convertScaleToZoom(config.style.scaleRange.minScale);
          const maxZ = convertScaleToZoom(config.style.scaleRange.maxScale);

          if (minZ !== null && currentZoom < minZ) inRange = false;
          if (maxZ !== null && currentZoom > maxZ) inRange = false;

          if (
            !inRange &&
            typeof MapProjectionConfig !== "undefined" &&
            MapProjectionConfig.ENABLE_MAP_VISIBILITY_DEBUG
          ) {
            console.log(
              `[Map] Skipping addLayer for ${fullLayerId} (Zoom ${currentZoom.toFixed(
                1,
              )} out of range [${minZ?.toFixed(1) || "-"}, ${
                maxZ?.toFixed(1) || "-"
              }])`,
            );
          }
        }
      }

      if (inRange) {
        map.addLayer(layer);
      }
    }
  } else {
    if (map.hasLayer(layer)) {
      map.removeLayer(layer);
    }
  }
}

/**
 * Expose loader API for map bootstrap. map-initialization builds mapDeps from this
 * so layer-state-manager can receive explicit deps instead of relying on globals.
 * @returns {{ loadLayerFromRegistry: function, updateLayerVisibilityFromRegistry: function, loadedLayersMap: Map }}
 */
if (typeof window !== "undefined") {
  window.getMapLayerLoaderAPI = function getMapLayerLoaderAPI() {
    return {
      loadLayerFromRegistry,
      updateLayerVisibilityFromRegistry,
      loadedLayersMap,
    };
  };
}
