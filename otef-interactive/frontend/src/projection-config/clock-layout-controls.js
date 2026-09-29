import MapProjectionConfig from "../shared/map-projection-config.js";
import { NLI_GIS_CLOCK_DEFAULT_LAYOUT } from "../projection/nli-explainer-overlay.js";
import { LEGEND_LAYOUT_DEFAULT } from "../projection/legend-layout.js";
import { normalizeEditableLayout } from "./clock-layout-geometry.js";

export const GIS_SLOT = Object.freeze({ home: "start", timeline: "start", segev: "segev", nova: "nova", sderot: "sderot", hostages: "hostages", hostages_all: "hostages_all" });
export const GIS_LABEL = Object.freeze({ home: "Home", timeline: "Timeline", segev: "Segev", nova: "Nova", sderot: "Sderot", hostages: "Peri Family", hostages_all: "All Hostages" });

export function resourceFor(nodeId, sceneId = "home", element = "clock") {
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
  let dwellLabel;
  for (const [key, name, min, max, step, unit, extra] of [
    ["leftPct", "X", 0, 100, 0.1, "%"], ["topPct", "Y", 0, 100, 0.1, "%"],
    ["fontPx", "Font size", 8, 64, 1, "px"], ["rotateDeg", "Rotation", -180, 180, 0.1, "deg"],
    ["widthPct", "Width", 2, 100, 0.1, "%", true], ["heightPct", "Height", 2, 100, 0.1, "%", true],
    ["dwellSeconds", "Legend dwell seconds", 4, 30, 1, "s", true],
  ]) {
    const label = make(doc, "label", { className: "clock-layout-field" }, name);
    const input = make(doc, "input", { type: "number", min: String(min), max: String(max), step: String(step), inputMode: "decimal", dataset: { field: key }, ariaLabel: name });
    label.append(input, make(doc, "span", { className: "clock-layout-unit" }, unit));
    (extra ? advanced : element).appendChild(label); controls.set(key, input);
    input.addEventListener("click", (event) => event.stopPropagation?.());
    input.addEventListener("change", () => onField(key, input.value));
    if (key === "dwellSeconds") dwellLabel = label;
  }
  element.appendChild(advanced);
  return { element, controls, advanced, render(layout, { enabled = true, legend = false } = {}) {
    for (const [key, input] of controls) {
      input.disabled = !enabled;
      input.hidden = key === "dwellSeconds" && !legend;
      if (doc.activeElement !== input) input.value = layout?.[key] == null ? "" : String(layout[key]);
    }
    controls.get("leftPct").max = String(100 - (layout?.widthPct ?? 2));
    controls.get("topPct").max = String(100 - (layout?.heightPct ?? 2));
    dwellLabel.hidden = !legend;
  } };
}

export function layoutFieldEdit(layout, key, raw) {
  if (String(raw).trim() === "" || !Number.isFinite(Number(raw))) return null;
  return normalizeEditableLayout({ ...layout, [key]: Number(raw) });
}
