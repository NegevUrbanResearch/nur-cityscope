export const SLIDESHOW_CHANNEL_NAME = "otef-projection-slideshow";

const ALLOWED_TYPES = new Set(["start", "stop"]);

/**
 * @typedef {{
 *   type: "start" | "stop",
 *   payload?: Record<string, unknown>
 * }} SlideshowProjectionMessage
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObjectRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function sanitizeOptionalNumber(value) {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new TypeError("Slideshow payload numeric fields must be finite numbers");
  }
  return Math.max(0, n);
}

/**
 * @param {unknown} payload
 * @returns {Record<string, unknown>}
 */
function sanitizeStartPayload(payload) {
  if (payload == null) return {};
  if (!isObjectRecord(payload)) {
    throw new TypeError("Slideshow start payload must be an object");
  }
  const out = {};

  if (Object.prototype.hasOwnProperty.call(payload, "packOrder")) {
    const raw = payload.packOrder;
    if (!Array.isArray(raw)) {
      throw new TypeError("packOrder must be an array of pack ids");
    }
    out.packOrder = raw.map((item) => String(item));
  }

  const intervalMs = sanitizeOptionalNumber(payload.intervalMs);
  if (intervalMs !== undefined) out.intervalMs = intervalMs;

  const crossfadeMs = sanitizeOptionalNumber(payload.crossfadeMs);
  if (crossfadeMs !== undefined) out.crossfadeMs = crossfadeMs;

  const warmupLeadMs = sanitizeOptionalNumber(payload.warmupLeadMs);
  if (warmupLeadMs !== undefined) out.warmupLeadMs = warmupLeadMs;

  return out;
}

/**
 * @param {unknown} message
 * @returns {SlideshowProjectionMessage}
 */
function normalizeMessage(message) {
  if (!isObjectRecord(message)) {
    throw new TypeError("Slideshow message must be an object");
  }
  const type = String(message.type || "");
  if (!ALLOWED_TYPES.has(type)) {
    throw new TypeError(`Unsupported slideshow message type: ${type}`);
  }
  const payload = type === "start" ? sanitizeStartPayload(message.payload) : {};
  return { type, payload };
}

/**
 * Same-tab / same-origin fallback: BroadcastChannel only (no cross-device sync).
 *
 * @param {unknown} message
 */
export function postSlideshowBroadcastOnly(message) {
  if (typeof BroadcastChannel === "undefined") {
    return;
  }
  const normalized = normalizeMessage(message);
  const channel = new BroadcastChannel(SLIDESHOW_CHANNEL_NAME);
  try {
    channel.postMessage(normalized);
  } finally {
    channel.close();
  }
}

/**
 * Post one slideshow command to the shared projection channel.
 *
 * @param {unknown} message
 */
export function slideshowPost(message) {
  postSlideshowBroadcastOnly(message);
}

/**
 * Subscribe to slideshow commands.
 *
 * @param {(message: SlideshowProjectionMessage) => void} handler
 * @returns {() => void}
 */
export function subscribeSlideshowProjection(handler) {
  if (typeof handler !== "function") {
    throw new TypeError("subscribeSlideshowProjection handler must be a function");
  }
  if (typeof BroadcastChannel === "undefined") {
    return () => {};
  }

  const channel = new BroadcastChannel(SLIDESHOW_CHANNEL_NAME);
  channel.onmessage = (event) => {
    let parsed = null;
    try {
      parsed = normalizeMessage(event?.data);
    } catch {
      return;
    }
    handler(parsed);
  };

  return () => {
    channel.onmessage = null;
    channel.close();
  };
}

export {
  normalizeMessage as normalizeSlideshowProjectionMessage,
};
