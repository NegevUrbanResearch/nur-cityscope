import { NLI_NOVA_STORY } from "./nli-nova-story.js";

const STORY_ID_KEYS = new Set();
const CANONICAL_ID = /^[1-9][0-9]*$/;
const MAX_ENTRIES = 32;

export const NOVA_EXPLAINER_OBJECT_IDS = Object.freeze([...new Set(
  NLI_NOVA_STORY.beats.flatMap((beat) => beat.polygonObjectIds),
)]);

for (const id of NOVA_EXPLAINER_OBJECT_IDS) STORY_ID_KEYS.add(String(id));

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampPercent(value) {
  return Math.min(100, Math.max(0, value));
}

function normalizeCamera(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (Object.keys(out).length >= MAX_ENTRIES) break;
    if (!CANONICAL_ID.test(key) || !STORY_ID_KEYS.has(key)) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    if (Object.keys(value).length !== 2 || !Object.hasOwn(value, "leftPct") || !Object.hasOwn(value, "topPct")) continue;
    const leftPct = finiteNumber(value.leftPct);
    const topPct = finiteNumber(value.topPct);
    if (leftPct === null || topPct === null) continue;
    out[key] = { leftPct: clampPercent(leftPct), topPct: clampPercent(topPct) };
  }
  return out;
}

export function normalizeNovaExplainerMaps(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return { close: normalizeCamera(src.close), wide: normalizeCamera(src.wide) };
}

export function novaExplainerCamera(state = {}) {
  if (state.phase === "ended") return "wide";
  const beat = finiteNumber(state.novaBeatIndex);
  if (beat !== null && beat >= 3) return "wide";
  return "close";
}

function ringCenter(ring) {
  if (!Array.isArray(ring) || ring.length === 0) return null;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const position of ring) {
    if (!Array.isArray(position) || position.length < 2) return null;
    const lng = finiteNumber(position[0]);
    const lat = finiteNumber(position[1]);
    if (lng === null || lat === null) return null;
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
}

export function polygonAnchorLngLat(feature) {
  const geometry = feature && typeof feature === "object" ? feature.geometry : null;
  if (!geometry || typeof geometry !== "object") return null;
  const coordinates = geometry.coordinates;
  if (geometry.type === "Polygon") return ringCenter(Array.isArray(coordinates) ? coordinates[0] : null);
  if (geometry.type === "MultiPolygon") {
    const first = Array.isArray(coordinates) ? coordinates[0] : null;
    return ringCenter(Array.isArray(first) ? first[0] : null);
  }
  if (geometry.type === "Point") {
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
    const lng = finiteNumber(coordinates[0]);
    const lat = finiteNumber(coordinates[1]);
    if (lng === null || lat === null) return null;
    return [lng, lat];
  }
  return null;
}

function clampAxis(position, size, container) {
  const pos = finiteNumber(position);
  const extent = finiteNumber(size);
  const limitBase = finiteNumber(container);
  if (pos === null || extent === null || limitBase === null) return 0;
  const room = limitBase - extent - 4;
  if (room < 4) return 0;
  return Math.min(room, Math.max(4, pos));
}

export function clampCardBox({ left, top, width, height, containerWidth, containerHeight } = {}) {
  return {
    left: clampAxis(left, width, containerWidth),
    top: clampAxis(top, height, containerHeight),
  };
}
