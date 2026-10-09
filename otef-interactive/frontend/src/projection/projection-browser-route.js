import { createProjectionSurfaceCompositor } from "./projection-surface-compositor.js";
import { createProjectionWarpRenderer } from "./projection-warp-renderer.js";
import { evaluateWarpMesh } from "../shared/projection-warp-geometry.js";
import { createProjectionNameCanvasAdapter } from "./projection-name-canvas-adapter.js";
import { createProjectionSettlementNameAdapter } from "./projection-settlement-name-adapter.js";
import { migrateProjectionConfigToV2 } from "../shared/projection-warp-schema.js";
import { migrateProjectionConfigToV7 } from "../shared/projection-config-schema.js";
import {
  DEFAULT_PROJECTION_BASELINE,
  createProjectionBaselineCatalogLoader,
  loadCapturedProjectionAsset,
  loadCapturedProjectionFraming,
} from "./projection-captured-baseline.js";
import { visibleProjectionBrowserError } from "./projection-browser-error.js";
import { prepareProjectionPairMeshes, prepareProjectionSideMesh } from "./projection-candidate-validation.js";
import { createProjectionDrawScheduler } from "./projection-draw-scheduler.js";
import { copyProjectionMesh } from "../projection-config/clock-layout-geometry.js";
import { resolveProjectionResolution } from './output-resolution.js';

export function resolveProjectionOutputMode(search = "") {
  const params = new URLSearchParams(String(search).replace(/^\?/, ""));
  return params.get("outputMode") === "browser" ? "browser" : "td";
}

export { loadCapturedProjectionFraming };

export async function loadCapturedProjectionBaseline({
  fetchImpl = globalThis.fetch,
  base = DEFAULT_PROJECTION_BASELINE,
  spanId = "left",
  signal,
} = {}) {
  return loadCapturedProjectionAsset({ fetchImpl, base, spanId, signal });
}

function abortError() {
  const error = new Error("browser projection startup was cancelled");
  error.name = "AbortError";
  return error;
}

function browserProjectionConfig(config) {
  if (!config) return null;
  return migrateProjectionConfigToV7(config, config.namesWall?.rotateDeg ?? 35);
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function awaitWithSignal(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener?.("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(abortError());
    };
    signal.addEventListener?.("abort", onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      },
    );
  });
}

function unusedImageSource(source) {
  if (Number(source.naturalWidth) > 0) return false;
  if (typeof source.getAttribute === "function") {
    return !String(source.getAttribute("src") || "").trim();
  }
  const src = String(source.currentSrc || source.src || "").trim();
  return source.complete === true && !src;
}

function sourceReadyWithSignal(source, signal) {
  if (!source) return Promise.reject(new Error("browser projection source is missing"));
  if (unusedImageSource(source)) {
    throwIfAborted(signal);
    return Promise.resolve();
  }
  if (typeof source.decode === "function") {
    let decodePromise;
    try {
      decodePromise = source.decode();
    } catch (error) {
      decodePromise = Promise.reject(error);
    }
    return awaitWithSignal(Promise.resolve(decodePromise).catch(() => undefined), signal);
  }
  if (source.complete === true && (source.naturalWidth == null || source.naturalWidth > 0)) {
    throwIfAborted(signal);
    return Promise.resolve();
  }
  if (typeof source.addEventListener !== "function") {
    throwIfAborted(signal);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const onLoad = () => { if (settled) return; settled = true; cleanup(); resolve(); };
    const onError = () => { if (settled) return; settled = true; cleanup(); reject(new Error("browser projection image failed to load")); };
    const onAbort = () => { if (settled) return; settled = true; cleanup(); reject(abortError()); };
    const cleanup = () => {
      source.removeEventListener?.("load", onLoad);
      source.removeEventListener?.("error", onError);
      signal?.removeEventListener?.("abort", onAbort);
    };
    source.addEventListener("load", onLoad, { once: true });
    source.addEventListener("error", onError, { once: true });
    if (signal?.aborted) onAbort();
    else signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

const visibleError = visibleProjectionBrowserError;

function hideSources(targets) {
  const previous = [];
  for (const target of targets || []) {
    if (!target?.style) continue;
    previous.push([target, target.style.visibility]);
    target.style.visibility = "hidden";
  }
  return () => previous.forEach(([target, value]) => { target.style.visibility = value; });
}

export async function createProjectionBrowserSurface({
  host,
  spanId,
  image,
  mapCanvas,
  scene = {},
  getScene,
  filterScene = scene => scene,
  hideTargets = [],
  fetchImpl,
  signal,
  rendererFactory = (options) => createProjectionWarpRenderer(options),
  initialConfig = null,
  search = globalThis.location?.search || '',
  onError,
  onContextLost: onContextLostCallback,
  onContextRestored: onContextRestoredCallback,
} = {}) {
  let baseline;
  let canvas;
  let compositor;
  let drawScheduler;
  let restoreSources = () => {};
  let hidden = false;
  let disposed = false;
  let statusElement = null;
  let onContextLost;
  let onContextRestored;
  let videoPlaybackActive = false;
  let contextLost = false;
  let nameAdapter;
  let settlementAdapter;
  let activeMesh;
  let previousPair = null;
  try {
    try {
      baseline = await loadCapturedProjectionFraming({ fetchImpl, signal });
    } catch (error) {
      const fallbackWarp = [2, 3, 4, 5, 6, 7].includes(initialConfig?.schemaVersion) ? initialConfig.outputs?.[spanId]?.warp : null;
      if (error?.name === "AbortError" || !fallbackWarp || (fallbackWarp.enabled !== false && fallbackWarp.baseline?.type !== "identity")) throw error;
      baseline = { manifest: { width: 1920, height: 1080, assets: {}, framing: {} }, framing: initialConfig };
    }
    const initialV6 = browserProjectionConfig(initialConfig);
    const startupConfig = initialV6 || browserProjectionConfig(baseline.framing);
    const initialWarp = startupConfig?.outputs?.[spanId]?.warp;
    const catalogLoader = createProjectionBaselineCatalogLoader({ fetchImpl, initialSnapshot: baseline });
    let startupSources;
    try {
      startupSources = await catalogLoader.prepare(startupConfig, signal);
      catalogLoader.promote(startupSources.snapshot);
      baseline = startupSources.loaded[spanId] || { ...startupSources.snapshot, mesh: null, asset: null };
    } catch (error) {
      const bypassesBaseline = initialWarp?.enabled === false || initialWarp?.baseline?.type === "identity";
      if (error?.name === "AbortError" || !bypassesBaseline) throw error;
      baseline = { ...baseline, mesh: null, asset: baseline.manifest.assets?.[spanId] || null, meshError: error };
    }
    await sourceReadyWithSignal(image, signal);
    if (disposed || signal?.aborted) throw abortError();
    const doc = host?.ownerDocument || globalThis.document;
    canvas = doc?.createElement?.("canvas");
    if (!canvas) throw new Error("browser projection canvas is unavailable");
    const resolution = resolveProjectionResolution(search);
    canvas.width = resolution.width;
    canvas.height = resolution.height;
    canvas.className = "projection-browser-surface";
    canvas.setAttribute?.("aria-label", `${spanId} browser projection output`);
    Object.assign(canvas.style || {}, { position: "absolute", inset: "0", width: "100%", height: "100%", zIndex: "2000", pointerEvents: "none" });
    host?.appendChild?.(canvas);
    const baseScene = {};
    if (image && !getScene) baseScene.image = { source: image };
    if (mapCanvas && !getScene) baseScene.map = { source: mapCanvas };
    const readScene = () => ({ image: null, map: null, names: null, settlements: null, roadSigns: null, caption: null, pattern: null, legend: null,
      ...filterScene({ ...baseScene, ...(typeof getScene === "function" ? getScene() : scene),
      ...(nameAdapter?.descriptor() ? { names: nameAdapter.descriptor() } : {}),
      ...(settlementAdapter?.descriptor() ? { settlements: settlementAdapter.descriptor() } : {}),
      }) });
    const initialMesh = startupConfig?.outputs?.[spanId]?.warp
      ? prepareProjectionSideMesh(startupConfig, spanId, baseline).mesh
      : evaluateWarpMesh(null, migrateProjectionConfigToV2(baseline.framing).outputs[spanId].warp, { side: spanId });
    const renderer = rendererFactory({ canvas, mesh: initialMesh });
    activeMesh = initialMesh;
    compositor = createProjectionSurfaceCompositor({ renderer, sources: readScene() });
    let activeConfig = browserProjectionConfig(initialConfig) || browserProjectionConfig(baseline.framing);
    const prepareConfig = (candidate) => prepareProjectionSideMesh(candidate, spanId, baseline);
    const preparePair = async (candidate, requestSignal = signal) => {
      const sources = await catalogLoader.prepare(candidate, requestSignal);
      const meshes = await prepareProjectionPairMeshes({ config: candidate, signal: requestSignal, loadBaseline: async (side) => sources.loaded[side] || null });
      return { config: browserProjectionConfig(candidate), mesh: meshes[spanId], meshes, snapshot: sources.snapshot, loaded: sources.loaded };
    };
    nameAdapter = createProjectionNameCanvasAdapter({ document: doc, output: spanId, rasterScale: resolution.scale });
    settlementAdapter = createProjectionSettlementNameAdapter({ document: doc, output: spanId, rasterScale: resolution.scale });
    const applyConfig = (candidate) => {
      const prepared = prepareConfig(candidate);
      renderer.setMesh(prepared.mesh);
      activeMesh = prepared.mesh;
      activeConfig = prepared.config;
      return true;
    };
    const baselineIdentity = (config = activeConfig) => {
      const warp = config?.outputs?.[spanId]?.warp;
      if (warp?.enabled === false) return { type: "identity" };
      const baselineRef = warp?.baseline;
      return baselineRef ? { type: baselineRef.type, ...(baselineRef.assetId ? { assetId: baselineRef.assetId, sha256: baselineRef.sha256 } : {}) } : null;
    };
    onContextLost = (event) => {
      event?.preventDefault?.();
      contextLost = true;
      drawScheduler?.cancel();
      onContextLostCallback?.();
      statusElement?.remove?.();
      statusElement = visibleError(host, new Error("WebGL context lost; restoring browser projection"));
    };
    onContextRestored = () => {
      contextLost = false;
      onContextRestoredCallback?.();
      statusElement?.remove?.();
      statusElement = null;
      drawScheduler?.drawNow();
    };
    canvas.addEventListener?.("webglcontextlost", onContextLost);
    canvas.addEventListener?.("webglcontextrestored", onContextRestored);
    const drawNow = () => {
      if (disposed || contextLost || renderer.isContextLost?.()) return false;
      try {
        compositor.setScene(readScene());
        if (compositor.draw() === false) return false;
      } catch (error) {
        statusElement?.remove?.();
        statusElement = visibleError(host, error);
        return false;
      }
      if (!hidden) {
        restoreSources = hideSources(hideTargets);
        hidden = true;
      }
      return true;
    };
    drawScheduler = createProjectionDrawScheduler({
      draw: drawNow,
      shouldThrottle: () => videoPlaybackActive,
      shouldPause: () => contextLost,
      maxFps: 20,
    });
    canvas.dataset ||= {};
    canvas.dataset.videoPlaybackProtection = "inactive";
    drawScheduler.drawNow();
    return {
      canvas,
      renderer,
      compositor,
      baseline,
      getMesh: () => copyProjectionMesh(activeMesh),
      draw: () => drawScheduler.drawNow(),
      requestDraw: () => drawScheduler.requestDraw(),
      setVideoPlaybackActive(active) {
        videoPlaybackActive = active === true;
        if (canvas?.dataset) canvas.dataset.videoPlaybackProtection = videoPlaybackActive ? "active" : "inactive";
        if (!videoPlaybackActive) drawScheduler?.flush();
      },
      prepareConfig,
      preparePair,
      getNameAdapter: () => nameAdapter,
      getSettlementAdapter: () => settlementAdapter,
      commitPair(prepared) {
        previousPair = { candidate: prepared, config: activeConfig, mesh: activeMesh, baseline };
        renderer.setMesh(prepared.mesh);
        activeMesh = prepared.mesh;
        activeConfig = prepared.config;
        baseline = prepared.loaded?.[spanId] || { ...prepared.snapshot, mesh: null, asset: null };
      },
      rollbackPair(prepared) {
        if (!previousPair || previousPair.candidate !== prepared) return false;
        renderer.setMesh(previousPair.mesh);
        activeMesh = previousPair.mesh;
        activeConfig = previousPair.config;
        baseline = previousPair.baseline;
        previousPair = null;
        return true;
      },
      finalizePair(prepared) {
        if (previousPair?.candidate !== prepared) return false;
        catalogLoader.promote(prepared.snapshot);
        previousPair = null;
        return true;
      },
      applyConfig,
      getConfig: () => activeConfig,
      getBaselineIdentity: baselineIdentity,
      dispose() {
        if (disposed) return;
        disposed = true;
        drawScheduler?.dispose();
        restoreSources();
        canvas?.removeEventListener?.("webglcontextlost", onContextLost);
        canvas?.removeEventListener?.("webglcontextrestored", onContextRestored);
        statusElement?.remove?.();
        nameAdapter?.dispose();
        settlementAdapter?.dispose();
        compositor?.dispose?.();
        canvas?.remove?.();
      },
    };
  } catch (error) {
    canvas?.remove?.();
    if (!disposed && !signal?.aborted && error?.name !== "AbortError") {
      statusElement = visibleError(host, error);
      onError?.(error, statusElement);
    }
    throw error;
  }
}

export { visibleError };
