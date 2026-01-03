let ws, reconnectTimeout;

function setDebugStatus(status) {
    if (window.DebugOverlay) window.DebugOverlay.setWebSocketStatus(status);
}

function updateConnectionStatus(connected) {
    const el = document.getElementById('connectionStatus');
    if (el) {
        el.className = connected ? 'status-connected' : 'status-disconnected';
        el.title = connected ? 'Connected to projection' : 'Disconnected';
    }
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/otef/`;
    
    try {
        ws = new WebSocket(wsUrl);
        window.ws = ws;
        
        ws.onopen = () => {
            updateConnectionStatus(true);
            setDebugStatus('connected');
        };
        
        ws.onmessage = (e) => {
            const msg = JSON.parse(e.data);
            console.log('Received:', msg);
        };
        
        ws.onclose = () => {
            updateConnectionStatus(false);
            setDebugStatus('disconnected');
            reconnectTimeout = setTimeout(connectWebSocket, 3000);
        };
        
        ws.onerror = () => {
            updateConnectionStatus(false);
            setDebugStatus('error');
        };
    } catch (err) {
        reconnectTimeout = setTimeout(connectWebSocket, 3000);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', connectWebSocket);
} else {
    connectWebSocket();
}


