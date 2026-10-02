/**
 * Projection-page NLI explainer overlay (host + layout). No MapLibre.
 * Screen-space box on #displayContainer; uniform rotate only (no skew / scale).
 */

import { MapProjectionConfig } from "../shared/map-projection-config.js";
import { getNliNarrative } from "../shared/nli-narratives.js";
import { normalizeNovaExplainerMaps } from "../shared/nli-nova-explainer-layout.js";
import { parseProjectionSpanId } from "./projection-span-view.js";

export const NLI_GIS_CLOCK_DEFAULT_LAYOUT = {
  leftPct: 30,
  topPct: 88,
  widthPct: 40,
  heightPct: 8,
  fontPx: 22,
  rotateDeg: 0,
};

const SPAN_KEYS = ["full", "left", "right"];
const HOST_FONT_FAMILY =
  '"Guttman Hatzvi", "Noto Sans Hebrew", "Noto Sans", Arial, sans-serif';

export function nliExplainerSpanKey(search) {
  return parseProjectionSpanId(search) || "full";
}

/** Dual-span: only the left projector paints the table slot (right uses a different crop). */
export function nliExplainerShouldPaintOnSpan(spanKey) {
  return spanKey === "left";
}

export function applyNliExplainerHostPresence(hostEl, spanKey) {
  if (!hostEl) return;
  if (!hostEl.style) hostEl.style = {};
  hostEl.style.display = nliExplainerShouldPaintOnSpan(spanKey) ? "" : "none";
}


function pickFinite(rawVal, fallbackVal, missingZero = false) {
  const n = Number(rawVal);
  if (Number.isFinite(n)) return n;
  if (missingZero) return 0;
  const f = Number(fallbackVal);
  return Number.isFinite(f) ? f : 0;
}

function clampNum(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function clampNliExplainerLayout(raw, fallback) {
  const src = raw && typeof raw === "object" ? raw : {};
  const fb = fallback && typeof fallback === "object" ? fallback : {};
  const widthPct = clampNum(pickFinite(src.widthPct, fb.widthPct), 2, 100);
  const heightPct = clampNum(pickFinite(src.heightPct, fb.heightPct), 2, 100);
  const leftPct = clampNum(pickFinite(src.leftPct, fb.leftPct), 0, 100 - widthPct);
  const topPct = clampNum(pickFinite(src.topPct, fb.topPct), 0, 100 - heightPct);
  const fontPx = clampNum(pickFinite(src.fontPx, fb.fontPx), 8, 64);
  const rotateMissing = src.rotateDeg === undefined || src.rotateDeg === null || src.rotateDeg === "";
  const rotateDeg = clampNum(pickFinite(src.rotateDeg, fb.rotateDeg, rotateMissing), -180, 180);
  return { leftPct, topPct, widthPct, heightPct, fontPx, rotateDeg };
}

export function mergeNliExplainerLayout(spanKey, storedMap, defaults) {
  const key = spanKey === "left" || spanKey === "right" ? spanKey : "full";
  const base = (defaults && defaults[key]) || {};
  const stored =
    storedMap && typeof storedMap === "object" && storedMap[key] && typeof storedMap[key] === "object"
      ? storedMap[key]
      : null;
  return clampNliExplainerLayout(stored ? { ...base, ...stored } : base, base);
}

export function readNliExplainerLayoutStore(rawJson) {
  if (rawJson == null || rawJson === "") return {};
  try {
    const parsed = typeof rawJson === "string" ? JSON.parse(rawJson) : rawJson;
    if (parsed == null || Array.isArray(parsed) || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function isFlatGisClockLayout(value) {
  return value
    && typeof value === "object"
    && !Array.isArray(value)
    && Number.isFinite(Number(value.leftPct));
}

export function gisClockLayoutSlotId(narrativeId) {
  if (narrativeId == null || narrativeId === "") return "start";
  if (narrativeId === "segev" || narrativeId === "nova") return narrativeId;
  return getNliNarrative(narrativeId) ? narrativeId : "start";
}

export function readGisClockLayoutStore(rawJson) {
  const parsed = readNliExplainerLayoutStore(rawJson);
  if (!parsed || typeof parsed !== "object") return {};
  if (isFlatGisClockLayout(parsed)) {
    return { start: clampNliExplainerLayout(parsed, NLI_GIS_CLOCK_DEFAULT_LAYOUT) };
  }
  const out = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    out[key] = clampNliExplainerLayout(value, NLI_GIS_CLOCK_DEFAULT_LAYOUT);
  }
  return out;
}

export function mergeGisClockLayout(slotId, storedMap, defaultLayout) {
  const key = typeof slotId === "string" && slotId ? slotId : "start";
  const stored = storedMap && typeof storedMap === "object" ? storedMap[key] : null;
  return clampNliExplainerLayout(stored || defaultLayout, defaultLayout);
}

export function serializeGisClockLayoutMap(map) {
  const src = map && typeof map === "object" ? map : {};
  const out = {};
  for (const [key, value] of Object.entries(src)) {
    out[key] = clampNliExplainerLayout(value, NLI_GIS_CLOCK_DEFAULT_LAYOUT);
  }
  return JSON.stringify(out);
}

export function normalizeProjectionClockLayout(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const key of SPAN_KEYS) {
    if (src[key] && typeof src[key] === "object" && !Array.isArray(src[key])) {
      out[key] = clampNliExplainerLayout(src[key], src[key]);
    }
  }
  return out;
}

export function emptyNliClockLayout() {
  return {
    gis: {},
    projection: {},
    gisOverlays: { novaExplainers: { close: {}, wide: {} } },
  };
}

export function normalizeNliClockLayout(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const overlays = src.gisOverlays && typeof src.gisOverlays === "object" && !Array.isArray(src.gisOverlays)
    ? src.gisOverlays
    : {};
  return {
    gis: readGisClockLayoutStore(src.gis),
    projection: normalizeProjectionClockLayout(src.projection),
    gisOverlays: { novaExplainers: normalizeNovaExplainerMaps(overlays.novaExplainers) },
  };
}

export function applyNliExplainerLayout(hostEl, layout) {
  if (!hostEl) return;
  if (!hostEl.style) hostEl.style = {};
  const box = clampNliExplainerLayout(layout, layout);
  hostEl.style.left = `${box.leftPct}%`;
  hostEl.style.top = `${box.topPct}%`;
  hostEl.style.width = `${box.widthPct}%`;
  hostEl.style.height = `${box.heightPct}%`;
  hostEl.style.fontSize = `${box.fontPx}px`;
  hostEl.style.transform = `rotate(${box.rotateDeg}deg)`;
  hostEl.style.transformOrigin = "center center";
  hostEl.style.fontFamily = HOST_FONT_FAMILY;
}

export function ensureNliExplainerHost(displayContainer, options = {}) {
  const hostId = options.hostId || "nliExplainerHost";
  let host = displayContainer?.querySelector?.(`#${hostId}`) || null;
  if (!host) {
    host = document.createElement("div");
    host.id = hostId;
    if (!host.style) host.style = {};
    displayContainer.appendChild(host);
  }
  let captionEl =
    typeof host.querySelector === "function" ? host.querySelector(".nli-investigation-timeline-caption") : null;
  if (!captionEl) {
    captionEl = document.createElement("div");
    captionEl.className = "nli-investigation-timeline-caption";
    host.appendChild(captionEl);
  }
  return { host, captionEl };
}

function nliExplainerCaptionComputedStyle(captionEl) {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") return null;
  return window.getComputedStyle(captionEl);
}

function applyNliExplainerMeasureCloneLayout(captionEl, clone) {
  if (!clone.style) clone.style = {};
  const liveStyle = nliExplainerCaptionComputedStyle(captionEl);
  const boxSizing = liveStyle?.boxSizing === "content-box" ? "border-box" : liveStyle?.boxSizing || "border-box";
  clone.style.boxSizing = boxSizing;
  if (liveStyle) {
    clone.style.paddingTop = liveStyle.paddingTop;
    clone.style.paddingRight = liveStyle.paddingRight;
    clone.style.paddingBottom = liveStyle.paddingBottom;
    clone.style.paddingLeft = liveStyle.paddingLeft;
    clone.style.fontSize = liveStyle.fontSize;
    clone.style.fontFamily = liveStyle.fontFamily;
    clone.style.lineHeight = liveStyle.lineHeight;
    clone.style.letterSpacing = liveStyle.letterSpacing;
  }
  const clientWidth = Number(captionEl.clientWidth) || 0;
  if (boxSizing === "border-box") {
    clone.style.width = `${clientWidth}px`;
  } else {
    const padL = liveStyle ? Number.parseFloat(liveStyle.paddingLeft) || 0 : 0;
    const padR = liveStyle ? Number.parseFloat(liveStyle.paddingRight) || 0 : 0;
    clone.style.width = `${Math.max(0, clientWidth - padL - padR)}px`;
  }
}

export function measureNliExplainerUnclampedHeight(captionEl) {
  if (!captionEl || typeof captionEl.cloneNode !== "function") return 0;
  const clone = captionEl.cloneNode(true);
  if (!clone.style) clone.style = {};
  clone.style.height = "auto";
  applyNliExplainerMeasureCloneLayout(captionEl, clone);
  clone.style.webkitLineClamp = "unset";
  clone.style.textOverflow = "clip";
  clone.style.overflow = "visible";
  captionEl.parentNode?.appendChild?.(clone);
  const height = Number(clone.scrollHeight) || 0;
  if (typeof clone.remove === "function") clone.remove();
  return height;
}

export function nliExplainerContentOverflows(captionEl) {
  if (!captionEl) return false;
  return measureNliExplainerUnclampedHeight(captionEl) > captionEl.clientHeight;
}

export function serializeNliExplainerLayoutMap(map) {
  const defaults = MapProjectionConfig.NLI_EXPLAINER_LAYOUT;
  const src = map && typeof map === "object" ? map : {};
  const out = {};
  for (const key of SPAN_KEYS) {
    out[key] = clampNliExplainerLayout(src[key], defaults[key] || defaults.full);
  }
  return JSON.stringify(out);
}
