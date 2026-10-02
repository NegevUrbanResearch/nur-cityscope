import { APP_CONFIG } from "../config/app-config.js";
import { createGisNarrativeController } from "./nli-narrative-controller.js";
import { createGISMap, setGISBasemap } from "./maplibre-map.js";
import { applyLayerGroupsToMap, clearAllLayers, disposeLayerManagerForMap } from "./maplibre-layer-manager.js";
import { applyNarrativeHouseOutlineFilter, applyNarrativePeopleFilter } from "./nli-people-marker-filter.js";
import { createGisBasemapStyleCoordinator, installGisStyleReload } from "../entries/map-main-style-lifecycle.js";
import { HOME_CUE, TIMELINE, NARRATIVES } from "../remote/nli-staff-script.js";
import { getNliNarrative } from "../shared/nli-narratives.js";
import { filterGroupsForGisMap } from "../shared/gis-layer-filter.js";
import { INVESTIGATION_POLYGONS_FULL_ID } from "../shared/nli-investigation-beats.js";
import { endNliClock, idleNliClock, normalizeNliClock, playNliClock } from "../shared/nli-investigation-clock.js";
import { NLI_NOVA_STORY } from "../shared/nli-nova-story.js";
import { NOVA_EXPLAINER_OBJECT_IDS, normalizeNovaExplainerMaps } from "../shared/nli-nova-explainer-layout.js";
import { normalizeGisBasemap } from "../shared/gis-basemap.js";
import layerRegistry from "../shared/layer-registry.js";
import { resolveMotionMode } from "../shared/reduced-motion.js";
import { attachSettlementOrientationRuntime } from "../shared/nli-settlement-orientation.js";
import { measureClockPreviewWarnings } from "../projection/clock-preview-warnings.js";
import { syncInvestigationTimelineToMap, disposeInvestigationTimelineForMap } from "../shared/maplibre-investigation-timeline.js";
import { createNovaExplainerOverlay } from "./nli-nova-explainer-overlay.js";
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
const NOVA_STORY_IDS = new Set(NOVA_EXPLAINER_OBJECT_IDS);

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
export function composeGisClockPreviewScene(sceneId, registryGroups, nowMs = Date.now(), options = {}) {
  if (!GIS_PREVIEW_SCENE_ID_SET.has(sceneId)) throw new Error("Unknown GIS preview scene");
  const rawCue = sceneCue(sceneId);
  if (!rawCue) throw new Error(`Missing cue for GIS preview scene: ${sceneId}`);
  const cue = cloneCue(rawCue);
  const narrative = getNliNarrative(sceneId === "home" || sceneId === "timeline" ? null : sceneId);
  const explainer = options?.novaExplainers === true && sceneId === "nova";
  const clock = explainer
    ? endNliClock(playNliClock(
      idleNliClock({ serverNowMs: nowMs }),
      [INVESTIGATION_POLYGONS_FULL_ID],
      NLI_NOVA_STORY.representativeMinutes,
      nowMs,
    ))
    : normalizeNliClock(idleNliClock({ serverNowMs: nowMs }));
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

function plainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

async function loadPreviewTypeface(fonts, spec, warning) {
  if (!fonts || typeof fonts.load !== "function") return;
  try {
    await fonts.load(spec);
  } catch (err) {
    console.warn(warning, err);
  }
}

async function loadPreviewTypefaceUnlessPresent(fonts, spec, warning) {
  if (typeof fonts?.check === "function") {
    try {
      if (fonts.check(spec)) return;
    } catch {
      // A failing check still falls through to the preload.
    }
  }
  await loadPreviewTypeface(fonts, spec, warning);
}

function storyObjectId(value) {
  const number = typeof value === "number"
    ? value
    : (typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? Number(value) : NaN);
  return Number.isInteger(number) && NOVA_STORY_IDS.has(number) ? number : null;
}

function featureName(feature) {
  const name = feature?.properties?.Name;
  return typeof name === "string" && name.trim() ? name : null;
}

function renderedExplainerCard(container, objectId) {
  const cards = container?.querySelectorAll?.(".nli-nova-explainer-card") || [];
  for (const card of cards) {
    if (card.dataset?.objectId === String(objectId)) return card;
  }
  return null;
}

function measuredExplainerBox(card, container) {
  const width = Number(container?.clientWidth);
  const height = Number(container?.clientHeight);
  if (!card || !(width > 0) || !(height > 0)) return null;
  const box = {
    leftPct: (card.offsetLeft / width) * 100,
    topPct: (card.offsetTop / height) * 100,
    widthPct: (card.offsetWidth / width) * 100,
    heightPct: (card.offsetHeight / height) * 100,
  };
  return Object.values(box).every(Number.isFinite) ? box : null;
}

function measuredNovaExplainerCards(frame, container) {
  const achieved = Array.isArray(frame?.achievedPolygonObjectIds) ? frame.achievedPolygonObjectIds : [];
  const features = Array.isArray(frame?.polygonFeatures) ? frame.polygonFeatures : [];
  const byId = new Map();
  for (const feature of features) {
    const id = storyObjectId(feature?.properties?.OBJECTID);
    if (id == null || byId.has(id)) continue;
    byId.set(id, feature);
  }
  const cards = [];
  const seen = new Set();
  for (const rawId of achieved) {
    const id = storyObjectId(rawId);
    if (id == null || seen.has(id)) continue;
    seen.add(id);
    const name = featureName(byId.get(id));
    if (!name) continue;
    cards.push({
      objectId: id,
      name,
      box: measuredExplainerBox(renderedExplainerCard(container, id), container),
    });
  }
  return cards;
}

function placeNovaExplainerCamera(map, camera) {
  const narrative = getNliNarrative("nova");
  if (!narrative) return;
  const placement = {
    center: narrative.center,
    zoom: camera === "wide" ? narrative.beat4Zoom : narrative.zoom,
    duration: 0,
  };
  if (typeof map?.jumpTo === "function") {
    map.jumpTo(placement);
    return;
  }
  map?.easeTo?.(placement);
}

async function settlePreviewFonts(frameDocument) {
  const ready = frameDocument?.fonts?.ready;
  if (ready && typeof ready.then === "function") {
    try {
      await ready;
    } catch {
      // Measurement still uses whichever faces loaded.
    }
  }
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
  if (state.element === "novaExplainers") {
    if (state.sceneId !== "nova"
      || (state.novaExplainerCamera !== "close" && state.novaExplainerCamera !== "wide")
      || !plainObject(state.novaExplainerLayout)) {
      throw new Error("Invalid GIS preview explainer request");
    }
    return {
      ...state,
      novaExplainerLayout: normalizeNovaExplainerMaps(state.novaExplainerLayout),
    };
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
  await Promise.all([
    loadPreviewTypeface(
      frameDocument.fonts,
      "14px 'Guttman Hatzvi'",
      "[clock-preview] Guttman Hatzvi font preload failed; people-name labels may flash",
    ),
    loadPreviewTypefaceUnlessPresent(
      frameDocument.fonts,
      "14px 'Hadassah Friedlaender'",
      "[clock-preview] Hadassah Friedlaender font preload failed; explainer cards may use a fallback face",
    ),
  ]);
  const map = createGISMap("map", {
    center: viewportCenter(snapshot.viewport),
    zoom: Number.isFinite(snapshot.viewport?.zoom) ? snapshot.viewport.zoom : 10,
    basemap: normalizeGisBasemap(snapshot.basemap || "osm"),
  });
  attachSettlementOrientationRuntime(map);
  const mapContainer = frameDocument.getElementById("map");
  const { host: clockHost, captionEl } = ensureNliExplainerHost(mapContainer, { hostId: "nliGisClockHost" });
  applyNliExplainerLayout(clockHost, NLI_GIS_CLOCK_DEFAULT_LAYOUT);
  const escape = localEscapeContext();
  let currentScene = composeGisClockPreviewScene("home", registryGroups);
  let currentExplainerLayout = null;
  let currentExplainerCamera = null;
  let lastExplainerFrame = null;
  const novaExplainerOverlay = createNovaExplainerOverlay({
    map,
    container: mapContainer,
    getLayout: () => currentExplainerLayout,
    getNarrativeId: () => currentScene.narrative?.id ?? null,
    getEscapeMor: () => escape.get()?.mor === true,
    motionMode: resolveMotionMode(),
    cameraOverride: () => currentExplainerCamera,
  });
  const basemapCoordinator = createGisBasemapStyleCoordinator({
    map,
    initialBasemap: normalizeGisBasemap(snapshot.basemap || "osm"),
    setBasemap: setGISBasemap,
  });
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
      onVisualFrame: (frame) => {
        if (generation === renderGeneration) lastExplainerFrame = frame;
        novaExplainerOverlay.sync(frame);
      },
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
    basemapCoordinator.request(normalizeGisBasemap(nextBasemap));
  };

  const renderState = async (state) => {
    cancelDrawWaits();
    const generation = ++renderGeneration;
    const explainer = state.element === "novaExplainers";
    currentExplainerCamera = explainer ? state.novaExplainerCamera : null;
    currentExplainerLayout = explainer ? state.novaExplainerLayout : null;
    lastExplainerFrame = null;
    currentScene = composeGisClockPreviewScene(state.sceneId, registryGroups, Date.now(), {
      novaExplainers: explainer,
    });
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
    // jumpTo stops the narrative fly so an ended clock cannot leave Close on the wide zoom.
    if (explainer) placeNovaExplainerCamera(map, currentExplainerCamera);
    await syncTimeline(generation);
    if (!isCurrent(generation)) return;
    const drew = await waitForIdle(map, () => isCurrent(generation), pendingDrawWaits);
    if (!drew || !isCurrent(generation)) return;
    await settlePreviewFonts(frameDocument);
    if (!isCurrent(generation)) return;
    if (explainer) novaExplainerOverlay.refresh();
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
      warnings: measureClockPreviewWarnings({ layout: activeClockLayout, surface: "gis", element: clockHost, content: captionEl, clock: true }),
      ...(explainer ? {
        novaExplainerCamera: state.novaExplainerCamera,
        novaExplainerCards: measuredNovaExplainerCards(lastExplainerFrame, mapContainer),
      } : {}),
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
    basemapCoordinator.dispose();
    cancelDrawWaits();
    frameWindow.removeEventListener("message", onMessage);
    map.off?.("load", onLoad);
    styleRefresh?.();
    narrativeController?.dispose?.();
    disposeInvestigationTimelineForMap(map);
    novaExplainerOverlay.dispose();
    disposeLayerManagerForMap(map);
    map.remove?.();
  };
}
