import { OTEF_API } from "../api-client.js";
import { OTEF_MESSAGE_TYPES } from "../message-protocol.js";
import { OTEFWebSocketClient } from "../websocket-client.js";
import { OTEFDataContextInternals } from "./index.js";

function fallbackLogger() {
  return {
    debug: () => {},
    info: () => {},
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };
}

const getLogger = OTEFDataContextInternals.getLogger || fallbackLogger;

function applyStateFromApi(ctx, state, { notify } = { notify: true }) {
  if (!state || typeof state !== "object") return;

  if (notify) {
    if (state.viewport) ctx._setViewport(state.viewport);
    if (state.layerGroups) ctx._setLayerGroups(state.layerGroups);
    if (state.animations) ctx._setAnimations(state.animations);
    if (state.bounds_polygon || state.bounds) ctx._setBounds(state.bounds_polygon || state.bounds);
    if (typeof state.viewer_angle_deg === "number") ctx._setViewerAngleDeg(state.viewer_angle_deg);
  } else {
    if (state.viewport) ctx._viewport = state.viewport;
    if (state.layerGroups) ctx._layerGroups = state.layerGroups;
    if (state.animations) ctx._animations = state.animations;
    if (state.bounds_polygon || state.bounds) ctx._bounds = state.bounds_polygon || state.bounds;
    if (typeof state.viewer_angle_deg === "number") {
      ctx._viewerAngleDeg = state.viewer_angle_deg;
    }
  }
}

function setupWebSocket(ctx) {
  if (ctx._wsClient) return;

  ctx._wsClient = new OTEFWebSocketClient(`/ws/${ctx._tableName}/`, {
    onConnect: () => ctx._setConnection(true),
    onDisconnect: () => ctx._setConnection(false),
    onError: () => ctx._setConnection(false),
  });

  ctx._wsClient.on(OTEF_MESSAGE_TYPES.VIEWPORT_CHANGED, async (msg) => {
    try {
      if (msg && msg.sourceId === ctx._clientId) return;
      if (msg && msg.timestamp && msg.timestamp < ctx._lastLocalStateTimestamp - 200) return;

      if (msg && msg.viewport) {
        ctx._setViewport(msg.viewport);
        return;
      }

      const state = await OTEF_API.getState(ctx._tableName);
      if (state.viewport) ctx._setViewport(state.viewport);
    } catch (err) {
      getLogger().error("[OTEFDataContext] Failed to refresh viewport after VIEWPORT_CHANGED:", err);
    }
  });

  ctx._wsClient.on(OTEF_MESSAGE_TYPES.VELOCITY_SYNC, (msg) => {
    ctx._velocity = { vx: msg.vx || 0, vy: msg.vy || 0 };
    ctx._lastVelocityUpdate = Date.now();
    if (ctx._velocity.vx !== 0 || ctx._velocity.vy !== 0) {
      ctx._startVelocityLoop();
    }
  });

  // v1: WS `otef_layers_changed` still dispatches a full GIS curated refresh (no affected ids in
  // the message). The Supabase heartbeat path uses pull JSON `affected_curated_full_layer_ids`
  // for selective reload; enriching the WS payload is a future optimization.
  ctx._wsClient.on(OTEF_MESSAGE_TYPES.LAYERS_CHANGED, async () => {
    if (ctx._pendingLayerOps > 0) {
      getLogger().debug("[OTEFDataContext] Suppressing LAYERS_CHANGED echo (pending local op)");
      return;
    }
    try {
      const state = await OTEF_API.getState(ctx._tableName);
      if (state.layerGroups) {
        ctx._setLayerGroups(state.layerGroups);
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("otef-curated-geojson-refresh"));
        }
      }
    } catch (err) {
      getLogger().error("[OTEFDataContext] Failed to refresh layers after LAYERS_CHANGED:", err);
    }
  });

  ctx._wsClient.on(OTEF_MESSAGE_TYPES.ANIMATION_CHANGED, async (msg) => {
    if (ctx._pendingAnimationOps > 0) {
      getLogger().debug("[OTEFDataContext] Suppressing ANIMATION_CHANGED echo (pending local op)");
      return;
    }
    try {
      const state = await OTEF_API.getState(ctx._tableName);
      if (state.animations) {
        ctx._setAnimations(state.animations);
      } else if (msg && msg.layerId && typeof msg.enabled === "boolean") {
        const next = Object.assign({}, ctx._animations || {});
        next[msg.layerId] = msg.enabled;
        ctx._setAnimations(next);
      }
    } catch (err) {
      getLogger().error("[OTEFDataContext] Failed to refresh animations after ANIMATION_CHANGED:", err);
    }
  });

  ctx._wsClient.on(OTEF_MESSAGE_TYPES.BOUNDS_CHANGED, async () => {
    try {
      const state = await OTEF_API.getState(ctx._tableName);
      if (state.bounds_polygon || state.bounds) ctx._setBounds(state.bounds_polygon || state.bounds);
      if (typeof state.viewer_angle_deg === "number") ctx._setViewerAngleDeg(state.viewer_angle_deg);
    } catch (err) {
      getLogger().error("[OTEFDataContext] Failed to refresh bounds after BOUNDS_CHANGED:", err);
    }
  });

  ctx._wsClient.connect();
}

OTEFDataContextInternals.websocket = {
  applyStateFromApi,
  setupWebSocket,
};

export { applyStateFromApi, setupWebSocket };
