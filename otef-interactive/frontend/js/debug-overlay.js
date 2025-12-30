/**
 * Debug overlay for coordinate transformation testing
 * Shows real-time info about what's being sent/received
 * 
 * Press 'D' key to toggle visibility
 * Works on both Interactive Map and Projection Display pages
 */

(function() {
    'use strict';
    
    // Create debug panel
    const debugPanel = document.createElement('div');
    debugPanel.id = 'debugPanel';
    debugPanel.style.cssText = `
        position: fixed;
        bottom: 10px;
        right: 10px;
        background: rgba(0, 0, 0, 0.95);
        color: #0f0;
        font-family: 'Courier New', monospace;
        font-size: 11px;
        padding: 15px;
        border-radius: 5px;
        max-width: 500px;
        z-index: 999999;
        border: 2px solid #0f0;
        max-height: 80vh;
        overflow-y: auto;
        box-shadow: 0 4px 12px rgba(0, 255, 0, 0.3);
    `;
    
    // Hidden by default - press D to toggle
    debugPanel.style.display = 'none';
    document.body.appendChild(debugPanel);
    
    // Debug state
    const debugState = {
        pageType: null,  // 'controller' or 'projection'
        lastSentBbox: null,
        lastReceivedBbox: null,
        lastCalculatedPercentages: null,
        lastPixelCoords: null,
        mapDimensions: null,
        modelDimensions: null,
        zoom: null,
        wsStatus: 'disconnected',
        updateCount: 0,
        lastUpdateTime: null
    };
    
    // Detect page type
    if (window.location.pathname.includes('projection.html')) {
        debugState.pageType = 'projection';
    } else {
        debugState.pageType = 'controller';
    }
    
    // Update debug display
    function updateDebugPanel() {
        const now = Date.now();
        const timeSinceUpdate = debugState.lastUpdateTime 
            ? `${((now - debugState.lastUpdateTime) / 1000).toFixed(1)}s ago`
            : 'never';
        
        let html = `<div style="font-weight: bold; margin-bottom: 10px; color: #ff0;">
            DEBUG MODE [${debugState.pageType.toUpperCase()}] - Press D to toggle
        </div>`;
        
        // WebSocket status
        html += `<div style="border-top: 1px solid #0f0; padding-top: 5px; margin-top: 5px;">`;
        html += `<div style="color: ${debugState.wsStatus === 'connected' ? '#0f0' : '#f00'};">
            WebSocket: ${debugState.wsStatus.toUpperCase()}
        </div>`;
        html += `<div>Updates: ${debugState.updateCount} (${timeSinceUpdate})</div>`;
        html += `</div>`;
        
        // Controller-specific info
        if (debugState.pageType === 'controller') {
            if (debugState.mapDimensions) {
                html += '<div style="border-top: 1px solid #0f0; padding-top: 5px; margin-top: 5px;">';
                html += '<div style="color: #ff0;">MAP VIEWPORT (pixels):</div>';
                html += `<div>Width: ${debugState.mapDimensions.width}px</div>`;
                html += `<div>Height: ${debugState.mapDimensions.height}px</div>`;
                html += `<div>Aspect: ${debugState.mapDimensions.aspect.toFixed(3)}</div>`;
                if (debugState.zoom !== null) {
                    html += `<div>Zoom: ${debugState.zoom}</div>`;
                }
                html += '</div>';
            }
            
            if (debugState.lastSentBbox) {
                const bbox = debugState.lastSentBbox;
                html += '<div style="border-top: 1px solid #0f0; padding-top: 5px; margin-top: 5px;">';
                html += '<div style="color: #ff0;">SENT BBOX (EPSG:2039 meters):</div>';
                html += `<div>SW: ${bbox[0].toFixed(2)}, ${bbox[1].toFixed(2)}</div>`;
                html += `<div>NE: ${bbox[2].toFixed(2)}, ${bbox[3].toFixed(2)}</div>`;
                html += `<div>Width: ${(bbox[2] - bbox[0]).toFixed(2)}m</div>`;
                html += `<div>Height: ${(bbox[3] - bbox[1]).toFixed(2)}m</div>`;
                html += `<div>Aspect: ${((bbox[2] - bbox[0]) / (bbox[3] - bbox[1])).toFixed(3)}</div>`;
                html += '</div>';
            }
        }
        
        // Projection-specific info
        if (debugState.pageType === 'projection') {
            if (debugState.modelDimensions) {
                html += '<div style="border-top: 1px solid #0f0; padding-top: 5px; margin-top: 5px;">';
                html += '<div style="color: #ff0;">MODEL IMAGE:</div>';
                html += `<div>Width: ${debugState.modelDimensions.width}px</div>`;
                html += `<div>Height: ${debugState.modelDimensions.height}px</div>`;
                html += `<div>Aspect: ${debugState.modelDimensions.aspect.toFixed(3)}</div>`;
                html += '</div>';
            }
            
            if (debugState.lastReceivedBbox) {
                const bbox = debugState.lastReceivedBbox;
                html += '<div style="border-top: 1px solid #0f0; padding-top: 5px; margin-top: 5px;">';
                html += '<div style="color: #ff0;">RECEIVED BBOX (EPSG:2039):</div>';
                html += `<div>SW: ${bbox[0].toFixed(2)}, ${bbox[1].toFixed(2)}</div>`;
                html += `<div>NE: ${bbox[2].toFixed(2)}, ${bbox[3].toFixed(2)}</div>`;
                html += `<div>Width: ${(bbox[2] - bbox[0]).toFixed(2)}m</div>`;
                html += `<div>Height: ${(bbox[3] - bbox[1]).toFixed(2)}m</div>`;
                html += '</div>';
            }
            
            if (debugState.lastPixelCoords) {
                const px = debugState.lastPixelCoords;
                html += '<div style="border-top: 1px solid #0f0; padding-top: 5px; margin-top: 5px;">';
                html += '<div style="color: #ff0;">PIXEL COORDINATES:</div>';
                html += `<div>Min: (${px.pxMin.toFixed(1)}, ${px.pyMin.toFixed(1)})</div>`;
                html += `<div>Max: (${px.pxMax.toFixed(1)}, ${px.pyMax.toFixed(1)})</div>`;
                html += `<div>Size: ${(px.pxMax - px.pxMin).toFixed(1)} x ${(px.pyMax - px.pyMin).toFixed(1)} px</div>`;
                html += '</div>';
            }
            
            if (debugState.lastCalculatedPercentages) {
                const pct = debugState.lastCalculatedPercentages;
                html += '<div style="border-top: 1px solid #0f0; padding-top: 5px; margin-top: 5px;">';
                html += '<div style="color: #ff0;">HIGHLIGHT (% of model):</div>';
                html += `<div>Left: ${pct.left.toFixed(2)}%</div>`;
                html += `<div>Top: ${pct.top.toFixed(2)}%</div>`;
                html += `<div>Width: ${pct.width.toFixed(2)}%</div>`;
                html += `<div>Height: ${pct.height.toFixed(2)}%</div>`;
                html += '</div>';
            }
        }
        
        debugPanel.innerHTML = html;
    }
    
    // Toggle debug panel with 'D' key
    let debugVisible = false;  // Hidden by default
    window.addEventListener('keydown', (e) => {
        if (e.key === 'D' || e.key === 'd') {
            debugVisible = !debugVisible;
            debugPanel.style.display = debugVisible ? 'block' : 'none';
            console.log(`[DEBUG] Panel ${debugVisible ? 'shown' : 'hidden'}`);
        }
    });
    
    // Export functions for use in other scripts
    window.DebugOverlay = {
        setPageType: (type) => {
            debugState.pageType = type;
            updateDebugPanel();
        },
        
        setWebSocketStatus: (status) => {
            debugState.wsStatus = status;
            updateDebugPanel();
        },
        
        setZoom: (zoom) => {
            debugState.zoom = zoom;
            updateDebugPanel();
        },
        
        updateMapDimensions: (width, height) => {
            debugState.mapDimensions = {
                width,
                height,
                aspect: width / height
            };
            updateDebugPanel();
        },
        
        updateSentBbox: (bbox) => {
            debugState.lastSentBbox = bbox;
            debugState.updateCount++;
            debugState.lastUpdateTime = Date.now();
            updateDebugPanel();
        },
        
        updateReceivedBbox: (bbox) => {
            debugState.lastReceivedBbox = bbox;
            debugState.updateCount++;
            debugState.lastUpdateTime = Date.now();
            updateDebugPanel();
        },
        
        updatePixelCoords: (pxMin, pyMin, pxMax, pyMax) => {
            debugState.lastPixelCoords = { pxMin, pyMin, pxMax, pyMax };
            updateDebugPanel();
        },
        
        updateHighlightPercentages: (left, top, width, height) => {
            debugState.lastCalculatedPercentages = { left, top, width, height };
            updateDebugPanel();
        },
        
        updateModelDimensions: (width, height) => {
            debugState.modelDimensions = {
                width,
                height,
                aspect: width / height
            };
            updateDebugPanel();
        }
    };
    
    // Initial update
    updateDebugPanel();
    
    console.log('[DEBUG] Debug overlay loaded - Press D to toggle');
})();
