// ABOUTME: Converts Leaflet style objects to SVG-compatible attributes

/**
 * Converts Leaflet style object to SVG attributes
 * @param {Object} styleObj - Leaflet style object with fillColor, fillOpacity, color, weight, opacity
 * @returns {Object} SVG-compatible attributes object
 */
function leafletStyleToSvgAttrs(styleObj) {
    const attrs = {};
    
    // Fill properties
    if (styleObj.fillColor !== undefined) {
        attrs.fill = styleObj.fillColor;
    }
    if (styleObj.fillOpacity !== undefined) {
        attrs['fill-opacity'] = styleObj.fillOpacity;
    } else if (styleObj.fillOpacity === 0) {
        attrs.fill = 'none';
    }
    
    // Stroke properties
    if (styleObj.color !== undefined) {
        attrs.stroke = styleObj.color;
    }
    if (styleObj.weight !== undefined) {
        attrs['stroke-width'] = styleObj.weight;
    }
    if (styleObj.opacity !== undefined) {
        attrs['stroke-opacity'] = styleObj.opacity;
    }
    
    // Defaults if no fill specified
    if (!attrs.fill && attrs.fill !== 'none') {
        attrs.fill = 'none';
    }
    
    return attrs;
}

/**
 * Applies style attributes to an SVG element
 * @param {SVGElement} element - SVG element to style
 * @param {Object} styleObj - Leaflet style object
 */
function applyStyleToSvgElement(element, styleObj) {
    const attrs = leafletStyleToSvgAttrs(styleObj);
    
    Object.entries(attrs).forEach(([key, value]) => {
        element.setAttribute(key, value);
    });
}
