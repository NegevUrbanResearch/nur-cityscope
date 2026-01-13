// OTEF Shared WebSocket Client
// Provides connection management, auto-reconnect, and message handling

class OTEFWebSocketClient {
  constructor(url, options = {}) {
    this.url = url;
    this.ws = null;
    this.reconnectTimeout = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts || Infinity;
    this.reconnectDelay = options.reconnectDelay || 3000;
    this.maxReconnectDelay = options.maxReconnectDelay || 30000;
    this.listeners = new Map();
    this.isConnected = false;
    this.isConnecting = false;

    // Connection status callbacks
    this.onConnectCallback = options.onConnect || null;
    this.onDisconnectCallback = options.onDisconnect || null;
    this.onErrorCallback = options.onError || null;
  }

  /**
   * Connect to WebSocket server
   */
  connect() {
    if (
      this.isConnecting ||
      (this.ws && this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log("[OTEF WS] Already connected");
      return;
    }

    this.isConnecting = true;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = this.url.startsWith("ws")
      ? this.url
      : `${protocol}//${window.location.host}${this.url}`;

    console.log("[OTEF WS] Connecting to:", wsUrl);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log("[OTEF WS] Connected");
        this.isConnected = true;
        this.isConnecting = false;
        this.reconnectAttempts = 0;

        if (this.onConnectCallback) {
          this.onConnectCallback();
        }

        this.emit("connect");
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch (error) {
          console.error(
            "[OTEF WS] Failed to parse message:",
            error,
            event.data
          );
        }
      };

      this.ws.onclose = () => {
        console.log("[OTEF WS] Disconnected");
        this.isConnected = false;
        this.isConnecting = false;

        if (this.onDisconnectCallback) {
          this.onDisconnectCallback();
        }

        this.emit("disconnect");
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        console.error("[OTEF WS] Error:", error);
        this.isConnected = false;

        if (this.onErrorCallback) {
          this.onErrorCallback(error);
        }

        this.emit("error", error);
      };
    } catch (error) {
      console.error("[OTEF WS] Connection error:", error);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log("[OTEF WS] Max reconnection attempts reached");
      return;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );

    this.reconnectAttempts++;
    console.log(
      `[OTEF WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`
    );

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
    this.isConnecting = false;
  }

  /**
   * Send a message
   * @param {Object} message - Message object to send
   * @returns {boolean} True if sent successfully
   */
  send(message) {
    if (
      !this.isConnected ||
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN
    ) {
      console.warn("[OTEF WS] Cannot send message: not connected");
      return false;
    }

    try {
      const json = JSON.stringify(message);
      this.ws.send(json);
      return true;
    } catch (error) {
      console.error("[OTEF WS] Failed to send message:", error);
      return false;
    }
  }

  /**
   * Handle incoming message and emit to listeners
   * @param {Object} msg - Parsed message object
   */
  handleMessage(msg) {
    // Emit to type-specific listeners
    if (msg.type) {
      this.emit(msg.type, msg);
    }

    // Emit to generic message listeners
    this.emit("message", msg);
  }

  /**
   * Register a listener for a specific message type or event
   * @param {string} event - Event name (message type or 'connect', 'disconnect', 'error', 'message')
   * @param {Function} callback - Callback function
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  /**
   * Remove a listener
   * @param {string} event - Event name
   * @param {Function} callback - Callback function to remove
   */
  off(event, callback) {
    if (!this.listeners.has(event)) return;

    const callbacks = this.listeners.get(event);
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
    }
  }

  /**
   * Emit an event to all registered listeners
   * @param {string} event - Event name
   * @param {...any} args - Arguments to pass to listeners
   */
  emit(event, ...args) {
    if (!this.listeners.has(event)) return;

    const callbacks = this.listeners.get(event);
    callbacks.forEach((callback) => {
      try {
        callback(...args);
      } catch (error) {
        console.error(`[OTEF WS] Error in listener for ${event}:`, error);
      }
    });
  }

  /**
   * Get connection status
   * @returns {boolean} True if connected
   */
  getConnected() {
    return this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

// Export for use in other modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = OTEFWebSocketClient;
}
