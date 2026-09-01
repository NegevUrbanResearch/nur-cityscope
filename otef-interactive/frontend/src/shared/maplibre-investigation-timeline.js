/**
 * Shared-clock highlight for NLI investigation polygons, lines, and alarms.
 * Maps evaluate `NliInvestigationClock` (GIS and projection share T via correctedNow).
 * Active lines use the same line-gradient trail as Oct 7 ציר layers, once per beat,
 * including the trail-head circle. The head hides when that line's beat finishes.
 * Completed lines stay fully drawn. Base pack lines are hidden while playback runs.
 * Alarms hitchhike polygon/line beats when those layers play; alarms-only uses 5-minute bins.
 */

import {
  applyAlarmMode,
  createInvestigationAlarmRenderer,
} from "./maplibre-investigation-alarms.js";
import {
  buildNliExplainerModel,
  nliExplainerInnerHtml,
  NLI_CAPTION_MODE_CLOCK_ONLY,
  NLI_EXPLAINER_SAMPLE_MODEL,
} from "./nli-explainer-model.js";
import {
  INVESTIGATION_ALARMS_FULL_ID,
  INVESTIGATION_LINES_FULL_ID,
  INVESTIGATION_POLYGONS_FULL_ID,
  TIMELINE_BEAT_MS,
} from "./nli-investigation-beats.js";
import {
  evaluateClock,
  flashPreviousClock,
  normalizeNliClock,
  nliPlayableIdsFromGroups,
} from "./nli-investigation-clock.js";
import {
  DEFAULT_INVESTIGATION_SETTLEMENTS_URL,
  buildInvestigationLineFeaturesForFrame,
  buildInvestigationSettlementOutlineIdsForFrame,
  buildInvestigationSettlementIndexes,
  createInvestigationTimelineData,
  ensureInvestigationLayerFeatures,
  ensureInvestigationSettlementFeatures,
  getInvestigationTimelineDataDiagnostics,
  investigationRouteBeats,
  lineProgressAt,
  objectIdsActiveAt,
  parseLocalTimelineToMinutes,
  refreshInvestigationTimelineData,
} from "./nli-investigation-timeline-data.js";
import { createInvestigationLineRenderer } from "./maplibre-investigation-lines.js";
import { createInvestigationPolygonRenderer } from "./maplibre-investigation-polygons.js";
import { NLI_DISPLAY_PROFILES, NLI_VISUAL_TOKENS } from "./nli-investigation-theme.js";
import { record as recordPerfSample } from "../map/perf-telemetry.js";
import { deriveInvestigationFrame } from "./nli-investigation-visual-state.js";

export {
  INVESTIGATION_ALARMS_FULL_ID,
  INVESTIGATION_LINES_FULL_ID,
  INVESTIGATION_POLYGONS_FULL_ID,
  TIMELINE_BEAT_MS,
  TIMELINE_HOLD_MS,
  clockStoryDurationMs,
  collectPlaybackTimelineBeats,
  collectTimelineBeats,
  collectUnionTimelineBeats,
  formatMinutesAsLocalClock,
  previousTimelineBeat,
  timelinePhaseAt,
} from "./nli-investigation-beats.js";
export {
  buildInvestigationSettlementIndexes,
  lineProgressAt,
  objectIdsActiveAt,
  parseLocalTimelineToMinutes,
} from "./nli-investigation-timeline-data.js";

const LINE_LAYER_ID_PREFIX = INVESTIGATION_LINES_FULL_ID.replace(/\./g, "__");

/** @type {WeakMap<object, object>} */
const stateByMap = new WeakMap();

/** In-flight sync generation + requested revision so a later Stop can abort an older Play. @type {WeakMap<object, { generation: number, revision: number }>} */
const syncRequestByMap = new WeakMap();

function beginTimelineSyncRequest(map, clock) {
  const prev = syncRequestByMap.get(map);
  const request = {
    generation: (prev?.generation || 0) + 1,
    revision: Number.isFinite(Number(clock?.revision)) ? Number(clock.revision) : 0,
  };
  syncRequestByMap.set(map, request);
  return request;
}

function isStaleTimelineSyncRequest(map, request) {
  const latest = syncRequestByMap.get(map);
  if (!latest || latest.generation !== request.generation) return true;
  if (request.revision < latest.revision) return true;
  return false;
}

function membershipFromClock(clock) {
  const set = new Set(Array.isArray(clock?.membership) ? clock.membership : []);
  return {
    polygonOn: set.has(INVESTIGATION_POLYGONS_FULL_ID),
    lineOn: set.has(INVESTIGATION_LINES_FULL_ID),
    alarmPlay: set.has(INVESTIGATION_ALARMS_FULL_ID),
  };
}

function resolveDisplayProfile(value) {
  const source = typeof value === "string"
    ? NLI_DISPLAY_PROFILES[value] || NLI_DISPLAY_PROFILES.gis
    : value && typeof value === "object"
      ? value
      : NLI_DISPLAY_PROFILES.gis;
  return { ...NLI_DISPLAY_PROFILES.gis, ...source };
}

function displayProfileFromDeps(deps = {}, fallback = NLI_DISPLAY_PROFILES.gis) {
  const profile = resolveDisplayProfile(deps.displayProfile ?? fallback);
  const beforeId = deps.beforeId ?? deps.beforeLayerId ?? deps.layerOrderAnchor ?? profile.beforeId ?? profile.beforeLayerId;
  if (beforeId) profile.beforeId = beforeId;
  return profile;
}

function effectiveMembership(clock, layerGroups) {
  const semantic = new Set(Array.isArray(clock?.membership) ? clock.membership.map(String) : []);
  const visible = new Set(nliPlayableIdsFromGroups(layerGroups));
  return {
    visible,
    ids: new Set([...semantic].filter((id) => visible.has(id))),
    polygonOn: semantic.has(INVESTIGATION_POLYGONS_FULL_ID) && visible.has(INVESTIGATION_POLYGONS_FULL_ID),
    lineOn: semantic.has(INVESTIGATION_LINES_FULL_ID) && visible.has(INVESTIGATION_LINES_FULL_ID),
    alarmPlay: semantic.has(INVESTIGATION_ALARMS_FULL_ID) && visible.has(INVESTIGATION_ALARMS_FULL_ID),
    alarmVisible: visible.has(INVESTIGATION_ALARMS_FULL_ID),
  };
}

function findLayerOrderAnchor(map, profile) {
  if (profile?.beforeId || profile?.beforeLayerId) return profile.beforeId || profile.beforeLayerId;
  const projection = Number(profile?.lineWidthMultiplier) > 1;
  const candidates = styleLayers(map);
  const preferred = projection
    ? candidates.find((layer) => /projection[-_ ]?highlight/i.test(String(layer?.id || "")))
    : candidates.find((layer) => layer?.type === "symbol" && /(settlement|people[_-]?names|(^|[_-])names|label)/i.test(String(layer?.id || ""))) ||
      candidates.find((layer) => /(settlement|people[_-]?names|(^|[_-])names|label)/i.test(String(layer?.id || "")));
  return preferred?.id || null;
}

function rendererFactories(map, state) {
  const anchor = findLayerOrderAnchor(map, state.displayProfile);
  if (anchor) state.displayProfile.beforeId = anchor;
  state.lineRenderer = createInvestigationLineRenderer(map, state.displayProfile);
  state.polygonRenderer = createInvestigationPolygonRenderer(map, state.displayProfile, state.rendererDeps);
  state.alarmRenderer = createInvestigationAlarmRenderer(map, state.displayProfile, {
    ...state.rendererDeps,
    onAlarmStructuralRowsBuild: (...args) => {
      state.alarmStructuralRowsBuilds += 1;
      state.rendererDeps?.onAlarmStructuralRowsBuild?.(...args);
    },
  });
}

function discardRendererHandles(state, { preserveBasePaints = false } = {}) {
  if (!state) return;
  for (const renderer of [state.alarmRenderer, state.lineRenderer, state.polygonRenderer]) {
    try { renderer?.dispose?.({ preserveBasePaints }); } catch (_) { /* style can already be gone */ }
  }
  state.alarmRenderer = null;
  state.lineRenderer = null;
  state.polygonRenderer = null;
  state.savedBaseLines = null;
  state.linePlaybackActive = false;
  state.polygonPlaybackActive = false;
  state.alarmMode = "off";
}

function styleLayers(map) {
  try {
    const style = typeof map.getStyle === "function" ? map.getStyle() : null;
    return Array.isArray(style?.layers) ? style.layers : [];
  } catch (_) {
    return [];
  }
}

function collectBaseLineLayerIds(map) {
  const ids = [];
  for (const layer of styleLayers(map)) {
    if (!layer || typeof layer.id !== "string") continue;
    if (!layer.id.startsWith(LINE_LAYER_ID_PREFIX)) continue;
    if (layer.type === "line") ids.push(layer.id);
  }
  return ids;
}

function mergeSavedPaints(map, saved, layerIds, keys) {
  const next = saved && typeof saved === "object" ? saved : {};
  const fresh = (layerIds || []).filter((id) => !next[id]);
  if (fresh.length === 0) return next;
  return { ...next, ...savePaints(map, fresh, keys) };
}

function savePaints(map, layerIds, keys) {
  const saved = {};
  for (const id of layerIds) {
    saved[id] = {};
    for (const key of keys) {
      try {
        saved[id][key] =
          typeof map.getPaintProperty === "function" ? map.getPaintProperty(id, key) : undefined;
      } catch (_) {
        saved[id][key] = undefined;
      }
    }
  }
  return saved;
}

function restorePaints(map, saved) {
  if (!saved || typeof map.setPaintProperty !== "function") return;
  for (const [id, props] of Object.entries(saved)) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined) continue;
      try {
        map.setPaintProperty(id, key, value);
      } catch (_) {
        /* layer may have been removed */
      }
    }
  }
}

function invalidateTimelineSyncRequests(map) {
  const previous = syncRequestByMap.get(map);
  syncRequestByMap.set(map, {
    generation: (previous?.generation || 0) + 1,
    revision: Number.POSITIVE_INFINITY,
  });
}

function hideBaseLines(map, saved) {
  if (!saved || typeof map.setPaintProperty !== "function") return;
  for (const id of Object.keys(saved)) {
    try {
      map.setPaintProperty(id, "line-opacity", 0);
    } catch (_) {
      /* ignore */
    }
  }
}

function mapCaptionContainer(map) {
  return typeof map.getContainer === "function" ? map.getContainer() : null;
}

function queryMapCaptionEl(map) {
  const container = mapCaptionContainer(map);
  if (!container || typeof container.querySelector !== "function") return null;
  return container.querySelector(".nli-investigation-timeline-caption");
}

function removeLeftoverMapCaption(map, keepEl) {
  const leftover = queryMapCaptionEl(map);
  if (!leftover || leftover === keepEl) return;
  const container = mapCaptionContainer(map);
  if (container && typeof container.removeChild === "function") {
    container.removeChild(leftover);
    return;
  }
  if (leftover.parentNode && typeof leftover.parentNode.removeChild === "function") {
    leftover.parentNode.removeChild(leftover);
  }
}

function setCaptionDirRtl(el) {
  if (!el) return;
  el.dir = "rtl";
  if (typeof el.setAttribute === "function") el.setAttribute("dir", "rtl");
}

function ensureCaptionEl(map) {
  if (typeof document === "undefined") return null;
  const container = mapCaptionContainer(map);
  if (!container || typeof container.appendChild !== "function") return null;
  let el = queryMapCaptionEl(map);
  if (!el) {
    el = document.createElement("div");
    el.className = "nli-investigation-timeline-caption";
    el.hidden = true;
    setCaptionDirRtl(el);
    container.appendChild(el);
  } else {
    setCaptionDirRtl(el);
  }
  return el;
}

function applyCaptionDeps(state, map, deps = {}) {
  state.nliCaptionMode = deps.nliCaptionMode === NLI_CAPTION_MODE_CLOCK_ONLY
    ? NLI_CAPTION_MODE_CLOCK_ONLY
    : "full";
  state.explainerDebugVisible = deps.explainerDebugVisible === true;
  if (deps.captionEl) {
    removeLeftoverMapCaption(map, deps.captionEl);
    state.captionEl = deps.captionEl;
    state.captionOwned = false;
    setCaptionDirRtl(state.captionEl);
    return;
  }
  if (deps.allowMapCaption === false) {
    if (state.captionOwned) {
      removeLeftoverMapCaption(map);
      state.captionEl = null;
      state.captionOwned = false;
    }
    return;
  }
  if (!state.captionOwned || !state.captionEl) {
    state.captionEl = ensureCaptionEl(map);
    state.captionOwned = !!state.captionEl;
  }
  setCaptionDirRtl(state.captionEl);
}

function explainerPreviousClock(state, clockMinutes) {
  const beats = Array.isArray(state.clock?.beats) ? state.clock.beats : [];
  return flashPreviousClock(beats, clockMinutes);
}

function updateCaption(state, phase, _previousClock) {
  const el = state.captionEl;
  if (!el) return;
  setCaptionDirRtl(el);
  const playbackOn =
    state.clockPhase === "playing" || state.clockPhase === "paused" || state.clockPhase === "ended";
  const liveBeat = playbackOn && phase.mode === "beat" && phase.clock != null;
  if (liveBeat) {
    state.lastCaption = {
      clock: phase.clock,
      previousClock: explainerPreviousClock(state, phase.clock),
      polygonOn: state.polygonOn,
      lineOn: state.lineOn,
      alarmPlay: state.alarmMode === "play",
    };
  }
  const snap = liveBeat
    ? state.lastCaption
    : playbackOn && phase.mode === "hold" && state.lastCaption
      ? state.lastCaption
      : null;
  if (snap) {
    const model = buildNliExplainerModel({
      polygonOn: snap.polygonOn,
      lineOn: snap.lineOn,
      alarmPlay: snap.alarmPlay,
      polygonFeatures: state.data.polygonFeatures,
      lineFeatures: state.data.lineFeatures,
      alarmFeatures: state.data.alarmFeatures,
      clock: snap.clock,
      previousClock: snap.previousClock,
    });
    el.hidden = false;
    el.innerHTML = nliExplainerInnerHtml(model, {
      nliCaptionMode: state.nliCaptionMode,
    });
    return;
  }
  if (state.explainerDebugVisible) {
    el.hidden = false;
    el.innerHTML = nliExplainerInnerHtml(NLI_EXPLAINER_SAMPLE_MODEL);
    return;
  }
  el.hidden = true;
  el.innerHTML = "";
}

function jumpPreviousClock(state, vis, frame) {
  const clock = state.clock;
  const beats = Array.isArray(clock?.beats) ? clock.beats : [];
  const isJump = clock?.seekKind === "jump";
  if (!isJump) return flashPreviousClock(beats, vis.clock, { isJump });
  return frame?.activeProgress < 1
    ? flashPreviousClock(beats, vis.clock, { isJump })
    : vis.clock;
}

function applyRestingRoutePaints(map, visible) {
  if (typeof map?.setPaintProperty !== "function") return;
  for (const id of collectBaseLineLayerIds(map)) {
    try {
      map.setPaintProperty(id, "line-color", NLI_VISUAL_TOKENS.incidentRed);
      map.setPaintProperty(
        id,
        "line-opacity",
        visible ? NLI_VISUAL_TOKENS.routeRestingOpacity : 0,
      );
    } catch (_) {
      // A style reload can remove a base layer during idle reconciliation.
    }
  }
}

/** Render visible routes in the completed narrative state while the timeline is idle. */
function applyIdleFinalRouteVisuals(map, state, nowMs) {
  if (!state?.lineOn || !Array.isArray(state.data?.lineFeatures)) return;
  const beats = investigationRouteBeats(state.data);
  const ambientClock = normalizeNliClock({
    phase: "ended",
    membership: [INVESTIGATION_LINES_FULL_ID],
    beats,
    revision: state.clock?.revision,
    serverNowMs: state.clock?.serverNowMs,
  });
  const frame = deriveInvestigationFrame(
    ambientClock,
    nowMs,
    [INVESTIGATION_LINES_FULL_ID],
    { motionMode: state.motionMode || "full", routeBeats: beats },
  );
  state.clock = ambientClock;
  state.lastFrame = frame;
  state.lastRenderNow = nowMs;
  state.lineRenderer?.render(frame, buildInvestigationLineFeaturesForFrame(state.data, frame));
  if (shouldRafClock(frame)) scheduleFrame(map, state);
  else cancelScheduledFrame(state);
}

function deriveTimelineFrame(state, nowMs, enabledIds = [...(state.effectiveIds || [])]) {
  return deriveInvestigationFrame(state.clock, nowMs, enabledIds, {
    motionMode: state.motionMode || "full",
    routeBeats: Array.isArray(state.data.lineFeatures)
      ? investigationRouteBeats(state.data)
      : [],
  });
}

function applyPlayingVisuals(map, state, phase, frame = null, targetAlarmMode = state.alarmMode) {
  const resolvedFrame = frame || deriveTimelineFrame(state, state.now?.() || 0);
  const previousClock = jumpPreviousClock(state, phase, frame);
  let alarmFrame = frame
    ? {
        ...frame,
        // The first ordinary beat uses an open window. An intentional jump
        // carries the explicit previous-clock boundary, so it cannot replay
        // every earlier alarm as a first-beat megawave.
        alarmOnsetWindowStart: state.clock?.seekKind === "jump"
          ? previousClock
          : frame.completedBeats?.length
            ? frame.completedBeats[frame.completedBeats.length - 1]
            : null,
      }
    : null;
  if (alarmFrame?.alarmOnsetId) {
    const onsetId = alarmFrame.alarmOnsetId;
    const onsetElapsedMs = Number(alarmFrame.alarmOnset?.elapsedMs);
    const onsetConsumed = state.alarmOnsetHistory.has(onsetId);
    const onsetFinished = Number.isFinite(onsetElapsedMs) &&
      onsetElapsedMs >= NLI_VISUAL_TOKENS.alarmRippleDurationMs;
    if (onsetConsumed || onsetFinished) {
      alarmFrame = { ...alarmFrame, alarmOnset: null, alarmOnsetId: null };
      if (onsetFinished) state.alarmOnsetHistory.add(onsetId);
    }
  }
  applyAlarmMode(map, state, targetAlarmMode, {
    frame: alarmFrame || resolvedFrame,
    dataVersion: state.data.dataVersion,
  });
  // Ambient idle route flow owns only the line carrier/motion. Settlement
  // outlines stay reset until a real timeline phase reaches the route.
  if (state.polygonOn || (state.lineOn && state.clockPhase !== "idle")) {
    const lineData = Array.isArray(state.data.lineFeatures)
      ? buildInvestigationLineFeaturesForFrame(state.data, resolvedFrame)
      : { futureFeatures: [], completedFeatures: [], activeFeatures: [] };
    const polygonFrame = {
      ...resolvedFrame,
      achievedSettlementOutlineIds: [
        ...buildInvestigationSettlementOutlineIdsForFrame(
          state.data,
          resolvedFrame,
          lineData,
        ),
      ],
    };
    const renderSettlement = state.polygonOn
      ? state.polygonRenderer?.render
      : state.polygonRenderer?.renderSettlement;
    renderSettlement?.call(state.polygonRenderer, polygonFrame, {
      polygonFeatures: state.data.polygonFeatures,
      locationToOutlineObjectId: state.data.locationToOutlineObjectId,
      settlementFeatures: state.data.settlementFeatures,
      settlementFeaturesByOutlineId: state.data.settlementFeaturesByOutlineId,
      dataVersion: state.data.dataVersion,
    });
  }
  if (state.lineOn) {
    state.lineRenderer?.render(
      resolvedFrame,
      buildInvestigationLineFeaturesForFrame(state.data, resolvedFrame),
    );
  }
  // Keep the adapter's previous mode available until it applies the transition,
  // then publish the target mode for captions and subsequent animation ticks.
  state.alarmMode = targetAlarmMode;
  updateCaption(state, phase, previousClock);
}

function enablePolygonPlayback(map, state) {
  state.polygonRenderer?.mount();
  state.polygonPlaybackActive = true;
}

function disablePolygonPlayback(map, state, { preserveBasePaints = false } = {}) {
  if (!state.polygonPlaybackActive) return;
  state.polygonRenderer?.reset({ preserveBasePaints });
  state.polygonPlaybackActive = false;
}

function enableLinePlayback(map, state) {
  const baseIds = collectBaseLineLayerIds(map);
  if (!state.linePlaybackActive) {
    state.savedBaseLines = mergeSavedPaints(map, state.savedBaseLines, baseIds, ["line-opacity"]);
    hideBaseLines(map, state.savedBaseLines);
    state.linePlaybackActive = true;
  } else {
    const previousIds = new Set(Object.keys(state.savedBaseLines || {}));
    const freshIds = baseIds.filter((id) => !previousIds.has(id));
    if (freshIds.length) {
      state.savedBaseLines = mergeSavedPaints(map, state.savedBaseLines, freshIds, ["line-opacity"]);
      hideBaseLines(map, Object.fromEntries(freshIds.map((id) => [id, state.savedBaseLines[id]])));
    }
  }
  state.lineRenderer?.mount();
}

function disableLinePlayback(map, state, { preserveBasePaints = false } = {}) {
  if (!state.linePlaybackActive && !state.savedBaseLines) {
    state.lineRenderer?.reset({ preserveBasePaints });
    return;
  }
  if (!preserveBasePaints) restorePaints(map, state.savedBaseLines);
  state.savedBaseLines = null;
  state.lineRenderer?.reset({ preserveBasePaints });
  state.linePlaybackActive = false;
}

function createTimelineState(map, deps = {}) {
  const displayProfile = displayProfileFromDeps(deps);
  const requestAnimationFrameFn = typeof deps.requestAnimationFrame === "function"
    ? deps.requestAnimationFrame
    : typeof map.requestAnimationFrame === "function"
      ? map.requestAnimationFrame.bind(map)
      : typeof globalThis.requestAnimationFrame === "function"
        ? globalThis.requestAnimationFrame.bind(globalThis)
        : null;
  const cancelAnimationFrameFn = typeof deps.cancelAnimationFrame === "function"
    ? deps.cancelAnimationFrame
    : typeof map.cancelAnimationFrame === "function"
      ? map.cancelAnimationFrame.bind(map)
      : typeof globalThis.cancelAnimationFrame === "function"
        ? globalThis.cancelAnimationFrame.bind(globalThis)
        : null;
  const monotonicNow = typeof deps.monotonicNow === "function"
    ? deps.monotonicNow
    : typeof deps.schedulerNow === "function"
      ? deps.schedulerNow
      : typeof globalThis.performance?.now === "function"
        ? () => globalThis.performance.now()
        : () => Date.now();
  const state = {
    clockPhase: "idle",
    clock: null,
    polygonOn: false,
    lineOn: false,
    alarmMode: "off",
    data: createInvestigationTimelineData(deps),
    now: typeof deps.now === "function" ? deps.now : () => Date.now(),
    monotonicNow,
    rafId: null,
    requestAnimationFrame: requestAnimationFrameFn,
    cancelAnimationFrame: cancelAnimationFrameFn,
    lastRenderNow: null,
    lastFrame: null,
    captionEl: null,
    captionOwned: false,
    explainerDebugVisible: false,
    nliCaptionMode: deps.nliCaptionMode === NLI_CAPTION_MODE_CLOCK_ONLY
      ? NLI_CAPTION_MODE_CLOCK_ONLY
      : "full",
    lastCaption: null,
    savedBaseLines: null,
    displayProfile,
    alarmRenderer: null,
    lineRenderer: null,
    polygonRenderer: null,
    polygonPlaybackActive: false,
    linePlaybackActive: false,
    motionMode: deps.motionMode === "reduced" ? "reduced" : "full",
    rendererDeps: deps,
    styleListener: null,
    styleReady: true,
    awaitingStyleRemount: false,
    effectiveIds: new Set(),
    routeLayerVisible: false,
    alarmOnsetHistory: new Set(),
    alarmStructuralRowsBuilds: 0,
  };
  Object.defineProperties(state, {
    alarmFeatures: { enumerable: false, get: () => state.data.alarmFeatures },
    dataVersion: { enumerable: false, get: () => state.data.dataVersion },
  });
  rendererFactories(map, state);
  return state;
}

function getOrCreateState(map, deps = {}) {
  let state = stateByMap.get(map);
  if (!state) {
    state = createTimelineState(map, deps);
    stateByMap.set(map, state);
    attachTimelineStyleListeners(map, state);
  }
  state.rendererDeps = deps;
  if (typeof deps.requestAnimationFrame === "function") state.requestAnimationFrame = deps.requestAnimationFrame;
  else if (!state.requestAnimationFrame && typeof map.requestAnimationFrame === "function") state.requestAnimationFrame = map.requestAnimationFrame.bind(map);
  if (typeof deps.cancelAnimationFrame === "function") state.cancelAnimationFrame = deps.cancelAnimationFrame;
  else if (!state.cancelAnimationFrame && typeof map.cancelAnimationFrame === "function") state.cancelAnimationFrame = map.cancelAnimationFrame.bind(map);
  if (typeof deps.monotonicNow === "function") state.monotonicNow = deps.monotonicNow;
  else if (typeof deps.schedulerNow === "function") state.monotonicNow = deps.schedulerNow;
  return state;
}

function attachTimelineStyleListeners(map, state) {
  if (state.styleListener || typeof map?.on !== "function") return;
  const handleStyleReload = () => {
    cancelScheduledFrame(state);
    if (state.alarmRenderer || state.lineRenderer || state.polygonRenderer) {
      discardRendererHandles(state, { preserveBasePaints: true });
    }
    state.styleReady = true;
    state.awaitingStyleRemount = true;
  };
  state.styleListener = handleStyleReload;
  map.on("style.load", handleStyleReload);
}

function cancelScheduledFrame(state) {
  if (!state || state.rafId == null) return;
  try { state.cancelAnimationFrame?.(state.rafId); } catch (_) { /* map may be destroyed */ }
  state.rafId = null;
}

function scheduleFrame(map, state) {
  if (!state || state.rafId != null || state.awaitingStyleRemount || !state.requestAnimationFrame) return;
  state.rafId = state.requestAnimationFrame(() => {
    state.rafId = null;
    tick(map);
  });
}

function stopPlayback(map, { preserveBasePaints = false } = {}) {
  const state = stateByMap.get(map);
  if (!state) return;
  cancelScheduledFrame(state);
  state.clockPhase = "idle";
  state.alarmMode = "off";
  state.lastCaption = null;
  state.lastFrame = null;
  state.lastRenderNow = null;
  const polygonWasPlaying = state.polygonPlaybackActive;
  disablePolygonPlayback(map, state, { preserveBasePaints });
  if (!polygonWasPlaying) state.polygonRenderer?.reset({ preserveBasePaints });
  disableLinePlayback(map, state, { preserveBasePaints });
  state.alarmRenderer?.reset({ preserveBasePaints });
  updateCaption(state, { mode: "hold", clock: null, index: -1, beatElapsedMs: 0 });
}

function shouldRafClock(frame) {
  return !!frame?.needsNextFrame;
}

function tick(map) {
  const state = stateByMap.get(map);
  if (!state?.clock || state.awaitingStyleRemount) return;
  const clock = state.clock;
  const nowFn = state.now || (() => Date.now());
  const nowMs = nowFn();
  const started = state.monotonicNow();
  const frame = deriveTimelineFrame(state, nowMs);
  const rippleEnded = state.lastFrame?.rippleNeedsFrames === true && frame.rippleNeedsFrames === false;
  const renderDue = state.lastRenderNow == null ||
    nowMs - state.lastRenderNow >= NLI_VISUAL_TOKENS.completedFlowStepMs ||
    rippleEnded;
  if (renderDue) {
    const vis = evaluateClock(clock, nowMs);
    if (
      clock.phase === "playing" ||
      clock.phase === "ended" ||
      (clock.phase === "paused" && clock.seekKind === "jump") ||
      frame.completedFlowNeedsFrames ||
      frame.rippleNeedsFrames ||
      rippleEnded
    ) {
      applyPlayingVisuals(map, state, vis, frame, state.alarmMode);
    }
    state.lastRenderNow = nowMs;
    state.lastFrame = frame;
  }
  const elapsed = Math.max(0, state.monotonicNow() - started);
  recordPerfSample("nliSchedulerMs", elapsed);
  if (shouldRafClock(frame)) scheduleFrame(map, state);
}

function applyStoryPlayback(map, state) {
  ensureRendererHandles(map, state);
  if (state.polygonOn) {
    if (!state.polygonPlaybackActive) enablePolygonPlayback(map, state);
  } else {
    disablePolygonPlayback(map, state);
    if (!state.lineOn) state.polygonRenderer?.reset({ preserveBasePaints: true });
  }
  if (state.lineOn) enableLinePlayback(map, state);
  else disableLinePlayback(map, state);
}

function resetEffectiveRenderers(map, state, nextMembership, { preservePolygonBasePaints = true } = {}) {
  if (state.lineOn && !nextMembership.lineOn) {
    disableLinePlayback(map, state);
    applyRestingRoutePaints(
      map,
      nextMembership.visible.has(INVESTIGATION_LINES_FULL_ID),
    );
  }
  if (state.polygonOn && !nextMembership.polygonOn) {
    // The host polygon layer can be hidden independently of the narrative.
    // Remove the owned settlement overlay immediately while retaining the
    // current base paint expression until this sync computes its next frame.
    disablePolygonPlayback(map, state, { preserveBasePaints: preservePolygonBasePaints });
  }
  if (state.alarmMode !== "off" && !nextMembership.alarmVisible) applyAlarmMode(map, state, "off");
}

function ensureRendererHandles(map, state) {
  if (state.alarmRenderer && state.lineRenderer && state.polygonRenderer) return;
  rendererFactories(map, state);
}

/**
 * Invalidate renderer handles before a host `setStyle` call. Cached feature
 * data and clock state stay in the coordinator; fresh handles are created on
 * the first sync after the host style has loaded.
 */
export function prepareInvestigationTimelineForStyleReload(map) {
  const state = stateByMap.get(map);
  if (!state) return;
  invalidateTimelineSyncRequests(map);
  cancelScheduledFrame(state);
  state.styleReady = false;
  state.awaitingStyleRemount = true;
  discardRendererHandles(state, { preserveBasePaints: true });
}

/** Return bounded coordinator counters used by scheduler and cache tests. */
export function getInvestigationTimelineDiagnostics(map) {
  const state = stateByMap.get(map);
  const data = getInvestigationTimelineDataDiagnostics(state?.data);
  return {
    linePartitionBuilds: data.linePartitionBuilds,
    linePartitionFrameBuilds: data.linePartitionFrameBuilds,
    collisionIndexBuilds: data.collisionIndexBuilds,
    alarmStructuralRowsBuilds: state?.alarmStructuralRowsBuilds || 0,
  };
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {import('./nli-investigation-clock.js').NliInvestigationClock|null|undefined} clockInput
 * @param {unknown} layerGroups
 * @param {{
 *   features?: object[],
 *   featuresById?: Record<string, object[]>,
 *   getLayerDataUrl?: (fullId: string) => string | null,
 *   investigationSettlementsUrl?: string,
 *   settlementFeatures?: object[],
 *   locationToOutlineObjectId?: Map<string, string|number>|Record<string, string|number>,
 *   settlementFeaturesByOutlineId?: Map<string, object>|Record<string, object>,
 *   dataVersion?: string|number,
 *   fetchJson?: (url: string) => Promise<unknown>,
 *   now?: () => number,
 *   monotonicNow?: () => number,
 *   requestAnimationFrame?: (callback: (timestamp: number) => void) => number,
 *   cancelAnimationFrame?: (id: number) => void,
 *   visibilityLayerGroups?: unknown,
 *   displayProfile?: 'gis'|'projection'|object,
 *   nliCaptionMode?: 'full'|'clock-only',
 *   motionMode?: 'full'|'reduced',
 *   captionEl?: HTMLElement | null,
 *   allowMapCaption?: boolean,
 *   explainerDebugVisible?: boolean,
 * }} [deps]
 */
export async function syncInvestigationTimelineToMap(map, clockInput, layerGroups, deps = {}) {
  if (!map || typeof map.getStyle !== "function") return;
  const state = getOrCreateState(map, deps);
  const visibilityGroups = deps.visibilityLayerGroups != null ? deps.visibilityLayerGroups : layerGroups;
  const clock = normalizeNliClock(clockInput);
  const syncRequest = beginTimelineSyncRequest(map, clock);
  const nowFn = typeof deps.now === "function" ? deps.now : state.now || (() => Date.now());
  state.now = nowFn;
  state.motionMode = deps.motionMode === "reduced" ? "reduced" : "full";
  state.displayProfile = displayProfileFromDeps(deps, state.displayProfile);
  state.rendererDeps = deps;
  applyCaptionDeps(state, map, deps);

  // A setStyle call can fire style.load before the host has re-synced its base
  // layers. The style listener marks the coordinator ready; this branch keeps
  // stale calls inert until that lifecycle event arrives.
  if (state.awaitingStyleRemount && !state.styleReady) {
    state.clock = clock;
    state.clockPhase = clock.phase;
    refreshInvestigationTimelineData(state.data, deps);
    return;
  }
  if (state.awaitingStyleRemount) {
    ensureRendererHandles(map, state);
    state.awaitingStyleRemount = false;
  }

  refreshInvestigationTimelineData(state.data, deps);
  const nextMembership = effectiveMembership(clock, visibilityGroups);
  state.routeLayerVisible = nextMembership.visible.has(INVESTIGATION_LINES_FULL_ID);
  // Visibility changes are applied before any optional network work so a
  // hidden renderer cannot remain visible while its sibling dataset loads.
  resetEffectiveRenderers(map, state, nextMembership, { preservePolygonBasePaints: clock.phase !== "idle" });

  if (clock.phase === "idle") {
    if (state.clockPhase !== "idle") stopPlayback(map);
    else cancelScheduledFrame(state);
    state.clock = clock;
    state.clockPhase = "idle";
    state.polygonOn = false;
    state.lineOn = nextMembership.visible.has(INVESTIGATION_LINES_FULL_ID);
    state.effectiveIds = state.lineOn ? new Set([INVESTIGATION_LINES_FULL_ID]) : new Set();
    state.lastCaption = null;
    if (state.lineOn) {
      await ensureInvestigationLayerFeatures(state.data, deps, "lineFeatures", INVESTIGATION_LINES_FULL_ID, {
        request: syncRequest,
        isCurrent: () => !isStaleTimelineSyncRequest(map, syncRequest),
      });
      if (isStaleTimelineSyncRequest(map, syncRequest)) return;
      enableLinePlayback(map, state);
      applyIdleFinalRouteVisuals(map, state, nowFn());
    } else {
      applyRestingRoutePaints(map, false);
    }
    const alarmsVisible = nextMembership.alarmVisible;
    if (alarmsVisible) {
      await ensureInvestigationLayerFeatures(state.data, deps, "alarmFeatures", INVESTIGATION_ALARMS_FULL_ID, {
        request: syncRequest,
        isCurrent: () => !isStaleTimelineSyncRequest(map, syncRequest),
      });
      if (isStaleTimelineSyncRequest(map, syncRequest)) return;
      applyAlarmMode(map, state, "idle", {
        frame: deriveInvestigationFrame(clock, nowFn(), [], { motionMode: state.motionMode || "full" }),
      });
    } else {
      applyAlarmMode(map, state, "off");
    }
    updateCaption(state, { mode: "hold", clock: null, index: -1, beatElapsedMs: 0 });
    return;
  }

  /** @type {'off' | 'idle' | 'play'} */
  const alarmMode = nextMembership.alarmPlay
    ? "play"
    : nextMembership.alarmVisible
      ? "idle"
      : "off";

  if (nextMembership.polygonOn) {
    await ensureInvestigationLayerFeatures(state.data, deps, "polygonFeatures", INVESTIGATION_POLYGONS_FULL_ID, {
      request: syncRequest,
      isCurrent: () => !isStaleTimelineSyncRequest(map, syncRequest),
    });
    if (isStaleTimelineSyncRequest(map, syncRequest)) return;
  }
  if (nextMembership.lineOn || nextMembership.polygonOn) {
    await ensureInvestigationSettlementFeatures(state.data, deps, {
      request: syncRequest,
      isCurrent: () => !isStaleTimelineSyncRequest(map, syncRequest),
    });
    if (isStaleTimelineSyncRequest(map, syncRequest)) return;
    await ensureInvestigationLayerFeatures(state.data, deps, "lineFeatures", INVESTIGATION_LINES_FULL_ID, {
      request: syncRequest,
      isCurrent: () => !isStaleTimelineSyncRequest(map, syncRequest),
    });
    if (isStaleTimelineSyncRequest(map, syncRequest)) return;
  }
  if (alarmMode !== "off") {
    await ensureInvestigationLayerFeatures(state.data, deps, "alarmFeatures", INVESTIGATION_ALARMS_FULL_ID, {
      request: syncRequest,
      isCurrent: () => !isStaleTimelineSyncRequest(map, syncRequest),
    });
    if (isStaleTimelineSyncRequest(map, syncRequest)) return;
  }

  const nowMs = nowFn();
  const semantic = membershipFromClock(clock);
  const vis = evaluateClock(clock, nowMs);
  state.clock = clock;
  state.clockPhase = clock.phase;
  state.polygonOn = nextMembership.polygonOn;
  state.lineOn = nextMembership.lineOn;
  state.effectiveIds = nextMembership.ids;
  const frame = deriveInvestigationFrame(
    clock,
    nowMs,
    [...state.effectiveIds],
    {
      motionMode: state.motionMode,
      routeBeats: investigationRouteBeats(state.data),
    },
  );
  state.lastFrame = frame;
  state.lastRenderNow = nowMs;
  applyStoryPlayback(map, state);
  applyPlayingVisuals(map, state, vis, frame, alarmMode);
  if (semantic.polygonOn && !nextMembership.polygonOn) {
    const semanticFrame = deriveInvestigationFrame(
      clock,
      nowMs,
      clock.membership || [],
      {
        motionMode: state.motionMode,
        routeBeats: investigationRouteBeats(state.data),
      },
    );
    state.polygonRenderer?.render(semanticFrame, {
      polygonFeatures: state.data.polygonFeatures,
      locationToOutlineObjectId: state.data.locationToOutlineObjectId,
      settlementFeatures: state.data.settlementFeatures,
      settlementFeaturesByOutlineId: state.data.settlementFeaturesByOutlineId,
      dataVersion: state.data.dataVersion,
    });
    state.polygonRenderer?.reset({ preserveBasePaints: true });
  }

  if (shouldRafClock(frame)) scheduleFrame(map, state);
  else cancelScheduledFrame(state);
}

export function disposeInvestigationTimelineForMap(map) {
  if (!map) return;
  invalidateTimelineSyncRequests(map);
  const state = stateByMap.get(map);
  if (!state) return;
  stopPlayback(map);
  applyRestingRoutePaints(map, state.routeLayerVisible);
  discardRendererHandles(state);
  if (state.styleListener && typeof map.off === "function") {
    try { map.off("style.load", state.styleListener); } catch (_) { /* map may be destroyed */ }
  }
  if (state.captionOwned && state.captionEl?.parentNode) {
    state.captionEl.parentNode.removeChild(state.captionEl);
  } else if (state.captionEl) {
    state.captionEl.hidden = true;
    state.captionEl.innerHTML = "";
  }
  stateByMap.delete(map);
}
