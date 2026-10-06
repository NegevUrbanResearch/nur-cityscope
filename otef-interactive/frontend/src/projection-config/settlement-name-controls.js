import { effectiveSettlementPosition } from "../shared/settlement-name-settings.js";
import { renderField } from './config-field-control.js';
import { DEFAULT_SETTLEMENT_LEADER_STYLE, EXCLUDED_SETTLEMENT_CODES } from '../shared/settlement-label-presentation.js';

const FONTS = ["Guttman Hatzvi", "Arial"];

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

function statusText(positionRecord, styleRecord, hydration, extraRecords = []) {
  if (hydration?.status === "Failed") return hydration.error === "Initialization required" ? "Initialization required" : "Settings unavailable";
  if (hydration?.status === "Loading" || !positionRecord) return "Loading";
  const records = [positionRecord, styleRecord, ...extraRecords].filter(Boolean);
  if (records.some((record) => record.status === "Conflict")) return "Changed on another screen";
  if (records.some((record) => record.status === "Failed")) return "Save failed";
  if (records.some((record) => record.status === "Saving")) return "Saving";
  return "Saved";
}

export function createSettlementNameControls(doc, {
  catalog = { entries: [] },
  onOutput = () => {},
  onCitycode = () => {},
  onPosition = () => {},
  onStyle = () => {},
  onLineBreak = () => {},
  onLeaderStyle = () => {},
  onResetOrigin = () => {},
  onRetry = () => {},
  onRetryCatalog = () => {},
  onLoad = () => {},
} = {}) {
  const element = make(doc, "div", { className: "settlement-name-controls" });
  const note = make(doc, "p", { className: "settlement-shared-note" }, "Position edits save automatically for this output. Font, rotation, line breaks, and line style save automatically for both projectors. Line breaks affect projection only. These edits are separate from projection calibration Live and Apply.");
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
  const breakLabel = make(doc, 'label', { className: 'settlement-name-field' }, 'Line break (projection only)');
  const connectorNote = make(doc, 'p', { className: 'settlement-connector-note', hidden: true }, 'No settlement outline is linked to this name; its connector is unavailable.');
  const lineBreak = make(doc, 'select', { ariaLabel: 'Projection line break', dataset: { field: 'lineBreak' } });
  breakLabel.appendChild(lineBreak);
  lineBreak.addEventListener('change', () => onLineBreak(Number(lineBreak.value)));
  const originHelp = make(doc, 'p', { className: 'settlement-shared-note' }, 'Drag the blue start-point handle in the editor to choose where the line leaves the outline. The origin is shared by both projectors.');
  const resetOrigin = make(doc, 'button', { type: 'button', dataset: { action: 'reset-leader-origin' } }, 'Reset to automatic');
  resetOrigin.addEventListener('click', event => { event.stopPropagation?.(); onResetOrigin(); });
  const fields = new Map();
  const sessions = new Map();
  const fieldLabels = [];
  const leaderLabels = [];
  for (const [key, name, min, max, step, unit] of [
    ["fontPx", "Font size", 8, 64, 1, "px"],
    ["rotateDeg", "Rotation", -180, 180, 1, "°"],
    ["x", "X", -1920, 3840, 1, "reference px"],
    ["y", "Y", -1080, 2160, 1, "reference px"],
    ['widthPx', 'Line width', 0.25, 8, 0.25, 'px'],
    ['outlineWidthPx', 'Line outer stroke', 0, 4, 0.25, 'px'],
    ['opacity', 'Line opacity', 0, 1, 0.05, ''],
  ]) {
    const control = renderField(doc, {path:key,label:name,min,max,step,unit,range:false,nudges:false,validate:value=>value>=min && value<=max}, (path,raw) => {
      const value=Number(raw);
      if (path === 'x' || path === 'y') onPosition({x:path==='x'?value:current.position?.x,y:path==='y'?value:current.position?.y});
      else if (Object.hasOwn(DEFAULT_SETTLEMENT_LEADER_STYLE, path)) onLeaderStyle({ ...current.leaderStyle, [path]: value });
      else onStyle({...current.style,[path]:value});
    }, () => {});
    const label=control.wrap; label.className += ' settlement-name-field'; const input=control.number;
    sessions.set(key,control);
    fields.set(key, input);
    (Object.hasOwn(DEFAULT_SETTLEMENT_LEADER_STYLE, key) ? leaderLabels : fieldLabels).push(label);
  }
  const colors = new Map();
  for (const [key, labelText] of [['color', 'Line color'], ['outlineColor', 'Line outer color']]) {
    const label = make(doc, 'label', { className: 'settlement-name-field' }, labelText);
    const input = make(doc, 'input', { type: 'color', ariaLabel: labelText, dataset: { field: key } });
    input.addEventListener('change', () => onLeaderStyle({ ...current.leaderStyle, [key]: input.value }));
    colors.set(key, input); label.appendChild(input); leaderLabels.push(label);
  }
  const status = make(doc, "p", { className: "settlement-name-status", role: "status" }, "Loading");
  const catalogStatus = make(doc, "p", { className: "settlement-catalog-status", role: "status", hidden: true });
  const catalogRetry = make(doc, "button", { type: "button", className: "settlement-catalog-retry", hidden: true }, "Retry settlement list");
  const retry = make(doc, "button", { type: "button", className: "settlement-name-retry" }, "Retry");
  const load = make(doc, "button", { type: "button", className: "settlement-name-load" }, "Load saved");
  const actions = make(doc, "div", { className: "settlement-name-status-actions" });
  actions.append(status, retry, load);
  element.append(note, catalogStatus, catalogRetry, outputLabel, cityLabel, connectorNote, breakLabel, ...leaderLabels, originHelp, resetOrigin, fontLabel, ...fieldLabels, actions);
  let current = { position: null, style: null };
  const stop = (event) => event.stopPropagation?.();
  for (const node of [output, city, fontFamily, lineBreak, ...fields.values(), ...colors.values()]) node.addEventListener("click", stop);
  output.addEventListener("change", () => onOutput(output.value));
  city.addEventListener("change", () => onCitycode(city.value));
  fontFamily.addEventListener("change", () => onStyle({ ...current.style, fontFamily: fontFamily.value }));
  retry.addEventListener("click", (event) => { stop(event); onRetry(); });
  catalogRetry.addEventListener("click", (event) => { stop(event); onRetryCatalog(); });
  load.addEventListener("click", (event) => { stop(event); onLoad(); });
  return {
    element,
    output,
    city,
    finish: () => [...sessions.values()].map(control=>control.finish()),
    hasPending: () => [...sessions.values()].some(control => control.isPending()),
    isHeld: () => [...sessions.values()].some(control => control.isHeld()),
    cancel: () => { for (const control of sessions.values()) control.cancel(); },
    dispose: () => { for (const control of sessions.values()) control.dispose(); },
    render(state = {}) {
      current = { position: state.position || null, style: state.style || null, leaderStyle: state.leaderStyle || DEFAULT_SETTLEMENT_LEADER_STYLE };
      const catalogState = state.catalogStatus || { status: "ready" };
      catalogStatus.textContent = catalogState.status === "error"
        ? `Settlement list unavailable${catalogState.error ? `: ${catalogState.error}` : ""}`
        : catalogState.status === "loading" ? "Loading settlement list…" : "";
      catalogStatus.hidden = catalogState.status === "ready";
      catalogRetry.hidden = catalogState.status !== "error";
      const entries = (state.catalog?.entries || catalog.entries || []).filter(entry => !EXCLUDED_SETTLEMENT_CODES.has(entry.citycode));
      const outlines = state.catalog?.outlines || catalog.outlines;
      connectorNote.hidden = !outlines || !state.citycode || outlines.has(state.citycode);
      const words = String(entries.find(entry => entry.citycode === state.citycode)?.text || '').trim().split(/\s+/);
      const breakOptions = [make(doc, 'option', { value: '0' }, 'Single line'), ...words.slice(0, -1).map((_, i) =>
        make(doc, 'option', { value: String(i + 1) }, `${words.slice(0, i + 1).join(' ')} / ${words.slice(i + 1).join(' ')}`))];
      if (lineBreak.replaceChildren) lineBreak.replaceChildren(...breakOptions);
      else { lineBreak.children = []; breakOptions.forEach(option => lineBreak.appendChild(option)); }
      lineBreak.value = String(state.afterWord || 0);
      if (city.options || city.replaceChildren) {
        const options = entries.map((entry) => make(doc, "option", { value: entry.citycode }, `${entry.citycode} ${entry.text}`));
        if (city.replaceChildren) city.replaceChildren(...options);
        else { city.children = []; options.forEach((option) => city.appendChild(option)); }
      }
      if (doc.activeElement !== output) output.value = state.output || "left";
      if (doc.activeElement !== city && state.citycode) city.value = state.citycode;
      if (doc.activeElement !== fontFamily && state.style?.fontFamily) fontFamily.value = state.style.fontFamily;
      for (const [key, input] of fields) {
        const value = key === "x" || key === "y" ? state.position?.[key]
          : Object.hasOwn(DEFAULT_SETTLEMENT_LEADER_STYLE, key) ? current.leaderStyle[key] : state.style?.[key];
        sessions.get(key).update({value,resolvedPath:`settlement-names:${state.output || 'left'}:${state.citycode || ''}:${key}`});
      }
      const enabled = state.enabled !== false && state.hydration?.status === "Saved";
      resetOrigin.disabled = !enabled || !state.leaderOrigin;
      for (const [key, input] of colors) input.value = current.leaderStyle[key];
      for (const node of [output, city, fontFamily, lineBreak, ...fields.values(), ...colors.values()]) node.disabled = !enabled;
      for (const control of sessions.values()) for (const node of control.wrap.querySelectorAll?.('button') || []) node.disabled = !enabled || (node.dataset?.action === 'numeric-use-mine' && node.disabled);
      const extraRecords = [state.lineBreakRecord, state.leaderStyleRecord, state.leaderOriginRecord].filter(Boolean);
      status.textContent = statusText(state.positionRecord, state.styleRecord, state.hydration, extraRecords);
      const failed = state.hydration?.status === "Failed" || [state.positionRecord, state.styleRecord, ...extraRecords].some(r => r?.status === 'Failed');
      const conflict = [state.positionRecord, state.styleRecord, ...extraRecords].some(r => r?.status === 'Conflict');
      retry.hidden = !failed && !conflict;
      load.hidden = !conflict;
    },
  };
}
