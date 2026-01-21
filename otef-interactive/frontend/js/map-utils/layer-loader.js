// ABOUTME: Generic GeoJSON loader for OTEF layers - extracts loading logic for reuse
// Returns raw GeoJSON data in EPSG:2039 format without Leaflet dependencies

/**
 * Loads GeoJSON data from a URL
 * @param {string} url - Path to GeoJSON file
 * @returns {Promise<Object>} Promise resolving to GeoJSON object
 */
function loadLayerData(url) {
    return fetch(url)
        .then(res => {
            if (!res.ok) {
                throw new Error(`Failed to load layer: ${res.status} ${res.statusText}`);
            }
            return res.json();
        })
        .then(geojson => {
            if (!geojson || !geojson.features) {
                throw new Error('Invalid GeoJSON format: missing features array');
            }
            console.log(`Loaded ${geojson.features.length} features from ${url}`);
            return geojson;
        })
        .catch(error => {
            console.error(`Error loading layer from ${url}:`, error);
            throw error;
        });
}

/**
 * Fetch configuration for all OTEF layers for a given table.
 * This wraps the `/api/actions/get_otef_layers/` endpoint.
 *
 * @param {string} tableName
 * @returns {Promise<Array<Object>>}
 */
async function loadAllLayerConfigs(tableName) {
    const table = tableName || (window.tableSwitcher && window.tableSwitcher.getCurrentTable()) || 'otef';
    const apiUrl = `/api/actions/get_otef_layers/?table=${table}`;

    const response = await fetch(apiUrl);
    if (!response.ok) {
        throw new Error(`Failed to load layer config: ${response.status}`);
    }
    return response.json();
}

/**
 * Fetch configuration for a single named layer.
 *
 * @param {string} tableName
 * @param {string} layerName
 * @returns {Promise<Object|null>}
 */
async function loadLayerConfig(tableName, layerName) {
    const layers = await loadAllLayerConfigs(tableName);
    const config = layers.find(l => l.name === layerName);
    if (!config) {
        console.warn(`[LayerLoader] Layer "${layerName}" not found in table "${tableName}"`);
        return null;
    }
    return config;
}

/**
 * Given a layer config from the API, resolve it to a concrete GeoJSON object.
 * Handles both inline `geojson` and `url`-based sources.
 *
 * @param {Object} layerConfig
 * @returns {Promise<Object>}
 */
async function loadGeojsonFromConfig(layerConfig) {
    if (!layerConfig) {
        throw new Error('[LayerLoader] loadGeojsonFromConfig called without a layerConfig');
    }

    if (layerConfig.geojson) {
        return layerConfig.geojson;
    }

    if (layerConfig.url) {
        return loadLayerData(layerConfig.url);
    }

    throw new Error(`[LayerLoader] Layer "${layerConfig.name || 'unknown'}" has no data source (geojson/url)`);
}

/**
 * Convenience helper to go from (table, layerName) directly to GeoJSON.
 * Returns `{ config, geojson }` so callers that need the config can reuse it.
 *
 * @param {string} tableName
 * @param {string} layerName
 * @returns {Promise<{config: Object, geojson: Object} | null>}
 */
async function loadLayerGeojson(tableName, layerName) {
    const config = await loadLayerConfig(tableName, layerName);
    if (!config) return null;

    const geojson = await loadGeojsonFromConfig(config);
    return { config, geojson };
}

// Expose helpers for tests / Node usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        loadLayerData,
        loadAllLayerConfigs,
        loadLayerConfig,
        loadGeojsonFromConfig,
        loadLayerGeojson
    };
}
