import { DEFAULT_PROJECTION_CONFIG } from "../shared/projection-config-schema.js";
import { visibleT3Rect } from "../shared/projection-config-geometry.js";
import { createNodeCanvas } from "./node-canvas.js";
import { createActiveOutputPreview } from "./active-output-preview.js";

const docFor = (root) => root?.ownerDocument || globalThis.document;
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
  controls.outputIdentify.addEventListener("click", () => { outputSelection = { left: "", right: "" }; outputScreensSignature = null; outputAction("identify"); });
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
    const previewHost = make(doc, "div", { className: "output-preview-host" });
    const previewButton = button(doc, "Enlarge preview", "preview-expand", "preview-button");
    previewButton.addEventListener("click", (event) => { event.stopPropagation?.(); onNode(id); activePreview.show(id); });
    card.append(previewHost, previewButton);
    nodePreviewHosts.set(id, previewHost);
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
  const mobileQuery = doc.defaultView?.matchMedia?.("(max-width: 767px)") || globalThis.matchMedia?.("(max-width: 767px)");
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
  inspector.append(controls.inspectorTitle, controls.previewOutput, mobilePreviewHost, controls.inspectorFields, controls.diagram, controls.patternBranch, controls.pattern, controls.applied);
  workspace.appendChild(inspector);
  app.appendChild(workspace);
  root.appendChild(app);
  const activePreview = createActiveOutputPreview({ document: doc, nodeHosts: nodePreviewHosts, mobileHost: mobilePreviewHost, mobileQuery });
  const canvas = createNodeCanvas({ document: doc, viewport: graphViewport, graph, svg, wire: wirePath, nodeMap, controls: { zoomIn, zoomOut, zoomReset, zoomOne } });
  canvas.mount();

  const setNode = (node) => {
    const selected = node || "pre";
    selector.value = selected;
    canvas.setSelected(selected);
    controls.inspectorNode.textContent = graphNodes.find(([id]) => id === selected)?.[1] || selected;
    controls.previewOutput.hidden = false;
    activePreview.select(selected);
    for (const [id, card] of nodeMap) card.classList?.toggle("selected", id === selected);
    for (const descriptor of descriptors) {
      const control = fields.get(`inspector:${descriptor.path}`);
      if (control) control.wrap.hidden = descriptor.node !== selected;
    }
  };
  const update = ({ state = {}, errors = {}, conflict = "", statusText = "", selectedNode = "pre", statusRows = [], outputState = {} } = {}) => {
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
    const screens = Array.isArray(outputState.screens) ? outputState.screens : [];
    const assignments = outputState.assignments || {};
    const optionFor = (screen) => make(doc, "option", { value: screen.key }, `${screen.label?.trim() || "Display"} · ${screen.left},${screen.top} · ${screen.width}×${screen.height}`);
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
    update, controls, fields, nodeMap,
    dispose() { mobileQuery?.removeEventListener?.("change", openOnPhone); activePreview.dispose(); canvas.dispose(); },
  };
}

export { displayValue, readPath, descriptorFor };
