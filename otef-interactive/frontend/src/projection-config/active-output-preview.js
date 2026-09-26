import { validateProjectionConfig } from "../shared/projection-config-schema.js";
import { fitWarpViewport } from "./warp-viewport.js";

const FULL = { x0: 0, x1: 1, y0: 0, y1: 1 };
const NODES = ["content", "pre", "left-crop", "right-crop", "left-fit", "right-fit", "left-output", "right-output"];
const clone = (value) => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const branchFor = (node) => node.startsWith("right") ? "right" : "left";
const previewKeyFor = (node, previews) => previews.has(node) ? node : `${branchFor(node)}-output`;
function boundedDiagnostics(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !["valid", "invalid"].includes(value.state) ||
    typeof value.datasetVersion !== "string" || value.datasetVersion.length > 128 || !["wall", "model"].includes(value.mode) ||
    !Number.isSafeInteger(value.requestedFontPx) ||
    !(value.effectiveFontPx === null || Number.isSafeInteger(value.effectiveFontPx)) ||
    !Number.isSafeInteger(value.expected) || value.expected < 1 || !Number.isSafeInteger(value.placed) || value.placed < 0 || value.placed > value.expected) return null;
  return { state: value.state, datasetVersion: value.datasetVersion, mode: value.mode,
    requestedFontPx: value.requestedFontPx, effectiveFontPx: value.effectiveFontPx,
    expected: value.expected, placed: value.placed,
    left: Number.isSafeInteger(value.left) ? value.left : null,
    right: Number.isSafeInteger(value.right) ? value.right : null,
    ...(typeof value.reason === "string" ? { reason: value.reason.slice(0, 240) } : {}) };
}

function stageConfig(config, node) {
  const result = clone(config);
  if (node === "content") result.pre = { scale: 1, rotateDeg: 0, tx: 0, ty: 0 };
  if (node === "content" || node === "pre" || node.endsWith("-crop")) {
    result.outputs.left.crop = clone(FULL); result.outputs.right.crop = clone(FULL);
    result.outputs.left.post = { scale: 1, tx: 0, ty: 0 }; result.outputs.right.post = { scale: 1, tx: 0, ty: 0 };
  }
  if (!node.endsWith("-output")) {
    for (const output of ["left", "right"]) if (result.outputs?.[output]?.warp) result.outputs[output].warp.enabled = false;
  }
  return result;
}
function cropFor(node, config) { return node.endsWith("-crop") ? config.outputs?.[branchFor(node)]?.crop : null; }

/** Always-visible, draft-driven stage previews. TD keystone/grid warp is downstream. */
export function createActiveOutputPreview({ document, nodeHosts, hosts, mobileHost, mobileQuery, enlargedHost, enlargedEditor }) {
  const win = document?.defaultView;
  if (!win?.location?.origin || !win.addEventListener) {
    return { update() {}, select() {}, show() {}, validateCandidate: async ({ identity }) => ({ identity, valid: false, reason: 'final output previews unavailable' }), dispose() {} };
  }
  const origin = win.location.origin; const previews = new Map(); let latest = null; let activeNode = "pre"; let overlay = null; let overlayViewBox = null; let expanded = null; let finalPairReady = false; let finalOutputsReadyCallback = null; let loadRetryTimer = null;
  const legacy = !nodeHosts && hosts;
  const rejectValidation = (item, reason) => {
    if (!item.validation) return;
    clearTimeout(item.validation.timer);
    item.validation.reject(new Error(reason));
    item.validation = null;
  };
  const sendValidation = (item) => {
    const pending = item.validation;
    if (!pending || !item.ready || !item.frame.contentWindow) return;
    item.frame.contentWindow.postMessage({ type: 'otef_projection_preview_validate', output: branchFor(item.node),
      requestId: pending.requestId, generation: pending.generation, identity: pending.identity, revision: pending.revision, config: pending.config }, origin);
  };
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
    if (event.data.type === "otef_projection_preview_ready") {
      item.ready = true;
      if (item.node.endsWith("-output")) {
        item.protocolReady = true;
        const pair = [previews.get("left-output"), previews.get("right-output")];
        if (pair.every((candidate) => candidate?.protocolReady) && !finalPairReady) {
          finalPairReady = true;
          finalOutputsReadyCallback?.();
        }
      }
      send(item); sendValidation(item);
    }
    if (event.data.type === "otef_projection_preview_applied" && event.data.requestId === item.requestId) item.title.textContent = event.data.success ? "Current draft" : `Preview unavailable: ${event.data.error || "render failed"}`;
    if (event.data.type === 'otef_projection_preview_validated' && item.validation &&
        event.data.requestId === item.validation.requestId && event.data.identity === item.validation.identity) {
      const pending = item.validation;
      item.validation = null;
      clearTimeout(pending.timer);
      pending.resolve(event.data);
    }
  };
  const mount = (node, host) => {
    if (!host) return;
    const surface = document.createElement("div"); surface.className = "active-preview stage-preview";
    const title = document.createElement("small"); title.className = "active-preview-status"; title.textContent = "Loading projection stage…";
    const viewport = document.createElement("div"); viewport.className = "active-preview-window";
    const browserOutput = !legacy && node.endsWith("-output");
    const pixelRatio = legacy || browserOutput ? 1 : 0.25;
    const frame = document.createElement("iframe"); frame.className = "active-preview-frame"; frame.title = `${node} projection stage preview`; frame.src = `/otef-interactive/projection.html?span=${branchFor(node)}&preview=1&mapPixelRatio=${pixelRatio}${browserOutput ? "&outputMode=browser" : ""}`;
    viewport.appendChild(frame); surface.appendChild(title); surface.appendChild(viewport); host.appendChild(surface);
    const item = { node, host, surface, title, viewport, frame, ready: false, protocolReady: false, requestId: 0, validationId: 0, validation: null };
    previews.set(node, item);
    const resize = () => {
      const width = Math.max(120, viewport.clientWidth || host.clientWidth || 260);
      const miniatureHeight = width * 1080 / 1920;
      const isExpanded = expanded === item;
      viewport.style.height = isExpanded ? "" : `${miniatureHeight}px`;
      if (overlay && overlay.parentElement === viewport && overlayViewBox) {
        const viewportWidth = viewport.clientWidth || width;
        const viewportHeight = isExpanded ? (viewport.clientHeight || miniatureHeight) : miniatureHeight;
        const mapping = fitWarpViewport(overlayViewBox, viewportWidth, viewportHeight);
        frame.style.left = "0px";
        frame.style.top = "0px";
        frame.style.width = "1920px";
        frame.style.height = "1080px";
        frame.style.transform = `translate(${mapping.image.left}px, ${mapping.image.top}px) scale(${mapping.scale})`;
      } else {
        frame.style.left = "0px";
        frame.style.top = "0px";
        frame.style.width = "1920px";
        frame.style.height = "1080px";
        frame.style.transform = `scale(${width / 1920})`;
      }
    };
    item.resize = resize;
    resize(); const ResizeObserverType = win.ResizeObserver || globalThis.ResizeObserver;
    if (ResizeObserverType) { item.resizeObserver = new ResizeObserverType(resize); item.resizeObserver.observe(viewport); }
    frame.addEventListener?.("load", () => {
      rejectValidation(item, 'final output preview reloaded'); item.ready = true;
      if (item.node.endsWith("-output")) {
        item.protocolReady = false; finalPairReady = false;
        if (loadRetryTimer !== null) clearTimeout(loadRetryTimer);
        loadRetryTimer = setTimeout(() => {
          loadRetryTimer = null;
          if (['left-output', 'right-output'].every((node) => previews.get(node)?.ready)) finalOutputsReadyCallback?.();
        }, 0);
      }
      send(item);
    });
  };
  if (nodeHosts) for (const node of NODES) mount(node, nodeHosts.get(node));
  let expandedEditor = null; let expandedEditorHome = null;
  const closeExpanded = () => {
    if (!expanded) return;
    const item = expanded;
    if (item.surface.parentElement !== item.host) item.host.appendChild(item.surface);
    item.surface.classList?.remove?.("preview-expanded");
    if (expandedEditor && expandedEditorHome?.appendChild && expandedEditor.parentElement !== expandedEditorHome) expandedEditorHome.appendChild(expandedEditor);
    expanded = null;
    expandedEditor = null;
    expandedEditorHome = null;
    if (enlargedHost) {
      enlargedHost.hidden = true;
      enlargedHost.classList?.remove?.("has-editor");
      enlargedHost.replaceChildren?.();
    }
  };
  let show = (node) => {
    const item = previews.get(previewKeyFor(node, previews));
    if (!item) return;
    if (!enlargedHost) { item.surface.classList?.toggle?.("preview-expanded"); return; }
    if (expanded === item) { closeExpanded(); return; }
    closeExpanded();
    const close = document.createElement("button");
    close.type = "button"; close.className = "active-preview-close"; close.textContent = "Close enlarged preview";
    close.setAttribute?.("aria-label", "Close enlarged preview"); close.addEventListener?.("click", closeExpanded);
    const editor = node.endsWith("-keystone") || node.endsWith("-grid") ? enlargedEditor : null;
    const editorHome = editor?.parentElement || null;
    enlargedHost.replaceChildren?.(close, item.surface, ...(editor ? [editor] : []));
    enlargedHost.hidden = false;
    enlargedHost.classList?.toggle?.("has-editor", Boolean(editor));
    item.surface.classList?.add?.("preview-expanded");
    expanded = item;
    expandedEditor = editor;
    expandedEditorHome = editorHome;
    item.resizeObserver?.observe?.(item.viewport);
    item.resize?.();
  };
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
    activeNode = node;
    const item = previews.get(previewKeyFor(node, previews));
    if (!item) return;
    if (expanded && expanded !== item) closeExpanded();
    if (expanded === item) return;
    if (mobileQuery?.matches && mobileHost) {
      mobileHost.appendChild(item.surface);
      for (const other of previews.values()) other.surface.hidden = other !== item;
    } else {
      if (item.surface.parentElement !== item.host) item.host.appendChild(item.surface);
      for (const other of previews.values()) other.surface.hidden = false;
    }
  };
  const setWarpOverlay = (node, element, viewBox = null) => {
    const item = node ? previews.get(previewKeyFor(node, previews)) : null;
    const previousItem = overlay ? [...previews.values()].find((candidate) => candidate.surface.contains?.(overlay) || candidate.viewport.contains?.(overlay)) : null;
    if (overlay && (!element || overlay !== element || previousItem !== item)) {
      const previous = overlay;
      const home = previous.__projectionOverlayHome;
      if (home?.appendChild) home.appendChild(previous);
      previous.classList?.remove?.("warp-preview-overlay");
      previousItem?.resize?.();
      overlay = null;
      overlayViewBox = null;
    }
    if (!node || !element) { closeExpanded(); return; }
    if (!item) return;
    if (expanded && expanded !== item) closeExpanded();
    if (!element.__projectionOverlayHome) element.__projectionOverlayHome = element.parentElement;
    item.viewport.appendChild(element);
    element.classList?.add?.("warp-preview-overlay");
    element.setAttribute?.("preserveAspectRatio", "xMidYMid meet");
    overlay = element; overlayViewBox = viewBox;
    item.resizeObserver?.observe?.(item.viewport);
    item.resize?.();
  };
  const onMediaChange = () => { if (expanded) closeExpanded(); if (mobileQuery?.matches) select(activeNode); else for (const item of previews.values()) { if (item.surface.parentElement !== item.host) item.host.appendChild(item.surface); item.surface.hidden = false; } };
  win.addEventListener("message", onMessage); mobileQuery?.addEventListener?.("change", onMediaChange); onMediaChange();
  const validateCandidate = async ({ config, generation, identity, revision }) => {
    if (identity !== JSON.stringify(config)) return { identity, valid: false, reason: 'stale wall candidate' };
    const pair = ['left-output', 'right-output'].map((node) => previews.get(node));
    if (pair.some((item) => !item)) return { identity, valid: false, reason: 'final output previews unavailable' };
    try {
      const results = await Promise.all(pair.map((item) => new Promise((resolve, reject) => {
        rejectValidation(item, 'superseded wall preview');
        const requestId = ++item.validationId;
        const timer = setTimeout(() => rejectValidation(item, 'wall preview timed out'), 75000);
        item.validation = { requestId, generation, identity, revision, config: clone(config), resolve, reject, timer };
        sendValidation(item);
      })));
      const [left, right] = results;
      const complete = (result) => result.valid === true && result.wall?.expected === result.wall?.placed &&
        Number.isSafeInteger(result.wall.expected) && result.wall.expected > 0 && /^[a-f0-9]{64}$/i.test(result.wall.digest || '');
      const same = complete(left) && complete(right) &&
        ['datasetVersion', 'mode', 'digest', 'expected', 'placed'].every((key) => left.wall[key] === right.wall[key]);
      const leftDiagnostics = boundedDiagnostics(left.diagnostics);
      const rightDiagnostics = boundedDiagnostics(right.diagnostics);
      const diagnosticsMatch = leftDiagnostics && rightDiagnostics && JSON.stringify(leftDiagnostics) === JSON.stringify(rightDiagnostics);
      if (same && (!left.diagnostics && !right.diagnostics || diagnosticsMatch)) return { identity, valid: true, wall: left.wall, ...(diagnosticsMatch ? { diagnostics: leftDiagnostics } : {}) };
      if (!left.valid && !right.valid && diagnosticsMatch && leftDiagnostics.state === "invalid") {
        return { identity, valid: false, reason: left.error || right.error || leftDiagnostics.reason || 'names wall is invalid', diagnostics: leftDiagnostics };
      }
      return { identity, valid: false, reason: left.error || right.error || 'final output wall previews disagree', ...(diagnosticsMatch ? { diagnostics: leftDiagnostics } : {}) };
    } catch (error) {
      for (const item of pair) {
        if (item.validation?.identity === identity && item.validation?.generation === generation) rejectValidation(item, 'paired wall preview cancelled');
      }
      return { identity, valid: false, reason: error?.message || 'wall preview unavailable' };
    }
  };
  return { update(config) { if (!Object.keys(validateProjectionConfig(config || {})).length) { const nextIdentity = JSON.stringify(config); if (latest && JSON.stringify(latest) === nextIdentity) return; if (latest) for (const item of previews.values()) rejectValidation(item, 'stale wall candidate'); latest = clone(config); for (const item of previews.values()) send(item); } }, validateCandidate, onFinalOutputsReady(callback) { finalOutputsReadyCallback = callback; const pair = [previews.get("left-output"), previews.get("right-output")]; if (pair.every((item) => item?.protocolReady)) callback?.(); return () => { if (finalOutputsReadyCallback === callback) finalOutputsReadyCallback = null; }; }, select, show, setWarpOverlay, dispose() { if (loadRetryTimer !== null) clearTimeout(loadRetryTimer); finalOutputsReadyCallback = null; setWarpOverlay(null, null); closeExpanded(); for (const item of previews.values()) { rejectValidation(item, 'wall preview disposed'); item.resizeObserver?.disconnect?.(); item.surface.remove?.(); } previews.clear(); win.removeEventListener("message", onMessage); mobileQuery?.removeEventListener?.("change", onMediaChange); } };
}
