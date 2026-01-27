// Coordinate transformation utilities
const CoordUtils = {
    // Convert ITM coordinates to pixel coordinates (for projection overlay)
    itmToPixel(x, y, bounds) {
        const pixelX = ((x - bounds.west) / (bounds.east - bounds.west)) * bounds.image_width;
        const pixelY = ((bounds.north - y) / (bounds.north - bounds.south)) * bounds.image_height;
        return [pixelX, pixelY];
    },
    
    // Convert pixel coordinates to ITM
    pixelToItm(px, py, bounds) {
        const x = bounds.west + (px / bounds.image_width) * (bounds.east - bounds.west);
        const y = bounds.north - (py / bounds.image_height) * (bounds.north - bounds.south);
        return [x, y];
    },
    
    // Calculate pixel bbox from ITM bbox
    bboxItmToPixel(itmBbox, bounds) {
        const [xMin, yMin, xMax, yMax] = itmBbox;
        const [pxMin, pyMax] = this.itmToPixel(xMin, yMin, bounds);
        const [pxMax, pyMin] = this.itmToPixel(xMax, yMax, bounds);
        return [pxMin, pyMin, pxMax, pyMax];
    },

    /**
     * Transform coordinates from EPSG:2039 (ITM) to WGS84 (lat/lon).
     * Returns [lat, lon] for Leaflet compatibility.
     * @param {number} x - ITM X coordinate
     * @param {number} y - ITM Y coordinate
     * @returns {Array<number>} [lat, lon] for Leaflet
     */
    transformItmToWgs84(x, y) {
        const [lon, lat] = proj4("EPSG:2039", "EPSG:4326", [x, y]);
        return [lat, lon]; // Return as [lat, lon] for Leaflet
    },

    /**
     * Transform coordinates from WGS84 (lat/lon) to EPSG:2039 (ITM).
     * @param {number} lon - Longitude (WGS84)
     * @param {number} lat - Latitude (WGS84)
     * @returns {Array<number>} [x, y] in ITM
     */
    transformWgs84ToItm(lon, lat) {
        return proj4("EPSG:4326", "EPSG:2039", [lon, lat]);
    },

    /**
     * Generic helper to transform GeoJSON coordinates using a provided transform function.
     * Handles recursive coordinate arrays for all geometry types.
     * @param {Object} geojson - GeoJSON object to transform
     * @param {Function} transformFn - Function that takes [x, y] and returns transformed [x, y]
     * @param {Object} [options] - Options object
     * @param {Object} [options.crs] - CRS to set on output (optional)
     * @returns {Object} Transformed GeoJSON
     */
    transformGeojsonCoords(geojson, transformFn, options = {}) {
        const transformed = JSON.parse(JSON.stringify(geojson)); // Deep clone

        function transformCoords(coords, depth = 0) {
            if (depth > 10) return coords; // Safety limit

            if (typeof coords[0] === "number") {
                // This is a coordinate pair [x, y]
                return transformFn(coords[0], coords[1]);
            } else {
                // Recurse into nested arrays
                return coords.map((c) => transformCoords(c, depth + 1));
            }
        }

        // Transform each feature's geometry
        if (transformed.features) {
            transformed.features.forEach((feature) => {
                if (feature.geometry && feature.geometry.coordinates) {
                    feature.geometry.coordinates = transformCoords(
                        feature.geometry.coordinates
                    );
                }
            });
        }

        // Update CRS if provided
        if (options.crs) {
            transformed.crs = {
                type: "name",
                properties: { name: options.crs },
            };
        }

        return transformed;
    },

    /**
     * Transform entire GeoJSON from WGS84 to EPSG:2039 (ITM).
     * @param {Object} geojson - GeoJSON object with features in WGS84
     * @returns {Object} Transformed GeoJSON with ITM coordinates
     */
    transformGeojsonToItm(geojson) {
        return this.transformGeojsonCoords(
            geojson,
            (lon, lat) => proj4("EPSG:4326", "EPSG:2039", [lon, lat]),
            { crs: "EPSG:2039" }
        );
    },

    /**
     * Transform entire GeoJSON from EPSG:2039 to WGS84.
     * @param {Object} geojson - GeoJSON object with features in EPSG:2039
     * @returns {Object} Transformed GeoJSON with WGS84 coordinates
     */
    transformGeojsonToWgs84(geojson) {
        return this.transformGeojsonCoords(
            geojson,
            (x, y) => {
                const [lon, lat] = proj4("EPSG:2039", "EPSG:4326", [x, y]);
                return [lon, lat];
            },
            { crs: "EPSG:4326" }
        );
    },
    
    /**
     * Transforms entire GeoJSON from ITM (EPSG:2039) to display pixel coordinates
     * @param {Object} geojson - GeoJSON object with features in EPSG:2039
     * @param {Object} modelBounds - Model bounds object with west, east, north, south, image_width, image_height
     * @param {Object} displayBounds - Display bounds from getDisplayedImageBounds()
     * @returns {Object} Transformed GeoJSON with pixel coordinates
     */
    transformGeojsonToDisplayPixels(geojson, modelBounds, displayBounds) {
        return this.transformGeojsonCoords(
            geojson,
            (x, y) => {
                // Calculate percentage directly from ITM coordinates
                const pctX = Math.max(0, Math.min(1, (x - modelBounds.west) / (modelBounds.east - modelBounds.west)));
                const pctY = Math.max(0, Math.min(1, (modelBounds.north - y) / (modelBounds.north - modelBounds.south)));
                
                // Convert percentage to SVG-relative coordinates (SVG viewBox starts at 0,0)
                // The SVG is positioned at offsetX,offsetY, so coordinates inside SVG are relative to SVG origin
                const resultX = pctX * displayBounds.width;
                const resultY = pctY * displayBounds.height;
                
                return [resultX, resultY];
            }
        );
    }
};


