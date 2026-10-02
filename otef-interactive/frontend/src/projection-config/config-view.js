import { DEFAULT_PROJECTION_CONFIG } from "../shared/projection-config-schema.js";
import { createNodeCanvas } from "./node-canvas.js";
import { createWarpEditorDialog } from "./warp-editor-dialog.js";
import { bindWarpPointerInput, gridSelectionForHandle } from "./warp-pointer-input.js";
import { clampWarpViewBox, transformWarpViewBox, warpMarkerRadius } from "./warp-viewport.js";
import { createClockLayoutStatus } from "./clock-layout-controls.js";
import { createSettlementNameControls } from "./settlement-name-controls.js";
import { createGridLayoutControls, deriveGridSelectionIndices } from "./grid-layout-controls.js";
import { createParameterEditorDialog } from "./parameter-editor-dialog.js";
import { createParameterEditorPreviews } from "./parameter-editor-previews.js";
import { displayValue, renderField } from "./config-field-control.js";
import { createProjectionTraceUi } from './projection-trace-ui.js';
import { bindProjectionTraceInput, bindProjectionTracePage, recordProjectionTrace, projectionTraceTime } from './projection-trace-input.js';

const docFor = (root) => root?.ownerDocument || globalThis.document;
const WARP_OUTPUT_WIDTH = 1920;
const WARP_OUTPUT_HEIGHT = 1080;
const WARP_VIEW_PADDING = 72;
const GIS_CLOCK_SCENES = [["home", "Home"], ["timeline", "Timeline"], ["segev", "Segev"], ["nova", "Nova"], ["sderot", "Sderot"], ["hostages", "Peri Family"], ["hostages_all", "All Hostages"]];
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

export function createProjectionConfigView(root, {
  descriptors = [],
  onAction = () => {},
  onRunNames = () => {},
  onOutputAction = () => {},
  onField = () => {},
  onNudge = () => {},
  onNamesMode = () => {},
  onNode = () => {},
  onOpenClockEditor = () => {},
  onOpenNovaExplainerEditor = () => {},
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
  trace,
} = {}) {
  const doc = docFor(root);
  if (!root || !doc?.createElement) throw new Error("projection config root is required");
  root.className = "projection-config-app";
  const fields = new Map();
  const controls = {};
  const clockNodeStatuses = new Map();
  let outputSelection = { left: "", right: "" };
  let outputScreensSignature = null;
  let outputAssignmentsSignature = null;
  let selectedGraphNode = "pre";
  const app = make(doc, "div", { className: "config-shell" });
  const commandBar = make(doc, "header", { className: "config-command-bar", ariaLabel: "Projection calibration commands" });
  const traceUi = trace?.enabled ? createProjectionTraceUi({ document: doc, trace }) : null;
  const disposePageTrace = bindProjectionTracePage({ document: doc, trace });
  const toolbar = make(doc, "section", { className: "config-primary-row", ariaLabel: "Calibration actions" });
  const heading = make(doc, "div", { className: "config-header", ariaLabel: "Projection calibration" });
  heading.append(make(doc, "span", {}, "Projection"));
  controls.live = make(doc, "input", { type: "checkbox", id: "projection-live", checked: true, ariaLabel: "Live", dataset: { action: "live" } });
  const liveLabel = make(doc, "label", { htmlFor: "projection-live", className: "live-toggle" }, "Live"); liveLabel.prepend(controls.live);
  const liveControl = make(doc, "div", { className: "compact-live" });
  liveControl.append(liveLabel);
  controls.apply = button(doc, "Apply once", "apply");
  controls.save = button(doc, "Save preset", "save");
  controls.saveStatus = make(doc, "span", { className: "config-save-status", role: "status" });
  const saveColumn = make(doc, "div", { className: "config-save-column" });
  saveColumn.append(controls.save, controls.saveStatus);
  controls.loadedPresetIdentity = make(doc, "span", { className: "loaded-preset-identity", role: "status" }, "Loaded: unknown");
  controls.saveName = make(doc, "input", { type: "text", placeholder: "Preset name", maxLength: 80, ariaLabel: "Preset name" });
  let presetNameEdited = false;
  controls.saveName.addEventListener("input", () => { presetNameEdited = true; });
  const setPresetName = (value) => { controls.saveName.value = String(value || ""); presetNameEdited = true; };
  controls.saveNew = button(doc, "Save as new", "save-new");
  controls.presets = make(doc, "select", { ariaLabel: "Preset", title: "Selection is pending until you choose Load in Tools" });
  controls.load = button(doc, "Load", "load");
  controls.revert = button(doc, "Revert", "revert");
  const presetGroup = make(doc, "div", { className: "config-preset-group", ariaLabel: "Selected preset and acknowledged loaded preset" });
  presetGroup.append(controls.presets, controls.loadedPresetIdentity);
  controls.appliedSummary = make(doc, "span", { className: "applied-summary", role: "status", ariaLive: "polite" }, "Outputs: pending");
  controls.toolsAppliedSummary = make(doc, "span", { className: "tools-applied-summary" }, "Outputs: pending");
  controls.status = make(doc, "span", { className: "draft-status" });
  controls.tools = make(doc, "details", { className: "config-tools" });
  controls.toolsSummary = make(doc, "summary", { title: "Preset loading, output status, display setup, and advanced actions" });
  controls.toolsSummary.append(make(doc, "span", {}, "Tools"));
  controls.toolsErrorIndicator = make(doc, "span", { className: "disclosure-error-indicator", role: "img", ariaLabel: "Tools contains an unresolved error", hidden: true });
  controls.toolsSummary.appendChild(controls.toolsErrorIndicator);
  const toolsContent = make(doc, "div", { className: "config-tools-content" });
  controls.toolsClose = button(doc, "Close", "tools-close", "tools-close");
  controls.toolsErrorDetails = make(doc, "p", { className: "disclosure-error-details", hidden: true });
  toolsContent.append(controls.toolsClose, controls.toolsErrorDetails);
  controls.toolsClose.addEventListener("click", () => { controls.tools.open = false; controls.toolsSummary.focus(); });
  controls.tools.append(controls.toolsSummary, toolsContent);
  controls.applyLiveDescription = make(doc, "span", { id: "projection-apply-live-description", className: "visually-hidden" }, "Live off. Use Apply once in Tools, or Apply & save.");
  controls.live.setAttribute("aria-describedby", "projection-apply-live-description");
  controls.apply.setAttribute("aria-describedby", "projection-apply-live-description");
  liveControl.append(controls.applyLiveDescription);
  const toolsApplied = make(doc, "section", { className: "config-tools-section tools-applied-section" });
  controls.applied = make(doc, "section", { className: "applied-status" });
  controls.appliedRows = make(doc, "div", { className: "applied-details" });
  controls.applied.append(controls.appliedRows);
  toolsApplied.append(make(doc, "h2", {}, "Output acknowledgements"), controls.toolsAppliedSummary, controls.applied);
  toolsContent.append(toolsApplied);
  const presetTools = make(doc, "section", { className: "config-tools-section config-tools-presets" });
  controls.toolsPresetContext = make(doc, "p", { className: "tools-preset-context" });
  controls.originalCheckpointGuidance = make(doc, "p", { className: "original-checkpoint-guidance", hidden: true });
  presetTools.append(make(doc, "h2", {}, "Apply and load"), controls.apply, controls.load, controls.toolsPresetContext, controls.originalCheckpointGuidance);
  toolsContent.append(presetTools);
  const presetManage = make(doc, "section", { className: "config-tools-section config-tools-manage" });
  presetManage.append(make(doc, "h2", {}, "Preset management"), controls.saveName, controls.saveNew, controls.revert,
    make(doc, "small", { className: "preset-scope-help" }, "Presets include geometry and people-wall settings. Clock and settlement layouts save independently."));
  toolsContent.append(presetManage);
  const toolsOutputCommands = make(doc, "section", { className: "config-tools-section tools-output-commands", hidden: true });
  toolsOutputCommands.append(make(doc, "h2", {}, "Output windows"));
  toolsContent.append(toolsOutputCommands);
  const utilityBar = make(doc, "section", { className: "config-tools-section config-tools-display" });
  utilityBar.append(make(doc, "h2", {}, "Display setup"), make(doc, "strong", {}, "Workstation browser outputs"));
  toolsContent.append(utilityBar);
  toolsContent.appendChild(controls.status);
  const status = make(doc, "section", { className: "config-alerts", ariaLabel: "Calibration warnings and errors" });
  controls.liveWarning = make(doc, "p", { className: "live-draft-warning", role: "alert", hidden: true });
  controls.conflict = make(doc, "p", { className: "conflict-banner", role: "alert" });
  controls.actionError = make(doc, "p", { className: "action-error", role: "alert" });
  controls.connectionStatus = make(doc, "p", { className: "connection-status", role: "status" });
  controls.outputCapabilityNotice = make(doc, "small", { className: "output-capability-notice", role: "status", hidden: true });
  controls.retryHydration = button(doc, "Retry settings check", "retry-hydration");
  status.append(controls.liveWarning, controls.conflict, controls.actionError, controls.connectionStatus, controls.retryHydration, controls.outputCapabilityNotice);
  controls.retryHydration.addEventListener("click", () => onAction("retry-hydration"));
  const dismissDisclosures = (event) => {
    if (event.type === "keydown") {
      if (event.key !== "Escape" || !controls.tools.open) return;
      event.preventDefault(); controls.tools.open = false; controls.toolsSummary.focus(); return;
    }
    if (!controls.tools.open || controls.tools.contains?.(event.target)) return;
    controls.tools.open = false;
  };
  doc.addEventListener?.("pointerdown", dismissDisclosures, true);
  doc.addEventListener?.("keydown", dismissDisclosures);
  controls.live.addEventListener("change", () => onAction("live", controls.live.checked));
  controls.apply.addEventListener("click", () => onAction("apply"));
  controls.save.addEventListener("click", () => onAction("save", controls.saveName.value));
  controls.saveNew.addEventListener("click", () => onAction("save-new", controls.saveName.value));
  controls.load.addEventListener("click", () => onAction("load", controls.presets.value));
  controls.revert.addEventListener("click", () => onAction("revert"));
  controls.presets.addEventListener("change", () => onAction("preset-select", controls.presets.value));

  const outputToolbar = utilityBar;
  controls.outputRefresh = button(doc, "Refresh displays", "output-refresh");
  controls.outputIdentify = button(doc, "Identify displays", "output-identify");
  controls.outputLeftDisplay = make(doc, "select", { ariaLabel: "Left projector display", dataset: { action: "output-left-display" } });
  controls.outputRightDisplay = make(doc, "select", { ariaLabel: "Right projector display", dataset: { action: "output-right-display" } });
  controls.outputAssign = button(doc, "Save display assignment", "output-assign");
  controls.outputOpenBoth = button(doc, "Open both", "output-open-both", "output-command");
  controls.outputCloseBoth = button(doc, "Close both", "output-close-both", "output-command");
  controls.outputStatus = make(doc, "span", { className: "output-launch-status", role: "status", ariaLive: "polite" });
  controls.outputHandoff = make(doc, "small", { className: "output-launch-handoff" }, "TD projectorWindows off → Open Both; Close Both → TD projectorWindows on. If this page reloads, manually close old browser output windows before reopening.");
  const leftLabel = make(doc, "label", { className: "output-display-label" }, "Left projector"); leftLabel.appendChild(controls.outputLeftDisplay);
  const rightLabel = make(doc, "label", { className: "output-display-label" }, "Right projector"); rightLabel.appendChild(controls.outputRightDisplay);
  outputToolbar.append(controls.outputRefresh, controls.outputIdentify, leftLabel, rightLabel, controls.outputAssign, controls.outputStatus, controls.outputHandoff);
  const outputAction = (action, value) => onOutputAction(action, value);
  controls.outputRefresh.addEventListener("click", () => outputAction("refresh"));
  controls.outputIdentify.addEventListener("click", () => outputAction("identify"));
  controls.outputAssign.addEventListener("click", () => outputAction("assign", { left: controls.outputLeftDisplay.value, right: controls.outputRightDisplay.value }));
  controls.outputOpenBoth.addEventListener("click", () => outputAction("open"));
  controls.outputCloseBoth.addEventListener("click", () => outputAction("close"));
  controls.outputLeftDisplay.addEventListener("change", () => { outputSelection.left = controls.outputLeftDisplay.value; });
  controls.outputRightDisplay.addEventListener("change", () => { outputSelection.right = controls.outputRightDisplay.value; });
  for (const control of [controls.outputRefresh, controls.outputIdentify, controls.outputAssign, controls.outputLeftDisplay, controls.outputRightDisplay]) control.disabled = false;

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
    ["clock-gis", "GIS Clock", "Clock layouts for GIS scenes"],
    ["nova-explainers", "Nova explainers", "Place Nova story cards on the GIS map"],
    ["clock-projection", "Projection Clock / Legend", "Shared left projection overlays"],
    ["pre", "Shared pre-transform", "Affects both projectors"],
    ["left-crop", "Left Crop", "Left projector"], ["right-crop", "Right Crop", "Right projector"],
    ["left-fit", "Left Fit / post", "Left projector"], ["right-fit", "Right Fit / post", "Right projector"],
    ["left-keystone", "Left Keystone", "Projective corners"], ["right-keystone", "Right Keystone", "Projective corners"],
    ["left-grid", "Left Grid Warp", "7 × 7 residual grid"], ["right-grid", "Right Grid Warp", "8 × 7 residual grid"],
    ["left-output", "Left Output", "Left projector"], ["right-output", "Right Output", "Right projector"],
  ];
  const categoryGroups = {
    Geometry: ["pre", "left-crop", "right-crop", "left-fit", "right-fit", "left-keystone", "right-keystone", "left-grid", "right-grid", "left-output", "right-output"],
    Overlays: ["clock-gis", "nova-explainers", "clock-projection"],
    Names: ["names-wall", "settlement-names"],
  };
  const actionRow = make(doc, "section", { className: "config-action-row", ariaLabel: "Workspace shortcuts and output windows" });
  const categoryActions = make(doc, "div", { className: "config-category-actions", ariaLabel: "Focus graph category" });
  for (const [category, nodeIds] of Object.entries(categoryGroups)) {
    const shortcut = button(doc, category, `focus-${category.toLowerCase()}`, "config-category-action");
    shortcut.dataset.focusNodes = nodeIds.join(" ");
    shortcut.addEventListener("click", () => {
      canvas.focusNodes(nodeIds);
    });
    categoryActions.appendChild(shortcut);
  }
  const outputActions = make(doc, "div", { className: "output-command-actions", ariaLabel: "Projection output windows" });
  outputActions.append(controls.outputOpenBoth, controls.outputCloseBoth);
  actionRow.append(categoryActions, controls.appliedSummary, outputActions);
  const outputPlacementQuery = doc.defaultView?.matchMedia?.("(max-width: 359px)");
  const updateOutputPlacement = () => {
    const buttons = [controls.outputOpenBoth, controls.outputCloseBoth];
    const focused = buttons.find((control) => control === doc.activeElement);
    const useTools = Boolean(outputPlacementQuery?.matches);
    if (useTools && focused) controls.tools.open = true;
    const target = useTools ? toolsOutputCommands : outputActions;
    target.append(...buttons);
    toolsOutputCommands.hidden = !useTools;
    if (focused && doc.activeElement !== focused) focused.focus();
  };
  outputPlacementQuery?.addEventListener?.("change", updateOutputPlacement);
  updateOutputPlacement();
  toolbar.append(heading, presetGroup, liveControl, saveColumn, controls.tools);
  commandBar.append(toolbar, actionRow, status);
  if (traceUi) commandBar.appendChild(traceUi.element);
  app.append(commandBar);
  const nodeMap = new Map();
  const patternControls = new Map();
  let parameterDialog = null;
  let currentDraft = null;
  let currentFieldErrors = {};
  let currentStatus = "";
  const namesModeControls = [];
  const namesStatusControls = [];
  const namesRunButtons = [];
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
  function namesRunControl() {
    const run = button(doc, "Run names", "projection-names-run");
    run.dataset.action = "projection-names-run";
    run.addEventListener("click", (event) => { event.stopPropagation?.(); onRunNames(); });
    namesRunButtons.push(run);
    return run;
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
        make(doc, "p", { className: "names-wall-units names-wall-rotation" }, namesWallRotationHelp), namesRunControl());
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
    if (id === "left-output" || id === "right-output") {
      const output = id.startsWith("right-") ? "right" : "left";
      const pattern = make(doc, "select", { className: "pattern-selector", ariaLabel: `${output === "left" ? "Left" : "Right"} output test pattern` });
      pattern.append(make(doc, "option", { value: "off" }, "Pattern: Off"), make(doc, "option", { value: "grid" }, "Pattern: Grid"), make(doc, "option", { value: "output_id" }, "Pattern: Output ID"));
      pattern.value = "off";
      pattern.addEventListener("change", () => onAction("pattern", { pattern: pattern.value, branch: output }));
      patternControls.set(output, pattern); card.appendChild(pattern);
    }
    const nodeFields = descriptors.filter((item) => item.node === id);
    for (const descriptor of nodeFields) { const control = renderField(doc, descriptor, onField, onNudge, false); fields.set(`${id}:${descriptor.path}`, control); card.appendChild(control.wrap); }
    if (["pre", "left-crop", "right-crop", "left-fit", "right-fit"].includes(id)) {
      const adjust = button(doc, "Adjust", "parameter-editor-open", "parameter-editor-open-button");
      adjust.addEventListener("click", (event) => {
        event.stopPropagation?.(); cancelActiveDrag(); onNode(id);
        parameterDialog?.open({ nodeId: id, title: label, descriptors: nodeFields, opener: adjust });
        parameterDialog?.update({ config: currentDraft, fieldErrors: currentFieldErrors, status: currentStatus });
      });
      card.appendChild(adjust);
    }
    if (id === "names-wall") card.append(modelSpacingHelp(), make(doc, "p", { className: "names-wall-units" }, "0 keeps the current positions. Increase to move the pages inward where space allows."), pageSpacingReset(), namesStatus());
    if (id.endsWith("-keystone") || id.endsWith("-grid")) card.appendChild(make(doc, "p", { className: "warp-node-summary" }, "Select to edit corners, points, and residuals."));
    if (id.endsWith("-keystone") || id.endsWith("-grid")) {
      const openButton = button(doc, "Edit", "warp-editor-open", "warp-open-button");
      openButton.addEventListener("click", (event) => { event.stopPropagation?.(); cancelActiveDrag(); onNode(id); dialog.open({ side: id.startsWith("right-") ? "right" : "left", mode: id.endsWith("-grid") ? "grid" : "keystone", opener: openButton }); });
      card.appendChild(openButton);
    }
    if (id === "settlement-names") {
      const openButton = button(doc, "Open editor", "settlement-editor-open", "settlement-open-button");
      openButton.addEventListener("click", (event) => { event.stopPropagation?.(); cancelActiveDrag(); onNode(id); onOpenSettlementEditor(); });
      card.appendChild(openButton);
    }
    if (id === "clock-gis" || id === "clock-projection" || id === "nova-explainers") {
      const layoutStatus = createClockLayoutStatus(doc, {
        onRetry: () => onClockRecovery("retry", id), onLoad: () => onClockRecovery("load", id),
      });
      clockNodeStatuses.set(id, layoutStatus); card.appendChild(layoutStatus.element);
      const openAction = id === "nova-explainers" ? "nova-explainer-editor-open" : "clock-editor-open";
      const openButton = button(doc, "Open editor", openAction, "clock-open-button");
      openButton.addEventListener("click", (event) => {
        event.stopPropagation?.(); cancelActiveDrag(); onNode(id);
        if (id === "nova-explainers") onOpenNovaExplainerEditor();
        else onOpenClockEditor(id);
      });
      if (id !== "nova-explainers") {
        card.addEventListener("dblclick", (event) => {
          if (event.target === handle || event.target?.parentElement === handle || event.target === sceneControl || event.target === elementControl || event.target === openButton) return;
          cancelActiveDrag(); onNode(id); onOpenClockEditor(id);
        });
      }
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
      if (event.key === "Enter" && id === "nova-explainers") onOpenNovaExplainerEditor();
      if (event.key === "Enter" && id === "settlement-names") onOpenSettlementEditor();
    });
    nodeMap.set(id, card); graph.appendChild(card);
  }
  graphColumn.append(graphTitle, graphViewport, make(doc, "p", { className: "canvas-help" }, "Drag headers to move nodes · Drag background to pan · Scroll to zoom"));
  workspace.appendChild(graphColumn);

  controls.warpPanel = make(doc, "section", { className: "warp-inspector", ariaLabel: "Warp editor" });
  controls.warpHeading = make(doc, "h3", {}, "Warp editor");
  controls.warpEnabled = make(doc, "input", { type: "checkbox", ariaLabel: "Enable browser warp" });
  const warpEnabledLabel = make(doc, "label", { className: "warp-enabled-label" }, "Enable browser warp"); warpEnabledLabel.prepend(controls.warpEnabled);
  let warpViewBox = { x: 0, y: 0, width: WARP_OUTPUT_WIDTH, height: WARP_OUTPUT_HEIGHT };
  let effectiveWarpViewBox = null;
  let warpViewTarget = "";
  let warpPanMode = false;
  controls.warpSurface = svgNode(doc, "svg", { class: "warp-edit-surface", viewBox: warpViewBoxValue(warpViewBox), role: "img", "aria-label": "Warp editing handles" });
  const navigationControls = make(doc, "div", { className: "warp-view-controls", ariaLabel: "Warp preview navigation" });
  const viewCommandGroup = make(doc, "div", { className: "warp-view-command-group", role: "group", ariaLabel: "Move view, zoom, and fit" });
  const historyCommandGroup = make(doc, "div", { className: "warp-history-command-group", role: "group", ariaLabel: "Undo and redo" });
  navigationControls.append(viewCommandGroup, historyCommandGroup);
  const navButton = (label, className, action) => { const item = make(doc, "button", { type: "button", className }, label); item.addEventListener("click", action); viewCommandGroup.appendChild(item); return item; };
  const panToggle = navButton("Move view", "warp-pan-toggle", () => { if (!pointerInput?.isActive()) warpPanMode = !warpPanMode; panToggle.setAttribute("aria-pressed", String(warpPanMode)); });
  const applyViewBox = (next, navigation = {}) => {
    if (!next || !warpViewBox) return;
    effectiveWarpViewBox = clampWarpViewBox(next, warpViewBox, navigation);
    controls.warpSurface.setAttribute("viewBox", warpViewBoxValue(effectiveWarpViewBox));
    dialog.setViewBox(effectiveWarpViewBox);
    updateWarpMarkerRadii();
  };
  let latestWarpRect = null;
  function updateWarpMarkerRadii() {
    const rect = controls.warpSurface.getBoundingClientRect?.() || { width: WARP_OUTPUT_WIDTH, height: WARP_OUTPUT_HEIGHT };
    latestWarpRect = rect;
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
  navButton("Fit", "warp-view-fit", () => { if (!pointerInput?.isActive()) resetWarpView(); });
  controls.warpSurface.addEventListener("wheel", (event) => {
    if (!dialog.isOpen() || pointerInput?.isActive() || !effectiveWarpViewBox) return;
    event.preventDefault();
    const rect = controls.warpSurface.getBoundingClientRect?.() || { left: 0, top: 0, width: 1, height: 1 };
    const factor = Math.exp(-event.deltaY * 0.002);
    const next = transformWarpViewBox(effectiveWarpViewBox, { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, { from: { clientX: event.clientX, clientY: event.clientY }, factor });
    applyViewBox(next, { anchor: { clientX: event.clientX, clientY: event.clientY }, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } });
  }, { passive: false });
  controls.warpStatus = make(doc, "p", { className: "warp-selection-status", role: "status" });
  controls.warpSelectionControls = make(doc, "div", { className: "warp-selection-controls", role: "group", ariaLabel: "Grid warp selection" });
  controls.warpSelectionButtons = ["point", "row", "column"].map((kind) => {
    const item = button(doc, kind[0].toUpperCase() + kind.slice(1), "warp-selection-kind", "warp-selection-button");
    item.dataset.warpSelectionKind = kind;
    controls.warpSelectionControls.appendChild(item);
    return item;
  });
  controls.warpSelectionPicker = make(doc, "select", { className: "warp-selection-picker", ariaLabel: "Grid point, row, or column" });
  controls.warpSelectionControls.appendChild(controls.warpSelectionPicker);
  controls.warpNumeric = make(doc, "div", { className: "warp-numeric" });
  controls.warpPositionX = make(doc, "input", { type: "number", step: "0.25", inputMode: "decimal", ariaLabel: "Selected warp X position" });
  controls.warpPositionY = make(doc, "input", { type: "number", step: "0.25", inputMode: "decimal", ariaLabel: "Selected warp Y position" });
  controls.warpPositionLabels = [make(doc, "label", {}, "X px"), make(doc, "label", {}, "Y px")];
  controls.warpNumeric.append(controls.warpPositionLabels[0], controls.warpPositionX, controls.warpPositionLabels[1], controls.warpPositionY);
  controls.warpActions = make(doc, "div", { className: "warp-actions" });
  const warpActionButton = (label, action, value = {}) => { const item = button(doc, label, action, "warp-action"); item.dataset.warpAction = action; Object.assign(item.dataset, Object.fromEntries(Object.entries(value).map(([key, itemValue]) => [key, String(itemValue)]))); item.addEventListener("click", (event) => { onWarpAction(action, value); if (action === "warp-nudge" && event.detail > 0) controls.warpSurface.focus?.(); }); return item; };
  controls.warpUndo = warpActionButton("Undo", "warp-undo");
  controls.warpRedo = warpActionButton("Redo", "warp-redo");
  historyCommandGroup.append(controls.warpUndo, controls.warpRedo);
  controls.warpReset = warpActionButton("Reset point", "warp-reset-selection");
  controls.warpActions.append(controls.warpReset);
  controls.warpArrows = make(doc, "div", { className: "warp-arrows", ariaLabel: "Warp nudge controls" });
  for (const [label, direction] of [["↑", "up"], ["↓", "down"], ["←", "left"], ["→", "right"]]) controls.warpArrows.append(warpActionButton(label, "warp-nudge", { direction }));
  controls.warpStep = make(doc, "select", { className: "warp-step", ariaLabel: "Warp nudge step" });
  controls.warpStep.append(make(doc, "option", { value: "fine" }, "Fine · 0.25 px"), make(doc, "option", { value: "coarse" }, "Coarse · 1 px"));
  const warpStepLabel = make(doc, "label", { className: "warp-step-label", htmlFor: "warp-nudge-step" }, "Step");
  controls.warpStep.id = "warp-nudge-step";
  const finePrimary = make(doc, "div", { className: "warp-fine-primary" });
  finePrimary.append(controls.warpStatus, controls.warpSelectionControls, controls.warpNumeric, warpStepLabel, controls.warpStep, controls.warpArrows);
  const fineSecondary = make(doc, "div", { className: "warp-fine-secondary" });
  controls.gridLayout = createGridLayoutControls(doc, (name, value) => {
    cancelActiveDrag({ reason: "grid-layout" });
    const output = warpOutput();
    const grid = currentWarpGrid;
    const selection = currentSelection || { kind: "point", index: 0 };
    const { rowIndex, columnIndex } = deriveGridSelectionIndices(grid, selection);
    let operation, payload;
    if (name === "rows" || name === "columns") { operation = "counts"; payload = { rows: name === "rows" ? value : grid?.rows, columns: name === "columns" ? value : grid?.columns }; }
    else if (name === "source-y") { operation = "move"; payload = { axis: "row", index: rowIndex, position: value }; }
    else if (name === "source-x") { operation = "move"; payload = { axis: "column", index: columnIndex, position: value }; }
    else if (name === "add-row" || name === "add-column") { operation = "add"; payload = { axis: name === "add-row" ? "row" : "column", position: value }; }
    else if (name === "remove-row" || name === "remove-column") { operation = "remove"; payload = { axis: name === "remove-row" ? "row" : "column", index: name === "remove-row" ? rowIndex : columnIndex }; }
    else if (name === "even") { operation = "even"; payload = {}; }
    if (operation) onWarpAction("warp-grid-layout", { output, operation, ...payload });
  });
  fineSecondary.append(warpEnabledLabel, controls.warpActions, controls.gridLayout.element);
  controls.warpPanel.append(controls.warpHeading, finePrimary, fineSecondary, controls.warpSurface);
  controls.warpEnabled.addEventListener("change", () => onWarpAction("warp-enabled", { enabled: controls.warpEnabled.checked }));
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
  let currentWarpGrid = null;
  let lastLoadedPresetId = null;
  let lastLoadedPresetLoadToken = null;
  let pointerInput;
  function cancelActiveDrag(options) { pointerInput?.cancel(options); controls.gridLayout?.cancel(); }
  const warpOutput = () => selectedGraphNode.startsWith("right-") ? "right" : "left";
  const chooseGridSelection = (selection) => {
    if (!selectedGraphNode.endsWith("-grid")) return;
    cancelActiveDrag({ reason: "selection" });
    onWarpAction("warp-select", { output: warpOutput(), selection: { mode: "grid", kind: selection.kind, index: selection.index } });
  };
  const selectionIndexForKind = (kind, columns) => {
    const index = Number(currentSelection?.index || 0);
    const selectedIndices = currentSelection?.indices;
    const firstSelected = selectedIndices?.length ? selectedIndices[0] : index;
    if (kind === "point") return Math.max(0, Math.min(currentHandles.length - 1, firstSelected));
    if (currentSelection?.kind === "point") return kind === "row" ? Math.floor(index / columns) : index % columns;
    const count = kind === "row" ? currentWarpGrid?.rows || 7 : columns;
    return Math.max(0, Math.min(count - 1, index));
  };
  controls.warpSelectionButtons.forEach((control) => control.addEventListener("click", () => {
    const kind = control.dataset.warpSelectionKind;
    const columns = currentWarpGrid?.columns || (warpOutput() === "right" ? 8 : 7);
    chooseGridSelection({ kind, index: selectionIndexForKind(kind, columns) });
  }));
  controls.warpSelectionPicker.addEventListener("change", () => {
    if (!selectedGraphNode.endsWith("-grid")) return;
    const kind = ["row", "column", "point"].includes(currentSelection?.kind) ? currentSelection.kind : "point";
    chooseGridSelection({ kind, index: Number(controls.warpSelectionPicker.value) || 0 });
  });
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
  controls.appliedFailure = make(doc, "p", { className: "applied-failure", role: "alert", hidden: true });
  const settlementControls = createSettlementNameControls(doc, {
    onOutput: onSettlementOutput,
    onCitycode: onSettlementCitycode,
    onPosition: onSettlementPosition,
    onStyle: onSettlementStyle,
    onRetry: () => onSettlementRecovery("retry"),
    onLoad: () => onSettlementRecovery("load"),
  });
  nodeMap.get("settlement-names")?.appendChild(settlementControls.element);
  controls.editorHome = make(doc, "div", { className: "editor-home", hidden: true });
  controls.editorHome.appendChild(controls.warpPanel);
  status.append(controls.appliedFailure);
  app.appendChild(controls.editorHome);
  app.appendChild(workspace);
  root.appendChild(app);
  const dialog = createWarpEditorDialog({ document: doc, host: root, editorPanel: controls.warpPanel, overlay: controls.warpSurface, navigationControls, trace,
    onBeforeClose: () => cancelActiveDrag({ reason: 'close' }),
    onBeforeSwitch: () => cancelActiveDrag({ reason: 'switch' }),
    onBeforeResize: () => cancelActiveDrag({ reason: 'resize' }),
    onViewportChange: updateWarpMarkerRadii,
    onOrientationChange: () => cancelActiveDrag({ reason: 'orientationchange' }),
    onApply: () => onAction("apply"), onLive: (live) => onAction("live", live) });
  parameterDialog = createParameterEditorDialog({ document: doc, host: root, onField, onNudge,
    createPreview: (previewHost, onStatus) => createParameterEditorPreviews({ document: doc, host: previewHost, onStatus }) });
  pointerInput = bindWarpPointerInput({
    trace,
    surface: controls.warpSurface,
    readGeometry: () => dialog.isOpen() ? { rect: controls.warpSurface.getBoundingClientRect?.() || { left: 0, top: 0, width: 1920, height: 1080 }, viewBox: effectiveWarpViewBox || warpViewBox, baseViewBox: warpViewBox, panMode: warpPanMode, handles: currentHandles, selection: currentSelection, rows: currentWarpGrid?.rows || 7, columns: currentWarpGrid?.columns || (selectedGraphNode.startsWith("right-") ? 8 : 7), mode: selectedGraphNode.endsWith("-grid") ? "grid" : "keystone", side: selectedGraphNode.startsWith("right-") ? "right" : "left" } : null,
    onNavigate: ({ viewBox }) => applyViewBox(viewBox),
    onSelect: ({ output, selection }) => onWarpAction("warp-select", { output, selection }),
    onStart: (point) => onWarpPointer("start", point),
    onMove: (point) => onWarpPointer("move", point),
    onEnd: (point) => onWarpPointer("end", point),
    onCancel: (point) => onWarpPointer("cancel", point),
  });
  const disposeWarpTrace = bindProjectionTraceInput({ surface: controls.warpSurface, surfaceName: 'warp', trace, readGeometry: () => ({ viewBox: effectiveWarpViewBox || warpViewBox, selection: currentSelection, mode: selectedGraphNode.endsWith('-grid') ? 'grid' : 'keystone', side: selectedGraphNode.startsWith('right-') ? 'right' : 'left' }) });
  const disposeGraphTrace = bindProjectionTraceInput({ surface: graphViewport, surfaceName: 'graph', trace });
  const canvas = createNodeCanvas({ document: doc, viewport: graphViewport, graph, svg, wire: wirePath, nodeMap, controls: { zoomIn, zoomOut, zoomReset, zoomOne }, trace });
  canvas.mount();

  const setNode = (node) => {
    const selected = node || "pre";
    selectedGraphNode = selected;
    canvas.setSelected(selected);
    for (const [id, card] of nodeMap) card.classList?.toggle("selected", id === selected);
  };
  const renderWarpPanel = (warpStates, node) => {
    const output = node.startsWith("right-") ? "right" : "left";
    const isWarpNode = node.endsWith("-keystone") || node.endsWith("-grid");
    const warpState = warpStates?.[output];
    controls.warpPanel.hidden = !isWarpNode || !warpState;
    if (!warpState || !isWarpNode) return;
    const traceStarted = projectionTraceTime(trace);
    recordProjectionTrace(trace, 'redraw', { surface: 'warp', phase: 'start', output, dragging: Boolean(warpState.dragging) });
    const mode = node.endsWith("-grid") ? "grid" : "keystone";
    const target = `${output}:${mode}`;
    const targetChanged = target !== warpViewTarget;
    warpViewTarget = target;
    controls.warpEnabled.checked = Boolean(warpState.config?.outputs?.[output]?.warp?.enabled);
    controls.warpStep.value = warpState.stepMode || "fine";
    controls.warpUndo.disabled = !(warpState.historyDepth > 0);
    controls.warpRedo.disabled = !(warpState.redoDepth > 0);
    const allHandles = Array.isArray(warpState.handles) ? warpState.handles : [];
    const warp = warpState.config.outputs?.[output]?.warp;
    const columns = warp?.grid?.columns || (output === "right" ? 8 : 7);
    const rows = warp?.grid?.rows || 7;
    currentWarpGrid = warp?.grid || null;
    currentHandles = allHandles;
    currentSelection = warpState.selection;
    const selectionKind = ["row", "column", "point"].includes(warpState.selection?.kind) ? warpState.selection.kind : "point";
    const selectedIndex = Number(warpState.selection?.index ?? 0);
    const selectedIndices = new Set(warpState.selection?.indices || []);
    const chosen = [...selectedIndices].map((index) => allHandles[index]).filter(Boolean);
    const baselineStatus = warpState.baselineAvailable === false ? " · TD baseline unavailable; reload after repairing the asset" : "";
    const validationStatus = warpState.validationMessage ? ` · ${warpState.validationMessage}` : "";
    const selectedName = mode === "keystone"
      ? ["Top-left corner", "Top-right corner", "Bottom-left corner", "Bottom-right corner"][selectedIndex] || `Corner ${selectedIndex + 1}`
      : selectionKind === "row" ? `Row ${selectedIndex + 1} · ${selectedIndices.size} points`
        : selectionKind === "column" ? `Column ${selectedIndex + 1} · ${selectedIndices.size} points`
          : `Point ${selectedIndex + 1} · Row ${Math.floor(selectedIndex / columns) + 1}, Column ${selectedIndex % columns + 1}`;
    controls.warpStatus.textContent = `${selectedName} · ${warpState.stepMode === "coarse" ? "1 px" : "0.25 px"}${baselineStatus}${validationStatus}`;
    controls.gridLayout.update({ grid: warp?.grid, selection: warpState.selection, errorMessage: warpState.validationMessage || "", visible: mode === "grid" });
    controls.warpSelectionControls.hidden = mode !== "grid";
    for (const control of controls.warpSelectionButtons) control.setAttribute("aria-pressed", String(control.dataset.warpSelectionKind === selectionKind));
    const selectionCount = selectionKind === "row" ? rows : selectionKind === "column" ? columns : rows * columns;
    const pickerOptions = Array.from({ length: selectionCount }, (_, index) => {
      const label = selectionKind === "point"
        ? `Point ${index + 1} · Row ${Math.floor(index / columns) + 1}, Column ${index % columns + 1}`
        : `${selectionKind === "row" ? "Row" : "Column"} ${index + 1}`;
      return make(doc, "option", { value: String(index) }, label);
    });
    controls.warpSelectionPicker.replaceChildren(...pickerOptions);
    controls.warpSelectionPicker.value = String(Math.min(selectionCount - 1, Math.max(0, selectedIndex)));
    controls.warpPositionLabels[0].textContent = selectionKind === "point" || mode === "keystone" ? "X px" : "Mean X px";
    controls.warpPositionLabels[1].textContent = selectionKind === "point" || mode === "keystone" ? "Y px" : "Mean Y px";
    controls.warpReset.textContent = mode === "grid" ? `Reset ${selectionKind}` : "Reset point";
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
    const viewPoints = allHandles;
    const nextFit = warpViewport(viewPoints);
    warpViewBox = nextFit;
    if (!effectiveWarpViewBox || targetChanged) { warpPanMode = false; panToggle.setAttribute("aria-pressed", "false"); effectiveWarpViewBox = nextFit; }
    const displayViewBox = pointerInput.activeViewBox() || effectiveWarpViewBox;
    controls.warpSurface.setAttribute("viewBox", warpViewBoxValue(displayViewBox));
    const focusedHandleIndex = doc.activeElement?.classList?.contains?.("warp-handle") ? Number(doc.activeElement.getAttribute("data-index")) : null;
    controls.warpSurface.replaceChildren();
    controls.warpSurface.appendChild(svgNode(doc, "rect", { class: "warp-output-rect", x: "0", y: "0", width: String(WARP_OUTPUT_WIDTH), height: String(WARP_OUTPUT_HEIGHT) }));
    const pathFor = (points) => points.map((point, index) => `${index ? "L" : "M"}${point.x * WARP_OUTPUT_WIDTH} ${point.y * WARP_OUTPUT_HEIGHT}`).join(" ");
    if (mode === "grid" && allHandles.length >= columns * rows) {
      for (let row = 0; row < rows; row += 1) controls.warpSurface.appendChild(svgNode(doc, "path", { class: `warp-grid-line${selectionKind === "row" && selectedIndex === row ? " selected" : ""}`, d: pathFor(allHandles.slice(row * columns, (row + 1) * columns)) }));
      for (let column = 0; column < columns; column += 1) controls.warpSurface.appendChild(svgNode(doc, "path", { class: `warp-grid-line${selectionKind === "column" && selectedIndex === column ? " selected" : ""}`, d: pathFor(Array.from({ length: rows }, (_, row) => allHandles[row * columns + column])) }));
    } else if (allHandles.length >= 4) {
      controls.warpSurface.appendChild(svgNode(doc, "path", { class: "warp-grid-line", d: `${pathFor([allHandles[0], allHandles[1], allHandles[3], allHandles[2]])} Z` }));
    }
    allHandles.forEach((point, index) => {
      const selected = selectedIndices.has(index);
      const label = mode === "keystone" ? ["top-left corner", "top-right corner", "bottom-left corner", "bottom-right corner"][index] || `corner ${index + 1}` : `point ${index + 1}, row ${Math.floor(index / columns) + 1}, column ${index % columns + 1}`;
      const circle = svgNode(doc, "circle", { cx: point.x * WARP_OUTPUT_WIDTH, cy: point.y * WARP_OUTPUT_HEIGHT, r: selected ? "18" : "12", class: `warp-handle${selected ? " selected" : ""}`, "data-index": String(index), tabindex: "0", role: "button", "aria-label": `Select ${label}` });
      circle.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault?.();
        cancelActiveDrag({ reason: "selection" });
        const selection = mode === "keystone" ? { mode, kind: "corner", index } : gridSelectionForHandle(warpState.selection, index, columns);
        onWarpAction("warp-select", { output, selection });
      });
      controls.warpSurface.appendChild(circle);
    });
    if (focusedHandleIndex !== null) controls.warpSurface.querySelector?.(`.warp-handle[data-index="${focusedHandleIndex}"]`)?.focus?.();
    dialog.setViewBox(displayViewBox);
    updateWarpMarkerRadii();
    if (trace?.enabled) {
      const rect = latestWarpRect || { left: 0, top: 0, width: 0, height: 0 };
      recordProjectionTrace(trace, 'redraw', { surface: 'warp', phase: 'end', output, mode, columns, rows, baselineType: warp?.baseline?.type || 'unknown', durationMs: projectionTraceTime(trace) - traceStarted, rectX: rect.left ?? 0, rectY: rect.top ?? 0, rectWidth: rect.width, rectHeight: rect.height, viewX: displayViewBox.x, viewY: displayViewBox.y, viewWidth: displayViewBox.width, viewHeight: displayViewBox.height });
    }
  };
  const update = ({ state = {}, errors = {}, conflict = "", statusText = "", draftDiffersFromAccepted = false, savePending = false, selectedNode = "pre", loadedPresetId = null, loadedPresetLoadToken = 0, statusRows = [], appliedSummary = 'Pending', outputState = {}, warpStates = {}, activePattern = { pattern: "off" }, namesWallStatus = null, namesRunDisabledReason = "", clockScene = "home", clockElement = "clock", clockLayouts = {}, clockHydration = { status: "Loading" }, settlement = null } = {}) => {
    if (state.draft) currentDraft = state.draft;
    currentFieldErrors = errors.fields || errors.field || errors;
    currentStatus = statusText;
    controls.live.checked = Boolean(state.live);
    controls.applyLiveDescription.textContent = state.live ? "Live on. Changes update automatically." : "Live off. Use Apply once in Tools, or Apply & save.";
    const dirtyLocalDraft = Boolean(state.hasLocalDraft || draftDiffersFromAccepted);
    controls.status.textContent = dirtyLocalDraft && !state.live
      ? `${statusText}. Changes have not reached the outputs. Apply or save before reload. Reloading discards this local draft.`
      : statusText;
    controls.save.textContent = draftDiffersFromAccepted ? "Apply & save" : "Save preset";
    controls.save.setAttribute("aria-label", draftDiffersFromAccepted ? "Apply and save preset" : "Save preset");
    controls.save.title = draftDiffersFromAccepted ? "Apply & save preset" : "Save preset";
    controls.saveStatus.textContent = statusText || (dirtyLocalDraft ? "Unsaved changes" : "");
    controls.liveWarning.textContent = dirtyLocalDraft && !state.live ? controls.status.textContent : "";
    controls.liveWarning.hidden = !(dirtyLocalDraft && !state.live);
    controls.conflict.textContent = conflict;
    controls.conflict.hidden = !conflict;
    const setUtilityError = (indicator, details, message) => {
      const text = String(message || "");
      indicator.hidden = !text;
      details.textContent = text;
      details.hidden = !text;
    };
    const presetError = errors.preset || errors.name;
    const displayError = outputState.error || errors.outputs || errors.output;
    const visibleErrors = new Map();
    const addVisibleError = (section, message) => {
      const text = String(message || "");
      if (text && !visibleErrors.has(text)) visibleErrors.set(text, `${section}: ${text}`);
    };
    addVisibleError("Preset management", presetError);
    addVisibleError("Display setup", displayError);
    addVisibleError("Calibration action", errors.action);
    addVisibleError("Output preview", state.previewError);
    const actionError = [...visibleErrors.values()].join(" · ");
    const toolsError = actionError;
    setUtilityError(controls.toolsErrorIndicator, controls.toolsErrorDetails, toolsError);
    controls.toolsSummary.title = toolsError ? `Tools contains an error: ${toolsError}` : "Preset loading, output status, display setup, and advanced actions";
    controls.toolsSummary.setAttribute("aria-label", toolsError ? `Tools. ${toolsError}` : "Tools");
    controls.actionError.textContent = actionError;
    controls.actionError.hidden = !actionError;
    controls.connectionStatus.textContent = state.hydrationError ? `Settings check failed: ${state.hydrationError}` : state.hydrating ? "Connecting to current settings…" : state.connected === false ? "Disconnected from current settings. Live remains off until settings are reconciled." : "";
    controls.connectionStatus.hidden = !state.hydrating && !state.hydrationError && state.connected !== false;
    controls.retryHydration.hidden = !state.hydrationError;
    const screens = Array.isArray(outputState.screens) ? [...outputState.screens].sort((a, b) => a.displayNumber - b.displayNumber) : [];
    const assignments = outputState.assignments || {};
    const optionFor = (screen) => make(doc, "option", { value: screen.key }, `Display ${screen.displayNumber}`);
    const unsupportedOutputControl = outputState.supported === false;
    controls.outputIdentify.disabled = unsupportedOutputControl || screens.length === 0;
    for (const control of [controls.outputRefresh, controls.outputAssign, controls.outputLeftDisplay, controls.outputRightDisplay, controls.outputOpenBoth, controls.outputCloseBoth]) control.disabled = unsupportedOutputControl;
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
    const capabilityMessage = "Open/close outputs on the workstation; this browser does not support display management.";
    controls.outputCapabilityNotice.textContent = capabilityMessage;
    controls.outputCapabilityNotice.hidden = !unsupportedOutputControl;
    controls.outputStatus.textContent = unsupportedOutputControl
      ? capabilityMessage
      : outputState.message || "Identify displays on the workstation.";
    const presets = state.snapshot?.presets || [];
    const selectedPreset = state.selectedPresetId || state.snapshot?.selectedPresetId || "original";
    controls.presets.replaceChildren(...presets.map((preset) => make(doc, "option", { value: preset.id }, preset.name)));
    controls.presets.value = selectedPreset;
    const loadedPreset = presets.find((preset) => preset.id === loadedPresetId);
    controls.loadedPresetIdentity.textContent = `Loaded: ${loadedPreset?.name || "unknown"}`;
    controls.loadedPresetIdentity.title = `Loaded: ${loadedPreset?.name || "unknown"}`;
    controls.presets.setAttribute("aria-describedby", "projection-loaded-preset-identity");
    controls.loadedPresetIdentity.id = "projection-loaded-preset-identity";
    const selectedPresetName = presets.find((preset) => preset.id === selectedPreset)?.name || "unknown";
    controls.toolsPresetContext.textContent = `Selected: ${selectedPresetName}. ${controls.loadedPresetIdentity.textContent}. Loading is explicit.`;
    controls.toolsPresetContext.title = controls.toolsPresetContext.textContent;
    controls.save.disabled = Boolean(savePending || !loadedPreset || loadedPreset.readOnly);
    controls.saveNew.disabled = Boolean(savePending);
    controls.originalCheckpointGuidance.hidden = !loadedPreset?.readOnly;
    controls.originalCheckpointGuidance.textContent = loadedPreset?.readOnly ? `${loadedPreset.name || "Loaded preset"} is immutable. Use Save as new.` : "";
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
    controls.projectionElement.value = clockElement;
    for (const [id, status] of clockNodeStatuses) status.render(clockLayouts[id]?.record, clockHydration);
    settlementControls.render(settlement || { hydration: { status: "Loading" }, enabled: false });
    const wallConfig = draft.namesWall;
    for (const help of modelSpacingHelpControls) help.hidden = wallConfig?.activeMode !== "model";
    for (const select of namesModeControls) select.value = wallConfig?.activeMode || "wall";
    for (const reset of pageSpacingResetControls) reset.hidden = wallConfig?.activeMode !== "wall";
    const wallStatus = namesWallStatus || { state: "building", expected: null, placed: null };
    const wallMessage = wallStatus.detail || "Waiting for names output status…";
    for (const status of namesStatusControls) {
      status.textContent = wallMessage;
      status.dataset.state = wallStatus.state || "initializing";
      status.classList?.toggle("is-invalid", wallStatus.state === "failed");
      status.classList?.toggle("is-reduced", false);
    }
    for (const run of namesRunButtons) { run.disabled = Boolean(namesRunDisabledReason); run.title = namesRunDisabledReason || "Run names for the applied calibration."; }
    renderWarpPanel(warpStates, selectedNode);
    dialog.update(draft, { live: state.live, appliedSummary, namesRunStatus: wallMessage, namesRunDisabledReason });
    parameterDialog.update({ config: draft, fieldErrors: errors.fields || errors.field || errors, status: controls.status.textContent });
    for (const [output, control] of patternControls) control.value = activePattern.branch === output ? activePattern.pattern : "off";
    for (const descriptor of descriptors) {
      const value = namesWallProfileScoped(descriptor.path)
        ? draft.namesWall?.profiles?.[descriptor.wallOnly ? "wall" : draft.namesWall?.activeMode]?.[descriptor.path.slice("namesWall.".length)]
        : readPath(draft, descriptor.path);
      const control = fields.get(`${descriptor.node}:${descriptor.path}`);
      if (!control) continue;
      control.wrap.hidden = Boolean(descriptor.wallOnly && draft.namesWall?.activeMode !== "wall");
      const errorPath = namesWallProfileScoped(descriptor.path) && draft.namesWall?.activeMode
        ? `namesWall.profiles.${descriptor.wallOnly ? "wall" : draft.namesWall.activeMode}.${descriptor.path.slice("namesWall.".length)}`
        : descriptor.path;
      const fieldError = errors[errorPath] || Object.entries(errors).find(([key]) => errorPath.startsWith(`${key}.`))?.[1] || "";
      control.update({value, resolvedPath: errorPath, error: fieldError});
    }
    const outputAcknowledgement = `Outputs: ${({ Applied: "applied", Pending: "pending", Failed: "failed", Unconfirmed: "unconfirmed" }[appliedSummary] || String(appliedSummary).toLowerCase())}`;
    controls.appliedSummary.textContent = outputAcknowledgement;
    controls.toolsAppliedSummary.textContent = outputAcknowledgement;
    const outputFailures = statusRows.filter((row) => row.success === false && row.instanceId).map((row) => {
      const label = row.output[0].toUpperCase() + row.output.slice(1);
      return `${label} output: ${row.error || "Application not confirmed"}`;
    });
    controls.appliedFailure.textContent = outputFailures.join(" · ");
    controls.appliedFailure.hidden = outputFailures.length === 0;
    controls.appliedRows.replaceChildren(...statusRows.map((row) => make(doc, "p", { className: row.success ? "applied" : "not-confirmed" }, row.text)));
    status.hidden = !(controls.liveWarning.hidden === false || conflict || actionError || !controls.connectionStatus.hidden || !controls.outputCapabilityNotice.hidden || outputFailures.length > 0);
  };
  setNode("pre");
  return {
    update, controls, fields, nodeMap, parameterDialog, setPresetName, canManageDisplays: true,
    getClockEditorOpener(node) {
      return nodeMap.get(node)?.querySelector?.('[data-action="clock-editor-open"]') || null;
    },
    getNovaExplainerEditorOpener() {
      const card = nodeMap.get("nova-explainers");
      return card?.querySelector?.('[data-action="nova-explainer-editor-open"]')
        || [...(card?.children || [])].find((node) => node.dataset?.action === "nova-explainer-editor-open")
        || null;
    },
    getSettlementEditorOpener() {
      return nodeMap.get("settlement-names")?.querySelector?.('[data-action="settlement-editor-open"]') || null;
    },
    cancelWarpPointer: cancelActiveDrag,
    finishNumericEdits: () => [...fields.values()].map(control => control.finish()),
    cancelNumericEdits: () => { for (const control of fields.values()) control.cancel(); parameterDialog.cancel(); },
    closeWarpEditor: dialog.close,
    sendRunNamesPreview: (config) => dialog.sendRunNamesPreview(config),
    dispose() { for (const control of fields.values()) control.dispose(); settlementControls.dispose(); disposePageTrace(); disposeWarpTrace(); disposeGraphTrace(); traceUi?.dispose(); outputPlacementQuery?.removeEventListener?.("change", updateOutputPlacement); doc.removeEventListener?.("keydown", onKeyDown); doc.removeEventListener?.("keydown", dismissDisclosures); doc.removeEventListener?.("pointerdown", dismissDisclosures, true); parameterDialog.dispose(); dialog.dispose(); pointerInput.dispose(); canvas.dispose(); },
  };
}

export { displayValue, readPath, descriptorFor, renderField };
