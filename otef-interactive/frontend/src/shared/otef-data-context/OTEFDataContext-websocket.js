import { explicitExperienceScope, isExperienceStateCurrentOrNewer } from "../experience-state.js";
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
  if (state.experience_state && typeof ctx._setExperienceState === "function") {
    if (!isExperienceStateCurrentOrNewer(state.experience_state, ctx.getExperienceState())) return;
    if (!options.experienceBatch) return ctx._batchNotifications(() => applyStateFromApi(ctx, state, { ...options, experienceBatch: true }));
    const previousRevision = ctx.getExperienceState()?.revision;
    ctx._setExperienceState(state.experience_state);
    if (previousRevision !== state.experience_state.revision) {
      options = { ...options, layerGroupsReceipt: undefined, animationsReceipt: undefined, coupledBaseline: undefined, visibilityReceipt: undefined };
    }
  }
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
    if (state.layerGroups) ctx._applyLayerGroupsSnapshot(state.layerGroups, options.layerGroupsReceipt);
    if (state.animations && (options.animationsReceipt === undefined || options.animationsReceipt === ctx._animationsReceipt)) {
      ctx._setAnimations(state.animations);
    }
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
    if (state.layerGroups && (options.layerGroupsReceipt === undefined || options.layerGroupsReceipt === ctx._layerGroupsReceipt)) {
      ctx._layerGroups = state.layerGroups;
      ctx._layerGroupsReceipt += 1;
      if (typeof ctx._ackLayerGroupsServerBaseline === "function") {
        ctx._ackLayerGroupsServerBaseline(state.layerGroups);
      }
    }
    if (state.animations && (options.animationsReceipt === undefined || options.animationsReceipt === ctx._animationsReceipt)) {
      ctx._animations = state.animations;
      ctx._animationsReceipt += 1;
    }
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
    if (Number.isInteger(state.nli_clock_layout_revision) && typeof ctx._applyNliClockLayoutVersioned === "function") {
      ctx._applyNliClockLayoutVersioned(state.nli_clock_layout, state.nli_clock_layout_revision);
    } else if (!(ctx._nliClockLayoutRevision >= 0)) {
      ctx._applyNliClockLayout(state.nli_clock_layout);
    }
  }
  if (Object.prototype.hasOwnProperty.call(state, "settlement_name_settings") && typeof ctx._applySettlementNamesVersioned === "function") {
    if (Number.isInteger(state.settlement_name_revision)) {
      ctx._applySettlementNamesVersioned(state.settlement_name_settings, state.settlement_name_revision);
    }
  }
  if (Object.prototype.hasOwnProperty.call(state, "road_sign_settings") && typeof ctx._applyRoadSignsVersioned === "function") {
    if (Number.isSafeInteger(state.road_sign_revision)) {
      ctx._applyRoadSignsVersioned(state.road_sign_settings, state.road_sign_revision, { authoritative: options.authoritative === true });
    }
  }
  if (Object.prototype.hasOwnProperty.call(state, "legend_settings") && typeof ctx._applyLegendSettings === "function") {
    if (Number.isInteger(state.legend_layout_revision) && typeof ctx._applyLegendProjectionVersioned === "function") {
      ctx._applyLegendMetadataPatch({
        language: state.legend_settings.language,
        summarizedGroupIds: state.legend_settings.summarizedGroupIds,
      });
      ctx._applyLegendProjectionVersioned(state.legend_settings.projection, state.legend_layout_revision);
    } else if (!(ctx._legendLayoutRevision >= 0)) {
      ctx._applyLegendSettings(state.legend_settings);
    }
  }
  if (Object.prototype.hasOwnProperty.call(state, "gaza_border_visible")
    && (options.visibilityReceipt === undefined || options.visibilityReceipt === ctx._gazaBorderVisibilityReceipt)) {
    if (notify) ctx._setGazaBorderVisible(state.gaza_border_visible);
    else { ctx._gazaBorderVisible = state.gaza_border_visible === true; ctx._gazaBorderVisibilityReceipt += 1; }
  }
  if (Object.prototype.hasOwnProperty.call(state, "exhibit_mode")) {
    if (notify && typeof ctx._setExhibitMode === "function") {
      ctx._setExhibitMode(state.exhibit_mode === true);
    } else {
      ctx._exhibitMode = state.exhibit_mode === true;
    }
  }
}

function setupWebSocket(ctx) {
  if (ctx._wsClient) return;

  let connectionGeneration = 0;
  let hydrationPromise = null;
  let archiveBridgeReady = false;
  let archiveCommandsDisabled = false;
  let queuedArchiveCommands = [];

  const acceptsScope = (message, type = message?.type) => {
    const state = ctx.getExperienceState?.();
    if (!state) return true;
    if (state.pending_transition) {
      const cleanup = [OTEF_MESSAGE_TYPES.ARCHIVE_WINDOW_RESULT, OTEF_MESSAGE_TYPES.NARRATIVE_PRESENTATION_RESULT].includes(type)
        || (type === OTEF_MESSAGE_TYPES.ARCHIVE_WINDOW_COMMAND && message?.archiveAction === "close")
        || (type === OTEF_MESSAGE_TYPES.NARRATIVE_PRESENTATION_COMMAND && message?.presentationAction === "close");
      if (!cleanup) return false;
    }
    const stamped = typeof message?.experience === "string" && Number.isSafeInteger(message?.experience_revision);
    if (!stamped) return state.revision === 0 && !state.pending_transition;
    return message.experience === state.active_experience && message.experience_revision === state.revision;
  };
  const currentState = async () => {
    const scope = ctx.captureExperienceScope?.();
    const state = await OTEF_API.getState(ctx._tableName, { forceFresh: true });
    if (scope && ctx.isExperienceScopeCurrent?.(scope) === false) return {};
    return state;
  };
  const onScoped = (type, handler) => ctx._wsClient.on(type, message => {
    if (acceptsScope(message, type)) return handler(message);
  });

  const flushArchiveCommands = () => {
    if (hydrationPromise || !archiveBridgeReady || archiveCommandsDisabled) return;
    const commands = queuedArchiveCommands;
    queuedArchiveCommands = [];
    for (const command of commands) {
      if (acceptsScope(command)) ctx._notify("archiveWindow", command);
    }
  };

  ctx._markArchiveWindowBridgeReady = (ownsCommands = true) => {
    archiveCommandsDisabled = ownsCommands !== true;
    archiveBridgeReady = ownsCommands === true;
    if (archiveCommandsDisabled) queuedArchiveCommands = [];
    flushArchiveCommands();
  };

  ctx._wsClient = new OTEFWebSocketClient(`/ws/${ctx._tableName}/`, {
    onConnect: async () => {
      const generation = ++connectionGeneration;
      ctx._setConnection(false, "connecting");
      const coupledBaseline = ctx._captureNarrativeSceneBaseline();
      const visibilityReceipt = ctx._gazaBorderVisibilityReceipt;
      const layerGroupsReceipt = ctx._beginLayerGroupsSnapshot();
      const animationsReceipt = ctx._animationsReceipt;
      hydrationPromise = (async () => {
        let hydrated = false;
        try {
          const state = await OTEF_API.getState(ctx._tableName, { forceFresh: true });
          if (generation !== connectionGeneration) return;
          applyStateFromApi(ctx, state, { notify: true, coupledBaseline, visibilityReceipt, layerGroupsReceipt, animationsReceipt });
          hydrated = true;
        } catch (err) {
          getLogger().error("[OTEFDataContext] Failed to refresh state after WebSocket connect:", err);
        } finally {
          if (generation !== connectionGeneration) return;
          hydrationPromise = null;
          if (hydrated) {
            ctx._setConnection(true);
            flushArchiveCommands();
          } else {
            ctx._setConnection(false, "error");
            queuedArchiveCommands = [];
          }
        }
      })();
      await hydrationPromise;
    },
    onDisconnect: () => {
      connectionGeneration += 1;
      ctx._setConnection(false);
    },
    onError: () => {
      connectionGeneration += 1;
      ctx._setConnection(false);
    },
  });
  ctx._wsClient.on("connecting", () => ctx._setConnection(false, "connecting"));
  ctx._wsClient.on("otef_experience_changed", (message) => {
    if (message?.state) ctx.adoptAuthoritativeSnapshot(message.state);
  });

  onScoped(OTEF_MESSAGE_TYPES.VIEWPORT_CHANGED, async (msg) => {
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

      const state = await currentState();
      if (state.viewport) ctx._setViewport(state.viewport);
      if (traceId) {
        recordTraceEvent(traceId, "context.viewport_from_api_fallback", {});
      }
    } catch (err) {
      getLogger().error("[OTEFDataContext] Failed to refresh viewport after VIEWPORT_CHANGED:", err);
    }
  });

  onScoped(OTEF_MESSAGE_TYPES.VELOCITY_SYNC, (msg) => {
    ctx._velocity = { vx: msg.vx || 0, vy: msg.vy || 0 };
    ctx._lastVelocityUpdate = Date.now();
    if (ctx._velocity.vx !== 0 || ctx._velocity.vy !== 0) {
      ctx._startVelocityLoop();
    }
  });

  onScoped(OTEF_MESSAGE_TYPES.LAYERS_CHANGED, async (msg = {}) => {
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
        const apply = () => {
          if (typeof msg.gazaBorderVisible === "boolean") ctx._setGazaBorderVisible?.(msg.gazaBorderVisible);
          ctx._applyLayerGroupsSnapshot(msg.layerGroups, undefined, { bypassEquality: true });
        };
        if (ctx._batchNotifications) ctx._batchNotifications(apply);
        else apply();
        if (traceId) {
          recordTraceEvent(traceId, "context.layers_from_ws_payload", {
            groupCount: msg.layerGroups.length,
          });
        }
      } else {
        const generation = connectionGeneration;
        const receipt = ctx._beginLayerGroupsSnapshot();
        const visibilityReceipt = ctx._gazaBorderVisibilityReceipt;
        const state = await currentState();
        if (generation !== connectionGeneration) return;
        if (state.layerGroups) {
          let applied;
          const apply = () => {
            applied = ctx._applyLayerGroupsSnapshot(state.layerGroups, receipt, { bypassEquality: true });
            if (applied && visibilityReceipt === ctx._gazaBorderVisibilityReceipt && typeof state.gaza_border_visible === "boolean") ctx._setGazaBorderVisible?.(state.gaza_border_visible);
          };
          if (ctx._batchNotifications) ctx._batchNotifications(apply);
          else apply();
          if (traceId && applied) {
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

  onScoped(OTEF_MESSAGE_TYPES.ANIMATION_CHANGED, async (msg) => {
    if (msg?.table && msg.table !== ctx._tableName) return;
    if (ctx._pendingAnimationOps > 0) {
      getLogger().debug("[OTEFDataContext] Suppressing ANIMATION_CHANGED echo (pending local op)");
      return;
    }
    const animationsReceipt = ++ctx._animationsReceipt;
    const layerGroupsReceipt = ctx._beginLayerGroupsSnapshot();
    const generation = connectionGeneration;
    try {
      const state = await currentState();
      if (generation !== connectionGeneration || animationsReceipt !== ctx._animationsReceipt || ctx._pendingAnimationOps > 0) return;
      // Apply layerGroups first so followers (GIS / projection) do not run route overlay sync
      // with animation=true while merged-row siblings are still disabled in context.
      if (state.layerGroups) {
        ctx._applyLayerGroupsSnapshot(state.layerGroups, layerGroupsReceipt, { bypassEquality: true });
      }
      if (animationsReceipt !== ctx._animationsReceipt || ctx._pendingAnimationOps > 0) return;
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

  onScoped(OTEF_MESSAGE_TYPES.BASEMAP_CHANGED, async (msg = {}) => {
    if (msg && msg.sourceId === ctx._clientId) return;
    if (isGisBasemapId(msg.basemap)) {
      ctx._setConfirmedBasemap(msg.basemap);
      return;
    }
    try {
      const state = await currentState();
      if (state && Object.prototype.hasOwnProperty.call(state, "basemap")) {
        ctx._setConfirmedBasemap(state.basemap);
      }
    } catch (err) {
      getLogger().error("[OTEFDataContext] Failed to refresh basemap after BASEMAP_CHANGED:", err);
    }
  });

  onScoped(OTEF_MESSAGE_TYPES.EXHIBIT_MODE_CHANGED, (msg = {}) => {
    if (msg && msg.sourceId === ctx._clientId) return;
    if (typeof ctx._setExhibitMode === "function") {
      ctx._setExhibitMode(msg.exhibitMode === true);
    } else {
      ctx._exhibitMode = msg.exhibitMode === true;
    }
  });

  onScoped(OTEF_MESSAGE_TYPES.GAZA_BORDER_VISIBILITY_CHANGED, (msg = {}) => {
    if (msg.table !== ctx._tableName || typeof msg.gazaBorderVisible !== "boolean") return;
    ctx._setGazaBorderVisible(msg.gazaBorderVisible);
  });

  onScoped(OTEF_MESSAGE_TYPES.PROJECTION_SLIDESHOW_CHANGED, async (msg = {}) => {
    if (msg && msg.sourceId === ctx._clientId) return;
    try {
      const raw = msg && msg.projectionSlideshow;
      if (raw && typeof raw === "object") {
        ctx._setProjectionSlideshow(raw);
        return;
      }
      const state = await currentState();
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

  onScoped(OTEF_MESSAGE_TYPES.INVESTIGATION_CLOCK_CHANGED, async (msg = {}) => {
    try {
      const raw = msg && msg.investigationClock;
      if (raw && typeof raw === "object") {
        applyInvestigationClockIfNewer(ctx, raw);
        return;
      }
      const state = await currentState();
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

  onScoped(PERSON_SELECTION_CHANGED, (msg = {}) => {
    if (msg && msg.personSelection) {
      applyPersonSelectionIfNewer(ctx, msg.personSelection);
    }
  });

  onScoped(OTEF_MESSAGE_TYPES.NARRATIVE_SCENE_CHANGED, (msg = {}) => {
    if (msg.table && msg.table !== ctx._tableName) return;
    if (msg.sourceId && msg.sourceId === ctx._clientId) return;
    if (msg.scene && typeof ctx._applyNarrativeScene === "function") {
      ctx._applyNarrativeScene(msg.scene);
    }
  });

  onScoped(OTEF_MESSAGE_TYPES.ESCAPE_OVERLAY_CHANGED, (msg = {}) => {
    if (msg.table && msg.table !== ctx._tableName) return;
    if (typeof ctx._applyEscapeOverlay !== "function") return;
    ctx._applyEscapeOverlay(msg.escapeOverlay, ctx.getNarrativeState().id);
  });

  ctx._wsClient.on(OTEF_MESSAGE_TYPES.NLI_CLOCK_LAYOUT_CHANGED, (msg = {}) => {
    if (msg.table && msg.table !== ctx._tableName) return;
    if (typeof ctx._applyNliClockLayout !== "function") return;
    if (Number.isInteger(msg.nliClockLayoutRevision) && typeof ctx._applyNliClockLayoutVersioned === "function") {
      ctx._applyNliClockLayoutVersioned(msg.nliClockLayout, msg.nliClockLayoutRevision);
    } else if (!(ctx._nliClockLayoutRevision >= 0)) {
      ctx._applyNliClockLayout(msg.nliClockLayout);
    }
  });
  ctx._wsClient.on(OTEF_MESSAGE_TYPES.SETTLEMENT_NAMES_CHANGED, (msg = {}) => {
    if (msg.table && msg.table !== ctx._tableName) return;
    if (typeof ctx._applySettlementNamesVersioned !== "function") return;
    if (Number.isInteger(msg.settlementNameRevision)) {
      ctx._applySettlementNamesVersioned(msg.settlementNameSettings, msg.settlementNameRevision);
    }
  });
  ctx._wsClient.on(OTEF_MESSAGE_TYPES.ROAD_SIGNS_CHANGED, (msg = {}) => {
    if (msg.table !== ctx._tableName) return;
    if (typeof ctx._applyRoadSignsVersioned !== "function") return;
    ctx._applyRoadSignsVersioned(msg.roadSignSettings, msg.roadSignRevision, { table: msg.table });
  });
  ctx._wsClient.on(OTEF_MESSAGE_TYPES.LEGEND_SETTINGS_CHANGED, (msg = {}) => {
    if (msg.table && msg.table !== ctx._tableName) return;
    if (msg.changeKind !== "layout" && !acceptsScope(msg, OTEF_MESSAGE_TYPES.LEGEND_SETTINGS_CHANGED)) return;
    if (msg.changeKind === "layout" && typeof ctx._applyLegendProjectionVersioned === "function") {
      ctx._applyLegendProjectionVersioned(msg.legendProjection, msg.legendLayoutRevision);
    } else if (msg.changeKind === "metadata" && typeof ctx._applyLegendMetadataPatch === "function") {
      ctx._applyLegendMetadataPatch(msg.legendSettingsPatch);
    } else if (msg.legendSettings && typeof ctx._applyLegendSettings === "function" && !(ctx._legendLayoutRevision >= 0)) {
      ctx._applyLegendSettings(msg.legendSettings);
    }
  });

  onScoped(OTEF_MESSAGE_TYPES.NARRATIVE_PRESENTATION_COMMAND, (msg = {}) => {
    if (msg.table && msg.table !== ctx._tableName) return;
    if (msg.sourceId && msg.sourceId === ctx._clientId) return;
    if (!["open", "next", "previous", "close"].includes(msg.presentationAction)) return;
    if (typeof msg.segmentId !== "string" || !msg.segmentId.trim()) return;
    if (typeof msg.presentationSessionId !== "string" || !msg.presentationSessionId.trim()) return;
    if (!Number.isInteger(msg.presentationGeneration) || msg.presentationGeneration <= 0) return;
    if (!Number.isInteger(msg.sequence) || msg.sequence <= 0) return;
    if (typeof msg.requestId !== "string" || !msg.requestId.trim()) return;
    ctx._notify("narrativePresentation", {
      ...explicitExperienceScope(msg),
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

  onScoped(OTEF_MESSAGE_TYPES.NARRATIVE_PRESENTATION_RESULT, (msg = {}) => {
    if (msg.table && msg.table !== ctx._tableName) return;
    if (msg.sourceId && msg.sourceId === ctx._clientId) return;
    if (typeof msg.segmentId !== "string" || !msg.segmentId.trim()) return;
    if (typeof msg.presentationSessionId !== "string" || !msg.presentationSessionId.trim()) return;
    if (!Number.isInteger(msg.presentationGeneration) || msg.presentationGeneration <= 0) return;
    if (!Number.isInteger(msg.sequence) || msg.sequence <= 0) return;
    if (!["opened", "ready", "closed", "unavailable", "ignored"].includes(msg.outcome)) return;
    if (typeof msg.requestId !== "string" || !msg.requestId.trim()) return;
    const result = {
      ...explicitExperienceScope(msg),
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

  onScoped(OTEF_MESSAGE_TYPES.PLACE_NAVIGATION_COMMAND, (msg = {}) => {
    const command = msg.command && typeof msg.command === "object" ? msg.command : null;
    if (!command) return;
    if (command.sourceId && command.sourceId === ctx._clientId) return;
    ctx._emitNavigationCommand(command);
  });
  onScoped(OTEF_MESSAGE_TYPES.ARCHIVE_WINDOW_COMMAND, (msg = {}) => {
    if (msg.table && msg.table !== ctx._tableName) return;
    if (archiveCommandsDisabled) return;
    if (hydrationPromise || !archiveBridgeReady) {
      queuedArchiveCommands.push(msg);
      if (queuedArchiveCommands.length > 32) queuedArchiveCommands.shift();
      return;
    }
    ctx._notify("archiveWindow", msg);
  });
  onScoped(OTEF_MESSAGE_TYPES.ARCHIVE_WINDOW_RESULT, (msg = {}) => {
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
