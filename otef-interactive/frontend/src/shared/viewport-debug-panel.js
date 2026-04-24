const DEBUG_FLAG_QUERY_PARAM = "viewportDebug";
const DEBUG_FLAG_STORAGE_KEY = "otef.viewportDebug";
const DEFAULT_MAX_EVENTS = 400;

function parseDebugFlagValue(value) {
  if (value == null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "1" || normalized === "true" || normalized === "on") return true;
  if (normalized === "0" || normalized === "false" || normalized === "off") return false;
  return null;
}

function getUrlDebugFlag() {
  if (typeof window === "undefined" || !window.location) return null;
  const params = new URLSearchParams(window.location.search || "");
  return parseDebugFlagValue(params.get(DEBUG_FLAG_QUERY_PARAM));
}

function getStoredDebugFlag() {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return null;
  try {
    return parseDebugFlagValue(window.localStorage.getItem(DEBUG_FLAG_STORAGE_KEY));
  } catch (_) {
    return null;
  }
}

function setStoredDebugFlag(enabled) {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  try {
    if (enabled) {
      window.localStorage.setItem(DEBUG_FLAG_STORAGE_KEY, "1");
    } else {
      window.localStorage.setItem(DEBUG_FLAG_STORAGE_KEY, "0");
    }
  } catch (_) {
    // Ignore storage write failures (private mode / policy restrictions).
  }
}

export function isViewportDebugEnabled() {
  const urlFlag = getUrlDebugFlag();
  if (urlFlag != null) {
    setStoredDebugFlag(urlFlag);
    return urlFlag;
  }
  const storedFlag = getStoredDebugFlag();
  return storedFlag === true;
}

function noOpPanel() {
  return {
    enabled: false,
    log: () => {},
    clear: () => {},
    destroy: () => {},
  };
}

function safeNumber(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function normalizeCorner(corner) {
  if (!corner || typeof corner !== "object") return null;
  const x = safeNumber(corner.x);
  const y = safeNumber(corner.y);
  if (x == null || y == null) return null;
  return { x, y };
}

function normalizeViewport(viewport) {
  if (!viewport || typeof viewport !== "object") return null;
  const normalized = {};

  if (Number.isFinite(viewport.seq)) normalized.seq = viewport.seq;
  if (typeof viewport.source === "string" && viewport.source.trim()) {
    normalized.source = viewport.source;
  }
  if (viewport.updatedAt != null) {
    normalized.updatedAt = viewport.updatedAt;
  }

  if (Array.isArray(viewport.bbox) && viewport.bbox.length === 4) {
    normalized.bbox = viewport.bbox.map((value) => safeNumber(value, 2));
  }
  if (Number.isFinite(viewport.zoom)) {
    normalized.zoom = safeNumber(viewport.zoom, 4);
  }

  if (viewport.corners && typeof viewport.corners === "object") {
    const corners = {
      sw: normalizeCorner(viewport.corners.sw),
      se: normalizeCorner(viewport.corners.se),
      nw: normalizeCorner(viewport.corners.nw),
      ne: normalizeCorner(viewport.corners.ne),
    };
    if (corners.sw || corners.se || corners.nw || corners.ne) {
      normalized.corners = corners;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

export function captureElementMetrics(el) {
  if (!el || typeof el.getBoundingClientRect !== "function") return null;
  const rect = el.getBoundingClientRect();
  return {
    width: safeNumber(rect.width, 2),
    height: safeNumber(rect.height, 2),
    left: safeNumber(rect.left, 2),
    top: safeNumber(rect.top, 2),
    clientWidth: Number.isFinite(el.clientWidth) ? el.clientWidth : null,
    clientHeight: Number.isFinite(el.clientHeight) ? el.clientHeight : null,
  };
}

export function captureMapSnapshot(map) {
  if (!map) return null;
  const snapshot = {};
  if (typeof map.getBounds === "function") {
    const bounds = map.getBounds();
    if (bounds) {
      snapshot.bounds = {
        west: safeNumber(bounds.getWest(), 6),
        south: safeNumber(bounds.getSouth(), 6),
        east: safeNumber(bounds.getEast(), 6),
        north: safeNumber(bounds.getNorth(), 6),
      };
    }
  }
  if (typeof map.getCenter === "function") {
    const center = map.getCenter();
    if (center) {
      snapshot.center = {
        lng: safeNumber(center.lng, 6),
        lat: safeNumber(center.lat, 6),
      };
    }
  }
  if (typeof map.getZoom === "function") {
    snapshot.zoom = safeNumber(map.getZoom(), 4);
  }
  if (typeof map.getContainer === "function") {
    snapshot.mapContainer = captureElementMetrics(map.getContainer());
  }
  return Object.keys(snapshot).length > 0 ? snapshot : null;
}

function copyWithFallback(text, textarea) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  if (!textarea || typeof textarea.focus !== "function" || typeof textarea.select !== "function") {
    return Promise.reject(new Error("clipboard_unavailable"));
  }
  textarea.focus();
  textarea.select();
  const succeeded = typeof document !== "undefined" && document.execCommand("copy");
  return succeeded ? Promise.resolve() : Promise.reject(new Error("clipboard_copy_failed"));
}

export function createViewportDebugPanel({
  pageId,
  maxEvents = DEFAULT_MAX_EVENTS,
  title = "Viewport Debug",
} = {}) {
  if (!isViewportDebugEnabled() || typeof document === "undefined") {
    return noOpPanel();
  }

  const events = [];
  let collapsed = true;

  const root = document.createElement("section");
  root.style.position = "fixed";
  root.style.right = "10px";
  root.style.bottom = "10px";
  root.style.width = "360px";
  root.style.maxWidth = "calc(100vw - 20px)";
  root.style.maxHeight = "48vh";
  root.style.zIndex = "99999";
  root.style.background = "rgba(0, 0, 0, 0.84)";
  root.style.color = "#e6e8ee";
  root.style.border = "1px solid rgba(255,255,255,0.20)";
  root.style.borderRadius = "8px";
  root.style.font = "12px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  root.style.boxShadow = "0 6px 14px rgba(0,0,0,0.32)";
  root.style.pointerEvents = "auto";

  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.gap = "6px";
  header.style.padding = "6px 8px";
  header.style.borderBottom = "1px solid rgba(255,255,255,0.16)";

  const titleEl = document.createElement("strong");
  titleEl.textContent = `${title} (${pageId || "unknown"})`;
  titleEl.style.flex = "1";
  titleEl.style.fontWeight = "600";

  const countEl = document.createElement("span");
  countEl.textContent = "0";
  countEl.style.opacity = "0.8";

  const makeButton = (label) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.padding = "2px 6px";
    button.style.background = "rgba(255,255,255,0.08)";
    button.style.border = "1px solid rgba(255,255,255,0.22)";
    button.style.borderRadius = "4px";
    button.style.color = "#fff";
    button.style.cursor = "pointer";
    return button;
  };

  const collapseButton = makeButton("Expand");
  const copyButton = makeButton("Copy JSON");
  const clearButton = makeButton("Clear");
  const disableButton = makeButton("Disable");

  header.appendChild(titleEl);
  header.appendChild(countEl);
  header.appendChild(collapseButton);
  header.appendChild(copyButton);
  header.appendChild(clearButton);
  header.appendChild(disableButton);

  const body = document.createElement("div");
  body.style.display = "none";
  body.style.padding = "6px 8px 8px";

  const hint = document.createElement("div");
  hint.textContent =
    "Enable with ?viewportDebug=1 or localStorage['otef.viewportDebug']=1";
  hint.style.opacity = "0.75";
  hint.style.marginBottom = "6px";

  const textarea = document.createElement("textarea");
  textarea.readOnly = true;
  textarea.wrap = "off";
  textarea.style.width = "100%";
  textarea.style.height = "28vh";
  textarea.style.resize = "vertical";
  textarea.style.background = "rgba(255,255,255,0.05)";
  textarea.style.border = "1px solid rgba(255,255,255,0.18)";
  textarea.style.borderRadius = "4px";
  textarea.style.color = "#e6e8ee";
  textarea.style.padding = "6px";
  textarea.style.font = "inherit";

  body.appendChild(hint);
  body.appendChild(textarea);

  root.appendChild(header);
  root.appendChild(body);
  document.body.appendChild(root);

  const render = () => {
    countEl.textContent = String(events.length);
    textarea.value = JSON.stringify(events, null, 2);
  };

  collapseButton.addEventListener("click", () => {
    collapsed = !collapsed;
    body.style.display = collapsed ? "none" : "";
    collapseButton.textContent = collapsed ? "Expand" : "Collapse";
  });

  copyButton.addEventListener("click", () => {
    const text = JSON.stringify(events, null, 2);
    copyWithFallback(text, textarea)
      .then(() => {
        copyButton.textContent = "Copied";
        setTimeout(() => {
          copyButton.textContent = "Copy JSON";
        }, 800);
      })
      .catch(() => {
        copyButton.textContent = "Select & Copy";
        textarea.focus();
        textarea.select();
        setTimeout(() => {
          copyButton.textContent = "Copy JSON";
        }, 1500);
      });
  });

  clearButton.addEventListener("click", () => {
    events.length = 0;
    render();
  });

  disableButton.addEventListener("click", () => {
    setStoredDebugFlag(false);
    root.remove();
  });

  const log = (eventName, details = {}) => {
    const entry = {
      timestamp: new Date().toISOString(),
      pageId: pageId || "unknown",
      event: eventName || "unknown_event",
    };

    const viewport = normalizeViewport(details.viewport);
    if (viewport) entry.viewport = viewport;

    for (const [key, value] of Object.entries(details)) {
      if (key === "viewport" || value === undefined) continue;
      entry[key] = value;
    }

    events.push(entry);
    if (events.length > maxEvents) {
      events.splice(0, events.length - maxEvents);
    }
    render();
  };

  const clear = () => {
    events.length = 0;
    render();
  };

  const destroy = () => {
    root.remove();
  };

  return {
    enabled: true,
    log,
    clear,
    destroy,
  };
}
