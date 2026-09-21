import { clampNliExplainerLayout, nliExplainerOverlapPageRect } from "./nli-explainer-overlay.js";

const MIN_DWELL_SECONDS = 4;
const MAX_DWELL_SECONDS = 30;
const SNAP_DISTANCE_PX = 28;
const SNAP_GAP_PX = 12;
const ROTATION_SNAP_DEG = 8;

export const LEGEND_LAYOUT_DEFAULT = Object.freeze({ leftPct: 68, topPct: 18, widthPct: 20, heightPct: 32, fontPx: 16, rotateDeg: 0, dwellSeconds: 8 });
const numberOr = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function clampLegendLayout(raw, fallback = LEGEND_LAYOUT_DEFAULT) {
  const src = raw && typeof raw === "object" ? raw : {};
  const base = fallback && typeof fallback === "object" ? fallback : LEGEND_LAYOUT_DEFAULT;
  const six = clampNliExplainerLayout(src, base);
  return { ...six, dwellSeconds: clamp(numberOr(src.dwellSeconds, numberOr(base.dwellSeconds, 8)), MIN_DWELL_SECONDS, MAX_DWELL_SECONDS) };
}
export function moveLegendLayout(layout, dxPct, dyPct) { const current = clampLegendLayout(layout, layout);
return clampLegendLayout({ ...current, leftPct: current.leftPct + Number(dxPct || 0), topPct: current.topPct + Number(dyPct || 0) }, current);
}
export function resizeLegendLayout(layout, dwPct, dhPct) { const current = clampLegendLayout(layout, layout);
return clampLegendLayout({ ...current, widthPct: current.widthPct + Number(dwPct || 0), heightPct: current.heightPct + Number(dhPct || 0) }, current);
}
export function rotateLegendLayout(layout, deltaDeg) { const current = clampLegendLayout(layout, layout);
return clampLegendLayout({ ...current, rotateDeg: current.rotateDeg + Number(deltaDeg || 0) }, current);
}

function cornersForLayout(layout, viewport) {
  const w = viewport.width * layout.widthPct / 100;
const h = viewport.height * layout.heightPct / 100;
  const cx = viewport.width * (layout.leftPct + layout.widthPct / 2) / 100;
const cy = viewport.height * (layout.topPct + layout.heightPct / 2) / 100;
  const rad = layout.rotateDeg * Math.PI / 180;
const cos = Math.cos(rad);
const sin = Math.sin(rad);
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => ({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos }));
}
export function layoutPixelBounds(layout, viewport) { const current = clampLegendLayout(layout, layout);
const corners = cornersForLayout(current, viewport);
const left = Math.min(...corners.map((p) => p.x));
const right = Math.max(...corners.map((p) => p.x));
const top = Math.min(...corners.map((p) => p.y));
const bottom = Math.max(...corners.map((p) => p.y));
return { left, top, right, bottom, width: right - left, height: bottom - top, corners };
}
function overlaps(a0, a1, b0, b1) { return a0 < b1 && a1 > b0;
}
export function findLegendSnap(legendBounds, clockBounds, viewport, exclusion = null) {
  if (!legendBounds || !clockBounds) return null;
  const inside = (c) => c.left >= 0 && c.top >= 0 && c.right <= viewport.width && c.bottom <= viewport.height && !(exclusion && overlaps(c.left, c.right, exclusion.left, exclusion.right) && overlaps(c.top, c.bottom, exclusion.top, exclusion.bottom));
  const candidates = [];
  if (overlaps(legendBounds.top, legendBounds.bottom, clockBounds.top, clockBounds.bottom)) for (const [edge, displacement] of [["left", clockBounds.right + SNAP_GAP_PX - legendBounds.left], ["right", clockBounds.left - SNAP_GAP_PX - legendBounds.right]]) if (Math.abs(displacement) <= SNAP_DISTANCE_PX) { const candidate = { ...legendBounds, left: legendBounds.left + displacement, right: legendBounds.right + displacement };
if (inside(candidate)) candidates.push({ axis: "x", edge, displacement });
}
  if (overlaps(legendBounds.left, legendBounds.right, clockBounds.left, clockBounds.right)) for (const [edge, displacement] of [["top", clockBounds.bottom + SNAP_GAP_PX - legendBounds.top], ["bottom", clockBounds.top - SNAP_GAP_PX - legendBounds.bottom]]) if (Math.abs(displacement) <= SNAP_DISTANCE_PX) { const candidate = { ...legendBounds, top: legendBounds.top + displacement, bottom: legendBounds.bottom + displacement };
if (inside(candidate)) candidates.push({ axis: "y", edge, displacement });
}
  return candidates.sort((a, b) => Math.abs(a.displacement) - Math.abs(b.displacement))[0] || null;
}
export function legendSpanKey(spanKey) { return spanKey === "left" || spanKey === "right" ? spanKey : "full";
}
function parentViewport(parent) { const rect = parent?.getBoundingClientRect?.();
return { width: rect?.width || document.documentElement.clientWidth || window.innerWidth, height: rect?.height || document.documentElement.clientHeight || window.innerHeight, left: rect?.left || 0, top: rect?.top || 0 };
}
function parentRect(rect, parent) { const p = parent.getBoundingClientRect?.() || { left: 0, top: 0 };
return { left: rect.left - p.left, top: rect.top - p.top, right: rect.right - p.left, bottom: rect.bottom - p.top };
}
function clockBoundsInParent(clockElement, parent) {
  if (!clockElement?.getBoundingClientRect) return null;
  const elements = [clockElement, ...Array.from(clockElement.querySelectorAll?.("*") || [])];
  const rects = elements
    .map((element) => element.getBoundingClientRect?.())
    .filter((rect) => rect && rect.right > rect.left && rect.bottom > rect.top);
  if (!rects.length) return null;
  return parentRect({
    left: Math.min(...rects.map((rect) => rect.left)),
    top: Math.min(...rects.map((rect) => rect.top)),
    right: Math.max(...rects.map((rect) => rect.right)),
    bottom: Math.max(...rects.map((rect) => rect.bottom)),
  }, parent);
}
function transformRotationDegrees(transform) {
  const value = String(transform || "").trim();
  if (!value || value === "none") return null;
  const rotate = value.match(/rotate\(\s*(-?\d+(?:\.\d+)?)deg\s*\)/i);
  if (rotate) return Number(rotate[1]);
  const matrix = value.match(/^matrix\(\s*([^)]+)\)$/i);
  if (matrix) {
    const values = matrix[1].split(",").map(Number);
    if (values.length >= 2 && values.every(Number.isFinite)) {
      return Math.atan2(values[1], values[0]) * 180 / Math.PI;
    }
  }
  const matrix3d = value.match(/^matrix3d\(\s*([^)]+)\)$/i);
  if (matrix3d) {
    const values = matrix3d[1].split(",").map(Number);
    if (values.length === 16 && values.every(Number.isFinite)) {
      return Math.atan2(values[1], values[0]) * 180 / Math.PI;
    }
  }
  return null;
}
function clockRotationDegrees(clockElement) {
  const inline = transformRotationDegrees(clockElement?.style?.transform);
  if (inline != null) return inline;
  if (typeof getComputedStyle !== "function" || !clockElement) return null;
  return transformRotationDegrees(getComputedStyle(clockElement).transform);
}
function snapRotationToClock(rotation, clockElement) {
  const clockRotation = clockRotationDegrees(clockElement);
  if (clockRotation == null) return rotation;
  const difference = ((rotation - clockRotation + 540) % 360) - 180;
  return Math.abs(difference) <= ROTATION_SNAP_DEG ? rotation - difference : rotation;
}
function overlapPixels(spanKey, config, viewport) {
  if (!config) return null;
  const outputs = config.outputs;
  if (!outputs?.left?.crop || !outputs?.left?.post || !outputs?.right?.crop || !outputs?.right?.post) return null;
  const overlap = nliExplainerOverlapPageRect(spanKey, config);
  if (!overlap) return null;
  return {
    left: viewport.width * overlap.leftPct / 100,
    top: viewport.height * overlap.topPct / 100,
    right: viewport.width * (overlap.leftPct + overlap.widthPct) / 100,
    bottom: viewport.height * (overlap.topPct + overlap.heightPct) / 100,
  };
}
export function chooseLegendInitialLayout({ spanKey = "full", viewport, clockBounds, projectionConfig } = {}) {
  const width = LEGEND_LAYOUT_DEFAULT.widthPct;
const height = LEGEND_LAYOUT_DEFAULT.heightPct;
const panel = { width: viewport.width * width / 100, height: viewport.height * height / 100 };
const exclusion = overlapPixels(legendSpanKey(spanKey), projectionConfig, viewport);
  const fits = (left, top) => left >= 0 && top >= 0 && left + panel.width <= viewport.width && top + panel.height <= viewport.height && !(exclusion && overlaps(left, left + panel.width, exclusion.left, exclusion.right) && overlaps(top, top + panel.height, exclusion.top, exclusion.bottom));
  const candidates = [];
if (clockBounds) candidates.push([clockBounds.right + 24, clockBounds.top], [clockBounds.left - 24 - panel.width, clockBounds.top], [clockBounds.left, clockBounds.bottom + 24]);
candidates.push([viewport.width - panel.width - 20, 20], [20, 20], [viewport.width - panel.width - 20, viewport.height - panel.height - 20], [20, viewport.height - panel.height - 20]);
const chosen = candidates.find(([left, top]) => fits(left, top));
  return clampLegendLayout(chosen ? { ...LEGEND_LAYOUT_DEFAULT, leftPct: chosen[0] / viewport.width * 100, topPct: chosen[1] / viewport.height * 100 } : LEGEND_LAYOUT_DEFAULT, LEGEND_LAYOUT_DEFAULT);
}
function settingsForSpan(dataContext, spanKey) { const settings = dataContext?.getLegendSettings?.() || {};
const projection = settings.projection && typeof settings.projection === "object" ? settings.projection : {};
return projection[spanKey] || null;
}
function keepRotatedBoundsVisible(layout, viewport) {
  const bounds = layoutPixelBounds(layout, viewport);
  const dx = bounds.width > viewport.width ? 0 : (bounds.left < 0 ? -bounds.left : bounds.right > viewport.width ? viewport.width - bounds.right : 0);
  const dy = bounds.height > viewport.height ? 0 : (bounds.top < 0 ? -bounds.top : bounds.bottom > viewport.height ? viewport.height - bounds.bottom : 0);
  return { layout: moveLegendLayout(layout, dx / viewport.width * 100, dy / viewport.height * 100), oversized: bounds.width > viewport.width || bounds.height > viewport.height };
}

function resizeFromPixelDelta(start, dxPx, dyPx, viewport) {
  const rad = start.rotateDeg * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const localDxPx = dxPx * cos + dyPx * sin;
  const localDyPx = -dxPx * sin + dyPx * cos;
  const resized = resizeLegendLayout(
    start,
    localDxPx / viewport.width * 100,
    localDyPx / viewport.height * 100,
  );
  const anchor = cornersForLayout(start, viewport)[0];
  const widthPx = viewport.width * resized.widthPct / 100;
  const heightPx = viewport.height * resized.heightPct / 100;
  const centerX = anchor.x + widthPx / 2 * cos - heightPx / 2 * sin;
  const centerY = anchor.y + widthPx / 2 * sin + heightPx / 2 * cos;
  return clampLegendLayout({
    ...resized,
    leftPct: (centerX - widthPx / 2) / viewport.width * 100,
    topPct: (centerY - heightPx / 2) / viewport.height * 100,
  }, resized);
}

export function installLegendLayout({ element, clockElement, dataContext, spanKey = "full", getProjectionConfig, onEditingChange } = {}) {
  if (!element || typeof document === "undefined") return null;
  const key = legendSpanKey(spanKey);
const parent = element.parentElement || document.body;
const editor = document.createElement("div");
editor.className = "legend-layout-editor";
editor.style.display = "none";
parent.appendChild(editor);
  const guide = document.createElement("div");
guide.className = "legend-layout-guide";
guide.style.cssText = "display:none;position:absolute;pointer-events:none;border:1px dashed #fbbf24;";
editor.appendChild(guide);
  const controls = document.createElement("div");
controls.className = "legend-layout-controls";
controls.innerHTML = '<label>Font <input data-legend-font type="number" min="8" max="64"></label><label>Dwell <input data-legend-dwell type="number" min="4" max="30"></label><span data-legend-warning role="alert"></span>';
editor.appendChild(controls);
  const handles = [["resize", "right:0;bottom:0;cursor:nwse-resize"], ["rotate", "left:50%;top:-18px;cursor:crosshair"]].map(([mode, position]) => { const h = document.createElement("button");
h.type = "button";
h.dataset.legendHandle = mode;
h.setAttribute("aria-label", `${mode} legend`);
h.style.cssText = `position:absolute;width:12px;height:12px;margin:-6px;${position};pointer-events:auto;display:none;background:#fbbf24;border:1px solid #18181b;border-radius:50%;`;
editor.appendChild(h);
return h;
});
  const saved = settingsForSpan(dataContext, key);
const initialViewport = parentViewport(parent);
let layout = clampLegendLayout(saved || chooseLegendInitialLayout({ spanKey: key, viewport: initialViewport, clockBounds: clockBoundsInParent(clockElement, parent), projectionConfig: getProjectionConfig?.() }), LEGEND_LAYOUT_DEFAULT);
let visible = false;
let drag = null;
let queuedSettings = null;
let pendingSave = null;
let disposed = false;
let confirmed = { ...layout };
  controls.querySelector("[data-legend-font]").value = layout.fontPx;
controls.querySelector("[data-legend-dwell]").value = layout.dwellSeconds;
  const apply = () => { element.style.left = `${layout.leftPct}%`;
element.style.top = `${layout.topPct}%`;
element.style.width = `${layout.widthPct}%`;
element.style.height = `${layout.heightPct}%`;
element.style.fontSize = `${layout.fontPx}px`;
element.style.transform = `rotate(${layout.rotateDeg}deg)`;
const viewport = parentViewport(parent);
const corners = layoutPixelBounds(layout, viewport).corners;
handles[0].style.left = `${corners[2].x / viewport.width * 100}%`;
handles[0].style.top = `${corners[2].y / viewport.height * 100}%`;
handles[1].style.left = `${(corners[0].x + corners[1].x) / 2 / viewport.width * 100}%`;
handles[1].style.top = `${(corners[0].y + corners[1].y) / 2 / viewport.height * 100}%`;
controls.querySelector("[data-legend-font]").value = layout.fontPx;
controls.querySelector("[data-legend-dwell]").value = layout.dwellSeconds;
};
  const warning = (text = "") => { controls.querySelector("[data-legend-warning]").textContent = text;
};
  const save = () => { const outgoing = { ...layout };
pendingSave = Promise.resolve(dataContext?.setLegendSettings?.({ span: key, layout: outgoing })).then((result) => { if (disposed) return;
if (result?.ok === false) throw new Error("Legend settings rejected");
confirmed = { ...outgoing };
queuedSettings = null;
layout = { ...outgoing };
apply();
}).catch((error) => { if (disposed) return;
layout = queuedSettings ? clampLegendLayout(queuedSettings, confirmed) : { ...confirmed };
confirmed = { ...layout };
queuedSettings = null;
warning(`Could not save legend placement: ${error.message || error}`);
apply();
}).finally(() => { if (!disposed) { pendingSave = null;
controls.querySelectorAll("input").forEach((input) => { input.disabled = false;
});
} });
controls.querySelectorAll("input").forEach((input) => { input.disabled = true;
});
return pendingSave;
};
  const setVisible = (next) => { visible = key !== "right" && !!next;
element.style.display = key === "right" ? "none" : "";
editor.style.display = visible ? "block" : "none";
handles.forEach((h) => { h.style.display = visible ? "block" : "none";
});
element.classList.toggle("legend-layout-editing", visible);
onEditingChange?.(visible);
apply();
};
  const pointerDown = (event) => {
    const controlTarget = event.target?.matches?.("input,select,textarea,button")
      && !event.target?.dataset?.legendHandle;
    if (disposed || !visible || controlTarget || (event.button != null && event.button !== 0)) return;

    event.preventDefault();
    const viewport = parentViewport(parent);
    const center = {
      x: viewport.width * (layout.leftPct + layout.widthPct / 2) / 100,
      y: viewport.height * (layout.topPct + layout.heightPct / 2) / 100,
    };
    const mode = event.target?.dataset?.legendHandle || "move";
    drag = {
      mode,
      x: event.clientX,
      y: event.clientY,
      start: { ...layout },
      viewport,
      startAngle: Math.atan2(
        event.clientY - viewport.top - center.y,
        event.clientX - viewport.left - center.x,
      ),
    };
    event.target?.setPointerCapture?.(event.pointerId);
    onEditingChange?.(true);
  };
  const pointerMove = (event) => {
    if (!drag || disposed) return;

    const dxPx = event.clientX - drag.x;
    const dyPx = event.clientY - drag.y;
    if (drag.mode === "resize") {
      layout = resizeFromPixelDelta(drag.start, dxPx, dyPx, drag.viewport);
    } else if (drag.mode === "rotate") {
      const centerX = drag.viewport.width * (drag.start.leftPct + drag.start.widthPct / 2) / 100;
      const centerY = drag.viewport.height * (drag.start.topPct + drag.start.heightPct / 2) / 100;
      const angle = Math.atan2(
        event.clientY - drag.viewport.top - centerY,
        event.clientX - drag.viewport.left - centerX,
      );
      layout = rotateLegendLayout(drag.start, (angle - drag.startAngle) * 180 / Math.PI);
      layout = clampLegendLayout({
        ...layout,
        rotateDeg: snapRotationToClock(layout.rotateDeg, clockElement),
      }, layout);
    } else {
      layout = moveLegendLayout(
        drag.start,
        dxPx / drag.viewport.width * 100,
        dyPx / drag.viewport.height * 100,
      );
    }

    const fitted = keepRotatedBoundsVisible(layout, drag.viewport);
    layout = fitted.layout;
    warning(fitted.oversized ? "Legend is larger than the visible projector area." : "");
    let bounds = layoutPixelBounds(layout, drag.viewport);
    const clock = clockBoundsInParent(clockElement, parent);
    const snap = findLegendSnap(
      bounds,
      clock,
      drag.viewport,
      overlapPixels(key, getProjectionConfig?.(), drag.viewport),
    );
    if (snap && drag.mode === "move") {
      layout = moveLegendLayout(
        layout,
        snap.axis === "x" ? snap.displacement / drag.viewport.width * 100 : 0,
        snap.axis === "y" ? snap.displacement / drag.viewport.height * 100 : 0,
      );
      bounds = layoutPixelBounds(layout, drag.viewport);
    }
    guide.style.display = snap ? "block" : "none";
    if (snap) {
      const pendingDisplacement = drag.mode === "move" ? 0 : snap.displacement;
      guide.style.left = `${(snap.axis === "x" ? bounds.left + pendingDisplacement : bounds.left) / drag.viewport.width * 100}%`;
      guide.style.top = `${(snap.axis === "y" ? bounds.top + pendingDisplacement : bounds.top) / drag.viewport.height * 100}%`;
      guide.style.width = `${bounds.width / drag.viewport.width * 100}%`;
      guide.style.height = `${bounds.height / drag.viewport.height * 100}%`;
    }
    apply();
  };
  const finishPointer = async (cancelled = false) => {
    if (!drag || disposed) return;

    const active = drag;
    drag = null;
    guide.style.display = "none";
    if (cancelled) {
      layout = queuedSettings ? clampLegendLayout(queuedSettings, active.start) : active.start;
      if (queuedSettings) confirmed = { ...layout };
      queuedSettings = null;
      apply();
      return;
    }

    const bounds = layoutPixelBounds(layout, active.viewport);
    const clock = clockBoundsInParent(clockElement, parent);
    const snap = findLegendSnap(
      bounds,
      clock,
      active.viewport,
      overlapPixels(key, getProjectionConfig?.(), active.viewport),
    );
    if (snap) {
      layout = moveLegendLayout(
        layout,
        snap.axis === "x" ? snap.displacement / active.viewport.width * 100 : 0,
        snap.axis === "y" ? snap.displacement / active.viewport.height * 100 : 0,
      );
    }
    apply();
    await save();
  };
  const pointerUp = () => {
    void finishPointer(false);
  };
  const pointerCancel = () => {
    void finishPointer(true);
  };
const onFontChange = (event) => { layout = clampLegendLayout({ ...layout, fontPx: event.target.value }, layout);
apply();
void save();
};
const onDwellChange = (event) => { layout = clampLegendLayout({ ...layout, dwellSeconds: event.target.value }, layout);
apply();
void save();
};
  const applyServerSettings = (next) => { if (drag || pendingSave) queuedSettings = next;
else { layout = clampLegendLayout(next, layout);
confirmed = { ...layout };
apply();
} };
  element.addEventListener("pointerdown", pointerDown);
editor.addEventListener("pointerdown", pointerDown);
window.addEventListener("pointermove", pointerMove);
window.addEventListener("pointerup", pointerUp);
window.addEventListener("pointercancel", pointerCancel);
controls.querySelector("[data-legend-font]").addEventListener("change", onFontChange);
controls.querySelector("[data-legend-dwell]").addEventListener("change", onDwellChange);
if (key === "right") element.style.display = "none";
if (!saved) {
  const bounds = layoutPixelBounds(layout, initialViewport);
  const exclusion = overlapPixels(key, getProjectionConfig?.(), initialViewport);
  const outside = bounds.left < 0 || bounds.top < 0 || bounds.right > initialViewport.width || bounds.bottom > initialViewport.height;
  const excluded = exclusion && overlaps(bounds.left, bounds.right, exclusion.left, exclusion.right) && overlaps(bounds.top, bounds.bottom, exclusion.top, exclusion.bottom);
  if (outside || excluded) warning("No automatic legend placement fits; place it manually.");
}
apply();
  return { setVisible, dispose() { disposed = true;
if (drag) { layout = drag.start;
drag = null;
} element.removeEventListener("pointerdown", pointerDown);
editor.removeEventListener("pointerdown", pointerDown);
window.removeEventListener("pointermove", pointerMove);
window.removeEventListener("pointerup", pointerUp);
window.removeEventListener("pointercancel", pointerCancel);
controls.querySelector("[data-legend-font]").removeEventListener("change", onFontChange);
controls.querySelector("[data-legend-dwell]").removeEventListener("change", onDwellChange);
editor.remove();
}, applyServerSettings, getLayout() { return { ...layout };
} };
}
