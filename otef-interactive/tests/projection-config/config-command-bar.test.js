// @vitest-environment jsdom
const JSDOM = window.jsdom.constructor;
import { expect, test, vi } from 'vitest';
import { mountProjectionConfig } from '../../frontend/src/projection-config/config-controller.js';
import { DEFAULT_PROJECTION_CONFIG } from '../../frontend/src/shared/projection-config-schema.js';

import * as module from '../../frontend/src/projection-config/config-command-bar.js';
const snapshot = { presets: [{ id: 'original', name: 'Original', readOnly: true }, { id: 'desk', name: 'Desk' }, { id: 'other', name: 'Other' }], selectedPresetId: 'other' };

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
    for (const action of ['load', 'save']) expect(root.querySelector(`[data-action="${action}"]`).closest('details')).toBeNull();
    for (const action of ['revert', 'save-new']) expect(root.querySelector(`[data-action="${action}"]`).closest('[data-menu="presets"]')).toBeTruthy();
    for (const action of ['output-assign', 'output-open-both', 'output-close-both']) expect(root.querySelector(`[data-action="${action}"]`).closest(`[data-menu="displays"]`)).toBeTruthy();
    root.querySelector('[data-action="save"]').click();
    await vi.waitFor(() => expect(client.save).toHaveBeenCalledWith({ presetId: 'desk', name: 'Desk' }));
  } finally { api.dispose(); dom.close(); }
});

test('command bar exposes the extracted construction and state interface', () => {
  expect(module.createConfigCommandBar).toBeTypeOf('function');
});

test('two-row commands keep Load, Save, Live, Apply and categories direct while setup actions are disclosed', () => {
  const { window } = new JSDOM('<main></main>', { url: 'http://localhost' });
  const onAction = vi.fn(), onOutputAction = vi.fn();
  const bar = module.createConfigCommandBar({ document: window.document, onAction, onOutputAction });
  window.document.querySelector('main').append(bar.element);
  const presets = bar.element.querySelector('[data-menu="presets"]');
  const displays = bar.element.querySelector('[data-menu="displays"]');
  const tools = bar.element.querySelector('[data-menu="tools"]');
  for (const control of [bar.controls.presets, bar.controls.load, bar.controls.save, bar.controls.live, bar.controls.apply, bar.controls.workspaceNav]) {
    expect(control.closest('[data-menu]')).toBeNull();
  }
  for (const name of ['revert', 'saveNew', 'loadedPresetIdentity']) expect(bar.controls[name].closest('[data-menu="presets"]')).toBe(presets);
  for (const name of ['outputRefresh', 'outputIdentify', 'outputLeftDisplay', 'outputRightDisplay', 'outputAssign', 'outputOpenBoth', 'outputCloseBoth']) {
    expect(bar.controls[name].closest('[data-menu="displays"]')).toBe(displays);
  }
  expect(bar.controls.tools.closest('[data-menu="tools"]')).toBe(tools);
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
  for (const name of ['load', 'save', 'live', 'apply', 'presets']) expect(bar.controls[name].closest('details')).toBeNull();
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
  const { window } = new JSDOM('<main></main>');
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
  expect(bar.controls.outputCapabilityNotice.closest('details')).toBeNull();
  expect(bar.controls.actionError.hidden).toBe(false);
  expect(bar.controls.outputAssign.disabled).toBe(true);
  bar.dispose(); window.close();
});
