let ws;
let reconnectTimeout;

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/otef/`;
    
    console.log('Connecting to WebSocket:', wsUrl);
    
    try {
        ws = new WebSocket(wsUrl);
        window.ws = ws;
        
        ws.onopen = () => {
            console.log('WebSocket connected');
            updateConnectionStatus(true);
            if (window.DebugOverlay) {
                window.DebugOverlay.setWebSocketStatus('connected');
            }
        };
        
        ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            console.log('Received:', message);
        };
        
        ws.onclose = () => {
            console.log('WebSocket disconnected, reconnecting...');
            updateConnectionStatus(false);
            if (window.DebugOverlay) {
                window.DebugOverlay.setWebSocketStatus('disconnected');
            }
            reconnectTimeout = setTimeout(connectWebSocket, 3000);
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            updateConnectionStatus(false);
            if (window.DebugOverlay) {
                window.DebugOverlay.setWebSocketStatus('error');
            }
        };
    } catch (err) {
        console.error('Failed to connect WebSocket:', err);
        reconnectTimeout = setTimeout(connectWebSocket, 3000);
    }
}

function updateConnectionStatus(connected) {
    const statusEl = document.getElementById('connectionStatus');
    if (statusEl) {
        if (connected) {
            statusEl.className = 'status-connected';
            statusEl.title = 'Connected to projection';
        } else {
            statusEl.className = 'status-disconnected';
            statusEl.title = 'Disconnected';
        }
    }
}

// Connect on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', connectWebSocket);
} else {
    connectWebSocket();
}


