import { NLI_VISUAL_TOKENS } from "./nli-investigation-theme.js";

const RGB_COLOR = /^#[0-9a-f]{6}$/i;
const STATIC_FALLBACK = Object.freeze({ color: "#000000", opacity: 0 });

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function finiteNumber(value) {
  try {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  } catch {
    return null;
  }
}

function validColor(value) {
  return typeof value === "string" && RGB_COLOR.test(value);
}

function validBand(value) {
  return value && typeof value === "object" && Number.isInteger(value.ordinal) &&
    value.ordinal >= 0 && validColor(value.color) &&
    finiteNumber(value.opacity) !== null;
}

function authoredPaint(band) {
  if (!band || typeof band !== "object") return STATIC_FALLBACK;
  return { color: band.color, opacity: band.opacity };
}

function parseRgb(color) {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function rgbHex(rgb) {
  return `#${rgb.map((channel) => Math.round(channel)
    .toString(16).padStart(2, "0")).join("")}`;
}

function interpolatedPaint(from, to, amount) {
  const fromRgb = parseRgb(from.color);
  const toRgb = parseRgb(to.color);
  return {
    color: rgbHex(fromRgb.map((channel, index) => (
      channel + (toRgb[index] - channel) * amount
    ))),
    opacity: Number(from.opacity) +
      (Number(to.opacity) - Number(from.opacity)) * amount,
  };
}

/** Return the shared, nonnegative position within a conveyor cycle. */
export function polygonGradientPhase(
  nowMs,
  cycleMs,
) {
  if (arguments.length < 2) cycleMs = NLI_VISUAL_TOKENS.polygonGradientCycleMs;
  if (nowMs == null || cycleMs == null) return null;
  const now = finiteNumber(nowMs);
  const cycle = finiteNumber(cycleMs);
  if (now === null || now < 0 || cycle === null || cycle <= 0) {
    return null;
  }
  return (now % cycle) / cycle;
}

/** Resolve one authored band to its cyclic, inward-moving conveyor paint. */
export function polygonGradientBandPaint(bands, ordinal, phase, options = {}) {
  if (!Array.isArray(bands) || bands.length === 0 ||
      !Number.isInteger(ordinal) || ordinal < 0 || ordinal >= bands.length) {
    return { ...STATIC_FALLBACK };
  }
  const current = bands[ordinal];
  if (!validBand(current)) return authoredPaint(current);
  if (bands.length < 2 || phase == null ||
      options?.reducedMotion === true || options?.motionMode === "reduced") {
    return authoredPaint(current);
  }
  const normalizedPhase = Number(phase);
  if (!Number.isFinite(normalizedPhase)) return authoredPaint(current);
  for (let index = 0; index < bands.length; index += 1) {
    if (!validBand(bands[index])) return authoredPaint(current);
  }

  const cyclePhase = normalizedPhase - Math.floor(normalizedPhase);
  const cycleDistance = cyclePhase * bands.length;
  const step = Math.floor(cycleDistance);
  const interpolation = cycleDistance - step;
  const fromOrdinal = (ordinal - step + bands.length) % bands.length;
  const toOrdinal = (fromOrdinal - 1 + bands.length) % bands.length;
  return interpolatedPaint(bands[fromOrdinal], bands[toOrdinal], interpolation);
}

/** Return the outside-to-inside entry reveal factor for one authored band. */
export function polygonEntryBandFactor(ordinal, bandCount, progress) {
  const index = finiteNumber(ordinal);
  const count = finiteNumber(bandCount);
  const value = finiteNumber(progress);
  if (index === null || !Number.isInteger(index) || index < 0 || count === null ||
      !Number.isInteger(count) || count <= 0 || index >= count || value === null) return 0;
  return smoothstep(clamp01(value * count - index));
}
