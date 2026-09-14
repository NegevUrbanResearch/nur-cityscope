import { MapProjectionConfig } from "../shared/map-projection-config.js";
import { DEFAULT_PROJECTION_CONFIG } from "../shared/projection-config-schema.js";
import { outputToT3, t3ToOutput } from "../shared/projection-config-geometry.js";

const PRE_T3_ID = "projectionSpanPreT3";
const CROP_FIT_ID = "projectionSpanCropFit";
const FIT_BEST_ID = "projectionSpanFitBest";

export function parseProjectionSpanId(search) {
  if (typeof search !== "string" || search === "" || search === "?") return null;
  const q = search.startsWith("?") ? search : `?${search}`;
  const raw = new URLSearchParams(q).get("span");
  if (raw == null) return null;
  const id = String(raw).trim().toLowerCase();
  return id === "left" || id === "right" ? id : null;
}

function resolveProjectionConfig(config) {
  return config?.outputs?.left && config?.outputs?.right
    ? config
    : DEFAULT_PROJECTION_CONFIG;
}

export function getProjectionSpanRect(spanId, config = DEFAULT_PROJECTION_CONFIG) {
  const branch = resolveProjectionConfig(config)?.outputs?.[spanId];
  if (!branch?.crop) return null;
  return { ...branch.crop };
}

export function spanViewportUvToT3Uv(uv, rect, config = DEFAULT_PROJECTION_CONFIG, spanId = null) {
  if (!uv || !rect) return null;
  const values = [
    uv.u,
    uv.v,
    rect.x0,
    rect.x1,
    rect.y0 ?? 0,
    rect.y1 ?? 1,
  ].map(Number);
  if (!values.every(Number.isFinite)) return null;
  const [u, v, x0, x1, y0, y1] = values;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  const effective = resolveProjectionConfig(config);
  let branch = config?.crop && config?.post ? config : effective.outputs?.[spanId];
  if (!branch?.crop) return null;
  const post = branch.post || { scale: 1, tx: 0, ty: 0 };
  return outputToT3({ u, v }, { crop: { x0, x1, y0, y1 }, post });
}

export function uvInsideSpanRect(uv, rect) {
  if (!uv || !rect) return false;
  const values = [
    uv.u,
    uv.v,
    rect.x0,
    rect.x1,
    rect.y0 ?? 0,
    rect.y1 ?? 1,
  ].map(Number);
  if (!values.every(Number.isFinite)) return false;
  const [u, v, x0, x1, y0, y1] = values;
  return u >= x0 && u <= x1 && v >= y0 && v <= y1;
}

function spanWidthFraction(x0, x1) {
  const width = Number(x1) - Number(x0);
  return width > 0 && Number.isFinite(width) ? width : null;
}

export function spanHorizontalScale(x0, x1) {
  const width = spanWidthFraction(x0, x1);
  return width == null ? 1 : 1 / width;
}

export function spanWidthZoomDelta(x0, x1) {
  const width = spanWidthFraction(x0, x1);
  return width == null ? 0 : Math.log2(1 / width);
}

function configPre(config) {
  const pre = resolveProjectionConfig(config).pre;
  return {
    scale: Number(pre.scale),
    rotateDeg: Number(pre.rotateDeg),
    tx: Number(pre.tx),
    ty: Number(pre.ty),
  };
}

export function computeTesugaPreT3JumpTo({ zoom, bearing, width, height, unproject, spanConfig, config }) {
  const pre = configPre(config ?? spanConfig);
  return {
    center: unproject([(0.5 - pre.tx) * width, (0.5 - pre.ty) * height]),
    zoom: zoom + Math.log2(pre.scale),
    bearing: bearing + pre.rotateDeg,
    animate: false,
  };
}

export function spanVisibleCenterInT3({ x0, x1, spanConfig, config, spanId = "left" }) {
  const width = spanWidthFraction(x0, x1);
  if (width == null) return { x: 0.5, y: 0.5 };
  const branch = config?.outputs?.[spanId] || spanConfig?.outputs?.[spanId];
  const postScale = Number(
    branch?.post?.scale
      ?? spanConfig?.POST_SCALE
      ?? MapProjectionConfig.PROJECTION_SPAN.POST_SCALE,
  ) || 1;
  const postTx = Number(
    branch?.post?.tx
      ?? spanConfig?.POST_TX
      ?? MapProjectionConfig.PROJECTION_SPAN.POST_TX,
  ) || 0;
  const postTy = Number(
    branch?.post?.ty
      ?? spanConfig?.POST_TY
      ?? MapProjectionConfig.PROJECTION_SPAN.POST_TY,
  ) || 0;
  const gain = postScale * Math.min(1 / width, 1);
  const fitPad = (1 - width) / 2;
  return {
    x: (x0 + (0.25 - fitPad) + x0 + (0.75 - fitPad)) / 2 - postTx / gain,
    y: 0.5 - postTy / gain,
  };
}

export function computeTesugaPostFillJumpTo({ zoom, bearing, width, height, unproject, x0, x1, spanConfig, config, spanId }) {
  const branch = config?.outputs?.[spanId];
  const postScale = Number(
    branch?.post?.scale
      ?? spanConfig?.POST_SCALE
      ?? MapProjectionConfig.PROJECTION_SPAN.POST_SCALE,
  ) || 1;
  const vis = spanVisibleCenterInT3({ x0, x1, spanConfig, config, spanId });
  return {
    center: unproject([vis.x * width, vis.y * height]),
    zoom: zoom + Math.log2(postScale),
    bearing,
    animate: false,
  };
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
  return {
    center: unproject([((x0 + x1) / 2) * width, 0.5 * height]),
    zoom,
    bearing,
    animate: false,
  };
}

export function spanPreT3TransformStyle(spanConfig = MapProjectionConfig.PROJECTION_SPAN) {
  return {
    transform: `translate(${(Number(spanConfig.PRE_TX) || 0) * 100}%, ${(Number(spanConfig.PRE_TY) || 0) * 100}%) rotate(${spanConfig.PRE_ROTATE_DEG}deg) scale(${spanConfig.PRE_SCALE})`,
    transformOrigin: "50% 50%",
  };
}

export function spanFitBestLayoutStyle({ x0, x1 }) {
  const width = spanWidthFraction(x0, x1);
  if (width == null) return null;
  return {
    position: "absolute",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
    overflow: "visible",
    transform: `translateX(${(((1 - width) / 2 - x0) * 100)}%)`,
    transformOrigin: "0 0",
  };
}

export function spanCropLayoutStyle({ x0, x1 }) {
  const width = spanWidthFraction(x0, x1);
  if (width == null) return null;
  return {
    position: "absolute",
    top: "0",
    left: `${x0 * 100}%`,
    width: `${width * 100}%`,
    height: "100%",
    overflow: "hidden",
    transform: "",
    transformOrigin: "",
  };
}

export function spanPreT3LayoutStyle({ x0, x1 }) {
  const width = spanWidthFraction(x0, x1);
  if (width == null) return null;
  return {
    position: "absolute",
    top: "0",
    left: `${(-x0 / width) * 100}%`,
    width: `${(1 / width) * 100}%`,
    height: "100%",
  };
}

function getMapSpanTarget(map) {
  const container = typeof map?.getContainer === "function" ? map.getContainer() : null;
  return container?.style ? container : null;
}

function queryChildById(root, id) {
  return typeof root?.querySelector === "function" ? root.querySelector(`#${id}`) : null;
}

function resolveMapSpanEl(map, containerEl) {
  return getMapSpanTarget(map)
    || queryChildById(containerEl, "projectionMap")
    || (typeof document !== "undefined" ? document.getElementById?.("projectionMap") : null);
}

function applySpanTransform(el, css) {
  if (!el?.style) return;
  el.style.transform = css?.transform || "";
  el.style.transformOrigin = css?.transformOrigin || "";
}

function unwrapSpanLayers(containerEl) {
  const fitBest = queryChildById(containerEl, FIT_BEST_ID);
  const cropFit = queryChildById(fitBest, CROP_FIT_ID) || queryChildById(containerEl, CROP_FIT_ID);
  const preT3 = queryChildById(cropFit, PRE_T3_ID)
    || queryChildById(fitBest, PRE_T3_ID)
    || queryChildById(containerEl, PRE_T3_ID);
  const source = preT3 || cropFit || fitBest;
  if (!source || !containerEl) return;
  while (source.firstChild) containerEl.appendChild(source.firstChild);
  for (const wrapper of [preT3, cropFit, fitBest]) if (wrapper?.parentElement) wrapper.parentElement.removeChild(wrapper);
}

function resetSourceStyle(el, { placement = false } = {}) {
  if (!el?.style) return;
  for (const key of ["transform", "transformOrigin", "clipPath", "webkitClipPath"]) el.style[key] = "";
  if (placement) {
    for (const key of ["width", "height", "left", "top"]) el.style[key] = "";
  }
}

function resetSpanDom(imageEl, containerEl, map) {
  unwrapSpanLayers(containerEl);
  resetSourceStyle(imageEl, { placement: true });
  if (imageEl?.parentElement && imageEl.parentElement !== containerEl) resetSourceStyle(imageEl.parentElement);
  resetSourceStyle(resolveMapSpanEl(map, containerEl));
  resetSourceStyle(typeof map?.getCanvas === "function" ? map.getCanvas() : null);
  if (containerEl?.style) containerEl.style.overflow = "";
}

function dimensionsForMap(map) {
  const container = typeof map?.getContainer === "function" ? map.getContainer() : null;
  const rect = typeof container?.getBoundingClientRect === "function"
    ? container.getBoundingClientRect()
    : null;
  return {
    width: Number(container?.clientWidth || rect?.width) || 1920,
    height: Number(container?.clientHeight || rect?.height) || 1080,
  };
}

function cloneCenter(center) {
  if (Array.isArray(center)) return [...center];
  if (center && typeof center === "object") return { lng: Number(center.lng), lat: Number(center.lat) };
  return null;
}

function clonePadding(padding) {
  return padding && typeof padding === "object" ? { ...padding } : padding;
}

function getCameraSnapshot(map) {
  if (!map || typeof map.getZoom !== "function" || typeof map.getBearing !== "function") return null;
  const dimensions = dimensionsForMap(map);
  return {
    center: cloneCenter(typeof map.getCenter === "function" ? map.getCenter() : null),
    zoom: Number(map.getZoom()),
    bearing: Number(map.getBearing()),
    pitch: Number(typeof map.getPitch === "function" ? map.getPitch() : 0),
    padding: typeof map.getPadding === "function" ? clonePadding(map.getPadding()) : undefined,
    width: dimensions.width,
    height: dimensions.height,
  };
}

function validSnapshot(snapshot) {
  return snapshot
    && Number.isFinite(snapshot.zoom)
    && Number.isFinite(snapshot.bearing)
    && Number.isFinite(snapshot.width)
    && Number.isFinite(snapshot.height);
}

function restoreCamera(map, snapshot) {
  if (!validSnapshot(snapshot) || typeof map?.jumpTo !== "function") return false;
  if (snapshot.center == null && snapshot.padding === undefined) return false;
  const jump = { zoom: snapshot.zoom, bearing: snapshot.bearing, pitch: snapshot.pitch, animate: false };
  if (snapshot.center != null) jump.center = cloneCenter(snapshot.center);
  if (snapshot.padding !== undefined) jump.padding = clonePadding(snapshot.padding);
  map.jumpTo(jump);
  return true;
}

function getSpanBaseSnapshot(map) {
  if (!map) return null;
  if (validSnapshot(map._otefSpanBase)) return map._otefSpanBase;
  const snapshot = getCameraSnapshot(map);
  if (validSnapshot(snapshot)) map._otefSpanBase = snapshot;
  return snapshot;
}

export function clearProjectionSpanBase(map) {
  if (map) delete map._otefSpanBase;
}

export function restoreProjectionSpanBase(map) {
  return restoreCamera(map, map?._otefSpanBase);
}

export function runWhenMapIdle(map, fn) {
  if (typeof fn !== "function") return;
  if (!(typeof map?.isMoving === "function" && map.isMoving())) fn();
  else if (typeof map.once === "function") map.once("idle", fn);
  else fn();
}

export function clearProjectionSpanView({ map, imageEl, containerEl }) {
  restoreCamera(map, getSpanBaseSnapshot(map));
  resetSpanDom(imageEl, containerEl, map);
  clearProjectionSpanBase(map);
}

function clipRectForBranch(branch) {
  const corners = [
    { u: branch.crop.x0, v: branch.crop.y0 },
    { u: branch.crop.x1, v: branch.crop.y0 },
    { u: branch.crop.x1, v: branch.crop.y1 },
    { u: branch.crop.x0, v: branch.crop.y1 },
  ].map((point) => t3ToOutput(point, branch));
  const x0 = Math.max(0, Math.min(...corners.map((point) => point.u)));
  const x1 = Math.min(1, Math.max(...corners.map((point) => point.u)));
  const y0 = Math.max(0, Math.min(...corners.map((point) => point.v)));
  const y1 = Math.min(1, Math.max(...corners.map((point) => point.v)));
  return x1 > x0 && y1 > y0 ? { x0, x1, y0, y1 } : null;
}

function clipPathForRect(rect) {
  if (!rect) return "inset(100% 100% 100% 100%)";
  return `inset(${rect.y0 * 100}% ${(1 - rect.x1) * 100}% ${(1 - rect.y1) * 100}% ${rect.x0 * 100}%)`;
}

function applyClip(el, clipPath) {
  if (!el?.style) return;
  el.style.clipPath = clipPath;
  el.style.webkitClipPath = clipPath;
}

function imageClipTarget(imageEl) {
  const host = imageEl?.parentElement;
  return host?.id === "projectionImageClip" || host?.dataset?.projectionSource === "image" ? host : imageEl;
}

function geographicImageMatrix(map, imageEl, dimensions) {
  const metadata = imageEl?.__otefProjectionImage || map?._otefProjectionImage;
  if (!metadata || typeof map?.project !== "function") return null;
  let geographicCorners = metadata.corners;
  if (!Array.isArray(geographicCorners) || geographicCorners.length !== 4) {
    const bounds = metadata.bounds;
    if (!bounds) return null;
    const west = Array.isArray(bounds) ? bounds[0][0] : bounds.west;
    const south = Array.isArray(bounds) ? bounds[0][1] : bounds.south;
    const east = Array.isArray(bounds) ? bounds[1][0] : bounds.east;
    const north = Array.isArray(bounds) ? bounds[1][1] : bounds.north;
    if (![west, south, east, north].every(Number.isFinite)) return null;
    geographicCorners = [[west, north], [east, north], [east, south], [west, south]];
  }
  const points = geographicCorners.map((point) => map.project(point));
  if (!points.every((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))) return null;
  const width = Number(metadata.width || imageEl?.naturalWidth || dimensions.width) || dimensions.width;
  const height = Number(metadata.height || imageEl?.naturalHeight || dimensions.height) || dimensions.height;
  const matrix3d = fitImageHomography(points, width, height);
  if (!matrix3d) return null;
  return {
    matrix3d,
    corners: points,
    width,
    height,
  };
}

function solveLinearSystem(matrix, values) {
  const rows = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < rows.length; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < rows.length; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) < 1e-12) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let value = column; value <= rows.length; value += 1) rows[column][value] /= divisor;
    for (let row = 0; row < rows.length; row += 1) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let value = column; value <= rows.length; value += 1) rows[row][value] -= factor * rows[column][value];
    }
  }
  return rows.map((row) => row[rows.length]);
}

export function fitImageHomography(points, width, height) {
  if (!Array.isArray(points) || points.length !== 4 || !(width > 0) || !(height > 0)) return null;
  const source = [[0, 0], [width, 0], [width, height], [0, height]];
  const equations = [];
  const targetsX = [];
  const targetsY = [];
  points.forEach((point, index) => {
    const [x, y] = source[index];
    equations.push([x, y, 1, 0, 0, 0, -point.x * x, -point.x * y]);
    targetsX.push(point.x);
    equations.push([0, 0, 0, x, y, 1, -point.y * x, -point.y * y]);
    targetsY.push(point.y);
  });
  const values = [];
  for (let index = 0; index < 4; index += 1) values.push(targetsX[index], targetsY[index]);
  const solution = solveLinearSystem(equations, values);
  if (!solution || !solution.every(Number.isFinite)) return null;
  const [h00, h01, h02, h10, h11, h12, h20, h21] = solution;
  return [h00, h10, 0, h20, h01, h11, 0, h21, 0, 0, 1, 0, h02, h12, 0, 1];
}

function applyGeographicImagePlacement(map, imageEl, dimensions) {
  const placement = geographicImageMatrix(map, imageEl, dimensions);
  if (!placement || !imageEl?.style) return false;
  imageEl.style.position = "absolute";
  imageEl.style.left = "0";
  imageEl.style.top = "0";
  imageEl.style.width = `${placement.width}px`;
  imageEl.style.height = `${placement.height}px`;
  imageEl.style.transformOrigin = "0 0";
  imageEl.style.transform = `matrix3d(${placement.matrix3d.join(",")})`;
  return true;
}

function applyModernCamera(map, snapshot, branch, config) {
  if (!validSnapshot(snapshot) || typeof map?.jumpTo !== "function" || typeof map?.unproject !== "function") return;
  restoreCamera(map, snapshot);
  const pre = computeTesugaPreT3JumpTo({
    zoom: snapshot.zoom,
    bearing: snapshot.bearing,
    width: snapshot.width,
    height: snapshot.height,
    unproject: (point) => map.unproject(point),
    config,
  });
  map.jumpTo(pre);
  const center = outputToT3({ u: 0.5, v: 0.5 }, branch);
  const gain = branch.post.scale * Math.min(
    1 / (branch.crop.x1 - branch.crop.x0),
    1 / (branch.crop.y1 - branch.crop.y0),
  );
  map.jumpTo({
    center: map.unproject([center.u * snapshot.width, center.v * snapshot.height]),
    zoom: map.getZoom() + Math.log2(gain),
    bearing: map.getBearing(),
    pitch: snapshot.pitch,
    animate: false,
  });
}

export function applyProjectionSpanView({ map, imageEl, containerEl, spanId, config = DEFAULT_PROJECTION_CONFIG, revision }) {
  if (
    Number.isFinite(revision) &&
    Number.isFinite(map?._otefProjectionSpanRevision) &&
    revision < map._otefProjectionSpanRevision
  ) {
    return false;
  }
  if (Number.isFinite(revision) && map) {
    map._otefProjectionSpanRevision = revision;
  }
  const effectiveConfig = resolveProjectionConfig(config);
  const rect = getProjectionSpanRect(spanId, effectiveConfig);
  const base = getSpanBaseSnapshot(map);
  if (!rect) {
    restoreCamera(map, base);
    resetSpanDom(imageEl, containerEl, map);
    clearProjectionSpanBase(map);
    return true;
  }
  const branch = effectiveConfig.outputs[spanId];
  const currentDimensions = dimensionsForMap(map);
  const dimensions = {
    width: base?.width || currentDimensions.width,
    height: base?.height || currentDimensions.height,
  };
  unwrapSpanLayers(containerEl);
  const mapEl = resolveMapSpanEl(map, containerEl);
  const clipPath = clipPathForRect(clipRectForBranch(branch));
  applyClip(mapEl, clipPath);
  const canvas = typeof map?.getCanvas === "function" ? map.getCanvas() : null;
  applyClip(canvas, clipPath);
  const imageSource = imageClipTarget(imageEl);
  applyClip(imageSource, clipPath);
  if (imageSource === imageEl) applyClip(imageEl, clipPath);
  applyModernCamera(map, base, branch, effectiveConfig);
  if (!applyGeographicImagePlacement(map, imageEl, dimensions)) {
    applySpanTransform(imageEl, spanImageFinalTransformStyle({
      x0: rect.x0,
      x1: rect.x1,
      spanConfig: MapProjectionConfig.PROJECTION_SPAN,
    }));
  }
  if (map) map._otefProjectionSpanEffectiveConfig = effectiveConfig;
  return true;
}
