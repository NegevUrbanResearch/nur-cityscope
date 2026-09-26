import { DEFAULT_PROJECTION_CONFIG } from "../shared/projection-config-schema.js";
import { visibleT3Rect } from "../shared/projection-config-geometry.js";
import { createNodeCanvas } from "./node-canvas.js";
import { createActiveOutputPreview } from "./active-output-preview.js";
import { warpPointFromClient } from "./warp-viewport.js";

const docFor = (root) => root?.ownerDocument || globalThis.document;
const WARP_OUTPUT_WIDTH = 1920;
const WARP_OUTPUT_HEIGHT = 1080;
const WARP_VIEW_PADDING = 72;
function isTouchOnlySurface(doc) {
  const media = doc?.defaultView?.matchMedia;
  if (typeof media !== "function") return false;
  try { return Boolean(media.call(doc.defaultView, "(pointer: coarse)")?.matches || media.call(doc.defaultView, "(hover: none)")?.matches); }
  catch { return false; }
}

function make(doc, tag, props = {}, text = "") {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "dataset" && node.dataset) Object.assign(node.dataset, value);
    else if (key === "ariaLabel") node.setAttribute?.("aria-label", value);
    else if (key === "ariaLive") node.setAttribute?.("aria-live", value);
    else if (key === "ariaHidden") node.setAttribute?.("aria-hidden", value);
    else if (key === "htmlFor") node.htmlFor = value;
    else {
      try { node[key] = value; } catch { node.setAttribute?.(key, value); }
    }
  }
  if (text) node.textContent = text;
  return node;
}

function button(doc, label, action, className = "") {
  const item = make(doc, "button", { type: "button", className, dataset: { action } }, label);
  return item;
}

function pathParts(path) { return path.split("."); }
function readPath(config, path) { return pathParts(path).reduce((value, key) => value?.[key], config); }

function displayValue(descriptor, value) {
  if (!Number.isFinite(Number(value))) return "";
  const shown = descriptor.display === "percentage" ? Number(value) * 100 : Number(value);
  return descriptor.decimals === undefined ? String(shown) : shown.toFixed(descriptor.decimals);
}

function descriptorFor(descriptors, path) { return descriptors.find((item) => item.path === path); }
function svgNode(doc, tag, attrs = {}, text = "") {
  const item = doc.createElementNS?.("http://www.w3.org/2000/svg", tag) || doc.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) item.setAttribute?.(key, value);
  if (text) item.textContent = text;
  return item;
}

function warpViewport(points = []) {
  const coordinates = [[0, 0], [WARP_OUTPUT_WIDTH, 0], [0, WARP_OUTPUT_HEIGHT], [WARP_OUTPUT_WIDTH, WARP_OUTPUT_HEIGHT], ...points.map((point) => [point.x * WARP_OUTPUT_WIDTH, point.y * WARP_OUTPUT_HEIGHT])];
  const xs = coordinates.map(([x]) => x); const ys = coordinates.map(([, y]) => y);
  const minX = Math.min(...xs) - WARP_VIEW_PADDING; const minY = Math.min(...ys) - WARP_VIEW_PADDING;
  const maxX = Math.max(...xs) + WARP_VIEW_PADDING; const maxY = Math.max(...ys) + WARP_VIEW_PADDING;
  return { x: minX, y: minY, width: Math.max(WARP_OUTPUT_WIDTH, maxX - minX), height: Math.max(WARP_OUTPUT_HEIGHT, maxY - minY) };
}

function warpViewBoxValue(viewBox) { return `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`; }

function renderField(doc, descriptor, onField, onNudge, compact = false) {
  const wrap = make(doc, "div", { className: `config-field${compact ? " compact-field" : ""}`, dataset: { path: descriptor.path } });
  const label = make(doc, "label", { className: "config-field-label" }, descriptor.label);
  wrap.appendChild(label);
  const row = make(doc, "div", { className: "config-field-row" });
  const range = make(doc, "input", { type: "range", min: descriptor.displayMin, max: descriptor.displayMax, step: descriptor.displayStep, ariaLabel: descriptor.label, dataset: { field: descriptor.path, input: "range" } });
  const number = compact ? null : make(doc, "input", { type: "number", min: descriptor.displayMin, max: descriptor.displayMax, step: "any", inputMode: "decimal", ariaLabel: descriptor.label, dataset: { field: descriptor.path, input: "number" } });
  const value = make(doc, "output", { className: "config-field-value", htmlFor: descriptor.path });
  const unit = make(doc, "span", { className: "config-field-unit" }, descriptor.unit || "");
  const fineMinus = button(doc, "−", "fine-nudge", "nudge");
  const finePlus = button(doc, "+", "fine-nudge", "nudge");
  const fine = displayValue(descriptor, descriptor.fine);
  fineMinus.title = `Decrease ${descriptor.label} by ${fine}${descriptor.unit || ""}`;
  finePlus.title = `Increase ${descriptor.label} by ${fine}${descriptor.unit || ""}`;
  fineMinus.setAttribute("aria-label", fineMinus.title);
  finePlus.setAttribute("aria-label", finePlus.title);
  fineMinus.dataset.path = descriptor.path; fineMinus.dataset.direction = "-1";
  finePlus.dataset.path = descriptor.path; finePlus.dataset.direction = "1";
  if (compact) row.append(range, value);
  else row.append(range, number, unit, fineMinus, finePlus);
  wrap.appendChild(row);
  const error = make(doc, "small", { className: "config-field-error", role: "alert", dataset: { errorFor: descriptor.path } });
  wrap.appendChild(error);
  const onInput = (event) => onField(descriptor.path, event.currentTarget.value, event.currentTarget.dataset.input);
  const commitNumber = () => onField(descriptor.path, number.value, "number");
  range.addEventListener("input", onInput);
  number?.addEventListener("input", () => { value.textContent = number.value; });
  number?.addEventListener("blur", commitNumber);
  number?.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); if (number.blur) number.blur(); else commitNumber(); } });
  if (!compact) { fineMinus.addEventListener("click", () => onNudge(descriptor.path, -1)); finePlus.addEventListener("click", () => onNudge(descriptor.path, 1)); }
  return { wrap, range, number, value, error };
}

export function createProjectionConfigView(root, {
  descriptors = [],
  onAction = () => {},
  onOutputAction = () => {},
  onField = () => {},
  onNudge = () => {},
  onNode = () => {},
  onWarpAction = () => {},
  onWarpPointer = () => {},
} = {}) {
  const doc = docFor(root);
  if (!root || !doc?.createElement) throw new Error("projection config root is required");
  root.className = "projection-config-app";
  const fields = new Map();
  const controls = {};
  const touchOnlySurface = isTouchOnlySurface(doc);
  let outputSelection = { left: "", right: "" };
  let outputScreensSignature = null;
  let outputAssignmentsSignature = null;
  let selectedGraphNode = "pre";
  const app = make(doc, "div", { className: "config-shell" });
  const chrome = make(doc, "div", { className: "config-chrome" });
  const heading = make(doc, "header", { className: "config-header" });
  heading.append(make(doc, "div", {}, "Projection calibration"), make(doc, "p", { className: "config-subtitle" }, "Tune the shared camera and fixed OTEF projector outputs."));
  chrome.appendChild(heading);

  const toolbar = make(doc, "section", { className: "config-toolbar", ariaLabel: "Calibration actions" });
  controls.live = make(doc, "input", { type: "checkbox", id: "projection-live", checked: true, dataset: { action: "live" } });
  const liveLabel = make(doc, "label", { htmlFor: "projection-live", className: "live-toggle" }, "Live"); liveLabel.prepend(controls.live);
  controls.apply = button(doc, "Apply once", "apply");
  controls.save = button(doc, "Save preset", "save");
  controls.saveName = make(doc, "input", { type: "text", placeholder: "Preset name", maxLength: 80, ariaLabel: "Preset name" });
  controls.saveNew = button(doc, "Save as new", "save-new");
  controls.presets = make(doc, "select", { ariaLabel: "Preset" });
  controls.load = button(doc, "Load", "load");
  controls.revert = button(doc, "Revert", "revert");
  controls.export = button(doc, "Export", "export");
  controls.import = make(doc, "input", { type: "file", accept: "application/json,.json", ariaLabel: "Import calibration" });
  controls.share = button(doc, "Share", "share");
  controls.shareStatus = make(doc, "span", { className: "share-status", role: "status" });
  controls.shareLink = make(doc, "a", { className: "share-link", target: "_blank", rel: "noreferrer", hidden: true }, "");
  controls.shareQr = make(doc, "div", { className: "share-qr", id: "shareQr", hidden: true });
  toolbar.append(liveLabel, controls.apply, controls.save, controls.saveName, controls.saveNew, controls.presets, controls.load, controls.revert, controls.export, controls.import, controls.share, controls.shareStatus, controls.shareLink, controls.shareQr);
  chrome.appendChild(toolbar);
  controls.live.addEventListener("change", () => onAction("live", controls.live.checked));
  controls.apply.addEventListener("click", () => onAction("apply"));
  controls.save.addEventListener("click", () => onAction("save", controls.saveName.value));
  controls.saveNew.addEventListener("click", () => onAction("save-new", controls.saveName.value));
  controls.load.addEventListener("click", () => onAction("load", controls.presets.value));
  controls.revert.addEventListener("click", () => onAction("revert"));
  controls.export.addEventListener("click", () => onAction("export"));
  controls.import.addEventListener("change", () => onAction("import", controls.import.files?.[0] || null));
  controls.share.addEventListener("click", () => onAction("share"));
  controls.presets.addEventListener("change", () => onAction("preset-select", controls.presets.value));

  const outputToolbar = make(doc, "section", { className: "output-launch-controls", ariaLabel: "Workstation browser output controls" });
  const outputTitle = make(doc, "strong", {}, "Workstation browser outputs");
  controls.outputIdentify = button(doc, "Identify displays", "output-identify");
  controls.outputLeftDisplay = make(doc, "select", { ariaLabel: "Left projector display", dataset: { action: "output-left-display" } });
  controls.outputRightDisplay = make(doc, "select", { ariaLabel: "Right projector display", dataset: { action: "output-right-display" } });
  controls.outputAssign = button(doc, "Save display assignment", "output-assign");
  controls.outputOpenBoth = button(doc, "Open Both", "output-open-both");
  controls.outputCloseBoth = button(doc, "Close Both", "output-close-both");
  controls.outputStatus = make(doc, "span", { className: "output-launch-status", role: "status", ariaLive: "polite" });
  controls.outputHandoff = make(doc, "small", { className: "output-launch-handoff" }, "TD projectorWindows off → Open Both; Close Both → TD projectorWindows on. If this page reloads, manually close old browser output windows before reopening.");
  const leftLabel = make(doc, "label", { className: "output-display-label" }, "Left projector"); leftLabel.appendChild(controls.outputLeftDisplay);
  const rightLabel = make(doc, "label", { className: "output-display-label" }, "Right projector"); rightLabel.appendChild(controls.outputRightDisplay);
  outputToolbar.append(outputTitle, controls.outputIdentify, leftLabel, rightLabel, controls.outputAssign, controls.outputOpenBoth, controls.outputCloseBoth, controls.outputStatus, controls.outputHandoff);
  const outputAction = (action, value) => { if (!touchOnlySurface) onOutputAction(action, value); };
  controls.outputIdentify.addEventListener("click", () => outputAction("identify"));
  controls.outputAssign.addEventListener("click", () => outputAction("assign", { left: controls.outputLeftDisplay.value, right: controls.outputRightDisplay.value }));
  controls.outputOpenBoth.addEventListener("click", () => outputAction("open"));
  controls.outputCloseBoth.addEventListener("click", () => outputAction("close"));
  controls.outputLeftDisplay.addEventListener("change", () => { outputSelection.left = controls.outputLeftDisplay.value; });
  controls.outputRightDisplay.addEventListener("change", () => { outputSelection.right = controls.outputRightDisplay.value; });
  for (const control of [controls.outputIdentify, controls.outputAssign, controls.outputOpenBoth, controls.outputCloseBoth, controls.outputLeftDisplay, controls.outputRightDisplay]) control.disabled = touchOnlySurface;
  if (touchOnlySurface) {
    controls.outputStatus.textContent = "Display opening is workstation-only. Use this page to tell the workstation operator which displays to assign and open.";
    controls.outputHandoff.textContent = "Phone/tablet instructions only: on the workstation, turn TD projectorWindows off before Open Both; Close Both before TD projectorWindows on.";
  }
  chrome.appendChild(outputToolbar);

  const status = make(doc, "section", { className: "config-status", role: "status", ariaLive: "polite" });
  controls.status = make(doc, "span", { className: "draft-status" });
  controls.conflict = make(doc, "p", { className: "conflict-banner", role: "alert" });
  controls.actionError = make(doc, "p", { className: "action-error", role: "alert" });
  controls.connectionStatus = make(doc, "p", { className: "connection-status", role: "status" });
  controls.retryHydration = button(doc, "Retry settings check", "retry-hydration");
  status.append(controls.status, controls.conflict, controls.actionError, controls.connectionStatus, controls.retryHydration);
  controls.retryHydration.addEventListener("click", () => onAction("retry-hydration"));
  chrome.appendChild(status);
  app.appendChild(chrome);

  const workspace = make(doc, "div", { className: "config-workspace" });
  const graphColumn = make(doc, "section", { className: "graph-column" });
  const graphTitle = make(doc, "h2", {}, "Calibration path");
  const graphViewport = make(doc, "div", { className: "node-graph-viewport", ariaLabel: "Pannable calibration workspace" });
  const graph = make(doc, "div", { className: "node-graph", ariaLabel: "Projection calibration graph" });
  const graphControls = make(doc, "div", { className: "graph-controls" });
  const zoomOut = button(doc, "−", "zoom-out");
  const zoomReset = button(doc, "Fit", "zoom-reset");
  const zoomOne = button(doc, "100%", "zoom-one");
  const zoomIn = button(doc, "+", "zoom-in");
  graphControls.append(zoomOut, zoomReset, zoomOne, zoomIn);
  graphViewport.append(graphControls, graph);
  const graphNodes = [
    ["content", "Content", "Feeds both projector outputs"], ["pre", "Shared pre-transform", "Affects both projectors"],
    ["left-crop", "Left Crop", "Left projector"], ["right-crop", "Right Crop", "Right projector"],
    ["left-fit", "Left Fit / post", "Left projector"], ["right-fit", "Right Fit / post", "Right projector"],
    ["left-keystone", "Left Keystone", "Projective corners"], ["right-keystone", "Right Keystone", "Projective corners"],
    ["left-grid", "Left Grid Warp", "7 × 7 residual grid"], ["right-grid", "Right Grid Warp", "8 × 7 residual grid"],
    ["left-output", "Left Output", "Left projector"], ["right-output", "Right Output", "Right projector"],
  ];
  const nodeMap = new Map();
  const nodePreviewHosts = new Map();
  const svg = svgNode(doc, "svg", { class: "graph-connectors", "aria-hidden": "true" });
  const wirePath = svgNode(doc, "path", { "vector-effect": "non-scaling-stroke" });
  svg.appendChild(wirePath);
  graph.appendChild(svg);
  for (const [id, label, description] of graphNodes) {
    const card = make(doc, "article", { className: "config-node", dataset: { node: id }, tabIndex: 0 });
    const handle = make(doc, "h3", { title: "Drag to move node" });
    handle.append(make(doc, "span", { className: "node-grip", ariaHidden: "true" }, "⋮⋮"), make(doc, "span", {}, label));
    card.append(handle, make(doc, "p", { className: "node-description" }, description));
    const nodeFields = descriptors.filter((item) => item.node === id);
    for (const descriptor of nodeFields) { const control = renderField(doc, descriptor, onField, onNudge, false); fields.set(`${id}:${descriptor.path}`, control); card.appendChild(control.wrap); }
    if (id.endsWith("-keystone") || id.endsWith("-grid")) card.appendChild(make(doc, "p", { className: "warp-node-summary" }, "Select to edit corners, points, and residuals."));
    const previewHost = id.endsWith("-keystone") || id.endsWith("-grid") ? null : make(doc, "div", { className: "output-preview-host" });
    const previewButton = button(doc, "Enlarge preview", "preview-expand", "preview-button");
    previewButton.addEventListener("click", (event) => { event.stopPropagation?.(); onNode(id); activePreview.show(id); });
    if (previewHost) { card.append(previewHost); nodePreviewHosts.set(id, previewHost); }
    card.append(previewButton);
    const portIn = make(doc, "span", { className: "node-port port-in", ariaHidden: "true", dataset: { port: "in" } });
    const portOut = make(doc, "span", { className: "node-port port-out", ariaHidden: "true", dataset: { port: "out" } });
    card.append(portIn, portOut);
    card.addEventListener("click", () => onNode(id));
    card.addEventListener("keydown", (event) => {
      if (event.target !== card || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      onNode(id);
    });
    nodeMap.set(id, card); graph.appendChild(card);
  }
  graphColumn.append(graphTitle, graphViewport, make(doc, "p", { className: "canvas-help" }, "Drag headers to move nodes · Drag background to pan · Scroll to zoom"));
  const selector = make(doc, "select", { className: "node-selector", ariaLabel: "Calibration node" });
  for (const [id, label] of graphNodes) selector.appendChild(make(doc, "option", { value: id }, label));
  selector.addEventListener("change", () => onNode(selector.value));
  graphColumn.appendChild(selector);
  workspace.appendChild(graphColumn);

  const inspector = make(doc, "details", { className: "inspector", ariaLabel: "Calibration diagnostics" });
  const mobileQuery = doc.defaultView?.matchMedia?.("(max-width: 1100px), (max-height: 700px)") || globalThis.matchMedia?.("(max-width: 1100px), (max-height: 700px)");
  inspector.open = Boolean(mobileQuery?.matches);
  const openOnPhone = (event) => { if (event.matches) inspector.open = true; };
  mobileQuery?.addEventListener?.("change", openOnPhone);
  controls.inspectorTitle = make(doc, "summary", { className: "inspector-title" }, "Controls and diagnostics · ");
  controls.inspectorNode = make(doc, "span", {}, "Shared pre-transform");
  controls.inspectorTitle.append(controls.inspectorNode);
  controls.previewOutput = button(doc, "Enlarge selected preview", "preview-expand", "preview-button");
  controls.previewOutput.addEventListener("click", () => activePreview.show(selector.value));
  const mobilePreviewHost = make(doc, "div", { className: "mobile-preview-host" });
  controls.inspectorFields = make(doc, "div", { className: "inspector-fields" });
  for (const descriptor of descriptors) { const control = renderField(doc, descriptor, onField, onNudge); fields.set(`inspector:${descriptor.path}`, control); controls.inspectorFields.appendChild(control.wrap); }
  controls.warpPanel = make(doc, "section", { className: "warp-inspector", ariaLabel: "Warp editor" });
  controls.warpHeading = make(doc, "h3", {}, "Warp editor");
  controls.warpEnabled = make(doc, "input", { type: "checkbox", ariaLabel: "Enable browser warp" });
  const warpEnabledLabel = make(doc, "label", { className: "warp-enabled-label" }, "Enable browser warp"); warpEnabledLabel.prepend(controls.warpEnabled);
  controls.warpMode = make(doc, "select", { className: "warp-mode", ariaLabel: "Warp stage" });
  controls.warpMode.append(make(doc, "option", { value: "keystone" }, "Keystone"), make(doc, "option", { value: "grid" }, "Grid Warp"));
  controls.warpSelection = make(doc, "div", { className: "warp-selection" });
  let warpViewBox = { x: 0, y: 0, width: WARP_OUTPUT_WIDTH, height: WARP_OUTPUT_HEIGHT };
  controls.warpSurface = svgNode(doc, "svg", { class: "warp-edit-surface", viewBox: warpViewBoxValue(warpViewBox), role: "img", "aria-label": "Warp editing handles" });
  controls.warpStatus = make(doc, "p", { className: "warp-selection-status", role: "status" });
  controls.warpNumeric = make(doc, "div", { className: "warp-numeric" });
  controls.warpPositionX = make(doc, "input", { type: "number", step: "0.25", inputMode: "decimal", ariaLabel: "Selected warp X position" });
  controls.warpPositionY = make(doc, "input", { type: "number", step: "0.25", inputMode: "decimal", ariaLabel: "Selected warp Y position" });
  controls.warpNumeric.append(make(doc, "label", {}, "X px"), controls.warpPositionX, make(doc, "label", {}, "Y px"), controls.warpPositionY);
  controls.warpActions = make(doc, "div", { className: "warp-actions" });
  const warpActionButton = (label, action, value = {}) => { const item = button(doc, label, action, "warp-action"); item.dataset.warpAction = action; Object.assign(item.dataset, Object.fromEntries(Object.entries(value).map(([key, itemValue]) => [key, String(itemValue)]))); item.addEventListener("click", () => onWarpAction(action, value)); return item; };
  controls.warpActions.append(warpActionButton("Reset selection", "warp-reset-selection"), warpActionButton("Reset residuals", "warp-reset-residuals"), warpActionButton("Undo", "warp-undo"), warpActionButton("Redo", "warp-redo"));
  controls.warpArrows = make(doc, "div", { className: "warp-arrows", ariaLabel: "Warp nudge controls" });
  for (const [label, direction] of [["↑", "up"], ["↓", "down"], ["←", "left"], ["→", "right"]]) controls.warpArrows.append(warpActionButton(label, "warp-nudge", { direction }));
  controls.warpStep = make(doc, "select", { className: "warp-step", ariaLabel: "Warp nudge step" });
  controls.warpStep.append(make(doc, "option", { value: "fine" }, "Fine · 0.25 px"), make(doc, "option", { value: "coarse" }, "Coarse · 1 px"));
  controls.warpPanel.append(controls.warpHeading, warpEnabledLabel, controls.warpMode, controls.warpStep, controls.warpArrows, controls.warpSelection, controls.warpSurface, controls.warpStatus, controls.warpNumeric, controls.warpActions);
  controls.warpEnabled.addEventListener("change", () => onWarpAction("warp-enabled", { enabled: controls.warpEnabled.checked }));
  controls.warpMode.addEventListener("change", () => {
    const output = selectedGraphNode.startsWith("right-") ? "right" : "left";
    onNode(`${output}-${controls.warpMode.value === "grid" ? "grid" : "keystone"}`);
  });
  controls.warpStep.addEventListener("change", () => onWarpAction("warp-step", { mode: controls.warpStep.value }));
  const commitWarpPosition = (axis, input) => { const value = Number(input.value); if (Number.isFinite(value)) onWarpAction("warp-set-position", { axis, pixels: value }); };
  controls.warpPositionX.addEventListener("change", () => commitWarpPosition("x", controls.warpPositionX));
  controls.warpPositionY.addEventListener("change", () => commitWarpPosition("y", controls.warpPositionY));
  let pointerId = null;
  let pointerViewBox = null;
  const pointerPosition = (event, viewBox = pointerViewBox || warpViewBox) => { const rect = controls.warpSurface.getBoundingClientRect?.() || { left: 0, top: 0, width: 1920, height: 1080 }; return warpPointFromClient(event, rect, viewBox); };
  controls.warpSurface.addEventListener("pointerdown", (event) => { if (event.button !== undefined && event.button !== 0) return; event.preventDefault?.(); pointerViewBox = { ...warpViewBox }; controls.warpSurface.setAttribute("viewBox", warpViewBoxValue(pointerViewBox)); const point = pointerPosition(event); const index = Number(event.target?.dataset?.index); if (Number.isInteger(index)) onWarpAction("warp-select", { selection: { mode: controls.warpMode.value, kind: controls.warpMode.value === "grid" ? "point" : "corner", index } }); pointerId = event.pointerId ?? 1; controls.warpSurface.setPointerCapture?.(pointerId); onWarpPointer("start", point); });
  controls.warpSurface.addEventListener("pointermove", (event) => { if (pointerId === null || (event.pointerId !== undefined && event.pointerId !== pointerId)) return; onWarpPointer("move", pointerPosition(event)); });
  controls.warpSurface.addEventListener("pointerup", (event) => { if (pointerId === null) return; const point = pointerPosition(event); controls.warpSurface.releasePointerCapture?.(pointerId); pointerId = null; pointerViewBox = null; onWarpPointer("end", point); });
  controls.warpSurface.addEventListener("pointercancel", () => { if (pointerId === null) return; pointerId = null; pointerViewBox = null; onWarpPointer("cancel"); });
  const onKeyDown = (event) => {
    if (!(selectedGraphNode.endsWith("-keystone") || selectedGraphNode.endsWith("-grid"))) return;
    const tag = String(event.target?.tagName || "").toLowerCase();
    if (["input", "textarea", "select", "button"].includes(tag) || event.target?.isContentEditable) return;
    const direction = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" }[event.key];
    if (!direction) return;
    event.preventDefault?.();
    onWarpAction("warp-nudge", { direction, coarse: Boolean(event.shiftKey), fine: Boolean(event.altKey) });
  };
  doc.addEventListener?.("keydown", onKeyDown);
  controls.diagram = make(doc, "div", { className: "crop-diagram", ariaLabel: "Crop diagram" });
  controls.diagram.append(make(doc, "h3", {}, "Crop diagram"), make(doc, "p", { className: "diagram-explanation" }, "Left and right crops are shown over source [0,1]. Each outline marks the part visible after Fit/post. Fit Best centers and fits the crop before post adjustments.") );
  const cropSvg = svgNode(doc, "svg", { class: "crop-diagram-svg", viewBox: "0 0 100 44", role: "img", "aria-label": "Source and left/right crop visible intersection" });
  const sourceRect = svgNode(doc, "rect", { x: "4", y: "8", width: "92", height: "26", fill: "none", stroke: "#7890a8" });
  const leftRect = svgNode(doc, "rect", { x: "4", y: "8", width: "55", height: "26", fill: "#3b8066", opacity: ".35" });
  const rightRect = svgNode(doc, "rect", { x: "45", y: "8", width: "51", height: "26", fill: "#4b688e", opacity: ".35" });
  const leftVisibleRect = svgNode(doc, "rect", { fill: "none", stroke: "#6ee7b7", "stroke-width": "1" });
  const rightVisibleRect = svgNode(doc, "rect", { fill: "none", stroke: "#f6c453", "stroke-width": "1" });
  cropSvg.append(sourceRect, leftRect, rightRect, leftVisibleRect, rightVisibleRect, svgNode(doc, "text", { x: "4", y: "42", fill: "#b8c5d6", "font-size": "5" }, "Source [0,1]"));
  controls.cropSvg = { sourceRect, leftRect, rightRect, leftVisibleRect, rightVisibleRect };
  controls.diagram.appendChild(cropSvg);
  controls.diagram.appendChild(make(doc, "p", { className: "diagram-legend" }, "Green outline: left visible · Amber outline: right visible"));
  controls.pattern = make(doc, "select", { className: "pattern-selector", ariaLabel: "Pattern" });
  controls.pattern.append(make(doc, "option", { value: "off" }, "Pattern: Off"), make(doc, "option", { value: "grid" }, "Pattern: Grid"), make(doc, "option", { value: "output_id" }, "Pattern: Output ID"));
  controls.patternBranch = make(doc, "select", { className: "pattern-branch", ariaLabel: "Pattern output" });
  controls.patternBranch.append(make(doc, "option", { value: "left" }, "Left"), make(doc, "option", { value: "right" }, "Right"));
  controls.pattern.addEventListener("change", () => onAction("pattern", { pattern: controls.pattern.value, branch: controls.patternBranch.value }));
  controls.patternBranch.addEventListener("change", () => onAction("pattern", { pattern: controls.pattern.value, branch: controls.patternBranch.value }));
  controls.applied = make(doc, "div", { className: "applied-status" });
  inspector.append(controls.inspectorTitle, controls.previewOutput, mobilePreviewHost, controls.inspectorFields, controls.warpPanel, controls.diagram, controls.patternBranch, controls.pattern, controls.applied);
  workspace.appendChild(inspector);
  app.appendChild(workspace);
  const enlargedPreviewHost = make(doc, "div", { className: "projection-preview-enlarged-host", hidden: true, ariaLabel: "Enlarged projection preview" });
  app.appendChild(enlargedPreviewHost);
  root.appendChild(app);
  const activePreview = createActiveOutputPreview({ document: doc, nodeHosts: nodePreviewHosts, mobileHost: mobilePreviewHost, mobileQuery, enlargedHost: enlargedPreviewHost, enlargedEditor: controls.warpPanel });
  const canvas = createNodeCanvas({ document: doc, viewport: graphViewport, graph, svg, wire: wirePath, nodeMap, controls: { zoomIn, zoomOut, zoomReset, zoomOne } });
  canvas.mount();

  const setNode = (node) => {
    const selected = node || "pre";
    selectedGraphNode = selected;
    selector.value = selected;
    canvas.setSelected(selected);
    controls.inspectorNode.textContent = graphNodes.find(([id]) => id === selected)?.[1] || selected;
    controls.previewOutput.hidden = false;
    activePreview.select(selected);
    const warpNode = selected.endsWith("-keystone") || selected.endsWith("-grid") ? selected : null;
    activePreview.setWarpOverlay?.(warpNode, warpNode ? controls.warpSurface : null);
    if (selected.endsWith("-keystone") || selected.endsWith("-grid")) inspector.open = true;
    for (const [id, card] of nodeMap) card.classList?.toggle("selected", id === selected);
    for (const descriptor of descriptors) {
      const control = fields.get(`inspector:${descriptor.path}`);
      if (control) control.wrap.hidden = descriptor.node !== selected;
    }
  };
  const renderWarpPanel = (warpStates, node) => {
    const output = node.startsWith("right-") ? "right" : "left";
    const isWarpNode = node.endsWith("-keystone") || node.endsWith("-grid");
    const warpState = warpStates?.[output];
    controls.warpPanel.hidden = !isWarpNode || !warpState;
    if (!warpState || !isWarpNode) return;
    const mode = node.endsWith("-grid") ? "grid" : "keystone";
    controls.warpMode.value = mode;
    controls.warpEnabled.checked = Boolean(warpState.config?.outputs?.[output]?.warp?.enabled);
    controls.warpStep.value = warpState.stepMode || "fine";
    const resetResidualButton = controls.warpActions.children?.[1];
    if (resetResidualButton) resetResidualButton.textContent = warpState.config?.outputs?.[output]?.warp?.baseline?.type === "tdMesh" ? "Reset to imported TD baseline" : "Reset residuals";
    const baselineStatus = warpState.baselineAvailable === false ? " · TD baseline unavailable; reload after repairing the asset" : "";
    controls.warpStatus.textContent = `${output[0].toUpperCase() + output.slice(1)} · ${mode === "grid" ? "Grid Warp" : "Keystone"} · ${warpState.selection?.kind || "point"} ${Number(warpState.selection?.index ?? 0) + 1} · ${warpState.stepMode === "coarse" ? "1 px" : "0.25 px"}${baselineStatus}`;
    const warp = warpState.config.outputs?.[output]?.warp;
    const allHandles = Array.isArray(warpState.handles) ? warpState.handles : [];
    const columns = warp?.grid?.columns || (output === "right" ? 8 : 7);
    const rows = warp?.grid?.rows || 7;
    const selectedIndices = new Set(warpState.selection?.indices || []);
    const chosen = [...selectedIndices].map((index) => allHandles[index]).filter(Boolean);
    const mean = (axis) => chosen.length ? chosen.reduce((sum, point) => sum + (axis === 0 ? point.x : point.y), 0) / chosen.length : 0;
    if (doc.activeElement !== controls.warpPositionX) controls.warpPositionX.value = (mean(0) * WARP_OUTPUT_WIDTH).toFixed(2);
    if (doc.activeElement !== controls.warpPositionY) controls.warpPositionY.value = (mean(1) * WARP_OUTPUT_HEIGHT).toFixed(2);
    controls.warpSelection.replaceChildren();
    const addSelection = (label, selection) => { const item = button(doc, label, "warp-select", "warp-selection-button"); item.addEventListener("click", () => onWarpAction("warp-select", { selection })); controls.warpSelection.appendChild(item); };
    if (mode === "keystone") {
      ["Top left", "Top right", "Bottom left", "Bottom right"].forEach((label, index) => addSelection(label, { mode, kind: "corner", index }));
      ["Top edge", "Right edge", "Bottom edge", "Left edge"].forEach((label, index) => addSelection(label, { mode, kind: "edge", index }));
    } else {
      ["Top edge", "Right edge", "Bottom edge", "Left edge"].forEach((label, index) => addSelection(label, { mode, kind: "edge", index }));
      const picker = make(doc, "select", { className: "warp-selection-picker", ariaLabel: "Grid point, row, column, or edge" });
      const options = [
        ...allHandles.map((_, index) => [`Point ${index + 1}`, "point", index]),
        ...Array.from({ length: rows }, (_, index) => [`Row ${index + 1}`, "row", index]),
        ...Array.from({ length: columns }, (_, index) => [`Column ${index + 1}`, "column", index]),
        ["All points", "all", 0],
      ];
      options.forEach(([label, kind, index]) => picker.appendChild(make(doc, "option", { value: `${kind}:${index}` }, label)));
      picker.value = `${warpState.selection?.kind || "point"}:${warpState.selection?.index || 0}`;
      picker.addEventListener("change", () => { const [kind, index] = picker.value.split(":"); onWarpAction("warp-select", { selection: { mode, kind, index: Number(index) } }); });
      controls.warpSelection.appendChild(picker);
    }
    const viewPoints = allHandles;
    warpViewBox = warpViewport(viewPoints);
    const displayViewBox = pointerViewBox || warpViewBox;
    controls.warpSurface.setAttribute("viewBox", warpViewBoxValue(displayViewBox));
    controls.warpSurface.replaceChildren();
    controls.warpSurface.appendChild(svgNode(doc, "rect", { class: "warp-output-rect", x: "0", y: "0", width: String(WARP_OUTPUT_WIDTH), height: String(WARP_OUTPUT_HEIGHT) }));
    const pathFor = (points) => points.map((point, index) => `${index ? "L" : "M"}${point.x * WARP_OUTPUT_WIDTH} ${point.y * WARP_OUTPUT_HEIGHT}`).join(" ");
    if (mode === "grid" && allHandles.length >= columns * rows) {
      for (let row = 0; row < rows; row += 1) controls.warpSurface.appendChild(svgNode(doc, "path", { class: "warp-grid-line", d: pathFor(allHandles.slice(row * columns, (row + 1) * columns)) }));
      for (let column = 0; column < columns; column += 1) controls.warpSurface.appendChild(svgNode(doc, "path", { class: "warp-grid-line", d: pathFor(Array.from({ length: rows }, (_, row) => allHandles[row * columns + column])) }));
    } else if (allHandles.length >= 4) {
      controls.warpSurface.appendChild(svgNode(doc, "path", { class: "warp-grid-line", d: `${pathFor([allHandles[0], allHandles[1], allHandles[3], allHandles[2]])} Z` }));
    }
    allHandles.forEach((point, index) => {
      const selected = selectedIndices.has(index);
      const circle = svgNode(doc, "circle", { cx: point.x * WARP_OUTPUT_WIDTH, cy: point.y * WARP_OUTPUT_HEIGHT, r: selected ? "18" : "12", class: `warp-handle${selected ? " selected" : ""}`, "data-index": String(index) });
      controls.warpSurface.appendChild(circle);
    });
    activePreview.setWarpOverlay?.(node, controls.warpSurface, displayViewBox);
  };
  const update = ({ state = {}, errors = {}, conflict = "", statusText = "", selectedNode = "pre", statusRows = [], outputState = {}, warpStates = {} } = {}) => {
    controls.live.checked = Boolean(state.live);
    controls.status.textContent = statusText;
    controls.conflict.textContent = conflict;
    controls.conflict.hidden = !conflict;
    const actionError = errors.name || errors.import || errors.action || state.previewError || "";
    controls.actionError.textContent = actionError;
    controls.actionError.hidden = !actionError;
    controls.connectionStatus.textContent = state.hydrationError ? `Settings check failed: ${state.hydrationError}` : state.hydrating ? "Checking current settings…" : "";
    controls.connectionStatus.hidden = !state.hydrating && !state.hydrationError;
    controls.retryHydration.hidden = !state.hydrationError;
    const screens = Array.isArray(outputState.screens) ? [...outputState.screens].sort((a, b) => a.displayNumber - b.displayNumber) : [];
    const assignments = outputState.assignments || {};
    const optionFor = (screen) => make(doc, "option", { value: screen.key }, `Display ${screen.displayNumber}`);
    controls.outputIdentify.disabled = touchOnlySurface || screens.length === 0;
    const selectedKey = (assignment) => screens.find((screen) => assignment?.key === screen.key || (assignment?.label === screen.label && ["left", "top", "width", "height"].every((key) => Number(assignment?.bounds?.[key]) === Number(screen[key]))))?.key || "";
    const screensSignature = screens.map((screen) => screen.key).join("|");
    const assignmentsSignature = JSON.stringify(assignments);
    if (screensSignature !== outputScreensSignature || assignmentsSignature !== outputAssignmentsSignature) outputSelection = { left: selectedKey(assignments.left), right: selectedKey(assignments.right) };
    outputScreensSignature = screensSignature;
    outputAssignmentsSignature = assignmentsSignature;
    controls.outputLeftDisplay.replaceChildren(...screens.map(optionFor));
    controls.outputRightDisplay.replaceChildren(...screens.map(optionFor));
    controls.outputLeftDisplay.value = outputSelection.left;
    controls.outputRightDisplay.value = outputSelection.right;
    controls.outputStatus.textContent = touchOnlySurface ? "Display opening is workstation-only. Use this page to tell the workstation operator which displays to assign and open." : outputState.error || outputState.message || "Identify displays on the workstation.";
    const presets = state.snapshot?.presets || [];
    const selectedPreset = state.selectedPresetId || state.snapshot?.selectedPresetId || "original";
    controls.presets.replaceChildren(...presets.map((preset) => make(doc, "option", { value: preset.id }, preset.name)));
    controls.presets.value = selectedPreset;
    const draft = state.draft || DEFAULT_PROJECTION_CONFIG;
    setNode(selectedNode);
    renderWarpPanel(warpStates, selectedNode);
    activePreview.update(draft);
    const setDiagramRect = (element, rect) => { if (!element) return; element.hidden = !rect; element.setAttribute("visibility", rect ? "visible" : "hidden"); if (!rect) { element.setAttribute("width", "0"); element.setAttribute("height", "0"); return; } element.setAttribute("x", String(4 + rect.x0 * 92)); element.setAttribute("y", String(8 + rect.y0 * 26)); element.setAttribute("width", String(Math.max(0, (rect.x1 - rect.x0) * 92))); element.setAttribute("height", String(Math.max(0, (rect.y1 - rect.y0) * 26))); };
    const left = draft.outputs?.left; const right = draft.outputs?.right;
    setDiagramRect(controls.cropSvg?.leftRect, left?.crop); setDiagramRect(controls.cropSvg?.rightRect, right?.crop);
    setDiagramRect(controls.cropSvg?.leftVisibleRect, left ? visibleT3Rect(left) : null);
    setDiagramRect(controls.cropSvg?.rightVisibleRect, right ? visibleT3Rect(right) : null);
    for (const descriptor of descriptors) {
      const value = readPath(draft, descriptor.path);
      for (const prefix of [descriptor.node, "inspector"]) {
        const control = fields.get(`${prefix}:${descriptor.path}`);
        if (!control) continue;
        const display = displayValue(descriptor, value);
        for (const input of [control.range, control.number]) if (input && doc.activeElement !== input) input.value = display;
        control.value.textContent = `${display}${descriptor.unit ? ` ${descriptor.unit}` : ""}`;
        const fieldError = errors[descriptor.path] || Object.entries(errors).find(([key]) => descriptor.path.startsWith(`${key}.`))?.[1] || "";
        control.error.textContent = fieldError;
        control.wrap.classList?.toggle("has-error", Boolean(fieldError));
      }
    }
    controls.applied.replaceChildren(...statusRows.map((row) => make(doc, "p", { className: row.success ? "applied" : "not-confirmed" }, row.text)));
  };
  setNode("pre");
  return {
    update, controls, fields, nodeMap, canManageDisplays: !touchOnlySurface,
    dispose() { mobileQuery?.removeEventListener?.("change", openOnPhone); doc.removeEventListener?.("keydown", onKeyDown); activePreview.dispose(); canvas.dispose(); },
  };
}

export { displayValue, readPath, descriptorFor };
