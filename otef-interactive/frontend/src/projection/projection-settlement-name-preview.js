import { APP_CONFIG } from "../config/app-config.js";
import layerRegistry from "../shared/layer-registry.js";
import MapProjectionConfig from "../shared/map-projection-config.js";
import { HOME_CUE } from "../remote/nli-staff-script.js";
import { idleNliClock } from "../shared/nli-investigation-clock.js";
import { resolveMotionMode } from "../shared/reduced-motion.js";
import { validateProjectionConfig } from "../shared/projection-config-schema.js";
import { SETTLEMENT_FONT_STACK, validateSettlementNameSettings } from "../shared/settlement-name-settings.js";
import { loadSettlementNameCatalog } from "../shared/settlement-name-catalog.js";
import { createProjectionMap } from "./maplibre-projection.js";
import { syncProjectionLayers } from "./maplibre-projection-layers.js";
import { disposeLayerManagerForMap } from "../map/maplibre-layer-manager.js";
import { mountMapLegend } from "../map/map-legend.js";
import { createProjectionBrowserSurface } from "./projection-browser-route.js";
import { createProjectionCaptionAdapter } from "./projection-caption-adapter.js";
import { createProjectionLegendAdapter } from "./projection-legend-adapter.js";
import { resolveLegendLayout } from "./legend-layout.js";
import { applyNliExplainerLayout, ensureNliExplainerHost, nliExplainerShouldPaintOnSpan } from "./nli-explainer-overlay.js";
import { applyProjectionSpanView, createProjectionMapDescriptor } from "./projection-span-view.js";
import { syncInvestigationTimelineToMap, getInvestigationTimelineRenderSnapshot, disposeInvestigationTimelineForMap } from "../shared/maplibre-investigation-timeline.js";
import { installProjectionSettlementPreviewBridge } from "./projection-preview-bridge.js";
import { copyProjectionMesh } from "../projection-config/clock-layout-geometry.js";
import { OUTPUT_WIDTH, OUTPUT_HEIGHT } from "./projection-overlay-placement.js";
import { createSettlementNameFraming } from './settlement-name-framing.js';
import { nearestSettlementBoundaryPoint } from './settlement-name-connectors.js';
import { visibleProjectionBrowserError } from "./projection-browser-error.js";

function abortError() {
  const error = new Error("Settlement preview was disposed");
  error.name = "AbortError";
  return error;
}

async function readSnapshot(fetchImpl, url, signal) {
  const response = await fetchImpl(url, { signal });
  if (!response?.ok) throw new Error(`Settlement preview could not read ${url}`);
  const result = await response.json();
  if (signal.aborted) throw abortError();
  return result;
}

function settlementDocument(snapshot) {
  const settings = snapshot?.settlementNameSettings ?? snapshot?.settlement_name_settings;
  const revision = snapshot?.settlementNameRevision ?? snapshot?.settlement_name_revision;
  return { settings, revision };
}

function acknowledgedCalibration(raw) {
  const wrapped = raw?.config && typeof raw.config === "object" ? raw.config : null;
  const config = wrapped?.schemaVersion != null ? wrapped : (raw?.schemaVersion != null ? raw : wrapped);
  return { config, revision: Number.isInteger(raw?.revision) ? raw.revision : 0 };
}

function waitForMap(map, type, signal) {
  if (signal.aborted) return Promise.reject(abortError());
  if (map.loaded?.() && (type === "load" || map.areTilesLoaded?.())) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => { map.off?.(type, finish); signal.removeEventListener("abort", onAbort); clearTimeout(timer); };
    const finish = () => { cleanup(); resolve(); };
    const onAbort = () => { cleanup(); reject(abortError()); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Settlement preview map ${type} timed out`)); }, 30000);
    map.on(type, finish);
    signal.addEventListener("abort", onAbort, { once: true });
    if (type === "idle") map.triggerRepaint?.();
  });
}

function modelGeometry(raw, project) {
  const itm = Object.fromEntries(["west", "south", "east", "north"].map((key) => [key, raw[key] ?? raw.bounds?.[key]]));
  if (!Object.values(itm).every(Number.isFinite) || typeof project !== "function") throw new Error("Settlement preview model bounds are unavailable");
  const transform = (point) => project("EPSG:2039", "EPSG:4326", point);
  const sw = transform([itm.west, itm.south]);
  const ne = transform([itm.east, itm.north]);
  const itmCorners = [[itm.west, itm.north], [itm.east, itm.north], [itm.east, itm.south], [itm.west, itm.south]];
  return {
    model: { bounds: [sw, ne], center: [(sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2], zoom: 12, bearing: raw.viewer_angle_deg || 0, itm },
    image: { bounds: [sw, ne], corners: itmCorners.map(transform), itmCorners, width: raw.image_width, height: raw.image_height },
  };
}

function rotatedInkCorners(label) {
  const box = label.inkBox;
  const radians = (Number(label.rotateDeg) || 0) * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [[box.left, box.top], [box.right, box.top], [box.right, box.bottom], [box.left, box.bottom]].map(([px, py]) => {
    const dx = px - label.x;
    const dy = py - label.y;
    return { x: label.x + dx * cos - dy * sin, y: label.y + dx * sin + dy * cos };
  });
}

function projectionSeparated(first, second) {
  const axes = [];
  for (const corners of [first, second]) {
    for (let index = 0; index < corners.length; index += 1) {
      const start = corners[index];
      const end = corners[(index + 1) % corners.length];
      axes.push({ x: -(end.y - start.y), y: end.x - start.x });
    }
  }
  return axes.some((axis) => {
    const project = (corners) => corners.reduce((range, point) => {
      const value = point.x * axis.x + point.y * axis.y;
      return { min: Math.min(range.min, value), max: Math.max(range.max, value) };
    }, { min: Infinity, max: -Infinity });
    const left = project(first);
    const right = project(second);
    return left.max <= right.min || right.max <= left.min;
  });
}

function homeGroups(groups) {
  const enabled = new Set(HOME_CUE.layers);
  return structuredClone(groups || []).map((group) => {
    const layers = (group.layers || []).map((layer) => ({ ...layer, enabled: enabled.has(`${group.id}.${layer.id}`) }));
    return { ...group, enabled: layers.some((layer) => layer.enabled), layers };
  });
}

export function measureSettlementPreviewWarnings(labels = [], selectedCitycode = null) {
  const selected = selectedCitycode
    ? labels.filter((label) => label.citycode === selectedCitycode)
    : labels;
  const selectedBoxes = selected.filter((label) => label.inkBox);
  const selectedCorners = selectedBoxes.map((label) => rotatedInkCorners(label));
  const otherCorners = selectedCitycode
    ? labels.filter((label) => label.citycode !== selectedCitycode && label.inkBox).map((label) => rotatedInkCorners(label))
    : selectedCorners;
  const overlap = selectedCitycode
    ? selectedCorners.some((label) => otherCorners.some((other) => !projectionSeparated(label, other)))
    : selectedCorners.some((label, index) => selectedCorners.slice(index + 1).some((other) => !projectionSeparated(label, other)));
  const clipped = selected.some(label => label.cropped === true) || selectedCorners.some((points) => points.some((point) => point.x < 0 || point.y < 0 || point.x > 1920 || point.y > 1080));
  return {
    clipped,
    overlap,
    outOfView: selected.some((label) => label.x < 0 || label.y < 0 || label.x > 1920 || label.y > 1080),
    mapping: "complete",
  };
}

/** Read-only Home frame for the settlement editor. No exhibit socket, scene command, or settings write. */
export async function bootProjectionSettlementNamePreview({ window: win, document: doc, fetchImpl } = {}) {
  const params = new URLSearchParams(win?.location?.search || "");
  const sessionId = params.get("previewSession");
  const output = params.get("span");
  if (!doc || typeof fetchImpl !== "function" || params.get("settlementPreview") !== "1" || params.get("clockPreview") === "1"
    || !sessionId || !["left", "right"].includes(output) || params.get("outputMode") !== "browser" || win.parent === win) {
    throw new Error("Projection settlement preview session is missing or invalid");
  }
  const assets = new AbortController();
  let disposed = false;
  let map;
  let browserSurface;
  let legend;
  let captionAdapter;
  let legendAdapter;
  let clockHost;
  let removeBridge;
  let onMapRender;
  const host = doc.getElementById("displayContainer");
  const fail = async (error) => {
    if (error?.name === "AbortError") return;
    visibleProjectionBrowserError(host, error);
    win.parent?.postMessage?.({ type: "otef_settlement_preview_error", sessionId, output, requestId: null, message: error?.message || "Settlement preview failed" }, win.location.origin);
  };
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    assets.abort();
    removeBridge?.();
    if (onMapRender) map?.off?.("render", onMapRender);
    legend?.dispose();
    captionAdapter?.dispose();
    legendAdapter?.dispose();
    browserSurface?.dispose();
    if (map) { disposeInvestigationTimelineForMap(map); disposeLayerManagerForMap(map); map.remove?.(); }
    clockHost?.remove?.();
  };
  try {
    const snapshot = await readSnapshot(fetchImpl, `${APP_CONFIG.api.viewportBase}/otef/`, assets.signal);
    const calibration = acknowledgedCalibration(await readSnapshot(fetchImpl, "/api/otef/projection-config/?table=otef", assets.signal));
    const settlement = settlementDocument(snapshot);
    const checked = validateSettlementNameSettings(settlement.settings);
    if (![6, 7].includes(calibration.config?.schemaVersion) || !Number.isSafeInteger(settlement.revision) || settlement.revision < 1 || checked.errors.length) {
      throw new Error("Initialization required");
    }
    const config = structuredClone(calibration.config);
    if (Object.keys(validateProjectionConfig(config)).length) throw new Error("Invalid acknowledged projection calibration");
    await layerRegistry.init();
    const catalog = await loadSettlementNameCatalog({ registry: layerRegistry, fetchImpl, signal: assets.signal });
    const font = `${checked.value.style.fontPx}px ${SETTLEMENT_FONT_STACK[checked.value.style.fontFamily]}`;
    if (doc.fonts?.load) await doc.fonts.load(font);
    const groups = homeGroups(layerRegistry.getGroups());
    const bounds = await readSnapshot(fetchImpl, "data/model-bounds.json", assets.signal);
    const geometry = modelGeometry(bounds, win.proj4);
    const image = doc.getElementById("displayedImage");
    const legendElement = doc.getElementById("mapLegend");
    if (!host || !image || !legendElement) throw new Error("Settlement preview sources are missing");
    image.__otefProjectionImage = geometry.image;
    image.removeAttribute?.("src");
    image.style.opacity = "0";
    map = createProjectionMap("projectionMap", geometry.model, { pixelRatio: 1, canvasContextAttributes: { preserveDrawingBuffer: true } });
    await waitForMap(map, "load", assets.signal);
    applyProjectionSpanView({ map, imageEl: image, containerEl: host, spanId: output, config });
    syncProjectionLayers(map, groups, { suppressCanvasNameSymbols: false, suppressSettlementSymbols: true });
    ({ host: clockHost } = ensureNliExplainerHost(host));
    clockHost.style.visibility = "hidden";
    const captionEl = clockHost.querySelector(".nli-investigation-timeline-caption");
    const clockLayout = { ...MapProjectionConfig.NLI_EXPLAINER_LAYOUT[output], ...snapshot.nli_clock_layout?.projection?.[output] };
    const legendSettings = structuredClone(snapshot.legend_settings || {});
    const legendLayout = resolveLegendLayout({ settings: legendSettings, span: output });
    if (nliExplainerShouldPaintOnSpan(output)) applyNliExplainerLayout(clockHost, clockLayout);
    Object.assign(legendElement.style, {
      width: `${OUTPUT_WIDTH * legendLayout.widthPct / 100}px`,
      height: `${OUTPUT_HEIGHT * legendLayout.heightPct / 100}px`,
      fontSize: `${legendLayout.fontPx}px`,
      visibility: "hidden",
    });
    const canvasFactory = () => doc.createElement("canvas");
    captionAdapter = createProjectionCaptionAdapter({ canvasFactory });
    legendAdapter = createProjectionLegendAdapter({ canvasFactory });
    let legendSnapshot = null;
    const localContext = { getLayerGroups: () => groups, getLegendSettings: () => ({ ...legendSettings, projection: { ...legendSettings.projection, [output]: legendLayout } }) };
    legend = mountMapLegend({
      element: legendElement, surface: "projection", projectionSpan: output, dataContext: localContext, registry: layerRegistry,
      onRenderSnapshot: (next) => { if (disposed) return; legendSnapshot = next; browserSurface?.requestDraw(); },
    });
    legend.setEditing(true);
    await legend.refresh();
    const clock = idleNliClock({ serverNowMs: Date.now() });
    await syncInvestigationTimelineToMap(map, clock, groups, {
      visibilityLayerGroups: groups, displayProfile: "projection", nliCaptionMode: "clock-only",
      clockOnlyCaptionRelevantOverride: true, motionMode: resolveMotionMode(), captionEl, allowMapCaption: false,
      now: () => clock.serverNowMs, getPersonSelection: () => null,
    });
    await waitForMap(map, "idle", assets.signal);
    const paintClock = nliExplainerShouldPaintOnSpan(output);
    const getScene = () => {
      if (paintClock) captionAdapter.sync({ snapshot: getInvestigationTimelineRenderSnapshot(map), layout: clockLayout });
      if (legendSnapshot) legendAdapter.sync(legendSnapshot);
      return {
        image: null,
        map: createProjectionMapDescriptor({ map, config, spanId: output }),
        caption: paintClock ? captionAdapter.draw() : null,
        legend: legendAdapter.draw(),
      };
    };
    browserSurface = await createProjectionBrowserSurface({
      host, spanId: output, image, mapCanvas: map.getCanvas?.(), getScene,
      hideTargets: [doc.getElementById("projectionImageClip"), doc.getElementById("projectionMap"), clockHost, legendElement],
      fetchImpl, signal: assets.signal, initialConfig: config, search: win.location.search,
    });
    onMapRender = () => { if (!disposed) browserSurface.requestDraw(); };
    map.on("render", onMapRender);
    const adapter = browserSurface.getSettlementAdapter();
    adapter.setFramingProvider(createSettlementNameFraming({map,output,getConfig:()=>config}));
    const paint = async (settings, signal, selectedCitycode = null) => {
      const prepared = await adapter.prepare({ catalog, settings, signal });
      if (signal?.aborted || prepared?.stale) return null;
      adapter.commit();
      adapter.setVisible(true);
      if (!browserSurface.draw()) throw new Error("Settlement preview draw failed");
      const mesh = copyProjectionMesh(browserSurface.getMesh());
      if (!mesh) throw new Error("Settlement preview mesh is unavailable");
      const labels = adapter.getLabels(), framing = adapter.getFraming();
      const selected = labels.find(label => label.citycode === selectedCitycode);
      const projectedRings = framing?.outlines?.[selectedCitycode] || [];
      const worldRings = catalog.outlines?.get(selectedCitycode) || [];
      const originGeometry = selected && worldRings.length ? { citycode: selectedCitycode, worldRings, projectedRings,
        point: selected.connector?.start || nearestSettlementBoundaryPoint(projectedRings, framing?.origins?.[selectedCitycode] || selected) } : null;
      return { calibrationRevision: calibration.revision, meshIdentity: `${sessionId}:${calibration.revision}`, mesh, labels,
        positionMatrix: framing?.matrix || null, originGeometry, warnings: measureSettlementPreviewWarnings(labels, selectedCitycode) };
    };
    await paint(checked.value, assets.signal);
    removeBridge = installProjectionSettlementPreviewBridge({ win, sessionId, output, renderState: (state, context) => paint(state.settings, context.signal, state.selectedCitycode) });
    return dispose;
  } catch (error) {
    await dispose();
    await fail(error);
    return dispose;
  }
}
