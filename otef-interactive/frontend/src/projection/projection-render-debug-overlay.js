/**
 * Lab diagnostics: resolution, DPR, MapLibre canvas backing store, zoom.
 * Toggle with **D** from projection-main (same pattern as B bounds / R rotation).
 */
import { MapProjectionConfig } from "../shared/map-projection-config.js";

function readMapTransformPixelRatio(map) {
  if (!map || typeof map !== "object") return null;
  const t = map.transform;
  if (t && typeof t.pixelRatio === "number" && Number.isFinite(t.pixelRatio)) {
    return t.pixelRatio;
  }
  if (typeof map.getPixelRatio === "function") {
    try {
      const v = map.getPixelRatio();
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    } catch {
      return null;
    }
  }
  return null;
}

function collectSnapshot(map) {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio : null;
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  const container = document.getElementById("displayContainer");
  const mapEl = document.getElementById("projectionMap");
  let canvas = null;
  try {
    canvas = map && typeof map.getCanvas === "function" ? map.getCanvas() : null;
  } catch {
    canvas = null;
  }
  if (!canvas && mapEl) {
    canvas = mapEl.querySelector("canvas.maplibregl-canvas");
  }

  const mapCssW = mapEl?.clientWidth ?? null;
  const mapCssH = mapEl?.clientHeight ?? null;
  const cw = canvas?.width ?? null;
  const ch = canvas?.height ?? null;

  let effectivePrW = null;
  let effectivePrH = null;
  if (canvas && mapCssW && mapCssH && mapCssW > 0 && mapCssH > 0) {
    effectivePrW = cw != null ? cw / mapCssW : null;
    effectivePrH = ch != null ? ch / mapCssH : null;
  }

  const wmts = MapProjectionConfig?.WMTS_PROJECTOR || {};

  let zoom = null;
  let bearing = null;
  if (map) {
    try {
      if (typeof map.getZoom === "function") zoom = map.getZoom();
    } catch {
      zoom = null;
    }
    try {
      if (typeof map.getBearing === "function") bearing = map.getBearing();
    } catch {
      bearing = null;
    }
  }

  const path =
    typeof window !== "undefined" && window.location
      ? `${window.location.pathname}${window.location.search ? " (+query)" : ""}`
      : "";
  const lines = [
    `time (local)     ${new Date().toLocaleString()}`,
    `path             ${path || "n/a"}`,
    ``,
    `window.devicePixelRatio   ${dpr ?? "n/a"}`,
    `visualViewport scale      ${vv && typeof vv.scale === "number" ? vv.scale : "n/a"}`,
    `window inner                ${window.innerWidth}×${window.innerHeight}`,
    `screen                      ${window.screen?.width ?? "?"}×${window.screen?.height ?? "?"}`,
    `fullscreen active           ${!!document.fullscreenElement}`,
    ``,
    `#displayContainer client    ${container?.clientWidth ?? "?"}×${container?.clientHeight ?? "?"}`,
    `#projectionMap client       ${mapCssW ?? "?"}×${mapCssH ?? "?"}`,
    ``,
    `MapLibre canvas backing     ${cw ?? "?"}×${ch ?? "?"}`,
    `canvas CSS (style)          ${canvas?.style?.width || "n/a"} × ${canvas?.style?.height || "n/a"}`,
    `canvas client               ${canvas?.clientWidth ?? "?"}×${canvas?.clientHeight ?? "?"}`,
    `effective ratio (cw/cssW)   ${effectivePrW != null ? effectivePrW.toFixed(3) : "n/a"}  (ch/cssH) ${effectivePrH != null ? effectivePrH.toFixed(3) : "n/a"}`,
    `map transform pixelRatio    ${readMapTransformPixelRatio(map) ?? "n/a"}`,
    `total GL pixels (w×h)       ${cw != null && ch != null ? (cw * ch).toLocaleString() : "n/a"}`,
    ``,
    `map zoom                    ${zoom != null ? zoom.toFixed(4) : "n/a"}`,
    `map bearing                 ${bearing != null ? bearing.toFixed(2) : "n/a"}`,
    ``,
    `WMTS_PROJECTOR.zoomOverride   ${wmts.zoomOverride === null || wmts.zoomOverride === undefined ? "null (manifest default)" : String(wmts.zoomOverride)}`,
    `WMTS_PROJECTOR.urlOverride    ${wmts.urlOverride ? "set" : "null"}`,
    ``,
    `Interpret: backing should be ≈ map CSS × devicePixelRatio unless`,
    `pixelRatio is overridden. If effective ratio ≈ 1 while DPR is 1,`,
    `you only have layout pixels (consider Map pixelRatio or larger layout).`,
    ``,
    `Toggle: D (same shortcut row as H / F / B / R in help)`,
  ];

  return lines.join("\n");
}

/**
 * @param {{
 *   map: import("maplibre-gl").Map;
 *   registerDisposer: (fn: () => void) => void;
 *   initialVisible?: boolean;
 * }} opts
 * @returns {{ dispose: () => void; setVisible: (v: boolean) => void; toggle: () => void } | null}
 */
export function installProjectionRenderDebugOverlay({
  map,
  registerDisposer,
  initialVisible = false,
}) {
  if (typeof document === "undefined") return null;

  let visible = !!initialVisible;

  const root = document.createElement("div");
  root.id = "projectionRenderDebug";
  root.setAttribute("aria-live", "polite");
  root.style.cssText = [
    "position:fixed",
    "top:8px",
    "right:8px",
    "max-width:min(520px,calc(100vw - 16px))",
    "max-height:min(70vh,calc(100% - 16px))",
    "overflow:auto",
    "z-index:250",
    "box-sizing:border-box",
    "padding:10px 12px",
    "background:rgba(0,0,0,0.88)",
    "color:#e8ffd8",
    "font:12px/1.35 ui-monospace,Consolas,monospace",
    "border:1px solid #3a6",
    "border-radius:6px",
    "pointer-events:none",
    "text-align:left",
    "white-space:pre",
    "box-shadow:0 4px 20px rgba(0,0,0,0.5)",
  ].join(";");

  const title = document.createElement("div");
  title.textContent = "Projection render debug";
  title.style.cssText =
    "font-weight:bold;color:#7fbf7f;margin-bottom:6px;letter-spacing:0.02em;";
  root.appendChild(title);

  const pre = document.createElement("pre");
  pre.style.cssText =
    "margin:0;white-space:pre-wrap;word-break:break-all;user-select:text;pointer-events:auto;";
  root.appendChild(pre);

  const applyVisibility = () => {
    root.style.display = visible ? "block" : "none";
  };

  const refresh = () => {
    if (!visible) return;
    try {
      pre.textContent = collectSnapshot(map);
    } catch (err) {
      pre.textContent = `Debug snapshot error:\n${err && err.message ? err.message : String(err)}`;
    }
  };

  const intervalId = window.setInterval(refresh, 1000);
  registerDisposer(() => window.clearInterval(intervalId));

  if (map && typeof map.on === "function") {
    const bump = () => refresh();
    map.on("moveend", bump);
    map.on("idle", bump);
    map.on("resize", bump);
    registerDisposer(() => {
      map.off("moveend", bump);
      map.off("idle", bump);
      map.off("resize", bump);
    });
  }

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => refresh());
    const c = document.getElementById("displayContainer");
    const m = document.getElementById("projectionMap");
    if (c) ro.observe(c);
    if (m) ro.observe(m);
    registerDisposer(() => ro.disconnect());
  }

  document.body.appendChild(root);
  applyVisibility();
  refresh();

  registerDisposer(() => {
    root.remove();
  });

  return {
    dispose() {
      root.remove();
    },
    setVisible(v) {
      visible = !!v;
      applyVisibility();
      refresh();
    },
    toggle() {
      visible = !visible;
      applyVisibility();
      refresh();
    },
  };
}
