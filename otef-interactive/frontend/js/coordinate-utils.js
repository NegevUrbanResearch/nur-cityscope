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
     * Transforms entire GeoJSON from ITM (EPSG:2039) to display pixel coordinates
     * @param {Object} geojson - GeoJSON object with features in EPSG:2039
     * @param {Object} modelBounds - Model bounds object with west, east, north, south, image_width, image_height
     * @param {Object} displayBounds - Display bounds from getDisplayedImageBounds()
     * @returns {Object} Transformed GeoJSON with pixel coordinates
     */
    transformGeojsonToDisplayPixels(geojson, modelBounds, displayBounds) {
        const transformed = JSON.parse(JSON.stringify(geojson)); // Deep clone
        
        /**
         * Recursively transform coordinate arrays
         * @param {Array} coords - Coordinate array (nested for MultiPolygon, etc.)
         * @param {number} depth - Recursion depth (safety limit)
         * @returns {Array} Transformed coordinates
         */
        function transformCoords(coords, depth = 0) {
            if (depth > 10) return coords; // Safety limit
            
            // Check if this is a coordinate pair [x, y]
            if (Array.isArray(coords) && coords.length >= 2 && 
                typeof coords[0] === 'number' && typeof coords[1] === 'number') {
                // This is a coordinate pair [x, y] in EPSG:2039
                // Calculate percentage directly from ITM coordinates (same as itmToDisplayPixels)
                const pctX = Math.max(0, Math.min(1, (coords[0] - modelBounds.west) / (modelBounds.east - modelBounds.west)));
                const pctY = Math.max(0, Math.min(1, (modelBounds.north - coords[1]) / (modelBounds.north - modelBounds.south)));
                
                // Convert percentage to SVG-relative coordinates (SVG viewBox starts at 0,0)
                // The SVG is positioned at offsetX,offsetY, so coordinates inside SVG are relative to SVG origin
                const resultX = pctX * displayBounds.width;
                const resultY = pctY * displayBounds.height;
                
                return [resultX, resultY];
            } else if (Array.isArray(coords)) {
                // Recurse into nested arrays
                return coords.map(c => transformCoords(c, depth + 1));
            }
            return coords;
        }
        
        // Transform each feature's geometry
        if (transformed.features) {
            transformed.features.forEach(feature => {
                if (feature.geometry && feature.geometry.coordinates) {
                    feature.geometry.coordinates = transformCoords(feature.geometry.coordinates);
                }
            });
        }
        
        return transformed;
    }
};


