// OTEF Projection Display - Simplified for TouchDesigner integration
// Warping/calibration is handled by TouchDesigner, not by this page

// Load model bounds
let modelBounds;
let svgOverlay = null;
let loadedLayers = {}; // Store layer data for resize handling

fetch('data/model-bounds.json')
    .then(res => res.json())
    .then(bounds => {
        modelBounds = bounds;
        console.log('Model bounds loaded:', bounds);
        
        // Update debug overlay with model dimensions
        if (window.DebugOverlay) {
            window.DebugOverlay.updateModelDimensions(bounds.image_width, bounds.image_height);
        }
        
        // Initialize layers after model bounds are loaded
        initializeLayers();
    })
    .catch(error => {
        console.error('Error loading model bounds:', error);
    });

let ws, reconnectTimeout;

function setDebugStatus(status) {
    if (window.DebugOverlay) window.DebugOverlay.setWebSocketStatus(status);
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/otef/`;
    
    console.log('Projection connecting to WebSocket:', wsUrl);
    
    try {
        ws = new WebSocket(wsUrl);
        ws.onopen = () => setDebugStatus('connected');
        ws.onmessage = (e) => {
            const msg = JSON.parse(e.data);
            if (msg.type === 'otef_viewport_update') {
                (msg.corners ? updateHighlightQuad : updateHighlightRect)(msg.corners || msg.bbox);
            }
        };
        ws.onclose = () => {
            setDebugStatus('disconnected');
            reconnectTimeout = setTimeout(connectWebSocket, 3000);
        };
        ws.onerror = () => setDebugStatus('error');
    } catch (err) {
        reconnectTimeout = setTimeout(connectWebSocket, 3000);
    }
}

function getDisplayedImageBounds() {
    const img = document.getElementById('displayedImage');
    const container = document.getElementById('displayContainer');
    if (!img?.naturalWidth || !container) return null;
    
    const imgRect = img.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    
    return {
        offsetX: imgRect.left - containerRect.left,
        offsetY: imgRect.top - containerRect.top,
        width: imgRect.width,
        height: imgRect.height,
        containerWidth: containerRect.width,
        containerHeight: containerRect.height
    };
}

function itmToDisplayPixels(x, y) {
    const bounds = getDisplayedImageBounds();
    if (!bounds || !modelBounds) return null;
    
    const pctX = Math.max(0, Math.min(1, (x - modelBounds.west) / (modelBounds.east - modelBounds.west)));
    const pctY = Math.max(0, Math.min(1, (modelBounds.north - y) / (modelBounds.north - modelBounds.south)));
    
    return {
        x: bounds.offsetX + (pctX * bounds.width),
        y: bounds.offsetY + (pctY * bounds.height)
    };
}

function isFullExtent(minX, minY, maxX, maxY) {
    if (!modelBounds) return false;
    const tol = 10;
    return Math.abs(minX - modelBounds.west) < tol &&
           Math.abs(minY - modelBounds.south) < tol &&
           Math.abs(maxX - modelBounds.east) < tol &&
           Math.abs(maxY - modelBounds.north) < tol;
}

function getOrCreateHighlightBox() {
    const overlay = document.getElementById('highlightOverlay');
    let box = overlay.querySelector('.highlight-box');
    if (!box) {
        box = document.createElement('div');
        box.className = 'highlight-box';
        box.style.cssText = 'position: absolute; border: 3px solid rgba(0, 255, 255, 0.9); background: rgba(0, 255, 255, 0.15); box-shadow: 0 0 30px rgba(0, 255, 255, 0.8), inset 0 0 30px rgba(0, 255, 255, 0.4); pointer-events: none; transition: left 0.15s ease-out, top 0.15s ease-out, width 0.15s ease-out, height 0.15s ease-out;';
        overlay.querySelector('svg')?.remove();
        overlay.appendChild(box);
    }
    return box;
}

function updateHighlightQuad(corners) {
    if (!modelBounds) return;
    
    lastMessage = { corners };
    const bounds = getDisplayedImageBounds();
    if (!bounds) return;
    
    const all_x = [corners.sw.x, corners.se.x, corners.nw.x, corners.ne.x];
    const all_y = [corners.sw.y, corners.se.y, corners.nw.y, corners.ne.y];
    const minX = Math.min(...all_x), minY = Math.min(...all_y);
    const maxX = Math.max(...all_x), maxY = Math.max(...all_y);
    
    let sw_px, se_px, nw_px, ne_px;
    if (isFullExtent(minX, minY, maxX, maxY)) {
        const { offsetX, offsetY, width, height } = bounds;
        sw_px = { x: offsetX, y: offsetY + height };
        se_px = { x: offsetX + width, y: offsetY + height };
        nw_px = { x: offsetX, y: offsetY };
        ne_px = { x: offsetX + width, y: offsetY };
    } else {
        sw_px = itmToDisplayPixels(corners.sw.x, corners.sw.y);
        se_px = itmToDisplayPixels(corners.se.x, corners.se.y);
        nw_px = itmToDisplayPixels(corners.nw.x, corners.nw.y);
        ne_px = itmToDisplayPixels(corners.ne.x, corners.ne.y);
        if (!sw_px || !se_px || !nw_px || !ne_px) return;
    }
    
    if (window.DebugOverlay) {
        const bbox = [minX, minY, maxX, maxY];
        window.DebugOverlay.updateReceivedBbox(bbox);
        const [pxMin, pyMin, pxMax, pyMax] = CoordUtils.bboxItmToPixel(bbox, modelBounds);
        window.DebugOverlay.updatePixelCoords(pxMin, pyMin, pxMax, pyMax);
        const left = ((Math.min(sw_px.x, nw_px.x) - bounds.offsetX) / bounds.width) * 100;
        const top = ((Math.min(nw_px.y, ne_px.y) - bounds.offsetY) / bounds.height) * 100;
        const right = ((Math.max(se_px.x, ne_px.x) - bounds.offsetX) / bounds.width) * 100;
        const bottom = ((Math.max(sw_px.y, se_px.y) - bounds.offsetY) / bounds.height) * 100;
        window.DebugOverlay.updateHighlightPercentages(left, top, right - left, bottom - top);
    }
    
    const box = getOrCreateHighlightBox();
    const minPX = Math.min(sw_px.x, nw_px.x, se_px.x, ne_px.x);
    const maxPX = Math.max(sw_px.x, nw_px.x, se_px.x, ne_px.x);
    const minPY = Math.min(sw_px.y, nw_px.y, se_px.y, ne_px.y);
    const maxPY = Math.max(sw_px.y, nw_px.y, se_px.y, ne_px.y);
    box.style.left = minPX + 'px';
    box.style.top = minPY + 'px';
    box.style.width = (maxPX - minPX) + 'px';
    box.style.height = (maxPY - minPY) + 'px';
}

function updateHighlightRect(itmBbox) {
    if (!modelBounds) return;
    
    lastMessage = { bbox: itmBbox };
    const bounds = getDisplayedImageBounds();
    if (!bounds) return;
    
    let sw_px, ne_px;
    if (isFullExtent(itmBbox[0], itmBbox[1], itmBbox[2], itmBbox[3])) {
        const { offsetX, offsetY, width, height } = bounds;
        sw_px = { x: offsetX, y: offsetY + height };
        ne_px = { x: offsetX + width, y: offsetY };
    } else {
        sw_px = itmToDisplayPixels(itmBbox[0], itmBbox[1]);
        ne_px = itmToDisplayPixels(itmBbox[2], itmBbox[3]);
        if (!sw_px || !ne_px) return;
    }
    
    if (window.DebugOverlay) {
        window.DebugOverlay.updateReceivedBbox(itmBbox);
        const [pxMin, pyMin, pxMax, pyMax] = CoordUtils.bboxItmToPixel(itmBbox, modelBounds);
        window.DebugOverlay.updatePixelCoords(pxMin, pyMin, pxMax, pyMax);
        const left = ((sw_px.x - bounds.offsetX) / bounds.width) * 100;
        const top = ((ne_px.y - bounds.offsetY) / bounds.height) * 100;
        const width = ((ne_px.x - sw_px.x) / bounds.width) * 100;
        const height = ((sw_px.y - ne_px.y) / bounds.height) * 100;
        window.DebugOverlay.updateHighlightPercentages(left, top, width, height);
    }
    
    const box = getOrCreateHighlightBox();
    box.style.left = sw_px.x + 'px';
    box.style.top = ne_px.y + 'px';
    box.style.width = (ne_px.x - sw_px.x) + 'px';
    box.style.height = (sw_px.y - ne_px.y) + 'px';
}

let lastMessage = null;

// Debounce resize handler
let resizeTimeout;
function handleResize() {
    if (lastMessage?.corners) updateHighlightQuad(lastMessage.corners);
    else if (lastMessage?.bbox) updateHighlightRect(lastMessage.bbox);
    
    // Update SVG overlay position and re-render layers
    if (svgOverlay && modelBounds) {
        const displayBounds = getDisplayedImageBounds();
        if (displayBounds) {
            updateSVGPosition(svgOverlay, displayBounds, modelBounds, loadedLayers);
        }
    }
}

window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(handleResize, 200); // Debounce 200ms
});

// Keyboard shortcuts
window.addEventListener('keydown', (event) => {
    // H key for help/instructions toggle
    if (event.key === 'h' || event.key === 'H') {
        const instructions = document.getElementById('instructions');
        instructions.classList.toggle('hidden');
    }
    
    // F key for fullscreen
    if (event.key === 'f' || event.key === 'F') {
        toggleFullScreen();
    }
});

// Toggle fullscreen
function toggleFullScreen() {
    const doc = window.document;
    const docElement = doc.documentElement;
    const requestFullScreen = docElement.requestFullscreen || 
                               docElement.mozRequestFullScreen || 
                               docElement.webkitRequestFullScreen || 
                               docElement.msRequestFullscreen;
    const cancelFullScreen = doc.exitFullscreen || 
                              doc.mozCancelFullScreen || 
                              doc.webkitExitFullscreen || 
                              doc.msExitFullscreen;
    
    if (!doc.fullscreenElement && !doc.mozFullScreenElement && 
        !doc.webkitFullscreenElement && !doc.msFullscreenElement) {
        requestFullScreen.call(docElement);
    } else {
        cancelFullScreen.call(doc);
    }
}

/**
 * Initialize layers - create SVG overlay and load default layers
 */
function initializeLayers() {
    if (!modelBounds) {
        console.error('Cannot initialize layers: model bounds not loaded');
        return;
    }
    
    // Create SVG overlay
    try {
        svgOverlay = createSVGOverlay('displayContainer');
        console.log('SVG overlay created');
    } catch (error) {
        console.error('Failed to create SVG overlay:', error);
        return;
    }
    
    // Load roads layer (enabled by default)
    loadRoadsLayer();
    
    // Set up layer control handlers
    setupLayerControls();
}

/**
 * Load and render roads layer
 */
function loadRoadsLayer() {
    const roadToggle = document.getElementById('toggleRoads');
    if (!roadToggle) return;
    
    roadToggle.disabled = true;
    roadToggle.nextSibling.textContent = ' Roads (loading...)';
    
    loadLayerData('/otef-interactive/data-source/layers-simplified/small_roads_simplified.json')
        .then(geojson => {
            const displayBounds = getDisplayedImageBounds();
            if (!displayBounds) {
                throw new Error('Display bounds not available');
            }
            
            // Transform GeoJSON to display pixels
            const transformed = CoordUtils.transformGeojsonToDisplayPixels(
                geojson,
                modelBounds,
                displayBounds
            );
            
            // Set up SVG position and viewBox before rendering
            svgOverlay.style.left = displayBounds.offsetX + 'px';
            svgOverlay.style.top = displayBounds.offsetY + 'px';
            svgOverlay.style.width = displayBounds.width + 'px';
            svgOverlay.style.height = displayBounds.height + 'px';
            svgOverlay.setAttribute('viewBox', `0 0 ${displayBounds.width} ${displayBounds.height}`);
            
            // Render as SVG
            renderLayerAsSVG(svgOverlay, 'roads', transformed, getRoadStyle);
            
            // Store for resize handling
            loadedLayers.roads = {
                originalGeojson: geojson,
                styleFunction: getRoadStyle
            };
            
            // Update UI
            roadToggle.disabled = false;
            roadToggle.checked = true;
            roadToggle.nextSibling.textContent = ' Roads';
            document.getElementById('roadsLegend').style.display = 'block';
            
            console.log('Roads layer loaded and rendered');
        })
        .catch(error => {
            console.error('Error loading roads layer:', error);
            roadToggle.nextSibling.textContent = ' Roads (ERROR - check console)';
            roadToggle.disabled = false;
        });
}

/**
 * Load and render parcels layer (lazy load when toggled on)
 */
function loadParcelsLayer() {
    const parcelToggle = document.getElementById('toggleParcels');
    if (!parcelToggle) return;
    
    // Check if already loaded
    if (loadedLayers.parcels) {
        updateLayerVisibility('parcels', parcelToggle.checked);
        document.getElementById('parcelsLegend').style.display = parcelToggle.checked ? 'block' : 'none';
        return;
    }
    
    parcelToggle.disabled = true;
    parcelToggle.nextSibling.textContent = ' Parcels (loading...)';
    
    loadLayerData('/otef-interactive/data-source/layers-simplified/migrashim_simplified.json')
        .then(geojson => {
            const displayBounds = getDisplayedImageBounds();
            if (!displayBounds) {
                throw new Error('Display bounds not available');
            }
            
            // Transform GeoJSON to display pixels
            const transformed = CoordUtils.transformGeojsonToDisplayPixels(
                geojson,
                modelBounds,
                displayBounds
            );
            
            // Set up SVG position and viewBox before rendering (if not already set)
            if (!svgOverlay.hasAttribute('viewBox')) {
                svgOverlay.style.left = displayBounds.offsetX + 'px';
                svgOverlay.style.top = displayBounds.offsetY + 'px';
                svgOverlay.style.width = displayBounds.width + 'px';
                svgOverlay.style.height = displayBounds.height + 'px';
                svgOverlay.setAttribute('viewBox', `0 0 ${displayBounds.width} ${displayBounds.height}`);
            }
            
            // Render as SVG
            renderLayerAsSVG(svgOverlay, 'parcels', transformed, getParcelStyle);
            
            // Store for resize handling
            loadedLayers.parcels = {
                originalGeojson: geojson,
                styleFunction: getParcelStyle
            };
            
            // Update UI
            parcelToggle.disabled = false;
            parcelToggle.checked = true;
            parcelToggle.nextSibling.textContent = ' Parcels';
            document.getElementById('parcelsLegend').style.display = 'block';
            
            console.log('Parcels layer loaded and rendered');
        })
        .catch(error => {
            console.error('Error loading parcels layer:', error);
            parcelToggle.nextSibling.textContent = ' Parcels (ERROR - check console)';
            parcelToggle.disabled = false;
        });
}

/**
 * Set up layer control event handlers
 */
function setupLayerControls() {
    // Layer toggle button
    const layerToggle = document.getElementById('layerToggle');
    if (layerToggle) {
        layerToggle.addEventListener('click', () => {
            const panel = document.getElementById('layerPanel');
            if (panel) {
                panel.classList.toggle('hidden');
            }
        });
    }
    
    // Roads toggle
    const roadsToggle = document.getElementById('toggleRoads');
    if (roadsToggle) {
        roadsToggle.addEventListener('change', (e) => {
            updateLayerVisibility('roads', e.target.checked);
            const legend = document.getElementById('roadsLegend');
            if (legend) {
                legend.style.display = e.target.checked ? 'block' : 'none';
            }
        });
    }
    
    // Parcels toggle (lazy load)
    const parcelsToggle = document.getElementById('toggleParcels');
    if (parcelsToggle) {
        parcelsToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                loadParcelsLayer();
            } else {
                updateLayerVisibility('parcels', false);
                document.getElementById('parcelsLegend').style.display = 'none';
            }
        });
    }
    
    // Model toggle (just controls image visibility)
    const modelToggle = document.getElementById('toggleModel');
    if (modelToggle) {
        modelToggle.addEventListener('change', (e) => {
            const img = document.getElementById('displayedImage');
            if (img) {
                img.style.opacity = e.target.checked ? '1' : '0';
            }
            const legend = document.getElementById('modelLegend');
            if (legend) {
                legend.style.display = e.target.checked ? 'block' : 'none';
            }
        });
    }
}

// Connect on load
connectWebSocket();

// Show help for 3 seconds on load
setTimeout(() => {
    const instructions = document.getElementById('instructions');
    instructions.classList.remove('hidden');
    setTimeout(() => {
        instructions.classList.add('hidden');
    }, 3000);
}, 500);