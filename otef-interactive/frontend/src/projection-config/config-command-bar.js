function make(doc, tag, props = {}, text = '') {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'ariaLabel') node.setAttribute('aria-label', value);
    else node[key] = value;
  }
  if (text) node.textContent = text;
  return node;
}

export function createConfigCommandBar({ document: doc, onAction = () => {}, onOutputAction = () => {} }) {
  const controls = {};
  const listeners = [];
  const listen = (node, type, handler, options) => { node.addEventListener?.(type, handler, options); listeners.push(() => node.removeEventListener?.(type, handler, options)); };
  const button = (name, text, action = name) => (controls[name] = make(doc, 'button', { type: 'button', dataset: { action } }, text));
  const element = make(doc, 'header', { className: 'config-command-bar', ariaLabel: 'Projection calibration commands' });
  const groups = make(doc, 'div', { className: 'config-command-groups' });
  const presets = make(doc, 'section', { className: 'preset-commands', ariaLabel: 'Presets' });
  const displays = make(doc, 'section', { className: 'display-commands', ariaLabel: 'Output displays' });
  const presetHeading = make(doc, 'div', { className: 'config-command-heading' });
  controls.loadedPresetIdentity = make(doc, 'span', { id: 'projection-loaded-preset-identity', className: 'loaded-preset-identity' }, 'Loaded: unknown');
  presetHeading.append(make(doc, 'h2', {}, 'Presets'), controls.loadedPresetIdentity);
  const presetActions = make(doc, 'div', { className: 'config-preset-actions' });
  controls.presets = make(doc, 'select', { ariaLabel: 'Preset', title: 'Selection is pending until you choose Load' });
  controls.presets.setAttribute('aria-describedby', 'projection-loaded-preset-identity');
  const presetLabel = make(doc, 'label', { className: 'config-preset-select-label' });
  presetLabel.append(make(doc, 'span', { className: 'config-preset-field-label' }, 'Pending preset'), controls.presets);
  presetActions.append(presetLabel, button('load', 'Load'), button('revert', 'Revert'), button('save', 'Save preset'), button('saveNew', 'Save copy', 'save-new'));
  controls.toolsPresetContext = make(doc, 'p', { className: 'tools-preset-context' });
  controls.originalCheckpointGuidance = make(doc, 'p', { className: 'original-checkpoint-guidance', hidden: true });
  controls.saveCopyPanel = make(doc, 'div', { id: 'projection-save-copy', className: 'config-save-copy', role: 'dialog', ariaLabel: 'Save copy', hidden: true });
  controls.saveName = make(doc, 'input', { type: 'text', id: 'projection-preset-name', placeholder: 'Preset name', maxLength: 80, ariaLabel: 'Preset name' });
  const nameLabel = make(doc, 'label', { htmlFor: controls.saveName.id }, 'Copy name');
  controls.saveCopyPanel.append(nameLabel, controls.saveName, button('saveCopyConfirm', 'Save copy', 'save-copy-confirm'), button('saveCopyCancel', 'Cancel', 'save-copy-cancel'));
  controls.saveNew.setAttribute('aria-controls', controls.saveCopyPanel.id);
  controls.saveNew.setAttribute('aria-expanded', 'false');
  const presetDetails = make(doc, 'div', { className: 'config-preset-details' });
  presetDetails.append(controls.saveCopyPanel, controls.toolsPresetContext, controls.originalCheckpointGuidance);
  presets.append(presetHeading, presetActions, presetDetails);
  const displayHeading = make(doc, 'div', { className: 'config-command-heading' });
  displayHeading.append(make(doc, 'h2', {}, 'Output displays'), button('outputRefresh', 'Refresh', 'output-refresh'), button('outputIdentify', 'Identify', 'output-identify'));
  const displayActions = make(doc, 'div', { className: 'config-display-actions' });
  for (const [side, name] of [['Left', 'outputLeftDisplay'], ['Right', 'outputRightDisplay']]) {
    const label = make(doc, 'label', { className: 'output-display-label' }, side);
    controls[name] = make(doc, 'select', { ariaLabel: `${side} projector display`, dataset: { action: `output-${side.toLowerCase()}-display` } });
    label.appendChild(controls[name]); displayActions.appendChild(label);
  }
  const displayButtons = make(doc, 'div', { className: 'output-command-actions' });
  displayButtons.append(button('outputAssign', 'Assign', 'output-assign'), button('outputOpenBoth', 'Open', 'output-open-both'), button('outputCloseBoth', 'Close', 'output-close-both'));
  controls.outputOpenBoth.setAttribute('aria-label', 'Open both outputs');
  controls.outputCloseBoth.setAttribute('aria-label', 'Close both outputs');
  displayActions.appendChild(displayButtons);
  displays.append(displayHeading, displayActions);
  groups.append(presets, displays);
  const band = make(doc, 'div', { className: 'config-workspace-band' });
  controls.workspaceNav = make(doc, 'nav', { className: 'config-category-actions', ariaLabel: 'Workspace' });
  const commits = make(doc, 'div', { className: 'calibration-commit-controls' });
  controls.live = make(doc, 'input', { type: 'checkbox', id: 'projection-live', checked: true, ariaLabel: 'Live', dataset: { action: 'live' } });
  const liveLabel = make(doc, 'label', { htmlFor: controls.live.id, className: 'live-toggle' }, 'Live');
  liveLabel.prepend(controls.live);
  controls.applyLiveDescription = make(doc, 'span', { id: 'projection-apply-live-description', className: 'visually-hidden' });
  controls.live.setAttribute('aria-describedby', controls.applyLiveDescription.id);
  button('apply', 'Apply once'); controls.apply.setAttribute('aria-describedby', controls.applyLiveDescription.id);
  commits.append(button('parameterUndo', 'Undo parameter', 'parameter-undo'), button('parameterRedo', 'Redo parameter', 'parameter-redo'), liveLabel, controls.apply, controls.applyLiveDescription);
  controls.tools = make(doc, 'details', { className: 'config-tools' });
  controls.toolsSummary = make(doc, 'summary', {}, 'Tools');
  controls.toolsContent = make(doc, 'div', { className: 'config-tools-content' });
  controls.toolsAppliedSummary = make(doc, 'span', { className: 'tools-applied-summary' }, 'Outputs: pending');
  controls.applied = make(doc, 'section', { className: 'applied-status' });
  controls.appliedRows = make(doc, 'div', { className: 'applied-details' });
  controls.applied.appendChild(controls.appliedRows);
  controls.outputHandoff = make(doc, 'small', { className: 'output-launch-handoff' }, 'TD projectorWindows off → Open outputs; Close outputs → TD projectorWindows on. After reload, close old browser output windows before reopening.');
  controls.toolsContent.append(controls.toolsAppliedSummary, controls.applied, controls.outputHandoff, make(doc, 'small', { className: 'preset-scope-help' }, 'Presets include geometry and people-wall settings. Clock and settlement layouts save independently.'));
  controls.tools.append(controls.toolsSummary, controls.toolsContent);
  band.append(controls.workspaceNav, commits, controls.tools);
  controls.operationStatus = make(doc, 'div', { className: 'config-operation-status', role: 'status' });
  controls.status = make(doc, 'span', { className: 'draft-status' });
  controls.saveStatus = make(doc, 'span', { className: 'config-save-status', hidden: true });
  controls.appliedSummary = make(doc, 'span', { className: 'applied-summary' }, 'Outputs: pending');
  controls.outputStatus = make(doc, 'span', { className: 'output-launch-status' });
  controls.alerts = make(doc, 'section', { className: 'config-alerts', ariaLabel: 'Calibration warnings and errors' });
  for (const [name, className, role] of [['liveWarning', 'live-draft-warning', 'alert'], ['conflict', 'conflict-banner', 'alert'], ['actionError', 'action-error', 'alert'], ['connectionStatus', 'connection-status', 'status'], ['outputCapabilityNotice', 'output-capability-notice', 'status'], ['appliedFailure', 'applied-failure', 'alert']]) {
    controls[name] = make(doc, 'p', { className, role, hidden: true }); controls.alerts.appendChild(controls[name]);
  }
  controls.alerts.appendChild(button('retryHydration', 'Retry settings check', 'retry-hydration'));
  controls.operationStatus.append(controls.status, controls.saveStatus, controls.appliedSummary, controls.outputStatus, controls.alerts);
  element.append(groups, band, controls.operationStatus);
  listen(doc, 'keydown', event => {
    if (event.key !== 'Escape' || !controls.tools.open) return;
    event.preventDefault(); controls.tools.open = false; controls.toolsSummary.focus?.();
  });
  listen(doc, 'pointerdown', event => {
    if (controls.tools.open && !controls.tools.contains?.(event.target)) controls.tools.open = false;
  }, true);
  let presetNameEdited = false, lastLoadedPresetId = null, lastLoadedPresetLoadToken = null;
  let outputSelection = { left: '', right: '' }, outputScreensSignature = null, outputAssignmentsSignature = null;
  const showCopy = (show) => { controls.saveCopyPanel.hidden = !show; controls.saveNew.setAttribute('aria-expanded', String(show)); if (show) controls.saveName.focus?.(); else controls.saveNew.focus?.(); };
  listen(controls.saveName, 'input', () => { presetNameEdited = true; });
  listen(controls.saveNew, 'click', () => showCopy(true));
  listen(controls.saveCopyCancel, 'click', () => showCopy(false));
  listen(controls.saveCopyPanel, 'keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); showCopy(false); }
    if (event.key === 'Enter' && event.target === controls.saveName && !controls.saveCopyConfirm.disabled) { event.preventDefault(); controls.saveCopyConfirm.click?.(); }
  });
  listen(controls.saveCopyConfirm, 'click', () => onAction('save-new', controls.saveName.value));
  for (const [name, action] of [['apply', 'apply'], ['revert', 'revert'], ['parameterUndo', 'parameter-undo'], ['parameterRedo', 'parameter-redo'], ['retryHydration', 'retry-hydration']]) listen(controls[name], 'click', () => onAction(action));
  listen(controls.live, 'change', () => onAction('live', controls.live.checked));
  listen(controls.save, 'click', () => onAction('save', controls.saveName.value));
  listen(controls.load, 'click', () => onAction('load', controls.presets.value));
  listen(controls.presets, 'change', () => onAction('preset-select', controls.presets.value));
  for (const [name, action] of [['outputRefresh', 'refresh'], ['outputIdentify', 'identify'], ['outputOpenBoth', 'open'], ['outputCloseBoth', 'close']]) listen(controls[name], 'click', () => onOutputAction(action));
  listen(controls.outputAssign, 'click', () => onOutputAction('assign', { left: controls.outputLeftDisplay.value, right: controls.outputRightDisplay.value }));
  for (const [side, name] of [['left', 'outputLeftDisplay'], ['right', 'outputRightDisplay']]) listen(controls[name], 'change', () => { outputSelection[side] = controls[name].value; });
  const update = ({ state = {}, parameterHistory = { undo: 0, redo: 0 }, errors = {}, conflict = '', statusText = '', draftDiffersFromAccepted = false, savePending = false, loadedPresetId = null, loadedPresetLoadToken = 0, statusRows = [], appliedSummary = 'Pending', outputState = {} } = {}) => {
    controls.live.checked = Boolean(state.live);
    controls.parameterUndo.disabled = !parameterHistory.undo; controls.parameterRedo.disabled = !parameterHistory.redo;
    controls.applyLiveDescription.textContent = state.live ? 'Live on. Changes update automatically.' : 'Live off. Use Apply once, or Apply & save.';
    const dirtyLocalDraft = Boolean(state.hasLocalDraft || draftDiffersFromAccepted);
    controls.status.textContent = dirtyLocalDraft && !state.live ? `${statusText}. Changes have not reached the outputs. Apply or save before reload. Reloading discards this local draft.` : statusText;
    controls.save.textContent = draftDiffersFromAccepted ? 'Apply & save' : 'Save preset';
    controls.save.setAttribute('aria-label', draftDiffersFromAccepted ? 'Apply and save preset' : 'Save preset');
    controls.save.title = draftDiffersFromAccepted ? 'Apply & save preset' : 'Save preset';
    controls.saveStatus.textContent = statusText || (dirtyLocalDraft ? 'Unsaved changes' : '');
    controls.liveWarning.textContent = dirtyLocalDraft && !state.live ? controls.status.textContent : '';
    controls.liveWarning.hidden = !(dirtyLocalDraft && !state.live);
    controls.conflict.textContent = conflict; controls.conflict.hidden = !conflict;
    const visibleErrors = new Map();
    for (const [section, message] of [['Preset management', errors.preset || errors.name], ['Display setup', outputState.error || errors.outputs || errors.output], ['Calibration action', errors.action], ['Output preview', state.previewError]]) {
      if (message && !visibleErrors.has(String(message))) visibleErrors.set(String(message), `${section}: ${message}`);
    }
    controls.actionError.textContent = [...visibleErrors.values()].join(' · '); controls.actionError.hidden = !visibleErrors.size;
    controls.connectionStatus.textContent = state.hydrationError ? `Settings check failed: ${state.hydrationError}` : state.hydrating ? 'Connecting to current settings…' : state.connected === false ? 'Disconnected from current settings. Live remains off until settings are reconciled.' : '';
    controls.connectionStatus.hidden = !state.hydrating && !state.hydrationError && state.connected !== false;
    controls.retryHydration.hidden = !state.hydrationError;
    const screens = Array.isArray(outputState.screens) ? [...outputState.screens].sort((a, b) => a.displayNumber - b.displayNumber) : [];
    const assignments = outputState.assignments || {};
    const unsupported = outputState.supported === false;
    controls.outputIdentify.disabled = unsupported || screens.length === 0;
    for (const name of ['outputRefresh', 'outputAssign', 'outputLeftDisplay', 'outputRightDisplay', 'outputOpenBoth', 'outputCloseBoth']) controls[name].disabled = unsupported;
    const selectedKey = assignment => screens.find(screen => assignment?.key === screen.key || (assignment?.label === screen.label && ['left', 'top', 'width', 'height'].every(key => Number(assignment?.bounds?.[key]) === Number(screen[key]))))?.key || '';
    const screensSignature = screens.map(screen => screen.key).join('|'), assignmentsSignature = JSON.stringify(assignments);
    if (screensSignature !== outputScreensSignature || assignmentsSignature !== outputAssignmentsSignature) outputSelection = { left: selectedKey(assignments.left), right: selectedKey(assignments.right) };
    outputScreensSignature = screensSignature; outputAssignmentsSignature = assignmentsSignature;
    for (const [name, side] of [['outputLeftDisplay', 'left'], ['outputRightDisplay', 'right']]) {
      controls[name].replaceChildren(...screens.map(screen => make(doc, 'option', { value: screen.key }, `Display ${screen.displayNumber}${screen.label ? ` · ${screen.label}` : ''}`)));
      controls[name].value = outputSelection[side]; controls[name].title = screens.find(screen => screen.key === controls[name].value)?.label || '';
    }
    const capabilityMessage = 'Open/close outputs on the workstation; this browser does not support display management.';
    controls.outputCapabilityNotice.textContent = capabilityMessage; controls.outputCapabilityNotice.hidden = !unsupported;
    controls.outputStatus.textContent = unsupported ? '' : outputState.message || 'Identify displays on the workstation.';
    const availablePresets = state.snapshot?.presets || [], selectedPreset = state.selectedPresetId || state.snapshot?.selectedPresetId || 'original';
    controls.presets.replaceChildren(...availablePresets.map(preset => make(doc, 'option', { value: preset.id }, preset.name))); controls.presets.value = selectedPreset;
    const loadedPreset = availablePresets.find(preset => preset.id === loadedPresetId);
    controls.loadedPresetIdentity.textContent = `Loaded: ${loadedPreset?.name || 'unknown'}`; controls.loadedPresetIdentity.title = controls.loadedPresetIdentity.textContent;
    const selectedPresetName = availablePresets.find(preset => preset.id === selectedPreset)?.name || 'unknown';
    controls.presets.title = `${selectedPresetName}. Choose Load to apply this preset.`;
    controls.toolsPresetContext.textContent = loadedPresetId !== selectedPreset ? `Selected: ${selectedPresetName}. Choose Load to apply.` : '';
    controls.toolsPresetContext.hidden = !controls.toolsPresetContext.textContent;
    controls.save.disabled = Boolean(savePending || !loadedPreset || loadedPreset.readOnly);
    controls.saveNew.disabled = Boolean(savePending); controls.saveCopyConfirm.disabled = Boolean(savePending);
    controls.originalCheckpointGuidance.hidden = !loadedPreset?.readOnly;
    controls.originalCheckpointGuidance.textContent = loadedPreset?.readOnly ? `${loadedPreset.name || 'Loaded preset'} is immutable. Use Save copy.` : '';
    if (loadedPreset && (loadedPresetId !== lastLoadedPresetId || loadedPresetLoadToken !== lastLoadedPresetLoadToken)) {
      const explicitLoad = lastLoadedPresetLoadToken !== null && loadedPresetLoadToken !== lastLoadedPresetLoadToken;
      if (!presetNameEdited || explicitLoad) controls.saveName.value = loadedPreset.name || '';
      if (explicitLoad) presetNameEdited = false;
      lastLoadedPresetId = loadedPresetId; lastLoadedPresetLoadToken = loadedPresetLoadToken;
    }
    const outputAcknowledgement = `Outputs: ${({ Applied: 'applied', Pending: 'pending', Failed: 'failed', Unconfirmed: 'unconfirmed' }[appliedSummary] || String(appliedSummary).toLowerCase())}`;
    controls.appliedSummary.textContent = outputAcknowledgement; controls.toolsAppliedSummary.textContent = outputAcknowledgement;
    const failures = statusRows.filter(row => row.success === false && row.instanceId).map(row => `${row.output[0].toUpperCase() + row.output.slice(1)} output: ${row.error || 'Application not confirmed'}`);
    controls.appliedFailure.textContent = failures.join(' · '); controls.appliedFailure.hidden = failures.length === 0;
    controls.appliedRows.replaceChildren(...statusRows.map(row => make(doc, 'p', { className: row.success ? 'applied' : 'not-confirmed' }, row.text)));
    controls.alerts.hidden = !(controls.liveWarning.hidden === false || conflict || visibleErrors.size || !controls.connectionStatus.hidden || unsupported || failures.length);
  };
  return { element, controls, update, setPresetName(value) { controls.saveName.value = String(value || ''); presetNameEdited = true; }, dispose() { listeners.forEach(remove => remove()); } };
}
