// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { openClockLayoutEditor } from '../../frontend/src/projection-config/clock-layout-editor-dialog.js';
import { openNovaExplainerEditor } from '../../frontend/src/projection-config/nova-explainer-editor-dialog.js';
import { openSettlementNameEditor } from '../../frontend/src/projection-config/settlement-name-editor-dialog.js';
import { openRoadSignEditor } from '../../frontend/src/projection-config/road-sign-editor-dialog.js';
import { DEFAULT_PROJECTION_CONFIG } from '../../frontend/src/shared/projection-config-schema.js';
import { createRoadSign, emptyRoadSignSettings } from '../../frontend/src/shared/road-sign-settings.js';

vi.mock('../../frontend/src/projection-config/clock-layout-preview.js', () => ({ mountClockLayoutPreview: () => ({ setState() {}, destroy() {}, reload() {} }) }));
vi.mock('../../frontend/src/projection-config/settlement-name-preview.js', () => ({ mountSettlementNamePreview: () => ({ setState() {}, destroy() {}, reload() {} }) }));
vi.mock('../../frontend/src/projection-config/road-sign-preview.js', () => ({ mountRoadSignPreview: () => ({ setState() {}, dispose() {}, refresh() {} }) }));

const disposers = [];
afterEach(() => { disposers.splice(0).forEach(editor => editor.dispose()); document.body.replaceChildren(); });
function surface() {
  const header = document.createElement('header'), host = document.createElement('main');
  const save = document.createElement('button'); save.textContent = 'Save calibration'; header.append(save);
  document.body.append(header, host);
  return { header, host, document, presentation: 'panel', manageBeforeUnload: false };
}
function layoutClient() {
  return { getSlot: () => ({ status: 'Saved' }), getHydrationState: () => ({ status: 'Saved' }), subscribe: () => () => {}, getLegendLanguage: () => 'he' };
}
function assertPanel(rig, editor) {
  disposers.push(editor);
  expect(rig.host.querySelector('.config-content-editor')).not.toBeNull();
  expect(rig.host.querySelector('[aria-modal="true"]')).toBeNull();
  expect(rig.header.inert).not.toBe(true);
  expect(rig.host.querySelector('header').hidden).toBe(true);
}

test('clock panel mounts in the editor region and exposes Layout and Dimensions without trapping the header', () => {
  const rig = surface(); const editor = openClockLayoutEditor({ ...rig, nodeId: 'clock-projection', layoutClient: layoutClient() }); assertPanel(rig, editor);
  const dimensions = rig.host.querySelector('[data-editor-page="dimensions"]');
  expect(dimensions).not.toBeNull(); dimensions.click();
  expect(rig.host.querySelector('[data-editor-page-panel="dimensions"]').hidden).toBe(false);
  expect(rig.host.querySelector('[data-field="widthPct"]')).not.toBeNull();
  expect(rig.host.querySelector('[data-field="heightPct"]')).not.toBeNull();
  const width = rig.host.querySelector('[data-field="widthPct"]');
  width.value = ''; width.dispatchEvent(new Event('input', { bubbles: true }));
  rig.host.querySelector('[data-editor-page="layout"]').click();
  expect(rig.host.querySelector('[data-editor-page-panel="dimensions"]').hidden).toBe(false);
});
test('settlement panel retains position, text and connector settings in separate fitted pages', () => {
  const rig = surface(); const settingsClient = { getSnapshot: () => ({ settings: { style: { fontPx: 14, rotateDeg: 0 }, outputs: { left: {}, right: {} } } }), getTarget: () => ({ status: 'Saved', acknowledged: { x: 1, y: 2 } }), getHydrationState: () => ({ status: 'Saved' }), subscribe: () => () => {} };
  const editor = openSettlementNameEditor({ ...rig, settingsClient, catalog: { entries: [{ citycode: '1', text: 'Name' }] } }); assertPanel(rig, editor);
  for (const page of ['position', 'text', 'connector']) {
    const tab = rig.host.querySelector(`[data-editor-page="${page}"]`); expect(tab).not.toBeNull(); tab.click();
    expect(rig.host.querySelector(`[data-editor-page-panel="${page}"]`).hidden).toBe(false);
  }
  expect(rig.host.querySelector('[data-field="lineBreak"]')).not.toBeNull();
  expect(rig.host.querySelector('[data-action="reset-leader-origin"]')).not.toBeNull();
});
test('Nova panel keeps the header usable and retains both cameras and story positions', () => {
  const rig = surface(); assertPanel(rig, openNovaExplainerEditor({ ...rig, layoutClient: layoutClient() }));
  expect(rig.host.querySelector('[data-camera="wide"]')).not.toBeNull();
  expect(rig.host.querySelector('[data-field="leftPct"]')).not.toBeNull();
  expect(rig.host.querySelector('[data-action="nova-explainer-reset"]')).not.toBeNull();
});
test('road sign panel uses a bounded sign selector and fitted placement and style pages', () => {
  const rig = surface(), settings = emptyRoadSignSettings();
  settings.outputs.left = Array.from({ length: 64 }, (_, index) => createRoadSign({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, x: 500, y: 300 }));
  const settingsClient = { getState: () => ({ acknowledged: settings, status: 'Saved' }), subscribe: () => () => {}, hasUnsavedWork: () => false };
  const editor = openRoadSignEditor({ ...rig, settingsClient, getAppliedCalibration: () => ({ config: DEFAULT_PROJECTION_CONFIG, revision: 1 }) });
  assertPanel(rig, editor);
  expect(rig.host.querySelector('select[aria-label="Road 232 sign instances"]').options).toHaveLength(64);
  const style = rig.host.querySelector('[data-editor-page="style"]'); expect(style).not.toBeNull(); style.click();
  expect(rig.host.querySelector('[data-editor-page-panel="style"]').hidden).toBe(false);
  expect(rig.host.querySelector('[data-action="road-sign-leader"]')).not.toBeNull();
  style.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  editor.sync();
  expect(rig.host.querySelector('[data-editor-page="adjust"]').getAttribute('aria-selected')).toBe('true');
});
