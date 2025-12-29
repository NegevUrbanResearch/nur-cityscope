// Initialize Maptastic for projection mapping
const maptastic = Maptastic({
    container: "keystoneContainer",
    screenbounds: false,  // Disable grid overlay
    crosshairs: false,    // Disable crosshairs
    labels: false         // Disable layer labels
});
let configActive = false;

// Force hide calibration grid on load
setTimeout(() => {
    maptastic.setConfigEnabled(false);
    console.log('Calibration grid hidden');
}, 100);

// Get UI elements
const $calibrationPanel = document.getElementById("calibrationPanel");
const $calibrationStatus = document.getElementById("calibrationStatus");
const $toggleConfigBtn = document.getElementById("toggleConfigBtn");

// Load model bounds
let modelBounds;
fetch('data/model-bounds.json')
    .then(res => res.json())
    .then(bounds => {
        modelBounds = bounds;
        console.log('Model bounds loaded:', bounds);
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
        };
        
        ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            
            if (message.type === 'otef_viewport_update') {
                console.log('Received viewport update:', message.bbox);
                updateHighlight(message.bbox);
            }
        };
        
        ws.onclose = () => {
            console.log('Projection WebSocket disconnected, reconnecting...');
            reconnectTimeout = setTimeout(connectWebSocket, 3000);
        };
        
        ws.onerror = (error) => {
            console.error('Projection WebSocket error:', error);
        };
    } catch (err) {
        console.error('Projection WebSocket connection failed:', err);
        reconnectTimeout = setTimeout(connectWebSocket, 3000);
    }
}

// Update highlight overlay based on viewport bbox
function updateHighlight(itmBbox) {
    if (!modelBounds) {
        console.warn('Model bounds not loaded yet');
        return;
    }
    
    // Store for resize events
    lastBbox = itmBbox;
    
    console.log('Received ITM bbox:', itmBbox);
    console.log('Model bounds:', modelBounds);
    
    // Convert ITM bbox to pixel coordinates
    const [pxMin, pyMin, pxMax, pyMax] = CoordUtils.bboxItmToPixel(itmBbox, modelBounds);
    
    console.log('Pixel coordinates:', { pxMin, pyMin, pxMax, pyMax });
    
    // Calculate position and size as PERCENTAGES of the source image
    // Maptastic will transform both the image and the overlay together
    const left = (pxMin / modelBounds.image_width) * 100;
    const top = (pyMin / modelBounds.image_height) * 100;
    const width = ((pxMax - pxMin) / modelBounds.image_width) * 100;
    const height = ((pyMax - pyMin) / modelBounds.image_height) * 100;
    
    console.log('Highlight percentages:', { left, top, width, height });
    
    // Update or create highlight box
    const overlay = document.getElementById('highlightOverlay');
    let highlightBox = overlay.querySelector('.highlight-box');
    
    if (!highlightBox) {
        highlightBox = document.createElement('div');
        highlightBox.className = 'highlight-box';
        overlay.appendChild(highlightBox);
    }
    
    // Use percentages so Maptastic transforms the overlay with the image
    highlightBox.style.left = `${left}%`;
    highlightBox.style.top = `${top}%`;
    highlightBox.style.width = `${width}%`;
    highlightBox.style.height = `${height}%`;
}

// Toggle calibration config mode
function toggleConfigMode() {
    configActive = !configActive;
    maptastic.setConfigEnabled(configActive);
    $calibrationStatus.textContent = configActive
        ? "Configuration Mode ON"
        : "Configuration Mode OFF";
    $calibrationPanel.style.display = configActive ? "block" : "none";

    // Show calibration grid and canvas when in config mode
    document.getElementById("calibrationGrid").style.display = configActive ? "block" : "none";
    document.body.classList.toggle('config-mode', configActive);
}

// Reset calibration to defaults
function resetCalibration() {
    console.log("resetCalibration function called");
    if (confirm("Are you sure you want to reset the calibration?")) {
        console.log("User confirmed reset");
        localStorage.removeItem("maptastic.layers");
        console.log("Cleared localStorage");

        // Reset the maptastic layout to default without page reload
        if (maptastic && maptastic.getLayout) {
            const currentLayout = maptastic.getLayout();
            console.log("Current layout before reset:", currentLayout);

            // Reset each layer to default positions
            for (let i = 0; i < currentLayout.length; i++) {
                const layer = currentLayout[i];
                if (layer.targetPoints && layer.sourcePoints) {
                    // Reset target points to match source points (no transformation)
                    layer.targetPoints = layer.sourcePoints.map((point) => [
                        ...point,
                    ]);
                }
            }

            console.log("Layout after reset:", currentLayout);
            maptastic.setLayout(currentLayout);
            console.log("Applied reset layout");
        }

        alert("Calibration reset to defaults!");
    } else {
        console.log("User cancelled reset");
    }
}

// Auto-reset calibration on page load to fix sideways display
function autoResetCalibration() {
    // Only reset if there's problematic saved data
    const savedData = localStorage.getItem("maptastic.layers");
    if (savedData) {
        try {
            const layout = JSON.parse(savedData);
            // Check if any layer has been rotated 90 degrees (sideways)
            let hasProblematicRotation = false;

            for (let i = 0; i < layout.length; i++) {
                const layer = layout[i];
                if (layer.targetPoints && layer.sourcePoints) {
                    // Check if the layer has been rotated 90 degrees
                    // This is a simple heuristic - if the aspect ratio is significantly different
                    const sourceWidth =
                        layer.sourcePoints[1][0] - layer.sourcePoints[0][0];
                    const sourceHeight =
                        layer.sourcePoints[2][1] - layer.sourcePoints[0][1];
                    const targetWidth =
                        layer.targetPoints[1][0] - layer.targetPoints[0][0];
                    const targetHeight =
                        layer.targetPoints[2][1] - layer.targetPoints[0][1];

                    const sourceRatio = sourceWidth / sourceHeight;
                    const targetRatio = targetWidth / targetHeight;

                    // If ratios are very different, it might be rotated
                    if (Math.abs(sourceRatio - 1 / targetRatio) < 0.1) {
                        hasProblematicRotation = true;
                        break;
                    }
                }
            }

            // Only reset if we detect problematic rotation
            if (hasProblematicRotation) {
                console.log("Detected sideways rotation, resetting to default");
                localStorage.removeItem("maptastic.layers");
            }
        } catch (error) {
            console.log("Error parsing saved data, clearing it");
            localStorage.removeItem("maptastic.layers");
        }
    }
}

// Event listeners for calibration panel
$toggleConfigBtn.addEventListener("click", toggleConfigMode);

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

// Keyboard event listener for calibration toggle and other shortcuts
window.addEventListener("keydown", function (event) {
    // Shift+Z to toggle configuration mode
    if (event.key === "Z" && event.shiftKey) {
        toggleConfigMode();
    }

    // X key for reset calibration
    if (event.key === "X" || event.keyCode === 88) {
        console.log("X key pressed - resetting calibration");
        resetCalibration();
    }

    // F key for fullscreen
    if (event.keyCode === 70) {
        toggleFullScreen();
    }
});

// Auto-reset calibration to fix sideways display
autoResetCalibration();

// Store last bbox for redrawing on resize
let lastBbox = null;

// Update highlight on window resize (since object-fit: contain changes the displayed size)
window.addEventListener('resize', () => {
    if (lastBbox) {
        updateHighlight(lastBbox);
    }
});

// Connect on load
connectWebSocket();


