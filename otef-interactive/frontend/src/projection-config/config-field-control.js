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

export function renderField(doc, descriptor, onField, onNudge, compact = false, editorLayout = false, onCancelEdit = () => {}) {
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
  let focusedTarget = null;
  let externalError = '';
  let needsAcceptance = false;
  let rejectionError = '';
  let disposed = false;
  let heldPointer = null;
  let retiredPointer = null;
  let fineMode = !descriptor.integer && descriptor.range !== false && Number.isFinite(descriptor.fine);
  let rangeGesture = null;
  let hold = null;
  let suppressNudgeClick = false;
  let rangeRejected = false;
  const gestureId = () => `${id}-${++nextControlId}`;
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
  const cancelEdit = button(doc, 'Cancel edit', 'numeric-cancel-edit');
  cancelEdit.setAttribute('aria-label', `Cancel editing ${descriptor.label}`);
  useLatest.hidden = useMine.hidden = true;
  const value = make(doc, "output", { className: "config-field-value", htmlFor: descriptor.path });
  const unit = make(doc, "span", { className: "config-field-unit" }, descriptor.unit || "");
  const fineMinus = button(doc, "−", "fine-nudge", "nudge");
  const finePlus = button(doc, "+", "fine-nudge", "nudge");
  const sensitivityGroup = make(doc, 'div', { className: 'numeric-sensitivity-group', role: 'group', ariaLabel: `${descriptor.label} slider step size` });
  const fineSensitivity = button(doc, 'Fine', 'numeric-sensitivity', 'numeric-sensitivity');
  const coarseSensitivity = button(doc, 'Coarse', 'numeric-sensitivity', 'numeric-sensitivity');
  fineSensitivity.dataset.mode = 'fine'; coarseSensitivity.dataset.mode = 'coarse';
  fineSensitivity.setAttribute('aria-label', `${descriptor.label} fine slider step`);
  coarseSensitivity.setAttribute('aria-label', `${descriptor.label} coarse slider step`);
  sensitivityGroup.append(fineSensitivity, coarseSensitivity);
  const stepLabel = make(doc, 'span', { className: 'numeric-step' });
  const showStep = () => { stepLabel.textContent = `Step: ${fineMode ? toDisplay(descriptor.fine) : descriptor.displayStep ?? descriptor.step}${descriptor.unit ? ` ${descriptor.unit}` : ''}`; };
  const renderSensitivity = () => {
    fineSensitivity.setAttribute('aria-pressed', String(fineMode));
    coarseSensitivity.setAttribute('aria-pressed', String(!fineMode));
  };
  renderSensitivity();
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
  if (descriptor.range !== false && Number.isFinite(descriptor.fine)) { wrap.append(sensitivityGroup, stepLabel); showStep(); }
  const error = make(doc, "small", { id: `${id}-error`, className: "config-field-error", role: "alert", dataset: { errorFor: descriptor.path } });
  const unitId = `${id}-unit`; unit.id = unitId;
  for (const input of [range, number, signButton]) input?.setAttribute('aria-describedby', `${unitId} ${error.id}`);
  wrap.append(error, useLatest, useMine, cancelEdit);
  const showSign = () => {
    if (!signButton) return;
    signButton.textContent = sign < 0 ? '−' : '+';
    signButton.setAttribute('aria-label', `${descriptor.label} sign: ${sign < 0 ? 'negative' : 'positive'}. Change to ${sign < 0 ? 'positive' : 'negative'}`);
    signButton.setAttribute('aria-pressed', String(sign < 0));
  };
  const renderResult = (result = session.candidate()) => {
    const message = externalError || rejectionError || result.error || '';
    error.textContent = message;
    wrap.classList?.toggle('has-error', Boolean(message));
    for (const input of [range, number]) input?.setAttribute('aria-invalid', String(Boolean(message)));
    useLatest.hidden = useMine.hidden = result.kind !== 'conflict';
    useMine.disabled = targetChanged || result.resolvedPath !== latest.resolvedPath;
    cancelEdit.hidden = !session.isDirty() && rangeGesture === null && !rangeRejected;
  };
  const refresh = (resetSign = false) => {
    const shown = displayValue(descriptor, latest.value);
    if (resetSign || Number(latest.value) !== 0) sign = Number(latest.value) < 0 ? -1 : 1;
    if (!rangeGesture) configureRange();
    if (number) number.value = signed && shown ? formatInputValue(Math.abs(Number(shown))) : shown;
    value.textContent = `${shown}${descriptor.unit ? ` ${descriptor.unit}` : ''}`;
    showSign(); renderResult();
  };
  function configureRange() {
    if (!fineMode) {
      range.min = descriptor.displayMin ?? descriptor.min; range.max = descriptor.displayMax ?? descriptor.max;
      range.step = descriptor.displayStep ?? descriptor.step; range.value = displayValue(descriptor, latest.value); return;
    }
    const center = toDisplay(latest.value);
    const halfSpan = descriptor.integer ? 10 * descriptor.step : descriptor.display === 'percentage' ? 1 : descriptor.unit === '°' ? 1 : .02;
    const step = toDisplay(descriptor.fine);
    range.min = Math.ceil((Math.max(descriptor.displayMin ?? descriptor.min, center - halfSpan) - center) / step);
    range.max = Math.floor((Math.min(descriptor.displayMax ?? descriptor.max, center + halfSpan) - center) / step);
    range.step = 1; range.value = '0';
  }
  function beginRange() {
    if (rangeGesture) return;
    rangeGesture = { id: gestureId(), base: latest.value, last: latest.value, path: latest.resolvedPath };
  }
  function sendRange(phase, candidate = rangeGesture?.last) {
    if (!rangeGesture) return true;
    const active = rangeGesture;
    if (phase !== 'cancel') {
      const shown = toDisplay(candidate); displayOutput(shown);
      if (number) number.value = formatInputValue(signed ? Math.abs(shown) : shown);
    }
    const accepted = onField(descriptor.path, String(toDisplay(candidate)), 'range', {
      canonicalValue: candidate, baseValue: active.last, resolvedPath: active.path, phase, gestureId: active.id,
    });
    if (accepted !== false && phase !== 'cancel') { active.last = candidate; latest.value = candidate; rangeRejected = false; rejectionError = ''; session.sync(latest); refresh(); }
    if (accepted === false) { rangeRejected = true; rejectionError = externalError || 'Value was not accepted. Check the field bounds.'; renderResult(); }
    return accepted !== false;
  }
  function endRange(cancelled = false, notify = true) {
    if (!rangeGesture) return;
    const rejected = rangeRejected; const message = rejectionError;
    if (notify) sendRange(cancelled ? 'cancel' : 'end');
    if (rejected && !cancelled) { rangeRejected = true; rejectionError = message; }
    rangeGesture = null; session.sync(latest); refresh();
  }
  function stopHold(cancelled = false, notify = true) {
    if (!hold) return;
    const active = hold; hold = null;
    clearTimeout(active.timer); clearInterval(active.repeat);
    if (active.count) {
      suppressNudgeClick = true;
      if (notify && active.acceptedCount) {
        const rejected = rangeRejected; const message = rejectionError;
        sendNudge(active.direction, { phase: cancelled ? 'cancel' : 'end', gestureId: active.id, count: active.acceptedCount });
        if (rejected && !cancelled) { rangeRejected = true; rejectionError = message; renderResult(); }
      }
    }
    active.button.releasePointerCapture?.(active.pointer);
  }
  function sendNudge(direction, meta) {
    const accepted = meta ? onNudge(descriptor.path, direction, meta) : onNudge(descriptor.path, direction);
    rangeRejected = accepted === false;
    rejectionError = rangeRejected ? externalError || 'Value was not accepted. Check the field bounds.' : '';
    renderResult(); return accepted !== false;
  }
  const markInput = (raw, inputSign = sign) => {
    rangeRejected = false;
    pendingText = raw; pendingSign = inputSign;
    session.input(raw, inputSign);
    externalError = ''; rejectionError = '';
    const parsed = parseNumericText(raw, { sign: inputSign, signed });
    if (parsed.ok) { if (signed && parsed.value !== 0) sign = parsed.value < 0 ? -1 : 1; displayOutput(parsed.value); showSign(); }
    else displayOutput('');
    renderResult();
  };
  const finish = (inputKind = 'number', override = false) => {
    if (disposed) return { kind: 'unchanged', ...session.candidate() };
    if (rangeRejected) { renderResult(); return { kind: 'invalid', error: rejectionError }; }
    let result = session.candidate();
    if (override && result.kind === 'conflict' && !targetChanged && result.resolvedPath === latest.resolvedPath) {
      session.cancel(); session.input(pendingText, pendingSign); result = session.candidate();
    }
    const correction = result.kind === 'unchanged' && session.isDirty() && needsAcceptance;
    if (result.kind === 'commit' || correction) {
      const candidateValue = correction ? result.baseValue : result.value;
      const shown = toDisplay(candidateValue);
      if (!Number.isFinite(shown) || (!signed && shown < 0) || (descriptor.validate && !descriptor.validate(candidateValue))) result = { ...result, kind: 'invalid', error: 'Enter a number within the allowed bounds.' };
      else {
        const meta = { baseValue: result.baseValue, resolvedPath: result.resolvedPath, override };
        const enteredText = number?.value;
        if (number) number.value = formatInputValue(signed ? Math.abs(shown) : shown);
        const accepted = onField(descriptor.path, String(shown), inputKind, meta);
        if (accepted === false) {
          if (number) number.value = enteredText;
          const pending = session.candidate();
          result = { ...result, kind: pending.kind === 'conflict' ? 'conflict' : 'invalid', error: externalError || pending.error || 'Value was not accepted. Check the field bounds.' };
          needsAcceptance = true; rejectionError = result.error;
        } else {
          needsAcceptance = false; rejectionError = '';
          latest = { value: candidateValue, resolvedPath: result.resolvedPath };
          session.sync(latest); session.cancel(); targetChanged = false; externalError = ''; refresh();
        }
      }
    }
    if (result.kind === 'unchanged') { session.cancel(); targetChanged = false; refresh(); }
    renderResult(result.kind === 'commit' ? session.candidate() : result);
    return result;
  };
  const cancel = ({ notify = true, clearControllerError = false } = {}) => {
    const candidate = session.candidate();
    const cancellationTarget = session.isDirty() ? candidate.resolvedPath : latest.resolvedPath;
    focusedTarget = null; if (heldPointer !== null) retiredPointer = heldPointer; heldPointer = null; endRange(true, notify); stopHold(true, notify); session.cancel(); targetChanged = false; externalError = ''; needsAcceptance = false; rangeRejected = false; rejectionError = ''; refresh(true);
    if (clearControllerError) onCancelEdit(descriptor.path, cancellationTarget || latest.resolvedPath);
  };
  listen(range, 'pointerdown', event => { retiredPointer = null; heldPointer = event.pointerId; beginRange(); range.setPointerCapture?.(event.pointerId); sendRange('start'); });
  listen(range, 'keydown', () => { retiredPointer = null; });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(range, type, event => {
    if (heldPointer === event.pointerId) { heldPointer = null; endRange(type !== 'pointerup'); range.releasePointerCapture?.(event.pointerId); }
    if (retiredPointer === event.pointerId) retiredPointer = null;
  });
  if (descriptor.captureOnFocus) listen(number, 'focus', () => { focusedTarget ??= latest.resolvedPath; });
  listen(number, 'input', () => markInput(number.value));
  listen(number, 'blur', () => { finish(); if (!session.isDirty()) focusedTarget = null; });
  listen(number, 'change', () => finish());
  listen(number, 'keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); finish(); }
    else if (event.key === 'Escape' && (session.isDirty() || rangeGesture !== null || rangeRejected || needsAcceptance)) { event.preventDefault(); event.stopPropagation?.(); cancel({ clearControllerError: true }); }
  });
  listen(signButton, 'pointerdown', event => event.preventDefault?.());
  listen(signButton, 'click', event => {
    event.stopPropagation?.();
    sign *= -1;
    const raw = session.isDirty() ? pendingText : String(toDisplay(latest.value));
    const parsed = parseNumericText(raw);
    if (parsed.ok) number.value = String(Math.abs(parsed.value));
    markInput(number.value); showSign(); number.focus?.();
  });
  listen(range, 'input', () => {
    if (retiredPointer !== null) { configureRange(); return; }
    if (fineMode || rangeGesture) {
      const starting = !rangeGesture; const ticks = Number(range.value); beginRange();
      const candidate = fineMode ? ticks === 0 ? rangeGesture.base : rangeGesture.base + ticks * descriptor.fine : fromDisplay(ticks);
      sendRange(starting ? 'start' : 'update', candidate); return;
    }
    markInput(range.value, 1); if (number && !descriptor.commitOnChange) number.value = signed ? String(Math.abs(Number(range.value))) : range.value;
    if (!descriptor.commitOnChange) finish('range');
  });
  listen(range, 'change', () => { if (retiredPointer === null && heldPointer === null) { if (rangeGesture) endRange(); else finish('range'); } });
  listen(range, 'keydown', event => { if (event.key === 'Escape' && (session.isDirty() || rangeGesture !== null || rangeRejected || needsAcceptance)) { event.preventDefault?.(); event.stopPropagation?.(); cancel({ clearControllerError: true }); } });
  const selectSensitivity = (nextFineMode) => {
    if (heldPointer !== null || hold) return;
    if (fineMode === nextFineMode) return;
    endRange(); fineMode = nextFineMode; renderSensitivity(); configureRange(); showStep();
    onNudge(descriptor.path, 0, { phase: 'sensitivity' });
  };
  const finishBeforeNudge = () => {
    if (rangeGesture && heldPointer === null) endRange();
    const result = finish();
    return result.kind === 'commit' || result.kind === 'unchanged';
  };
  listen(fineSensitivity, 'click', () => selectSensitivity(true));
  listen(coarseSensitivity, 'click', () => selectSensitivity(false));
  listen(useLatest, 'click', event => { event.stopPropagation?.(); cancel({ clearControllerError: true }); });
  listen(useMine, 'click', event => { event.stopPropagation?.(); finish('number', true); });
  listen(cancelEdit, 'click', event => { event.stopPropagation?.(); cancel({ clearControllerError: true }); });
  for (const action of [useLatest, useMine, cancelEdit]) listen(action, 'pointerdown', event => event.preventDefault?.());
  if (!compact) for (const [nudge, direction] of [[fineMinus, -1], [finePlus, 1]]) {
    listen(nudge, 'click', event => {
      const suppressPointerClick = suppressNudgeClick && event.detail !== 0;
      suppressNudgeClick = false;
      if (suppressPointerClick) return;
      if (!finishBeforeNudge()) return;
      sendNudge(direction);
    });
    listen(nudge, 'pointerdown', event => {
      suppressNudgeClick = false;
      if (!finishBeforeNudge()) { suppressNudgeClick = true; event.preventDefault?.(); return; }
      nudge.setPointerCapture?.(event.pointerId);
      const active = { button: nudge, direction, pointer: event.pointerId, id: gestureId(), count: 0, acceptedCount: 0 }; hold = active;
      const tick = () => {
        active.count++;
        if (sendNudge(direction, { phase: active.count === 1 ? 'start' : 'update', gestureId: active.id, count: active.count })) { active.acceptedCount = active.count; return true; }
        clearInterval(active.repeat); return false;
      };
      active.timer = setTimeout(() => { if (tick()) active.repeat = setInterval(tick, 100); }, 350);
    });
    for (const terminal of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(nudge, terminal, event => { if (hold?.pointer === event.pointerId) stopHold(terminal !== 'pointerup'); });
    listen(nudge, 'keydown', event => { if (event.key === 'Escape') { event.preventDefault?.(); stopHold(true); } });
  }
  return { wrap, range, number, value, error,
    update({ value: nextValue, resolvedPath = descriptor.path, error: nextError = '' }) {
      if (disposed) return;
      const resolvedChanged = latest.resolvedPath !== resolvedPath;
      if (focusedTarget !== null && focusedTarget !== resolvedPath && !session.isDirty()) markInput(String(toDisplay(latest.value)), sign);
      if (session.isDirty() && session.candidate().resolvedPath !== resolvedPath) targetChanged = true;
      latest = { value: nextValue, resolvedPath }; externalError = String(nextError || ''); session.sync(latest);
      if (!rangeGesture) configureRange();
      if (!session.isDirty()) refresh(resolvedChanged); else renderResult();
    },
    finish(inputKind, override) { if (rangeGesture && heldPointer === null) endRange(); return finish(inputKind, override); }, cancel, isPending: () => session.isDirty() || rangeGesture !== null || rangeRejected, isHeld: () => heldPointer !== null || hold !== null,
    dispose() { cancel(); retiredPointer = null; disposed = true; listeners.forEach(remove => remove()); },
  };
}
