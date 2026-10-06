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
  const win = doc.defaultView;
  const controls = {};
  const listeners = [];
  const listen = (node, type, handler, options) => { node.addEventListener?.(type, handler, options); listeners.push(() => node.removeEventListener?.(type, handler, options)); };
  const button = (name, text, action = name) => (controls[name] = make(doc, 'button', { type: 'button', dataset: { action } }, text));
  const element = make(doc, 'header', { className: 'config-command-bar', ariaLabel: 'Projection calibration commands' });
  const primaryRow = make(doc, 'div', { className: 'config-command-row config-command-row-primary' });
  const pending = make(doc, 'div', { className: 'config-pending-preset' });
  const presetLabel = make(doc, 'label', { className: 'config-preset-select-label' });
  controls.presets = make(doc, 'select', { ariaLabel: 'Preset', title: 'Selection is pending until you choose Load' });
  presetLabel.append(make(doc, 'span', { className: 'config-preset-field-label' }, 'Pending preset'), controls.presets);
  controls.presets.setAttribute('aria-describedby', 'projection-loaded-preset-identity');
  pending.append(presetLabel, button('load', 'Load'), button('save', 'Save preset'));
  controls.presetsDisclosure = make(doc, 'details', { className: 'config-menu config-presets-menu', dataset: { menu: 'presets' } });
  controls.presetsSummary = make(doc, 'summary', {}, 'Presets');
  const presets = make(doc, 'div', { className: 'config-menu-content', ariaLabel: 'Preset actions' });
  controls.loadedPresetIdentity = make(doc, 'span', { id: 'projection-loaded-preset-identity', className: 'loaded-preset-identity' }, 'Loaded: unknown');
  const presetActions = make(doc, 'div', { className: 'config-preset-actions' });
  presetActions.append(button('revert', 'Revert'), button('saveNew', 'Save copy', 'save-new'), button('rename', 'Rename'));
  controls.toolsPresetContext = make(doc, 'p', { className: 'tools-preset-context' });
  controls.originalCheckpointGuidance = make(doc, 'p', { className: 'original-checkpoint-guidance', hidden: true });
  controls.saveCopyPanel = make(doc, 'div', { id: 'projection-save-copy', className: 'config-save-copy', role: 'dialog', ariaLabel: 'Save copy', hidden: true });
  controls.saveName = make(doc, 'input', { type: 'text', id: 'projection-preset-name', placeholder: 'Preset name', maxLength: 80, ariaLabel: 'Preset name' });
  const nameLabel = make(doc, 'label', { htmlFor: controls.saveName.id }, 'Copy name');
  controls.saveCopyPanel.append(nameLabel, controls.saveName, button('saveCopyConfirm', 'Save copy', 'save-copy-confirm'), button('saveCopyCancel', 'Cancel', 'save-copy-cancel'));
  controls.saveNew.setAttribute('aria-controls', controls.saveCopyPanel.id);
  controls.saveNew.setAttribute('aria-expanded', 'false');
  controls.renamePanel = make(doc, 'div', { id: 'projection-rename-preset', className: 'config-save-copy', role: 'dialog', ariaLabel: 'Rename loaded preset', hidden: true });
  controls.renameName = make(doc, 'input', { type: 'text', value: '', id: 'projection-rename-name', maxLength: 80, ariaLabel: 'New preset name' });
  controls.renamePanel.append(make(doc, 'label', { htmlFor: controls.renameName.id }, 'New name'), controls.renameName, button('renameConfirm', 'Rename preset', 'rename-confirm'), button('renameCancel', 'Cancel', 'rename-cancel'));
  controls.rename.setAttribute('aria-controls', controls.renamePanel.id);
  controls.rename.setAttribute('aria-expanded', 'false');
  presets.append(controls.loadedPresetIdentity, presetActions, controls.saveCopyPanel, controls.renamePanel, controls.toolsPresetContext, controls.originalCheckpointGuidance);
  controls.presetsDisclosure.append(controls.presetsSummary, presets);
  controls.displaysDisclosure = make(doc, 'details', { className: 'config-menu config-displays-menu', dataset: { menu: 'displays' } });
  controls.displaysSummary = make(doc, 'summary', {}, 'Displays');
  const displays = make(doc, 'div', { className: 'config-menu-content config-display-menu-content', ariaLabel: 'Output display setup' });
  const displayHeading = make(doc, 'div', { className: 'config-display-menu-heading' });
  displayHeading.append(make(doc, 'strong', {}, 'Display setup'), button('outputRefresh', 'Refresh', 'output-refresh'), button('outputIdentify', 'Identify', 'output-identify'));
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
  controls.outputStatus = make(doc, 'span', { className: 'output-launch-status' });
  displayActions.appendChild(controls.outputStatus);
  const orientationLabel = make(doc, 'label', { className: 'output-reverse-toggle' });
  controls.outputReverseModel = make(doc, 'input', { type: 'checkbox', ariaLabel: 'Reverse model 180°', dataset: { action: 'output-reverse-model' } });
  orientationLabel.append(controls.outputReverseModel, make(doc, 'span', {}, 'Reverse model 180°'));
  displays.append(displayHeading, displayActions, orientationLabel, make(doc, 'small', { className: 'output-orientation-help' }, 'Swap the halves and rotate both complete images 180°. Saved on this workstation; applies on the next Open.'));
  controls.displaysDisclosure.append(controls.displaysSummary, displays);
  controls.tools = make(doc, 'details', { className: 'config-menu config-tools', dataset: { menu: 'tools' } });
  controls.toolsSummary = make(doc, 'summary', {}, 'Tools');
  controls.toolsContent = make(doc, 'div', { className: 'config-menu-content config-tools-content' });
  controls.toolsAppliedSummary = make(doc, 'span', { className: 'tools-applied-summary' }, 'Outputs: pending');
  controls.applied = make(doc, 'section', { className: 'applied-status' });
  controls.appliedRows = make(doc, 'div', { className: 'applied-details' });
  controls.applied.appendChild(controls.appliedRows);
  controls.outputHandoff = make(doc, 'small', { className: 'output-launch-handoff' }, 'TD projectorWindows off → Open outputs; Close outputs → TD projectorWindows on. After reload, close old browser output windows before reopening.');
  controls.toolsContent.append(controls.toolsAppliedSummary, controls.applied, controls.outputHandoff, make(doc, 'small', { className: 'preset-scope-help' }, 'Presets include geometry and people-wall settings. Clock and settlement layouts save independently.'));
  controls.tools.append(controls.toolsSummary, controls.toolsContent);
  primaryRow.append(pending, controls.presetsDisclosure, controls.displaysDisclosure, controls.tools);
  const band = make(doc, 'div', { className: 'config-workspace-band' });
  controls.workspaceNav = make(doc, 'nav', { className: 'config-category-actions', ariaLabel: 'Workspace' });
  const commits = make(doc, 'div', { className: 'calibration-commit-controls' });
  controls.live = make(doc, 'input', { type: 'checkbox', id: 'projection-live', checked: true, ariaLabel: 'Live', dataset: { action: 'live' } });
  const liveLabel = make(doc, 'label', { htmlFor: controls.live.id, className: 'live-toggle' }, 'Live');
  liveLabel.prepend(controls.live);
  controls.applyLiveDescription = make(doc, 'span', { id: 'projection-apply-live-description', className: 'visually-hidden' });
  controls.live.setAttribute('aria-describedby', controls.applyLiveDescription.id);
  button('apply', 'Apply once'); controls.apply.setAttribute('aria-describedby', controls.applyLiveDescription.id);
  button('parameterUndo', 'Undo', 'parameter-undo').setAttribute('aria-label', 'Undo parameter');
  button('parameterRedo', 'Redo', 'parameter-redo').setAttribute('aria-label', 'Redo parameter');
  commits.append(controls.parameterUndo, controls.parameterRedo, liveLabel, controls.apply, controls.applyLiveDescription);
  band.append(controls.workspaceNav, commits);
  controls.operationStatus = make(doc, 'div', { className: 'config-operation-status', role: 'status' });
  controls.status = make(doc, 'span', { className: 'draft-status' });
  controls.saveStatus = make(doc, 'span', { className: 'config-save-status', hidden: true });
  controls.appliedSummary = make(doc, 'span', { className: 'applied-summary' }, 'Outputs: pending');
  controls.alerts = make(doc, 'section', { className: 'config-alerts', ariaLabel: 'Calibration warnings and errors' });
  for (const [name, className, role] of [['liveWarning', 'live-draft-warning', 'alert'], ['conflict', 'conflict-banner', 'alert'], ['actionError', 'action-error', 'alert'], ['connectionStatus', 'connection-status', 'status'], ['outputCapabilityNotice', 'output-capability-notice', 'status'], ['appliedFailure', 'applied-failure', 'alert']]) {
    controls[name] = make(doc, 'p', { className, role, hidden: true }); controls.alerts.appendChild(controls[name]);
  }
  controls.alerts.appendChild(button('retryHydration', 'Retry settings check', 'retry-hydration'));
  controls.reconciliation = make(doc, 'section', { className: 'warp-editor-reconciliation', dataset: { role: 'reconciliation-recovery' }, ariaLabel: 'Uncertain settings recovery', hidden: true });
  controls.reconciliationMessage = make(doc, 'p', { className: 'warp-editor-reconciliation-message', role: 'status', ariaLive: 'polite' });
  controls.reconciliationRetry = button('reconciliationRetry', 'Retry settings check', 'reconciliation-retry');
  controls.reconciliationKeepLocal = button('reconciliationKeepLocal', 'Keep local draft', 'reconciliation-keep-local');
  controls.reconciliationUseAccepted = button('reconciliationUseAccepted', 'Use accepted settings', 'reconciliation-use-accepted');
  controls.reconciliation.append(controls.reconciliationMessage, controls.reconciliationRetry, controls.reconciliationKeepLocal, controls.reconciliationUseAccepted);
  controls.shortStatus = make(doc, 'div', { className: 'config-short-status', role: 'status', ariaLive: 'polite' });
  controls.shortStatus.setAttribute('aria-live', 'polite');
  controls.shortStatus.append(controls.saveStatus, controls.appliedSummary);
  controls.operationStatus.append(controls.status, controls.alerts, controls.reconciliation);
  band.append(controls.shortStatus);
  element.append(primaryRow, band, controls.operationStatus);
  listen(doc, 'keydown', event => {
    if (event.key !== 'Escape') return;
    const activeMenu = doc.activeElement?.closest?.('[data-menu]');
    const openMenu = activeMenu?.open ? activeMenu : [controls.presetsDisclosure, controls.displaysDisclosure, controls.tools].find(menu => menu.open);
    if (!openMenu) return;
    event.preventDefault(); openMenu.open = false; openMenu.querySelector('summary')?.focus?.();
  });
  const menus = [controls.presetsDisclosure, controls.displaysDisclosure, controls.tools];
  const placeMenu = menu => {
    const content = menu.querySelector('.config-menu-content');
    if (!content) return;
    if (!menu.open || winWidth() > 700) { content.style.position = ''; content.style.left = ''; content.style.right = ''; content.style.top = ''; content.style.width = ''; content.style.maxHeight = ''; content.style.overflowY = ''; return; }
    const rect = menu.querySelector('summary')?.getBoundingClientRect?.();
    const width = Math.max(0, Math.min(320, winWidth() - 24));
    const left = Math.max(12, Math.min(rect?.left || 12, winWidth() - width - 12));
    const top = Math.max(8, (rect?.bottom || 100) + 4);
    Object.assign(content.style, { position: 'fixed', left: `${left}px`, right: 'auto', top: `${top}px`, width: `${width}px`, maxHeight: `calc(100dvh - ${top + 12}px)`, overflowY: 'auto' });
  };
  const winWidth = () => Number(win?.innerWidth || doc.documentElement?.clientWidth || 1024);
  for (const menu of menus) listen(menu, 'toggle', () => {
    if (menu.open) for (const other of menus) if (other !== menu) { other.open = false; placeMenu(other); }
    placeMenu(menu);
  });
  listen(win, 'resize', () => menus.forEach(placeMenu));
  listen(doc, 'pointerdown', event => {
    for (const menu of menus) {
      if (menu.open && !menu.contains?.(event.target)) { menu.open = false; placeMenu(menu); }
    }
  }, true);
  let overwriteName = '', copyNameEdited = false, lastLoadedPresetId = null, lastLoadedPresetLoadToken = null, lastLoadedPresetName = null, renameBlocked = true;
  let outputSelection = { left: '', right: '' }, outputScreensSignature = null, outputAssignmentsSignature = null;
  const showCopy = (show) => { controls.saveCopyPanel.hidden = !show; controls.saveNew.setAttribute('aria-expanded', String(show)); if (show) controls.saveName.focus?.(); else controls.saveNew.focus?.(); };
  const showRename = (show) => { controls.renamePanel.hidden = !show; controls.rename.setAttribute('aria-expanded', String(show)); if (show) { showCopy(false); controls.renameName.value = lastLoadedPresetName || ''; checkRename(); controls.renameName.focus?.(); controls.renameName.select?.(); } else controls.rename.focus?.(); };
  const checkRename = () => { const name = controls.renameName.value.trim(); controls.renameConfirm.disabled = renameBlocked || !name || name.length > 80 || name === lastLoadedPresetName; };
  listen(controls.rename, 'click', () => showRename(true));
  listen(controls.renameCancel, 'click', () => showRename(false));
  listen(controls.renameName, 'input', checkRename);
  listen(controls.renameConfirm, 'click', () => onAction('rename', controls.renameName.value.trim()));
  listen(controls.renamePanel, 'keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); showRename(false); }
    if (event.key === 'Enter' && event.target === controls.renameName && !controls.renameConfirm.disabled) { event.preventDefault(); controls.renameConfirm.click?.(); }
  });
  listen(controls.saveName, 'input', () => { copyNameEdited = true; });
  listen(controls.saveNew, 'click', () => { showRename(false); showCopy(true); });
  listen(controls.saveCopyCancel, 'click', () => showCopy(false));
  listen(controls.saveCopyPanel, 'keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); showCopy(false); }
    if (event.key === 'Enter' && event.target === controls.saveName && !controls.saveCopyConfirm.disabled) { event.preventDefault(); controls.saveCopyConfirm.click?.(); }
  });
  listen(controls.saveCopyConfirm, 'click', () => onAction('save-new', controls.saveName.value));
  for (const [name, action] of [['apply', 'apply'], ['revert', 'revert'], ['parameterUndo', 'parameter-undo'], ['parameterRedo', 'parameter-redo'], ['retryHydration', 'retry-hydration'], ['reconciliationRetry', 'reconciliation-retry'], ['reconciliationKeepLocal', 'reconciliation-keep-local'], ['reconciliationUseAccepted', 'reconciliation-use-accepted']]) listen(controls[name], 'click', () => onAction(action));
  listen(controls.live, 'change', () => onAction('live', controls.live.checked));
  listen(controls.save, 'click', () => onAction('save', overwriteName));
  listen(controls.load, 'click', () => onAction('load', controls.presets.value));
  listen(controls.presets, 'change', () => onAction('preset-select', controls.presets.value));
  for (const [name, action] of [['outputRefresh', 'refresh'], ['outputIdentify', 'identify'], ['outputOpenBoth', 'open'], ['outputCloseBoth', 'close']]) listen(controls[name], 'click', () => onOutputAction(action));
  listen(controls.outputAssign, 'click', () => onOutputAction('assign', { left: controls.outputLeftDisplay.value, right: controls.outputRightDisplay.value }));
  listen(controls.outputReverseModel, 'change', () => onOutputAction('reverse-model', controls.outputReverseModel.checked));
  for (const [side, name] of [['left', 'outputLeftDisplay'], ['right', 'outputRightDisplay']]) listen(controls[name], 'change', () => { outputSelection[side] = controls[name].value; });
  const update = ({ state = {}, parameterHistory = { undo: 0, redo: 0 }, errors = {}, conflict = '', statusText = '', draftDiffersFromAccepted = false, savePending = false, loadedPresetId = null, loadedPresetLoadToken = 0, statusRows = [], appliedSummary = 'Pending', outputState = {} } = {}) => {
    controls.live.checked = Boolean(state.live);
    controls.live.disabled = Boolean(state.reconciliation);
    controls.apply.disabled = Boolean(state.reconciliation);
    controls.parameterUndo.disabled = !parameterHistory.undo; controls.parameterRedo.disabled = !parameterHistory.redo;
    controls.applyLiveDescription.textContent = state.live ? 'Live on. Changes update automatically.' : 'Live off. Use Apply once, or Apply & save.';
    const dirtyLocalDraft = Boolean(state.hasLocalDraft || draftDiffersFromAccepted);
    controls.status.textContent = dirtyLocalDraft && !state.live ? `${statusText}. Changes have not reached the outputs. Apply or save before reload. Reloading discards this local draft.` : statusText;
    controls.save.textContent = draftDiffersFromAccepted ? 'Apply & save' : 'Save preset';
    controls.save.setAttribute('aria-label', draftDiffersFromAccepted ? 'Apply and save preset' : 'Save preset');
    controls.save.title = draftDiffersFromAccepted ? 'Apply & save preset' : 'Save preset';
    controls.saveStatus.textContent = statusText || (dirtyLocalDraft ? 'Unsaved changes' : 'Saved');
    controls.saveStatus.hidden = false;
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
    const reconciliation = state.reconciliation;
    controls.reconciliation.hidden = !reconciliation;
    controls.reconciliationMessage.textContent = reconciliation
      ? `${reconciliation.message || 'Review the uncertain settings write.'}${Number.isSafeInteger(state.snapshot?.revision) ? ` Current revision: ${state.snapshot.revision}.` : ''}${state.live ? ' Live remains on, with updates paused during recovery.' : ' Live is off.'}`
      : '';
    controls.reconciliationRetry.hidden = reconciliation?.status !== 'read-error';
    controls.reconciliationKeepLocal.hidden = controls.reconciliationUseAccepted.hidden = reconciliation?.status !== 'needs-choice';
    controls.status.hidden = !(dirtyLocalDraft && !state.live || conflict || state.hydrationError || state.hydrating || state.connected === false || savePending);
    const screens = Array.isArray(outputState.screens) ? [...outputState.screens].sort((a, b) => a.displayNumber - b.displayNumber) : [];
    const assignments = outputState.assignments || {};
    const unsupported = outputState.supported === false;
    controls.outputReverseModel.checked = Boolean(outputState.reverseModel);
    controls.outputReverseModel.disabled = unsupported;
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
    controls.save.disabled = Boolean(reconciliation || savePending || !loadedPreset || loadedPreset.readOnly);
    renameBlocked = controls.rename.disabled = controls.save.disabled;
    controls.renameName.disabled = Boolean(reconciliation || savePending); checkRename();
    controls.saveNew.disabled = Boolean(reconciliation || savePending); controls.saveCopyConfirm.disabled = Boolean(reconciliation || savePending);
    controls.load.disabled = controls.revert.disabled = Boolean(reconciliation || savePending);
    controls.originalCheckpointGuidance.hidden = !loadedPreset?.readOnly;
    controls.originalCheckpointGuidance.textContent = loadedPreset?.readOnly ? `${loadedPreset.name || 'Loaded preset'} is immutable. Use Save copy.` : '';
    if (loadedPreset && (loadedPresetId !== lastLoadedPresetId || loadedPresetLoadToken !== lastLoadedPresetLoadToken || loadedPreset.name !== lastLoadedPresetName)) {
      const explicitLoad = lastLoadedPresetLoadToken !== null && loadedPresetLoadToken !== lastLoadedPresetLoadToken;
      overwriteName = loadedPreset.name || '';
      if (!copyNameEdited || explicitLoad) controls.saveName.value = overwriteName;
      if (explicitLoad) copyNameEdited = false;
      if (!controls.renamePanel.hidden) showRename(false);
      lastLoadedPresetId = loadedPresetId; lastLoadedPresetLoadToken = loadedPresetLoadToken;
      lastLoadedPresetName = loadedPreset.name; checkRename();
    }
    const outputAcknowledgement = `Outputs: ${({ Applied: 'applied', Pending: 'pending', Failed: 'failed', Unconfirmed: 'unconfirmed' }[appliedSummary] || String(appliedSummary).toLowerCase())}`;
    controls.appliedSummary.textContent = outputAcknowledgement; controls.toolsAppliedSummary.textContent = outputAcknowledgement;
    const failures = statusRows.filter(row => row.success === false && row.instanceId).map(row => `${row.output[0].toUpperCase() + row.output.slice(1)} output: ${row.error || 'Application not confirmed'}`);
    controls.appliedFailure.textContent = failures.join(' · '); controls.appliedFailure.hidden = failures.length === 0;
    controls.appliedRows.replaceChildren(...statusRows.map(row => make(doc, 'p', { className: row.success ? 'applied' : 'not-confirmed' }, row.text)));
    controls.alerts.hidden = !(controls.liveWarning.hidden === false || conflict || visibleErrors.size || !controls.connectionStatus.hidden || unsupported || failures.length);
    controls.operationStatus.hidden = controls.status.hidden && controls.alerts.hidden && controls.reconciliation.hidden;
  };
  return { element, controls, update, setPresetName(value) { overwriteName = controls.saveName.value = String(value || ''); copyNameEdited = true; }, dispose() { listeners.forEach(remove => remove()); } };
}
