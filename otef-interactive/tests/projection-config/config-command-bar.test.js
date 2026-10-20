// @vitest-environment jsdom
const JSDOM = window.jsdom.constructor;
import { expect, test, vi } from 'vitest';
import { mountProjectionConfig } from '../../frontend/src/projection-config/config-controller.js';
import { DEFAULT_PROJECTION_CONFIG } from '../../frontend/src/shared/projection-config-schema.js';

import * as module from '../../frontend/src/projection-config/config-command-bar.js';
import { createStaffRemotePanel } from '../../frontend/src/projection-config/staff-remote-panel.js';
const snapshot = { presets: [{ id: 'original', name: 'Original', readOnly: true }, { id: 'desk', name: 'Desk' }, { id: 'other', name: 'Other' }], selectedPresetId: 'other' };

test.each([
  ['Samsung Android tablet', 'Mozilla/5.0 (Linux; Android 13; SM-X200)', 'Linux armv8l', 5, true, true],
  ['iPad desktop user agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X)', 'MacIntel', 5, false, true],
  ['touch-only desktop-site tablet', 'Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64', 5, true, true],
  ['Windows touch desktop', 'Mozilla/5.0 (Windows NT 10.0)', 'Win32', 10, false, false],
])('Tablet management visibility follows %s capabilities', (_label, userAgent, platform, maxTouchPoints, coarse, hidden) => {
  const { window: dom } = new JSDOM('<main></main>', { url: 'http://localhost' });
  for (const [key, value] of Object.entries({ userAgent, platform, maxTouchPoints })) Object.defineProperty(dom.navigator, key, { value, configurable: true });
  dom.innerWidth = 600;
  dom.matchMedia = query => ({ matches: query.includes('coarse') || query.includes('hover: none') ? coarse : !coarse, addEventListener() {}, removeEventListener() {} });
  const staffRemotePanel = { summary: dom.document.createElement('section'), element: dom.document.createElement('section') };
  const bar = module.createConfigCommandBar({ document: dom.document, staffRemotePanel });
  expect(bar.controls.tabletDisclosure.hidden).toBe(hidden);
  bar.dispose(); dom.close();
});

test('rename targets the loaded preset and refreshes Save without replacing a typed copy name', () => {
  const { window: dom } = new JSDOM('<main></main>', { url: 'http://localhost' });
  const onAction = vi.fn();
  const bar = module.createConfigCommandBar({ document: dom.document, onAction });
  dom.document.querySelector('main').append(bar.element);
  bar.update({ state: { snapshot }, loadedPresetId: 'desk' });
  bar.controls.rename.click();
  expect(bar.controls.renameName.value).toBe('Desk');
  bar.controls.renameName.value = '   '; bar.controls.renameName.dispatchEvent(new dom.Event('input'));
  expect(bar.controls.renameConfirm.disabled).toBe(true);
  bar.controls.renameName.value = 'NLI setup'; bar.controls.renameName.dispatchEvent(new dom.Event('input'));
  bar.controls.renameConfirm.click();
  expect(onAction).toHaveBeenCalledWith('rename', 'NLI setup');
  bar.controls.saveName.value = 'My copy'; bar.controls.saveName.dispatchEvent(new dom.Event('input'));
  const renamed = structuredClone(snapshot); renamed.presets[1].name = 'NLI setup';
  bar.update({ state: { snapshot: renamed }, loadedPresetId: 'desk' });
  expect(bar.controls.renamePanel.hidden).toBe(true);
  expect(bar.controls.saveName.value).toBe('My copy');
  bar.controls.save.click();
  expect(onAction).toHaveBeenLastCalledWith('save', 'NLI setup');
  bar.update({ state: { snapshot }, loadedPresetId: 'original' });
  expect(bar.controls.rename.disabled).toBe(true);
  bar.dispose(); dom.close();
});

test('controller rename uses loaded identity while another preset selection is pending', async () => {
  const { window: dom } = new JSDOM('<main></main>', { url: 'http://localhost' });
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  const state = { live: false, connected: true, draft: config, snapshot: { revision: 1, config, ...snapshot, selectedPresetId: 'desk' } };
  const client = { getState: () => state, subscribe(fn) { fn(state); return () => {}; }, start: vi.fn(), stop: vi.fn(), rename: vi.fn(async () => state), save: vi.fn(), setValidateCandidate() {} };
  const root = dom.document.querySelector('main'); const api = mountProjectionConfig(root, { client });
  try {
    const select = root.querySelector('select[aria-label="Preset"]'); select.value = 'other'; select.dispatchEvent(new dom.Event('change'));
    root.querySelector('[data-action="rename"]').click();
    const input = root.querySelector('input[aria-label="New preset name"]'); input.value = 'NLI setup'; input.dispatchEvent(new dom.Event('input'));
    root.querySelector('[data-action="rename-confirm"]').click();
    await vi.waitFor(() => expect(client.rename).toHaveBeenCalledWith({ presetId: 'desk', name: 'NLI setup' }));
    expect(client.save).not.toHaveBeenCalled();
  } finally { api.dispose(); dom.close(); }
});

test('Rename uses the saved preset name after import and supports Escape and Enter', () => {
  const { window: dom } = new JSDOM('<main></main>', { url: 'http://localhost' });
  const onAction = vi.fn(); const bar = module.createConfigCommandBar({ document: dom.document, onAction });
  dom.document.querySelector('main').append(bar.element);
  bar.update({ state: { snapshot }, loadedPresetId: 'desk' });
  bar.setPresetName('Imported desk');
  bar.controls.rename.click();
  expect(bar.controls.renameName.value).toBe('Desk');
  bar.controls.renameName.value = 'Discard this';
  bar.controls.renameName.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(bar.controls.renamePanel.hidden).toBe(true); expect(onAction).not.toHaveBeenCalled();
  bar.controls.save.click(); expect(onAction).toHaveBeenLastCalledWith('save', 'Imported desk');
  bar.controls.rename.click(); bar.controls.renameName.value = 'NLI setup'; bar.controls.renameName.dispatchEvent(new dom.Event('input'));
  bar.controls.renameName.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(onAction).toHaveBeenLastCalledWith('rename', 'NLI setup');
  bar.dispose(); dom.close();
});

test('Displays offers independent lab and exhibit resolution choices', () => {
  const { window: dom } = new JSDOM('<main></main>', { url: 'http://localhost' });
  const onOutputAction = vi.fn();
  const bar = module.createConfigCommandBar({ document: dom.document, onOutputAction });
  bar.update({ outputState: { supported: true, resolutions: { left: '4k', right: '1080p' } } });
  const left = bar.element.querySelector('select[aria-label="Left output resolution"]');
  const right = bar.element.querySelector('select[aria-label="Right output resolution"]');
  expect(left?.value).toBe('4k'); expect(right?.value).toBe('1080p');
  expect(Array.from(left.options).map(option => option.textContent)).toEqual(['1080p · 1920 × 1080', '4K · 3840 × 2160']);
  left.value = '1080p'; left.dispatchEvent(new dom.Event('change'));
  expect(onOutputAction).toHaveBeenCalledWith('resolution', { side: 'left', resolution: '1080p' });
  expect(left.closest('[data-menu="displays"]')).toBeTruthy();
  bar.dispose();
});

test('Displays contains persisted reversal control with an explicit next-Open scope', () => {
  const { window: dom } = new JSDOM('<main></main>', { url: 'http://localhost' });
  const onOutputAction = vi.fn();
  const bar = module.createConfigCommandBar({ document: dom.document, onOutputAction });
  dom.document.querySelector('main').append(bar.element);
  const reverse = bar.element.querySelector('input[aria-label="Reverse model 180°"]');
  expect(reverse).not.toBeNull();
  expect(reverse.closest('[data-menu="displays"]')).toBeTruthy();
  bar.update({ outputState: { supported: true, reverseModel: true } });
  expect(reverse.checked).toBe(true);
  expect(bar.element.textContent).toMatch(/swap.*halves/i);
  expect(bar.element.textContent).toMatch(/next.*Open/i);
  reverse.checked = false; reverse.dispatchEvent(new dom.Event('change'));
  expect(onOutputAction).toHaveBeenCalledWith('reverse-model', false);
  bar.update({ outputState: { supported: false } });
  expect(reverse.disabled).toBe(true);
  bar.dispose(); dom.close();
});

test('jsdom view keeps direct commands visible while controller saves loaded ID rather than selected candidate', async () => {
  const { window: dom } = new JSDOM('<main></main>', { url: 'http://localhost' });
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  const state = { live: true, connected: true, draft: config, snapshot: { revision: 1, config, ...snapshot, selectedPresetId: 'desk' } };
  const client = {
    getState: () => state, subscribe(fn) { fn(state); return () => {}; }, start: vi.fn(), stop: vi.fn(),
    save: vi.fn(async () => state), setValidateCandidate() {},
  };
  const root = dom.document.querySelector('main');
  const api = mountProjectionConfig(root, { client });
  try {
    const select = root.querySelector('select[aria-label="Preset"]'); select.value = 'other'; select.dispatchEvent(new dom.Event('change'));
    expect(root.querySelector('[data-action="save"]').closest('details')).toBeNull();
    expect(root.querySelector('[data-action="load"]').closest('[data-menu="presets"]')).toBeTruthy();
    for (const action of ['revert', 'save-new']) expect(root.querySelector(`[data-action="${action}"]`).closest('[data-menu="presets"]')).toBeTruthy();
    for (const action of ['output-assign', 'output-open-both', 'output-close-both']) expect(root.querySelector(`[data-action="${action}"]`).closest(`[data-menu="displays"]`)).toBeTruthy();
    root.querySelector('[data-action="save"]').click();
    await vi.waitFor(() => expect(client.save).toHaveBeenCalledWith({ presetId: 'desk', name: 'Desk' }));
  } finally { api.dispose(); dom.close(); }
});

test('command bar exposes the extracted construction and state interface', () => {
  expect(module.createConfigCommandBar).toBeTypeOf('function');
});

test('one-row commands keep commits direct and place pending selection inside Presets', () => {
  const { window } = new JSDOM('<main></main>', { url: 'http://localhost' });
  const onAction = vi.fn(), onOutputAction = vi.fn();
  const bar = module.createConfigCommandBar({ document: window.document, onAction, onOutputAction });
  window.document.querySelector('main').append(bar.element);
  const presets = bar.element.querySelector('[data-menu="presets"]');
  const displays = bar.element.querySelector('[data-menu="displays"]');
  expect(bar.element.querySelector('[data-menu="tools"]')).toBeNull();
  expect(bar.element.querySelectorAll('.config-command-row')).toHaveLength(1);
  for (const control of [bar.controls.save, bar.controls.live, bar.controls.apply, bar.controls.parameterUndo, bar.controls.parameterRedo]) {
    expect(control.closest('[data-menu]')).toBeNull();
    expect(control.closest('.config-command-row')).not.toBeNull();
  }
  expect(bar.controls.workspaceNav.isConnected).toBe(false);
  for (const name of ['presets', 'load', 'revert', 'saveNew', 'loadedPresetIdentity']) expect(bar.controls[name].closest('[data-menu="presets"]')).toBe(presets);
  for (const name of ['outputRefresh', 'outputIdentify', 'outputLeftDisplay', 'outputRightDisplay', 'outputAssign', 'outputOpenBoth', 'outputCloseBoth']) {
    expect(bar.controls[name].closest('[data-menu="displays"]')).toBe(displays);
  }
  expect(bar.controls.parameterUndo.textContent).toBe('Undo');
  expect(bar.controls.parameterRedo.textContent).toBe('Redo');
  expect(bar.controls.outputOpenBoth.textContent).toBe('Open both');
  expect(bar.controls.outputCloseBoth.textContent).toBe('Close both');
  bar.update({ state: { snapshot, live: true }, loadedPresetId: 'desk' });
  expect(bar.controls.saveStatus.hidden).toBe(false);
  expect(bar.controls.shortStatus.getAttribute('role')).toBe('status');
  expect(bar.controls.shortStatus.getAttribute('aria-live')).toBe('polite');
  expect(bar.controls.operationStatus.hidden).toBe(true);
  bar.controls.presets.value = 'other'; bar.controls.presets.dispatchEvent(new window.Event('change'));
  bar.controls.load.click(); bar.controls.save.click(); bar.controls.live.checked = false; bar.controls.live.dispatchEvent(new window.Event('change'));
  bar.controls.apply.click(); bar.controls.workspaceNav.querySelectorAll('button').forEach(node => node.click());
  expect(onAction).toHaveBeenCalledWith('preset-select', 'other');
  expect(onAction).toHaveBeenCalledWith('load', 'other');
  expect(onAction).toHaveBeenCalledWith('save', 'Desk');
  expect(onAction).toHaveBeenCalledWith('live', false);
  expect(onAction).toHaveBeenCalledWith('apply');
  expect(presets.querySelector('[data-action="revert"]')).toBe(bar.controls.revert);
  expect(displays.querySelector('[data-action="output-assign"]')).toBe(bar.controls.outputAssign);
  const presetSummary = presets.querySelector('summary'); presetSummary.focus(); presets.open = true;
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(presets.open).toBe(false); expect(window.document.activeElement).toBe(presetSummary);
  displays.open = true;
  window.document.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
  expect(displays.open).toBe(false);
  bar.dispose(); window.close();
});

test('Escape closes the disclosure that owns focus even if another disclosure is also open', () => {
  const { window } = new JSDOM('<main></main>', { url: 'http://localhost' });
  const bar = module.createConfigCommandBar({ document: window.document });
  window.document.querySelector('main').append(bar.element);
  bar.controls.presetsDisclosure.open = true;
  bar.controls.displaysDisclosure.open = true;
  bar.controls.displaysSummary.focus();
  bar.element.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(bar.controls.displaysDisclosure.open).toBe(false);
  expect(bar.controls.presetsDisclosure.open).toBe(true);
  expect(window.document.activeElement).toBe(bar.controls.displaysSummary);
  bar.dispose(); window.close();
});

test('opening one disclosure closes the other command menus', async () => {
  const { window } = new JSDOM('<main></main>', { url: 'http://localhost' });
  const bar = module.createConfigCommandBar({ document: window.document });
  window.document.querySelector('main').append(bar.element);
  bar.controls.presetsSummary.click(); await new Promise(resolve => window.setTimeout(resolve, 0));
  expect(bar.controls.presetsDisclosure.open).toBe(true);
  bar.controls.displaysSummary.click(); await new Promise(resolve => window.setTimeout(resolve, 0));
  expect(bar.controls.displaysDisclosure.open).toBe(true);
  expect(bar.controls.presetsDisclosure.open).toBe(false);
  bar.dispose(); window.close();
});

test.each([['Cancel', 'Cancelled copy title'], ['Cancel', ''], ['Escape', 'Cancelled copy title'], ['Escape', '']])('%s copy name %j cannot rename or block direct Save', async (dismiss, name) => {
  const { window: dom } = new JSDOM('<main></main>', { url: 'http://localhost' });
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG); config.pre.tx = 0.012;
  const state = { live: false, connected: true, draft: config, snapshot: { revision: 1, config, ...snapshot, selectedPresetId: 'desk' } };
  const savedConfigs = [];
  const client = {
    getState: () => state, subscribe(fn) { fn(state); return () => {}; }, start: vi.fn(), stop: vi.fn(), setValidateCandidate() {},
    save: vi.fn(async () => { savedConfigs.push(structuredClone(state.draft)); return state; }),
  };
  const root = dom.document.querySelector('main'); const api = mountProjectionConfig(root, { client });
  try {
    const select = root.querySelector('select[aria-label="Preset"]'); select.value = 'other'; select.dispatchEvent(new dom.Event('change'));
    root.querySelector('[data-action="save-new"]').click();
    const input = root.querySelector('input[aria-label="Preset name"]'); input.value = name; input.dispatchEvent(new dom.Event('input', { bubbles: true }));
    if (dismiss === 'Cancel') root.querySelector('[data-action="save-copy-cancel"]').click();
    else input.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(input.closest('[role="dialog"]').hidden).toBe(true);
    expect(dom.document.activeElement).toBe(root.querySelector('[data-action="save-new"]'));
    expect(client.save).not.toHaveBeenCalled();
    root.querySelector('[data-action="save"]').click();
    await vi.waitFor(() => expect(client.save).toHaveBeenCalledWith({ presetId: 'desk', name: 'Desk' }));
    expect(savedConfigs).toEqual([config]);
  } finally { api.dispose(); dom.close(); }
});

test('direct commands preserve loaded identity and open one accessible Save copy name entry', () => {
  expect(module.createConfigCommandBar).toBeTypeOf('function');
  const { window } = new JSDOM('<main></main>');
  const onAction = vi.fn();
  const bar = module.createConfigCommandBar({ document: window.document, onAction });
  window.document.querySelector('main').append(bar.element);
  bar.update({ state: { snapshot, live: true }, loadedPresetId: 'desk' });
  for (const name of ['save', 'live', 'apply']) expect(bar.controls[name].closest('details')).toBeNull();
  for (const name of ['load', 'presets']) expect(bar.controls[name].closest('details')).toBe(bar.controls.presetsDisclosure);
  for (const name of ['revert', 'saveNew', 'loadedPresetIdentity']) expect(bar.controls[name].closest('[data-menu="presets"]')).toBe(bar.controls.presetsDisclosure);
  for (const name of ['outputLeftDisplay', 'outputRightDisplay', 'outputAssign', 'outputOpenBoth', 'outputCloseBoth']) expect(bar.controls[name].closest('[data-menu="displays"]')).toBe(bar.controls.displaysDisclosure);
  expect(bar.controls.presets.value).toBe('other');
  expect(bar.controls.loadedPresetIdentity.textContent).toBe('Loaded: Desk');
  bar.controls.save.click();
  expect(onAction).toHaveBeenLastCalledWith('save', 'Desk');
  bar.controls.saveNew.click();
  bar.controls.saveNew.click();
  expect(bar.element.querySelectorAll('input[aria-label="Preset name"]')).toHaveLength(1);
  expect(bar.controls.saveName.closest('[hidden]')).toBeNull();
  expect(bar.controls.saveName.closest('[role="dialog"]').getAttribute('aria-label')).toBe('Save copy');
  expect(window.document.activeElement).toBe(bar.controls.saveName);
  expect(onAction).toHaveBeenCalledTimes(1);
  bar.controls.saveName.value = 'Desk copy';
  bar.controls.saveCopyConfirm.click();
  expect(onAction).toHaveBeenLastCalledWith('save-new', 'Desk copy');
  bar.controls.tools.open = true;
  bar.controls.saveName.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(bar.controls.saveCopyPanel.hidden).toBe(true);
  expect(window.document.activeElement).toBe(bar.controls.saveNew);
  expect(bar.controls.tools.open).toBe(true);
  bar.update({ state: { snapshot }, loadedPresetId: 'original' });
  expect(bar.controls.save.disabled).toBe(true);
  expect(bar.controls.saveNew.disabled).toBe(false);
  bar.update({ state: { snapshot }, loadedPresetId: 'original', savePending: true });
  expect(bar.controls.save.disabled).toBe(true);
  expect(bar.controls.saveNew.disabled).toBe(true);
  expect(bar.controls.saveCopyConfirm.disabled).toBe(true);
  bar.dispose(); window.close();
});

test('display selection stays local until Assign and unsupported status is outside Tools', () => {
  expect(module.createConfigCommandBar).toBeTypeOf('function');
  const { window } = new JSDOM('<main></main>', { url: 'http://localhost' });
  const onOutputAction = vi.fn();
  const bar = module.createConfigCommandBar({ document: window.document, onOutputAction });
  const outputState = { supported: true, screens: [{ key: 'a', displayNumber: 1, label: 'A long projector display name' }, { key: 'b', displayNumber: 2 }] };
  bar.update({ outputState });
  bar.controls.outputLeftDisplay.value = 'a';
  bar.controls.outputLeftDisplay.dispatchEvent(new window.Event('change'));
  bar.controls.outputRightDisplay.value = 'b';
  bar.controls.outputRightDisplay.dispatchEvent(new window.Event('change'));
  bar.update({ outputState, statusText: 'Unrelated update' });
  expect(onOutputAction).not.toHaveBeenCalled();
  expect(bar.controls.outputLeftDisplay.value).toBe('a');
  bar.controls.outputAssign.click();
  expect(onOutputAction).toHaveBeenLastCalledWith('assign', { left: 'a', right: 'b' });
  for (const [name, action] of [['outputOpenBoth', 'open'], ['outputCloseBoth', 'close'], ['outputRefresh', 'refresh'], ['outputIdentify', 'identify']]) {
    bar.controls[name].click(); expect(onOutputAction).toHaveBeenLastCalledWith(action);
  }
  bar.update({ outputState: { supported: false }, errors: { action: 'Operation failed' } });
  expect(bar.controls.operationStatus.hidden).toBe(false);
  expect(bar.controls.alerts.hidden).toBe(false);
  expect(bar.controls.outputCapabilityNotice.hidden).toBe(false);
  expect(bar.controls.outputCapabilityNotice.closest('details')).toBe(bar.controls.displaysDisclosure);
  expect(bar.controls.actionError.hidden).toBe(false);
  expect(bar.controls.outputAssign.disabled).toBe(true);
  bar.dispose(); window.close();
});

test('Tablet keeps remote status, version, refresh and update actions reachable without diagnostic Tools', async () => {
  const { window } = new JSDOM('<main></main>', { url: 'http://localhost' });
  const remote = { remoteId: 'tablet', instanceId: 'tab', sessionId: 'Lab tablet', status: 'Online', version: 'frontend-current', ageMs: 1200, actionEnabled: true };
  const manager = {
    getState: () => ({ connectionStatus: 'Connected', remotes: [remote], sendEnabled: true }),
    subscribe: () => () => {}, refresh: vi.fn(), sendNotice: vi.fn(), reconcileUpdates: vi.fn(),
  };
  const staffRemotePanel = createStaffRemotePanel({ document: window.document, manager });
  const bar = module.createConfigCommandBar({ document: window.document, staffRemotePanel });
  window.document.querySelector('main').append(bar.element);
  const menu = bar.element.querySelector('[data-menu="tablet"]');
  expect(menu).not.toBeNull();
  expect(menu.contains(staffRemotePanel.summary)).toBe(true);
  expect(menu.contains(staffRemotePanel.element)).toBe(true);
  expect(menu.textContent).toContain('Online');
  expect(menu.textContent).toContain('frontend-current');
  expect(bar.element.querySelector('[data-menu="tools"]')).toBeNull();
  menu.querySelector('summary').click();
  await new Promise(resolve => window.setTimeout(resolve, 0));
  staffRemotePanel.element.querySelector('[aria-label="Refresh tablet Lab tablet"]').click();
  expect(manager.refresh).toHaveBeenCalledWith(remote);
  for (const [label, action] of [['Send update notice', 'sendNotice'], ['Reload tablet status', 'reconcileUpdates']]) {
    [...menu.querySelectorAll('button')].find(button => button.textContent === label).click();
    expect(manager[action]).toHaveBeenCalledOnce();
  }
  bar.controls.presetsSummary.click();
  await vi.waitFor(() => expect(menu.open).toBe(false));
  menu.open = true; menu.querySelector('summary').focus();
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(menu.open).toBe(false);
  expect(bar.controls.outputRefresh.closest('[data-menu="displays"]')).toBe(bar.controls.displaysDisclosure);
  staffRemotePanel.dispose(); bar.dispose(); window.close();
});

test('tablet can retry workstation discovery while display commands are unavailable', () => {
  const { window } = new JSDOM('<main></main>');
  const bar = module.createConfigCommandBar({ document: window.document });
  bar.update({ outputState: { supported: false, remoteControl: true, message: 'Keep config open on the workstation, then Refresh.' } });
  expect(bar.controls.outputRefresh.disabled).toBe(false);
  expect(bar.controls.outputOpenBoth.disabled).toBe(true);
  expect(bar.controls.outputCapabilityNotice.textContent).toBe('Keep config open on the workstation, then Refresh.');
  bar.dispose(); window.close();
});

test('routine Live-off draft and save status stay inside Presets while real failures remain actionable', () => {
  const { window } = new JSDOM('<main></main>');
  const bar = module.createConfigCommandBar({ document: window.document });
  window.document.querySelector('main').append(bar.element);
  const draft = { state: { snapshot, live: false, hasLocalDraft: true }, loadedPresetId: 'desk', draftDiffersFromAccepted: true, statusText: 'Local draft' };
  bar.update(draft);
  expect(bar.controls.operationStatus.hidden).toBe(true);
  expect(bar.controls.status.closest('[data-menu="presets"]')).toBe(bar.controls.presetsDisclosure);
  expect(bar.controls.status.textContent).toContain('Apply or save before reload');
  expect(bar.controls.presetsSummary.dataset.dirty).toBe('true');
  bar.update({ ...draft, savePending: true, statusText: 'Saving preset' });
  expect(bar.controls.operationStatus.hidden).toBe(true);
  bar.update({ ...draft, outputState: { supported: false, remoteControl: true } });
  expect(bar.controls.operationStatus.hidden).toBe(true);
  bar.update({ ...draft, errors: { action: 'Write rejected' } });
  expect(bar.controls.operationStatus.hidden).toBe(false);
  expect(bar.controls.actionError.hidden).toBe(false);
  bar.update({ ...draft, conflict: 'Settings changed elsewhere' });
  expect(bar.controls.operationStatus.hidden).toBe(false);
  expect(bar.controls.conflict.hidden).toBe(false);
  bar.update({ ...draft, state: { ...draft.state, reconciliation: { status: 'needs-choice', message: 'Review uncertain write' } } });
  expect(bar.controls.operationStatus.hidden).toBe(false);
  expect(bar.controls.reconciliationKeepLocal.hidden).toBe(false);
  expect(bar.controls.reconciliationUseAccepted.hidden).toBe(false);
  bar.dispose(); window.close();
});
