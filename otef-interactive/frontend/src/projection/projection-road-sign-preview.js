import { APP_CONFIG } from "../config/app-config.js";
import layerRegistry from "../shared/layer-registry.js";
import MapProjectionConfig from "../shared/map-projection-config.js";
import { HOME_CUE } from "../remote/nli-staff-script.js";
import { idleNliClock } from "../shared/nli-investigation-clock.js";
import { resolveMotionMode } from "../shared/reduced-motion.js";
import { validateSettlementNameSettings } from "../shared/settlement-name-settings.js";
import { loadSettlementNameCatalog } from "../shared/settlement-name-catalog.js";
import { mountMapLegend } from "../map/map-legend.js";
import { createProjectionCaptionAdapter } from "./projection-caption-adapter.js";
import { createProjectionLegendAdapter } from "./projection-legend-adapter.js";
import { resolveLegendLayout } from "./legend-layout.js";
import { applyNliExplainerLayout, ensureNliExplainerHost, nliExplainerShouldPaintOnSpan } from "./nli-explainer-overlay.js";
import { syncInvestigationTimelineToMap, getInvestigationTimelineRenderSnapshot, disposeInvestigationTimelineForMap } from "../shared/maplibre-investigation-timeline.js";
import { createSettlementNameFraming } from "./settlement-name-framing.js";
import { OUTPUT_WIDTH, OUTPUT_HEIGHT } from "./projection-overlay-placement.js";
import { validateProjectionConfig } from "../shared/projection-config-schema.js";
import { createProjectionMap } from "./maplibre-projection.js";
import { syncProjectionLayers } from "./maplibre-projection-layers.js";
import { disposeLayerManagerForMap } from "../map/maplibre-layer-manager.js";
import { applyProjectionSpanView, createProjectionMapDescriptor } from "./projection-span-view.js";
import { createProjectionBrowserSurface } from "./projection-browser-route.js";
import { createProjectionRoadSignAdapter } from "./projection-road-sign-adapter.js";
import { installProjectionRoadSignPreviewBridge } from "./projection-preview-bridge.js";
import { visibleProjectionBrowserError } from "./projection-browser-error.js";
import { validateRoadSignSettings } from "../shared/road-sign-settings.js";

function abortError() { const error = new Error("Road 232 preview was disposed"); error.name = "AbortError"; return error; }

async function readJson(fetchImpl, url, signal) {
  const response = await fetchImpl(url, { signal });
  if (!response?.ok) throw new Error(`Road 232 preview could not read ${url}`);
  const value = await response.json();
  if (signal.aborted) throw abortError();
  return value;
}

function modelGeometry(raw, project) {
  const itm = Object.fromEntries(["west", "south", "east", "north"].map((key) => [key, raw?.[key] ?? raw?.bounds?.[key]]));
  if (!Object.values(itm).every(Number.isFinite) || typeof project !== "function") throw new Error("Road 232 preview map bounds are unavailable");
  const transform = (point) => project("EPSG:2039", "EPSG:4326", point);
  const sw = transform([itm.west, itm.south]), ne = transform([itm.east, itm.north]);
  const itmCorners = [[itm.west, itm.north], [itm.east, itm.north], [itm.east, itm.south], [itm.west, itm.south]];
  return { model: { bounds: [sw, ne], center: [(sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2], zoom: 12, bearing: raw.viewer_angle_deg || 0, itm },
    image: { bounds: [sw, ne], corners: itmCorners.map(transform), itmCorners, width: raw.image_width, height: raw.image_height } };
}

function road232PreviewGroups(input, gazaBorderVisible = false) {
  const enabledIds = new Set(HOME_CUE.layers.filter(id => id !== "gaza.gaza_border" || gazaBorderVisible === true));
  return structuredClone(input || []).map(group => {
    const layers = (group.layers || []).map(layer => {
      const ids = [layer.fullId, ...(Array.isArray(layer.fullLayerIds) ? layer.fullLayerIds : []), `${group.id}.${layer.id}`];
      return { ...layer, enabled: ids.some(id => enabledIds.has(id)) };
    });
    return { ...group, enabled: layers.some(layer => layer.enabled), layers };
  });
}

async function readOptionalHomeSnapshot(fetchImpl, signal) {
  try { return await readJson(fetchImpl, `${APP_CONFIG.api.viewportBase}/otef/`, signal); }
  catch (error) {
    if (error?.name === "AbortError") throw error;
    console.warn("[Road 232 preview] Saved Home context is unavailable:", error);
    return null;
  }
}

function waitForMap(map, type, signal) {
  if (signal.aborted) return Promise.reject(abortError());
  if (map.loaded?.() && (type === "load" || map.areTilesLoaded?.())) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => { map.off?.(type, done); signal.removeEventListener("abort", onAbort); clearTimeout(timer); };
    const done = () => { cleanup(); resolve(); };
    const onAbort = () => { cleanup(); reject(abortError()); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Road 232 preview map ${type} timed out`)); }, 30000);
    map.on(type, done); signal.addEventListener("abort", onAbort, { once: true });
    if (type === "idle") map.triggerRepaint?.();
  });
}

/** Boots a read-only Road 232 map and waits for the parent's acknowledged calibration before drawing. */
export async function bootProjectionRoadSignPreview({ window: win, document: doc, fetchImpl } = {}) {
  const params = new URLSearchParams(win?.location?.search || "");
  const sessionId = params.get("previewSession"), output = params.get("span");
  if (!doc || typeof fetchImpl !== "function" || params.get("roadSignsPreview") !== "1"
    || params.get("clockPreview") === "1" || params.get("settlementPreview") === "1" || params.get("preview") === "1"
    || !sessionId || !["left", "right"].includes(output) || params.get("outputMode") !== "browser" || win.parent === win) {
    throw new Error("Projection Road 232 preview session is missing or invalid");
  }
  const assets = new AbortController();
  let disposed = false, map, browserSurface, browserSceneState, roadSignAdapter, removeBridge, onMapRender;
  let legend, captionAdapter, legendAdapter, clockHost, homeLabel;
  let config = null, configRevision = null, configIdentity = null, settlementSceneAdapter = null;
  const host = doc.getElementById("displayContainer"), image = doc.getElementById("displayedImage");
  const fail = (error) => {
    if (error?.name === "AbortError") return;
    visibleProjectionBrowserError(host, error);
    win.parent?.postMessage?.({ type: "otef_road_sign_preview_error", sessionId, output, requestId: null, message: error?.message || "Road 232 preview failed" }, win.location.origin);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true; assets.abort(); removeBridge?.();
    if (onMapRender) map?.off?.("render", onMapRender);
    roadSignAdapter?.dispose(); legend?.dispose(); captionAdapter?.dispose(); legendAdapter?.dispose(); browserSurface?.dispose();
    if (map) { disposeInvestigationTimelineForMap(map); disposeLayerManagerForMap(map); map.remove?.(); }
    clockHost?.remove?.(); homeLabel?.remove?.();
  };
  try {
    if (!host || !image) throw new Error("Road 232 preview sources are missing");
    const snapshot = await readOptionalHomeSnapshot(fetchImpl, assets.signal);
    const bounds = await readJson(fetchImpl, "data/model-bounds.json", assets.signal);
    const geometry = modelGeometry(bounds, win.proj4);
    image.__otefProjectionImage = geometry.image; image.removeAttribute?.("src"); image.style.opacity = "0";
    await layerRegistry.init();
    const gazaBorderVisible = snapshot?.gazaBorderVisible ?? snapshot?.gaza_border_visible ?? false;
    const groups = road232PreviewGroups(layerRegistry.getGroups(), gazaBorderVisible);
    map = createProjectionMap("projectionMap", geometry.model, { pixelRatio: 1, canvasContextAttributes: { preserveDrawingBuffer: true } });
    await waitForMap(map, "load", assets.signal);
    syncProjectionLayers(map, groups, { suppressCanvasNameSymbols: false, suppressSettlementSymbols: true });

    const savedSettings = snapshot?.settlementNameSettings ?? snapshot?.settlement_name_settings;
    const checkedSettings = validateSettlementNameSettings(savedSettings);
    let catalog = null;
    if (checkedSettings.value && !checkedSettings.errors.length) {
      try { catalog = await loadSettlementNameCatalog({ registry: layerRegistry, fetchImpl, signal: assets.signal }); }
      catch (error) {
        if (error?.name === "AbortError") throw error;
        console.warn("[Road 232 preview] Saved settlement labels are unavailable:", error);
      }
    }
    const legendElement = doc.getElementById("mapLegend");
    const legendSettings = structuredClone(snapshot?.legend_settings ?? snapshot?.legendSettings ?? {});
    const legendLayout = resolveLegendLayout({ settings: legendSettings, span: output });
    const clockLayout = { ...MapProjectionConfig.NLI_EXPLAINER_LAYOUT[output], ...snapshot?.nli_clock_layout?.projection?.[output] };
    const paintClock = nliExplainerShouldPaintOnSpan(output);
    let legendSnapshot = null;
    if (legendElement) {
      Object.assign(legendElement.style, { width: `${OUTPUT_WIDTH * legendLayout.widthPct / 100}px`, height: `${OUTPUT_HEIGHT * legendLayout.heightPct / 100}px`,
        fontSize: `${legendLayout.fontPx}px`, visibility: "hidden" });
      const canvasFactory = () => doc.createElement("canvas");
      if (paintClock) captionAdapter = createProjectionCaptionAdapter({ canvasFactory });
      legendAdapter = createProjectionLegendAdapter({ canvasFactory });
      const localContext = { getLayerGroups: () => groups, getGazaBorderVisible: () => gazaBorderVisible,
        getLegendSettings: () => ({ ...legendSettings, projection: { ...legendSettings.projection, [output]: legendLayout } }) };
      legend = mountMapLegend({ element: legendElement, surface: "projection", projectionSpan: output, dataContext: localContext, registry: layerRegistry,
        onRenderSnapshot: next => { if (disposed) return; legendSnapshot = next; browserSurface?.requestDraw(); } });
      legend.setEditing(true);
      try { await legend.refresh(); }
      catch (error) { console.warn("[Road 232 preview] Home legend is unavailable:", error); legend.dispose(); legend = null; legendAdapter.dispose(); legendAdapter = null; }
    }
    if (typeof doc.createElement === "function" && typeof host.appendChild === "function") {
      ({ host: clockHost } = ensureNliExplainerHost(host));
      clockHost.style.visibility = "hidden";
      const captionEl = clockHost.querySelector(".nli-investigation-timeline-caption");
      if (nliExplainerShouldPaintOnSpan(output)) applyNliExplainerLayout(clockHost, clockLayout);
      const clock = idleNliClock({ serverNowMs: Date.now() });
      try {
        await syncInvestigationTimelineToMap(map, clock, groups, { visibilityLayerGroups: groups, displayProfile: "projection", nliCaptionMode: "clock-only",
          clockOnlyCaptionRelevantOverride: true, motionMode: resolveMotionMode(), captionEl, allowMapCaption: false, now: () => clock.serverNowMs, getPersonSelection: () => null });
      } catch (error) { if (error?.name === "AbortError") throw error; console.warn("[Road 232 preview] Idle Home overlays are unavailable:", error); }
      homeLabel = doc.createElement("div");
      homeLabel.textContent = "Home scene preview · Applied calibration";
      homeLabel.setAttribute?.("aria-label", homeLabel.textContent);
      Object.assign(homeLabel.style || {}, { position: "absolute", left: "8px", top: "8px", zIndex: "2001", pointerEvents: "none",
        padding: "4px 8px", color: "#fff", background: "rgba(0,0,0,.72)", font: "12px sans-serif" });
      host.appendChild(homeLabel);
    }
    roadSignAdapter = createProjectionRoadSignAdapter({ document: doc, output, onInvalidate: () => browserSurface?.requestDraw() });
    await roadSignAdapter.ready();
    const createSurface = async (initialConfig, context) => {
      const sceneState = { config: structuredClone(initialConfig) };
      const getScene = () => {
        if (captionAdapter) captionAdapter.sync({ snapshot: getInvestigationTimelineRenderSnapshot(map), layout: clockLayout });
        if (legendSnapshot && legendAdapter) legendAdapter.sync(legendSnapshot);
        return { image: null, map: createProjectionMapDescriptor({ map, config: sceneState.config, spanId: output }),
          settlements: settlementSceneAdapter?.descriptor() ?? null, names: null, roadSigns: roadSignAdapter.descriptor(), caption: paintClock ? captionAdapter?.draw() ?? null : null,
          pattern: null, legend: legendAdapter?.draw() ?? null };
      };
      const created = await createProjectionBrowserSurface({ host, spanId: output, image, mapCanvas: map.getCanvas?.(), getScene,
        hideTargets: [doc.getElementById("projectionImageClip"), doc.getElementById("projectionMap")], fetchImpl,
        signal: assets.signal, initialConfig: structuredClone(initialConfig), search: win.location.search });
      if (disposed || context.signal.aborted || !context.isCurrent()) { created?.dispose?.(); return null; }
      browserSurface = created; browserSceneState = sceneState;
      settlementSceneAdapter = created.getSettlementAdapter?.() || null;
      if (catalog && checkedSettings.value) {
        const settlementAdapter = settlementSceneAdapter;
        if (settlementAdapter) {
          try {
            settlementAdapter.setFramingProvider(createSettlementNameFraming({ map, output, getConfig: () => sceneState.config }));
            await settlementAdapter.prepare({ catalog, settings: checkedSettings.value, signal: context.signal, language: legendSettings.language || "he" });
            if (disposed || context.signal.aborted || !context.isCurrent()) { created.dispose?.(); return null; }
            settlementAdapter.commit(); settlementAdapter.setVisible(true);
          } catch (error) {
            if (error?.name === "AbortError") throw error;
            console.warn("[Road 232 preview] Saved settlement labels are unavailable:", error);
          }
        }
      }
      if (!onMapRender) {
        onMapRender = () => { if (!disposed) browserSurface?.requestDraw(); };
        map.on("render", onMapRender);
      }
      return created;
    };
    const paint = async (state, context) => {
      if (context.signal.aborted || disposed || !context.isCurrent()) return null;
      if (Object.keys(validateProjectionConfig(state.config)).length) throw new Error("Invalid acknowledged Road 232 calibration");
      const identity = JSON.stringify(state.config);
      const changed = identity !== configIdentity;
      if (changed) {
        if (!applyProjectionSpanView({ map, imageEl: image, containerEl: host, spanId: output, config: state.config, revision: state.calibrationRevision })) {
          throw new Error("Road 232 map rejected acknowledged calibration");
        }
        if (browserSurface) {
          const prior = browserSceneState.config;
          browserSceneState.config = structuredClone(state.config);
          if (browserSurface.applyConfig(state.config) === false) {
            browserSceneState.config = prior;
            throw new Error("Road 232 compositor rejected acknowledged calibration");
          }
        }
        config = structuredClone(state.config); configRevision = state.calibrationRevision; configIdentity = identity;
      } else {
        configRevision = state.calibrationRevision;
      }
      if (!browserSurface) {
        const created = await createSurface(config, context);
        if (!created || !context.isCurrent()) return null;
      }
      const checked = validateRoadSignSettings(state.settings);
      if (!checked.valid) throw new Error(checked.error || "Invalid Road 232 settings");
      roadSignAdapter.setState({ settings: checked.settings, eligible: true });
      if (context.signal.aborted || !context.isCurrent()) return null;
      await waitForMap(map, "idle", context.signal);
      if (!context.isCurrent()) return null;
      if (!browserSurface.draw()) throw new Error("Road 232 preview draw failed");
      const mesh = browserSurface.getMesh();
      if (!mesh) throw new Error("Road 232 preview mesh is unavailable");
      return { calibrationRevision: state.calibrationRevision, meshIdentity: `${sessionId}:${state.calibrationRevision}:${JSON.stringify(state.config)}`, mesh };
    };
    removeBridge = installProjectionRoadSignPreviewBridge({ win, sessionId, output, renderState: paint });
    return dispose;
  } catch (error) {
    dispose(); fail(error); return dispose;
  }
}
