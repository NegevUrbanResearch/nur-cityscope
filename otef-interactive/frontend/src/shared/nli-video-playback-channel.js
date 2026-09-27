import { createUuid } from "./uuid.js";

const CHANNEL_NAME = "otef-nli-video-playback-v1";
const HEARTBEAT_MS = 1000;
const LEASE_MS = 6000;

function usableTable(table) {
  return typeof table === "string" && table.length > 0 && table.length <= 128;
}

function openChannel(BroadcastChannelImpl, warn) {
  if (typeof BroadcastChannelImpl !== "function") {
    warn?.("NLI video playback sync is unavailable; browser projection cadence will remain unrestricted");
    return null;
  }
  try {
    return new BroadcastChannelImpl(CHANNEL_NAME);
  } catch (error) {
    warn?.("NLI video playback sync could not open BroadcastChannel", error);
    return null;
  }
}

export function createNliVideoPlaybackPublisher({
  table,
  BroadcastChannelImpl = globalThis.BroadcastChannel,
  setIntervalImpl = globalThis.setInterval,
  clearIntervalImpl = globalThis.clearInterval,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  warn = (...args) => console.warn(...args),
  sourceId = createUuid(),
} = {}) {
  if (!usableTable(table)) throw new TypeError("table must be a nonempty string");
  const channel = openChannel(BroadcastChannelImpl, warn);
  let active = false;
  let sequence = 0;
  let disposed = false;
  let heartbeat = null;
  let pageHidden = false;

  const send = (nextActive = active) => {
    if (!channel || disposed) return false;
    sequence += 1;
    try {
      channel.postMessage({ type: "state", table, sourceId, sequence, active: nextActive && !pageHidden });
      return true;
    } catch (error) {
      warn?.("NLI video playback state could not be published", error);
      return false;
    }
  };
  const startHeartbeat = () => {
    if (heartbeat !== null || !channel || disposed || pageHidden) return;
    heartbeat = setIntervalImpl(() => send(true), HEARTBEAT_MS);
  };
  const stopHeartbeat = () => {
    if (heartbeat === null) return;
    clearIntervalImpl(heartbeat);
    heartbeat = null;
  };
  const setActive = (value) => {
    if (typeof value !== "boolean" || disposed || value === active) return;
    active = value;
    send(active);
    if (active) startHeartbeat();
    else stopHeartbeat();
  };
  const onMessage = (event) => {
    const message = event?.data;
    if (!message || typeof message !== "object" || message.type !== "query" || message.table !== table) return;
    send(active);
  };
  const onVisible = () => {
    if (documentRef?.visibilityState === "visible" && active) send(true);
  };
  const onPageHide = () => {
    pageHidden = true;
    if (active) send(false);
    stopHeartbeat();
  };
  const onPageShow = () => {
    pageHidden = false;
    if (active) { send(true); startHeartbeat(); }
  };

  if (typeof channel?.addEventListener === "function") channel.addEventListener("message", onMessage);
  else if (channel) channel.onmessage = onMessage;
  documentRef?.addEventListener?.("visibilitychange", onVisible);
  windowRef?.addEventListener?.("pagehide", onPageHide);
  windowRef?.addEventListener?.("pageshow", onPageShow);

  return {
    setActive,
    dispose() {
      if (disposed) return;
      if (active) {
        active = false;
        send(false);
      }
      disposed = true;
      stopHeartbeat();
      if (typeof channel?.removeEventListener === "function") channel.removeEventListener("message", onMessage);
      else if (channel) channel.onmessage = null;
      documentRef?.removeEventListener?.("visibilitychange", onVisible);
      windowRef?.removeEventListener?.("pagehide", onPageHide);
      windowRef?.removeEventListener?.("pageshow", onPageShow);
      channel?.close?.();
    },
  };
}

export function subscribeNliVideoPlayback({
  table,
  onChange = () => {},
  BroadcastChannelImpl = globalThis.BroadcastChannel,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  warn = (...args) => console.warn(...args),
  requesterId = createUuid(),
} = {}) {
  if (!usableTable(table)) throw new TypeError("table must be a nonempty string");
  if (typeof onChange !== "function") throw new TypeError("onChange must be a function");
  const channel = openChannel(BroadcastChannelImpl, warn);
  if (!channel) return () => {};

  const sources = new Map();
  let disposed = false;
  let expiryTimer = null;
  let wasActive = false;
  const isActive = () => {
    const currentTime = now();
    for (const state of sources.values()) {
      if (state.active && state.expiresAt > currentTime) return true;
    }
    return false;
  };
  const reportChange = () => {
    const active = isActive();
    if (active === wasActive) return;
    wasActive = active;
    onChange(active);
  };
  const scheduleExpiry = () => {
    if (expiryTimer !== null) clearTimeoutImpl(expiryTimer);
    expiryTimer = null;
    if (disposed) return;
    const deadlines = [...sources.values()]
      .filter((state) => state.active && state.expiresAt > now())
      .map((state) => state.expiresAt);
    if (!deadlines.length) return;
    const delay = Math.max(0, Math.min(...deadlines) - now());
    expiryTimer = setTimeoutImpl(() => {
      expiryTimer = null;
      const currentTime = now();
      for (const state of sources.values()) {
        if (state.active && state.expiresAt <= currentTime) state.active = false;
      }
      reportChange();
      scheduleExpiry();
    }, delay);
  };
  const onMessage = (event) => {
    const message = event?.data;
    if (!message || typeof message !== "object" || Array.isArray(message) || message.table !== table) return;
    if (message.type === "state") {
      if (typeof message.sourceId !== "string" || !message.sourceId || message.sourceId.length > 128 ||
          !Number.isSafeInteger(message.sequence) || message.sequence <= 0 || typeof message.active !== "boolean") return;
      const prior = sources.get(message.sourceId);
      if (prior && message.sequence <= prior.sequence) return;
      sources.set(message.sourceId, {
        sequence: message.sequence,
        active: message.active,
        expiresAt: message.active ? now() + LEASE_MS : 0,
      });
      reportChange();
      scheduleExpiry();
      return;
    }
  };

  if (typeof channel.addEventListener === "function") channel.addEventListener("message", onMessage);
  else channel.onmessage = onMessage;
  channel.postMessage({ type: "query", table, requesterId });
  return () => {
    if (disposed) return;
    disposed = true;
    if (expiryTimer !== null) clearTimeoutImpl(expiryTimer);
    if (typeof channel.removeEventListener === "function") channel.removeEventListener("message", onMessage);
    else channel.onmessage = null;
    channel.close?.();
    sources.clear();
  };
}
