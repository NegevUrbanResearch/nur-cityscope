import { OTEF_API } from "../api-client.js";
import { isGisBasemapId, normalizeGisBasemap } from "../gis-basemap.js";
import { OTEF_MESSAGE_TYPES } from "../message-protocol.js";
import { normalizeEscapeOverlay } from "../nli-escape-overlay.js";
import { normalizeNliClock } from "../nli-investigation-clock.js";
import { normalizeNarrativeState } from "../nli-narratives.js";
import { normalizePersonSelection } from "../person-selection.js";
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
const PERSON_SELECTION_CHANGED = "otef_person_selection_changed";

function stampClockOffset(ctx, clock) {
  const serverNowMs = Number(clock && clock.serverNowMs);
  if (Number.isFinite(serverNowMs)) {
    ctx._clockOffsetMs = serverNowMs - Date.now();
  }
}

function applyInvestigationClockHydrate(ctx, raw, { notify } = { notify: true }) {
  if (notify && typeof ctx._setInvestigationClock === "function") {
    ctx._setInvestigationClock(raw);
    return;
  }
  const normalized = normalizeNliClock(raw);
  ctx._investigationClock = normalized;
  stampClockOffset(ctx, normalized);
}

function applyInvestigationClockIfNewer(ctx, raw) {
  const incoming = normalizeNliClock(raw);
  const localRev = Number(ctx._investigationClock && ctx._investigationClock.revision) || 0;
  if (!(incoming.revision > localRev)) return;
  if (typeof ctx._setInvestigationClock === "function") {
    ctx._setInvestigationClock(incoming);
    return;
  }
  ctx._investigationClock = incoming;
  stampClockOffset(ctx, incoming);
}

function applyPersonSelectionIfNewer(ctx, raw) {
  const incoming = normalizePersonSelection(raw);
  const local = normalizePersonSelection(ctx._personSelection);
  if (incoming.revision <= local.revision) return;
  if (typeof ctx._setPersonSelection === "function") {
    ctx._setPersonSelection(incoming);
  } else {
    ctx._personSelection = incoming;
  }
}

function canonicalRestNarrativeScene(state) {
  if (!Object.prototype.hasOwnProperty.call(state, "narrative_state")) return null;
  for (const field of ["basemap", "investigation_clock", "person_selection"]) {
    if (!Object.prototype.hasOwnProperty.call(state, field)) return null;
  }
  const narrativeState = normalizeNarrativeState(state.narrative_state);
  return {
    sceneRevision: narrativeState.revision,
    narrativeState,
    basemap: state.basemap,
    investigationClock: state.investigation_clock,
    personSelection: state.person_selection,
    escapeOverlay: normalizeEscapeOverlay(state.escape_overlay, narrativeState.id),
  };
}

function applyStateFromApi(ctx, state, options = {}) {
  if (!state || typeof state !== "object") return;
  const notify = options.notify !== false;

  const hasNarrativeSnapshot = Object.prototype.hasOwnProperty.call(state, "narrative_state");
  const restNarrativeScene = canonicalRestNarrativeScene(state);
  if (restNarrativeScene) {
    ctx._applyNarrativeScene(restNarrativeScene, {
      notify,
      allowSameRevision: true,
      hydrate: options.hydrate === true || !notify,
      coupledBaseline: options.coupledBaseline,
    });
  }

  if (notify) {
    if (state.viewport) ctx._setViewport(state.viewport);
    if (state.layerGroups) {
      ctx._setLayerGroups(state.layerGroups);
      if (typeof ctx._ackLayerGroupsServerBaseline === "function") {
        ctx._ackLayerGroupsServerBaseline(state.layerGroups);
      }
    }
    if (state.animations) ctx._setAnimations(state.animations);
    if (!hasNarrativeSnapshot && Object.prototype.hasOwnProperty.call(state, "basemap")) {
      ctx._setConfirmedBasemap(state.basemap);
    }
    if (state.bounds_polygon || state.bounds) ctx._setBounds(state.bounds_polygon || state.bounds);
    if (typeof state.viewer_angle_deg === "number") ctx._setViewerAngleDeg(state.viewer_angle_deg);
    if (
      Object.prototype.hasOwnProperty.call(state, "projection_slideshow") &&
      state.projection_slideshow &&
      typeof state.projection_slideshow === "object"
    ) {
      ctx._setProjectionSlideshow(state.projection_slideshow);
    }
    if (
      !hasNarrativeSnapshot &&
      Object.prototype.hasOwnProperty.call(state, "investigation_clock") &&
      state.investigation_clock &&
      typeof state.investigation_clock === "object"
    ) {
      applyInvestigationClockHydrate(ctx, state.investigation_clock, { notify: true });
    }
    if (!hasNarrativeSnapshot && Object.prototype.hasOwnProperty.call(state, "person_selection")) {
      ctx._setPersonSelection(state.person_selection);
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
    if (!hasNarrativeSnapshot && Object.prototype.hasOwnProperty.call(state, "basemap")) {
      ctx._basemap = normalizeGisBasemap(state.basemap);
    }
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
    if (
      !hasNarrativeSnapshot &&
      Object.prototype.hasOwnProperty.call(state, "investigation_clock") &&
      state.investigation_clock &&
      typeof state.investigation_clock === "object"
    ) {
      applyInvestigationClockHydrate(ctx, state.investigation_clock, { notify: false });
    }
    if (!hasNarrativeSnapshot && Object.prototype.hasOwnProperty.call(state, "person_selection")) {
      ctx._personSelection = normalizePersonSelection(state.person_selection);
    }
  }
  if (Object.prototype.hasOwnProperty.call(state, "nli_clock_layout") && typeof ctx._applyNliClockLayout === "function") {
    ctx._applyNliClockLayout(state.nli_clock_layout);
  }
  if (Object.prototype.hasOwnProperty.call(state, "legend_settings") && typeof ctx._applyLegendSettings === "function") {
    ctx._applyLegendSettings(state.legend_settings);
  }
}

function setupWebSocket(ctx) {
  if (ctx._wsClient) return;

  let hasConnected = false;

  ctx._wsClient = new OTEFWebSocketClient(`/ws/${ctx._tableName}/`, {
    onConnect: async () => {
      const isReconnect = hasConnected;
      hasConnected = true;
      ctx._setConnection(true);
      if (!isReconnect) return;
      const coupledBaseline = ctx._captureNarrativeSceneBaseline();
      try {
        const state = await OTEF_API.getState(ctx._tableName, { forceFresh: true });
        applyStateFromApi(ctx, state, { notify: true, coupledBaseline });
      } catch (err) {
        getLogger().error("[OTEFDataContext] Failed to refresh state after reconnect:", err);
      }
    },
    onDisconnect: () => ctx._setConnection(false),
    onError: () => ctx._setConnection(false),
  });
  ctx._wsClient.on("connecting", () => ctx._setConnection(false, "connecting"));

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

  ctx._wsClient.on(OTEF_MESSAGE_TYPES.BASEMAP_CHANGED, async (msg = {}) => {
    if (msg && msg.sourceId === ctx._clientId) return;
    if (isGisBasemapId(msg.basemap)) {
      ctx._setConfirmedBasemap(msg.basemap);
      return;
    }
    try {
      const state = await OTEF_API.getState(ctx._tableName, { forceFresh: true });
      if (state && Object.prototype.hasOwnProperty.call(state, "basemap")) {
        ctx._setConfirmedBasemap(state.basemap);
      }
    } catch (err) {
      getLogger().error("[OTEFDataContext] Failed to refresh basemap after BASEMAP_CHANGED:", err);
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

  ctx._wsClient.on(OTEF_MESSAGE_TYPES.INVESTIGATION_CLOCK_CHANGED, async (msg = {}) => {
    try {
      const raw = msg && msg.investigationClock;
      if (raw && typeof raw === "object") {
        applyInvestigationClockIfNewer(ctx, raw);
        return;
      }
      const state = await OTEF_API.getState(ctx._tableName, { forceFresh: true });
      if (state?.investigation_clock && typeof state.investigation_clock === "object") {
        applyInvestigationClockIfNewer(ctx, state.investigation_clock);
      }
    } catch (err) {
      getLogger().error(
        "[OTEFDataContext] Failed to apply investigation clock after INVESTIGATION_CLOCK_CHANGED:",
        err,
      );
    }
  });

  ctx._wsClient.on(PERSON_SELECTION_CHANGED, (msg = {}) => {
    if (msg && msg.personSelection) {
      applyPersonSelectionIfNewer(ctx, msg.personSelection);
    }
  });

  ctx._wsClient.on(OTEF_MESSAGE_TYPES.NARRATIVE_SCENE_CHANGED, (msg = {}) => {
    if (msg.table && msg.table !== ctx._tableName) return;
    if (msg.sourceId && msg.sourceId === ctx._clientId) return;
    if (msg.scene && typeof ctx._applyNarrativeScene === "function") {
      ctx._applyNarrativeScene(msg.scene);
    }
  });

  ctx._wsClient.on(OTEF_MESSAGE_TYPES.ESCAPE_OVERLAY_CHANGED, (msg = {}) => {
    if (msg.table && msg.table !== ctx._tableName) return;
    if (typeof ctx._applyEscapeOverlay !== "function") return;
    ctx._applyEscapeOverlay(msg.escapeOverlay, ctx.getNarrativeState().id);
  });

  ctx._wsClient.on(OTEF_MESSAGE_TYPES.NLI_CLOCK_LAYOUT_CHANGED, (msg = {}) => {
    if (msg.table && msg.table !== ctx._tableName) return;
    if (typeof ctx._applyNliClockLayout !== "function") return;
    ctx._applyNliClockLayout(msg.nliClockLayout);
  });
  ctx._wsClient.on(OTEF_MESSAGE_TYPES.LEGEND_SETTINGS_CHANGED, (msg = {}) => {
    if (msg.table && msg.table !== ctx._tableName) return;
    if (msg.legendSettings && typeof ctx._applyLegendSettings === "function") {
      ctx._applyLegendSettings(msg.legendSettings);
    }
  });

  ctx._wsClient.on(OTEF_MESSAGE_TYPES.NARRATIVE_PRESENTATION_COMMAND, (msg = {}) => {
    if (msg.table && msg.table !== ctx._tableName) return;
    if (msg.sourceId && msg.sourceId === ctx._clientId) return;
    if (!["open", "next", "previous", "close"].includes(msg.presentationAction)) return;
    if (typeof msg.segmentId !== "string" || !msg.segmentId.trim()) return;
    if (typeof msg.presentationSessionId !== "string" || !msg.presentationSessionId.trim()) return;
    if (!Number.isInteger(msg.presentationGeneration) || msg.presentationGeneration <= 0) return;
    if (!Number.isInteger(msg.sequence) || msg.sequence <= 0) return;
    if (typeof msg.requestId !== "string" || !msg.requestId.trim()) return;
    ctx._notify("narrativePresentation", {
      presentationAction: msg.presentationAction,
      segmentId: msg.segmentId,
      presentationSessionId: msg.presentationSessionId,
      presentationGeneration: msg.presentationGeneration,
      sequence: msg.sequence,
      requestId: msg.requestId,
      sourceId: typeof msg.sourceId === "string" ? msg.sourceId : null,
      acknowledged: msg.acknowledged === true,
    });
  });

  ctx._wsClient.on(OTEF_MESSAGE_TYPES.NARRATIVE_PRESENTATION_RESULT, (msg = {}) => {
    if (msg.table && msg.table !== ctx._tableName) return;
    if (msg.sourceId && msg.sourceId === ctx._clientId) return;
    if (typeof msg.segmentId !== "string" || !msg.segmentId.trim()) return;
    if (typeof msg.presentationSessionId !== "string" || !msg.presentationSessionId.trim()) return;
    if (!Number.isInteger(msg.presentationGeneration) || msg.presentationGeneration <= 0) return;
    if (!Number.isInteger(msg.sequence) || msg.sequence <= 0) return;
    if (!["opened", "ready", "closed", "unavailable", "ignored"].includes(msg.outcome)) return;
    if (typeof msg.requestId !== "string" || !msg.requestId.trim()) return;
    const result = {
      outcome: msg.outcome,
      segmentId: msg.segmentId,
      presentationSessionId: msg.presentationSessionId,
      presentationGeneration: msg.presentationGeneration,
      sequence: msg.sequence,
      requestId: msg.requestId,
      sourceId: typeof msg.sourceId === "string" ? msg.sourceId : null,
      acknowledged: msg.acknowledged === true,
      slide: Number.isInteger(msg.slide) ? msg.slide : null,
      range: Array.isArray(msg.range) && msg.range.length === 2 && msg.range.every(Number.isInteger)
        ? [...msg.range]
        : null,
      message: typeof msg.message === "string" ? msg.message : null,
    };
    ctx._notify("narrativePresentationResult", result);
  });

  ctx._wsClient.on(OTEF_MESSAGE_TYPES.PLACE_NAVIGATION_COMMAND, (msg = {}) => {
    const command = msg.command && typeof msg.command === "object" ? msg.command : null;
    if (!command) return;
    if (command.sourceId && command.sourceId === ctx._clientId) return;
    ctx._emitNavigationCommand(command);
  });
  ctx._wsClient.on(OTEF_MESSAGE_TYPES.ARCHIVE_WINDOW_COMMAND, (msg = {}) => {
    if (msg.table && msg.table !== ctx._tableName) return;
    ctx._notify("archiveWindow", msg);
  });
  ctx._wsClient.on(OTEF_MESSAGE_TYPES.ARCHIVE_WINDOW_RESULT, (msg = {}) => {
    if (msg.table && msg.table !== ctx._tableName) return;
    if (msg.sourceId && msg.sourceId === ctx._clientId) return;
    ctx._notify("archiveWindowResult", msg);
  });

  ctx._wsClient.connect();
}

OTEFDataContextInternals.websocket = {
  applyStateFromApi,
  setupWebSocket,
  applyInvestigationClockIfNewer,
  applyPersonSelectionIfNewer,
};

export {
  applyStateFromApi,
  setupWebSocket,
  applyInvestigationClockIfNewer,
  applyPersonSelectionIfNewer,
};
