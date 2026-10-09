import { createConfigCommandBar } from './config-command-bar.js';
import { createGazaBorderVisibilityControls } from './gaza-border-visibility-controls.js';
import { DEFAULT_PROJECTION_CONFIG } from "../shared/projection-config-schema.js";
import { createNodeCanvas } from "./node-canvas.js";
import { createWarpEditorDialog } from "./warp-editor-dialog.js";
import { createPointMatchControls } from './point-match-controls.js';
import { measureProjectionLandmarks } from '../shared/projection-point-fit.js';
import { bindWarpPointerInput, gridSelectionForHandle } from "./warp-pointer-input.js";
import { clampWarpViewBox, transformWarpViewBox, warpMarkerRadius, warpPointFromClient } from "./warp-viewport.js";
import { createClockLayoutStatus } from "./clock-layout-controls.js";
import { createSettlementNameControls } from "./settlement-name-controls.js";
import { createGridLayoutControls, deriveGridSelectionIndices } from "./grid-layout-controls.js";
import { createWarpEditor } from "./warp-editor.js";
import { createParameterEditorDialog, presentationError } from "./parameter-editor-dialog.js";
import { createParameterEditorPreviews } from "./parameter-editor-previews.js";
import { displayValue, renderField } from "./config-field-control.js";
import { createWarpPanelView } from "./warp-panel-view.js";
import { createProjectionTraceUi } from './projection-trace-ui.js';
import { bindProjectionTraceInput, bindProjectionTracePage, recordProjectionTrace, projectionTraceTime } from './projection-trace-input.js';
import { createStaffRemotePanel } from "./staff-remote-panel.js";

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
  socket,
  staffRemoteManager = null,
  descriptors = [],
  onAction = () => {},
  onRunNames = () => {},
  onOutputAction = () => {},
  onField = () => {},
  onFieldCancel = () => {},
  onNudge = () => {},
  onNamesMode = () => {},
  onGazaBorderVisibility = () => {},
  onGazaBorderReload = () => {},
  onNode = () => {},
  onOpenClockEditor = () => {},
  onOpenNovaExplainerEditor = () => {},
  onOpenSettlementEditor = () => {},
  onSettlementOutput = () => {},
  onSettlementCitycode = () => {},
  onSettlementPosition = () => {},
    onSettlementStyle = () => {},
    onSettlementLineBreak = () => {},
    onSettlementLeaderStyle = () => {},
    onSettlementResetOrigin = () => {},
  onSettlementRecovery = () => {},
  onRetrySettlementCatalog = () => {},
  onClockScene = () => {},
  onClockElement = () => {},
  onClockField = () => {},
  onClockRecovery = () => {},
  onWarpAction = () => {},
  onWarpEditorVisibility = () => {},
  onWarpFieldCancel = () => {},
  onWarpPointer = () => {},
  onPointMatchAction = () => {},
  onBeforeWarpClose = () => true,
  onBeforeWarpSwitch = () => true,
  onWarpPreviewInvalidated = () => {},
  onWarpPreviewStateChange = () => {},
  warpEditorFactory = createWarpEditor,
  requestVisualFrame = null,
  cancelVisualFrame = null,
  trace,
} = {}) {
  const doc = docFor(root);
  if (!root || !doc?.createElement) throw new Error("projection config root is required");
  root.className = "projection-config-app";
  const fields = new Map();
  const nativeRequestFrame = doc.defaultView?.requestAnimationFrame?.bind(doc.defaultView);
  const nativeCancelFrame = doc.defaultView?.cancelAnimationFrame?.bind(doc.defaultView);
  const requestFrame = requestVisualFrame || nativeRequestFrame || null;
  const cancelFrame = cancelVisualFrame || nativeCancelFrame || (() => {});
  let pendingWarpFrame = null;
  let latestWarpPaint = null;
  let disposed = false;
  let warpPaintGeneration = 0;
  const cancelPendingWarpPaint = () => {
    warpPaintGeneration += 1;
    if (pendingWarpFrame !== null) cancelFrame(pendingWarpFrame);
    pendingWarpFrame = null;
    latestWarpPaint = null;
  };

  const clockNodeStatuses = new Map();
  let selectedGraphNode = "pre";
  const app = make(doc, "div", { className: "config-shell" });
  const staffRemotePanel = staffRemoteManager ? createStaffRemotePanel({ document: doc, manager: staffRemoteManager }) : null;
  const commandBar = createConfigCommandBar({ document: doc, onAction, onOutputAction, staffRemotePanel });
  const controls = commandBar.controls;
  const setPresetName = commandBar.setPresetName;
  const traceUi = trace?.enabled ? createProjectionTraceUi({ document: doc, trace }) : null;
  const disposePageTrace = bindProjectionTracePage({ document: doc, trace });
  const workspace = make(doc, "div", { className: "config-workspace" });
  const graphColumn = make(doc, "section", { className: "graph-column" });
  const editorRegion = make(doc, "aside", { className: "config-editor-region", ariaLabel: "Selected node editing" });
  const editorRegionHeading = make(doc, "h2", {}, "Selected node");
  const editorNodeHeading = make(doc, "h3", { className: "config-editor-node-heading" }, "Shared pre-transform");
  const editorHelp = make(doc, "p", { className: "config-editor-help" }, "Current values stay available here and on the graph. Open the enlarged editor for focused adjustments.");
  const selectedContext = make(doc, "div", { className: "config-selected-context", ariaLabel: "Current parameters for Shared pre-transform" });
  const enlargeEdit = button(doc, "Enlarge edit", "parameter-editor-open", "config-enlarge-edit");
  const parameterEditorNodes = new Set(["pre", "left-crop", "right-crop", "left-fit", "right-fit", "names-wall"]);
  const editorEmptyState = make(doc, "p", { className: "config-editor-empty" }, "Choose a node with editable controls to open its editor.");
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
    Content: ["content"],
    Geometry: ["pre", "left-crop", "right-crop", "left-fit", "right-fit", "left-keystone", "right-keystone", "left-grid", "right-grid", "left-output", "right-output"],
    Overlays: ["clock-gis", "nova-explainers", "clock-projection"],
    Names: ["names-wall", "settlement-names"],
  };
  const categoryActions = controls.workspaceNav;
  for (const [category, nodeIds] of Object.entries(categoryGroups)) {
    const shortcut = button(doc, category, `focus-${category.toLowerCase()}`, "config-category-action");
    shortcut.dataset.focusNodes = nodeIds.join(" ");
    shortcut.addEventListener("click", () => canvas.focusNodes(nodeIds));
    categoryActions.appendChild(shortcut);
  }
  if (traceUi) controls.toolsContent.appendChild(traceUi.element);
  app.append(commandBar.element);
  const nodeMap = new Map();
  const borderVisibility = createGazaBorderVisibilityControls(doc, { onChange: onGazaBorderVisibility, onReload: onGazaBorderReload });
  const borderEditorVisibility = createGazaBorderVisibilityControls(doc, { onChange: onGazaBorderVisibility, onReload: onGazaBorderReload });
  const warpNodePreviews = new Map();
  const miniGeometryCache = new Map();
  const meshObjectIds = new WeakMap();
  let nextMeshObjectId = 0;
  const patternControls = new Map();
  const inlinePendingTargetNotes = new Map();
  let parameterDialog = null;
  let activeParameterNode = null;
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
  const updateWarpNodePreviews = (warpStates = {}) => {
    for (const [id, preview] of warpNodePreviews) {
      const state = warpStates[preview.output];
      const warp = state?.config?.outputs?.[preview.output]?.warp;
      const grid = warp?.grid;
      const rows = grid?.rows || 7;
      const columns = grid?.columns || (preview.output === "right" ? 8 : 7);
      let handles = [];
      if (state && warp && state.selection?.mode === preview.mode && Array.isArray(state.handles)) handles = state.handles;
      else if (preview.mode === "keystone" && Array.isArray(warp?.keystone?.corners)) {
        const geometryKey = `${preview.output}:keystone:${JSON.stringify(warp.keystone.corners)}`;
        const retained = miniGeometryCache.get(id);
        if (retained?.key === geometryKey) handles = retained.handles;
        else {
          handles = warp.keystone.corners.map(([x, y]) => ({ x, y }));
          miniGeometryCache.set(id, { key: geometryKey, handles });
        }
      } else if (preview.mode === "grid" && state && warp) {
        let meshId = 0;
        if (state.baselineMesh && typeof state.baselineMesh === "object") {
          meshId = meshObjectIds.get(state.baselineMesh) || ++nextMeshObjectId;
          meshObjectIds.set(state.baselineMesh, meshId);
        }
        const geometryKey = `${preview.output}:grid:${state.config?.schemaVersion ?? "unknown"}:${meshId}:${JSON.stringify(warp)}`;
        const retained = miniGeometryCache.get(id);
        if (retained?.key === geometryKey) handles = retained.handles;
        else {
          const stage = warpEditorFactory({ config: state.config, output: preview.output, baselineMesh: state.baselineMesh });
          stage.setMode("grid");
          handles = stage.getControlPoints();
          miniGeometryCache.set(id, { key: geometryKey, handles });
        }
      }
      if (preview.mode === "grid" && handles.length === 0 && grid) {
        const xPositions = grid.columnPositions || Array.from({ length: columns }, (_, column) => column / (columns - 1));
        const yPositions = grid.rowPositions || Array.from({ length: rows }, (_, row) => row / (rows - 1));
        handles = yPositions.flatMap((y, row) => xPositions.map((x, column) => {
          const offset = grid.offsets?.[row * columns + column] || [0, 0];
          return { x: x + (offset[0] || 0), y: y + (offset[1] || 0) };
        }));
      }
      const selection = state?.selection?.mode === preview.mode ? state.selection : null;
      const index = Math.max(0, Number(selection?.index) || 0);
      const selected = new Set(selection ? selection.indices || [index] : []);
      const target = !selection ? "No active selection" : preview.mode === "keystone"
        ? ["Top-left corner", "Top-right corner", "Bottom-left corner", "Bottom-right corner"][index] || `Corner ${index + 1}`
        : selection.kind === "row" ? `Row ${index + 1}`
          : selection.kind === "column" ? `Column ${index + 1}`
            : `Point ${index + 1} · Row ${Math.floor(index / columns) + 1}, Column ${index % columns + 1}`;
      const enabled = Boolean(warp?.enabled);
      const baselineText = state?.baselineAvailable === false ? " · TD baseline unavailable" : "";
      const stateText = state ? `${WARP_OUTPUT_WIDTH} × ${WARP_OUTPUT_HEIGHT} px · ${enabled ? "Enabled" : "Disabled"} · ${target}${baselineText}` : `${WARP_OUTPUT_WIDTH} × ${WARP_OUTPUT_HEIGHT} px · Warp state loading`;
      preview.summary.textContent = stateText;
      preview.element.setAttribute("aria-label", `${id.replace("-", " ")} geometry, ${stateText}`);
      let render = preview.renderState;
      const topologyKey = JSON.stringify([preview.output, preview.mode, WARP_OUTPUT_WIDTH, WARP_OUTPUT_HEIGHT, rows, columns, grid?.columnPositions || null, grid?.rowPositions || null, warp?.baseline || null, handles.length]);
      if (!render || render.topologyKey !== topologyKey) {
        const lines = preview.mode === "grid" && handles.length >= rows * columns ? rows + columns : handles.length >= 4 ? 1 : 0;
        const frame = svgNode(doc, "rect", { class: "warp-node-frame", x: "0", y: "0", width: String(WARP_OUTPUT_WIDTH), height: String(WARP_OUTPUT_HEIGHT) });
        const paths = Array.from({ length: lines }, () => svgNode(doc, "path", { class: "warp-node-line" }));
        const markers = handles.map(() => svgNode(doc, "circle", { class: "warp-node-handle", r: "36" }));
        preview.mesh.replaceChildren(frame, ...paths, ...markers);
        render = { topologyKey, frame, paths, markers, handles: null, viewBox: null };
        preview.renderState = render;
      }
      const pathFor = (points) => points.map((point, pointIndex) => `${pointIndex ? "L" : "M"}${point.x * WARP_OUTPUT_WIDTH} ${point.y * WARP_OUTPUT_HEIGHT}`).join(" ");
      const geometryChanged = render.handles !== handles;
      if (geometryChanged) {
        if (preview.mode === "grid" && handles.length >= rows * columns) {
          for (let row = 0; row < rows; row += 1) render.paths[row].setAttribute("d", pathFor(handles.slice(row * columns, (row + 1) * columns)));
          for (let column = 0; column < columns; column += 1) render.paths[rows + column].setAttribute("d", pathFor(Array.from({ length: rows }, (_, row) => handles[row * columns + column])));
        } else if (handles.length >= 4) render.paths[0].setAttribute("d", `${pathFor([handles[0], handles[1], handles[3], handles[2]])} Z`);
        handles.forEach((point, pointIndex) => {
          const marker = render.markers[pointIndex];
          marker.setAttribute("cx", String(point.x * WARP_OUTPUT_WIDTH)); marker.setAttribute("cy", String(point.y * WARP_OUTPUT_HEIGHT));
        });
        render.handles = handles;
      }
      handles.forEach((_point, pointIndex) => render.markers[pointIndex].setAttribute("class", selected.has(pointIndex) ? "warp-node-handle selected" : "warp-node-handle"));
      if (geometryChanged || !render.viewBox) {
        const boundsPoints = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, ...handles];
        const minX = Math.min(...boundsPoints.map((point) => point.x * WARP_OUTPUT_WIDTH));
        const maxX = Math.max(...boundsPoints.map((point) => point.x * WARP_OUTPUT_WIDTH));
        const minY = Math.min(...boundsPoints.map((point) => point.y * WARP_OUTPUT_HEIGHT));
        const maxY = Math.max(...boundsPoints.map((point) => point.y * WARP_OUTPUT_HEIGHT));
        const paddingX = WARP_OUTPUT_WIDTH * 0.08;
        const paddingY = WARP_OUTPUT_HEIGHT * 0.08;
        render.viewBox = `${minX - paddingX} ${minY - paddingY} ${Math.max(WARP_OUTPUT_WIDTH, maxX - minX) + paddingX * 2} ${Math.max(WARP_OUTPUT_HEIGHT, maxY - minY) + paddingY * 2}`;
        preview.mesh.setAttribute("viewBox", render.viewBox);
      }
    }
  };
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
    const help = make(doc, "p", { className: "names-wall-units names-wall-model-help" }, "Rows reach both model edges and spread over the full height. Spacing sets the minimum gap; leftover row width is shared between names. Names continue across the projector join. Edge inset applies to the model outline.");
    modelSpacingHelpControls.push(help);
    return help;
  }
  const namesEditorTools = make(doc, "div", { className: "names-wall-editor-tools", hidden: true });
  namesEditorTools.append(namesModeControl(), pageSpacingReset(), namesRunControl(), namesStatus());
  const namesEditorNotes = make(doc, "div", { className: "names-wall-editor-notes", hidden: true });
  namesEditorNotes.append(make(doc, "p", { className: "names-wall-units" }, namesWallUnitsHelp),
    make(doc, "p", { className: "names-wall-units names-wall-rotation" }, namesWallRotationHelp), modelSpacingHelp(),
    make(doc, "p", { className: "names-wall-units" }, "0 keeps the current positions. Increase to move the pages inward where space allows."));
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
    if (id === "content") card.appendChild(borderVisibility.element);
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
    for (const descriptor of nodeFields) {
      const control = renderField(doc, descriptor, onField, onNudge, false, false, onFieldCancel);
      fields.set(`${id}:${descriptor.path}`, control);
      if (descriptor.wallOnly) {
        const note = make(doc, "p", { className: "config-field-pending-target", hidden: true, role: "status" }, "Pending edit still targets the Regular wall profile. Cancel this field before returning to nodes.");
        control.wrap.appendChild(note);
        inlinePendingTargetNotes.set(`${id}:${descriptor.path}`, note);
      }
      card.appendChild(control.wrap);
    }
    if (["pre", "left-crop", "right-crop", "left-fit", "right-fit"].includes(id)) {
      const adjust = button(doc, "Enlarge edit", "parameter-editor-open", "parameter-editor-open-button");
      adjust.addEventListener("click", (event) => {
        event.stopPropagation?.(); if (onNode(id) === false) return;
        activeParameterNode = id;
        parameterDialog?.open({ nodeId: id, title: label, descriptors: nodeFields, opener: adjust });
        if (id === "names-wall") { parameterDialog?.fieldsElement.prepend(namesEditorTools); parameterDialog?.fieldsElement.appendChild(namesEditorNotes); }
        parameterDialog?.update({ config: currentDraft, fieldErrors: currentFieldErrors, status: currentStatus });
      });
      card.appendChild(adjust);
    }
    if (id === "names-wall") card.append(modelSpacingHelp(), make(doc, "p", { className: "names-wall-units" }, "0 keeps the current positions. Increase to move the pages inward where space allows."), pageSpacingReset(), namesStatus());
    if (id.endsWith("-keystone") || id.endsWith("-grid")) {
      const output = id.startsWith("right-") ? "right" : "left";
      const mode = id.endsWith("-grid") ? "grid" : "keystone";
      const geometry = make(doc, "div", { className: "warp-node-geometry", ariaLabel: `${output} ${mode} geometry preview` });
      const mesh = svgNode(doc, "svg", { class: "warp-node-mesh", viewBox: `0 0 ${WARP_OUTPUT_WIDTH} ${WARP_OUTPUT_HEIGHT}`, "aria-hidden": "true", focusable: "false" });
      const summary = make(doc, "p", { className: "warp-node-summary" }, `${WARP_OUTPUT_WIDTH} × ${WARP_OUTPUT_HEIGHT} px · Warp state loading`);
      geometry.append(mesh, summary); card.appendChild(geometry);
      warpNodePreviews.set(id, { output, mode, element: geometry, mesh, summary, renderState: null });
    }
    if (id.endsWith("-keystone") || id.endsWith("-grid")) {
      const openButton = button(doc, "Edit", "warp-editor-open", "warp-open-button");
      openButton.addEventListener("click", (event) => { event.stopPropagation?.(); if (onNode(id) === false) return; dialog.open({ side: id.startsWith("right-") ? "right" : "left", mode: id.endsWith("-grid") ? "grid" : "keystone", opener: openButton }); flushPendingWarpPaint(); });
      card.appendChild(openButton);
    }
    if (id === "settlement-names") {
      const openButton = button(doc, "Open editor", "settlement-editor-open", "settlement-open-button");
      openButton.addEventListener("click", (event) => { event.stopPropagation?.(); if (onNode(id) === false) return; onOpenSettlementEditor(); });
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
        event.stopPropagation?.(); if (onNode(id) === false) return;
        if (id === "nova-explainers") onOpenNovaExplainerEditor();
        else onOpenClockEditor(id);
      });
      if (id !== "nova-explainers") {
        card.addEventListener("dblclick", (event) => {
          if (event.target === handle || event.target?.parentElement === handle || event.target === sceneControl || event.target === elementControl || event.target === openButton) return;
          if (onNode(id) === false) return; onOpenClockEditor(id);
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
      if (onNode(id) === false) return;
      if (event.key === "Enter" && (id === "clock-gis" || id === "clock-projection")) onOpenClockEditor(id);
      if (event.key === "Enter" && id === "nova-explainers") onOpenNovaExplainerEditor();
      if (event.key === "Enter" && id === "settlement-names") onOpenSettlementEditor();
    });
    nodeMap.set(id, card); graph.appendChild(card);
  }
  graphColumn.append(graphTitle, graphViewport, make(doc, "p", { className: "canvas-help" }, "Drag headers to move nodes · Drag background to pan · Scroll to zoom"));
  editorRegion.append(editorRegionHeading, editorNodeHeading, editorHelp, selectedContext, enlargeEdit, editorEmptyState);
  workspace.append(graphColumn, editorRegion);
  enlargeEdit.addEventListener("click", (event) => {
    event.stopPropagation?.();
    const id = selectedGraphNode;
    if (onNode(id) === false) return;
    const selectedFields = descriptors.filter((item) => item.node === id);
    if (parameterEditorNodes.has(id) && selectedFields.length) {
      activeParameterNode = id;
      parameterDialog?.open({ nodeId: id, title: graphNodes.find(([nodeId]) => nodeId === id)?.[1], descriptors: selectedFields, opener: enlargeEdit });
      if (id === "names-wall") { parameterDialog?.fieldsElement.prepend(namesEditorTools); parameterDialog?.fieldsElement.appendChild(namesEditorNotes); }
      parameterDialog?.update({ config: currentDraft, fieldErrors: currentFieldErrors, status: currentStatus });
    } else if (id.endsWith("-keystone") || id.endsWith("-grid")) {
      dialog.open({ side: id.startsWith("right-") ? "right" : "left", mode: id.endsWith("-grid") ? "grid" : "keystone", opener: enlargeEdit });
      flushPendingWarpPaint();
    } else if (id === "clock-gis" || id === "clock-projection") onOpenClockEditor(id);
    else if (id === "nova-explainers") onOpenNovaExplainerEditor();
    else if (id === "settlement-names") onOpenSettlementEditor();
  });

  const warpPanelView = createWarpPanelView({ document: doc, canChangeSelection: () => !pointerInput?.isActive(),
    onAction: (action, value = {}) => {
      const output = value.output || (selectedGraphNode.startsWith("right-") ? "right" : "left");
      if (action === "warp-field-cancel") return onWarpFieldCancel(output);
      if (action === "warp-reset-selection" && doc.defaultView?.confirm?.("Reset only the selected warp geometry? This does not change presets." ) !== true) return false;
      if (action === "warp-reset-residuals" && doc.defaultView?.confirm?.("Clear keystone and grid corrections for this output? The baseline and grid layout are retained." ) !== true) return false;
      if (action === "warp-start-fresh" && doc.defaultView?.confirm?.(`Start fresh for the ${output} projector? This removes its imported TD baseline, resets keystone and grid warp to a flat rectangle, and evenly spaces the current grid. Scale, rotation, crop, and translation stay unchanged. Undo can restore the previous warp while its baseline is available. With Live on, this applies immediately.`) !== true) return false;
      return onWarpAction(action, { output, ...value });
    },
    onPointer: (action, value) => {
      if (action === "start" && !finishCoordinates()) return false;
      const accepted = onWarpPointer(action, value);
      if (action === "start" && accepted) { activeWarpAdjusting = true; warpPanelView.setAdjusting(true); dialog?.updateAdjustmentGuard?.(); }
      return accepted;
    },
    onNudgeFocus: () => controls.warpSurface.focus?.(),
  });
  Object.assign(controls, warpPanelView.controls);
  controls.warpPanel = warpPanelView.element;
  controls.warpHeading = make(doc, "h3", {}, "Warp editor");
  controls.warpPanel.prepend(controls.warpHeading);
  controls.warpEnabled = make(doc, "input", { type: "checkbox", ariaLabel: "Enable browser warp" });
  const warpEnabledLabel = make(doc, "label", { className: "warp-enabled-label" }, "Browser warp correction"); warpEnabledLabel.prepend(controls.warpEnabled);
  controls.warpEnableAction = button(doc, "Enable correction to edit", "warp-enable-correction", "warp-enable-action");
  controls.warpEnableAction.addEventListener("click", () => onWarpAction("warp-enabled", { enabled: true, output: selectedGraphNode.startsWith("right-") ? "right" : "left" }));
  controls.warpActions.append(warpEnabledLabel, controls.warpEnableAction);
  const pointMatchStart = button(doc, 'Match points', 'point-match-start');
  pointMatchStart.addEventListener('click',()=>onPointMatchAction('start',warpOutput()));
  const pointMatchControls = createPointMatchControls({document:doc,onAction:onPointMatchAction});
  controls.warpPanel.append(pointMatchStart,pointMatchControls.element);
  let warpViewBox = { x: 0, y: 0, width: WARP_OUTPUT_WIDTH, height: WARP_OUTPUT_HEIGHT };
  let effectiveWarpViewBox = null;
  let warpViewTarget = "";
  let warpInteractionMode = "edit";
  controls.warpSurface = svgNode(doc, "svg", { class: "warp-edit-surface", viewBox: warpViewBoxValue(warpViewBox), role: "img", "aria-label": "Warp editing handles", tabindex: "0" });
  const navigationControls = make(doc, "div", { className: "warp-view-controls", ariaLabel: "Warp preview navigation" });
  const viewCommandGroup = make(doc, "div", { className: "warp-view-command-group", role: "group", ariaLabel: "Move view, zoom, and fit" });
  navigationControls.append(viewCommandGroup);
  const navButton = (label, className, action) => { const item = make(doc, "button", { type: "button", className }, label); item.addEventListener("click", action); viewCommandGroup.appendChild(item); return item; };
  const editModeButton = navButton("Edit", "warp-edit-toggle", () => setWarpInteractionMode("edit"));
  const panToggle = navButton("Move view", "warp-pan-toggle", () => setWarpInteractionMode("move"));
  function setWarpInteractionMode(mode) {
    if (pointerInput?.isActive()) return false;
    if (pointerInput && !pointerInput.setInteractionMode(mode)) return false;
    warpInteractionMode = mode;
    editModeButton.setAttribute("aria-pressed", String(mode === "edit"));
    panToggle.setAttribute("aria-pressed", String(mode === "move"));
    return true;
  }
  editModeButton.setAttribute("aria-pressed", "true");
  panToggle.setAttribute("aria-pressed", "false");
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
      const radius = circle.classList?.contains("selected") ? 8 : 5;
      circle.setAttribute("r", String(warpMarkerRadius(viewBox, rect.width, rect.height, radius)));
    });
    paintPointMatchMarkers();
  }
  function resetWarpView() { setWarpInteractionMode("edit"); effectiveWarpViewBox = warpViewBox; applyViewBox(warpViewBox); }
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
  controls.gridLayout = createGridLayoutControls(doc, (name, value) => {
    if (name === "placement-input") return onWarpAction("warp-grid-placement-edit", { output: warpOutput(), axis: value });
    if (pointerInput?.isActive() || !finishCoordinates()) return;
    const output = warpOutput();
    const grid = currentWarpGrid;
    const selection = currentSelection || { kind: "point", index: 0 };
    const { rowIndex, columnIndex } = deriveGridSelectionIndices(grid, selection);
    let operation, payload;
    if (name === "rows" || name === "columns") { operation = "resize"; payload = { axis: name === "rows" ? "row" : "column", count: value }; }
    else if (name === "source-y") { operation = "move"; payload = { axis: "row", index: rowIndex, position: value }; }
    else if (name === "source-x") { operation = "move"; payload = { axis: "column", index: columnIndex, position: value }; }
    else if (name === "add-row" || name === "add-column") {
      const axis = name === "add-row" ? "row" : "column";
      onWarpAction("warp-grid-placement", { output, axis: currentGridPlacement?.axis === axis ? null : axis });
      return;
    }
    else if (name === "place-row" || name === "place-column") { operation = "add"; payload = { axis: name === "place-row" ? "row" : "column", position: value }; }
    else if (name === "remove-row" || name === "remove-column") { operation = "remove"; payload = { axis: name === "remove-row" ? "row" : "column", index: name === "remove-row" ? rowIndex : columnIndex }; }
    else if (name === "even") { operation = "even"; payload = { axis: selection.kind === "column" ? "column" : "row" }; }
    else if (name === "rebuild") { operation = "rebuild"; payload = { rows: grid?.rows, columns: grid?.columns }; }
    if (operation) return onWarpAction("warp-grid-layout", { output, operation, ...payload });
  });
  controls.gridLayout.element.className = `${controls.gridLayout.element.className} warp-editor-topology-controls`;
  controls.warpEnabled.addEventListener("change", () => onWarpAction("warp-enabled", { output: selectedGraphNode.startsWith("right-") ? "right" : "left", enabled: controls.warpEnabled.checked }));
  let currentHandles = [];
  let currentSelection = null;
  let currentWarpGrid = null;
  let currentEvaluatedMesh = null;
  let currentGridPlacement = null;
  let currentWarpEnabled = true;
  let currentWarpOutput = "left";
  let currentWarpMode = "keystone";
  let currentWarpState = null;
  let warpSurfaceRenderState = null;
  let activeWarpAdjusting = false;
  let pointMatchState = null, pointMatchActive = false;
  let reconciliationActive = false;
  const updateLiveGuard = () => { if (controls.live) controls.live.disabled = reconciliationActive || pointMatchActive; };
  const ordinaryMatchVisibility = new Map();
  function syncOrdinaryMatchVisibility() {
    for (const row of controls.warpPanel.children) {
      if (row===pointMatchControls.element || row===pointMatchStart) continue;
      row.inert=pointMatchActive;
      if (pointMatchActive) { if (!ordinaryMatchVisibility.has(row)) ordinaryMatchVisibility.set(row,row.hidden);row.hidden=true; }
      else if (ordinaryMatchVisibility.has(row)) { row.hidden=ordinaryMatchVisibility.get(row);ordinaryMatchVisibility.delete(row); }
    }
  }
  const pointMatchMarkers = svgNode(doc,'g',{class:'point-match-markers','pointer-events':'none'});
  function paintPointMatchMarkers() {
    pointMatchMarkers.replaceChildren();
    if (!pointMatchActive || pointMatchState?.previewReady === false || !pointMatchState?.previewMesh) return;
    const anchors = pointMatchState.anchors || [];
    const measured = measureProjectionLandmarks({ preparedMesh: pointMatchState.previewMesh, anchors });
    const rect = controls.warpSurface.getBoundingClientRect?.() || { width: 1920, height: 1080 };
    const viewBox = effectiveWarpViewBox || warpViewBox;
    const screenRadius = { small: 3, medium: 5, large: 8 }[pointMatchState.displayPrefs?.previewMarkerSize] ?? 5;
    const toReference = size => warpMarkerRadius(viewBox, rect.width, rect.height, size);
    const radius = toReference(screenRadius), arm = radius * 2, gap = toReference(1.5);
    for (const [index, anchor] of anchors.entries()) {
      const [x, y] = measured[index].renderedPx;
      const circle = svgNode(doc, 'circle', { class: 'point-match-source', cx: String(x), cy: String(y), r: String(radius) });
      const [tx, ty] = anchor.targetPx;
      const target = svgNode(doc, 'g', { class: 'point-match-target', transform: `translate(${tx} ${ty})` });
      target.append(svgNode(doc, 'path', { d: `M${-arm} 0H${-gap}M${gap} 0H${arm}M0 ${-arm}V${-gap}M0 ${gap}V${arm}` }), svgNode(doc, 'circle', { r: String(radius) }));
      const label = svgNode(doc, 'text', { x: String(arm + toReference(3)), y: String(-arm - toReference(3)), 'font-size': String(toReference(12)), 'stroke-width': String(toReference(1)) });
      label.textContent = String(anchor.id);
      target.append(label);
      pointMatchMarkers.append(circle, target);
    }
    controls.warpSurface.appendChild(pointMatchMarkers);
  }
  function updatePointMatch(next) {
    const wasActive=pointMatchActive;pointMatchState=next;pointMatchActive=Boolean(next && !['closed','invalid'].includes(next.phase));
    if (wasActive!==pointMatchActive) cancelActiveDrag({reason:'match-mode'});
    pointMatchControls.update(next);
    controls.warpSurface.dataset.pointMatchActive=String(pointMatchActive);
    syncOrdinaryMatchVisibility();
    pointMatchStart.disabled=pointMatchActive;
    pointMatchStart.hidden=pointMatchActive || currentWarpMode!=='keystone';
    dialog.updatePointMatch({active:pointMatchActive,canApply:next?.canApply===true});
    updateLiveGuard();
    paintPointMatchMarkers();
  }
  let pointerInput;
  function cancelActiveDrag(options) {
    if (options?.notify === false) cancelPendingWarpPaint();
    pointerInput?.cancel(options);
    controls.gridLayout?.cancel();
    if (options?.notify === false) warpPanelView.retireGestures();
    else warpPanelView.cancelGestures();
  }
  const warpOutput = () => selectedGraphNode.startsWith("right-") ? "right" : "left";
  const finishCoordinates = () => [...controls.warpCoordinateFields.values()].filter(control => control.isPending()).every(control => ['commit', 'unchanged'].includes(control.finish().kind));
  const onKeyDown = (event) => {
    if (!dialog.isOpen() || !(selectedGraphNode.endsWith("-keystone") || selectedGraphNode.endsWith("-grid"))) return;
    if (event.target !== controls.warpSurface && !controls.warpSurface.contains?.(event.target)) return;
    if (event.key === "Escape" && pointerInput?.isActive()) { event.preventDefault?.(); pointerInput.cancel({ reason: "escape" }); return; }
    const tag = String(event.target?.tagName || "").toLowerCase();
    if (["input", "textarea", "select", "button"].includes(tag) || event.target?.isContentEditable || event.target?.closest?.("[contenteditable]")) return;
    const direction = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" }[event.key];
    if (!direction) return;
    event.preventDefault?.();
    if (pointMatchActive) { onPointMatchAction('nudge',direction);return; }
    if (event.altKey) {
      onWarpAction("warp-nudge", { direction, coarse: Boolean(event.shiftKey), fine: !event.shiftKey });
      return;
    }
    const mode = selectedGraphNode.endsWith("-grid") ? "grid" : "keystone";
    const selection = currentSelection || { mode, kind: mode === "grid" ? "point" : "corner", index: 0 };
    if (selection.kind === "all") return;
    const gridColumns = currentWarpGrid?.columns || (warpOutput() === "right" ? 8 : 7);
    const step = selection.kind === "edge"
      ? direction === "left" || direction === "up" ? -1 : 1
      : mode === "keystone"
      ? direction === "left" ? -1 : direction === "right" ? 1 : direction === "up" ? -2 : 2
      : selection.kind === "row" ? direction === "up" || direction === "left" ? -1 : 1
        : selection.kind === "column" ? direction === "left" || direction === "up" ? -1 : 1
          : direction === "left" ? -1 : direction === "right" ? 1 : direction === "up" ? -gridColumns : gridColumns;
    const count = selection.kind === "row" ? currentWarpGrid?.rows || 7
      : selection.kind === "column" ? currentWarpGrid?.columns || 7
        : selection.kind === "edge" ? 4
          : mode === "grid" ? (currentWarpGrid?.rows || 7) * gridColumns : 4;
    const index = ((Number(selection.index || 0) + step) % count + count) % count;
    onWarpAction("warp-select", { output: warpOutput(), selection: { mode, kind: selection.kind, index } });
  };
  doc.addEventListener?.("keydown", onKeyDown);
  const settlementControls = createSettlementNameControls(doc, {
    onOutput: onSettlementOutput,
    onCitycode: onSettlementCitycode,
    onPosition: onSettlementPosition,
    onStyle: onSettlementStyle,
    onLineBreak: onSettlementLineBreak,
    onLeaderStyle: onSettlementLeaderStyle,
    onResetOrigin: onSettlementResetOrigin,
    onRetry: () => onSettlementRecovery("retry"),
    onLoad: () => onSettlementRecovery("load"),
    onRetryCatalog: onRetrySettlementCatalog,
  });
  nodeMap.get("settlement-names")?.appendChild(settlementControls.element);
  const optionalHealthPanel = make(doc, "section", { className: "projection-optional-health", ariaLabel: "Optional tool status and recovery", hidden: true });
  const optionalHealthHeading = make(doc, "h3", {}, "Optional tools");
  const optionalHealthActionError = make(doc, "p", { className: "projection-optional-health-action-error", role: "alert", hidden: true });
  const optionalHealthList = make(doc, "div", { className: "projection-optional-health-list" });
  const optionalHealthRows = new Map();
  for (const [id, label, action] of [
    ["clock-settings", "Clock and legend settings", () => onClockRecovery("retry", "clock-gis")],
    ["settlement-settings", "Settlement settings", () => onSettlementRecovery("retry")],
    ["settlement-catalog", "Settlement list", onRetrySettlementCatalog],
  ]) {
    const row = make(doc, "div", { className: "projection-optional-health-row", dataset: { module: id } });
    const message = make(doc, "p", { className: "projection-optional-health-message", role: "status" });
    const retry = button(doc, `Retry ${label.toLowerCase()}`, `retry-${id}`);
    retry.addEventListener("click", (event) => { event.stopPropagation?.(); action(); });
    row.append(message, retry); optionalHealthList.appendChild(row); optionalHealthRows.set(id, { row, message, retry, label });
  }
  optionalHealthPanel.append(optionalHealthHeading, optionalHealthActionError, optionalHealthList);
  editorRegion.appendChild(optionalHealthPanel);
  controls.editorHome = make(doc, "div", { className: "editor-home", hidden: true });
  controls.editorHome.appendChild(controls.warpPanel);

  app.appendChild(controls.editorHome);
  app.appendChild(workspace);
  root.appendChild(app);
  const dialog = createWarpEditorDialog({ document: doc, host: editorRegion, editorPanel: controls.warpPanel, overlay: controls.warpSurface, topologyControls: controls.gridLayout.element, navigationControls, optionalHealthElement: optionalHealthPanel, presentation: "panel", trace, socket,
    onPreviewInvalidated:onWarpPreviewInvalidated,onPreviewStateChange:onWarpPreviewStateChange,
    onVisibilityChange: (visible) => { workspace.dataset.editing = String(visible); if (!visible) editorRegion.appendChild(optionalHealthPanel); onWarpEditorVisibility(visible); },
    onPresentationChange: (focused) => {
      root.dataset.warpFullViewport = String(focused);
      commandBar.element.inert = Boolean(focused);
      graphColumn.inert = Boolean(focused);
    },
    onIsAdjusting: () => activeWarpAdjusting,
    onEscape: () => {
      if (pointMatchActive && pointerInput?.isActive()) { cancelActiveDrag({reason:'escape'});return true; }
      if (activeWarpAdjusting) { cancelActiveDrag({ reason: "escape" }); return true; }
      if (currentGridPlacement) { onWarpAction("warp-grid-placement", { axis: null }); return true; }
      const pending = [...controls.warpCoordinateFields.values()].filter((control) => control.isPending());
      if (!pending.length) return false;
      for (const control of pending) control.cancel({ clearControllerError: true });
      return true;
    },
    onBeforeClose: () => { if (activeWarpAdjusting || !finishCoordinates() || !controls.gridLayout.finishPendingEdit() || onBeforeWarpClose()===false) return false; cancelActiveDrag({ reason: 'close' }); },
    onBeforeSwitch: () => { if (activeWarpAdjusting || !finishCoordinates() || !controls.gridLayout.finishPendingEdit() || onBeforeWarpSwitch()===false) return false; cancelActiveDrag({ reason: 'switch' }); },
    onBeforeResize: () => cancelActiveDrag({ reason: 'resize' }),
    onViewportChange: updateWarpMarkerRadii,
    onOrientationChange: () => { cancelActiveDrag({ reason: 'orientationchange' });onWarpPreviewInvalidated('Orientation changed; restart Match points.'); },
    reconciliationControls: controls.reconciliation,
    onApply: () => onAction("apply"), onLive: (live) => onAction("live", live) });
  parameterDialog = createParameterEditorDialog({ document: doc, host: editorRegion, presentation: "panel", onField, onCancelField: onFieldCancel, onNudge, onAction,
    resolveFieldPath: (descriptor, config) => {
      const path = descriptor.path;
      if (!path.startsWith("namesWall.")) return null;
      const field = path.slice("namesWall.".length);
      if (field === "rotateDeg" || field.startsWith("innerEdgeInsetPx.")) return path;
      const profile = descriptor.wallOnly || field === "inwardShiftPercent" ? "wall" : config.namesWall?.activeMode || "wall";
      return `namesWall.profiles.${profile}.${field}`;
    },
    isFieldVisible: (descriptor, config) => !descriptor.wallOnly || config.namesWall?.activeMode === "wall",
    pendingTargetLabel: (descriptor) => descriptor.wallOnly
      ? "Pending edit still targets the Regular wall profile. Cancel this field before returning to nodes."
      : "",
    contextForConfig: (nodeId, config) => nodeId === "names-wall"
      ? `${config.namesWall?.activeMode === "model" ? "Model-oriented" : "Regular wall"} profile`
      : "",
    onVisibilityChange: (visible) => {
      workspace.dataset.editing = String(visible);
      if (visible) parameterDialog.bodyElement?.prepend(optionalHealthPanel);
      else editorRegion.appendChild(optionalHealthPanel);
      const showNamesTools = visible && activeParameterNode === "names-wall";
      namesEditorTools.hidden = !showNamesTools; namesEditorNotes.hidden = !showNamesTools;
    },
    createPreview: (previewHost, onStatus) => createParameterEditorPreviews({ document: doc, host: previewHost, onStatus }) });
  pointerInput = bindWarpPointerInput({
    trace,
    surface: controls.warpSurface,
    readGeometry: () => dialog.isOpen() ? { rect: controls.warpSurface.getBoundingClientRect?.() || { left: 0, top: 0, width: 1920, height: 1080 }, viewBox: effectiveWarpViewBox || warpViewBox, baseViewBox: warpViewBox, panMode: warpInteractionMode === "move", editable: currentWarpEnabled && !pointMatchActive, handles: currentHandles, evaluatedMesh: currentEvaluatedMesh, selection: currentSelection, placementAxis: pointMatchActive ? null : currentGridPlacement?.axis, rows: currentWarpGrid?.rows || 7, columns: currentWarpGrid?.columns || (selectedGraphNode.startsWith("right-") ? 8 : 7), mode: pointMatchActive ? 'match' : selectedGraphNode.endsWith("-grid") ? "grid" : "keystone", side: selectedGraphNode.startsWith("right-") ? "right" : "left",
      match:pointMatchActive ? {start:p=>onPointMatchAction('preview-start',[p.x,p.y]),move:p=>onPointMatchAction('preview-move',[p.x,p.y]),end:p=>onPointMatchAction('preview-move',[p.x,p.y]),cancel:()=>onPointMatchAction('cancel-motion')} : null } : null,
    onNavigate: ({ viewBox }) => applyViewBox(viewBox),
    onSelect: ({ output, selection }) => finishCoordinates() && onWarpAction("warp-select", { output, selection }),
    onStart: (point) => finishCoordinates() && onWarpPointer("start", point),
    onMove: (point) => onWarpPointer("move", point),
    onEnd: (point) => onWarpPointer("end", point),
    onCancel: (point) => onWarpPointer("cancel", point),
    onInsert: ({ output, axis, position }) => finishCoordinates() && onWarpAction("warp-grid-layout", { output, operation: "add", axis, position }),
    onInsertFailure: ({ output, axis, reason }) => onWarpAction("warp-grid-placement-error", { output, axis, reason }),
  });
  const disposeWarpTrace = bindProjectionTraceInput({ surface: controls.warpSurface, surfaceName: 'warp', trace, readGeometry: () => ({ viewBox: effectiveWarpViewBox || warpViewBox, selection: currentSelection, mode: selectedGraphNode.endsWith('-grid') ? 'grid' : 'keystone', side: selectedGraphNode.startsWith('right-') ? 'right' : 'left' }) });
  const disposeGraphTrace = bindProjectionTraceInput({ surface: graphViewport, surfaceName: 'graph', trace });
  const canvas = createNodeCanvas({ document: doc, viewport: graphViewport, graph, svg, wire: wirePath, nodeMap, controls: { zoomIn, zoomOut, zoomReset, zoomOne }, trace });
  canvas.mount();

  const setNode = (node) => {
    const selected = node || "pre";
    const previous = selectedGraphNode;
    if (dialog.isOpen() && previous !== selected) {
      const warpNode = selected.endsWith('-keystone') || selected.endsWith('-grid');
      if (warpNode) {
        if (dialog.open({ side: selected.startsWith('right-') ? 'right' : 'left', mode: selected.endsWith('-grid') ? 'grid' : 'keystone' }) === false) return false;
      } else if (dialog.close() === false) return false;
    }
    selectedGraphNode = selected;
    workspace.dataset.selectedNode = selected;
    editorNodeHeading.textContent = graphNodes.find(([id]) => id === selected)?.[1] || "Selected node";
    const editable = (parameterEditorNodes.has(selected) && descriptors.some((item) => item.node === selected)) || selected.endsWith("-keystone") || selected.endsWith("-grid") || ["clock-gis", "clock-projection", "nova-explainers", "settlement-names"].includes(selected);
    enlargeEdit.disabled = !editable;
    editorEmptyState.hidden = editable || selected === "content";
    if (parameterDialog?.isOpen() && parameterDialog.element.dataset.node !== selected) parameterDialog.close();
    canvas.setSelected(selected);
    for (const [id, card] of nodeMap) card.classList?.toggle("selected", id === selected);
  };
  const warpSurfaceTopologyKeyFor = ({ output, mode, rows, columns, warp, warpState, handles }) => {
    const grid = warp?.grid;
    const candidate = warpState.gridLayoutPreview || warpState.gridPlacement?.preview;
    const candidateGrid = candidate?.grid;
    const candidateVisible = mode === "grid" && candidate?.ok && candidateGrid && candidate?.handles?.length === candidateGrid.rows * candidateGrid.columns;
    return JSON.stringify([output, mode, WARP_OUTPUT_WIDTH, WARP_OUTPUT_HEIGHT, rows, columns,
      grid?.columnPositions || null, grid?.rowPositions || null, warp?.baseline || null, handles.length,
      candidateVisible ? [candidateGrid.rows, candidateGrid.columns] : null]);
  };
  const warpTopologyForUpdate = (warpStates, node) => {
    if (!node.endsWith("-keystone") && !node.endsWith("-grid")) return null;
    const output = node.startsWith("right-") ? "right" : "left";
    const warpState = warpStates?.[output];
    if (!warpState) return null;
    const mode = node.endsWith("-grid") ? "grid" : "keystone";
    const warp = warpState.config?.outputs?.[output]?.warp;
    return warpSurfaceTopologyKeyFor({ output, mode, rows: warp?.grid?.rows || 7,
      columns: warp?.grid?.columns || (output === "right" ? 8 : 7), warp, warpState,
      handles: Array.isArray(warpState.handles) ? warpState.handles : [] });
  };
  const paintWarpSurface = ({ output, mode, rows, columns, warp, warpState, handles, selectionKind, selectedIndex, selectedIndices, displayViewBox }) => {
    const grid = warp?.grid;
    const candidate = warpState.gridLayoutPreview || warpState.gridPlacement?.preview;
    const candidateGrid = candidate?.grid;
    const candidateHandles = candidate?.handles;
    const candidateVisible = mode === "grid" && candidate?.ok && candidateGrid && candidateHandles?.length === candidateGrid.rows * candidateGrid.columns;
    const topologyKey = warpSurfaceTopologyKeyFor({ output, mode, rows, columns, warp, warpState, handles });
    const focusedHandleIndex = doc.activeElement?.classList?.contains?.("warp-handle") ? Number(doc.activeElement.getAttribute("data-index")) : null;
    if (!warpSurfaceRenderState || warpSurfaceRenderState.topologyKey !== topologyKey) {
      const rect = svgNode(doc, "rect", { class: "warp-output-rect", x: "0", y: "0", width: String(WARP_OUTPUT_WIDTH), height: String(WARP_OUTPUT_HEIGHT) });
      const mainPathCount = mode === "grid" && handles.length >= rows * columns ? rows + columns : handles.length >= 4 ? 1 : 0;
      const mainPaths = Array.from({ length: mainPathCount }, () => svgNode(doc, "path", { class: "warp-grid-line" }));
      const previewPathCount = candidateVisible ? candidateGrid.rows + candidateGrid.columns : 0;
      const previewPaths = Array.from({ length: previewPathCount }, () => svgNode(doc, "path", { class: "warp-grid-preview-line" }));
      const markers = handles.map((_point, index) => {
        const label = mode === "keystone" ? ["top-left corner", "top-right corner", "bottom-left corner", "bottom-right corner"][index] || `corner ${index + 1}` : `point ${index + 1}, row ${Math.floor(index / columns) + 1}, column ${index % columns + 1}`;
        const marker = svgNode(doc, "circle", { cx: "0", cy: "0", r: "5", class: "warp-handle", "data-index": String(index), tabindex: "-1", role: "button", "aria-label": `Select ${label}` });
        marker.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault?.();
          if (pointerInput?.isActive() || !finishCoordinates()) return;
          cancelActiveDrag({ reason: "selection" });
          const selection = currentWarpMode === "keystone" ? { mode: currentWarpMode, kind: "corner", index } : gridSelectionForHandle(currentWarpState?.selection, index, currentWarpGrid?.columns || 7);
          onWarpAction("warp-select", { output: currentWarpOutput, selection });
        });
        return marker;
      });
      controls.warpSurface.replaceChildren(rect, ...mainPaths, ...previewPaths, ...markers);
      warpSurfaceRenderState = { topologyKey, rect, mainPaths, previewPaths, markers };
      if (focusedHandleIndex !== null) warpSurfaceRenderState.markers[focusedHandleIndex]?.focus?.();
    }
    const render = warpSurfaceRenderState;
    const pathFor = (points) => points.map((point, index) => `${index ? "L" : "M"}${point.x * WARP_OUTPUT_WIDTH} ${point.y * WARP_OUTPUT_HEIGHT}`).join(" ");
    if (mode === "grid" && handles.length >= rows * columns) {
      const geometryChanged = render.handles !== handles;
      for (let row = 0; row < rows; row += 1) {
        render.mainPaths[row].setAttribute("class", `warp-grid-line${selectionKind === "row" && selectedIndex === row ? " selected" : ""}`);
        if (geometryChanged) render.mainPaths[row].setAttribute("d", pathFor(handles.slice(row * columns, (row + 1) * columns)));
      }
      for (let column = 0; column < columns; column += 1) {
        const path = render.mainPaths[rows + column];
        path.setAttribute("class", `warp-grid-line${selectionKind === "column" && selectedIndex === column ? " selected" : ""}`);
        if (geometryChanged) path.setAttribute("d", pathFor(Array.from({ length: rows }, (_, row) => handles[row * columns + column])));
      }
    } else if (handles.length >= 4 && render.mainPaths[0]) {
      render.mainPaths[0].setAttribute("class", "warp-grid-line");
      if (render.handles !== handles) render.mainPaths[0].setAttribute("d", `${pathFor([handles[0], handles[1], handles[3], handles[2]])} Z`);
    }
    if (candidateVisible) {
      const candidateChanged = render.candidateHandles !== candidateHandles;
      for (let row = 0; row < candidateGrid.rows; row += 1) {
        const selected = candidate.operation === "add" && candidate.values?.axis === "row" && candidate.selection?.index === row;
        render.previewPaths[row].setAttribute("class", `warp-grid-preview-line${selected ? " candidate" : ""}`);
        if (candidateChanged) render.previewPaths[row].setAttribute("d", pathFor(candidateHandles.slice(row * candidateGrid.columns, (row + 1) * candidateGrid.columns)));
      }
      for (let column = 0; column < candidateGrid.columns; column += 1) {
        const selected = candidate.operation === "add" && candidate.values?.axis === "column" && candidate.selection?.index === column;
        const path = render.previewPaths[candidateGrid.rows + column];
        path.setAttribute("class", `warp-grid-preview-line${selected ? " candidate" : ""}`);
        if (candidateChanged) path.setAttribute("d", pathFor(Array.from({ length: candidateGrid.rows }, (_, row) => candidateHandles[row * candidateGrid.columns + column])));
      }
    }
    const geometryChanged = render.handles !== handles;
    handles.forEach((point, index) => {
      const selected = selectedIndices.has(index);
      const marker = render.markers[index];
      if (geometryChanged) { marker.setAttribute("cx", String(point.x * WARP_OUTPUT_WIDTH)); marker.setAttribute("cy", String(point.y * WARP_OUTPUT_HEIGHT)); }
      marker.setAttribute("r", selected ? "8" : "5"); marker.setAttribute("class", `warp-handle${selected ? " selected" : ""}`);
    });
    render.handles = handles;
    render.candidateHandles = candidateHandles;
    const viewBoxKey = warpViewBoxValue(displayViewBox);
    if (render.viewBoxKey !== viewBoxKey) { controls.warpSurface.setAttribute("viewBox", viewBoxKey); render.viewBoxKey = viewBoxKey; }
  };
  const renderWarpPanel = (warpStates, node) => {
    pointMatchStart.hidden=pointMatchActive || !node.endsWith('-keystone');
    const output = node.startsWith("right-") ? "right" : "left";
    const isWarpNode = node.endsWith("-keystone") || node.endsWith("-grid");
    const warpState = warpStates?.[output];
    controls.warpPanel.hidden = !isWarpNode || !warpState;
    if (!warpState || !isWarpNode) return;
    warpPanelView.update({ output, nodeId: node, editorState: warpState });
    const traceStarted = projectionTraceTime(trace);
    recordProjectionTrace(trace, 'redraw', { surface: 'warp', phase: 'start', output, dragging: Boolean(warpState.dragging) });
    const adjusting = Boolean(warpState.adjusting ?? warpState.dragging);
    activeWarpAdjusting = adjusting;
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
    currentWarpEnabled = warp?.enabled !== false;
    const correctionEnabled = currentWarpEnabled;
    controls.warpEnableAction.hidden = correctionEnabled;
    controls.warpEnableAction.disabled = adjusting;
    const columns = warp?.grid?.columns || (output === "right" ? 8 : 7);
    const rows = warp?.grid?.rows || 7;
    currentWarpGrid = warp?.grid || null;
    currentHandles = allHandles;
    currentEvaluatedMesh = warpState.evaluatedMesh || null;
    currentGridPlacement = warpState.gridPlacement || null;
    currentSelection = warpState.selection;
    const selectionKind = warpState.selection?.kind || (mode === "grid" ? "point" : "corner");
    const selectedIndex = Number(warpState.selection?.index ?? 0);
    const selectedIndices = new Set(warpState.selection?.indices || []);
    const chosen = [...selectedIndices].map((index) => allHandles[index]).filter(Boolean);
    const baselineStatus = warpState.baselineAvailable === false ? " · TD baseline unavailable; reload after repairing the asset" : "";
    const validationStatus = adjusting ? " · Finish or cancel the active adjustment first." : warpState.validationMessage ? ` · ${warpState.validationMessage}` : "";
    const selectedName = selectionKind === "all" ? mode === "grid" ? `All grid points · ${selectedIndices.size} points` : "All four corners"
      : selectionKind === "edge" ? `${["Top edge", "Right edge", "Bottom edge", "Left edge"][Math.max(0, Math.min(3, selectedIndex))]} · ${selectedIndices.size} points`
      : mode === "keystone"
      ? ["Top-left corner", "Top-right corner", "Bottom-left corner", "Bottom-right corner"][selectedIndex] || `Corner ${selectedIndex + 1}`
      : selectionKind === "row" ? `Row ${selectedIndex + 1} · ${selectedIndices.size} points`
        : selectionKind === "column" ? `Column ${selectedIndex + 1} · ${selectedIndices.size} points`
          : `Point ${selectedIndex + 1} · Row ${Math.floor(selectedIndex / columns) + 1}, Column ${selectedIndex % columns + 1}`;
    controls.warpStatus.textContent = `${selectedName} · ${warpState.stepMode === "coarse" ? "1 px" : "0.25 px"}${correctionEnabled ? "" : " · Correction bypassed; geometry editing disabled."}${baselineStatus}${validationStatus}`;
    for (const input of controls.gridLayout.fields.values()) input.disabled = adjusting || !correctionEnabled;
    controls.gridLayout.update({ grid: warp?.grid, selection: warpState.selection, placement: currentGridPlacement, errorMessage: warpState.validationMessage || "", visible: mode === "grid" });
    for (const input of [...controls.gridLayout.fields.values(), ...controls.gridLayout.actions.values()]) input.disabled ||= adjusting || !correctionEnabled;
    controls.warpSelectionControls.hidden = false;
    for (const control of controls.warpSelectionButtons) control.setAttribute("aria-pressed", String(control.dataset.warpSelectionKind === selectionKind));
    controls.warpPositionLabels[0].textContent = selectionKind === "point" || mode === "keystone" ? "X px" : "Mean X px";
    controls.warpPositionLabels[1].textContent = selectionKind === "point" || mode === "keystone" ? "Y px" : "Mean Y px";
    controls.warpReset.textContent = selectionKind === "all" ? "Reset all" : selectionKind === "edge" ? "Reset edge" : mode === "grid" ? `Reset ${selectionKind}` : "Reset corner";
    for (const [axis, control] of controls.warpCoordinateFields) {
      control.number.disabled = adjusting || !correctionEnabled;
      control.wrap.querySelectorAll?.('button').forEach(button => { if (button.dataset.action === 'numeric-sign') button.disabled = adjusting || !correctionEnabled; });
    }
    for (const item of [controls.warpEnabled, controls.warpStep, controls.warpReset, controls.warpResetAll, ...controls.warpArrows.children]) item.disabled = adjusting || !correctionEnabled;
    controls.warpStartFresh.disabled = adjusting;
    for (const item of [controls.warpSelectionPicker, ...controls.warpSelectionButtons]) item.disabled = adjusting;
    controls.warpSurface.setAttribute("data-correction-bypassed", String(!correctionEnabled));
    controls.warpUndo.disabled ||= adjusting || !correctionEnabled;
    controls.warpRedo.disabled ||= adjusting || (!correctionEnabled && !warpState.canRedo);
    const nextFit = warpViewport(allHandles);
    warpViewBox = nextFit;
    if (!effectiveWarpViewBox || targetChanged) { setWarpInteractionMode("edit"); effectiveWarpViewBox = nextFit; }
    const displayViewBox = pointerInput.activeViewBox() || effectiveWarpViewBox;
    paintWarpSurface({ output, mode, rows, columns, warp, warpState, handles: allHandles, selectionKind, selectedIndex, selectedIndices, displayViewBox });
    dialog.setViewBox(displayViewBox);
    updateWarpMarkerRadii();
    syncOrdinaryMatchVisibility();
    if (trace?.enabled) {
      const rect = latestWarpRect || { left: 0, top: 0, width: 0, height: 0 };
      recordProjectionTrace(trace, 'redraw', { surface: 'warp', phase: 'end', output, mode, columns, rows, baselineType: warp?.baseline?.type || 'unknown', durationMs: projectionTraceTime(trace) - traceStarted, rectX: rect.left ?? 0, rectY: rect.top ?? 0, rectWidth: rect.width, rectHeight: rect.height, viewX: displayViewBox.x, viewY: displayViewBox.y, viewWidth: displayViewBox.width, viewHeight: displayViewBox.height });
    }
  };
  const syncWarpInteractionState = (warpStates, node) => {
    const output = node.startsWith("right-") ? "right" : "left";
    const isWarpNode = node.endsWith("-keystone") || node.endsWith("-grid");
    const warpState = isWarpNode ? warpStates?.[output] : null;
    currentWarpOutput = output;
    currentWarpMode = node.endsWith("-grid") ? "grid" : "keystone";
    currentWarpState = warpState;
    warpPanelView.setState({ output, nodeId: node, editorState: warpState });
    activeWarpAdjusting = Boolean(warpState?.adjusting ?? warpState?.dragging);
    const syncAvailability = () => {
      warpPanelView.setAdjusting(activeWarpAdjusting);
      controls.warpEnabled.disabled = activeWarpAdjusting || !currentWarpEnabled;
      controls.warpEnableAction.hidden = currentWarpEnabled;
      controls.warpEnableAction.disabled = activeWarpAdjusting;
      if (activeWarpAdjusting || !currentWarpEnabled) {
        for (const input of [...controls.gridLayout.fields.values(), ...controls.gridLayout.actions.values()]) input.disabled = true;
      }
      dialog.updateAdjustmentGuard();
    };
    if (!warpState) {
      currentHandles = [];
      currentSelection = null;
      currentWarpGrid = null;
      currentEvaluatedMesh = null;
      currentGridPlacement = null;
      currentWarpEnabled = false;
      syncAvailability();
      return;
    }
    const warp = warpState.config?.outputs?.[output]?.warp;
    currentWarpGrid = warp?.grid || null;
    currentHandles = Array.isArray(warpState.handles) ? warpState.handles : [];
    currentEvaluatedMesh = warpState.evaluatedMesh || null;
    currentGridPlacement = warpState.gridPlacement || null;
    currentSelection = warpState.selection;
    currentWarpEnabled = warp?.enabled !== false;
    syncAvailability();
  };
  const paintLatestWarpUpdate = () => {
    pendingWarpFrame = null;
    const latest = latestWarpPaint;
    latestWarpPaint = null;
    if (disposed || !latest) return;
    renderWarpPanel(latest.warpStates, latest.node);
    updateWarpNodePreviews(latest.warpStates);
  };
  function flushPendingWarpPaint() {
    const latest = latestWarpPaint;
    if (!latest) return;
    cancelPendingWarpPaint();
    latestWarpPaint = latest;
    paintLatestWarpUpdate();
  }
  const scheduleWarpUpdate = (warpStates, node) => {
    syncWarpInteractionState(warpStates, node);
    const latest = { warpStates, node };
    const topologyKey = warpTopologyForUpdate(warpStates, node);
    if (topologyKey !== (warpSurfaceRenderState?.topologyKey ?? null)) {
      cancelPendingWarpPaint();
      latestWarpPaint = latest;
      paintLatestWarpUpdate();
      return;
    }
    latestWarpPaint = latest;
    if (!requestFrame) { paintLatestWarpUpdate(); return; }
    if (pendingWarpFrame !== null) return;
    const generation = ++warpPaintGeneration;
    pendingWarpFrame = requestFrame(() => {
      if (generation !== warpPaintGeneration) return;
      paintLatestWarpUpdate();
    });
  };
  const renderOptionalHealth = (clockState = { status: "Loading" }, settlementState = null, actionError = "") => {
    const modules = [
      ["clock-settings", clockState, "Clock and legend settings"],
      ["settlement-settings", settlementState?.hydration || { status: "Saved" }, "Settlement settings"],
      ["settlement-catalog", settlementState?.catalogStatus || { status: "ready" }, "Settlement list"],
    ];
    let active = false;
    for (const [id, module, label] of modules) {
      const row = optionalHealthRows.get(id);
      const status = String(module?.status || "ready").toLowerCase();
      const failed = status === "failed" || status === "error";
      const loading = status === "loading";
      row.row.hidden = !failed && !loading;
      row.message.textContent = failed
        ? `${label} unavailable${module?.error ? `: ${module.error}` : ""}`
        : loading ? `Loading ${label.toLowerCase()}…` : "";
      row.retry.hidden = !failed;
      active ||= failed || loading;
    }
    optionalHealthActionError.textContent = String(actionError || "");
    optionalHealthActionError.hidden = !actionError;
    optionalHealthPanel.hidden = !active && !actionError;
  };
  const update = ({ state = {}, parameterHistory = { undo: 0, redo: 0 }, errors = {}, conflict = "", statusText = "", draftDiffersFromAccepted = false, savePending = false, selectedNode = "pre", loadedPresetId = null, loadedPresetLoadToken = 0, statusRows = [], appliedSummary = 'Pending', outputState = {}, warpStates = {}, activePattern = { pattern: "off" }, namesWallStatus = null, namesRunDisabledReason = "", clockScene = "home", clockElement = "clock", clockLayouts = {}, clockHydration = { status: "Loading" }, settlement = null } = {}) => {
    if (state.draft) currentDraft = state.draft;
    currentFieldErrors = errors.fields || errors.field || errors;
    currentStatus = statusText;
    commandBar.update({ state, parameterHistory, errors, conflict, statusText, draftDiffersFromAccepted, savePending, loadedPresetId, loadedPresetLoadToken, statusRows, appliedSummary, outputState });
    reconciliationActive = Boolean(state.reconciliation);
    updateLiveGuard();
    const draft = state.draft || DEFAULT_PROJECTION_CONFIG;
    setNode(selectedNode);
    controls.gisClockScene.value = clockScene;
    controls.projectionElement.value = clockElement;
    for (const [id, status] of clockNodeStatuses) status.render(clockLayouts[id]?.record, clockHydration);
    settlementControls.render(settlement || { hydration: { status: "Loading" }, enabled: false });
    renderOptionalHealth(clockHydration, settlement, workspace.dataset.editing === "true" ? errors.action : "");
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
    scheduleWarpUpdate(warpStates, selectedNode);
    dialog.update(draft, { live: state.live, appliedSummary, namesRunStatus: wallMessage, namesRunDisabledReason,
      reconciliation: state.reconciliation });
    parameterDialog.update({ config: draft, fieldErrors: errors.fields || errors.field || errors, status: controls.status.textContent, parameterHistory });
    for (const [output, control] of patternControls) control.value = activePattern.branch === output ? activePattern.pattern : "off";
    for (const descriptor of descriptors) {
      const value = namesWallProfileScoped(descriptor.path)
        ? draft.namesWall?.profiles?.[descriptor.wallOnly ? "wall" : draft.namesWall?.activeMode]?.[descriptor.path.slice("namesWall.".length)]
        : readPath(draft, descriptor.path);
      const control = fields.get(`${descriptor.node}:${descriptor.path}`);
      if (!control) continue;
      const hiddenByProfile = Boolean(descriptor.wallOnly && draft.namesWall?.activeMode !== "wall");
      const retainPending = hiddenByProfile && control.isPending();
      control.wrap.hidden = hiddenByProfile && !retainPending;
      const pendingTargetNote = inlinePendingTargetNotes.get(`${descriptor.node}:${descriptor.path}`);
      if (pendingTargetNote) pendingTargetNote.hidden = !retainPending;
      const errorPath = namesWallProfileScoped(descriptor.path) && draft.namesWall?.activeMode
        ? `namesWall.profiles.${descriptor.wallOnly ? "wall" : draft.namesWall.activeMode}.${descriptor.path.slice("namesWall.".length)}`
        : descriptor.path;
      const fieldError = errors[errorPath] || Object.entries(errors).find(([key]) => errorPath.startsWith(`${key}.`))?.[1] || "";
      control.update({value, resolvedPath: errorPath, error: presentationError(errorPath, fieldError)});
    }
    const selectedDescriptors = descriptors.filter((descriptor) => descriptor.node === selectedNode && !fields.get(`${descriptor.node}:${descriptor.path}`)?.wrap.hidden);
    selectedContext.replaceChildren();
    selectedContext.setAttribute("aria-label", `Current parameters for ${editorNodeHeading.textContent}`);
    if (selectedNode === "content") selectedContext.appendChild(borderEditorVisibility.element);
    else if (selectedDescriptors.length) {
      const list = make(doc, "dl", { className: "config-selected-parameters" });
      for (const descriptor of selectedDescriptors) {
        const value = namesWallProfileScoped(descriptor.path)
          ? draft.namesWall?.profiles?.[descriptor.wallOnly ? "wall" : draft.namesWall?.activeMode]?.[descriptor.path.slice("namesWall.".length)]
          : readPath(draft, descriptor.path);
        const term = make(doc, "dt", {}, descriptor.label);
        const shown = displayValue(descriptor, value);
        const definition = make(doc, "dd", {}, `${shown}${descriptor.unit ? ` ${descriptor.unit}` : ""}`);
        list.append(term, definition);
      }
      selectedContext.appendChild(list);
    } else if (selectedNode.endsWith("-keystone") || selectedNode.endsWith("-grid")) {
      const preview = warpNodePreviews.get(selectedNode);
      if (preview) selectedContext.appendChild(make(doc, "p", { className: "config-selected-geometry" }, preview.summary.textContent));
    }
  };
  setNode("pre");
  return {
    update, controls: { ...controls, enlargeEdit, editorRegion, editorNodeHeading }, fields, nodeMap, parameterDialog, setPresetName, canManageDisplays: true,
    updateGazaBorderVisibility(state) { borderVisibility.render(state); borderEditorVisibility.render(state); },
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
    isWarpEditorOpen: () => dialog.isOpen(),
    retireWarpGestures: () => { cancelPendingWarpPaint(); warpPanelView.retireGestures(); },
    finishNumericEdits: () => [...fields.values()].map(control => control.finish()),
    finishPendingEdit: () => {
      const results = [...fields.values(), ...controls.warpCoordinateFields.values()].filter(control => control.isPending()).map(control => control.finish());
      if (parameterDialog.isPending()) results.push(...parameterDialog.finish());
      return results.every(result => result.kind === 'commit' || result.kind === 'unchanged') && controls.gridLayout.finishPendingEdit();
    },
    hasPendingEdit: () => [...fields.values(), ...controls.warpCoordinateFields.values()].some(control => control.isPending()) || parameterDialog.isPending() || controls.gridLayout.hasPendingEdit(),
    hasHeldNumericEdit: () => [...fields.values()].some(control => control.isHeld()) || parameterDialog.isHeld(),
    cancelNumericEdits: options => { for (const control of [...fields.values(), ...controls.warpCoordinateFields.values()]) control.cancel(options); parameterDialog.cancel(options); controls.gridLayout.cancel(); },
    closeWarpEditor: dialog.close,
    sendRunNamesPreview: (config) => dialog.sendRunNamesPreview(config),
    getCalibrationState: () => dialog.getCalibrationState(),
    getPreviewCalibrationState: () => dialog.getPreviewCalibrationState(),
    getWarpPreviewAppliedState: () => dialog.getWarpPreviewAppliedState(),
    updatePointMatch,
    setPointMatchPreview:config=>dialog.setPointMatchPreview(config),
    confirmDiscard:message=>doc.defaultView?.confirm?.(message),
    mapPointMatchPadDelta:delta=>{const rect=controls.warpSurface.getBoundingClientRect?.() || {width:1920,height:1080};const box=effectiveWarpViewBox || warpViewBox;const a=warpPointFromClient({clientX:0,clientY:0},{left:0,top:0,width:rect.width,height:rect.height},box);const b=warpPointFromClient({clientX:delta[0],clientY:delta[1]},{left:0,top:0,width:rect.width,height:rect.height},box);return [b.x-a.x,b.y-a.y];},
    dispose() { if (disposed) return; disposed = true; cancelPendingWarpPaint(); pointMatchControls.dispose(); for (const control of fields.values()) control.dispose(); warpPanelView.dispose(); settlementControls.dispose(); disposePageTrace(); disposeWarpTrace(); disposeGraphTrace(); traceUi?.dispose(); staffRemotePanel?.dispose(); commandBar.dispose(); doc.removeEventListener?.("keydown", onKeyDown); parameterDialog.dispose(); dialog.dispose(); pointerInput.dispose(); canvas.dispose(); },
  };
}

export { displayValue, readPath, descriptorFor, renderField };
