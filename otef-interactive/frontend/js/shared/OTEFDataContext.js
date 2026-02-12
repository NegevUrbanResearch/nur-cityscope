// OTEFDataContext
// Centralized state management for OTEF viewport, layers, animations, bounds, and connection
// Phase 1: read-only mirror of server state via OTEF_API + a single OTEFWebSocketClient

// Use global logger (loaded via script tag)
function getLogger() {
  const internals =
    (typeof window !== "undefined" && window.OTEFDataContextInternals) || {};
  if (typeof internals.getLogger === "function") {
    return internals.getLogger();
  }
  return (
    (typeof window !== "undefined" && window.logger) || {
      debug: () => {},
      info: () => {},
      warn: console.warn.bind(console),
      error: console.error.bind(console),
    }
  );
}

function getInternals() {
  return (
    (typeof window !== "undefined" && window.OTEFDataContextInternals) || {}
  );
}

class OTEFDataContextClass {
  constructor() {
    this._tableName = null;

    // Cached state
    this._viewport = null; // { bbox, corners?, zoom }
    this._layerGroups = null; // [{ id, enabled, layers: [{ id, enabled }] }] - hierarchical structure
    this._animations = null;
    this._bounds = null; // bounds_polygon from backend
    this._isConnected = false;

    // Subscriptions: key -> Set<callback>
    this._subscribers = {
      viewport: new Set(),
      layerGroups: new Set(),
      animations: new Set(),
      bounds: new Set(),
      connection: new Set(),
    };

    this._wsClient = null;
    this._initialized = false;
    this._initializingPromise = null;

    // Interaction bookkeeping
    this._clientId = Math.random().toString(36).substring(2, 10);
    this._currentInteractionSource = null; // 'remote', 'gis', etc.
    this._velocity = { vx: 0, vy: 0 }; // units per second
    this._lastVelocityUpdate = 0;
    this._lastLocalStateTimestamp = 0;
  }

  /**
   * Initialize the DataContext for a given table.
   * Safe to call multiple times; subsequent calls will await the first.
   */
  async init(tableName = "otef") {
    if (this._initialized && this._tableName === tableName) {
      return;
    }
    if (this._initializingPromise) {
      return this._initializingPromise;
    }

    this._initializingPromise = this._doInit(tableName);
    return this._initializingPromise;
  }

  async _doInit(tableName) {
    this._tableName = tableName;

    try {
      // Fetch initial state from API
      const state = await OTEF_API.getState(this._tableName);
      this._applyStateFromApi(state, { notify: false });

      // Set up WebSocket
      this._setupWebSocket();

      this._initialized = true;
    } finally {
      this._initializingPromise = null;
    }
  }

  _setupWebSocket() {
    const { websocket } = getInternals();
    if (!websocket || typeof websocket.setupWebSocket !== "function") {
      getLogger().error("[OTEFDataContext] Missing websocket helpers");
      return;
    }
    websocket.setupWebSocket(this);
  }

  _applyStateFromApi(state, { notify } = { notify: true }) {
    const { websocket } = getInternals();
    if (!websocket || typeof websocket.applyStateFromApi !== "function") {
      getLogger().error("[OTEFDataContext] Missing websocket helpers");
      return;
    }
    websocket.applyStateFromApi(this, state, { notify });
  }

  _setConnection(isConnected) {
    if (this._isConnected === isConnected) return;
    this._isConnected = isConnected;
    this._notify("connection", this._isConnected);
  }

  _setViewport(viewport) {
    this._viewport = viewport;
    this._notify("viewport", this._viewport);
  }

  _setLayerGroups(layerGroups) {
    this._layerGroups = layerGroups;
    this._notify("layerGroups", this._layerGroups);
  }

  _setAnimations(animations) {
    this._animations = animations;
    this._notify("animations", this._animations);
  }

  _setBounds(bounds) {
    this._bounds = bounds;
    this._notify("bounds", this._bounds);
  }

  _notify(key, value) {
    const subs = this._subscribers[key];
    if (!subs || subs.size === 0) return;
    subs.forEach((cb) => {
      try {
        cb(value);
      } catch (err) {
        getLogger().error(`[OTEFDataContext] Error in ${key} subscriber:`, err);
      }
    });
  }

  // Public API: getters
  getViewport() {
    return this._viewport;
  }

  getLayerGroups() {
    return this._layerGroups;
  }

  getAnimations() {
    return this._animations;
  }

  getBounds() {
    return this._bounds;
  }

  isConnected() {
    return this._isConnected;
  }

  /**
   * Persist new bounds polygon (hard-wall navigation limits).
   * Optimistically updates local state, then calls backend to:
   * - store bounds_polygon in DB
   * - mirror polygon into model-bounds.json on disk
   *
   * @param {Array<{x:number,y:number}>} polygon
   */
  async saveBounds(polygon) {
    const { bounds } = getInternals();
    if (!bounds || typeof bounds.saveBounds !== "function") {
      getLogger().error("[OTEFDataContext] Missing bounds helpers");
      return { ok: false, error: "Missing bounds helpers" };
    }
    return bounds.saveBounds(this, polygon);
  }

  /**
   * Pan the viewport in a given direction with optional delta.
   * Applies hard-wall bounds check before sending the command.
   *
   * @param {string} direction - 'north', 'south', 'east', 'west', 'northeast', etc.
   * @param {number} [delta=0.15] - Fraction of viewport size to pan
   */
  async pan(direction, delta = 0.15) {
    const { actions } = getInternals();
    if (!actions || typeof actions.pan !== "function") {
      getLogger().error("[OTEFDataContext] Missing action helpers");
      return;
    }
    return actions.pan(this, direction, delta);
  }

  /**
   * Send a velocity update for continuous movement.
   *
   * @param {number} vx - X velocity (ITM units/sec)
   * @param {number} vy - Y velocity (ITM units/sec)
   */
  sendVelocity(vx, vy) {
    const { actions } = getInternals();
    if (!actions || typeof actions.sendVelocity !== "function") {
      getLogger().error("[OTEFDataContext] Missing action helpers");
      return;
    }
    return actions.sendVelocity(this, vx, vy);
  }

  _startVelocityLoop() {
    const { actions } = getInternals();
    if (!actions || typeof actions.startVelocityLoop !== "function") {
      getLogger().error("[OTEFDataContext] Missing action helpers");
      return;
    }
    return actions.startVelocityLoop(this);
  }

  /**
   * Zoom the viewport to a target level.
   * Applies hard-wall bounds check before sending the command.
   *
   * @param {number} newZoom - Target zoom level
   */
  async zoom(newZoom) {
    const { actions } = getInternals();
    if (!actions || typeof actions.zoom !== "function") {
      getLogger().error("[OTEFDataContext] Missing action helpers");
      return;
    }
    return actions.zoom(this, newZoom);
  }

  /**
   * Update viewport from a UI source (e.g. GIS map).
   * This is the main entry point for continuous panning/zooming.
   * Applies hard-wall bounds check and debounces the backend write.
   *
   * @param {Object} viewport - { bbox: [minX,minY,maxX,maxY], corners?, zoom? }
   * @param {string} [source] - Optional interaction source label, e.g. 'gis'
   */
  updateViewportFromUI(viewport, source = "gis") {
    const { actions } = getInternals();
    if (!actions || typeof actions.updateViewportFromUI !== "function") {
      getLogger().error("[OTEFDataContext] Missing action helpers");
      return false;
    }
    return actions.updateViewportFromUI(this, viewport, source);
  }

  /**
   * Toggle a layer's visibility with optimistic update and rollback on error.
   * Supports both legacy flat structure and new hierarchical structure.
   *
   * @param {string} layerId - Full layer ID (e.g., "map_3_future.mimushim") or legacy ID
   * @param {boolean} enabled
   */
  async toggleLayer(layerId, enabled) {
    const { actions } = getInternals();
    if (!actions || typeof actions.toggleLayer !== "function") {
      getLogger().error("[OTEFDataContext] Missing action helpers");
      return { ok: false, error: "Missing action helpers" };
    }
    return actions.toggleLayer(this, layerId, enabled);
  }

  /**
   * Set enabled state for multiple layers in one update (one API call).
   * Use when toggling a consolidated row (e.g. October 7th) so all sub-layers update in a single request.
   *
   * @param {string[]} fullLayerIds - Full layer ids (e.g. ["october_7th.layer1", "october_7th.layer2"])
   * @param {boolean} enabled
   */
  async setLayersEnabled(fullLayerIds, enabled) {
    const { actions } = getInternals();
    if (!actions || typeof actions.setLayersEnabled !== "function") {
      getLogger().error("[OTEFDataContext] Missing action helpers");
      return { ok: false, error: "Missing action helpers" };
    }
    return actions.setLayersEnabled(this, fullLayerIds, enabled);
  }

  /**
   * Toggle a layer within the hierarchical groups structure.
   */
  async _toggleLayerInGroups(layerId, enabled) {
    const { actions } = getInternals();
    if (!actions || typeof actions.toggleLayerInGroups !== "function") {
      getLogger().error("[OTEFDataContext] Missing action helpers");
      return { ok: false, error: "Missing action helpers" };
    }
    return actions.toggleLayerInGroups(this, layerId, enabled);
  }

  /**
   * Toggle an entire group on/off.
   *
   * @param {string} groupId - Group ID (e.g., "map_3_future")
   * @param {boolean} enabled
   */
  async toggleGroup(groupId, enabled) {
    const { actions } = getInternals();
    if (!actions || typeof actions.toggleGroup !== "function") {
      getLogger().error("[OTEFDataContext] Missing action helpers");
      return { ok: false, error: "Missing action helpers" };
    }
    return actions.toggleGroup(this, groupId, enabled);
  }

  /**
   * Toggle an animation flag with optimistic update.
   *
   * @param {string} layerId
   * @param {boolean} enabled
   */
  async toggleAnimation(layerId, enabled) {
    const { actions } = getInternals();
    if (!actions || typeof actions.toggleAnimation !== "function") {
      getLogger().error("[OTEFDataContext] Missing action helpers");
      return { ok: false, error: "Missing action helpers" };
    }
    return actions.toggleAnimation(this, layerId, enabled);
  }

  /**
   * Compute candidate viewport for a pan command, mirroring backend logic.
   *
   * @param {Object} viewport - Current viewport
   * @param {string} direction
   * @param {number} delta
   * @returns {Object} candidate viewport
   */
  _computePanViewport(viewport, direction, delta) {
    const { actions } = getInternals();
    if (!actions || typeof actions.computePanViewport !== "function") {
      getLogger().error("[OTEFDataContext] Missing action helpers");
      return viewport;
    }
    return actions.computePanViewport(viewport, direction, delta);
  }

  /**
   * Compute candidate viewport for a zoom command, mirroring backend logic.
   *
   * @param {Object} viewport - Current viewport
   * @param {number} newZoom
   * @returns {Object} candidate viewport
   */
  _computeZoomViewport(viewport, newZoom) {
    const { actions } = getInternals();
    if (!actions || typeof actions.computeZoomViewport !== "function") {
      getLogger().error("[OTEFDataContext] Missing action helpers");
      return viewport;
    }
    return actions.computeZoomViewport(viewport, newZoom);
  }

  /**
   * Check whether a viewport is inside the current bounds polygon.
   *
   * Updated semantics (UX-driven):
   * - We only require the **viewport center** to be inside the bounds polygon.
   * - The highlight edges are allowed to extend beyond the polygon,
   *   which makes high-zoom movement much less restricted while still
   *   enforcing a hard wall on how far the user can "travel".
   *
   * If no bounds are defined, always returns true.
   *
   * @param {Object} viewport - { bbox: [minX,minY,maxX,maxY], corners? }
   * @returns {boolean}
   */
  _isViewportInsideBounds(viewport) {
    const { bounds } = getInternals();
    if (!bounds || typeof bounds.isViewportInsideBounds !== "function") {
      getLogger().error("[OTEFDataContext] Missing bounds helpers");
      return true;
    }
    return bounds.isViewportInsideBounds(this, viewport);
  }

  /**
   * Standard ray-casting point-in-polygon test.
   * Treats points on the edge as inside.
   *
   * @param {{x:number,y:number}} point
   * @param {Array<{x:number,y:number}>} polygon
   * @returns {boolean}
   */
  _pointInPolygon(point, polygon) {
    const { bounds } = getInternals();
    if (!bounds || typeof bounds.pointInPolygon !== "function") {
      getLogger().error("[OTEFDataContext] Missing bounds helpers");
      return false;
    }
    return bounds.pointInPolygon(point, polygon);
  }

  /**
   * Subscribe to a slice of state.
   * Immediately calls the callback with the current value (if any).
   */
  subscribe(key, callback) {
    const subs = this._subscribers[key];
    if (!subs) {
      getLogger().warn("[OTEFDataContext] Unknown subscription key:", key);
      return () => {};
    }

    subs.add(callback);

    // Replay current value
    let current = null;
    switch (key) {
      case "viewport":
        current = this._viewport;
        break;
      case "layerGroups":
        current = this._layerGroups;
        break;
      case "animations":
        current = this._animations;
        break;
      case "bounds":
        current = this._bounds;
        break;
      case "connection":
        current = this._isConnected;
        break;
    }
    if (current !== null && current !== undefined) {
      try {
        callback(current);
      } catch (err) {
        getLogger().error(
          "[OTEFDataContext] Error in initial callback for",
          key,
          err,
        );
      }
    }

    // Return unsubscribe function
    return () => {
      subs.delete(callback);
    };
  }

  unsubscribe(key, callback) {
    const subs = this._subscribers[key];
    if (!subs) return;
    subs.delete(callback);
  }
}

// Singleton instance
const OTEFDataContext = new OTEFDataContextClass();

// Export for use in other modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = OTEFDataContext;
}
