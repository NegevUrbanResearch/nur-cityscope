import { createNumericEditSession, parseNumericText } from './numeric-edit-session.js';

let nextControlId = 0;
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
  const id = `numeric-field-${++nextControlId}`;
  const signed = descriptor.min < 0;
  const toDisplay = descriptor.display === 'percentage' ? v => v * 100 : v => v;
  const fromDisplay = descriptor.display === 'percentage' ? v => v / 100 : v => v;
  let latest = { value: undefined, resolvedPath: descriptor.path };
  const session = createNumericEditSession({ path: descriptor.path, ...latest, toDisplay, fromDisplay });
  let sign = 1;
  let pendingText = '';
  let pendingSign = 1;
  let targetChanged = false;
  let externalError = '';
  let disposed = false;
  let heldPointer = null;
  let retiredPointer = null;
  const listeners = [];
  const listen = (node, type, handler) => { if (!node) return; node.addEventListener(type, handler); listeners.push(() => node.removeEventListener?.(type, handler)); };
  const wrap = make(doc, "div", { className: `config-field${compact ? " compact-field" : ""}${editorLayout ? " parameter-field-layout" : ""}`, dataset: { path: descriptor.path } });
  const label = make(doc, "label", { className: "config-field-label", htmlFor: `${id}-magnitude` }, descriptor.label);
  wrap.appendChild(label);
  const row = make(doc, "div", { className: "config-field-row" });
  const range = make(doc, "input", { id: `${id}-range`, type: "range", min: descriptor.displayMin ?? descriptor.min, max: descriptor.displayMax ?? descriptor.max, step: descriptor.displayStep ?? descriptor.step, ariaLabel: `${descriptor.label} slider`, dataset: { field: descriptor.path, input: "range" } });
  const number = compact ? null : make(doc, "input", { id: `${id}-magnitude`, type: "text", min: descriptor.displayMin ?? descriptor.min, max: descriptor.displayMax ?? descriptor.max, step: descriptor.integer ? descriptor.displayStep : "any", inputMode: descriptor.integer ? "numeric" : "decimal", ariaLabel: descriptor.label, dataset: { field: descriptor.path, input: "number" } });
  const signButton = signed && number ? button(doc, '+', 'numeric-sign', 'numeric-sign') : null;
  signButton?.setAttribute('aria-label', `${descriptor.label} sign: positive. Change to negative`);
  const useLatest = button(doc, 'Use latest', 'numeric-use-latest');
  const useMine = button(doc, 'Use my value', 'numeric-use-mine');
  useLatest.hidden = useMine.hidden = true;
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
    controlsRow.append(value, ...(signButton ? [signButton] : []), number, unit, ...(descriptor.nudges === false ? [] : [fineMinus, finePlus]));
  } else row.append(...(descriptor.range === false ? [] : [range]), ...(signButton ? [signButton] : []), number, unit, ...(descriptor.nudges === false ? [] : [fineMinus, finePlus]), ...(descriptor.commitOnChange ? [value] : []));
  if (editorLayout) wrap.appendChild(controlsRow);
  else wrap.appendChild(row);
  const error = make(doc, "small", { id: `${id}-error`, className: "config-field-error", role: "alert", dataset: { errorFor: descriptor.path } });
  const unitId = `${id}-unit`; unit.id = unitId;
  for (const input of [range, number, signButton]) input?.setAttribute('aria-describedby', `${unitId} ${error.id}`);
  wrap.append(error, useLatest, useMine);
  const showSign = () => {
    if (!signButton) return;
    signButton.textContent = sign < 0 ? '−' : '+';
    signButton.setAttribute('aria-label', `${descriptor.label} sign: ${sign < 0 ? 'negative' : 'positive'}. Change to ${sign < 0 ? 'positive' : 'negative'}`);
    signButton.setAttribute('aria-pressed', String(sign < 0));
  };
  const renderResult = (result = session.candidate()) => {
    const message = externalError || result.error || '';
    error.textContent = message;
    wrap.classList?.toggle('has-error', Boolean(message));
    for (const input of [range, number]) input?.setAttribute('aria-invalid', String(Boolean(message)));
    useLatest.hidden = useMine.hidden = result.kind !== 'conflict';
    useMine.disabled = targetChanged || result.resolvedPath !== latest.resolvedPath;
  };
  const refresh = (resetSign = false) => {
    const shown = displayValue(descriptor, latest.value);
    if (resetSign || Number(latest.value) !== 0) sign = Number(latest.value) < 0 ? -1 : 1;
    range.value = shown;
    if (number) number.value = signed && shown ? formatInputValue(Math.abs(Number(shown))) : shown;
    value.textContent = `${shown}${descriptor.unit ? ` ${descriptor.unit}` : ''}`;
    showSign(); renderResult();
  };
  const markInput = (raw, inputSign = sign) => {
    pendingText = raw; pendingSign = inputSign;
    session.input(raw, inputSign);
    externalError = '';
    const parsed = parseNumericText(raw, { sign: inputSign, signed });
    if (parsed.ok) { if (signed && parsed.value !== 0) sign = parsed.value < 0 ? -1 : 1; displayOutput(parsed.value); showSign(); }
    else displayOutput('');
    renderResult();
  };
  const finish = (inputKind = 'number', override = false) => {
    if (disposed) return { kind: 'unchanged', ...session.candidate() };
    let result = session.candidate();
    if (override && result.kind === 'conflict' && !targetChanged && result.resolvedPath === latest.resolvedPath) {
      session.cancel(); session.input(pendingText, pendingSign); result = session.candidate();
    }
    if (result.kind === 'commit') {
      const shown = toDisplay(result.value);
      if (!Number.isFinite(shown) || (!signed && shown < 0) || (descriptor.validate && !descriptor.validate(result.value))) result = { ...result, kind: 'invalid', error: 'Enter a number within the allowed bounds.' };
      else {
        const meta = { baseValue: result.baseValue, resolvedPath: result.resolvedPath, override };
        const enteredText = number?.value;
        if (number) number.value = formatInputValue(signed ? Math.abs(shown) : shown);
        const accepted = onField(descriptor.path, String(shown), inputKind, meta);
        if (accepted === false) {
          if (number) number.value = enteredText;
          const pending = session.candidate();
          result = { ...result, kind: pending.kind === 'conflict' ? 'conflict' : 'invalid', error: externalError || pending.error || 'Value was not accepted. Check the field bounds.' };
        } else {
          latest = { value: result.value, resolvedPath: result.resolvedPath };
          session.sync(latest); session.cancel(); targetChanged = false; externalError = ''; refresh();
        }
      }
    }
    if (result.kind === 'unchanged') { session.cancel(); targetChanged = false; refresh(); }
    renderResult(result.kind === 'commit' ? session.candidate() : result);
    return result;
  };
  const cancel = () => { if (heldPointer !== null) retiredPointer = heldPointer; heldPointer = null; session.cancel(); targetChanged = false; externalError = ''; refresh(true); };
  listen(range, 'pointerdown', event => { retiredPointer = null; heldPointer = event.pointerId; });
  listen(range, 'keydown', () => { retiredPointer = null; });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(range, type, event => {
    if (heldPointer === event.pointerId) heldPointer = null;
    if (retiredPointer === event.pointerId) retiredPointer = null;
  });
  listen(number, 'input', () => markInput(number.value));
  listen(number, 'blur', () => finish());
  listen(number, 'change', () => finish());
  listen(number, 'keydown', event => { if (event.key === 'Enter') { event.preventDefault(); finish(); } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation?.(); cancel(); } });
  listen(signButton, 'pointerdown', event => event.preventDefault?.());
  listen(signButton, 'click', event => {
    event.stopPropagation?.();
    sign *= -1;
    const raw = session.isDirty() ? pendingText : String(toDisplay(latest.value));
    const parsed = parseNumericText(raw);
    if (parsed.ok) number.value = String(Math.abs(parsed.value));
    markInput(number.value); showSign(); number.focus?.();
  });
  listen(range, 'input', () => { if (retiredPointer !== null) { range.value = displayValue(descriptor, latest.value); return; } markInput(range.value, 1); if (number && !descriptor.commitOnChange) number.value = signed ? String(Math.abs(Number(range.value))) : range.value; if (!descriptor.commitOnChange) finish('range'); });
  listen(range, 'change', () => { if (retiredPointer === null) finish('range'); });
  listen(useLatest, 'click', event => { event.stopPropagation?.(); cancel(); });
  listen(useMine, 'click', event => { event.stopPropagation?.(); finish('number', true); });
  if (!compact) { listen(fineMinus, 'click', () => { cancel(); onNudge(descriptor.path, -1); }); listen(finePlus, 'click', () => { cancel(); onNudge(descriptor.path, 1); }); }
  return { wrap, range, number, value, error,
    update({ value: nextValue, resolvedPath = descriptor.path, error: nextError = '' }) {
      if (disposed) return;
      const resolvedChanged = latest.resolvedPath !== resolvedPath;
      if (session.isDirty() && session.candidate().resolvedPath !== resolvedPath) targetChanged = true;
      latest = { value: nextValue, resolvedPath }; externalError = String(nextError || ''); session.sync(latest);
      range.value = displayValue(descriptor, nextValue);
      if (!session.isDirty()) refresh(resolvedChanged); else renderResult();
    },
    finish, cancel, isPending: () => session.isDirty(), isHeld: () => heldPointer !== null,
    dispose() { cancel(); retiredPointer = null; disposed = true; listeners.forEach(remove => remove()); },
  };
}
