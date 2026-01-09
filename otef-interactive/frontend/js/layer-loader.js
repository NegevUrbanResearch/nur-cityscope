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
