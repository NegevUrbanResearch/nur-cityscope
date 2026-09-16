import { validateProjectionConfig } from "../shared/projection-config-schema.js";

const FULL = { x0: 0, x1: 1, y0: 0, y1: 1 };
const NODES = ["content", "pre", "left-crop", "right-crop", "left-fit", "right-fit", "left-output", "right-output"];
const clone = (value) => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const branchFor = (node) => node.startsWith("right") ? "right" : "left";

function stageConfig(config, node) {
  const result = clone(config);
  if (node === "content") result.pre = { scale: 1, rotateDeg: 0, tx: 0, ty: 0 };
  if (node === "content" || node === "pre" || node.endsWith("-crop")) {
    result.outputs.left.crop = clone(FULL); result.outputs.right.crop = clone(FULL);
    result.outputs.left.post = { scale: 1, tx: 0, ty: 0 }; result.outputs.right.post = { scale: 1, tx: 0, ty: 0 };
  }
  return result;
}
function cropFor(node, config) { return node.endsWith("-crop") ? config.outputs?.[branchFor(node)]?.crop : null; }

/** Always-visible, draft-driven stage previews. TD keystone/grid warp is downstream. */
export function createActiveOutputPreview({ document, nodeHosts, hosts, mobileHost, mobileQuery }) {
  const win = document?.defaultView;
  if (!win?.location?.origin || !win.addEventListener) {
    return { update() {}, select() {}, show() {}, dispose() {} };
  }
  const origin = win.location.origin; const previews = new Map(); let latest = null;
  const legacy = !nodeHosts && hosts;
  const send = (item) => {
    if (!item.ready || !latest || !item.frame.contentWindow) return;
    item.requestId += 1;
    item.frame.contentWindow.postMessage({ type: "otef_projection_preview_config", output: branchFor(item.node), requestId: item.requestId, config: stageConfig(latest, item.node) }, origin);
    item.title.textContent = "Rendering current draft…";
    const crop = cropFor(item.node, latest);
    item.viewport.style.clipPath = crop ? `inset(${crop.y0 * 100}% ${(1 - crop.x1) * 100}% ${(1 - crop.y1) * 100}% ${crop.x0 * 100}%)` : "none";
  };
  const onMessage = (event) => {
    const item = [...previews.values()].find((candidate) => candidate.frame.contentWindow === event.source);
    if (!item || event.origin !== origin || event.data?.output !== branchFor(item.node)) return;
    if (event.data.type === "otef_projection_preview_ready") { item.ready = true; send(item); }
    if (event.data.type === "otef_projection_preview_applied" && event.data.requestId === item.requestId) item.title.textContent = event.data.success ? "Current draft" : `Preview unavailable: ${event.data.error || "render failed"}`;
  };
  const mount = (node, host) => {
    if (!host) return;
    const surface = document.createElement("div"); surface.className = "active-preview stage-preview";
    const title = document.createElement("small"); title.className = "active-preview-status"; title.textContent = "Loading projection stage…";
    const viewport = document.createElement("div"); viewport.className = "active-preview-window";
    const frame = document.createElement("iframe"); frame.className = "active-preview-frame"; frame.title = `${node} projection stage preview`; frame.src = `/otef-interactive/projection.html?span=${branchFor(node)}&preview=1&mapPixelRatio=${legacy ? 1 : 0.25}`;
    viewport.appendChild(frame); surface.appendChild(title); surface.appendChild(viewport); host.appendChild(surface);
    const item = { node, host, surface, title, viewport, frame, ready: false, requestId: 0 };
    previews.set(node, item);
    const resize = () => { const width = Math.max(120, viewport.clientWidth || host.clientWidth || 260); viewport.style.height = `${width * 1080 / 1920}px`; frame.style.transform = `scale(${width / 1920})`; };
    resize(); const ResizeObserverType = win.ResizeObserver || globalThis.ResizeObserver;
    if (ResizeObserverType) { item.resizeObserver = new ResizeObserverType(resize); item.resizeObserver.observe(viewport); }
    frame.addEventListener?.("load", () => { item.ready = true; send(item); });
  };
  if (nodeHosts) for (const node of NODES) mount(node, nodeHosts.get(node));
  let show = (node) => { const surface = previews.get(node)?.surface; surface?.classList?.toggle?.("preview-expanded"); };
  let legacyActive = null;
  if (legacy) {
    // Preserve the previous lazy two-output API for existing embedders/tests.
    show = (output) => {
      if (!["left", "right"].includes(output)) return;
      if (legacyActive) { const old = previews.get(`${legacyActive}-output`); old?.resizeObserver?.disconnect?.(); old?.surface.remove?.(); previews.delete(`${legacyActive}-output`); }
      mount(`${output}-output`, hosts.get(output)); legacyActive = output;
    };
  }
  const select = (node) => {
    const item = previews.get(node);
    if (!item) return;
    if (mobileQuery?.matches && mobileHost) {
      mobileHost.appendChild(item.surface);
      for (const other of previews.values()) other.surface.hidden = other !== item;
    } else {
      if (item.surface.parentElement !== item.host) item.host.appendChild(item.surface);
      for (const other of previews.values()) other.surface.hidden = false;
    }
  };
  const onMediaChange = () => { if (mobileQuery?.matches) select("pre"); else for (const item of previews.values()) { if (item.surface.parentElement !== item.host) item.host.appendChild(item.surface); item.surface.hidden = false; } };
  win.addEventListener("message", onMessage); mobileQuery?.addEventListener?.("change", onMediaChange); onMediaChange();
  return { update(config) { if (!Object.keys(validateProjectionConfig(config || {})).length) { latest = clone(config); for (const item of previews.values()) send(item); } }, select, show, dispose() { for (const item of previews.values()) { item.resizeObserver?.disconnect?.(); item.surface.remove?.(); } previews.clear(); win.removeEventListener("message", onMessage); mobileQuery?.removeEventListener?.("change", onMediaChange); } };
}
