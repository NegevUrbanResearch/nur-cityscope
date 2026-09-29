import { APP_CONFIG } from "../config/app-config.js";
import { createGisNarrativeController } from "./nli-narrative-controller.js";
import { createGISMap, setGISBasemap } from "./maplibre-map.js";
import { applyLayerGroupsToMap, clearAllLayers, disposeLayerManagerForMap } from "./maplibre-layer-manager.js";
import { applyNarrativeHouseOutlineFilter, applyNarrativePeopleFilter } from "./nli-people-marker-filter.js";
import { installGisStyleReload } from "../entries/map-main-style-lifecycle.js";
import { HOME_CUE, TIMELINE, NARRATIVES } from "../remote/nli-staff-script.js";
import { getNliNarrative } from "../shared/nli-narratives.js";
import { filterGroupsForGisMap } from "../shared/gis-layer-filter.js";
import { idleNliClock, normalizeNliClock } from "../shared/nli-investigation-clock.js";
import { normalizeGisBasemap } from "../shared/gis-basemap.js";
import layerRegistry from "../shared/layer-registry.js";
import { resolveMotionMode } from "../shared/reduced-motion.js";
import { syncInvestigationTimelineToMap, disposeInvestigationTimelineForMap } from "../shared/maplibre-investigation-timeline.js";
import {
  applyNliExplainerLayout,
  ensureNliExplainerHost,
  NLI_GIS_CLOCK_DEFAULT_LAYOUT,
} from "../projection/nli-explainer-overlay.js";

const GIS_PREVIEW_SCENE_IDS = Object.freeze([
  "home", "timeline", "segev", "nova", "sderot", "hostages", "hostages_all",
]);
const GIS_PREVIEW_SCENE_ID_SET = new Set(GIS_PREVIEW_SCENE_IDS);
const DEFAULT_CENTER = [34.5, 31.4];
const VALID_CLOCK_LAYOUT_KEYS = ["leftPct", "topPct", "widthPct", "heightPct", "fontPx", "rotateDeg"];
const DRAW_COMPLETION_TIMEOUT_MS = 5000;

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function cloneCue(cue) {
  return { ...cue, layers: [...(cue?.layers || [])], escape: { ...(cue?.escape || {}) } };
}

function sceneCue(sceneId) {
  if (sceneId === "home") return HOME_CUE;
  if (sceneId === "timeline") return TIMELINE.steps.at(-1).cue;
  const sourceId = sceneId === "hostages_all" ? "hostages" : sceneId;
  const source = NARRATIVES.find((item) => item.id === sourceId);
  if (!source) return null;
  if (sceneId === "hostages_all") return source.steps.at(-1).cue;
  return source.steps[0]?.cue || null;
}

function groupsWithCue(registryGroups, cue) {
  const enabledIds = new Set(cue.layers || []);
  return (Array.isArray(registryGroups) ? registryGroups : []).map((group) => {
    const layers = (group.layers || []).map((layer) => {
      const fullId = `${group.id}.${layer.id}`;
      return { ...layer, enabled: enabledIds.has(fullId) };
    });
    return { ...group, enabled: layers.some((layer) => layer.enabled), layers };
  });
}

/** Compose a preview-only copy from the same cues and narratives used by the exhibit. */
export function composeGisClockPreviewScene(sceneId, registryGroups, nowMs = Date.now()) {
  if (!GIS_PREVIEW_SCENE_ID_SET.has(sceneId)) throw new Error("Unknown GIS preview scene");
  const rawCue = sceneCue(sceneId);
  if (!rawCue) throw new Error(`Missing cue for GIS preview scene: ${sceneId}`);
  const cue = cloneCue(rawCue);
  const narrative = getNliNarrative(sceneId === "home" || sceneId === "timeline" ? null : sceneId);
  const clock = normalizeNliClock(idleNliClock({ serverNowMs: nowMs }));
  return {
    sceneId,
    cue,
    groups: groupsWithCue(clone(registryGroups) || [], cue),
    narrative,
    center: narrative?.center || null,
    zoom: narrative?.zoom ?? null,
    basemap: narrative?.basemap || null,
    clock,
    captionMinute: narrative
      ? (Number.isFinite(narrative.idleClockMinutes) ? narrative.idleClockMinutes : 389)
      : null,
  };
}

function viewportCenter(viewport) {
  const bbox = viewport?.bbox;
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) return DEFAULT_CENTER;
  const [west, south, east, north] = bbox;
  if (typeof proj4 !== "function") return DEFAULT_CENTER;
  const center = proj4("EPSG:2039", "EPSG:4326", [(west + east) / 2, (south + north) / 2]);
  return center?.every(Number.isFinite) ? center : DEFAULT_CENTER;
}

function validLayout(layout) {
  return layout && typeof layout === "object" && !Array.isArray(layout) &&
    VALID_CLOCK_LAYOUT_KEYS.every((key) => Number.isFinite(layout[key]));
}

function postFrameMessage(target, payload, targetOrigin) {
  target?.postMessage?.(payload, targetOrigin);
}

function failRequest(parent, targetOrigin, sessionId, requestId, error) {
  postFrameMessage(parent, {
    type: "otef_clock_preview_error",
    sessionId,
    requestId,
    message: error instanceof Error ? error.message : String(error),
  }, targetOrigin);
}

function waitForIdle(map, isCurrent, pendingDrawWaits) {
  return new Promise((resolve, reject) => {
    if (typeof map.on !== "function" || typeof map.off !== "function") {
      reject(new Error("GIS preview cannot observe draw completion"));
      return;
    }
    let settled = false;
    let timeout;
    const cleanup = () => {
      map.off("idle", onIdle);
      clearTimeout(timeout);
      pendingDrawWaits.delete(cancel);
    };
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(isCurrent());
    };
    const onIdle = () => finish();
    const cancel = () => {
      const error = new Error("GIS preview draw was superseded");
      error.name = "AbortError";
      finish(error);
    };
    pendingDrawWaits.add(cancel);
    map.on("idle", onIdle);
    timeout = setTimeout(
      () => finish(new Error("GIS preview draw timed out")),
      DRAW_COMPLETION_TIMEOUT_MS,
    );
  });
}

async function readStateSnapshot(fetchImpl) {
  const response = await fetchImpl(`${APP_CONFIG.api.viewportBase}/otef/`);
  if (!response?.ok) throw new Error(`GIS preview could not read viewport snapshot (${response?.status ?? "network error"})`);
  const value = await response.json();
  return value && typeof value === "object" ? value : {};
}

function localEscapeContext() {
  let value = { mor: false };
  const subscribers = new Set();
  return {
    get: () => value,
    set(next) {
      value = next && typeof next === "object" ? { ...next } : { mor: false };
      for (const callback of subscribers) callback(value);
    },
    subscribe(callback) {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
  };
}

function previewStateFromEvent(event, sessionId, lastRequestId, origin) {
  if (event.origin !== origin || event.source !== event.currentTarget?.parent || event.data?.type !== "otef_clock_preview_state") return null;
  const state = event.data;
  if (state.sessionId !== sessionId || !Number.isInteger(state.requestId) || state.requestId <= 0 || state.requestId <= lastRequestId) return null;
  if (state.surface !== "gis" || state.output != null || !GIS_PREVIEW_SCENE_ID_SET.has(state.sceneId)) {
    throw new Error("Invalid GIS preview scene request");
  }
  if (typeof state.element !== "string" || !state.element || !validLayout(state.clockLayout)) {
    throw new Error("Invalid GIS preview clock layout");
  }
  if (state.pageIndex != null && (!Number.isInteger(state.pageIndex) || state.pageIndex < 0)) {
    throw new Error("Invalid GIS preview page index");
  }
  return state;
}

/** Boot one isolated, read-only GIS preview frame and return its disposer. */
export async function bootClockPreview({ window: frameWindow, document: frameDocument, fetchImpl } = {}) {
  if (!frameWindow || !frameDocument || typeof fetchImpl !== "function") throw new Error("GIS preview frame dependencies are missing");
  const params = new URLSearchParams(frameWindow.location.search);
  const sessionId = params.get("previewSession");
  if (params.get("clockPreview") !== "1" || !sessionId) throw new Error("GIS preview session is missing");
  const targetOrigin = frameWindow.location.origin;
  const parent = frameWindow.parent;
  const snapshot = await readStateSnapshot(fetchImpl);
  await layerRegistry.init();
  const registryGroups = clone(layerRegistry.getGroups());
  const map = createGISMap("map", {
    center: viewportCenter(snapshot.viewport),
    zoom: Number.isFinite(snapshot.viewport?.zoom) ? snapshot.viewport.zoom : 10,
    basemap: normalizeGisBasemap(snapshot.basemap || "osm"),
  });
  const mapContainer = frameDocument.getElementById("map");
  const { host: clockHost, captionEl } = ensureNliExplainerHost(mapContainer, { hostId: "nliGisClockHost" });
  applyNliExplainerLayout(clockHost, NLI_GIS_CLOCK_DEFAULT_LAYOUT);
  const escape = localEscapeContext();
  let currentScene = composeGisClockPreviewScene("home", registryGroups);
  let activeBasemap = normalizeGisBasemap(snapshot.basemap || "osm");
  let requestId = -1;
  let disposed = false;
  let styleRefresh = null;
  let narrativeController = null;
  let activeClockLayout = { ...NLI_GIS_CLOCK_DEFAULT_LAYOUT };
  let renderGeneration = 0;
  const pendingDrawWaits = new Set();
  const cancelDrawWaits = () => {
    for (const cancel of [...pendingDrawWaits]) cancel();
  };
  const isCurrent = (generation) => !disposed && generation === renderGeneration;
  const groupsForMap = () => filterGroupsForGisMap(currentScene.groups);
  const syncTimeline = async (generation = renderGeneration) => {
    const groups = groupsForMap();
    const focus = narrativeController?.getDefinition?.() || null;
    await syncInvestigationTimelineToMap(map, currentScene.clock, groups, {
      visibilityLayerGroups: currentScene.groups,
      displayProfile: "gis",
      nliCaptionMode: "clock-only",
      clockOnlyCaptionRelevantOverride: currentScene.sceneId === "home",
      motionMode: resolveMotionMode(),
      captionEl,
      allowMapCaption: false,
      now: () => currentScene.clock.serverNowMs ?? Date.now(),
      narrativeFocus: focus,
      getPersonSelection: () => null,
    });
    if (!isCurrent(generation)) return;
    applyNliExplainerLayout(clockHost, activeClockLayout);
  };
  const applyGroups = () => {
    applyLayerGroupsToMap(map, groupsForMap());
    applyNarrativePeopleFilter(map, currentScene.narrative?.id ?? null);
    applyNarrativeHouseOutlineFilter(map, currentScene.narrative?.id ?? null);
  };
  const localContext = {
    getEscapeOverlay: escape.get,
    getInvestigationClock: () => currentScene.clock,
    correctedNow: () => currentScene.clock.serverNowMs ?? Date.now(),
    getBounds: () => null,
    subscribe: (topic, callback) => topic === "escapeOverlay" ? escape.subscribe(callback) : () => {},
  };
  narrativeController = createGisNarrativeController({
    map,
    dataContext: localContext,
    storage: null,
    syncTimeline: () => { void syncTimeline(); },
    resolveExitCenter: () => viewportCenter(snapshot.viewport),
  });

  const refreshStyle = async () => {
    clearAllLayers(map);
    applyGroups();
    await syncTimeline();
  };
  const setBasemap = (nextBasemap) => {
    const normalized = normalizeGisBasemap(nextBasemap);
    if (normalized === activeBasemap) return;
    activeBasemap = normalized;
    styleRefresh?.();
    styleRefresh = installGisStyleReload({
      map,
      refreshLayers: refreshStyle,
      narrativeController,
      getLayerGroups: () => groupsForMap(),
    });
    setGISBasemap(map, normalized);
  };

  const renderState = async (state) => {
    cancelDrawWaits();
    const generation = ++renderGeneration;
    currentScene = composeGisClockPreviewScene(state.sceneId, registryGroups, Date.now());
    activeClockLayout = { ...state.clockLayout };
    applyNliExplainerLayout(clockHost, activeClockLayout);
    applyGroups();
    narrativeController?.apply({
      id: currentScene.narrative?.id ?? null,
      transition: currentScene.narrative ? "enter" : "exit",
      revision: state.requestId,
    });
    if (currentScene.narrative?.id) setBasemap(currentScene.basemap);
    else setBasemap(snapshot.basemap || "osm");
    await syncTimeline(generation);
    if (!isCurrent(generation)) return;
    const drew = await waitForIdle(map, () => isCurrent(generation), pendingDrawWaits);
    if (!drew || !isCurrent(generation)) return;
    postFrameMessage(parent, {
      type: "otef_clock_preview_rendered",
      sessionId,
      requestId: state.requestId,
      surface: "gis",
      sceneId: currentScene.sceneId,
      output: null,
      meshIdentity: null,
      mesh: null,
      pageIndex: 0,
      pageCount: 1,
    }, targetOrigin);
  };

  const onMessage = (event) => {
    let state;
    try {
      state = previewStateFromEvent(event, sessionId, requestId, targetOrigin);
    } catch (error) {
      if (event.origin === targetOrigin && event.source === parent && event.data?.sessionId === sessionId) {
        failRequest(parent, targetOrigin, sessionId, event.data.requestId, error);
      }
      return;
    }
    if (!state) return;
    requestId = state.requestId;
    void renderState(state).catch((error) => {
      if (!disposed && requestId === state.requestId) failRequest(parent, targetOrigin, sessionId, state.requestId, error);
    });
  };

  const onLoad = () => {
    if (disposed) return;
    applyGroups();
    styleRefresh = installGisStyleReload({
      map,
      refreshLayers: refreshStyle,
      narrativeController,
      getLayerGroups: () => groupsForMap(),
    });
    void syncTimeline().then(() => {
      if (disposed) return;
      postFrameMessage(parent, {
        type: "otef_clock_preview_ready",
        sessionId,
        surface: "gis",
        output: null,
      }, targetOrigin);
    }).catch((error) => failRequest(parent, targetOrigin, sessionId, null, error));
  };

  frameWindow.addEventListener("message", onMessage);
  map.on("load", onLoad);
  return async () => {
    if (disposed) return;
    disposed = true;
    renderGeneration += 1;
    cancelDrawWaits();
    frameWindow.removeEventListener("message", onMessage);
    map.off?.("load", onLoad);
    styleRefresh?.();
    narrativeController?.dispose?.();
    disposeInvestigationTimelineForMap(map);
    disposeLayerManagerForMap(map);
    map.remove?.();
  };
}
