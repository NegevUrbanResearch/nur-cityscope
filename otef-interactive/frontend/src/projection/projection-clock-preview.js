import { APP_CONFIG } from "../config/app-config.js";
import layerRegistry from "../shared/layer-registry.js";
import MapProjectionConfig from "../shared/map-projection-config.js";
import { HOME_CUE } from "../remote/nli-staff-script.js";
import { idleNliClock } from "../shared/nli-investigation-clock.js";
import { resolveMotionMode } from "../shared/reduced-motion.js";
import { getLayerLifecycleRuntime, resolveLayerFadeMs } from "../shared/layer-lifecycle-fade.js";
import { releaseProjectionModelImage, syncProjectionModelImage } from "./projection-model-image.js";
import { validateProjectionConfig } from "../shared/projection-config-schema.js";
import { createProjectionMap } from "./maplibre-projection.js";
import { attachSettlementOrientationRuntime } from "../shared/nli-settlement-orientation.js";
import { syncProjectionLayers } from "./maplibre-projection-layers.js";
import { disposeLayerManagerForMap } from "../map/maplibre-layer-manager.js";
import { mountMapLegend } from "../map/map-legend.js";
import { createProjectionBrowserSurface } from "./projection-browser-route.js";
import { createProjectionCaptionAdapter } from "./projection-caption-adapter.js";
import { createProjectionLegendAdapter } from "./projection-legend-adapter.js";
import { resolveLegendLayout } from "./legend-layout.js";
import { resolveLegendRasterSize } from "./legend-content-layout.js";
import { applyNliExplainerLayout, ensureNliExplainerHost } from "./nli-explainer-overlay.js";
import { applyProjectionSpanView, createProjectionMapDescriptor } from "./projection-span-view.js";
import { syncInvestigationTimelineToMap, getInvestigationTimelineRenderSnapshot, disposeInvestigationTimelineForMap } from "../shared/maplibre-investigation-timeline.js";
import { installProjectionClockPreviewBridge } from "./projection-preview-bridge.js";
import { copyProjectionMesh } from "../projection-config/clock-layout-geometry.js";
import { OUTPUT_WIDTH, OUTPUT_HEIGHT } from "./projection-overlay-placement.js";
import { measureClockPreviewWarnings } from "./clock-preview-warnings.js";

function abortError() {
  const error = new Error("Projection clock preview was disposed");
  error.name = "AbortError";
  return error;
}

async function readSnapshot(fetchImpl, url, signal) {
  const response = await fetchImpl(url, { signal });
  if (!response?.ok) throw new Error(`Projection preview could not read ${url} (${response?.status ?? "network error"})`);
  const result = await response.json();
  if (signal.aborted) throw abortError();
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error(`Invalid projection preview snapshot: ${url}`);
  return result;
}

function waitForMap(map, type, signal) {
  if (signal.aborted) return Promise.reject(abortError());
  if (map.loaded?.() && (type === "load" || map.areTilesLoaded?.())) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => { map.off?.(type, finish); signal.removeEventListener("abort", onAbort); clearTimeout(timer); };
    const finish = () => { cleanup(); resolve(); };
    const onAbort = () => { cleanup(); reject(abortError()); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Projection preview map ${type} timed out`)); }, 30000);
    map.on(type, finish);
    signal.addEventListener("abort", onAbort, { once: true });
    if (type === "idle") map.triggerRepaint?.();
  });
}

function modelGeometry(raw, project) {
  const itm = Object.fromEntries(["west", "south", "east", "north"].map((key) => [key, raw[key] ?? raw.bounds?.[key]]));
  if (!Object.values(itm).every(Number.isFinite) || typeof project !== "function") throw new Error("Projection preview model bounds are unavailable");
  const transform = (point) => project("EPSG:2039", "EPSG:4326", point);
  const sw = transform([itm.west, itm.south]);
  const ne = transform([itm.east, itm.north]);
  const itmCorners = [[itm.west, itm.north], [itm.east, itm.north], [itm.east, itm.south], [itm.west, itm.south]];
  return { model: { bounds: [sw, ne], center: [(sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2], zoom: 12, bearing: raw.viewer_angle_deg || 0, itm },
    image: { bounds: [sw, ne], corners: itmCorners.map(transform), itmCorners, width: raw.image_width, height: raw.image_height } };
}

function homeGroups(groups) {
  const enabled = new Set(HOME_CUE.layers);
  return structuredClone(groups).map((group) => {
    const layers = (group.layers || []).map((layer) => ({ ...layer, enabled: enabled.has(`${group.id}.${layer.id}`) }));
    return { ...group, enabled: layers.some((layer) => layer.enabled), layers };
  });
}

/** Boot a read-only Home projection through the same Browser compositor as the exhibit. */
export async function bootProjectionClockPreview({ window: win, document: doc, fetchImpl } = {}) {
  const params = new URLSearchParams(win?.location?.search || "");
  const sessionId = params.get("previewSession");
  if (!doc || typeof fetchImpl !== "function" || params.get("clockPreview") !== "1" || !sessionId ||
    params.get("span") !== "left" || params.get("outputMode") !== "browser" || win.parent === win) {
    throw new Error("Projection clock preview session is missing or invalid");
  }
  const assets = new AbortController();
  let disposed = false;
  let map, browserSurface, legend, captionAdapter, legendAdapter, clockHost, removeBridge;
  let legendSnapshot = null;
  let activeClockLayout;
  let activeLegendLayout;
  let legendSettings;
  let onMapRender;
  let meshIdentity = null;
  let meshSignature = null;
  let meshGeneration = 0;
  const alive = () => { if (disposed || assets.signal.aborted) throw abortError(); };
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    assets.abort();
    removeBridge?.();
    win.removeEventListener("pagehide", dispose);
    win.removeEventListener("beforeunload", dispose);
    if (onMapRender) map?.off?.("render", onMapRender);
    if (map) {
      releaseProjectionModelImage(map);
      getLayerLifecycleRuntime(map)?.dispose();
    }
    legend?.dispose();
    captionAdapter?.dispose();
    legendAdapter?.dispose();
    browserSurface?.dispose();
    if (map) { disposeInvestigationTimelineForMap(map); disposeLayerManagerForMap(map); map.remove?.(); }
    clockHost?.remove?.();
  };
  win.addEventListener("pagehide", dispose);
  win.addEventListener("beforeunload", dispose);
  try {
    const snapshot = await readSnapshot(fetchImpl, `${APP_CONFIG.api.viewportBase}/otef/`, assets.signal);
    const calibration = await readSnapshot(fetchImpl, "/api/otef/projection-config/?table=otef", assets.signal);
    if (!calibration.config || Object.keys(validateProjectionConfig(calibration.config)).length) throw new Error("Invalid acknowledged projection calibration");
    const config = structuredClone(calibration.config);
    const bounds = await readSnapshot(fetchImpl, "data/model-bounds.json", assets.signal);
    await layerRegistry.init(); alive();
    const groups = homeGroups(layerRegistry.getGroups());
    const geometry = modelGeometry(bounds, win.proj4);
    const host = doc.getElementById("displayContainer");
    const image = doc.getElementById("displayedImage");
    const legendElement = doc.getElementById("mapLegend");
    if (!host || !image || !legendElement) throw new Error("Projection preview sources are missing");
    // Keep the measurable legend host out of view without display:none.
    for (const id of ["instructions", "boundsEditorOverlay", "boundsToolbar", "rotationToolbar", "rotationCursorPopup"]) {
      const element = doc.getElementById(id); if (element) element.style.display = "none";
    }
    legendElement.style.visibility = "hidden";
    image.__otefProjectionImage = geometry.image;
    image.removeAttribute?.("src");
    image.style.transition = "none";
    image.style.opacity = "0";
    if (doc.fonts?.load) { await doc.fonts.load("11px 'Guttman Hatzvi'"); alive(); }
    map = createProjectionMap("projectionMap", geometry.model, { pixelRatio: 1, canvasContextAttributes: { preserveDrawingBuffer: true } });
    attachSettlementOrientationRuntime(map);
    await waitForMap(map, "load", assets.signal); alive();
    applyProjectionSpanView({ map, imageEl: image, containerEl: host, spanId: "left", config });
    syncProjectionLayers(map, groups, { suppressCanvasNameSymbols: false });
    ({ host: clockHost } = ensureNliExplainerHost(host));
    clockHost.style.visibility = "hidden";
    const captionEl = clockHost.querySelector(".nli-investigation-timeline-caption");
    activeClockLayout = { ...MapProjectionConfig.NLI_EXPLAINER_LAYOUT.left, ...snapshot.nli_clock_layout?.projection?.left };
    legendSettings = structuredClone(snapshot.legend_settings || {});
    activeLegendLayout = resolveLegendLayout({ settings: legendSettings, span: "left" });
    applyNliExplainerLayout(clockHost, activeClockLayout);
    const applyLegendMeasurement = () => {
      Object.assign(legendElement.style, { width: `${OUTPUT_WIDTH * activeLegendLayout.widthPct / 100}px`, height: `${OUTPUT_HEIGHT * activeLegendLayout.heightPct / 100}px`,
        fontSize: `${activeLegendLayout.fontPx}px` });
    };
    applyLegendMeasurement();
    const canvasFactory = () => doc.createElement("canvas");
    captionAdapter = createProjectionCaptionAdapter({ canvasFactory });
    legendAdapter = createProjectionLegendAdapter({ canvasFactory });
    const localContext = { getLayerGroups: () => groups, getLegendSettings: () => ({ ...legendSettings,
      projection: { ...legendSettings.projection, left: activeLegendLayout } }) };
    legend = mountMapLegend({ element: legendElement, surface: "projection", projectionSpan: "left", dataContext: localContext, registry: layerRegistry,
      onRenderSnapshot: (next) => { if (disposed) return; legendSnapshot = next; browserSurface?.requestDraw(); } });
    legend.setEditing(true);
    await legend.refresh(); alive();
    const clock = idleNliClock({ serverNowMs: Date.now() });
    await syncInvestigationTimelineToMap(map, clock, groups, { visibilityLayerGroups: groups, displayProfile: "projection", nliCaptionMode: "clock-only",
      clockOnlyCaptionRelevantOverride: true, motionMode: resolveMotionMode(), captionEl, allowMapCaption: false, now: () => clock.serverNowMs, getPersonSelection: () => null });
    alive(); await waitForMap(map, "idle", assets.signal); alive();
    const getScene = () => {
      captionAdapter.sync({ snapshot: getInvestigationTimelineRenderSnapshot(map), layout: activeClockLayout });
      if (legendSnapshot) legendAdapter.sync(legendSnapshot);
      return { image: null,
        map: createProjectionMapDescriptor({ map, config, spanId: "left" }), caption: captionAdapter.draw(), legend: legendAdapter.draw() };
    };
    const surface = await createProjectionBrowserSurface({ host, spanId: "left", image, mapCanvas: map.getCanvas?.(), getScene,
      hideTargets: [doc.getElementById("projectionImageClip"), doc.getElementById("projectionMap"), clockHost, legendElement],
      fetchImpl, signal: assets.signal, initialConfig: config, search: win.location.search });
    if (disposed) { surface.dispose(); return dispose; }
    browserSurface = surface;
    syncProjectionModelImage({
      map,
      imageEl: image,
      layerGroups: groups,
      modelInfo: { durationMs: resolveLayerFadeMs(), fromSlideshowTick: false },
      requestDraw: () => { if (!disposed) browserSurface?.requestDraw(); },
    });
    if (browserSurface.applyConfig(config) === false) throw new Error("Projection preview rejected acknowledged calibration");
    if (!browserSurface.draw()) throw new Error("Projection preview draw failed");
    onMapRender = () => { if (!disposed) browserSurface.requestDraw(); };
    map.on("render", onMapRender);
    removeBridge = installProjectionClockPreviewBridge({ win, sessionId, renderState: async (state, context) => {
      activeLegendLayout = { ...activeLegendLayout, ...state.legendLayout };
      applyLegendMeasurement();
      await legend.refresh();
      if (!context.isCurrent()) return null;
      activeClockLayout = { ...state.clockLayout };
      applyNliExplainerLayout(clockHost, activeClockLayout);
      legend.setPage(state.pageIndex);
      legendSnapshot = legend.getRenderSnapshot();
      if (!browserSurface.draw()) throw new Error("Projection preview draw failed");
      const mesh = copyProjectionMesh(browserSurface.getMesh());
      if (!mesh) throw new Error("Projection preview mesh is unavailable");
      const signature = JSON.stringify(mesh);
      if (signature !== meshSignature) { meshSignature = signature; meshIdentity = `${sessionId}:${calibration.revision}:${++meshGeneration}`; }
      const editingClock = state.element === "clock";
      const warnings = measureClockPreviewWarnings({ layout: editingClock ? activeClockLayout : activeLegendLayout, mesh, surface: "projection",
        element: editingClock ? clockHost : legendElement, content: editingClock ? captionEl : legendElement, clock: editingClock });
      if (!editingClock && legendSnapshot.contentLayout) {
        const { width, height } = resolveLegendRasterSize(legendSnapshot.layout);
        const bounds = legendSnapshot.contentLayout.paintBounds;
        warnings.clipped = !!bounds && (bounds.x < -1e-7 || bounds.y < -1e-7
          || bounds.x + bounds.width > width + 1e-7 || bounds.y + bounds.height > height + 1e-7);
      }
      return { meshIdentity, mesh, pageIndex: legendSnapshot.pageIndex, pageCount: Math.max(1, legendSnapshot.pages.length), warnings };
    } });
    return dispose;
  } catch (error) {
    await dispose();
    if (error?.name === "AbortError") return dispose;
    win.parent.postMessage({ type: "otef_clock_preview_error", sessionId, requestId: null, message: error?.message || "Projection preview bootstrap failed" }, win.location.origin);
    throw error;
  }
}
