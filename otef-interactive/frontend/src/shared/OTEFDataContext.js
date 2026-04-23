import { OTEF_API } from "./api-client.js";
import { OTEFDataContextInternals } from "./otef-data-context/index.js";
import "./otef-data-context/OTEFDataContext-actions.js";
import "./otef-data-context/OTEFDataContext-bounds.js";
import "./otef-data-context/OTEFDataContext-websocket.js";

function getLogger() {
  if (typeof OTEFDataContextInternals.getLogger === "function") {
    return OTEFDataContextInternals.getLogger();
  }
  return {
    debug: () => {},
    info: () => {},
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };
}

function layerGroupsEqual(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ga = a[i],
      gb = b[i];
    if (ga === gb) continue;
    if (ga.id !== gb.id || ga.enabled !== gb.enabled) return false;
    const la = ga.layers || [],
      lb = gb.layers || [];
    if (la.length !== lb.length) return false;
    for (let j = 0; j < la.length; j++) {
      if (la[j].id !== lb[j].id || la[j].enabled !== lb[j].enabled) return false;
    }
  }
  return true;
}

function animationsEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a),
    kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

function viewportEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.zoom !== b.zoom) return false;
  const ba = a.bbox,
    bb = b.bbox;
  if (!ba || !bb || ba.length !== bb.length) return false;
  for (let i = 0; i < ba.length; i++) {
    if (Math.abs(ba[i] - bb[i]) > 0.01) return false;
  }
  return true;
}

class OTEFDataContextClass {
  constructor() {
    this._tableName = null;
    this._viewport = null;
    this._layerGroups = null;
    this._animations = null;
    this._bounds = null;
    this._viewerAngleDeg = 0;
    this._isConnected = false;

    this._subscribers = {
      viewport: new Set(),
      layerGroups: new Set(),
      animations: new Set(),
      bounds: new Set(),
      connection: new Set(),
      orientation: new Set(),
    };

    this._wsClient = null;
    this._initialized = false;
    this._initializingPromise = null;

    this._clientId = Math.random().toString(36).substring(2, 10);
    this._currentInteractionSource = null;
    this._velocity = { vx: 0, vy: 0 };
    this._lastVelocityUpdate = 0;
    this._lastLocalStateTimestamp = 0;
    this._pendingLayerOps = 0;
    this._pendingAnimationOps = 0;
    this._viewportSeq = 0;
  }

  async init(tableName = "otef") {
    if (this._initialized && this._tableName === tableName) return;
    if (this._initializingPromise) return this._initializingPromise;
    this._initializingPromise = this._doInit(tableName);
    return this._initializingPromise;
  }

  /**
   * Re-fetch layer groups from the API (e.g. after workshop autopublish or pull)
   * so clients see new curated_* ids without waiting for WS timing.
   */
  async refreshLayerGroupsFromApi() {
    if (!this._tableName) return;
    try {
      const state = await OTEF_API.getState(this._tableName);
      if (state && state.layerGroups) {
        this._setLayerGroups(state.layerGroups);
      }
    } catch (err) {
      getLogger().error("[OTEFDataContext] refreshLayerGroupsFromApi failed:", err);
    }
  }

  async _doInit(tableName) {
    this._tableName = tableName;
    try {
      const state = await OTEF_API.getState(this._tableName);
      this._applyStateFromApi(state, { notify: false });
      this._setupWebSocket();
      this._initialized = true;
    } finally {
      this._initializingPromise = null;
    }
  }

  _setupWebSocket() {
    const websocket = OTEFDataContextInternals.websocket;
    if (!websocket || typeof websocket.setupWebSocket !== "function") {
      getLogger().error("[OTEFDataContext] Missing websocket helpers");
      return;
    }
    websocket.setupWebSocket(this);
  }

  _applyStateFromApi(state, { notify } = { notify: true }) {
    const websocket = OTEFDataContextInternals.websocket;
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
    if (viewportEqual(this._viewport, viewport)) return;
    this._viewportSeq++;
    this._viewport = viewport;
    this._notify("viewport", this._viewport);
  }

  _setLayerGroups(layerGroups) {
    if (layerGroupsEqual(this._layerGroups, layerGroups)) return;
    this._layerGroups = layerGroups;
    this._notify("layerGroups", this._layerGroups);
  }

  _setAnimations(animations) {
    if (animationsEqual(this._animations, animations)) return;
    this._animations = animations;
    this._notify("animations", this._animations);
  }

  _setBounds(bounds) {
    this._bounds = bounds;
    this._notify("bounds", this._bounds);
  }

  _setViewerAngleDeg(angle) {
    if (typeof angle === "number" && !Number.isNaN(angle)) {
      this._viewerAngleDeg = angle;
      this._notify("orientation", this._viewerAngleDeg);
    }
  }

  _notify(key, value) {
    const subs = this._subscribers[key];
    if (!subs || subs.size === 0) return;
    if (
      typeof window !== "undefined" &&
      window.MapPerfTelemetry &&
      typeof window.MapPerfTelemetry.record === "function"
    ) {
      window.MapPerfTelemetry.record(`notify_${key}_count`, 1);
    }
    subs.forEach((cb) => {
      try {
        cb(value);
      } catch (err) {
        getLogger().error(`[OTEFDataContext] Error in ${key} subscriber:`, err);
      }
    });
  }

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

  getViewerAngleDeg() {
    return this._viewerAngleDeg;
  }

  isConnected() {
    return this._isConnected;
  }

  async saveBounds(polygon, viewerAngleDeg) {
    const bounds = OTEFDataContextInternals.bounds;
    if (!bounds || typeof bounds.saveBounds !== "function") {
      getLogger().error("[OTEFDataContext] Missing bounds helpers");
      return { ok: false, error: "Missing bounds helpers" };
    }
    return bounds.saveBounds(this, polygon, viewerAngleDeg);
  }

  async pan(direction, delta = 0.15) {
    const actions = OTEFDataContextInternals.actions;
    if (!actions || typeof actions.pan !== "function") {
      getLogger().error("[OTEFDataContext] Missing action helpers");
      return;
    }
    return actions.pan(this, direction, delta);
  }

  sendVelocity(vx, vy) {
    const actions = OTEFDataContextInternals.actions;
    if (!actions || typeof actions.sendVelocity !== "function") {
      getLogger().error("[OTEFDataContext] Missing action helpers");
      return;
    }
    return actions.sendVelocity(this, vx, vy);
  }

  _startVelocityLoop() {
    const actions = OTEFDataContextInternals.actions;
    if (!actions || typeof actions.startVelocityLoop !== "function") {
      getLogger().error("[OTEFDataContext] Missing action helpers");
      return;
    }
    return actions.startVelocityLoop(this);
  }

  async zoom(newZoom) {
    const actions = OTEFDataContextInternals.actions;
    if (!actions || typeof actions.zoom !== "function") {
      getLogger().error("[OTEFDataContext] Missing action helpers");
      return;
    }
    return actions.zoom(this, newZoom);
  }

  updateViewportFromUI(viewport, source = "gis") {
    const actions = OTEFDataContextInternals.actions;
    if (!actions || typeof actions.updateViewportFromUI !== "function") {
      getLogger().error("[OTEFDataContext] Missing action helpers");
      return false;
    }
    return actions.updateViewportFromUI(this, viewport, source);
  }

  async toggleLayer(layerId, enabled) {
    const actions = OTEFDataContextInternals.actions;
    if (!actions || typeof actions.toggleLayer !== "function") {
      getLogger().error("[OTEFDataContext] Missing action helpers");
      return { ok: false, error: "Missing action helpers" };
    }
    return actions.toggleLayer(this, layerId, enabled);
  }

  async setLayersEnabled(fullLayerIds, enabled) {
    const actions = OTEFDataContextInternals.actions;
    if (!actions || typeof actions.setLayersEnabled !== "function") {
      getLogger().error("[OTEFDataContext] Missing action helpers");
      return { ok: false, error: "Missing action helpers" };
    }
    return actions.setLayersEnabled(this, fullLayerIds, enabled);
  }

  async _toggleLayerInGroups(layerId, enabled) {
    const actions = OTEFDataContextInternals.actions;
    if (!actions || typeof actions.toggleLayerInGroups !== "function") {
      getLogger().error("[OTEFDataContext] Missing action helpers");
      return { ok: false, error: "Missing action helpers" };
    }
    return actions.toggleLayerInGroups(this, layerId, enabled);
  }

  async toggleGroup(groupId, enabled) {
    const actions = OTEFDataContextInternals.actions;
    if (!actions || typeof actions.toggleGroup !== "function") {
      getLogger().error("[OTEFDataContext] Missing action helpers");
      return { ok: false, error: "Missing action helpers" };
    }
    return actions.toggleGroup(this, groupId, enabled);
  }

  async toggleAnimation(layerId, enabled) {
    const actions = OTEFDataContextInternals.actions;
    if (!actions || typeof actions.toggleAnimation !== "function") {
      getLogger().error("[OTEFDataContext] Missing action helpers");
      return { ok: false, error: "Missing action helpers" };
    }
    return actions.toggleAnimation(this, layerId, enabled);
  }

  async setLayerAnimations(fullLayerIds, enabled) {
    const actions = OTEFDataContextInternals.actions;
    if (!actions || typeof actions.setLayerAnimations !== "function") {
      getLogger().error("[OTEFDataContext] Missing action helpers");
      return { ok: false, error: "Missing action helpers" };
    }
    return actions.setLayerAnimations(this, fullLayerIds, enabled);
  }

  _computePanViewport(viewport, direction, delta) {
    const actions = OTEFDataContextInternals.actions;
    if (!actions || typeof actions.computePanViewport !== "function") {
      getLogger().error("[OTEFDataContext] Missing action helpers");
      return viewport;
    }
    return actions.computePanViewport(viewport, direction, delta);
  }

  _computeZoomViewport(viewport, newZoom) {
    const actions = OTEFDataContextInternals.actions;
    if (!actions || typeof actions.computeZoomViewport !== "function") {
      getLogger().error("[OTEFDataContext] Missing action helpers");
      return viewport;
    }
    return actions.computeZoomViewport(viewport, newZoom);
  }

  _isViewportInsideBounds(viewport) {
    const bounds = OTEFDataContextInternals.bounds;
    if (!bounds || typeof bounds.isViewportInsideBounds !== "function") {
      getLogger().error("[OTEFDataContext] Missing bounds helpers");
      return true;
    }
    return bounds.isViewportInsideBounds(this, viewport);
  }

  _pointInPolygon(point, polygon) {
    const bounds = OTEFDataContextInternals.bounds;
    if (!bounds || typeof bounds.pointInPolygon !== "function") {
      getLogger().error("[OTEFDataContext] Missing bounds helpers");
      return false;
    }
    return bounds.pointInPolygon(point, polygon);
  }

  subscribe(key, callback) {
    const subs = this._subscribers[key];
    if (!subs) {
      getLogger().warn("[OTEFDataContext] Unknown subscription key:", key);
      return () => {};
    }

    subs.add(callback);

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
      case "orientation":
        current = this._viewerAngleDeg;
        break;
      default:
        break;
    }

    if (current !== null && current !== undefined) {
      try {
        callback(current);
      } catch (err) {
        getLogger().error("[OTEFDataContext] Error in initial callback for", key, err);
      }
    }

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

export const OTEFDataContext = new OTEFDataContextClass();

if (typeof window !== "undefined") {
  window.OTEFDataContext = OTEFDataContext;
}

export default OTEFDataContext;
