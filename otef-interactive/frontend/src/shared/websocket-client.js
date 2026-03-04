import { getLogger } from "./logger.js";

export class OTEFWebSocketClient {
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
    this.onConnectCallback = options.onConnect || null;
    this.onDisconnectCallback = options.onDisconnect || null;
    this.onErrorCallback = options.onError || null;
  }

  connect() {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.CONNECTING)) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    this.isConnecting = true;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = this.url.startsWith("ws")
      ? this.url
      : `${protocol}//${window.location.host}${this.url}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        if (this.onConnectCallback) this.onConnectCallback();
        this.emit("connect");
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch (error) {
          getLogger().error("[OTEF WS] Failed to parse message:", error, event.data);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.isConnecting = false;
        if (this.onDisconnectCallback) this.onDisconnectCallback();
        this.emit("disconnect");
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        getLogger().error("[OTEF WS] Error:", error);
        this.isConnected = false;
        if (this.onErrorCallback) this.onErrorCallback(error);
        this.emit("error", error);
      };
    } catch (error) {
      getLogger().error("[OTEF WS] Connection error:", error);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay,
    );
    this.reconnectAttempts += 1;
    this.reconnectTimeout = setTimeout(() => this.connect(), delay);
  }

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

  send(message) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      getLogger().warn("[OTEF WS] Cannot send message: not connected");
      return false;
    }
    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      getLogger().error("[OTEF WS] Failed to send message:", error);
      return false;
    }
  }

  handleMessage(msg) {
    if (msg.type) this.emit(msg.type, msg);
    this.emit("message", msg);
  }

  on(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(callback);
  }

  off(event, callback) {
    if (!this.listeners.has(event)) return;
    const callbacks = this.listeners.get(event);
    const index = callbacks.indexOf(callback);
    if (index > -1) callbacks.splice(index, 1);
  }

  emit(event, ...args) {
    if (!this.listeners.has(event)) return;
    const callbacks = this.listeners.get(event);
    callbacks.forEach((callback) => {
      try {
        callback(...args);
      } catch (error) {
        getLogger().error(`[OTEF WS] Error in listener for ${event}:`, error);
      }
    });
  }

  getConnected() {
    return this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

if (typeof window !== "undefined") {
  window.OTEFWebSocketClient = OTEFWebSocketClient;
}
