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
  return make(doc, "button", { type: "button", className, dataset: { action } }, label);
}

export function displayValue(descriptor, value) {
  if (!Number.isFinite(Number(value))) return "";
  const shown = descriptor.display === "percentage" ? Number(value) * 100 : Number(value);
  return descriptor.decimals === undefined ? String(shown) : shown.toFixed(descriptor.decimals);
}

export function renderField(doc, descriptor, onField, onNudge, compact = false, editorLayout = false) {
  const wrap = make(doc, "div", { className: `config-field${compact ? " compact-field" : ""}${editorLayout ? " parameter-field-layout" : ""}`, dataset: { path: descriptor.path } });
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
    if (!editorLayout) { value.textContent = String(raw ?? ""); return; }
    const shown = formatInputValue(raw);
    value.textContent = shown ? `${shown}${descriptor.unit ? ` ${descriptor.unit}` : ""}` : "";
  };
  let controlsRow = row;
  if (compact) row.append(range, value);
  else if (editorLayout) {
    row.className = "config-field-row config-field-range-row";
    row.appendChild(range);
    wrap.appendChild(row);
    controlsRow = make(doc, "div", { className: "config-field-row config-field-controls-row" });
    controlsRow.append(value, number, unit, fineMinus, finePlus);
  } else row.append(range, number, unit, fineMinus, finePlus, ...(descriptor.commitOnChange ? [value] : []));
  if (editorLayout) wrap.appendChild(controlsRow);
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
