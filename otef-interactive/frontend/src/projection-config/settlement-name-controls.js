import { effectiveSettlementPosition } from "../shared/settlement-name-settings.js";

const FONTS = ["Guttman Hatzvi", "Arial"];
const LIMITS = { x: [-1920, 3840], y: [-1080, 2160], fontPx: [8, 64], rotateDeg: [-180, 180] };

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

export function shownSettlementPosition(settings, record, output, citycode) {
  if (record?.draft) return record.draft;
  if (record?.acknowledged) return record.acknowledged;
  return effectiveSettlementPosition(settings, output, citycode);
}

function statusText(positionRecord, styleRecord, hydration) {
  if (hydration?.status === "Failed") return hydration.error === "Initialization required" ? "Initialization required" : "Settings unavailable";
  if (hydration?.status === "Loading" || !positionRecord) return "Loading";
  const records = [positionRecord, styleRecord].filter(Boolean);
  if (records.some((record) => record.status === "Conflict")) return "Changed on another screen";
  if (records.some((record) => record.status === "Failed")) return "Save failed";
  if (records.some((record) => record.status === "Saving")) return "Saving";
  return "Saved";
}

function finiteField(raw, min, max) {
  if (typeof raw === "boolean" || String(raw).trim() === "" || !Number.isFinite(Number(raw))) return null;
  const value = Number(raw);
  if (value < min || value > max) return null;
  return value;
}

export function createSettlementNameControls(doc, {
  catalog = { entries: [] },
  onOutput = () => {},
  onCitycode = () => {},
  onPosition = () => {},
  onStyle = () => {},
  onRetry = () => {},
  onLoad = () => {},
} = {}) {
  const element = make(doc, "div", { className: "settlement-name-controls" });
  const note = make(doc, "p", { className: "settlement-shared-note" }, "Font and rotation apply to every settlement on both projectors.");
  const outputLabel = make(doc, "label", { className: "settlement-name-field" }, "Output");
  const output = make(doc, "select", { ariaLabel: "Settlement output", dataset: { field: "output" } });
  output.append(make(doc, "option", { value: "left" }, "Left"), make(doc, "option", { value: "right" }, "Right"));
  outputLabel.appendChild(output);
  const cityLabel = make(doc, "label", { className: "settlement-name-field" }, "Settlement");
  const city = make(doc, "select", { ariaLabel: "Settlement name", dataset: { field: "citycode" } });
  cityLabel.appendChild(city);
  const fontLabel = make(doc, "label", { className: "settlement-name-field" }, "Font");
  const fontFamily = make(doc, "select", { ariaLabel: "Settlement font", dataset: { field: "fontFamily" } });
  for (const family of FONTS) fontFamily.appendChild(make(doc, "option", { value: family }, family));
  fontLabel.appendChild(fontFamily);
  const fields = new Map();
  const fieldLabels = [];
  for (const [key, name, min, max, step, unit] of [
    ["fontPx", "Font size", 8, 64, 1, "px"],
    ["rotateDeg", "Rotation", -180, 180, 1, "°"],
    ["x", "X", -1920, 3840, 1, "reference px"],
    ["y", "Y", -1080, 2160, 1, "reference px"],
  ]) {
    const label = make(doc, "label", { className: "settlement-name-field" }, name);
    const input = make(doc, "input", { type: "number", min: String(min), max: String(max), step: String(step), inputMode: "decimal", dataset: { field: key }, ariaLabel: name });
    label.append(input, make(doc, "span", { className: "settlement-name-unit" }, unit));
    fields.set(key, input);
    fieldLabels.push(label);
  }
  const status = make(doc, "p", { className: "settlement-name-status", role: "status" }, "Loading");
  const retry = make(doc, "button", { type: "button", className: "settlement-name-retry" }, "Retry");
  const load = make(doc, "button", { type: "button", className: "settlement-name-load" }, "Load saved");
  const actions = make(doc, "div", { className: "settlement-name-status-actions" });
  actions.append(status, retry, load);
  element.append(note, outputLabel, cityLabel, fontLabel, ...fieldLabels, actions);
  let current = { position: null, style: null };
  const stop = (event) => event.stopPropagation?.();
  for (const node of [output, city, fontFamily, ...fields.values()]) node.addEventListener("click", stop);
  output.addEventListener("change", () => onOutput(output.value));
  city.addEventListener("change", () => onCitycode(city.value));
  fontFamily.addEventListener("change", () => onStyle({ ...current.style, fontFamily: fontFamily.value }));
  for (const [key, input] of fields) {
    input.addEventListener("change", () => {
      const limit = LIMITS[key];
      const value = finiteField(input.value, limit[0], limit[1]);
      if (value == null) { input.setAttribute?.("aria-invalid", "true"); return; }
      input.removeAttribute?.("aria-invalid");
      if (key === "x" || key === "y") onPosition({ x: key === "x" ? value : current.position?.x, y: key === "y" ? value : current.position?.y });
      else onStyle({ ...current.style, [key]: value });
    });
  }
  retry.addEventListener("click", (event) => { stop(event); onRetry(); });
  load.addEventListener("click", (event) => { stop(event); onLoad(); });
  return {
    element,
    render(state = {}) {
      current = { position: state.position || null, style: state.style || null };
      const entries = state.catalog?.entries || catalog.entries || [];
      if (city.options || city.replaceChildren) {
        const options = entries.map((entry) => make(doc, "option", { value: entry.citycode }, `${entry.citycode} ${entry.text}`));
        if (city.replaceChildren) city.replaceChildren(...options);
        else { city.children = []; options.forEach((option) => city.appendChild(option)); }
      }
      if (doc.activeElement !== output) output.value = state.output || "left";
      if (doc.activeElement !== city && state.citycode) city.value = state.citycode;
      if (doc.activeElement !== fontFamily && state.style?.fontFamily) fontFamily.value = state.style.fontFamily;
      for (const [key, input] of fields) {
        if (doc.activeElement === input) continue;
        const value = key === "x" || key === "y" ? state.position?.[key] : state.style?.[key];
        input.value = value == null ? "" : String(value);
      }
      const enabled = state.enabled !== false && state.hydration?.status === "Saved";
      for (const node of [output, city, fontFamily, ...fields.values()]) node.disabled = !enabled;
      status.textContent = statusText(state.positionRecord, state.styleRecord, state.hydration);
      const failed = state.hydration?.status === "Failed" || state.positionRecord?.status === "Failed" || state.styleRecord?.status === "Failed";
      const conflict = state.positionRecord?.status === "Conflict" || state.styleRecord?.status === "Conflict";
      retry.hidden = !failed && !conflict;
      load.hidden = !conflict;
    },
  };
}
