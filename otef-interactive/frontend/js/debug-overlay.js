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
    
    function updateDebugPanel() {
        const now = Date.now();
        const timeSinceUpdate = debugState.lastUpdateTime 
            ? `${((now - debugState.lastUpdateTime) / 1000).toFixed(1)}s ago`
            : 'never';
        
        const section = (title, content) => `<div style="border-top: 1px solid #0f0; padding-top: 5px; margin-top: 5px;">${content}</div>`;
        const wsColor = debugState.wsStatus === 'connected' ? '#0f0' : '#f00';
        
        let html = `<div style="font-weight: bold; margin-bottom: 10px; color: #ff0;">
            DEBUG MODE [${debugState.pageType.toUpperCase()}] - Press D to toggle
        </div>`;
        
        html += section('', `
            <div style="color: ${wsColor};">WebSocket: ${debugState.wsStatus.toUpperCase()}</div>
            <div>Updates: ${debugState.updateCount} (${timeSinceUpdate})</div>
        `);
        
        if (debugState.pageType === 'controller') {
            if (debugState.mapDimensions) {
                const d = debugState.mapDimensions;
                html += section('MAP VIEWPORT (pixels)', `
                    <div style="color: #ff0;">MAP VIEWPORT (pixels):</div>
                    <div>Width: ${d.width}px</div>
                    <div>Height: ${d.height}px</div>
                    <div>Aspect: ${d.aspect.toFixed(3)}</div>
                    ${debugState.zoom !== null ? `<div>Zoom: ${debugState.zoom}</div>` : ''}
                `);
            }
            
            if (debugState.lastSentBbox) {
                const b = debugState.lastSentBbox;
                const w = b[2] - b[0], h = b[3] - b[1];
                html += section('SENT BBOX (EPSG:2039 meters)', `
                    <div style="color: #ff0;">SENT BBOX (EPSG:2039 meters):</div>
                    <div>SW: ${b[0].toFixed(2)}, ${b[1].toFixed(2)}</div>
                    <div>NE: ${b[2].toFixed(2)}, ${b[3].toFixed(2)}</div>
                    <div>Width: ${w.toFixed(2)}m</div>
                    <div>Height: ${h.toFixed(2)}m</div>
                    <div>Aspect: ${(w / h).toFixed(3)}</div>
                `);
            }
        }
        
        if (debugState.pageType === 'projection') {
            if (debugState.modelDimensions) {
                const d = debugState.modelDimensions;
                html += section('MODEL IMAGE', `
                    <div style="color: #ff0;">MODEL IMAGE:</div>
                    <div>Width: ${d.width}px</div>
                    <div>Height: ${d.height}px</div>
                    <div>Aspect: ${d.aspect.toFixed(3)}</div>
                `);
            }
            
            if (debugState.lastReceivedBbox) {
                const b = debugState.lastReceivedBbox;
                html += section('RECEIVED BBOX (EPSG:2039)', `
                    <div style="color: #ff0;">RECEIVED BBOX (EPSG:2039):</div>
                    <div>SW: ${b[0].toFixed(2)}, ${b[1].toFixed(2)}</div>
                    <div>NE: ${b[2].toFixed(2)}, ${b[3].toFixed(2)}</div>
                    <div>Width: ${(b[2] - b[0]).toFixed(2)}m</div>
                    <div>Height: ${(b[3] - b[1]).toFixed(2)}m</div>
                `);
            }
            
            if (debugState.lastPixelCoords) {
                const p = debugState.lastPixelCoords;
                html += section('PIXEL COORDINATES', `
                    <div style="color: #ff0;">PIXEL COORDINATES:</div>
                    <div>Min: (${p.pxMin.toFixed(1)}, ${p.pyMin.toFixed(1)})</div>
                    <div>Max: (${p.pxMax.toFixed(1)}, ${p.pyMax.toFixed(1)})</div>
                    <div>Size: ${(p.pxMax - p.pxMin).toFixed(1)} x ${(p.pyMax - p.pyMin).toFixed(1)} px</div>
                `);
            }
            
            if (debugState.lastCalculatedPercentages) {
                const p = debugState.lastCalculatedPercentages;
                html += section('HIGHLIGHT (% of model)', `
                    <div style="color: #ff0;">HIGHLIGHT (% of model):</div>
                    <div>Left: ${p.left.toFixed(2)}%</div>
                    <div>Top: ${p.top.toFixed(2)}%</div>
                    <div>Width: ${p.width.toFixed(2)}%</div>
                    <div>Height: ${p.height.toFixed(2)}%</div>
                `);
            }
        }
        
        debugPanel.innerHTML = html;
    }
    
    let debugVisible = false;
    window.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'd') {
            debugVisible = !debugVisible;
            debugPanel.style.display = debugVisible ? 'block' : 'none';
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
