// ABOUTME: Core SVG rendering module for projector page - renders GeoJSON layers as SVG overlays

/**
 * Creates SVG overlay element positioned over the model image
 * @param {string} containerId - ID of container element
 * @returns {SVGElement} SVG element reference
 */
function createSVGOverlay(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
        throw new Error(`Container ${containerId} not found`);
    }
    
    // Remove existing SVG if present
    const existing = container.querySelector('#layersOverlay');
    if (existing) {
        existing.remove();
    }
    
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'layersOverlay';
    svg.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 5;';
    
    // Insert before highlight overlay
    const highlightOverlay = container.querySelector('#highlightOverlay');
    if (highlightOverlay) {
        container.insertBefore(svg, highlightOverlay);
    } else {
        container.appendChild(svg);
    }
    
    return svg;
}

/**
 * Converts GeoJSON geometry to SVG path 'd' attribute
 * @param {Object} geometry - GeoJSON geometry object
 * @returns {string} SVG path data string
 */
function geometryToSVGPath(geometry) {
    if (!geometry || !geometry.coordinates) {
        return '';
    }
    
    const coords = geometry.coordinates;
    let pathData = '';
    
    switch (geometry.type) {
        case 'Point':
            // Points are rendered as circles, not paths
            return null;
            
        case 'LineString':
            if (coords.length < 2) return '';
            pathData = `M ${Math.round(coords[0][0])} ${Math.round(coords[0][1])}`;
            for (let i = 1; i < coords.length; i++) {
                pathData += ` L ${Math.round(coords[i][0])} ${Math.round(coords[i][1])}`;
            }
            return pathData;
            
        case 'MultiLineString':
            return coords.map(ring => {
                if (ring.length < 2) return '';
                let p = `M ${Math.round(ring[0][0])} ${Math.round(ring[0][1])}`;
                for (let i = 1; i < ring.length; i++) {
                    p += ` L ${Math.round(ring[i][0])} ${Math.round(ring[i][1])}`;
                }
                return p;
            }).join(' ');
            
        case 'Polygon':
            return coords.map((ring, ringIndex) => {
                if (ring.length < 3) return '';
                let p = `M ${Math.round(ring[0][0])} ${Math.round(ring[0][1])}`;
                for (let i = 1; i < ring.length; i++) {
                    p += ` L ${Math.round(ring[i][0])} ${Math.round(ring[i][1])}`;
                }
                p += ' Z'; // Close path
                return p;
            }).join(' ');
            
        case 'MultiPolygon':
            return coords.map(polygon => {
                return polygon.map(ring => {
                    if (ring.length < 3) return '';
                    let p = `M ${Math.round(ring[0][0])} ${Math.round(ring[0][1])}`;
                    for (let i = 1; i < ring.length; i++) {
                        p += ` L ${Math.round(ring[i][0])} ${Math.round(ring[i][1])}`;
                    }
                    p += ' Z';
                    return p;
                }).join(' ');
            }).join(' ');
            
        default:
            console.warn(`Unsupported geometry type: ${geometry.type}`);
            return '';
    }
}

/**
 * Renders a layer as SVG paths
 * @param {SVGElement} svgElement - SVG element to render into
 * @param {string} layerId - Unique identifier for the layer
 * @param {Object} transformedGeojson - GeoJSON with pixel coordinates
 * @param {Function} styleFunction - Function that returns style object for each feature
 * @returns {SVGElement} Group element containing the layer
 */
function renderLayerAsSVG(svgElement, layerId, transformedGeojson, styleFunction) {
    // Remove existing layer group if present
    const existing = svgElement.querySelector(`#layer-${layerId}`);
    if (existing) {
        existing.remove();
    }
    
    // Create group for this layer
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.id = `layer-${layerId}`;
    
    // Use DocumentFragment for batch DOM updates
    const fragment = document.createDocumentFragment();
    
    // Render each feature
    transformedGeojson.features.forEach((feature, index) => {
        if (!feature.geometry) return;
        
        const pathData = geometryToSVGPath(feature.geometry);
        if (!pathData) return; // Skip invalid geometries
        
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathData);
        
        // Apply styling
        const style = styleFunction ? styleFunction(feature) : {};
        applyStyleToSvgElement(path, style);
        
        fragment.appendChild(path);
    });
    
    group.appendChild(fragment);
    svgElement.appendChild(group);
    
    console.log(`Rendered ${transformedGeojson.features.length} features for layer ${layerId}`);
    return group;
}

/**
 * Toggles layer visibility
 * @param {string} layerId - Layer identifier
 * @param {boolean} visible - Whether layer should be visible
 */
function updateLayerVisibility(layerId, visible) {
    const layerGroup = document.querySelector(`#layer-${layerId}`);
    if (layerGroup) {
        layerGroup.style.display = visible ? 'block' : 'none';
    }
}

/**
 * Updates SVG position and viewBox on resize
 * @param {SVGElement} svgElement - SVG element to update
 * @param {Object} displayBounds - Display bounds from getDisplayedImageBounds()
 * @param {Object} modelBounds - Model bounds
 * @param {Object} layers - Object with layer data { layerId: { geojson, styleFunction } }
 */
function updateSVGPosition(svgElement, displayBounds, modelBounds, layers) {
    if (!svgElement || !displayBounds || !modelBounds) return;
    
    // Update SVG position to match image
    svgElement.style.left = displayBounds.offsetX + 'px';
    svgElement.style.top = displayBounds.offsetY + 'px';
    svgElement.style.width = displayBounds.width + 'px';
    svgElement.style.height = displayBounds.height + 'px';
    
    // Set viewBox to match display dimensions
    svgElement.setAttribute('viewBox', `0 0 ${displayBounds.width} ${displayBounds.height}`);
    
    // Re-render all visible layers with new coordinates
    Object.entries(layers).forEach(([layerId, layerData]) => {
        const layerGroup = svgElement.querySelector(`#layer-${layerId}`);
        if (layerGroup && layerGroup.style.display !== 'none') {
            // Re-transform and re-render
            const transformed = CoordUtils.transformGeojsonToDisplayPixels(
                layerData.originalGeojson,
                modelBounds,
                displayBounds
            );
            renderLayerAsSVG(svgElement, layerId, transformed, layerData.styleFunction);
        }
    });
}
