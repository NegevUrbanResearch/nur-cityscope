/**
 * Lab E-key editor for the NLI explainer slot (projection page only).
 * Timeline paints idle sample when explainerDebugVisible; this module does not write caption innerHTML.
 */

import { MapProjectionConfig } from "../shared/map-projection-config.js";
import { NLI_EXPLAINER_SAMPLE_MODEL } from "../shared/nli-explainer-model.js";
import {
  applyNliExplainerLayout,
  applyNliExplainerHostPresence,
  clampNliExplainerLayout,
  mergeNliExplainerLayout,
  nliExplainerBoxHitsOverlap,
  nliExplainerContentOverflows,
  nliExplainerOverlapPageRect,
  nliExplainerShouldPaintOnSpan,
  nliExplainerSpanKey,
  NLI_EXPLAINER_LAYOUT_STORAGE_KEY,
  readNliExplainerLayoutStore,
  serializeNliExplainerLayoutMap,
  shouldIgnoreExplainerLayoutStore,
} from "./nli-explainer-overlay.js";

const HANDLE_IDS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const HANDLE_CURSOR = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};
const HANDLE_POS = {
  nw: { left: "0%", top: "0%" },
  n: { left: "50%", top: "0%" },
  ne: { left: "100%", top: "0%" },
  e: { left: "100%", top: "50%" },
  se: { left: "100%", top: "100%" },
  s: { left: "50%", top: "100%" },
  sw: { left: "0%", top: "100%" },
  w: { left: "0%", top: "50%" },
};

function searchString() {
  return typeof window !== "undefined" && window.location ? window.location.search : "";
}

function readStoredMap() {
  try {
    return readNliExplainerLayoutStore(localStorage.getItem(NLI_EXPLAINER_LAYOUT_STORAGE_KEY));
  } catch {
    return {};
  }
}

function layoutFromStore() {
  const search = searchString();
  const stored = shouldIgnoreExplainerLayoutStore(search) ? {} : readStoredMap();
  return mergeNliExplainerLayout(
    nliExplainerSpanKey(search),
    stored,
    MapProjectionConfig.NLI_EXPLAINER_LAYOUT,
  );
}

function layoutFieldsEqual(a, b) {
  return (
    a.leftPct === b.leftPct &&
    a.topPct === b.topPct &&
    a.widthPct === b.widthPct &&
    a.heightPct === b.heightPct &&
    a.fontPx === b.fontPx &&
    a.rotateDeg === b.rotateDeg
  );
}

function containerSize(host) {
  const parent = host?.parentElement || document.getElementById("displayContainer");
  return { w: parent?.clientWidth || 0, h: parent?.clientHeight || 0 };
}

function pxToPct(dxPx, dyPx, w, h) {
  return {
    dxPct: w > 0 ? (100 * dxPx) / w : 0,
    dyPct: h > 0 ? (100 * dyPx) / h : 0,
  };
}

/** Convert page-space pointer delta into the host's local axes (inverse of CSS rotateDeg). */
function pageDeltaToLocalPct(dxPx, dyPx, rotateDeg, w, h) {
  const rad = (Number(rotateDeg) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return pxToPct(dxPx * cos + dyPx * sin, -dxPx * sin + dyPx * cos, w, h);
}

function pointerAngleDeg(ev, host) {
  const r = host.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  return (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI;
}

export function isNliExplainerDebugRequestedInUrl(search) {
  const raw = typeof search === "string" ? search : "";
  const q = !raw || raw === "?" ? "" : raw.startsWith("?") ? raw : `?${raw}`;
  if (!q) return false;
  const params = new URLSearchParams(q);
  const flag = params.get("nliExplainerDebug") ?? params.get("ned");
  if (flag === null || flag === "") return false;
  const lower = String(flag).trim().toLowerCase();
  if (lower === "0" || lower === "false" || lower === "no" || lower === "off") return false;
  return true;
}

export function moveLayoutByDelta(layout, dLeftPct, dTopPct) {
  return clampNliExplainerLayout(
    {
      ...layout,
      leftPct: Number(layout?.leftPct) + Number(dLeftPct),
      topPct: Number(layout?.topPct) + Number(dTopPct),
    },
    layout,
  );
}

export function resizeLayoutFromHandle(layout, handle, dxPct, dyPct) {
  const id = String(handle || "").toLowerCase();
  let leftPct = Number(layout?.leftPct);
  let topPct = Number(layout?.topPct);
  let widthPct = Number(layout?.widthPct);
  let heightPct = Number(layout?.heightPct);
  const dx = Number(dxPct) || 0;
  const dy = Number(dyPct) || 0;
  if (id.includes("e")) widthPct += dx;
  if (id.includes("w")) {
    leftPct += dx;
    widthPct -= dx;
  }
  if (id.includes("s")) heightPct += dy;
  if (id.includes("n")) {
    topPct += dy;
    heightPct -= dy;
  }
  return clampNliExplainerLayout({ ...layout, leftPct, topPct, widthPct, heightPct }, layout);
}

export function rotateLayoutByDelta(layout, dDeg) {
  return clampNliExplainerLayout(
    {
      ...layout,
      rotateDeg: Number(layout?.rotateDeg) + Number(dDeg),
    },
    layout,
  );
}

/**
 * @param {{
 *   host: HTMLElement;
 *   captionEl: HTMLElement;
 *   registerDisposer: (fn: () => void) => void;
 *   initialVisible?: boolean;
 *   onVisibleChange?: (visible: boolean) => void;
 * }} opts
 * @returns {{ dispose: () => void; setVisible: (v: boolean) => void; toggle: () => void; isVisible: () => boolean } | null}
 */
export function installNliExplainerDebug({
  host,
  captionEl,
  registerDisposer,
  initialVisible = false,
  onVisibleChange,
} = {}) {
  if (typeof document === "undefined" || !host) return null;

  const register = typeof registerDisposer === "function" ? registerDisposer : () => {};
  let visible = false;
  let liveLayout = layoutFromStore();
  let drag = null;

  const handles = HANDLE_IDS.map((id) => {
    const el = document.createElement("div");
    el.dataset.nedHandle = id;
    const pos = HANDLE_POS[id];
    el.style.cssText = [
      "position:absolute",
      `left:${pos.left}`,
      `top:${pos.top}`,
      "width:10px",
      "height:10px",
      "margin:-5px 0 0 -5px",
      "box-sizing:border-box",
      "background:#fff",
      "border:1px solid #38bdf8",
      `cursor:${HANDLE_CURSOR[id]}`,
      "pointer-events:auto",
      "z-index:3",
      "display:none",
    ].join(";");
    host.appendChild(el);
    return el;
  });

  const rotateHandle = document.createElement("div");
  rotateHandle.dataset.nedHandle = "rotate";
  rotateHandle.style.cssText = [
    "position:absolute",
    "left:50%",
    "top:-22px",
    "width:10px",
    "height:10px",
    "margin:-5px 0 0 -5px",
    "border-radius:50%",
    "background:#fbbf24",
    "border:1px solid #f59e0b",
    "cursor:grab",
    "pointer-events:auto",
    "z-index:3",
    "display:none",
  ].join(";");
  host.appendChild(rotateHandle);

  const hatch = document.createElement("div");
  hatch.style.cssText = [
    "position:absolute",
    "top:0",
    "height:100%",
    "pointer-events:none",
    "z-index:11",
    "display:none",
    "background:repeating-linear-gradient(45deg,rgba(251,191,36,0.18) 0 8px,rgba(251,191,36,0.05) 8px 16px)",
    "border-left:1px dashed rgba(251,191,36,0.7)",
    "border-right:1px dashed rgba(251,191,36,0.7)",
  ].join(";");
  (host.parentElement || document.getElementById("displayContainer") || document.body).appendChild(
    hatch,
  );

  const panel = document.createElement("div");
  panel.style.cssText = [
    "position:fixed",
    "top:8px",
    "left:8px",
    "z-index:130",
    "box-sizing:border-box",
    "padding:10px 12px",
    "background:rgba(0,0,0,0.88)",
    "color:#e8e8e8",
    "font:12px/1.35 ui-sans-serif,system-ui,sans-serif",
    "border:1px solid #555",
    "border-radius:6px",
    "display:none",
    "min-width:220px",
    "pointer-events:auto",
  ].join(";");
  const sampleAlarm = NLI_EXPLAINER_SAMPLE_MODEL.rows.find((row) => row.kind === "alarms");
  panel.innerHTML = `<div style="font-weight:bold;margin-bottom:6px">NLI explainer layout</div>
<div data-ned-chip style="display:none;color:#fbbf24;margin-bottom:4px">override</div>
<div data-ned-warn style="display:none;color:#f87171;margin-bottom:6px">Box hits dual-span overlap</div>
<div data-ned-overflow style="display:none;color:#ff00ff;margin-bottom:6px">Content overflows (enlarge box or lower font)</div>
<label>left % <input data-ned-field="leftPct" type="number" step="0.1" style="width:72px"></label><br>
<label>top % <input data-ned-field="topPct" type="number" step="0.1" style="width:72px"></label><br>
<label>width % <input data-ned-field="widthPct" type="number" step="0.1" style="width:72px"></label><br>
<label>height % <input data-ned-field="heightPct" type="number" step="0.1" style="width:72px"></label><br>
<label>font px <input data-ned-field="fontPx" type="number" step="1" style="width:72px"></label><br>
<label>rotateDeg <input data-ned-field="rotateDeg" type="number" step="0.1" style="width:72px"></label><br>
<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
<button type="button" data-ned-reset>Reset</button>
<button type="button" data-ned-download>Download JSON</button>
<button type="button" data-ned-copy>Copy JSON</button>
</div>
<div style="margin-top:6px;color:#9ca3af;font-size:11px">Idle sample via timeline (${sampleAlarm?.items?.length || 12} alarms + multi-line Name). Drag box; handles resize in local axes.</div>`;
  document.body.appendChild(panel);

  const fieldInputs = {};
  for (const input of panel.querySelectorAll("[data-ned-field]")) {
    fieldInputs[input.getAttribute("data-ned-field")] = input;
  }
  const chipEl = panel.querySelector("[data-ned-chip]");
  const warnEl = panel.querySelector("[data-ned-warn]");
  const overflowEl = panel.querySelector("[data-ned-overflow]");

  function applyLive() {
    applyNliExplainerLayout(host, liveLayout);
    applyNliExplainerHostPresence(host, nliExplainerSpanKey(searchString()));
  }

  function syncHatch() {
    const spanKey = nliExplainerSpanKey(searchString());
    const rect = nliExplainerOverlapPageRect(spanKey);
    if (!visible || !rect || !nliExplainerShouldPaintOnSpan(spanKey)) {
      hatch.style.display = "none";
      return;
    }
    hatch.style.display = "block";
    hatch.style.left = `${rect.leftPct}%`;
    hatch.style.width = `${rect.widthPct}%`;
  }

  function refreshChromeSignals() {
    const spanKey = nliExplainerSpanKey(searchString());
    const overflows = nliExplainerContentOverflows(captionEl);
    host.style.outline = visible
      ? overflows
        ? "2px solid magenta"
        : "2px dashed #38bdf8"
      : "";
    if (overflowEl) overflowEl.style.display = visible && overflows ? "block" : "none";
    const hits = nliExplainerBoxHitsOverlap(liveLayout, spanKey);
    if (warnEl) warnEl.style.display = visible && hits ? "block" : "none";
    const defaults = MapProjectionConfig.NLI_EXPLAINER_LAYOUT;
    const committed = mergeNliExplainerLayout(spanKey, {}, defaults);
    const stored = shouldIgnoreExplainerLayoutStore(searchString()) ? {} : readStoredMap();
    const storedBox = stored[spanKey];
    const overridden =
      !!storedBox &&
      !layoutFieldsEqual(clampNliExplainerLayout(storedBox, committed), committed);
    if (chipEl) chipEl.style.display = visible && overridden ? "block" : "none";
    syncHatch();
  }

  function refreshPanelFields() {
    for (const key of ["leftPct", "topPct", "widthPct", "heightPct", "fontPx", "rotateDeg"]) {
      if (fieldInputs[key] && document.activeElement !== fieldInputs[key]) {
        fieldInputs[key].value = String(liveLayout[key]);
      }
    }
  }

  function persist() {
    if (shouldIgnoreExplainerLayoutStore(searchString())) {
      refreshChromeSignals();
      return;
    }
    const spanKey = nliExplainerSpanKey(searchString());
    const stored = readStoredMap();
    stored[spanKey] = clampNliExplainerLayout(liveLayout, liveLayout);
    try {
      localStorage.setItem(NLI_EXPLAINER_LAYOUT_STORAGE_KEY, JSON.stringify(stored));
    } catch {
      /* storage disabled or quota */
    }
    refreshChromeSignals();
  }

  function currentFullMap() {
    const search = searchString();
    const stored = shouldIgnoreExplainerLayoutStore(search) ? {} : readStoredMap();
    const defaults = MapProjectionConfig.NLI_EXPLAINER_LAYOUT;
    const spanKey = nliExplainerSpanKey(search);
    return {
      full: mergeNliExplainerLayout("full", stored, defaults),
      left: mergeNliExplainerLayout("left", stored, defaults),
      right: mergeNliExplainerLayout("right", stored, defaults),
      [spanKey]: clampNliExplainerLayout(liveLayout, liveLayout),
    };
  }

  function exportJsonText() {
    return serializeNliExplainerLayoutMap(currentFullMap());
  }

  function downloadLayoutJson() {
    const json = exportJsonText();
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "nli-explainer-layout.json";
    a.click();
    URL.revokeObjectURL(a.href);
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      void navigator.clipboard.writeText(json);
    }
  }

  function applyChrome() {
    host.style.pointerEvents = visible ? "auto" : "none";
    const handleDisplay = visible ? "block" : "none";
    for (const el of handles) el.style.display = handleDisplay;
    rotateHandle.style.display = handleDisplay;
    panel.style.display = visible ? "block" : "none";
    if (visible) {
      applyLive();
      refreshPanelFields();
    }
    refreshChromeSignals();
  }

  function setVisible(v) {
    visible = !!v;
    applyChrome();
    if (typeof onVisibleChange === "function") onVisibleChange(visible);
    window.requestAnimationFrame(() => refreshChromeSignals());
  }

  function onHostPointerDown(ev) {
    if (!visible) return;
    if (ev.button != null && ev.button !== 0) return;
    const handle = ev.target?.dataset?.nedHandle;
    if (!handle && panel.contains(ev.target)) return;
    ev.preventDefault();
    const { w, h } = containerSize(host);
    if (handle === "rotate") {
      drag = {
        mode: "rotate",
        startX: ev.clientX,
        startY: ev.clientY,
        startAngle: pointerAngleDeg(ev, host),
        startLayout: { ...liveLayout },
      };
    } else if (handle) {
      drag = {
        mode: "resize",
        handle,
        startX: ev.clientX,
        startY: ev.clientY,
        startLayout: { ...liveLayout },
        w,
        h,
      };
    } else {
      drag = {
        mode: "move",
        startX: ev.clientX,
        startY: ev.clientY,
        startLayout: { ...liveLayout },
        w,
        h,
      };
    }
  }

  function onPointerMove(ev) {
    if (!drag) return;
    const dxPx = ev.clientX - drag.startX;
    const dyPx = ev.clientY - drag.startY;
    if (drag.mode === "move") {
      const { dxPct, dyPct } = pxToPct(dxPx, dyPx, drag.w, drag.h);
      liveLayout = moveLayoutByDelta(drag.startLayout, dxPct, dyPct);
    } else if (drag.mode === "resize") {
      const local = pageDeltaToLocalPct(dxPx, dyPx, drag.startLayout.rotateDeg, drag.w, drag.h);
      liveLayout = resizeLayoutFromHandle(drag.startLayout, drag.handle, local.dxPct, local.dyPct);
    } else if (drag.mode === "rotate") {
      liveLayout = rotateLayoutByDelta(
        drag.startLayout,
        pointerAngleDeg(ev, host) - drag.startAngle,
      );
    }
    applyLive();
    refreshPanelFields();
    refreshChromeSignals();
  }

  function onPointerUp() {
    if (!drag) return;
    drag = null;
    persist();
  }

  function commitNumeric(name, raw) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    liveLayout = clampNliExplainerLayout({ ...liveLayout, [name]: n }, liveLayout);
    applyLive();
    persist();
    refreshPanelFields();
  }

  host.addEventListener("pointerdown", onHostPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  const onWindowResize = () => {
    if (!visible) return;
    applyNliExplainerLayout(host, liveLayout);
    refreshChromeSignals();
  };
  window.addEventListener("resize", onWindowResize);

  let observer = null;
  if (captionEl && typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(() => {
      if (visible) refreshChromeSignals();
    });
    observer.observe(captionEl, { childList: true, subtree: true, characterData: true });
  }

  panel.querySelector("[data-ned-reset]").addEventListener("click", () => {
    const search = searchString();
    const spanKey = nliExplainerSpanKey(search);
    const stored = readStoredMap();
    delete stored[spanKey];
    if (!shouldIgnoreExplainerLayoutStore(search)) {
      try {
        localStorage.setItem(NLI_EXPLAINER_LAYOUT_STORAGE_KEY, JSON.stringify(stored));
      } catch {
        /* storage disabled or quota */
      }
    }
    liveLayout = mergeNliExplainerLayout(spanKey, stored, MapProjectionConfig.NLI_EXPLAINER_LAYOUT);
    applyLive();
    refreshPanelFields();
    refreshChromeSignals();
  });
  panel.querySelector("[data-ned-download]").addEventListener("click", () => {
    downloadLayoutJson();
  });
  panel.querySelector("[data-ned-copy]").addEventListener("click", () => {
    const json = exportJsonText();
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      void navigator.clipboard.writeText(json);
    }
  });
  for (const [name, input] of Object.entries(fieldInputs)) {
    input.addEventListener("change", () => commitNumeric(name, input.value));
  }

  register(() => {
    host.removeEventListener("pointerdown", onHostPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("resize", onWindowResize);
    observer?.disconnect();
    for (const el of handles) el.remove();
    rotateHandle.remove();
    hatch.remove();
    panel.remove();
    host.style.pointerEvents = "none";
    host.style.outline = "";
  });

  if (initialVisible) setVisible(true);

  return {
    dispose() {
      setVisible(false);
      panel.remove();
      hatch.remove();
    },
    setVisible,
    toggle() {
      setVisible(!visible);
    },
    isVisible() {
      return visible;
    },
  };
}
