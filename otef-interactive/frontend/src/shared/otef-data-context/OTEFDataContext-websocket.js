import { OTEF_API } from "../api-client.js";
import { OTEF_MESSAGE_TYPES } from "../message-protocol.js";
import { OTEFWebSocketClient } from "../websocket-client.js";
import { recordTraceEvent } from "../otef-trace.js";
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
    if (state.layerGroups) {
      ctx._setLayerGroups(state.layerGroups);
      if (typeof ctx._ackLayerGroupsServerBaseline === "function") {
        ctx._ackLayerGroupsServerBaseline(state.layerGroups);
      }
    }
    if (state.animations) ctx._setAnimations(state.animations);
    if (state.bounds_polygon || state.bounds) ctx._setBounds(state.bounds_polygon || state.bounds);
    if (typeof state.viewer_angle_deg === "number") ctx._setViewerAngleDeg(state.viewer_angle_deg);
    if (
      Object.prototype.hasOwnProperty.call(state, "projection_slideshow") &&
      state.projection_slideshow &&
      typeof state.projection_slideshow === "object"
    ) {
      ctx._setProjectionSlideshow(state.projection_slideshow);
    }
  } else {
    if (state.viewport) {
      ctx._viewport = state.viewport;
      const incomingSeq = Number.isFinite(state.viewport.seq) ? state.viewport.seq : null;
      if (incomingSeq !== null && incomingSeq > (ctx._viewportSeq || 0)) {
        ctx._viewportSeq = incomingSeq;
      }
    }
    if (state.layerGroups) {
      ctx._layerGroups = state.layerGroups;
      if (typeof ctx._ackLayerGroupsServerBaseline === "function") {
        ctx._ackLayerGroupsServerBaseline(state.layerGroups);
      }
    }
    if (state.animations) ctx._animations = state.animations;
    if (state.bounds_polygon || state.bounds) ctx._bounds = state.bounds_polygon || state.bounds;
    if (typeof state.viewer_angle_deg === "number") {
      ctx._viewerAngleDeg = state.viewer_angle_deg;
    }
    if (
      Object.prototype.hasOwnProperty.call(state, "projection_slideshow") &&
      state.projection_slideshow &&
      typeof state.projection_slideshow === "object"
    ) {
      ctx._projectionSlideshow = { ...state.projection_slideshow };
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
      const traceId = msg && typeof msg.traceId === "string" ? msg.traceId : null;
      if (traceId) {
        recordTraceEvent(traceId, "ws.viewport.received", {
          sourceId: msg && msg.sourceId ? msg.sourceId : null,
        });
      }
      if (msg && msg.sourceId === ctx._clientId) return;
      if (ctx._isLikelyStaleByTimestamp(msg && msg.timestamp)) return;

      if (msg && msg.viewport) {
        ctx._setViewport(msg.viewport);
        if (traceId) {
          recordTraceEvent(traceId, "context.viewport_from_ws", {});
        }
        return;
      }

      const state = await OTEF_API.getState(ctx._tableName, { forceFresh: true });
      if (state.viewport) ctx._setViewport(state.viewport);
      if (traceId) {
        recordTraceEvent(traceId, "context.viewport_from_api_fallback", {});
      }
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

  ctx._wsClient.on(OTEF_MESSAGE_TYPES.LAYERS_CHANGED, async (msg = {}) => {
    const traceId = msg && typeof msg.traceId === "string" ? msg.traceId : null;
    if (traceId) {
      recordTraceEvent(traceId, "ws.layers.received", {
        sourceId: msg.sourceId || null,
      });
      if (typeof ctx._setActiveLayerTrace === "function") {
        ctx._setActiveLayerTrace({
          traceId,
          source: "ws_layers_changed",
        });
      }
    }
    const isLocalLayerOpPending =
      typeof ctx._isLocalLayerOpPending === "function"
        ? ctx._isLocalLayerOpPending()
        : ctx._pendingLayerOps > 0;
    if (isLocalLayerOpPending) {
      getLogger().debug("[OTEFDataContext] Suppressing LAYERS_CHANGED echo (pending local op)");
      return;
    }
    const affectedCuratedFullLayerIds = Array.isArray(msg.affected_curated_full_layer_ids)
      ? msg.affected_curated_full_layer_ids.filter((id) => typeof id === "string")
      : [];
    try {
      if (Array.isArray(msg.layerGroups)) {
        ctx._setLayerGroups(msg.layerGroups, { bypassEquality: true });
        if (typeof ctx._ackLayerGroupsServerBaseline === "function") {
          ctx._ackLayerGroupsServerBaseline(msg.layerGroups);
        }
        if (traceId) {
          recordTraceEvent(traceId, "context.layers_from_ws_payload", {
            groupCount: msg.layerGroups.length,
          });
        }
      } else {
        const state = await OTEF_API.getState(ctx._tableName, { forceFresh: true });
        if (state.layerGroups) {
          ctx._setLayerGroups(state.layerGroups, { bypassEquality: true });
          if (typeof ctx._ackLayerGroupsServerBaseline === "function") {
            ctx._ackLayerGroupsServerBaseline(state.layerGroups);
          }
          if (traceId) {
            recordTraceEvent(traceId, "context.layers_from_api_fallback", {
              groupCount: state.layerGroups.length,
            });
          }
        }
      }
    } catch (err) {
      getLogger().error("[OTEFDataContext] Failed to refresh layers after LAYERS_CHANGED:", err);
    } finally {
      if (traceId && typeof ctx._clearActiveLayerTrace === "function") {
        setTimeout(() => ctx._clearActiveLayerTrace(traceId), 1200);
      }
      if (typeof window !== "undefined" && affectedCuratedFullLayerIds.length > 0) {
        window.dispatchEvent(
          new CustomEvent("otef-curated-geojson-refresh", {
            detail: {
              affected_curated_full_layer_ids: affectedCuratedFullLayerIds,
            },
          }),
        );
      }
    }
  });

  ctx._wsClient.on(OTEF_MESSAGE_TYPES.ANIMATION_CHANGED, async (msg) => {
    if (ctx._pendingAnimationOps > 0) {
      getLogger().debug("[OTEFDataContext] Suppressing ANIMATION_CHANGED echo (pending local op)");
      return;
    }
    try {
      const state = await OTEF_API.getState(ctx._tableName, { forceFresh: true });
      // Apply layerGroups first so followers (GIS / projection) do not run route overlay sync
      // with animation=true while merged-row siblings are still disabled in context.
      if (state.layerGroups) {
        ctx._setLayerGroups(state.layerGroups, { bypassEquality: true });
        if (typeof ctx._ackLayerGroupsServerBaseline === "function") {
          ctx._ackLayerGroupsServerBaseline(state.layerGroups);
        }
      }
      let mergedAnimations = null;
      if (state.animations && typeof state.animations === "object") {
        mergedAnimations = { ...state.animations };
      }
      if (msg && msg.animations && typeof msg.animations === "object") {
        mergedAnimations = { ...(mergedAnimations || {}), ...msg.animations };
      }
      if (mergedAnimations != null) {
        ctx._setAnimations(mergedAnimations);
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
      const state = await OTEF_API.getState(ctx._tableName, { forceFresh: true });
      if (state.bounds_polygon || state.bounds) ctx._setBounds(state.bounds_polygon || state.bounds);
      if (typeof state.viewer_angle_deg === "number") ctx._setViewerAngleDeg(state.viewer_angle_deg);
    } catch (err) {
      getLogger().error("[OTEFDataContext] Failed to refresh bounds after BOUNDS_CHANGED:", err);
    }
  });

  ctx._wsClient.on(OTEF_MESSAGE_TYPES.PROJECTION_SLIDESHOW_CHANGED, async (msg = {}) => {
    if (msg && msg.sourceId === ctx._clientId) return;
    try {
      const raw = msg && msg.projectionSlideshow;
      if (raw && typeof raw === "object") {
        ctx._setProjectionSlideshow(raw);
        return;
      }
      const state = await OTEF_API.getState(ctx._tableName, { forceFresh: true });
      if (state?.projection_slideshow && typeof state.projection_slideshow === "object") {
        ctx._setProjectionSlideshow(state.projection_slideshow);
      }
    } catch (err) {
      getLogger().error(
        "[OTEFDataContext] Failed to apply projection slideshow after PROJECTION_SLIDESHOW_CHANGED:",
        err,
      );
    }
  });

  ctx._wsClient.connect();
}

OTEFDataContextInternals.websocket = {
  applyStateFromApi,
  setupWebSocket,
};

export { applyStateFromApi, setupWebSocket };
