import { MapProjectionConfig } from "../shared/map-projection-config.js";

const PRE_T3_ID = "projectionSpanPreT3";
const CROP_FIT_ID = "projectionSpanCropFit";
const FIT_BEST_ID = "projectionSpanFitBest";

export function parseProjectionSpanId(search) {
  if (typeof search !== "string" || search === "" || search === "?") return null;
  const q = search.startsWith("?") ? search : `?${search}`;
  const raw = new URLSearchParams(q).get("span");
  if (raw == null) return null;
  const id = String(raw).trim().toLowerCase();
  if (id === "left" || id === "right") return id;
  return null;
}

export function getProjectionSpanRect(spanId, spanConfig = MapProjectionConfig.PROJECTION_SPAN) {
  if (spanId === "left") {
    return { x0: spanConfig.LEFT_X0, x1: spanConfig.LEFT_X1 };
  }
  if (spanId === "right") {
    return { x0: spanConfig.RIGHT_X0, x1: spanConfig.RIGHT_X1 };
  }
  return null;
}

function spanWidthFraction(x0, x1) {
  const widthFrac = x1 - x0;
  if (!(widthFrac > 0) || !Number.isFinite(widthFrac)) {
    return null;
  }
  return widthFrac;
}

export function spanHorizontalScale(x0, x1) {
  const widthFrac = spanWidthFraction(x0, x1);
  if (widthFrac == null) return 1;
  return 1 / widthFrac;
}

/** Inverse-width zoom in MapLibre levels. Not applied to the span camera (crop+Fit Best uses layout). */
export function spanWidthZoomDelta(x0, x1) {
  const widthFrac = spanWidthFraction(x0, x1);
  if (widthFrac == null) return 0;
  return Math.log2(1 / widthFrac);
}

export function computeTesugaPreT3JumpTo({
  zoom,
  bearing,
  width,
  height,
  unproject,
  spanConfig = MapProjectionConfig.PROJECTION_SPAN,
}) {
  const scale = Number(spanConfig.PRE_SCALE) || 1;
  const rotateDeg = Number(spanConfig.PRE_ROTATE_DEG) || 0;
  const tx = Number(spanConfig.PRE_TX) || 0;
  const ty = Number(spanConfig.PRE_TY) || 0;
  const cx = (0.5 - tx) * width;
  const cy = (0.5 - ty) * height;
  return {
    center: unproject([cx, cy]),
    zoom: zoom + Math.log2(scale),
    bearing: bearing + rotateDeg,
    animate: false,
  };
}

function applyTesugaPreT3Camera(map) {
  if (
    !map ||
    typeof map.jumpTo !== "function" ||
    typeof map.getZoom !== "function" ||
    typeof map.getBearing !== "function" ||
    typeof map.unproject !== "function"
  ) {
    return;
  }
  const container = typeof map.getContainer === "function" ? map.getContainer() : null;
  const width = container?.clientWidth || 1920;
  const height = container?.clientHeight || 1080;
  map.jumpTo(
    computeTesugaPreT3JumpTo({
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      width,
      height,
      unproject: (pt) => map.unproject(pt),
    }),
  );
}

export function spanVisibleCenterInT3({ x0, x1, spanConfig = MapProjectionConfig.PROJECTION_SPAN }) {
  const widthFrac = spanWidthFraction(x0, x1);
  if (widthFrac == null) {
    return { x: 0.5, y: 0.5 };
  }
  const fitPad = (1 - widthFrac) / 2;
  const postTy = Number(spanConfig.POST_TY) || 0;
  const t3x0 = x0 + (0.25 - fitPad);
  const t3x1 = x0 + (0.75 - fitPad);
  return {
    x: (t3x0 + t3x1) / 2,
    // TD transform ty<0 moves the image down, revealing more of the T3 *top*.
    // MapLibre y grows downward, so the 2x-fill center must move the same way.
    y: 0.5 + postTy / 2,
  };
}

export function computeTesugaPostFillJumpTo({
  zoom,
  bearing,
  width,
  height,
  unproject,
  x0,
  x1,
  spanConfig = MapProjectionConfig.PROJECTION_SPAN,
}) {
  const postScale = Number(spanConfig.POST_SCALE) || 1;
  const vis = spanVisibleCenterInT3({ x0, x1, spanConfig });
  return {
    center: unproject([vis.x * width, vis.y * height]),
    zoom: zoom + Math.log2(postScale),
    bearing,
    animate: false,
  };
}

function applyTesugaPostFillCamera(map, rect) {
  if (
    !map ||
    !rect ||
    typeof map.jumpTo !== "function" ||
    typeof map.getZoom !== "function" ||
    typeof map.getBearing !== "function" ||
    typeof map.unproject !== "function"
  ) {
    return;
  }
  const container = typeof map.getContainer === "function" ? map.getContainer() : null;
  const width = container?.clientWidth || 1920;
  const height = container?.clientHeight || 1080;
  map.jumpTo(
    computeTesugaPostFillJumpTo({
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      width,
      height,
      unproject: (pt) => map.unproject(pt),
      x0: rect.x0,
      x1: rect.x1,
    }),
  );
}

export function spanImageFinalTransformStyle({ x0, x1, spanConfig = MapProjectionConfig.PROJECTION_SPAN }) {
  const vis = spanVisibleCenterInT3({ x0, x1, spanConfig });
  const scale = (Number(spanConfig.PRE_SCALE) || 1) * (Number(spanConfig.POST_SCALE) || 1);
  return {
    transform: `rotate(${spanConfig.PRE_ROTATE_DEG}deg) scale(${scale})`,
    transformOrigin: `${vis.x * 100}% ${vis.y * 100}%`,
  };
}

export function computeSpanJumpTo({ zoom, bearing, width, height, unproject, x0, x1 }) {
  const cx = ((x0 + x1) / 2) * width;
  const cy = 0.5 * height;
  const center = unproject([cx, cy]);
  return {
    center,
    zoom,
    bearing,
    animate: false,
  };
}

/**
 * Tesuga transform3 xord=srt (scale, then rotate, then translate).
 * CSS applies right-to-left, so the string is translate rotate scale.
 */
export function spanPreT3TransformStyle(spanConfig = MapProjectionConfig.PROJECTION_SPAN) {
  const txPct = (Number(spanConfig.PRE_TX) || 0) * 100;
  const ty = Number(spanConfig.PRE_TY) || 0;
  const tyCss = ty === 0 ? "0" : `${ty * 100}%`;
  return {
    transform: `translate(${txPct}%, ${tyCss}) rotate(${spanConfig.PRE_ROTATE_DEG}deg) scale(${spanConfig.PRE_SCALE})`,
    transformOrigin: "50% 50%",
  };
}

/** Fit Best: shift the already-cropped strip so it is centered in 16:9. */
export function spanFitBestLayoutStyle({ x0, x1 }) {
  const widthFrac = spanWidthFraction(x0, x1);
  if (widthFrac == null) return null;
  const delta = (1 - widthFrac) / 2 - x0;
  return {
    position: "absolute",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    overflow: "visible",
    transform: `translateX(${delta * 100}%)`,
    transformOrigin: "0 0",
  };
}

/** Axis-aligned crop of the post-transform3 canvas (Tesuga crop1/crop2). */
export function spanCropLayoutStyle({ x0, x1 }) {
  const widthFrac = spanWidthFraction(x0, x1);
  if (widthFrac == null) return null;
  return {
    position: "absolute",
    top: "0",
    left: `${x0 * 100}%`,
    width: `${widthFrac * 100}%`,
    height: "100%",
    overflow: "hidden",
    transform: "",
    transformOrigin: "",
  };
}

/** Full 16:9 T3 canvas reconstructed inside the crop window. */
export function spanPreT3LayoutStyle({ x0, x1 }) {
  const widthFrac = spanWidthFraction(x0, x1);
  if (widthFrac == null) return null;
  return {
    position: "absolute",
    top: "0",
    left: `${(-x0 / widthFrac) * 100}%`,
    width: `${(1 / widthFrac) * 100}%`,
    height: "100%",
  };
}

function getMapSpanTarget(map) {
  if (!map) return null;
  if (typeof map.getContainer === "function") {
    const container = map.getContainer();
    if (container?.style) return container;
  }
  return null;
}

function resolveMapSpanEl(map, containerEl) {
  const fromMap = getMapSpanTarget(map);
  if (fromMap) return fromMap;
  const nested = queryChildById(containerEl, "projectionMap");
  if (nested?.style) return nested;
  if (typeof document !== "undefined" && typeof document.getElementById === "function") {
    const byId = document.getElementById("projectionMap");
    if (byId?.style) return byId;
  }
  return null;
}

function applySpanTransform(el, css) {
  if (!el?.style) return;
  if (!css) {
    el.style.transform = "";
    el.style.transformOrigin = "";
    return;
  }
  el.style.transform = css.transform;
  el.style.transformOrigin = css.transformOrigin;
}

function applyBoxStyle(el, style) {
  if (!el?.style || !style) return;
  for (const [key, value] of Object.entries(style)) {
    el.style[key] = value;
  }
}

function queryChildById(root, id) {
  if (!root) return null;
  if (typeof root.querySelector === "function") {
    return root.querySelector(`#${id}`);
  }
  return null;
}

function ensureSpanLayers(containerEl) {
  if (!containerEl || typeof document === "undefined" || typeof document.createElement !== "function") {
    return { fitBest: null, cropFit: null, preT3: null };
  }
  let fitBest = queryChildById(containerEl, FIT_BEST_ID);
  let cropFit = queryChildById(fitBest, CROP_FIT_ID) || queryChildById(containerEl, CROP_FIT_ID);
  let preT3 = queryChildById(cropFit, PRE_T3_ID) || queryChildById(containerEl, PRE_T3_ID);
  if (fitBest && cropFit && preT3) {
    return { fitBest, cropFit, preT3 };
  }

  unwrapSpanLayers(containerEl);

  fitBest = document.createElement("div");
  fitBest.id = FIT_BEST_ID;
  cropFit = document.createElement("div");
  cropFit.id = CROP_FIT_ID;
  preT3 = document.createElement("div");
  preT3.id = PRE_T3_ID;
  while (containerEl.firstChild) {
    preT3.appendChild(containerEl.firstChild);
  }
  cropFit.appendChild(preT3);
  fitBest.appendChild(cropFit);
  containerEl.appendChild(fitBest);
  return { fitBest, cropFit, preT3 };
}

function unwrapSpanLayers(containerEl) {
  if (!containerEl) return;
  const fitBest = queryChildById(containerEl, FIT_BEST_ID);
  const cropFit =
    queryChildById(fitBest, CROP_FIT_ID) || queryChildById(containerEl, CROP_FIT_ID);
  const preT3 =
    queryChildById(cropFit, PRE_T3_ID) ||
    queryChildById(fitBest, PRE_T3_ID) ||
    queryChildById(containerEl, PRE_T3_ID);
  const source = preT3 || cropFit || fitBest;
  if (!source) return;
  while (source.firstChild) {
    containerEl.appendChild(source.firstChild);
  }
  for (const wrap of [preT3, cropFit, fitBest]) {
    if (wrap?.parentElement) {
      wrap.parentElement.removeChild(wrap);
    }
  }
}

function resetSpanDom(imageEl, containerEl, map) {
  unwrapSpanLayers(containerEl);
  applySpanTransform(imageEl, null);
  applySpanTransform(resolveMapSpanEl(map, containerEl), null);
  if (containerEl?.style) {
    containerEl.style.overflow = "";
  }
}

export function clearProjectionSpanView({ map, imageEl, containerEl }) {
  resetSpanDom(imageEl, containerEl, map);
}

export function applyProjectionSpanView({ map, imageEl, containerEl, spanId }) {
  const rect = getProjectionSpanRect(spanId);
  if (!rect) {
    resetSpanDom(imageEl, containerEl, map);
    return;
  }

  if (containerEl?.style) {
    containerEl.style.overflow = "hidden";
  }
  unwrapSpanLayers(containerEl);
  applySpanTransform(resolveMapSpanEl(map, containerEl), null);
  applySpanTransform(imageEl, spanImageFinalTransformStyle(rect));
  applyTesugaPreT3Camera(map);
  applyTesugaPostFillCamera(map, rect);
}
