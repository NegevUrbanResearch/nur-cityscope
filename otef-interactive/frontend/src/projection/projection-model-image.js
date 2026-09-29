import { getLayerLifecycleRuntime } from "../shared/layer-lifecycle-fade.js";

export const PROJECTION_MODEL_FULL_ID = "projector_base.model_base";

const bindingByMap = new WeakMap();

function groupsOf(layerGroups) {
  if (Array.isArray(layerGroups)) return layerGroups;
  if (layerGroups && typeof layerGroups === "object") return Object.values(layerGroups);
  return [];
}

export function projectionModelEnabled(layerGroups) {
  const group = groupsOf(layerGroups).find((entry) => entry?.id === "projector_base");
  if (!group || group.enabled === false) return false;
  return (group.layers || []).some((layer) => layer?.id === "model_base" && layer.enabled);
}

function snapOpacity(imageEl, enabled) {
  imageEl.style.transition = "none";
  imageEl.style.opacity = enabled ? "1" : "0";
}

function imageReadyNow(imageEl) {
  return imageEl?.complete === true && Number(imageEl.naturalWidth) > 0;
}

function defaultSubscribeReady(imageEl) {
  return ({ ready, failed }) => {
    if (imageReadyNow(imageEl)) {
      ready();
      return undefined;
    }
    const onLoad = () => {
      if (imageReadyNow(imageEl)) ready();
      else failed();
    };
    const onError = () => failed();
    imageEl.addEventListener?.("load", onLoad);
    imageEl.addEventListener?.("error", onError);
    return () => {
      imageEl.removeEventListener?.("load", onLoad);
      imageEl.removeEventListener?.("error", onError);
    };
  };
}

export function projectionModelSubscribeReady(imageEl, imageReadiness) {
  return ({ ready, failed }) => {
    const versionReady = () => imageReadiness?.contentVersion() != null;
    if (versionReady()) {
      ready();
      return undefined;
    }
    if (imageEl?.complete === true && !imageReadyNow(imageEl)) {
      failed();
      return undefined;
    }
    const onLoad = () => {
      if (versionReady()) ready();
      else if (imageEl?.complete === true && !imageReadyNow(imageEl)) failed();
    };
    const onError = () => failed();
    imageEl?.addEventListener?.("load", onLoad);
    imageEl?.addEventListener?.("error", onError);
    return () => {
      imageEl?.removeEventListener?.("load", onLoad);
      imageEl?.removeEventListener?.("error", onError);
    };
  };
}

export function releaseProjectionModelImage(map) {
  if (!map) return;
  bindingByMap.delete(map);
  const runtime = getLayerLifecycleRuntime(map);
  if (!runtime || runtime.isDisposed()) return;
  runtime.dropChannels(PROJECTION_MODEL_FULL_ID);
  runtime.invalidateMember(PROJECTION_MODEL_FULL_ID);
}

export function syncProjectionModelImage({
  map,
  imageEl,
  layerGroups,
  modelInfo = {},
  requestDraw,
  subscribeReady,
  sealBatch = true,
} = {}) {
  if (!imageEl) return;
  const enabled = projectionModelEnabled(layerGroups);
  const durationMs = typeof modelInfo.durationMs === "number" && Number.isFinite(modelInfo.durationMs)
    ? Math.max(0, modelInfo.durationMs)
    : 0;
  const snap = modelInfo.fromSlideshowTick === true || !(durationMs > 0) || !map;
  if (snap) {
    if (map) releaseProjectionModelImage(map);
    snapOpacity(imageEl, enabled);
    return;
  }

  const runtime = getLayerLifecycleRuntime(map);
  const pendingBefore = runtime.getPendingBatch();
  const desiredNow = runtime.getDesiredIds();
  const already = desiredNow.includes(PROJECTION_MODEL_FULL_ID);
  const previous = bindingByMap.get(map);
  const bound = previous?.element === imageEl && previous.runtime === runtime;
  const deferCommit = sealBatch === false;
  if (!deferCommit && !pendingBefore && already === enabled && bound) {
    if (enabled && imageEl.style.opacity === "1") return;
    if (!enabled && imageEl.style.opacity === "0") return;
  }
  if (!pendingBefore) {
    const desired = new Set(desiredNow);
    if (enabled) desired.add(PROJECTION_MODEL_FULL_ID);
    else desired.delete(PROJECTION_MODEL_FULL_ID);
    runtime.setDesiredIds([...desired], { durationMs });
  }

  const opacity = imageEl.style?.opacity;
  const current = Number(opacity);
  const adoptVisible = opacity != null && opacity !== "" && Number.isFinite(current) && current > 0;
  if (!bound && !adoptVisible && opacity === "0") imageEl.style.opacity = "";
  runtime.registerElement(PROJECTION_MODEL_FULL_ID, imageEl, {
    adoptVisible,
    onFrameDraw: () => requestDraw?.(),
    subscribeReady: typeof subscribeReady === "function" ? subscribeReady : defaultSubscribeReady(imageEl),
  });
  bindingByMap.set(map, { element: imageEl, runtime });
  if (!pendingBefore && !deferCommit) runtime.commitBatch();
}
