import MapProjectionConfig from "../shared/map-projection-config.js";
import { NLI_GIS_CLOCK_DEFAULT_LAYOUT } from "../projection/nli-explainer-overlay.js";
import { LEGEND_LAYOUT_DEFAULT } from "../projection/legend-layout.js";
import { normalizeEditableLayout } from "./clock-layout-geometry.js";
import { renderField } from './config-field-control.js';

export const GIS_SLOT = Object.freeze({ home: "start", timeline: "start", segev: "segev", nova: "nova", sderot: "sderot", hostages: "hostages", hostages_all: "hostages_all" });
export const GIS_LABEL = Object.freeze({ home: "Home", timeline: "Timeline", segev: "Segev", nova: "Nova", sderot: "Sderot", hostages: "Peri Family", hostages_all: "All Hostages" });

export function resourceFor(nodeId, sceneId = "home", element = "clock") {
  if (nodeId === "nova-explainers") return { surface: "gis", sceneId: "nova", resource: "gisNovaExplainers", slot: "novaExplainers", fallback: { close: {}, wide: {} }, label: "Nova explainers" };
  if (nodeId === "clock-gis") return { surface: "gis", sceneId, resource: "gisClock", slot: GIS_SLOT[sceneId], fallback: NLI_GIS_CLOCK_DEFAULT_LAYOUT, label: GIS_LABEL[sceneId] };
  if (element === "legend") return { surface: "projection", sceneId: "home", element, resource: "projectionLegend", slot: "left", fallback: LEGEND_LAYOUT_DEFAULT, label: "Projection legend" };
  return { surface: "projection", sceneId: "home", element: "clock", resource: "projectionClock", slot: "left", fallback: MapProjectionConfig.NLI_EXPLAINER_LAYOUT.left, label: "Projection clock" };
}

export function layoutFor(layoutClient, selection) {
  const record = layoutClient?.getSlot?.(selection.resource, selection.slot);
  return { layout: structuredClone(record?.draft || record?.acknowledged || selection.fallback), record };
}

function make(doc, tag, props = {}, text = "") {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "ariaLabel") node.setAttribute("aria-label", value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else node[key] = value;
  }
  if (text) node.textContent = text;
  return node;
}

function columnsControl(doc, onField) {
  const label = make(doc, "label", { className: "clock-layout-field" }, "Columns");
  const select = make(doc, "select", { dataset: { field: "columns" }, ariaLabel: "Columns" });
  for (const [value, text] of [[0, "Auto"], [1, "1"], [2, "2"], [3, "3"]]) {
    select.appendChild(make(doc, "option", { value: String(value) }, text));
  }
  label.appendChild(select);
  select.addEventListener("click", (event) => event.stopPropagation?.());
  select.addEventListener("change", () => onField("columns", select.value));
  return { label, select };
}

export function createClockLayoutStatus(doc, { onRetry = () => {}, onLoad = () => {} } = {}) {
  const element = make(doc, "div", { className: "clock-layout-status-actions" });
  const status = make(doc, "p", { className: "clock-layout-status", role: "status", ariaLive: "polite" }, "Loading");
  const retryButton = make(doc, "button", { type: "button", className: "clock-layout-retry" }, "Retry");
  const loadButton = make(doc, "button", { type: "button", className: "clock-layout-load" }, "Load saved");
  retryButton.addEventListener("click", (event) => { event.stopPropagation?.(); onRetry(); });
  loadButton.addEventListener("click", (event) => { event.stopPropagation?.(); onLoad(); });
  element.append(status, retryButton, loadButton);
  return { element, render(record, hydration = { status: "Saved" }) {
    const conflict = record?.status === "Conflict";
    status.textContent = hydration.status === "Failed" ? "Settings unavailable" : hydration.status === "Loading" || !record ? "Loading"
      : conflict ? "Changed on another screen" : record.status === "Failed" ? "Save failed" : record.status === "Saving" ? "Saving" : "Saved";
    retryButton.hidden = hydration.status !== "Failed" && !conflict && record?.status !== "Failed";
    retryButton.disabled = hydration.status === "Loading";
    loadButton.hidden = !conflict;
  } };
}

export function createClockLayoutParameters(doc, { onField = () => {} } = {}) {
  const element = make(doc, "div", { className: "clock-layout-fields" });
  const advanced = make(doc, "details", { className: "clock-layout-advanced" });
  advanced.appendChild(make(doc, "summary", {}, "Advanced"));
  const controls = new Map();
  const sessions = new Map();
  let dwellLabel;
  let fontCaption;
  let fontInput;
  for (const [key, name, min, max, step, unit, extra] of [
    ["leftPct", "X", 0, 100, 0.1, "%"], ["topPct", "Y", 0, 100, 0.1, "%"],
    ["fontPx", "Font size", 8, 64, 1, "px"], ["rotateDeg", "Rotation", -180, 180, 0.1, "deg"],
    ["widthPct", "Width", 2, 100, 0.1, "%", true], ["heightPct", "Height", 2, 100, 0.1, "%", true],
    ["dwellSeconds", "Legend dwell seconds", 4, 30, 1, "s", true],
  ]) {
    const control = renderField(doc, {path:key,label:name,min,max,step,unit,range:false,nudges:false}, (path, raw) => onField(path, raw), () => {});
    const label = control.wrap; label.className += ' clock-layout-field';
    const caption = label.children[0]; const input = control.number;
    sessions.set(key,control);
    (extra ? advanced : element).appendChild(label); controls.set(key, input);
    input.addEventListener("click", (event) => event.stopPropagation?.());
    if (key === "dwellSeconds") dwellLabel = label;
    if (key === "fontPx") fontCaption = caption;
    if (key === "fontPx") fontInput = input;
  }
  const { label: columnsLabel, select: columnsSelect } = columnsControl(doc, onField);
  controls.set("columns", columnsSelect);
  element.appendChild(advanced);
  element.insertBefore(columnsLabel, advanced);
  return { element, controls, advanced,
    finish: () => [...sessions.values()].map(control=>control.finish()),
    cancel: () => { for (const control of sessions.values()) control.cancel(); },
    dispose: () => { for (const control of sessions.values()) control.dispose(); },
    render(layout, { enabled = true, legend = false, identity = 'clock' } = {}) {
    for (const [key, input] of controls) {
      input.disabled = !enabled;
      input.hidden = key === "dwellSeconds" || (key === "columns" && !legend);
      if (key === 'columns') input.value = String(layout?.columns ?? 0);
      else {
        const control = sessions.get(key);
        control.update({ value: layout?.[key], resolvedPath: `${identity}:${key}` });
        control.wrap.hidden = key === 'dwellSeconds';
        for (const node of control.wrap.querySelectorAll?.('button') || []) {
          node.disabled = !enabled || (node.dataset?.action === 'numeric-use-mine' && node.disabled);
        }
      }
    }
    fontCaption.textContent = legend ? "Font size (maximum)" : "Font size";
    fontInput.setAttribute("aria-label", legend ? "Font size (maximum)" : "Font size");
    controls.get("leftPct").max = String(100 - (layout?.widthPct ?? 2));
    controls.get("topPct").max = String(100 - (layout?.heightPct ?? 2));
    dwellLabel.hidden = true;
    columnsLabel.hidden = !legend;
  } };
}

export function layoutFieldEdit(layout, key, raw) {
  if (key === "columns") {
    const value = typeof raw === "number" ? raw : typeof raw === "string" && /^[0-3]$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(value) || value < 0 || value > 3) return null;
    return normalizeEditableLayout({ ...layout, columns: value });
  }
  if (String(raw).trim() === "" || !Number.isFinite(Number(raw))) return null;
  return normalizeEditableLayout({ ...layout, [key]: Number(raw) });
}
