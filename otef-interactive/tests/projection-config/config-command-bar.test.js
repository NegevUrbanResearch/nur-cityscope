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
    for (const action of ['load', 'revert', 'save', 'save-new', 'output-assign', 'output-open-both', 'output-close-both']) {
      const control = root.querySelector(`[data-action="${action}"]`);
      expect(control.closest('details')).toBeNull(); expect(control.closest('[hidden]')).toBeNull();
    }
    root.querySelector('[data-action="save"]').click();
    await vi.waitFor(() => expect(client.save).toHaveBeenCalledWith({ presetId: 'desk', name: 'Desk' }));
  } finally { api.dispose(); dom.close(); }
});

test('command bar exposes the extracted construction and state interface', () => {
  expect(module.createConfigCommandBar).toBeTypeOf('function');
});

test('direct commands preserve loaded identity and open one accessible Save copy name entry', () => {
  expect(module.createConfigCommandBar).toBeTypeOf('function');
  const { window } = new JSDOM('<main></main>');
  const onAction = vi.fn();
  const bar = module.createConfigCommandBar({ document: window.document, onAction });
  window.document.querySelector('main').append(bar.element);
  bar.update({ state: { snapshot, live: true }, loadedPresetId: 'desk' });
  for (const name of ['load', 'revert', 'save', 'saveNew', 'outputLeftDisplay', 'outputRightDisplay', 'outputAssign', 'outputOpenBoth', 'outputCloseBoth']) {
    expect(bar.controls[name].closest('details')).toBeNull();
    expect(bar.controls[name].closest('[hidden]')).toBeNull();
  }
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
  expect(bar.controls.outputCapabilityNotice.hidden).toBe(false);
  expect(bar.controls.outputCapabilityNotice.closest('details')).toBeNull();
  expect(bar.controls.actionError.hidden).toBe(false);
  expect(bar.controls.outputAssign.disabled).toBe(true);
  bar.dispose(); window.close();
});
