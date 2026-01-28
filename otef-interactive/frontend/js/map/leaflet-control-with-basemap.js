console.log(`[Map] Initializing leaflet-control-with-basemap.js (v1.2-fixed-scale-rendering)`);

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
const missingLayerConfigs = new Set();

// Store PMTiles layers with their configs for feature picking (global for map click handler)
window.pmtilesLayersWithConfigs = window.pmtilesLayersWithConfigs || new Map();
const pmtilesLayersWithConfigs = window.pmtilesLayersWithConfigs;

/**
 * Load all layers from the layer registry (layer groups only).
 */
async function loadGeoJSONLayers() {
  if (typeof layerRegistry === 'undefined') return;
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

  // Load all layers from all groups, excluding projector_base (projector-only layers)
  const loadPromises = [];
  for (const group of groups) {
    // Skip projector_base group - these are projector-only layers
    if (group.id === 'projector_base') {
      continue;
    }
    for (const layer of group.layers || []) {
      const fullLayerId = `${group.id}.${layer.id}`;
      loadPromises.push(loadLayerFromRegistry(fullLayerId));
    }
  }

  await Promise.all(loadPromises);
}

/**
 * Load a single layer from the layer registry.
 * @param {string} fullLayerId - Full layer ID (e.g., "map_3_future.mimushim")
 */
async function loadLayerFromRegistry(fullLayerId) {
  if (loadedLayersMap.has(fullLayerId)) {
    // Skip already loaded layers silently
    return;
  }

  if (!layerRegistry || !layerRegistry._initialized) {
    return;
  }

  const layerConfig = layerRegistry.getLayerConfig(fullLayerId);
  if (!layerConfig) {
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

    console.log(`[Map] Loading layer ${fullLayerId}: pmtiles=${pmtilesUrl}, geojson=${geojsonUrl}`);

    if (pmtilesUrl) {
      // Use PMTiles for better performance in GIS
      console.log(`[Map] Using PMTiles for ${fullLayerId}`);
      await loadPMTilesLayer(fullLayerId, layerConfig, pmtilesUrl);
    } else if (geojsonUrl) {
      // Fallback to GeoJSON
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
    const crs = geojson.crs?.properties?.name || '';
    if (crs.includes('2039') || crs.includes('ITM')) {
      // Transform from EPSG:2039 (ITM) to WGS84
      geojson = CoordUtils.transformGeojsonToWgs84(geojson);
    } else if (crs.includes('3857') || crs.includes('Web Mercator')) {
      // Transform from EPSG:3857 (Web Mercator) to WGS84
      geojson = CoordUtils.transformGeojsonFrom3857ToWgs84(geojson);
    }
    // If already WGS84 or no CRS (assume WGS84), no transformation needed

    // Get style function from StyleApplicator
    const styleFunction = StyleApplicator.getLeafletStyle(layerConfig);

    // Get popup config if available
    const popupConfig = layerConfig.ui?.popup;

    // Get layer name for popup display
    const layerDisplayName = layerConfig.name || fullLayerId.split('.').pop();

    // Create Leaflet layer with custom pane for proper z-ordering above basemaps
    let leafletLayer;
    if (layerConfig.geometryType === 'point') {
      // Use style function for EACH point feature
      leafletLayer = L.geoJSON(geojson, {
        pane: 'vectorOverlay',
        pointToLayer: (feature, latlng) => {
          const style = styleFunction(feature);
          return L.circleMarker(latlng, {
            ...style,
            radius: (style.radius || 5),
            color: style.strokeColor || style.color || '#000000',
            weight: (style.strokeWidth || style.weight || 1),
            fillColor: style.fillColor || '#808080',
            fillOpacity: style.fillOpacity !== undefined ? style.fillOpacity : 0.7,
            pane: 'vectorOverlay'
          });
        },
        onEachFeature: (feature, layer) => {
          // Attach click handler ...
          if (popupConfig && typeof renderPopupContent === 'function') {
            layer.on('click', (e) => {
              const content = renderPopupContent(feature, popupConfig, layerDisplayName);
              L.popup()
                .setLatLng(e.latlng)
                .setContent(content)
                .openOn(map);
            });
          }
        }
      });
    } else {
      // Use style function for polygons and lines
      leafletLayer = L.geoJSON(geojson, {
        pane: 'vectorOverlay',
        style: styleFunction,
        onEachFeature: (feature, layer) => {
          // Attach click handler ...
          if (popupConfig && typeof renderPopupContent === 'function') {
            layer.on('click', (e) => {
              const content = renderPopupContent(feature, popupConfig, layerDisplayName);
              L.popup()
                .setLatLng(e.latlng)
                .setContent(content)
                .openOn(map);
            });
          }
        }
      });
    }

    // Apply minScale/maxScale visibility based on zoom level
    const scaleRange = layerConfig.style?.scaleRange;
    if (scaleRange) {
      const minScale = scaleRange.minScale;
      const maxScale = scaleRange.maxScale;

      // Convert scale to zoom level (approximate: scale = 591657550 / (2^zoom))
      // So zoom = log2(591657550 / scale)
      const getZoomFromScale = (scale) => {
        if (!scale) return null;
        return Math.log2(591657550 / scale);
      };

      const minZoom = minScale ? getZoomFromScale(minScale) : null;
      const maxZoom = maxScale ? getZoomFromScale(maxScale) : null;

      console.log(`[Map] Scale range for ${fullLayerId}: scale[${minScale||'-'}, ${maxScale||'-'}] -> zoom[${minZoom?.toFixed(1)||'-'}, ${maxZoom?.toFixed(1)||'-'}]`);

      try {
        if (leafletLayer.setZIndex) leafletLayer.setZIndex(1000);
      } catch (e) { }

      // Also handle visibility on zoom change
      const updateLayerVisibility = () => {
        const currentZoom = map.getZoom();
        let inRange = true;

        if (minZoom !== null && currentZoom < minZoom) inRange = false;
        if (maxZoom !== null && currentZoom > maxZoom) inRange = false;

        if (!inRange) {
          if (map.hasLayer(leafletLayer)) {
            console.log(`[Map] Hiding ${fullLayerId} at zoom ${currentZoom.toFixed(1)} (range ${minZoom?.toFixed(1)||'-'} to ${maxZoom?.toFixed(1)||'-'})`);
            map.removeLayer(leafletLayer);
          }
        } else {
          // Check if layer should be enabled based on store
          if (typeof OTEFDataContext !== 'undefined') {
            const layerGroups = OTEFDataContext.getLayerGroups();
            if (layerGroups) {
              const [groupId, layerId] = fullLayerId.split('.');
              const group = layerGroups.find(g => g.id === groupId);
              if (group) {
                const layerStateObj = group.layers.find(l => l.id === layerId);
                if (layerStateObj && layerStateObj.enabled) {
                  if (!map.hasLayer(leafletLayer)) {
                    console.log(`[Map] Showing ${fullLayerId} at zoom ${currentZoom.toFixed(1)}`);
                    map.addLayer(leafletLayer);
                  }
                }
              }
            }
          }
        }
      };

      map.on('zoomend', updateLayerVisibility);
      updateLayerVisibility(); // Initial check
    } else {
      // No scale restrictions - use normal visibility logic
      if (typeof OTEFDataContext !== 'undefined') {
        const layerGroups = OTEFDataContext.getLayerGroups();
        if (layerGroups) {
          const [groupId, layerId] = fullLayerId.split('.');
          const group = layerGroups.find(g => g.id === groupId);
          if (group) {
            const layerStateObj = group.layers.find(l => l.id === layerId);
            if (layerStateObj && layerStateObj.enabled) {
              map.addLayer(leafletLayer);
            }
          }
        }
      }
    }

    // Store layer reference
    window[`layer_${fullLayerId.replace(/\./g, '_')}`] = leafletLayer;
    loadedLayersMap.set(fullLayerId, leafletLayer);

    // Initial addition to map if enabled
    if (typeof OTEFDataContext !== 'undefined') {
      const layerGroups = OTEFDataContext.getLayerGroups();
      if (layerGroups) {
        const [groupId, layerId] = fullLayerId.split('.');
        const group = layerGroups.find(g => g.id === groupId);
        if (group) {
          const layerStateObj = group.layers.find(l => l.id === layerId);
          if (layerStateObj && layerStateObj.enabled) {
             // Respect scale range if it exists
             const currentZoom = map.getZoom();
             const getZoomFromScale = (scale) => scale ? Math.log2(591657550 / scale) : null;
             const minZ = scaleRange ? getZoomFromScale(scaleRange.minScale) : null;
             const maxZ = scaleRange ? getZoomFromScale(scaleRange.maxScale) : null;

             let inRange = true;
             if (minZ !== null && currentZoom < minZ) inRange = false;
             if (maxZ !== null && currentZoom > maxZ) inRange = false;

             if (inRange) {
                map.addLayer(leafletLayer);
             }
          }
        }
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

    // Get style function from StyleApplicator
    const styleFunction = StyleApplicator.getLeafletStyle(layerConfig);

    // Get data layer name - usually "layer" for our processed files, but fallback to filename stem
    const dataLayerName = "layer";

    // Create paint rules for protomaps-leaflet
    const paintRules = [];
    if (layerConfig.geometryType === 'polygon') {
      paintRules.push({
        dataLayer: dataLayerName,
        symbolizer: new protomapsL.PolygonSymbolizer({
          fill: (zoom, feature) => {
            const style = styleFunction(feature);
            return style.fillColor || '#808080';
          },
          stroke: (zoom, feature) => {
            const style = styleFunction(feature);
            return style.color || '#000000';
          },
          width: (zoom, feature) => {
            const style = styleFunction(feature);
            return style.weight || 1.0;
          },
          opacity: (zoom, feature) => {
            const style = styleFunction(feature);
            return style.fillOpacity !== undefined ? style.fillOpacity : 0.7;
          }
        })
      });
      // Add a fallback rule for when dataLayer is not "layer"
      paintRules.push({
        dataLayer: "*",
        symbolizer: new protomapsL.PolygonSymbolizer({
          fill: (zoom, feature) => {
            const style = styleFunction(feature);
            return style.fillColor || '#808080';
          },
          stroke: (zoom, feature) => {
            const style = styleFunction(feature);
            return style.color || '#000000';
          },
          width: (zoom, feature) => {
            const style = styleFunction(feature);
            return style.weight || 1.0;
          },
          opacity: (zoom, feature) => {
            const style = styleFunction(feature);
            return style.fillOpacity !== undefined ? style.fillOpacity : 0.7;
          }
        })
      });
    } else if (layerConfig.geometryType === 'line') {
      paintRules.push({
        dataLayer: dataLayerName,
        symbolizer: new protomapsL.LineSymbolizer({
          stroke: (zoom, feature) => {
            const style = styleFunction(feature);
            return style.color || '#000000';
          },
          width: (zoom, feature) => {
            const style = styleFunction(feature);
            return style.weight || 1.0;
          },
          opacity: (zoom, feature) => {
            const style = styleFunction(feature);
            return style.opacity !== undefined ? style.opacity : 1.0;
          }
        })
      });
      paintRules.push({
        dataLayer: "*",
        symbolizer: new protomapsL.LineSymbolizer({
          stroke: (zoom, feature) => {
            const style = styleFunction(feature);
            if (fullLayerId.includes('שבילי_אופניים')) {
              console.log(`[PMTiles Style] ${fullLayerId} color:`, style.color, 'style:', style);
            }
            return style.color || '#000000';
          },
          width: (zoom, feature) => {
            const style = styleFunction(feature);
            return style.weight || 1.0;
          },
          opacity: (zoom, feature) => {
            const style = styleFunction(feature);
            return style.opacity !== undefined ? style.opacity : 1.0;
          }
        })
      });
    }

    // Create vector tile layer from PMTiles file with custom pane for z-ordering
    const pmtilesLayer = protomapsL.leafletLayer({
      url: dataUrl,
      paintRules: paintRules,
      labelRules: [],
      minZoom: 9,
      minDataZoom: 9,
      maxDataZoom: 18,
      attribution: layerConfig.name || fullLayerId,
      pane: 'vectorOverlay',  // Ensure layer renders above basemaps
    });

    // Apply scale ranges if present
    const scaleRange = layerConfig.style?.scaleRange;
    if (scaleRange) {
      const getZoomFromScale = (scale) => scale ? Math.log2(591657550 / scale) : null;
      const minZoom = getZoomFromScale(scaleRange.minScale);
      const maxZoom = getZoomFromScale(scaleRange.maxScale);

      const updatePmtilesVisibility = () => {
        const currentZoom = map.getZoom();
        let inRange = true;
        if (minZoom !== null && currentZoom < minZoom) inRange = false;
        if (maxZoom !== null && currentZoom > maxZoom) inRange = false;

        if (!inRange) {
          if (map.hasLayer(pmtilesLayer)) map.removeLayer(pmtilesLayer);
        } else {
          // Normal logic for enabled check
          if (typeof OTEFDataContext !== 'undefined') {
            const layerGroups = OTEFDataContext.getLayerGroups();
            if (layerGroups) {
              const [groupId, layerId] = fullLayerId.split('.');
              const group = layerGroups.find(g => g.id === groupId);
              if (group) {
                const layerStateObj = group.layers.find(l => l.id === layerId);
                if (layerStateObj && layerStateObj.enabled) {
                  if (!map.hasLayer(pmtilesLayer)) map.addLayer(pmtilesLayer);
                }
              }
            }
          }
        }
      };

      map.on('zoomend', updatePmtilesVisibility);
      // Initial check will be handled by the context listener or below
    }

    // Store layer reference
    window[`layer_${fullLayerId.replace(/\./g, '_')}`] = pmtilesLayer;
    loadedLayersMap.set(fullLayerId, pmtilesLayer);

    // Initial addition to map if enabled (and in range)
    if (typeof OTEFDataContext !== 'undefined') {
      const layerGroups = OTEFDataContext.getLayerGroups();
      if (layerGroups) {
        const [groupId, layerId] = fullLayerId.split('.');
        const group = layerGroups.find(g => g.id === groupId);
        if (group) {
          const layerStateObj = group.layers.find(l => l.id === layerId);
          if (layerStateObj && layerStateObj.enabled) {
             const currentZoom = map.getZoom();
             const getZoomFromScale = (scale) => scale ? Math.log2(591657550 / scale) : null;
             const minZ = scaleRange ? getZoomFromScale(scaleRange.minScale) : null;
             const maxZ = scaleRange ? getZoomFromScale(scaleRange.maxScale) : null;

             let inRange = true;
             if (minZ !== null && currentZoom < minZ) inRange = false;
             if (maxZ !== null && currentZoom > maxZ) inRange = false;

             if (inRange) {
                map.addLayer(pmtilesLayer);
             }
          }
        }
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
  const layer = loadedLayersMap.get(fullLayerId);
  if (!layer) {
    // Layer may not be loaded yet - this is normal during initial load
    return;
  }

  if (visible) {
    if (!map.hasLayer(layer)) {
      map.addLayer(layer);
    }
  } else {
    if (map.hasLayer(layer)) {
      map.removeLayer(layer);
    }
  }
}


