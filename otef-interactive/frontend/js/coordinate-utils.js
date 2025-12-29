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
    }
};


