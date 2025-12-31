// OTEF Projection Display - Simplified for TouchDesigner integration
// Warping/calibration is handled by TouchDesigner, not by this page

// Load model bounds
let modelBounds;
fetch('data/model-bounds.json')
    .then(res => res.json())
    .then(bounds => {
        modelBounds = bounds;
        console.log('Model bounds loaded:', bounds);
        
        // Update debug overlay with model dimensions
        if (window.DebugOverlay) {
            window.DebugOverlay.updateModelDimensions(bounds.image_width, bounds.image_height);
        }
    })
    .catch(error => {
        console.error('Error loading model bounds:', error);
    });

// WebSocket connection
let ws;
let reconnectTimeout;

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/otef/`;
    
    console.log('Projection connecting to WebSocket:', wsUrl);
    
    try {
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            console.log('Projection WebSocket connected');
            if (window.DebugOverlay) {
                window.DebugOverlay.setWebSocketStatus('connected');
            }
        };
        
        ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            
            if (message.type === 'otef_viewport_update') {
                console.log('Received viewport update:', message);
                
                // Use corners if available (more accurate), otherwise fall back to bbox
                if (message.corners) {
                    updateHighlightQuad(message.corners);
                } else {
                    updateHighlightRect(message.bbox);
                }
            }
        };
        
        ws.onclose = () => {
            console.log('Projection WebSocket disconnected, reconnecting...');
            if (window.DebugOverlay) {
                window.DebugOverlay.setWebSocketStatus('disconnected');
            }
            reconnectTimeout = setTimeout(connectWebSocket, 3000);
        };
        
        ws.onerror = (error) => {
            console.error('Projection WebSocket error:', error);
            if (window.DebugOverlay) {
                window.DebugOverlay.setWebSocketStatus('error');
            }
        };
    } catch (err) {
        console.error('Projection WebSocket connection failed:', err);
        reconnectTimeout = setTimeout(connectWebSocket, 3000);
    }
}

// Calculate the actual displayed image bounds within the container
// This accounts for object-fit: contain which may leave empty space
function getDisplayedImageBounds() {
    const img = document.getElementById('displayedImage');
    const container = document.getElementById('displayContainer');
    
    if (!img || !container) return null;
    
    // Wait for image to load
    if (!img.naturalWidth || !img.naturalHeight) {
        console.warn('Image natural dimensions not available yet');
        return null;
    }
    
    // Get the ACTUAL rendered size of the image element
    // This is more reliable than calculating from container + aspect ratio
    const imgRect = img.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    
    // Calculate offset from container to image
    const offsetX = imgRect.left - containerRect.left;
    const offsetY = imgRect.top - containerRect.top;
    
    console.log('[BOUNDS] Container:', containerRect.width.toFixed(0), 'x', containerRect.height.toFixed(0));
    console.log('[BOUNDS] Image rendered:', imgRect.width.toFixed(0), 'x', imgRect.height.toFixed(0));
    console.log('[BOUNDS] Offset:', offsetX.toFixed(1), ',', offsetY.toFixed(1));
    
    return {
        offsetX,
        offsetY,
        width: imgRect.width,
        height: imgRect.height,
        containerWidth: containerRect.width,
        containerHeight: containerRect.height
    };
}

// Convert ITM coordinates to pixel position within displayed image
function itmToDisplayPixels(x, y) {
    const bounds = getDisplayedImageBounds();
    if (!bounds || !modelBounds) return null;
    
    const pctX = (x - modelBounds.west) / (modelBounds.east - modelBounds.west);
    const pctY = (modelBounds.north - y) / (modelBounds.north - modelBounds.south);
    const clampedX = Math.max(0, Math.min(1, pctX));
    const clampedY = Math.max(0, Math.min(1, pctY));
    
    return {
        x: bounds.offsetX + (clampedX * bounds.width),
        y: bounds.offsetY + (clampedY * bounds.height)
    };
}

// Update highlight using 4 corners (quadrilateral - more accurate)
function updateHighlightQuad(corners) {
    if (!modelBounds) {
        console.warn('Model bounds not loaded yet');
        return;
    }
    
    // Store for resize events
    lastMessage = { corners };
    
    const bounds = getDisplayedImageBounds();
    if (!bounds) return;
    
    const all_x = [corners.sw.x, corners.se.x, corners.nw.x, corners.ne.x];
    const all_y = [corners.sw.y, corners.se.y, corners.nw.y, corners.ne.y];
    const isFull = modelBounds && Math.abs(Math.min(...all_x) - modelBounds.west) < 10 &&
                   Math.abs(Math.min(...all_y) - modelBounds.south) < 10 &&
                   Math.abs(Math.max(...all_x) - modelBounds.east) < 10 &&
                   Math.abs(Math.max(...all_y) - modelBounds.north) < 10;
    
    let sw_px, se_px, nw_px, ne_px;
    if (isFull) {
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
    
    console.log('Display pixel corners:');
    console.log('  SW:', sw_px.x.toFixed(1), sw_px.y.toFixed(1));
    console.log('  SE:', se_px.x.toFixed(1), se_px.y.toFixed(1));
    console.log('  NW:', nw_px.x.toFixed(1), nw_px.y.toFixed(1));
    console.log('  NE:', ne_px.x.toFixed(1), ne_px.y.toFixed(1));
    
    // Update debug overlay
    if (window.DebugOverlay) {
        const bbox = [
            Math.min(corners.sw.x, corners.nw.x),
            Math.min(corners.sw.y, corners.se.y),
            Math.max(corners.se.x, corners.ne.x),
            Math.max(corners.nw.y, corners.ne.y)
        ];
        window.DebugOverlay.updateReceivedBbox(bbox);
        
        const [pxMin, pyMin, pxMax, pyMax] = CoordUtils.bboxItmToPixel(bbox, modelBounds);
        window.DebugOverlay.updatePixelCoords(pxMin, pyMin, pxMax, pyMax);
        
        if (bounds) {
            const left = ((Math.min(sw_px.x, nw_px.x) - bounds.offsetX) / bounds.width) * 100;
            const top = ((Math.min(nw_px.y, ne_px.y) - bounds.offsetY) / bounds.height) * 100;
            const right = ((Math.max(se_px.x, ne_px.x) - bounds.offsetX) / bounds.width) * 100;
            const bottom = ((Math.max(sw_px.y, se_px.y) - bounds.offsetY) / bounds.height) * 100;
            window.DebugOverlay.updateHighlightPercentages(left, top, right - left, bottom - top);
        }
    }
    
    // Get or create the highlight element (using div with clip-path for smooth transitions)
    const overlay = document.getElementById('highlightOverlay');
    let highlightBox = overlay.querySelector('.highlight-box');
    
    if (!highlightBox) {
        highlightBox = document.createElement('div');
        highlightBox.className = 'highlight-box';
        highlightBox.style.cssText = `
            position: absolute;
            border: 3px solid rgba(0, 255, 255, 0.9);
            background: rgba(0, 255, 255, 0.15);
            box-shadow: 0 0 30px rgba(0, 255, 255, 0.8), inset 0 0 30px rgba(0, 255, 255, 0.4);
            pointer-events: none;
            transition: left 0.15s ease-out, top 0.15s ease-out, width 0.15s ease-out, height 0.15s ease-out;
        `;
        
        // Remove old SVG if exists
        const oldSvg = overlay.querySelector('svg');
        if (oldSvg) oldSvg.remove();
        
        overlay.appendChild(highlightBox);
    }
    
    // Calculate bounding box from corners (for simpler rectangle rendering with transitions)
    const minX = Math.min(sw_px.x, nw_px.x, se_px.x, ne_px.x);
    const maxX = Math.max(sw_px.x, nw_px.x, se_px.x, ne_px.x);
    const minY = Math.min(sw_px.y, nw_px.y, se_px.y, ne_px.y);
    const maxY = Math.max(sw_px.y, nw_px.y, se_px.y, ne_px.y);
    
    // Position using absolute pixels
    highlightBox.style.left = minX + 'px';
    highlightBox.style.top = minY + 'px';
    highlightBox.style.width = (maxX - minX) + 'px';
    highlightBox.style.height = (maxY - minY) + 'px';
}

// Fallback: Update highlight using bounding box (rectangle)
function updateHighlightRect(itmBbox) {
    if (!modelBounds) {
        console.warn('Model bounds not loaded yet');
        return;
    }
    
    // Store for resize events
    lastMessage = { bbox: itmBbox };
    
    console.log('Received ITM bbox:', itmBbox);
    
    // Update debug overlay with received bbox
    if (window.DebugOverlay) {
        window.DebugOverlay.updateReceivedBbox(itmBbox);
    }
    
    const bounds = getDisplayedImageBounds();
    if (!bounds) return;
    
    const isFull = modelBounds && Math.abs(itmBbox[0] - modelBounds.west) < 10 &&
                   Math.abs(itmBbox[1] - modelBounds.south) < 10 &&
                   Math.abs(itmBbox[2] - modelBounds.east) < 10 &&
                   Math.abs(itmBbox[3] - modelBounds.north) < 10;
    
    let sw_px, ne_px;
    if (isFull) {
        const { offsetX, offsetY, width, height } = bounds;
        sw_px = { x: offsetX, y: offsetY + height };
        ne_px = { x: offsetX + width, y: offsetY };
    } else {
        sw_px = itmToDisplayPixels(itmBbox[0], itmBbox[1]);
        ne_px = itmToDisplayPixels(itmBbox[2], itmBbox[3]);
        if (!sw_px || !ne_px) return;
    }
    
    // Update debug overlay with pixel coordinates
    if (window.DebugOverlay) {
        const [pxMin, pyMin, pxMax, pyMax] = CoordUtils.bboxItmToPixel(itmBbox, modelBounds);
        window.DebugOverlay.updatePixelCoords(pxMin, pyMin, pxMax, pyMax);
        
        const bounds = getDisplayedImageBounds();
        if (bounds) {
            const left = ((sw_px.x - bounds.offsetX) / bounds.width) * 100;
            const top = ((ne_px.y - bounds.offsetY) / bounds.height) * 100;
            const width = ((ne_px.x - sw_px.x) / bounds.width) * 100;
            const height = ((sw_px.y - ne_px.y) / bounds.height) * 100;
            window.DebugOverlay.updateHighlightPercentages(left, top, width, height);
        }
    }
    
    // Get or create highlight box
    const overlay = document.getElementById('highlightOverlay');
    let highlightBox = overlay.querySelector('.highlight-box');
    
    if (!highlightBox) {
        highlightBox = document.createElement('div');
        highlightBox.className = 'highlight-box';
        highlightBox.style.cssText = `
            position: absolute;
            border: 3px solid rgba(0, 255, 255, 0.9);
            background: rgba(0, 255, 255, 0.15);
            box-shadow: 0 0 30px rgba(0, 255, 255, 0.8), inset 0 0 30px rgba(0, 255, 255, 0.4);
            pointer-events: none;
            transition: left 0.15s ease-out, top 0.15s ease-out, width 0.15s ease-out, height 0.15s ease-out;
        `;
        overlay.appendChild(highlightBox);
    }
    
    // Position using absolute pixels
    highlightBox.style.left = sw_px.x + 'px';
    highlightBox.style.top = ne_px.y + 'px';
    highlightBox.style.width = (ne_px.x - sw_px.x) + 'px';
    highlightBox.style.height = (sw_px.y - ne_px.y) + 'px';
}

// Store last message for redrawing on resize
let lastMessage = null;

// Update highlight on window resize
window.addEventListener('resize', () => {
    if (lastMessage) {
        if (lastMessage.corners) {
            updateHighlightQuad(lastMessage.corners);
        } else if (lastMessage.bbox) {
            updateHighlightRect(lastMessage.bbox);
        }
    }
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
