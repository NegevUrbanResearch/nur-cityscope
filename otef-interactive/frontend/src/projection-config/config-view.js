import { DEFAULT_PROJECTION_CONFIG } from "../shared/projection-config-schema.js";
import { visibleT3Rect } from "../shared/projection-config-geometry.js";
import { createNodeCanvas } from "./node-canvas.js";
import { createWarpEditorDialog } from "./warp-editor-dialog.js";
import { bindWarpPointerInput } from "./warp-pointer-input.js";
import { clampWarpViewBox, transformWarpViewBox, warpMarkerRadius } from "./warp-viewport.js";
import { createClockLayoutParameters, createClockLayoutStatus } from "./clock-layout-controls.js";
import { createSettlementNameControls } from "./settlement-name-controls.js";

const docFor = (root) => root?.ownerDocument || globalThis.document;
const WARP_OUTPUT_WIDTH = 1920;
const WARP_OUTPUT_HEIGHT = 1080;
const WARP_VIEW_PADDING = 72;
const GIS_CLOCK_SCENES = [["home", "Home"], ["timeline", "Timeline"], ["segev", "Segev"], ["nova", "Nova"], ["sderot", "Sderot"], ["hostages", "Peri Family"], ["hostages_all", "All Hostages"]];
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
function namesWallProfileScoped(path) {
  return path.startsWith("namesWall.") && path !== "namesWall.rotateDeg" && !path.startsWith("namesWall.innerEdgeInsetPx.");
}

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

function renderField(doc, descriptor, onField, onNudge, compact = false, inspector = false) {
  const wrap = make(doc, "div", { className: `config-field${compact ? " compact-field" : ""}${inspector ? " inspector-field" : ""}`, dataset: { path: descriptor.path } });
  const label = make(doc, "label", { className: "config-field-label" }, descriptor.label);
  wrap.appendChild(label);
  const row = make(doc, "div", { className: "config-field-row" });
  const range = make(doc, "input", { type: "range", min: descriptor.displayMin, max: descriptor.displayMax, step: descriptor.displayStep, ariaLabel: descriptor.label, dataset: { field: descriptor.path, input: "range" } });
  const number = compact ? null : make(doc, "input", { type: "number", min: descriptor.displayMin, max: descriptor.displayMax, step: descriptor.integer ? descriptor.displayStep : "any", inputMode: descriptor.integer ? "numeric" : "decimal", ariaLabel: descriptor.label, dataset: { field: descriptor.path, input: "number" } });
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
  const formatInputValue = (raw) => {
    const numeric = Number(raw);
    return String(raw ?? "").trim() === "" || !Number.isFinite(numeric)
      ? ""
      : descriptor.decimals === undefined ? String(numeric) : numeric.toFixed(descriptor.decimals);
  };
  const displayOutput = (raw) => {
    if (!inspector) { value.textContent = String(raw ?? ""); return; }
    const shown = formatInputValue(raw);
    value.textContent = shown ? `${shown}${descriptor.unit ? ` ${descriptor.unit}` : ""}` : "";
  };
  let controlsRow = row;
  if (compact) row.append(range, value);
  else if (inspector) {
    row.className = "config-field-row config-field-range-row";
    row.appendChild(range);
    wrap.appendChild(row);
    controlsRow = make(doc, "div", { className: "config-field-row config-field-controls-row" });
    controlsRow.append(value, number, unit, fineMinus, finePlus);
  } else row.append(range, number, unit, fineMinus, finePlus, ...(descriptor.commitOnChange ? [value] : []));
  if (inspector) wrap.appendChild(controlsRow);
  else wrap.appendChild(row);
  const error = make(doc, "small", { className: "config-field-error", role: "alert", dataset: { errorFor: descriptor.path } });
  wrap.appendChild(error);
  const onInput = (event) => {
    const raw = event.currentTarget.value;
    displayOutput(raw);
    if (number && event.currentTarget === range) number.value = formatInputValue(raw);
    onField(descriptor.path, raw, event.currentTarget.dataset.input);
  };
  const onReleaseInput = () => displayOutput(range.value);
  const commitNumber = () => onField(descriptor.path, number.value, "number");
  range.addEventListener("input", descriptor.commitOnChange ? onReleaseInput : onInput);
  if (descriptor.commitOnChange) range.addEventListener("change", onInput);
  number?.addEventListener("input", () => displayOutput(number.value));
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
  onNamesMode = () => {},
  onNode = () => {},
  onOpenClockEditor = () => {},
  onOpenSettlementEditor = () => {},
  onSettlementOutput = () => {},
  onSettlementCitycode = () => {},
  onSettlementPosition = () => {},
  onSettlementStyle = () => {},
  onSettlementRecovery = () => {},
  onClockScene = () => {},
  onClockElement = () => {},
  onClockField = () => {},
  onClockRecovery = () => {},
  onWarpAction = () => {},
  onWarpPointer = () => {},
} = {}) {
  const doc = docFor(root);
  if (!root || !doc?.createElement) throw new Error("projection config root is required");
  root.className = "projection-config-app";
  const fields = new Map();
  const controls = {};
  const clockNodeStatuses = new Map();
  const touchOnlySurface = isTouchOnlySurface(doc);
  let outputSelection = { left: "", right: "" };
  let outputScreensSignature = null;
  let outputAssignmentsSignature = null;
  let selectedGraphNode = "pre";
  const app = make(doc, "div", { className: "config-shell" });
  const heading = make(doc, "header", { className: "config-header" });
  heading.append(make(doc, "div", {}, "Projection calibration"), make(doc, "p", { className: "config-subtitle" }, "Tune the shared camera and fixed OTEF projector outputs."));
  const commandBar = make(doc, "section", { className: "config-command-bar", ariaLabel: "Calibration commands and utilities" });

  const toolbar = make(doc, "section", { className: "config-toolbar", ariaLabel: "Calibration actions" });
  controls.live = make(doc, "input", { type: "checkbox", id: "projection-live", checked: true, dataset: { action: "live" } });
  const liveLabel = make(doc, "label", { htmlFor: "projection-live", className: "live-toggle" }, "Live"); liveLabel.prepend(controls.live);
  const liveControl = make(doc, "div", { className: "live-control" });
  controls.liveHelp = make(doc, "small", { className: "live-scope-help" }, "Live sends geometry. Use Run later for the names wall.");
  liveControl.append(liveLabel, controls.liveHelp);
  controls.apply = button(doc, "Apply once", "apply");
  controls.save = button(doc, "Save preset", "save");
  controls.loadedPresetIdentity = make(doc, "span", { className: "loaded-preset-identity", role: "status" }, "Loaded: unknown");
  controls.saveName = make(doc, "input", { type: "text", placeholder: "Preset name", maxLength: 80, ariaLabel: "Preset name" });
  let presetNameEdited = false;
  controls.saveName.addEventListener("input", () => { presetNameEdited = true; });
  const setPresetName = (value) => { controls.saveName.value = String(value || ""); presetNameEdited = true; };
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
  toolbar.append(liveControl, controls.apply, controls.loadedPresetIdentity, controls.presets, controls.load);
  commandBar.appendChild(toolbar);
  const taskPicker = make(doc, "div", { className: "config-task-picker" });
  commandBar.appendChild(taskPicker);

  const utilityBar = make(doc, "section", { className: "config-utilities", ariaLabel: "Additional calibration tools" });
  const disclosures = [];
  const disclosure = (className, title, contentClass = "config-disclosure-content") => {
    const details = make(doc, "details", { className: `config-disclosure ${className}` });
    const summary = make(doc, "summary", {}, title);
    const errorIndicator = make(doc, "span", { className: "disclosure-error-indicator", role: "img", ariaLabel: "Unresolved error — open disclosure for details", hidden: true });
    summary.appendChild(errorIndicator);
    const content = make(doc, "div", { className: contentClass });
    const close = button(doc, "Close", "disclosure-close", "disclosure-close");
    const errorDetails = make(doc, "p", { className: "disclosure-error-details", role: "alert", hidden: true });
    close.addEventListener("click", () => { details.open = false; summary.focus(); });
    summary.addEventListener("click", () => { if (!details.open) for (const other of disclosures) if (other !== details) other.open = false; });
    content.append(close, errorDetails);
    details.append(summary, content);
    details.addEventListener("toggle", () => { if (details.open) for (const other of disclosures) if (other !== details) other.open = false; });
    disclosures.push(details);
    return { details, content, summary, errorIndicator, errorDetails };
  };
  const presetDisclosure = disclosure("config-disclosure-preset", "Preset management");
  controls.presetErrorIndicator = presetDisclosure.errorIndicator;
  controls.presetErrorDetails = presetDisclosure.errorDetails;
  presetDisclosure.content.append(make(doc, "small", { className: "preset-scope-help" }, "Presets include geometry and people-wall settings. Clock and settlement layouts save independently."), controls.save, controls.saveName, controls.saveNew, controls.revert);
  const moreDisclosure = disclosure("config-disclosure-more", "More");
  controls.moreErrorIndicator = moreDisclosure.errorIndicator;
  controls.moreErrorDetails = moreDisclosure.errorDetails;
  moreDisclosure.content.append(controls.export, controls.import, controls.share, controls.shareStatus, controls.shareLink, controls.shareQr);
  const outputDisclosure = disclosure("config-disclosure-workstation", "Workstation outputs", "config-disclosure-content output-launch-controls");
  controls.outputErrorIndicator = outputDisclosure.errorIndicator;
  controls.outputErrorDetails = outputDisclosure.errorDetails;
  outputDisclosure.content.prepend(make(doc, "strong", {}, "Workstation browser outputs"));
  utilityBar.append(presetDisclosure.details, moreDisclosure.details, outputDisclosure.details);
  commandBar.appendChild(utilityBar);
  const dismissDisclosures = (event) => {
    if (event.type === "keydown") {
      if (event.key !== "Escape") return;
      const opened = disclosures.find((item) => item.open);
      if (!opened) return;
      event.preventDefault(); opened.open = false; opened.querySelector("summary")?.focus(); return;
    }
    if (!disclosures.some((item) => item.open)) return;
    if (utilityBar.contains?.(event.target)) return;
    if (event.type === "pointerdown" && event.target?.closest?.(".node-graph-viewport, .config-node, .warp-edit-surface")) event.stopPropagation?.();
    for (const item of disclosures) if (item.open) item.open = false;
  };
  doc.addEventListener?.("pointerdown", dismissDisclosures, true);
  doc.addEventListener?.("keydown", dismissDisclosures);
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

  const outputToolbar = outputDisclosure.content;
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
  outputToolbar.append(controls.outputIdentify, leftLabel, rightLabel, controls.outputAssign, controls.outputOpenBoth, controls.outputCloseBoth, controls.outputStatus, controls.outputHandoff);
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

  const status = make(doc, "section", { className: "config-status", role: "status", ariaLive: "polite" });
  controls.status = make(doc, "span", { className: "draft-status" });
  controls.conflict = make(doc, "p", { className: "conflict-banner", role: "alert" });
  controls.actionError = make(doc, "p", { className: "action-error", role: "alert" });
  controls.connectionStatus = make(doc, "p", { className: "connection-status", role: "status" });
  controls.retryHydration = button(doc, "Retry settings check", "retry-hydration");
  status.append(controls.status, controls.conflict, controls.actionError, controls.connectionStatus, controls.retryHydration);
  controls.retryHydration.addEventListener("click", () => onAction("retry-hydration"));
  commandBar.appendChild(status);
  app.append(heading, commandBar);

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
    ["content", "Content", "Feeds both projector outputs"], ["names-wall", "Names wall", "NLI memorial-name profile; does not change projection geometry"],
    ["settlement-names", "Settlement names", "Place settlement labels on the left and right projectors"],
    ["clock-gis", "GIS Clock", "Clock layouts for GIS scenes"], ["clock-projection", "Projection Clock / Legend", "Shared left projection overlays"],
    ["pre", "Shared pre-transform", "Affects both projectors"],
    ["left-crop", "Left Crop", "Left projector"], ["right-crop", "Right Crop", "Right projector"],
    ["left-fit", "Left Fit / post", "Left projector"], ["right-fit", "Right Fit / post", "Right projector"],
    ["left-keystone", "Left Keystone", "Projective corners"], ["right-keystone", "Right Keystone", "Projective corners"],
    ["left-grid", "Left Grid Warp", "7 × 7 residual grid"], ["right-grid", "Right Grid Warp", "8 × 7 residual grid"],
    ["left-output", "Left Output", "Left projector"], ["right-output", "Right Output", "Right projector"],
  ];
  const nodeMap = new Map();
  const namesModeControls = [];
  const namesStatusControls = [];
  const modelSpacingHelpControls = [];
  const pageSpacingResetControls = [];
  const namesWallUnitsHelp = "Font, spacing, and edge inset use reference-plane pixels. Inner-edge clearances reserve final-output pixels in both modes and repack names.";
  const namesWallRotationHelp = "Rotation applies to both wall and model profiles and follows Live, Apply, and Save.";
  function pageSpacingReset() {
    const reset = button(doc, "Reset page spacing to 0%", "reset-page-spacing");
    reset.addEventListener("click", (event) => {
      event.stopPropagation?.();
      onField("namesWall.inwardShiftPercent", "0", "number");
    });
    pageSpacingResetControls.push(reset);
    return reset;
  }
  function namesModeControl() {
    const label = make(doc, "label", { className: "names-wall-mode-label" }, "Profile");
    const select = make(doc, "select", { className: "names-wall-mode", ariaLabel: "Names wall profile" });
    select.append(make(doc, "option", { value: "wall" }, "Regular wall"), make(doc, "option", { value: "model" }, "Model-oriented"));
    select.addEventListener("change", () => onNamesMode(select.value));
    label.appendChild(select);
    namesModeControls.push(select);
    return label;
  }
  function namesStatus() {
    const status = make(doc, "p", { className: "names-wall-status", role: "status", ariaLive: "polite", title: "Font, spacing, and edge inset use reference-plane pixels; the two inner-edge insets use final-output pixels." });
    namesStatusControls.push(status);
    return status;
  }
  function modelSpacingHelp() {
    const help = make(doc, "p", { className: "names-wall-units names-wall-model-help" }, "Rows spread across the model. Set 0 for the tightest fit.");
    modelSpacingHelpControls.push(help);
    return help;
  }
  const svg = svgNode(doc, "svg", { class: "graph-connectors", "aria-hidden": "true" });
  const wirePath = svgNode(doc, "path", { "vector-effect": "non-scaling-stroke" });
  svg.appendChild(wirePath);
  graph.appendChild(svg);
  for (const [id, label, description] of graphNodes) {
    const card = make(doc, "article", { className: "config-node", dataset: { node: id }, tabIndex: 0 });
    const handle = make(doc, "h3", { title: "Drag to move node" });
    handle.append(make(doc, "span", { className: "node-grip", ariaHidden: "true" }, "⋮⋮"), make(doc, "span", {}, label));
    card.append(handle, make(doc, "p", { className: "node-description" }, description));
    if (id === "names-wall") {
      card.append(namesModeControl(), make(doc, "p", { className: "names-wall-units" }, namesWallUnitsHelp),
        make(doc, "p", { className: "names-wall-units names-wall-rotation" }, namesWallRotationHelp));
    }
    let sceneControl = null;
    let elementControl = null;
    if (id === "clock-gis") {
      sceneControl = make(doc, "select", { className: "clock-scene-selector", ariaLabel: "GIS clock preview scene", dataset: { action: "clock-scene" } });
      for (const [value, label] of GIS_CLOCK_SCENES) sceneControl.appendChild(make(doc, "option", { value }, label));
      sceneControl.addEventListener("click", (event) => event.stopPropagation?.());
      sceneControl.addEventListener("change", () => onClockScene(sceneControl.value));
      controls.gisClockScene = sceneControl;
      card.appendChild(sceneControl);
    }
    if (id === "clock-projection") {
      elementControl = make(doc, "select", { className: "clock-element-selector", ariaLabel: "Projection overlay", dataset: { action: "clock-element" } });
      elementControl.append(make(doc, "option", { value: "clock" }, "Clock"), make(doc, "option", { value: "legend" }, "Legend"));
      elementControl.addEventListener("click", (event) => event.stopPropagation?.());
      elementControl.addEventListener("change", () => onClockElement(elementControl.value));
      controls.projectionElement = elementControl;
      card.appendChild(elementControl);
    }
    const nodeFields = descriptors.filter((item) => item.node === id);
    for (const descriptor of nodeFields) { const control = renderField(doc, descriptor, onField, onNudge, false); fields.set(`${id}:${descriptor.path}`, control); card.appendChild(control.wrap); }
    if (id === "names-wall") card.append(modelSpacingHelp(), make(doc, "p", { className: "names-wall-units" }, "0 keeps the current positions. Increase to move the pages inward where space allows."), pageSpacingReset(), namesStatus());
    if (id.endsWith("-keystone") || id.endsWith("-grid")) card.appendChild(make(doc, "p", { className: "warp-node-summary" }, "Select to edit corners, points, and residuals."));
    if (id.endsWith("-keystone") || id.endsWith("-grid")) {
      const openButton = button(doc, "Open fullscreen editor", "warp-editor-open", "warp-open-button");
      openButton.addEventListener("click", (event) => { event.stopPropagation?.(); cancelActiveDrag(); onNode(id); resetWarpView(); dialog.open({ side: id.startsWith("right-") ? "right" : "left", mode: id.endsWith("-grid") ? "grid" : "keystone", opener: openButton }); });
      card.appendChild(openButton);
    }
    if (id === "settlement-names") {
      const openButton = button(doc, "Open editor", "settlement-editor-open", "settlement-open-button");
      openButton.addEventListener("click", (event) => { event.stopPropagation?.(); cancelActiveDrag(); onNode(id); onOpenSettlementEditor(); });
      card.appendChild(openButton);
    }
    if (id === "clock-gis" || id === "clock-projection") {
      const layoutStatus = createClockLayoutStatus(doc, {
        onRetry: () => onClockRecovery("retry", id), onLoad: () => onClockRecovery("load", id),
      });
      clockNodeStatuses.set(id, layoutStatus); card.appendChild(layoutStatus.element);
      const openButton = button(doc, "Open editor", "clock-editor-open", "clock-open-button");
      openButton.addEventListener("click", (event) => { event.stopPropagation?.(); cancelActiveDrag(); onNode(id); onOpenClockEditor(id); });
      card.addEventListener("dblclick", (event) => {
        if (event.target === handle || event.target?.parentElement === handle || event.target === sceneControl || event.target === elementControl || event.target === openButton) return;
        cancelActiveDrag(); onNode(id); onOpenClockEditor(id);
      });
      card.appendChild(openButton);
    }
    if (id !== "names-wall" && id !== "settlement-names") {
      const portIn = make(doc, "span", { className: "node-port port-in", ariaHidden: "true", dataset: { port: "in" } });
      const portOut = make(doc, "span", { className: "node-port port-out", ariaHidden: "true", dataset: { port: "out" } });
      card.append(portIn, portOut);
    }
    card.addEventListener("click", () => onNode(id));
    card.addEventListener("keydown", (event) => {
      if (event.target !== card || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      onNode(id);
      if (event.key === "Enter" && (id === "clock-gis" || id === "clock-projection")) onOpenClockEditor(id);
      if (event.key === "Enter" && id === "settlement-names") onOpenSettlementEditor();
    });
    nodeMap.set(id, card); graph.appendChild(card);
  }
  graphColumn.append(graphTitle, graphViewport, make(doc, "p", { className: "canvas-help" }, "Drag headers to move nodes · Drag background to pan · Scroll to zoom"));
  const selector = make(doc, "select", { className: "node-selector", ariaLabel: "Calibration node" });
  for (const [id, label] of graphNodes) selector.appendChild(make(doc, "option", { value: id }, label));
  selector.addEventListener("change", () => onNode(selector.value));
  const mobileOpen = button(doc, "Open editor", "warp-editor-open-mobile", "mobile-warp-open");
  mobileOpen.addEventListener("click", () => {
    const id = selector.value;
    if (id === "clock-gis" || id === "clock-projection") { cancelActiveDrag(); onNode(id); onOpenClockEditor(id); return; }
    if (id === "settlement-names") { cancelActiveDrag(); onNode(id); onOpenSettlementEditor(); return; }
    if (!id.endsWith("-keystone") && !id.endsWith("-grid")) return;
    cancelActiveDrag(); onNode(id); resetWarpView(); dialog.open({ side: id.startsWith("right-") ? "right" : "left", mode: id.endsWith("-grid") ? "grid" : "keystone", opener: mobileOpen });
  });
  taskPicker.append(selector, mobileOpen);
  workspace.appendChild(graphColumn);

  const inspector = make(doc, "details", { className: "inspector", ariaLabel: "Calibration diagnostics" });
  const mobileQuery = doc.defaultView?.matchMedia?.("(max-width: 1100px), (max-height: 700px), (pointer: coarse), (hover: none), (orientation: portrait)") || globalThis.matchMedia?.("(max-width: 1100px), (max-height: 700px), (pointer: coarse), (hover: none), (orientation: portrait)");
  inspector.open = Boolean(mobileQuery?.matches);
  const openOnPhone = (event) => { if (event.matches) inspector.open = true; };
  mobileQuery?.addEventListener?.("change", openOnPhone);
  controls.inspectorTitle = make(doc, "summary", { className: "inspector-title" }, "Controls and diagnostics · ");
  controls.inspectorNode = make(doc, "span", {}, "Shared pre-transform");
  controls.inspectorTitle.append(controls.inspectorNode);
  controls.inspectorFields = make(doc, "div", { className: "inspector-fields" });
  controls.namesWallInspector = make(doc, "section", { className: "names-wall-inspector", ariaLabel: "Names wall profile controls" });
  controls.namesWallInspector.append(namesModeControl(), make(doc, "p", { className: "names-wall-units" }, namesWallUnitsHelp),
    make(doc, "p", { className: "names-wall-units names-wall-rotation" }, namesWallRotationHelp),
    modelSpacingHelp(), make(doc, "p", { className: "names-wall-units" }, "0 keeps the current positions. Increase to move the pages inward where space allows."), pageSpacingReset(), namesStatus());
  for (const descriptor of descriptors) { const control = renderField(doc, descriptor, onField, onNudge, false, true); fields.set(`inspector:${descriptor.path}`, control); controls.inspectorFields.appendChild(control.wrap); }
  controls.warpPanel = make(doc, "section", { className: "warp-inspector", ariaLabel: "Warp editor" });
  controls.warpHeading = make(doc, "h3", {}, "Warp editor");
  controls.warpEnabled = make(doc, "input", { type: "checkbox", ariaLabel: "Enable browser warp" });
  const warpEnabledLabel = make(doc, "label", { className: "warp-enabled-label" }, "Enable browser warp"); warpEnabledLabel.prepend(controls.warpEnabled);
  controls.warpMode = make(doc, "select", { className: "warp-mode", ariaLabel: "Warp stage" });
  controls.warpMode.append(make(doc, "option", { value: "keystone" }, "Keystone"), make(doc, "option", { value: "grid" }, "Grid Warp"));
  controls.warpSelection = make(doc, "div", { className: "warp-selection" });
  let warpViewBox = { x: 0, y: 0, width: WARP_OUTPUT_WIDTH, height: WARP_OUTPUT_HEIGHT };
  let effectiveWarpViewBox = null;
  let warpViewTarget = "";
  let warpPanMode = false;
  controls.warpSurface = svgNode(doc, "svg", { class: "warp-edit-surface", viewBox: warpViewBoxValue(warpViewBox), role: "img", "aria-label": "Warp editing handles" });
  const navigationControls = make(doc, "div", { className: "warp-view-controls", ariaLabel: "Warp preview navigation" });
  const navButton = (label, className, action) => { const item = make(doc, "button", { type: "button", className }, label); item.addEventListener("click", action); navigationControls.appendChild(item); return item; };
  const panToggle = navButton("Move view", "warp-pan-toggle", () => { if (!pointerInput?.isActive()) warpPanMode = !warpPanMode; panToggle.setAttribute("aria-pressed", String(warpPanMode)); });
  const applyViewBox = (next, navigation = {}) => {
    if (!next || !warpViewBox) return;
    effectiveWarpViewBox = clampWarpViewBox(next, warpViewBox, navigation);
    controls.warpSurface.setAttribute("viewBox", warpViewBoxValue(effectiveWarpViewBox));
    dialog.setViewBox(effectiveWarpViewBox);
    updateWarpMarkerRadii();
  };
  function updateWarpMarkerRadii() {
    const rect = controls.warpSurface.getBoundingClientRect?.() || { width: WARP_OUTPUT_WIDTH, height: WARP_OUTPUT_HEIGHT };
    if (!rect.width || !rect.height) return;
    const viewBox = effectiveWarpViewBox || warpViewBox;
    controls.warpSurface.querySelectorAll?.(".warp-handle").forEach((circle) => {
      const radius = circle.classList?.contains("selected") ? 18 : 12;
      circle.setAttribute("r", String(warpMarkerRadius(viewBox, rect.width, rect.height, radius)));
    });
  }
  function resetWarpView() { warpPanMode = false; panToggle.setAttribute("aria-pressed", "false"); effectiveWarpViewBox = warpViewBox; applyViewBox(warpViewBox); }
  navButton("−", "warp-view-zoom-out", () => { if (pointerInput?.isActive() || !effectiveWarpViewBox) return; applyViewBox({ ...effectiveWarpViewBox, width: effectiveWarpViewBox.width * 1.25, height: effectiveWarpViewBox.height * 1.25, x: effectiveWarpViewBox.x - effectiveWarpViewBox.width * 0.125, y: effectiveWarpViewBox.y - effectiveWarpViewBox.height * 0.125 }); });
  navButton("+", "warp-view-zoom-in", () => { if (pointerInput?.isActive() || !effectiveWarpViewBox) return; applyViewBox({ ...effectiveWarpViewBox, width: effectiveWarpViewBox.width / 1.25, height: effectiveWarpViewBox.height / 1.25, x: effectiveWarpViewBox.x + effectiveWarpViewBox.width * 0.1, y: effectiveWarpViewBox.y + effectiveWarpViewBox.height * 0.1 }); });
  navButton("Fit", "warp-view-fit", () => { if (pointerInput?.isActive()) return; warpPanMode = false; panToggle.setAttribute("aria-pressed", "false"); applyViewBox(warpViewBox); });
  controls.warpSurface.addEventListener("wheel", (event) => {
    if (!dialog.isOpen() || pointerInput?.isActive() || !effectiveWarpViewBox) return;
    event.preventDefault();
    const rect = controls.warpSurface.getBoundingClientRect?.() || { left: 0, top: 0, width: 1, height: 1 };
    const factor = Math.exp(-event.deltaY * 0.002);
    const next = transformWarpViewBox(effectiveWarpViewBox, { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, { from: { clientX: event.clientX, clientY: event.clientY }, factor });
    applyViewBox(next, { anchor: { clientX: event.clientX, clientY: event.clientY }, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } });
  }, { passive: false });
  controls.warpStatus = make(doc, "p", { className: "warp-selection-status", role: "status" });
  controls.warpNumeric = make(doc, "div", { className: "warp-numeric" });
  controls.warpPositionX = make(doc, "input", { type: "number", step: "0.25", inputMode: "decimal", ariaLabel: "Selected warp X position" });
  controls.warpPositionY = make(doc, "input", { type: "number", step: "0.25", inputMode: "decimal", ariaLabel: "Selected warp Y position" });
  controls.warpNumeric.append(make(doc, "label", {}, "X px"), controls.warpPositionX, make(doc, "label", {}, "Y px"), controls.warpPositionY);
  controls.warpActions = make(doc, "div", { className: "warp-actions" });
  const warpActionButton = (label, action, value = {}) => { const item = button(doc, label, action, "warp-action"); item.dataset.warpAction = action; Object.assign(item.dataset, Object.fromEntries(Object.entries(value).map(([key, itemValue]) => [key, String(itemValue)]))); item.addEventListener("click", (event) => { onWarpAction(action, value); if (action === "warp-nudge" && event.detail > 0) controls.warpSurface.focus?.(); }); return item; };
  controls.warpUndo = warpActionButton("Undo", "warp-undo");
  controls.warpActions.append(warpActionButton("Reset selection", "warp-reset-selection"), warpActionButton("Reset residuals", "warp-reset-residuals"), controls.warpUndo, warpActionButton("Redo", "warp-redo"));
  controls.warpArrows = make(doc, "div", { className: "warp-arrows", ariaLabel: "Warp nudge controls" });
  for (const [label, direction] of [["↑", "up"], ["↓", "down"], ["←", "left"], ["→", "right"]]) controls.warpArrows.append(warpActionButton(label, "warp-nudge", { direction }));
  controls.warpStep = make(doc, "select", { className: "warp-step", ariaLabel: "Warp nudge step" });
  controls.warpStep.append(make(doc, "option", { value: "fine" }, "Fine · 0.25 px"), make(doc, "option", { value: "coarse" }, "Coarse · 1 px"));
  const finePrimary = make(doc, "div", { className: "warp-fine-primary" });
  finePrimary.append(controls.warpStatus, controls.warpSelection, controls.warpStep, controls.warpArrows, controls.warpUndo);
  const fineSecondary = make(doc, "div", { className: "warp-fine-secondary" });
  fineSecondary.append(warpEnabledLabel, controls.warpMode, controls.warpNumeric, controls.warpActions);
  controls.warpPanel.append(controls.warpHeading, finePrimary, fineSecondary, controls.warpSurface);
  controls.warpEnabled.addEventListener("change", () => onWarpAction("warp-enabled", { enabled: controls.warpEnabled.checked }));
  controls.warpMode.addEventListener("change", () => {
    const output = selectedGraphNode.startsWith("right-") ? "right" : "left";
    cancelActiveDrag();
    onNode(`${output}-${controls.warpMode.value === "grid" ? "grid" : "keystone"}`);
    if (dialog.isOpen()) { resetWarpView(); dialog.open({ side: output, mode: controls.warpMode.value, opener: controls.warpMode }); }
  });
  controls.warpStep.addEventListener("change", () => onWarpAction("warp-step", { mode: controls.warpStep.value }));
  const warpPositionErrors = new Map();
  for (const [axis, input] of [["x", controls.warpPositionX], ["y", controls.warpPositionY]]) {
    const error = make(doc, "span", { id: `warp-position-${axis}-error`, className: "warp-position-error", role: "alert", ariaLive: "polite" });
    input.setAttribute("aria-describedby", error.id);
    controls.warpNumeric.appendChild(error);
    warpPositionErrors.set(axis, error);
  }
  const commitWarpPosition = (axis, input) => {
    const raw = input.value.trim();
    const error = warpPositionErrors.get(axis);
    if (!raw || !Number.isFinite(Number(raw))) {
      input.setAttribute("aria-invalid", "true");
      error.textContent = "Enter a finite coordinate before applying this position.";
      return;
    }
    input.removeAttribute("aria-invalid");
    error.textContent = "";
    onWarpAction("warp-set-position", { axis, pixels: Number(raw) });
  };
  controls.warpPositionX.addEventListener("change", () => commitWarpPosition("x", controls.warpPositionX));
  controls.warpPositionY.addEventListener("change", () => commitWarpPosition("y", controls.warpPositionY));
  let currentHandles = [];
  let currentSelection = null;
  let lastLoadedPresetId = null;
  let lastLoadedPresetLoadToken = null;
  let pointerInput;
  function cancelActiveDrag(options) { pointerInput?.cancel(options); }
  const onKeyDown = (event) => {
    if (!dialog.isOpen() || !(selectedGraphNode.endsWith("-keystone") || selectedGraphNode.endsWith("-grid"))) return;
    if (event.target !== controls.warpSurface && !controls.warpSurface.contains?.(event.target)) return;
    const tag = String(event.target?.tagName || "").toLowerCase();
    if (["input", "textarea", "select", "button"].includes(tag) || event.target?.isContentEditable || event.target?.closest?.("[contenteditable]")) return;
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
  controls.clockSettings = make(doc, "section", { className: "clock-settings-inspector", ariaLabel: "Clock preview selection", hidden: true });
  controls.clockSceneInspector = make(doc, "select", { ariaLabel: "GIS clock preview scene" });
  for (const [value, label] of GIS_CLOCK_SCENES) controls.clockSceneInspector.appendChild(make(doc, "option", { value }, label));
  controls.clockSceneInspector.addEventListener("click", (event) => event.stopPropagation?.());
  controls.clockSceneInspector.addEventListener("change", () => onClockScene(controls.clockSceneInspector.value));
  controls.clockElementInspector = make(doc, "select", { ariaLabel: "Projection overlay" });
  controls.clockElementInspector.append(make(doc, "option", { value: "clock" }, "Clock"), make(doc, "option", { value: "legend" }, "Legend"));
  controls.clockElementInspector.addEventListener("click", (event) => event.stopPropagation?.());
  controls.clockElementInspector.addEventListener("change", () => onClockElement(controls.clockElementInspector.value));
  controls.clockSettings.append(controls.clockSceneInspector, controls.clockElementInspector);
  const clockParameters = createClockLayoutParameters(doc, { onField: onClockField });
  const clockInspectorStatus = createClockLayoutStatus(doc, {
    onRetry: () => onClockRecovery("retry", selectedGraphNode), onLoad: () => onClockRecovery("load", selectedGraphNode),
  });
  controls.clockSettings.append(clockParameters.element, clockInspectorStatus.element);
  controls.settlementSettings = make(doc, "section", { className: "settlement-settings-inspector", ariaLabel: "Settlement name settings", hidden: true });
  const settlementControls = createSettlementNameControls(doc, {
    onOutput: onSettlementOutput,
    onCitycode: onSettlementCitycode,
    onPosition: onSettlementPosition,
    onStyle: onSettlementStyle,
    onRetry: () => onSettlementRecovery("retry"),
    onLoad: () => onSettlementRecovery("load"),
  });
  controls.settlementSettings.appendChild(settlementControls.element);
  inspector.append(controls.inspectorTitle, controls.clockSettings, controls.settlementSettings, controls.namesWallInspector, controls.inspectorFields, controls.warpPanel, controls.diagram, controls.patternBranch, controls.pattern, controls.applied);
  workspace.appendChild(inspector);
  app.appendChild(workspace);
  root.appendChild(app);
  const dialog = createWarpEditorDialog({ document: doc, host: root, editorPanel: controls.warpPanel, overlay: controls.warpSurface, navigationControls,
    onBeforeClose: cancelActiveDrag,
    onBeforeSwitch: cancelActiveDrag,
    onFineToggle: cancelActiveDrag,
    onBeforeResize: cancelActiveDrag,
    onViewportChange: updateWarpMarkerRadii,
    onOrientationChange: () => { cancelActiveDrag(); resetWarpView(); },
    onApply: () => onAction("apply"), onLive: (live) => onAction("live", live) });
  pointerInput = bindWarpPointerInput({
    surface: controls.warpSurface,
    readGeometry: () => dialog.isOpen() ? { rect: controls.warpSurface.getBoundingClientRect?.() || { left: 0, top: 0, width: 1920, height: 1080 }, viewBox: effectiveWarpViewBox || warpViewBox, baseViewBox: warpViewBox, panMode: warpPanMode, handles: currentHandles, selection: currentSelection, mode: controls.warpMode.value, side: selectedGraphNode.startsWith("right-") ? "right" : "left" } : null,
    onNavigate: ({ viewBox }) => applyViewBox(viewBox),
    onSelect: ({ output, selection }) => onWarpAction("warp-select", { output, selection }),
    onStart: (point) => onWarpPointer("start", point),
    onMove: (point) => onWarpPointer("move", point),
    onEnd: (point) => onWarpPointer("end", point),
    onCancel: (point) => onWarpPointer("cancel", point),
  });
  const canvas = createNodeCanvas({ document: doc, viewport: graphViewport, graph, svg, wire: wirePath, nodeMap, controls: { zoomIn, zoomOut, zoomReset, zoomOne } });
  canvas.mount();

  const setNode = (node) => {
    const selected = node || "pre";
    selectedGraphNode = selected;
    selector.value = selected;
    canvas.setSelected(selected);
    controls.inspectorNode.textContent = graphNodes.find(([id]) => id === selected)?.[1] || selected;
    const isClockNode = selected === "clock-gis" || selected === "clock-projection";
    const isSettlementNode = selected === "settlement-names";
    mobileOpen.hidden = !(isClockNode || isSettlementNode || selected.endsWith("-keystone") || selected.endsWith("-grid"));
    mobileOpen.textContent = isClockNode || isSettlementNode ? "Open editor" : "Open fullscreen editor";
    controls.clockSettings.hidden = !isClockNode;
    controls.settlementSettings.hidden = !isSettlementNode;
    controls.clockSceneInspector.hidden = selected !== "clock-gis";
    controls.clockElementInspector.hidden = selected !== "clock-projection";
    if (isClockNode || isSettlementNode || selected.endsWith("-keystone") || selected.endsWith("-grid")) inspector.open = true;
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
    const target = `${output}:${mode}`;
    const targetChanged = target !== warpViewTarget;
    warpViewTarget = target;
    controls.warpMode.value = mode;
    controls.warpEnabled.checked = Boolean(warpState.config?.outputs?.[output]?.warp?.enabled);
    controls.warpStep.value = warpState.stepMode || "fine";
    const resetResidualButton = controls.warpActions.children?.[1];
    if (resetResidualButton) resetResidualButton.textContent = warpState.config?.outputs?.[output]?.warp?.baseline?.type === "tdMesh" ? "Reset to imported TD baseline" : "Reset residuals";
    const baselineStatus = warpState.baselineAvailable === false ? " · TD baseline unavailable; reload after repairing the asset" : "";
    const validationStatus = warpState.validationMessage ? ` · ${warpState.validationMessage}` : "";
    controls.warpStatus.textContent = `${output[0].toUpperCase() + output.slice(1)} · ${mode === "grid" ? "Grid Warp" : "Keystone"} · ${warpState.selection?.kind || "point"} ${Number(warpState.selection?.index ?? 0) + 1} · ${warpState.stepMode === "coarse" ? "1 px" : "0.25 px"}${baselineStatus}${validationStatus}`;
    const warp = warpState.config.outputs?.[output]?.warp;
    const allHandles = Array.isArray(warpState.handles) ? warpState.handles : [];
    currentHandles = allHandles;
    currentSelection = warpState.selection;
    const columns = warp?.grid?.columns || (output === "right" ? 8 : 7);
    const rows = warp?.grid?.rows || 7;
    const selectedIndices = new Set(warpState.selection?.indices || []);
    const chosen = [...selectedIndices].map((index) => allHandles[index]).filter(Boolean);
    const mean = (axis) => chosen.length ? chosen.reduce((sum, point) => sum + (axis === 0 ? point.x : point.y), 0) / chosen.length : 0;
    const syncWarpPosition = (axis, input, pixels) => {
      if (doc.activeElement === input) return;
      const value = pixels.toFixed(2);
      if (input.value === value) return;
      input.value = value;
      input.removeAttribute("aria-invalid");
      warpPositionErrors.get(axis).textContent = "";
    };
    syncWarpPosition("x", controls.warpPositionX, mean(0) * WARP_OUTPUT_WIDTH);
    syncWarpPosition("y", controls.warpPositionY, mean(1) * WARP_OUTPUT_HEIGHT);
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
    const nextFit = warpViewport(viewPoints);
    warpViewBox = nextFit;
    if (!effectiveWarpViewBox || !dialog.isOpen() || targetChanged) effectiveWarpViewBox = nextFit;
    const displayViewBox = pointerInput.activeViewBox() || effectiveWarpViewBox;
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
    dialog.setViewBox(displayViewBox);
    updateWarpMarkerRadii();
  };
  const update = ({ state = {}, errors = {}, conflict = "", statusText = "", selectedNode = "pre", loadedPresetId = null, loadedPresetLoadToken = 0, statusRows = [], appliedSummary = 'Pending', outputState = {}, warpStates = {}, namesWallStatus = null, clockScene = "home", clockElement = "clock", clockLayouts = {}, clockHydration = { status: "Loading" }, settlement = null } = {}) => {
    controls.live.checked = Boolean(state.live);
    const dirtyLocalDraft = Boolean(state.hasLocalDraft || (state.draft && state.snapshot && JSON.stringify(state.draft) !== JSON.stringify(state.snapshot.config)));
    controls.status.textContent = dirtyLocalDraft && !state.live
      ? `${statusText}. Changes have not reached the outputs. Apply or save before reload. Reloading discards this local draft.`
      : statusText;
    controls.conflict.textContent = conflict;
    controls.conflict.hidden = !conflict;
    const setUtilityError = (indicator, details, message) => {
      const text = String(message || "");
      indicator.hidden = !text;
      details.textContent = text;
      details.hidden = !text;
    };
    setUtilityError(controls.presetErrorIndicator, controls.presetErrorDetails, errors.preset || errors.name);
    setUtilityError(controls.moreErrorIndicator, controls.moreErrorDetails, errors.more || errors.import || errors.share || errors.export);
    setUtilityError(controls.outputErrorIndicator, controls.outputErrorDetails, outputState.error || errors.outputs || errors.output);
    const actionError = errors.action || state.previewError || "";
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
    controls.outputStatus.textContent = touchOnlySurface ? "Display opening is workstation-only. Use this page to tell the workstation operator which displays to assign and open." : outputState.message || "Identify displays on the workstation.";
    const presets = state.snapshot?.presets || [];
    const selectedPreset = state.selectedPresetId || state.snapshot?.selectedPresetId || "original";
    controls.presets.replaceChildren(...presets.map((preset) => make(doc, "option", { value: preset.id }, preset.name)));
    controls.presets.value = selectedPreset;
    const loadedPreset = presets.find((preset) => preset.id === loadedPresetId);
    controls.loadedPresetIdentity.textContent = `Loaded: ${loadedPreset?.name || "unknown"}`;
    if (loadedPreset && (loadedPresetId !== lastLoadedPresetId || loadedPresetLoadToken !== lastLoadedPresetLoadToken)) {
      const explicitLoad = lastLoadedPresetLoadToken !== null && loadedPresetLoadToken !== lastLoadedPresetLoadToken;
      if (!presetNameEdited || explicitLoad) controls.saveName.value = loadedPreset.name || "";
      if (explicitLoad) presetNameEdited = false;
      lastLoadedPresetId = loadedPresetId;
      lastLoadedPresetLoadToken = loadedPresetLoadToken;
    }
    const draft = state.draft || DEFAULT_PROJECTION_CONFIG;
    setNode(selectedNode);
    controls.gisClockScene.value = clockScene;
    controls.clockSceneInspector.value = clockScene;
    controls.projectionElement.value = clockElement;
    controls.clockElementInspector.value = clockElement;
    for (const [id, status] of clockNodeStatuses) status.render(clockLayouts[id]?.record, clockHydration);
    const selectedClock = clockLayouts[selectedNode];
    clockInspectorStatus.render(selectedClock?.record, clockHydration);
    clockParameters.render(selectedClock?.layout, { enabled: clockHydration.status === "Saved", legend: selectedNode === "clock-projection" && clockElement === "legend" });
    settlementControls.render(settlement || { hydration: { status: "Loading" }, enabled: false });
    controls.namesWallInspector.hidden = selectedNode !== "names-wall";
    const wallConfig = draft.namesWall;
    for (const help of modelSpacingHelpControls) help.hidden = wallConfig?.activeMode !== "model";
    for (const select of namesModeControls) select.value = wallConfig?.activeMode || "wall";
    for (const reset of pageSpacingResetControls) reset.hidden = wallConfig?.activeMode !== "wall";
    const wallStatus = namesWallStatus || { state: "building", expected: null, placed: null };
    const requested = wallStatus.requestedFontPx ?? wallConfig?.profiles?.[wallConfig?.activeMode]?.requestedFontPx ?? "—";
    const effective = wallStatus.effectiveFontPx;
    const counts = Number.isSafeInteger(wallStatus.expected) && Number.isSafeInteger(wallStatus.placed) ? `${wallStatus.placed} of ${wallStatus.expected}; left ${wallStatus.left ?? "—"}, right ${wallStatus.right ?? "—"}` : "counts pending";
    let wallMessage = `Building · requested ${requested} px; effective pending; ${counts}.`;
    if (wallStatus.state === "valid" || wallStatus.state === "auto-reduced") {
      wallMessage = wallStatus.state === "auto-reduced"
        ? `Auto-reduced · requested ${requested} px; using ${effective} px; ${counts}.`
        : `Valid · requested ${requested} px; effective ${effective ?? requested} px; ${counts}.`;
    } else if (wallStatus.state === "invalid") {
      const unsaved = state.hasLocalDraft || (state.draft && state.snapshot && JSON.stringify(state.draft) !== JSON.stringify(state.snapshot.config));
      const context = unsaved ? "Draft is unsaved; output state is unconfirmed." : "Saved calibration cannot display a complete names wall; output state is unconfirmed.";
      wallMessage = `Invalid · requested ${requested} px; effective none; ${counts}. ${context}${wallStatus.reason ? ` ${wallStatus.reason}` : ""}`;
    } else if (wallStatus.reason) {
      wallMessage = `Building · requested ${requested} px; effective pending; ${counts}. ${wallStatus.reason}`;
    }
    for (const status of namesStatusControls) {
      status.textContent = wallMessage;
      status.dataset.state = wallStatus.state || "building";
      status.classList?.toggle("is-invalid", wallStatus.state === "invalid");
      status.classList?.toggle("is-reduced", wallStatus.state === "auto-reduced");
    }
    renderWarpPanel(warpStates, selectedNode);
    dialog.update(draft, { live: state.live, appliedSummary });
    const setDiagramRect = (element, rect) => { if (!element) return; element.hidden = !rect; element.setAttribute("visibility", rect ? "visible" : "hidden"); if (!rect) { element.setAttribute("width", "0"); element.setAttribute("height", "0"); return; } element.setAttribute("x", String(4 + rect.x0 * 92)); element.setAttribute("y", String(8 + rect.y0 * 26)); element.setAttribute("width", String(Math.max(0, (rect.x1 - rect.x0) * 92))); element.setAttribute("height", String(Math.max(0, (rect.y1 - rect.y0) * 26))); };
    const left = draft.outputs?.left; const right = draft.outputs?.right;
    setDiagramRect(controls.cropSvg?.leftRect, left?.crop); setDiagramRect(controls.cropSvg?.rightRect, right?.crop);
    setDiagramRect(controls.cropSvg?.leftVisibleRect, left ? visibleT3Rect(left) : null);
    setDiagramRect(controls.cropSvg?.rightVisibleRect, right ? visibleT3Rect(right) : null);
    for (const descriptor of descriptors) {
      const value = namesWallProfileScoped(descriptor.path)
        ? draft.namesWall?.profiles?.[descriptor.wallOnly ? "wall" : draft.namesWall?.activeMode]?.[descriptor.path.slice("namesWall.".length)]
        : readPath(draft, descriptor.path);
      for (const prefix of [descriptor.node, "inspector"]) {
        const control = fields.get(`${prefix}:${descriptor.path}`);
        if (!control) continue;
        control.wrap.hidden = (prefix === "inspector" && descriptor.node !== selectedNode)
          || Boolean(descriptor.wallOnly && draft.namesWall?.activeMode !== "wall");
        const display = displayValue(descriptor, value);
        for (const input of [control.range, control.number]) if (input && doc.activeElement !== input) input.value = display;
        if (doc.activeElement !== control.number) control.value.textContent = `${display}${descriptor.unit ? ` ${descriptor.unit}` : ""}`;
        const errorPath = namesWallProfileScoped(descriptor.path) && draft.namesWall?.activeMode
          ? `namesWall.profiles.${descriptor.wallOnly ? "wall" : draft.namesWall.activeMode}.${descriptor.path.slice("namesWall.".length)}`
          : descriptor.path;
        const fieldError = errors[errorPath] || Object.entries(errors).find(([key]) => errorPath.startsWith(`${key}.`))?.[1] || "";
        control.error.textContent = fieldError;
        control.wrap.classList?.toggle("has-error", Boolean(fieldError));
      }
    }
    controls.applied.replaceChildren(make(doc, 'strong', { className: 'applied-summary' }, appliedSummary), ...statusRows.map((row) => make(doc, "p", { className: row.success ? "applied" : "not-confirmed" }, row.text)));
  };
  setNode("pre");
  return {
    update, controls, fields, nodeMap, setPresetName, canManageDisplays: !touchOnlySurface,
    getClockEditorOpener(node) {
      if (mobileQuery?.matches && selectedGraphNode === node && !mobileOpen.hidden) return mobileOpen;
      return nodeMap.get(node)?.querySelector?.('[data-action="clock-editor-open"]') || null;
    },
    getSettlementEditorOpener() {
      if (mobileQuery?.matches && selectedGraphNode === "settlement-names" && !mobileOpen.hidden) return mobileOpen;
      return nodeMap.get("settlement-names")?.querySelector?.('[data-action="settlement-editor-open"]') || null;
    },
    cancelWarpPointer: cancelActiveDrag,
    closeWarpEditor: dialog.close,
    dispose() { mobileQuery?.removeEventListener?.("change", openOnPhone); doc.removeEventListener?.("keydown", onKeyDown); doc.removeEventListener?.("keydown", dismissDisclosures); doc.removeEventListener?.("pointerdown", dismissDisclosures, true); dialog.dispose(); pointerInput.dispose(); canvas.dispose(); },
  };
}

export { displayValue, readPath, descriptorFor };
