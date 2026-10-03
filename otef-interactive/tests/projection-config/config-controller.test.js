import { describe, expect, test, vi } from "vitest";
import { DEFAULT_PROJECTION_CONFIG as DEFAULTS } from "../../frontend/src/shared/projection-config-schema.js";
import { projectionPlacementInputIdentity } from "../../frontend/src/projection/projection-names-run.js";
import { createProjectionConfigClient } from "../../frontend/src/shared/projection-config-client.js";
import * as configView from "../../frontend/src/projection-config/config-view.js";
import { createIdentityProjectionMesh } from "../../frontend/src/shared/projection-warp-geometry.js";
import { sha256Hex } from "../../frontend/src/shared/sha256-hex.js";
import { projectionCatalog, deferred, response } from '../fixtures/projection-catalog.js';
import { createProjectionBaselineCatalogLoader } from '../../frontend/src/projection/projection-captured-baseline.js';
import {
  FIELD_DESCRIPTORS,
  NAMES_WALL_DESCRIPTORS,
  fieldValueFromInput,
  fineStepFor,
  mountProjectionConfig,
  projectionAppliedStatus,
  statusText,
} from "../../frontend/src/projection-config/config-controller.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

test('visible preset commands save the loaded preset while a different candidate is selected', async () => {
  const previousDocument = globalThis.document;
  globalThis.document = documentStub();
  const root = element('main');
  const client = fakeClient();
  client.getState().snapshot.presets.push({ id: 'desk', name: 'Desk', config: clone(DEFAULTS) }, { id: 'candidate', name: 'Candidate', config: clone(DEFAULTS) });
  client.getState().snapshot.selectedPresetId = 'desk';
  const api = mountProjectionConfig(root, { client });
  try {
    const action = name => find(root, node => node.dataset?.action === name);
    const presets = find(root, node => node.attributes?.['aria-label'] === 'Preset');
    presets.value = 'candidate'; presets.dispatch('change');
    for (const action of ['load', 'revert', 'save', 'save-new', 'output-assign', 'output-open-both', 'output-close-both']) {
      for (let node = find(root, node => node.dataset?.action === action); node; node = node.parentElement) expect(node.tagName).not.toBe('DETAILS');
    }
    action('save').dispatch('click');
    await vi.waitFor(() => expect(client.save).toHaveBeenCalledWith(expect.objectContaining({ presetId: 'desk', name: 'Desk' })));
    await api.handleAction('load', 'original');
    expect(action('save').disabled).toBe(true);
    action('save-new').dispatch('click');
    expect(find(root, node => node.className === 'config-save-copy').hidden).toBe(false);
  } finally { api.dispose(); globalThis.document = previousDocument; }
});

function element(tag = "div") {
  return {
    tagName: tag.toUpperCase(), children: [], attributes: {}, dataset: {}, style: {},
    textContent: "", value: "", checked: false, disabled: false,
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
    append(...children) { children.forEach((child) => this.appendChild(child)); },
    prepend(...children) { this.children.unshift(...children); },
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this); },
    replaceChildren(...children) { this.children = []; children.forEach((child) => this.appendChild(child)); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(type, handler) { this.listeners ||= {}; (this.listeners[type] ||= []).push(handler); },
    removeEventListener(type, handler) { if (this.listeners?.[type]) this.listeners[type] = this.listeners[type].filter((item) => item !== handler); },
    dispatch(type, detail = {}) { for (const handler of this.listeners?.[type] || []) handler({ currentTarget: this, target: this, ...detail }); },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    classList: { toggle() {}, add() {} },
    focus() {},
  };
}

function documentStub({ coarse = false, noHover = false } = {}) {
  return {
    activeElement: null,
    listeners: {},
    captureListeners: {},
    addEventListener(type, handler, options) { const target = options === true || options?.capture ? this.captureListeners : this.listeners; (target[type] ||= []).push(handler); },
    removeEventListener(type, handler) { this.listeners[type] = (this.listeners[type] || []).filter((item) => item !== handler); this.captureListeners[type] = (this.captureListeners[type] || []).filter((item) => item !== handler); },
    dispatch(type, event = {}) { for (const handler of this.listeners[type] || []) handler(event); },
    dispatchFromTarget(target, type, event) {
      event.target ||= target; event.type = type;
      for (const handler of this.captureListeners[type] || []) { handler(event); if (event.immediateStopped) return; }
      for (const handler of target.listeners?.[type] || []) { handler(event); if (event.immediateStopped) return; }
      if (event.propagationStopped) return;
      for (const handler of this.listeners[type] || []) { handler(event); if (event.immediateStopped || event.propagationStopped) return; }
    },
    defaultView: { matchMedia: (query) => ({ matches: query.includes("pointer: coarse") ? coarse : query.includes("hover: none") ? noHover : false, addEventListener() {}, removeEventListener() {} }) },
    createElement: element,
    createElementNS: (_namespace, tag) => element(tag),
    createTextNode: (text) => ({ textContent: text }),
  };
}
function find(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children || []) { const found = find(child, predicate); if (found) return found; }
  return null;
}

// Save copy now requires an explicit name confirmation before the existing action.
function clickCommand(root, action) {
  find(root, node => node.dataset?.action === action).dispatch('click');
  if (action === 'save-new') find(root, node => node.dataset?.action === 'save-copy-confirm').dispatch('click');
}

test('Back commits a valid pending scalar edit and closes the active panel once', () => {
  const previousDocument = globalThis.document;
  const doc = documentStub(); globalThis.document = doc;
  const root = element('main'); root.ownerDocument = doc;
  const client = fakeClient();
  const api = mountProjectionConfig(root, { client });
  try {
    find(root, node => node.className === 'config-enlarge-edit').dispatch('click');
    const editor = find(root, node => node.className === 'parameter-editor-dialog');
    const scale = find(editor, node => node.attributes?.['aria-label'] === 'Scale' && node.tagName === 'INPUT');
    scale.value = '1.3'; scale.dispatch('input');
    find(root, node => node.dataset?.action === 'parameter-editor-close').dispatch('click');
    expect(client.getState().draft.pre.scale).toBe(1.3);
    expect(editor.hidden).toBe(true);
    expect(find(root, node => node.className === 'config-workspace').dataset.editing).toBe('false');
  } finally { api.dispose(); globalThis.document = previousDocument; }
});

test('Import keeps its explicit save name while subsequent copy edits stay separate', async () => {
  const root = element('main'); root.ownerDocument = documentStub(); const client = fakeClient();
  client.getState().snapshot.presets.push({ id: 'desk', name: 'Desk', config: clone(DEFAULTS) });
  client.getState().snapshot.selectedPresetId = 'desk';
  const imported = clone(DEFAULTS); imported.pre.tx = 0.012;
  const api = mountProjectionConfig(root, { client, onImport: async () => ({ name: 'Imported desk', config: imported }) });
  const action = name => find(root, node => node.dataset?.action === name);
  try {
    await api.handleAction('import', {});
    const input = find(root, node => node.attributes?.['aria-label'] === 'Preset name');
    expect(input.value).toBe('Imported desk');
    action('save-new').dispatch('click'); input.value = ''; input.dispatch('input'); action('save-copy-cancel').dispatch('click');
    action('save').dispatch('click');
    await vi.waitFor(() => expect(client.save).toHaveBeenCalledWith({ presetId: 'desk', name: 'Imported desk' }));
    expect(client.savedDrafts).toEqual([imported]);
    action('save-new').dispatch('click'); input.value = 'Imported copy'; input.dispatch('input'); action('save-copy-confirm').dispatch('click');
    await vi.waitFor(() => expect(client.save).toHaveBeenLastCalledWith({ presetId: null, name: 'Imported copy' }));
    await api.handleAction('load', 'desk');
    action('save').dispatch('click');
    await vi.waitFor(() => expect(client.save).toHaveBeenLastCalledWith({ presetId: 'desk', name: 'Imported desk' }));
  } finally { api.dispose(); }
});
function fakeClient(initialSnapshot) {
  let state = { snapshot: { revision: 2, config: clone(DEFAULTS), presets: [{ id: "original", name: "Original calibration", config: clone(DEFAULTS), readOnly: true }], selectedPresetId: "original" }, draft: clone(DEFAULTS), live: true, connected: true, pending: false, hasLocalDraft: false };
  const listeners = new Set();
  const savedDrafts = [];
  const notify = () => listeners.forEach((listener) => listener({ ...state, snapshot: clone(state.snapshot), draft: clone(state.draft) }));
  if (initialSnapshot === null) state = { ...state, snapshot: null, draft: null };
  let validateCandidate;
  return {
    state,
    savedDrafts,
    setValidateCandidate(handler) { validateCandidate = handler; },
    validateCandidate(args) { return validateCandidate(args); },
    hydrate(snapshot) { state = { ...state, snapshot: clone(snapshot), draft: clone(snapshot.config) }; notify(); },
    report(changes) { state = { ...state, ...changes }; notify(); },
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    start: vi.fn(async () => state), stop: vi.fn(),
    retryHydration: vi.fn(async () => state),
    setDraft: vi.fn((draft) => { state = { ...state, draft: clone(draft), hasLocalDraft: true }; notify(); }),
    setLive: vi.fn((live) => { state = { ...state, live: Boolean(live) }; notify(); }),
    apply: vi.fn(async () => state),
    save: vi.fn(async ({ presetId, name }) => {
      savedDrafts.push(clone(state.draft));
      const id = presetId || "new-preset";
      const presets = state.snapshot.presets.filter((preset) => preset.id !== id);
      presets.push({ id, name, config: clone(state.draft) });
      state = { ...state, snapshot: { ...state.snapshot, config: clone(state.draft), selectedPresetId: id, presets }, hasLocalDraft: false };
      notify(); return state;
    }),
    load: vi.fn(async (id) => { state = { ...state, snapshot: { ...state.snapshot, selectedPresetId: id }, draft: clone(state.snapshot.presets.find((preset) => preset.id === id).config), hasLocalDraft: false }; notify(); return { ...state, draftReplaced: true }; }),
    revert: vi.fn(async () => { state = { ...state, draft: clone(state.snapshot.config), hasLocalDraft: false }; notify(); return { ...state, draftReplaced: true }; }),
    getState: () => state,
  };
}

function tracedWarpHarness({ candidateValidator } = {}) {
  const previousDocument = globalThis.document;
  globalThis.document = documentStub();
  const root = element("main");
  const client = fakeClient();
  const trace = {
    enabled: true,
    record: vi.fn(),
    getStatus: () => ({ recording: false, connected: false, acknowledged: 0, queued: 0, pending: 0, dropped: 0 }),
    subscribe: () => () => {},
  };
  const api = mountProjectionConfig(root, { client, trace, candidateValidator });
  client.setLive(false);
  find(root, (node) => node.dataset?.action === "warp-editor-open" && node.parentElement?.dataset?.node === "left-keystone").dispatch("click");
  const surface = find(root, (node) => node.attributes?.class === "warp-edit-surface");
  surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 2064, height: 1224 });
  const redraws = () => trace.record.mock.calls.filter(([kind, detail]) => kind === "redraw" && detail.surface === "page" && detail.phase === "start").length;
  const restore = () => { api.dispose(); globalThis.document = previousDocument; };
  return { root, client, trace, surface, redraws, api, restore };
}

test("relative pad start disables presentation toggle and blocks consuming commands before movement", async () => {
  const { root, client, api, restore } = tracedWarpHarness();
  await api.handleAction("warp-nudge", { direction: "right", fine: true, output: "left" });
  const pad = find(root, (node) => node.className === "warp-relative-pad");
  const toggle = find(root, (node) => node.dataset?.action === "warp-full-viewport");
  pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200 });
  pad.dispatch("pointerdown", { pointerId: 29, button: 0, clientX: 100, clientY: 100, preventDefault() {} });
  expect(toggle.disabled).toBe(true);
  expect(find(root, (node) => node.dataset?.action === "warp-undo").disabled).toBe(true);
  expect(find(root, (node) => node.dataset?.action === "warp-redo").disabled).toBe(true);
  expect(await api.handleAction("apply")).toBe(false);
  expect(client.apply).not.toHaveBeenCalled();
  const fullViewport = root.dataset?.warpFullViewport;
  toggle.dispatch("click");
  expect(root.dataset?.warpFullViewport).toBe(fullViewport);
  expect(client.setDraft).not.toHaveBeenCalled();
  restore();
});

test("Back cancels a relative-pad gesture before hiding its workspace", () => {
  const { root, client, restore } = tracedWarpHarness();
  const pad = find(root, (node) => node.className === "warp-relative-pad");
  const back = find(root, (node) => node.dataset?.action === "warp-editor-close");
  pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200 });
  pad.dispatch("pointerdown", { pointerId: 30, button: 0, clientX: 100, clientY: 100, preventDefault() {} });
  pad.dispatch("pointermove", { pointerId: 30, clientX: 110, clientY: 100 });
  expect(client.getState().draft.outputs.left.warp.keystone.corners[0][0]).not.toBe(0);
  back.dispatch("click");
  expect(find(root, (node) => node.className === "warp-editor-dialog").hidden).toBe(false);
  expect(client.getState().draft.outputs.left.warp.keystone.corners[0][0]).not.toBe(0);
  pad.dispatch("lostpointercapture", { pointerId: 30 });
  expect(client.getState().draft.outputs.left.warp.keystone.corners[0][0]).toBe(0);
  back.dispatch("click");
  expect(find(root, (node) => node.className === "warp-editor-dialog").hidden).toBe(true);
  expect(find(root, (node) => node.className === "warp-editor-dialog").dataset.fullViewport).toBe("false");
  expect(client.getState().draft.outputs.left.warp.keystone.corners[0][0]).toBe(0);
  restore();
});

test("Escape cancels a relative-pad gesture first and a second Escape closes", () => {
  const { root, client, restore } = tracedWarpHarness();
  const pad = find(root, (node) => node.className === "warp-relative-pad");
  const dialog = find(root, (node) => node.className === "warp-editor-dialog");
  pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200 });
  pad.dispatch("pointerdown", { pointerId: 32, button: 0, clientX: 100, clientY: 100, preventDefault() {} });
  pad.dispatch("pointermove", { pointerId: 32, clientX: 110, clientY: 100 });
  const dispatchEscape = () => {
    const event = { key: "Escape", target: pad, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.immediateStopped = true; } };
    for (const handler of globalThis.document.listeners.keydown || []) { handler(event); if (event.immediateStopped) break; }
  };
  dispatchEscape();
  expect(dialog.hidden).toBe(false);
  expect(client.getState().draft.outputs.left.warp.keystone.corners[0][0]).toBe(0);
  dispatchEscape();
  expect(dialog.hidden).toBe(true);
  restore();
});

test("accepted foreign replacement retires a held nudge without rolling back to its capture", () => {
  const previousDocument = globalThis.document;
  globalThis.document = documentStub();
  vi.useFakeTimers();
  const root = element("main"); const client = fakeClient(); const api = mountProjectionConfig(root, { client });
  try {
    client.setLive(false);
    find(root, (node) => node.dataset?.action === "warp-editor-open" && node.parentElement?.dataset?.node === "left-keystone").dispatch("click");
    const right = find(root, (node) => node.dataset?.action === "warp-nudge" && node.dataset?.direction === "right");
    client.setDraft.mockClear();
    right.dispatch("pointerdown", { pointerId: 41, button: 0, preventDefault() {} });
    vi.advanceTimersByTime(375);
    expect(client.setDraft).toHaveBeenCalledTimes(1);
    const foreign = clone(client.getState().draft);
    foreign.outputs.left.warp.keystone.corners[0] = [0.02, 0.03];
    const writesAtAcceptance = client.setDraft.mock.calls.length;
    client.report({ draft: foreign, hasLocalDraft: false });
    expect(client.setDraft).toHaveBeenCalledTimes(writesAtAcceptance);
    expect(client.getState().draft.outputs.left.warp.keystone.corners[0]).toEqual([0.02, 0.03]);
    expect(client.getState().hasLocalDraft).toBe(false);
    expect(Number(find(root, (node) => node.dataset?.field === "warp.position.x" && node.dataset?.input === "number").value)).toBeCloseTo(0.02 * 1920);
    expect(find(root, (node) => node.className === "warp-relative-pad").disabled).toBe(false);
    expect(find(root, (node) => node.dataset?.action === "warp-undo").disabled).toBe(true);
    expect(client.apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(225);
    right.dispatch("pointerup", { pointerId: 41 });
    expect(client.setDraft).toHaveBeenCalledTimes(writesAtAcceptance);
    expect(client.getState().draft.outputs.left.warp.keystone.corners[0]).toEqual([0.02, 0.03]);
    expect(client.getState().hasLocalDraft).toBe(false);
  } finally { api.dispose(); vi.useRealTimers(); globalThis.document = previousDocument; }
});

test("accepted foreign replacement retires a relative pad without restoring its captured geometry", () => {
  const previousDocument = globalThis.document;
  globalThis.document = documentStub();
  const root = element("main"); const client = fakeClient(); const api = mountProjectionConfig(root, { client });
  try {
    client.setLive(false);
    find(root, (node) => node.dataset?.action === "warp-editor-open" && node.parentElement?.dataset?.node === "left-keystone").dispatch("click");
    const pad = find(root, (node) => node.className === "warp-relative-pad");
    pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200 });
    client.setDraft.mockClear();
    pad.dispatch("pointerdown", { pointerId: 42, button: 0, clientX: 100, clientY: 100, preventDefault() {} });
    pad.dispatch("pointermove", { pointerId: 42, clientX: 110, clientY: 120 });
    expect(client.setDraft).toHaveBeenCalledTimes(1);
    const foreign = clone(client.getState().draft);
    foreign.outputs.left.warp.keystone.corners[0] = [0.02, 0.03];
    const writesAtAcceptance = client.setDraft.mock.calls.length;
    client.report({ draft: foreign, hasLocalDraft: false });
    expect(client.setDraft).toHaveBeenCalledTimes(writesAtAcceptance);
    expect(client.getState().draft.outputs.left.warp.keystone.corners[0]).toEqual([0.02, 0.03]);
    expect(client.getState().hasLocalDraft).toBe(false);
    expect(Number(find(root, (node) => node.dataset?.field === "warp.position.x" && node.dataset?.input === "number").value)).toBeCloseTo(0.02 * 1920);
    expect(find(root, (node) => node.className === "warp-relative-pad").disabled).toBe(false);
    expect(find(root, (node) => node.dataset?.action === "warp-undo").disabled).toBe(true);
    pad.dispatch("pointerup", { pointerId: 42, clientX: 110, clientY: 120 });
    expect(client.setDraft).toHaveBeenCalledTimes(writesAtAcceptance);
    expect(client.getState().draft.outputs.left.warp.keystone.corners[0]).toEqual([0.02, 0.03]);
    expect(client.getState().hasLocalDraft).toBe(false);
    expect(client.apply).not.toHaveBeenCalled();
  } finally { api.dispose(); globalThis.document = previousDocument; }
});

test("own accepted pad state retains the active gesture and one undo entry", () => {
  const previousDocument = globalThis.document;
  globalThis.document = documentStub();
  const root = element("main"); const client = fakeClient(); const api = mountProjectionConfig(root, { client });
  try {
    client.setLive(false);
    find(root, (node) => node.dataset?.action === "warp-editor-open" && node.parentElement?.dataset?.node === "left-keystone").dispatch("click");
    const initial = clone(client.getState().draft.outputs.left.warp);
    const pad = find(root, (node) => node.className === "warp-relative-pad");
    pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200 });
    pad.dispatch("pointerdown", { pointerId: 43, button: 0, clientX: 100, clientY: 100, preventDefault() {} });
    pad.dispatch("pointermove", { pointerId: 43, clientX: 110, clientY: 120 });
    const acceptedOwnState = clone(client.getState().draft);
    expect(acceptedOwnState.outputs.left.warp).not.toEqual(initial);
    client.report({ draft: acceptedOwnState, hasLocalDraft: false });
    expect(find(root, (node) => node.dataset?.action === "warp-undo").disabled).toBe(true);
    pad.dispatch("pointerup", { pointerId: 43, clientX: 110, clientY: 120 });
    const moved = clone(client.getState().draft.outputs.left.warp);
    expect(moved).not.toEqual(initial);
    const undo = find(root, (node) => node.dataset?.action === "warp-undo");
    expect(undo.disabled).toBe(false);
    undo.dispatch("click");
    expect(client.getState().draft.outputs.left.warp).toEqual(initial);
    expect(find(root, (node) => node.dataset?.action === "warp-undo").disabled).toBe(true);
  } finally { api.dispose(); globalThis.document = previousDocument; }
});

test("pad start immediately disables and re-enables signed warp controls", () => {
  const previousDocument = globalThis.document;
  globalThis.document = documentStub();
  const root = element("main"); const client = fakeClient(); const api = mountProjectionConfig(root, { client });
  try {
    client.setLive(false);
    find(root, (node) => node.dataset?.action === "warp-editor-open" && node.parentElement?.dataset?.node === "left-keystone").dispatch("click");
    const warpX = find(root, (node) => node.dataset?.field === "warp.position.x" && node.dataset?.input === "number");
    const sign = find(warpX.parentElement, (node) => node.dataset?.action === "numeric-sign");
    const pad = find(root, (node) => node.className === "warp-relative-pad");
    pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200 });
    warpX.dispatch("focus");
    pad.dispatch("pointerdown", { pointerId: 44, button: 0, clientX: 100, clientY: 100, preventDefault() {} });
    expect(warpX.disabled).toBe(true);
    expect(sign.disabled).toBe(true);
    pad.dispatch("lostpointercapture", { pointerId: 44 });
    expect(warpX.disabled).toBe(false);
    expect(sign.disabled).toBe(false);
  } finally { api.dispose(); globalThis.document = previousDocument; }
});

test("first Escape during pad adjustment preserves unrelated pending text", () => {
  const previousDocument = globalThis.document;
  globalThis.document = documentStub();
  const root = element("main"); const client = fakeClient(); const api = mountProjectionConfig(root, { client });
  try {
    client.setLive(false);
    find(root, (node) => node.dataset?.action === "warp-editor-open" && node.parentElement?.dataset?.node === "left-keystone").dispatch("click");
    const warpX = find(root, (node) => node.dataset?.field === "warp.position.x" && node.dataset?.input === "number");
    const pad = find(root, (node) => node.className === "warp-relative-pad");
    pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200 });
    const pending = find(root, (node) => node.dataset?.field === "pre.tx" && node.dataset?.input === "number");
    pending.dispatch("focus"); pending.value = "1.5"; pending.dispatch("input");
    client.setDraft.mockClear();
    pad.dispatch("pointerdown", { pointerId: 45, button: 0, clientX: 100, clientY: 100, preventDefault() {} });
    const escape = { key: "Escape", target: pending, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; }, stopImmediatePropagation() { this.immediateStopped = true; } };
    globalThis.document.dispatchFromTarget(pending, "keydown", escape);
    expect(find(root, (node) => node.className === "warp-editor-dialog").hidden).toBe(false);
    expect(pending.value).toBe("1.5");
    pad.dispatch("pointermove", { pointerId: 45, clientX: 130, clientY: 130 });
    expect(client.setDraft).not.toHaveBeenCalled();
    expect(warpX.disabled).toBe(false);
    pending.dispatch("keydown", { key: "Escape", preventDefault() {}, stopPropagation() {} });
    expect(pending.value).not.toBe("1.5");
  } finally { api.dispose(); globalThis.document = previousDocument; }
});

test('diagnostic config starts Live off and records receipts without calibration writes', () => {
  const root = element(); root.ownerDocument = documentStub();
  const client = fakeClient();
  const socketHandlers = new Map();
  const socket = { on: (type, fn) => socketHandlers.set(type, fn), off: (type) => socketHandlers.delete(type), getConnected: () => false };
  const trace = { enabled: true, record: vi.fn(), getStatus: () => ({ recording: true, connected: true, acknowledged: 0, queued: 0, pending: 0, dropped: 0 }), subscribe: () => () => {} };
  const mounted = mountProjectionConfig(root, { client, trace, socket });
  expect(client.setLive).toHaveBeenCalledWith(false);
  expect(client.apply).not.toHaveBeenCalled(); expect(client.save).not.toHaveBeenCalled(); expect(client.setDraft).not.toHaveBeenCalled();
  expect(trace.record.mock.calls.some(([kind]) => kind === 'receipt')).toBe(true);
  socketHandlers.get('otef_projection_applied')({ table: 'otef', output: 'left', instanceId: 'instance', revision: 2, success: true, route: 'browser', baseline: DEFAULTS.outputs.left.warp.baseline });
  expect(trace.record.mock.calls).toContainEqual(['receipt', { receiptType: 'output_applied', output: 'left', revision: 2, accepted: true, live: false }]);
  mounted.dispose();
});

function replacementHarness() {
  const presetId = "11111111-1111-4111-8111-111111111111";
  const snapshot = { revision: 0, config: clone(DEFAULTS), selectedPresetId: "original", presets: [
    { id: "original", name: "Original calibration", config: clone(DEFAULTS), readOnly: true },
    { id: presetId, name: "Desk", config: clone(DEFAULTS), readOnly: false },
  ] };
  const requests = [];
  const events = new Map();
  const socket = { getConnected: () => true, on(type, fn) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); }, off(type, fn) { events.get(type)?.delete(fn); } };
  let time = 0;
  const client = createProjectionConfigClient({ sourceId: "00000000-0000-4000-8000-00000000000a", socket,
    clock: { now: () => time += 1000, setTimeout, clearTimeout },
    fetchImpl: (_url, options = {}) => new Promise((resolve) => requests.push({ options, resolve })),
  });
  const respond = (state) => requests.shift().resolve({ ok: true, status: 200, json: async () => clone(state) });
  const emit = (state, sourceId) => { for (const fn of events.get("otef_projection_config_changed") || []) fn({ type: "otef_projection_config_changed", table: "otef", sourceId, state }); };
  const foreign = (state) => emit(state, "00000000-0000-4000-8000-00000000000b");
  const own = (state) => emit(state, "00000000-0000-4000-8000-00000000000a");
  return { client, snapshot, presetId, requests, respond, foreign, own };
}

describe("projection config controller", () => {
  test("grid topology preview cancellation is write-free and confirmation validates and merges the latest draft once", async () => {
    const previousDocument = globalThis.document; globalThis.document = documentStub();
    const root = element("main"); root.ownerDocument = globalThis.document;
    const client = fakeClient(); const checks = [];
    const api = mountProjectionConfig(root, { client, candidateValidator: { validateCandidate: args => new Promise(resolve => checks.push({ ...args, resolve })), dispose() {} } });
    try {
      client.setLive(false);
      find(root, node => node.dataset?.action === "warp-editor-open" && node.parentElement?.dataset?.node === "left-grid").dispatch("click");
      find(root, node => node.dataset?.warpSelectionKind === "row").dispatch("click");
      const picker = find(root, node => node.className === "warp-selection-picker"); picker.value = "2"; picker.dispatch("change");
      const remove = find(root, node => node.dataset?.gridLayoutAction === "remove-row");
      client.setDraft.mockClear(); client.apply.mockClear();
      remove.dispatch("click"); await vi.waitFor(() => expect(checks).toHaveLength(1));
      expect(client.setDraft).not.toHaveBeenCalled(); expect(client.apply).not.toHaveBeenCalled();
      find(root, node => node.dataset?.action === "warp-grid-layout-cancel").dispatch("click");
      checks[0].resolve({ identity: checks[0].identity, valid: true }); await Promise.resolve();
      expect(client.setDraft).not.toHaveBeenCalled();

      remove.dispatch("click"); await vi.waitFor(() => expect(checks).toHaveLength(2));
      checks[1].resolve({ identity: checks[1].identity, valid: true });
      await vi.waitFor(() => expect(find(root, node => node.dataset?.action === "warp-grid-layout-confirm").disabled).toBe(false));
      const latest = clone(client.getState().draft); latest.pre.scale = 1.5; client.report({ draft: latest, hasLocalDraft: true });
      find(root, node => node.dataset?.action === "warp-grid-layout-confirm").dispatch("click");
      await vi.waitFor(() => expect(checks).toHaveLength(3));
      expect(client.setDraft).not.toHaveBeenCalled();
      checks[2].resolve({ identity: checks[2].identity, valid: true });
      await vi.waitFor(() => expect(client.setDraft).toHaveBeenCalledTimes(1));
      expect(client.getState().draft.pre.scale).toBe(1.5);
      expect(client.getState().draft.outputs.left.warp.grid.rows).toBe(6);
      expect(client.setDraft.mock.calls[0][0].outputs.left.warp.grid.rows).toBe(6);
    } finally { api.dispose(); globalThis.document = previousDocument; }
  });

  test('real-client Live Undo validates and publishes the exact restored scalar after its own acknowledgment', async () => {
    const root=element('main'); root.ownerDocument=documentStub(); const h=replacementHarness(); const checks=[];
    h.snapshot.config.pre.tx=.123456789123456;
    const api=mountProjectionConfig(root,{client:h.client,candidateValidator:{validateCandidate:args=>new Promise(resolve=>checks.push({...args,resolve})),dispose(){}}});
    try {
      h.respond(h.snapshot); await vi.waitFor(()=>expect(h.client.getState().hydrating).toBe(false));
      expect(h.client.getState().live).toBe(true);
      find(root,n=>n.dataset?.action==='fine-nudge' && n.dataset.path==='pre.tx' && n.dataset.direction==='1').dispatch('click');
      await vi.waitFor(()=>expect(checks).toHaveLength(1)); expect(h.requests).toHaveLength(0);
      expect(checks[0].config.pre.tx).toBe(h.snapshot.config.pre.tx+.0001);
      checks[0].resolve({identity:checks[0].identity,valid:true}); await vi.waitFor(()=>expect(h.requests).toHaveLength(1));
      const edited=clone(h.snapshot); edited.revision=1; edited.config=JSON.parse(h.requests[0].options.body).config;
      expect(h.requests[0].options.method).toBe('POST'); expect(JSON.parse(h.requests[0].options.body).action).toBe('preview');
      h.respond(edited); await vi.waitFor(()=>expect(h.client.getState().pending).toBe(false));
      expect(await api.handleAction('parameter-undo')).toBe(true);
      expect(h.client.getState().pending).toBe(true); await vi.waitFor(()=>expect(checks).toHaveLength(2));
      expect(h.requests).toHaveLength(0); expect(checks[1].config).toEqual(h.snapshot.config);
      checks[1].resolve({identity:checks[1].identity,valid:true}); await vi.waitFor(()=>expect(h.requests).toHaveLength(1));
      expect(h.requests[0].options.method).toBe('POST');
      expect(JSON.parse(h.requests[0].options.body)).toMatchObject({action:'preview',baseRevision:1,config:h.snapshot.config});
      h.respond({...h.snapshot,revision:2}); await vi.waitFor(()=>expect(h.client.getState().pending).toBe(false));
      expect(h.client.getState().snapshot.config).toEqual(h.snapshot.config); expect(h.client.getState().live).toBe(true);
    } finally {api.dispose();}
  });
  test('held nudges produce one undo entry, own acknowledgments retain it and foreign same-field changes invalidate it', async () => {
    const root=element('main'); root.ownerDocument=documentStub(); const client=fakeClient(); const factory=vi.spyOn(configView,'createProjectionConfigView'); const api=mountProjectionConfig(root,{client});
    const {onNudge,onField}=factory.mock.calls.at(-1)[1];
    try {
      const base=client.getState().draft.pre.scale;
      onNudge('pre.scale',1,{phase:'start',gestureId:'hold',count:1});
      onNudge('pre.scale',1,{phase:'update',gestureId:'hold',count:5});
      onNudge('pre.scale',1,{phase:'end',gestureId:'hold',count:5});
      const acknowledged=clone(client.getState().draft); client.report({hasLocalDraft:false,snapshot:{...client.getState().snapshot,revision:3,config:acknowledged}});
      expect(await api.handleAction('parameter-undo')).toBe(true); expect(client.getState().draft.pre.scale).toBe(base);
      expect(await api.handleAction('parameter-undo')).toBe(false);
      expect(await api.handleAction('parameter-redo')).toBe(true); expect(client.getState().draft.pre.scale).toBe(base+.005);
      await api.handleAction('parameter-undo'); onField('pre.tx','2','number'); expect(await api.handleAction('parameter-redo')).toBe(false);
      onField('pre.scale','2','number'); const foreign=clone(client.getState().draft); foreign.pre.scale=3; client.report({draft:foreign,hasLocalDraft:true});
      await api.handleAction('parameter-undo'); expect(client.getState().draft.pre.scale).toBe(3); expect(client.getState().draft.pre.tx).toBe(DEFAULTS.pre.tx);
    } finally {api.dispose();factory.mockRestore();}
  });
  test('invalid Undo leaves its stacks and latest draft unchanged with the validator reason', async () => {
    const root=element('main'); root.ownerDocument=documentStub(); const client=fakeClient(); const factory=vi.spyOn(configView,'createProjectionConfigView'); const api=mountProjectionConfig(root,{client});
    const {onField}=factory.mock.calls.at(-1)[1];
    try {
      const initial=clone(client.getState().draft); initial.outputs.left.crop.x0=.4; client.report({draft:initial});
      onField('outputs.left.crop.x0','10','number');
      const foreign=clone(client.getState().draft); foreign.outputs.left.crop.x1=.2; client.report({draft:foreign,hasLocalDraft:true});
      expect(await api.handleAction('parameter-undo')).toBe(false); expect(client.getState().draft).toEqual(foreign);
      expect(find(root,n=>n.dataset?.action==='parameter-undo').disabled).toBe(false);
      expect(find(root,n=>n.dataset?.action==='parameter-redo').disabled).toBe(true);
      expect(find(root,n=>n.dataset?.errorFor==='outputs.left.crop.x0').textContent).not.toBe('');
    } finally {api.dispose();factory.mockRestore();}
  });
  test('real client reversing adjacent nudges returns exactly to imported base without a dirty draft', async () => {
    const root = element('main'); root.ownerDocument = documentStub(); const h = replacementHarness();
    h.snapshot.config.pre.scale = 1.23456789123456;
    h.snapshot.config.pre.tx = .123456789123456;
    const api = mountProjectionConfig(root, { client: h.client });
    try {
      h.respond(h.snapshot); await vi.waitFor(() => expect(h.client.getState().hydrating).toBe(false)); h.client.setLive(false);
      const nudge = (path, direction) => find(root, n => n.dataset?.action === 'fine-nudge' && n.dataset.path === path && n.dataset.direction === direction).dispatch('click');
      for (const path of ['pre.scale', 'pre.tx']) { nudge(path, '1'); nudge(path, '-1'); }
      expect(h.client.getState().draft.pre.scale).toBe(h.snapshot.config.pre.scale);
      expect(h.client.getState().draft.pre.tx).toBe(h.snapshot.config.pre.tx);
      expect(h.client.getState().hasLocalDraft).toBe(false);
    } finally { api.dispose(); }
  });
  test('canonical Fine gestures coalesce, cancel only their path and Undo preserves unrelated output', async () => {
    const root = element('main'); root.ownerDocument = documentStub(); const client = fakeClient();
    const factory = vi.spyOn(configView, 'createProjectionConfigView'); const api = mountProjectionConfig(root, { client });
    const { onField } = factory.mock.calls.at(-1)[1];
    try {
      const base = .123456789123456; const draft = clone(client.getState().draft); draft.pre.tx = base; client.report({draft});
      const send = (value, phase, id = 'slider') => onField('pre.tx', 'ignored', 'range', { canonicalValue: value, phase, gestureId: id });
      expect(send(base + .0001, 'start')).toBe(true); expect(send(base + .0002, 'update')).toBe(true); send(base + .0002, 'end');
      await api.handleAction('parameter-undo'); expect(client.getState().draft.pre.tx).toBe(base);
      await api.handleAction('parameter-redo'); expect(client.getState().draft.pre.tx).toBe(base + .0002);
      send(base + .0003, 'start', 'cancelled');
      const unrelated = clone(client.getState().draft); unrelated.outputs.right.post.tx = .25; client.report({draft: unrelated, hasLocalDraft: true});
      send(base + .0003, 'cancel', 'cancelled'); expect(client.getState().draft.pre.tx).toBe(base + .0002);
      expect(client.getState().draft.outputs.right.post.tx).toBe(.25);
      await api.handleAction('parameter-undo'); expect(client.getState().draft.pre.tx).toBe(base);
      expect(client.getState().draft.outputs.right.post.tx).toBe(.25); expect(client.getState().live).toBe(true);
    } finally { api.dispose(); factory.mockRestore(); }
  });
  test('invalid crop Fine commit keeps Apply blocked and issues no client request', async () => {
    const root = element('main'); root.ownerDocument = documentStub(); const client = fakeClient(); const api = mountProjectionConfig(root, {client});
    try {
      const range = find(root, n => n.dataset?.field === 'outputs.left.crop.x0' && n.dataset.input === 'range');
      find(find(root, n => n.dataset?.path === 'outputs.left.crop.x0'), n => n.dataset?.mode === 'coarse').dispatch('click');
      range.dispatch('pointerdown', {pointerId: 2}); range.value = '99.9'; range.dispatch('input'); range.dispatch('pointerup', {pointerId: 2});
      await api.handleAction('apply'); expect(client.apply).not.toHaveBeenCalled(); expect(client.setDraft).not.toHaveBeenCalled();
      expect(find(root, n => n.dataset?.errorFor === 'outputs.left.crop.x0').textContent).toMatch(/extent|edge|below|accepted/i);
    } finally {api.dispose();}
  });
  test('controller independently checks exact canonical baselines, resolved targets and override', () => {
    const root = element('main'); root.ownerDocument = documentStub(); const client = fakeClient();
    const factory = vi.spyOn(configView, 'createProjectionConfigView'); const api = mountProjectionConfig(root, { client });
    const onField = factory.mock.calls.at(-1)[1].onField;
    try {
      const initial = clone(client.getState().draft); initial.pre.scale = 1.23456; client.report({ draft: initial });
      const metadata = { baseValue: 1.23456, resolvedPath: 'pre.scale' };
      const latest = clone(initial); latest.pre.scale = 2; client.report({ draft: latest });
      expect(onField('pre.scale', '1.5', 'number', metadata)).toBe(false); expect(client.setDraft).not.toHaveBeenCalled(); expect(client.getState().draft).toEqual(latest);
      expect(find(root, node => node.dataset?.errorFor === 'pre.scale').textContent).toMatch(/changed while editing/i);
      expect(onField('pre.scale', '1.5', 'number', { ...metadata, override: true })).toBe(true); expect(client.getState().draft.pre.scale).toBe(1.5);
      const target = clone(client.getState().draft); target.namesWall.activeMode = 'model'; client.report({ draft: target }); client.setDraft.mockClear();
      expect(onField('namesWall.requestedFontPx', '20', 'number', { baseValue: target.namesWall.profiles.wall.requestedFontPx, resolvedPath: 'namesWall.profiles.wall.requestedFontPx', override: true })).toBe(false);
      expect(client.getState().draft).toEqual(target); expect(client.setDraft).not.toHaveBeenCalled();
      const current = clone(target); current.pre.tx = 0.2; client.report({ draft: current });
      expect(onField('pre.scale', '1.6', 'number', { baseValue: 1.5, resolvedPath: 'pre.scale' })).toBe(true); expect(client.getState().draft.pre.tx).toBe(0.2);
      client.setDraft.mockClear(); expect(onField('pre.scale', '1.6', 'number', { baseValue: 1.6, resolvedPath: 'pre.scale' })).toBe(true); expect(client.setDraft).not.toHaveBeenCalled();
    } finally { api.dispose(); factory.mockRestore(); }
  });
  test.each([false, true])('real-client foreign replacement preserves scalar text safely (edited=%s)', async (edited) => {
    const root = element('main'); root.ownerDocument = documentStub();
    const h = replacementHarness(); h.snapshot.config.pre.scale = 1.23456;
    const api = mountProjectionConfig(root, { client: h.client });
    try {
      h.respond(h.snapshot); await vi.waitFor(() => expect(h.client.getState().hydrating).toBe(false)); h.client.setLive(false);
      const input = find(root, node => node.dataset?.field === 'pre.scale' && node.dataset.input === 'number');
      input.dispatch('focus');
      if (edited) { input.value = '1.5'; input.dispatch('input'); }
      const next = clone(h.snapshot); next.revision = 1; next.config.pre.scale = 2; h.foreign(next);
      input.dispatch('blur');
      expect(h.client.getState().draft.pre.scale).toBe(2);
      expect(h.client.getState().hasLocalDraft).toBe(false);
      if (edited) {
        expect(find(root, node => node.dataset?.errorFor === 'pre.scale').textContent).toMatch(/changed while editing/i);
        find(root, node => node.dataset?.path === 'pre.scale').children.find(node => node.dataset?.action === 'numeric-use-mine').dispatch('click');
        expect(h.client.getState().draft.pre.scale).toBe(1.5);
      }
      expect(h.requests).toHaveLength(0);
    } finally { api.dispose(); }
  });

  test('edited field tolerates an unrelated replacement but cannot override a changed profile', () => {
    const root = element('main'); root.ownerDocument = documentStub(); const client = fakeClient();
    const api = mountProjectionConfig(root, { client });
    try {
      const scale = find(root, node => node.dataset?.field === 'pre.scale' && node.dataset.input === 'number');
      scale.value = '1.5'; scale.dispatch('input');
      const next = clone(client.getState().draft); next.pre.tx = 0.2; client.report({ draft: next }); scale.dispatch('blur');
      expect(client.getState().draft.pre).toMatchObject({ scale: 1.5, tx: 0.2 });
      const field = find(root, node => node.dataset?.field === 'namesWall.requestedFontPx' && node.dataset.input === 'number');
      field.value = '20'; field.dispatch('input');
      const profile = clone(client.getState().draft); profile.namesWall.activeMode = 'model'; client.report({ draft: profile });
      field.dispatch('blur');
      const wrap = find(root, node => node.dataset?.path === 'namesWall.requestedFontPx');
      const mine = wrap.children.find(node => node.dataset?.action === 'numeric-use-mine');
      expect(mine.disabled).toBe(true); mine.dispatch('click'); expect(client.getState().draft).toEqual(profile);
    } finally { api.dispose(); }
  });

  test.each(['apply', 'save', 'save-new'])('%s finishes valid text before consuming the candidate', async action => {
    const root = element('main'); root.ownerDocument = documentStub(); const client = fakeClient();
    client.getState().snapshot.selectedPresetId = 'desk'; client.getState().snapshot.presets.push({ id: 'desk', name: 'Desk', config: clone(DEFAULTS) });
    const api = mountProjectionConfig(root, { client });
    try {
      const input = find(root, node => node.dataset?.field === 'pre.scale' && node.dataset.input === 'number');
      input.value = '1.5'; input.dispatch('input');
      clickCommand(root, action);
      expect(client.getState().draft.pre.scale).toBe(1.5);
      expect(action === 'apply' ? client.apply : client.save).toHaveBeenCalledTimes(1);
    } finally { api.dispose(); }
  });

  test.each(['apply', 'save', 'save-new', 'node', 'profile', 'editor'])('%s rejects invalid displayed text without relying on blur', action => {
    const root = element('main'); root.ownerDocument = documentStub(); const client = fakeClient();
    client.getState().snapshot.selectedPresetId = 'desk'; client.getState().snapshot.presets.push({ id: 'desk', name: 'Desk', config: clone(DEFAULTS) });
    const editorFactory = vi.fn(); const api = mountProjectionConfig(root, { client, clockEditorFactory: editorFactory });
    try {
      const selected = vi.spyOn(find(root, node => node.dataset?.node === 'pre').classList, 'toggle');
      const input = find(root, node => node.dataset?.field === 'pre.scale' && node.dataset.input === 'number');
      input.value = '1.'; input.dispatch('input');
      if (action === 'node') find(root, node => node.dataset?.node === 'left-fit').dispatch('click');
      else if (action === 'profile') { const select = find(root, node => node.className === 'names-wall-mode'); select.value = 'model'; select.dispatch('change'); }
      else if (action === 'editor') find(root, node => node.dataset?.action === 'clock-editor-open').dispatch('click');
      else clickCommand(root, action);
      expect(client.apply).not.toHaveBeenCalled(); expect(client.save).not.toHaveBeenCalled(); expect(editorFactory).not.toHaveBeenCalled();
      expect(client.getState().draft).toEqual(DEFAULTS); expect(input.value).toBe('1.');
      expect(selected.mock.calls.every(([name, value]) => name !== 'selected' || value === true)).toBe(true);
      if (action === 'profile') expect(find(root, node => node.className === 'names-wall-mode').value).toBe('wall');
    } finally { api.dispose(); }
  });

  test.each(['apply', 'save-new'])('%s rejects a finite scalar that fails whole-candidate crop validation', action => {
    const root = element('main'); root.ownerDocument = documentStub(); const client = fakeClient(); const api = mountProjectionConfig(root, { client });
    try {
      const input = find(root, node => node.dataset?.field === 'outputs.left.crop.x0' && node.dataset.input === 'number');
      input.value = '99.99'; input.dispatch('input');
      clickCommand(root, action);
      expect(client.setDraft).not.toHaveBeenCalled(); expect(client.apply).not.toHaveBeenCalled(); expect(client.save).not.toHaveBeenCalled();
      expect(input.value).toBe('99.99'); expect(input.attributes['aria-invalid']).toBe('true');
    } finally { api.dispose(); }
  });

  test.each(['save', 'save-new'])('correcting a rejected crop to its original value clears validation before %s without a draft write', async action => {
    const root = element('main'); root.ownerDocument = documentStub(); const client = fakeClient();
    client.getState().snapshot.selectedPresetId = 'desk'; client.getState().snapshot.presets.push({ id: 'desk', name: 'Desk', config: clone(DEFAULTS) });
    const api = mountProjectionConfig(root, { client });
    const inputFor = path => find(root, node => node.dataset?.field === path && node.dataset.input === 'number');
    const errorFor = path => find(root, node => node.dataset?.errorFor === path);
    try {
      const path = 'outputs.left.crop.x0', input = inputFor(path);
      input.value = '85'; input.dispatch('input'); await api.handleAction(action, 'Desk');
      expect(client.save).not.toHaveBeenCalled(); expect(errorFor(path).textContent).toMatch(/extent/i);
      input.value = '0'; input.dispatch('input'); await api.handleAction(action, 'Desk');
      expect(client.save).toHaveBeenCalledTimes(1); expect(client.setDraft).not.toHaveBeenCalled(); expect(client.getState().draft).toEqual(DEFAULTS);
      for (const edge of ['x0', 'x1', 'y0', 'y1']) {
        const cropPath = `outputs.left.crop.${edge}`;
        expect(errorFor(cropPath).textContent).toBe(''); expect(inputFor(cropPath).attributes['aria-invalid']).toBe('false');
      }
    } finally { api.dispose(); }
  });

  test('explicit Cancel retires only the rejected field group and survives a status refresh without writing the draft', async () => {
    const root = element('main'); root.ownerDocument = documentStub(); const client = fakeClient(); const api = mountProjectionConfig(root, { client });
    const inputFor = path => find(root, node => node.dataset?.field === path && node.dataset.input === 'number');
    const errorFor = path => find(root, node => node.dataset?.errorFor === path);
    try {
      const draftBefore = clone(client.getState().draft);
      client.setDraft.mockClear(); client.apply.mockClear(); client.save.mockClear();
      const unrelated = inputFor('pre.scale'); unrelated.value = '1.'; unrelated.dispatch('input');
      const rejected = inputFor('outputs.left.crop.x0'); rejected.value = '60'; rejected.dispatch('input'); rejected.dispatch('blur');
      expect(errorFor('outputs.left.crop.x0').textContent).toMatch(/extent/i);
      expect(unrelated.value).toBe('1.'); expect(unrelated.attributes['aria-invalid']).toBe('true');
      find(find(root, node => node.dataset?.path === 'outputs.left.crop.x0'), node => node.dataset?.action === 'numeric-cancel-edit').dispatch('click');
      expect(rejected.value).toBe('0.00');
      for (const edge of ['x0', 'x1', 'y0', 'y1']) {
        const path = `outputs.left.crop.${edge}`;
        expect(errorFor(path).textContent).toBe(''); expect(inputFor(path).attributes['aria-invalid']).toBe('false');
      }
      expect(unrelated.value).toBe('1.'); expect(unrelated.attributes['aria-invalid']).toBe('true');
      await api.handleAction('live', false);
      expect(errorFor('outputs.left.crop.x0').textContent).toBe('');
      expect(unrelated.value).toBe('1.'); expect(unrelated.attributes['aria-invalid']).toBe('true');
      expect(client.getState().draft).toEqual(draftBefore);
      expect(client.setDraft).not.toHaveBeenCalled(); expect(client.apply).not.toHaveBeenCalled(); expect(client.save).not.toHaveBeenCalled();
    } finally { api.dispose(); }
  });

  test.each(['wall', 'model'])('profile-scoped Cancel retires the resolved %s error and preserves unrelated pending text', profile => {
    const root = element('main'); root.ownerDocument = documentStub(); const client = fakeClient();
    client.getState().draft.namesWall.activeMode = profile;
    client.getState().snapshot.config.namesWall.activeMode = profile;
    const api = mountProjectionConfig(root, { client });
    const font = find(root, node => node.dataset?.field === 'namesWall.requestedFontPx' && node.dataset.input === 'number');
    const pre = find(root, node => node.dataset?.field === 'pre.scale' && node.dataset.input === 'number');
    const fontError = find(root, node => node.dataset?.errorFor === 'namesWall.requestedFontPx');
    try {
      client.setDraft.mockClear(); client.apply.mockClear(); client.save.mockClear(); client.setLive.mockClear();
      pre.value = '1.'; pre.dispatch('input');
      font.value = '49'; font.dispatch('input'); font.dispatch('blur');
      expect(fontError.textContent).toMatch(/between 1 and 48 px/i);
      find(find(root, node => node.dataset?.path === 'namesWall.requestedFontPx'), node => node.dataset?.action === 'numeric-cancel-edit').dispatch('click');
      expect(fontError.textContent).toBe(''); expect(font.attributes['aria-invalid']).toBe('false');
      expect(pre.value).toBe('1.'); expect(pre.attributes['aria-invalid']).toBe('true');
      client.report({ pending: !client.getState().pending });
      expect(fontError.textContent).toBe(''); expect(pre.value).toBe('1.'); expect(pre.attributes['aria-invalid']).toBe('true');
      expect(client.setDraft).not.toHaveBeenCalled(); expect(client.apply).not.toHaveBeenCalled(); expect(client.save).not.toHaveBeenCalled(); expect(client.setLive).not.toHaveBeenCalled();
    } finally { api.dispose(); }
  });

  test('a foreign Model profile keeps pending Wall-only Cancel visible and Back works without writes', () => {
    const doc = documentStub(); const root = element('main'); root.ownerDocument = doc; const client = fakeClient();
    const api = mountProjectionConfig(root, { client });
    const inputFor = (container, path) => find(container, node => node.dataset?.field === path && node.dataset.input === 'number');
    const errorFor = path => find(root, node => node.dataset?.errorFor === path);
    try {
      client.setDraft.mockClear(); client.apply.mockClear(); client.save.mockClear(); client.setLive.mockClear();
      find(root, node => node.dataset?.node === 'names-wall').dispatch('click');
      find(root, node => node.className === 'config-enlarge-edit').dispatch('click');
      const panel = find(root, node => node.className === 'parameter-editor-dialog');
      const wallShift = inputFor(panel, 'namesWall.inwardShiftPercent');
      wallShift.value = '-'; wallShift.dispatch('input'); wallShift.dispatch('blur');
      const unrelatedPre = inputFor(root, 'pre.scale'); unrelatedPre.value = '1.'; unrelatedPre.dispatch('input');

      const foreignModel = clone(client.getState().draft);
      foreignModel.namesWall.activeMode = 'model';
      foreignModel.namesWall.profiles.model.requestedFontPx = 12;
      client.report({ draft: foreignModel, hasLocalDraft: false });

      const wallShiftWrap = find(panel, node => node.dataset?.path === 'namesWall.inwardShiftPercent');
      expect(find(panel, node => node.className === 'parameter-editor-title-context').textContent).toMatch(/Model/i);
      expect(wallShiftWrap.hidden).toBe(false);
      expect(find(wallShiftWrap, node => node.className === 'config-field-pending-target').textContent).toMatch(/Regular wall/i);
      const modelFont = inputFor(panel, 'namesWall.requestedFontPx');
      modelFont.value = '49'; modelFont.dispatch('input'); modelFont.dispatch('blur');
      expect(errorFor('namesWall.requestedFontPx').textContent).toMatch(/between 1 and 48 px/i);

      find(wallShiftWrap, node => node.dataset?.action === 'numeric-cancel-edit').dispatch('click');
      expect(wallShift.value).toBe('0');
      expect(errorFor('namesWall.inwardShiftPercent').textContent).toBe('');
      expect(errorFor('namesWall.requestedFontPx').textContent).toMatch(/between 1 and 48 px/i);
      expect(unrelatedPre.value).toBe('1.');
      client.report({ pending: !client.getState().pending });
      expect(find(panel, node => node.className === 'parameter-editor-title-context').textContent).toMatch(/Model/i);
      expect(errorFor('namesWall.requestedFontPx').textContent).toMatch(/between 1 and 48 px/i);
      expect(client.getState().draft.namesWall.activeMode).toBe('model');
      expect(client.getState().draft.namesWall.profiles.model.requestedFontPx).toBe(12);

      const modelFontWrap = find(panel, node => node.dataset?.path === 'namesWall.requestedFontPx');
      find(modelFontWrap, node => node.dataset?.action === 'numeric-cancel-edit').dispatch('click');
      find(panel, node => node.dataset?.action === 'parameter-editor-close').dispatch('click');
      expect(panel.hidden).toBe(true);
      expect(client.getState().draft.namesWall.activeMode).toBe('model');
      expect(client.getState().draft.namesWall.profiles.model.requestedFontPx).toBe(12);
      expect(client.getState().draft).toEqual(foreignModel);
      expect(client.setDraft).not.toHaveBeenCalled(); expect(client.apply).not.toHaveBeenCalled();
      expect(client.save).not.toHaveBeenCalled(); expect(client.setLive).not.toHaveBeenCalled();
    } finally { api.dispose(); }
  });

  test('header Escape retires rejected crop validation and its status refresh without writing state', () => {
    const doc = documentStub(); const root = element('main'); root.ownerDocument = doc; const client = fakeClient();
    const api = mountProjectionConfig(root, { client });
    const inputFor = (container, path) => find(container, node => node.dataset?.field === path && node.dataset.input === 'number');
    const errorFor = path => find(root, node => node.dataset?.errorFor === path);
    try {
      client.setDraft.mockClear(); client.apply.mockClear(); client.save.mockClear(); client.setLive.mockClear();
      find(root, node => node.dataset?.node === 'left-crop').dispatch('click');
      find(root, node => node.className === 'config-enlarge-edit').dispatch('click');
      const panel = find(root, node => node.className === 'parameter-editor-dialog');
      const x0 = inputFor(panel, 'outputs.left.crop.x0'); x0.value = '60'; x0.dispatch('input'); x0.dispatch('blur');
      expect(errorFor('outputs.left.crop.x0').textContent).toMatch(/extent/i);
      const back = find(panel, node => node.dataset?.action === 'parameter-editor-close'); doc.activeElement = back;
      doc.dispatch('keydown', { key: 'Escape', target: back, preventDefault() {} });
      expect(panel.hidden).toBe(false);
      for (const edge of ['x0', 'x1', 'y0', 'y1']) expect(errorFor(`outputs.left.crop.${edge}`).textContent).toBe('');
      client.report({ pending: !client.getState().pending });
      for (const edge of ['x0', 'x1', 'y0', 'y1']) expect(errorFor(`outputs.left.crop.${edge}`).textContent).toBe('');
      expect(client.getState().draft).toEqual(DEFAULTS);
      expect(client.setDraft).not.toHaveBeenCalled(); expect(client.apply).not.toHaveBeenCalled(); expect(client.save).not.toHaveBeenCalled(); expect(client.setLive).not.toHaveBeenCalled();
    } finally { api.dispose(); }
  });

  test('nudge finishes valid text before stepping, blocks invalid text, and resets its anchor after manual commit', () => {
    const root = element('main'); root.ownerDocument = documentStub(); const client = fakeClient(); const api = mountProjectionConfig(root, { client });
    const input = find(root, node => node.dataset?.field === 'pre.scale' && node.dataset.input === 'number');
    const plus = find(find(root, node => node.dataset?.path === 'pre.scale'), node => node.dataset?.direction === '1');
    try {
      input.value = '1.3'; input.dispatch('input'); plus.dispatch('click', { detail: 0 });
      expect(client.getState().draft.pre.scale).toBe(1.301);
      input.value = '1.5'; input.dispatch('input'); input.dispatch('blur');
      expect(client.getState().draft.pre.scale).toBe(1.5);
      plus.dispatch('click', { detail: 0 }); expect(client.getState().draft.pre.scale).toBe(1.501);
      input.value = '-'; input.dispatch('input'); plus.dispatch('click', { detail: 0 });
      expect(input.value).toBe('-'); expect(input.attributes['aria-invalid']).toBe('true'); expect(client.getState().draft.pre.scale).toBe(1.501);
      find(find(root, node => node.dataset?.path === 'pre.scale'), node => node.dataset?.action === 'numeric-cancel-edit').dispatch('click');
      expect(input.value).toBe('1.501'); expect(input.attributes['aria-invalid']).toBe('false');
      plus.dispatch('click', { detail: 0 }); expect(client.getState().draft.pre.scale).toBe(1.502);
    } finally { api.dispose(); }
  });

  test.each(['pre.scale', 'outputs.left.crop.x0'])('an unchanged crop correction retains another rejected pending edit at %s', async pendingPath => {
    const root = element('main'); root.ownerDocument = documentStub(); const client = fakeClient(); const api = mountProjectionConfig(root, { client });
    const inputFor = path => find(root, node => node.dataset?.field === path && node.dataset.input === 'number');
    const errorFor = path => find(root, node => node.dataset?.errorFor === path);
    try {
      const corrected = inputFor('outputs.left.crop.x1'); corrected.value = '0.1'; corrected.dispatch('input'); corrected.dispatch('blur');
      const pending = inputFor(pendingPath); pending.value = pendingPath === 'pre.scale' ? '9' : '85'; pending.dispatch('input'); pending.dispatch('blur');
      expect(errorFor(pendingPath).textContent).not.toBe('');
      corrected.value = '60'; corrected.dispatch('input'); corrected.dispatch('blur');
      expect(errorFor(pendingPath).textContent).not.toBe(''); expect(pending.attributes['aria-invalid']).toBe('true');
      await api.handleAction('save-new', 'Desk'); expect(client.save).not.toHaveBeenCalled(); expect(client.setDraft).not.toHaveBeenCalled();
      expect(pending.value).toBe(pendingPath === 'pre.scale' ? '9' : '85'); expect(errorFor(pendingPath).textContent).not.toBe(''); expect(pending.attributes['aria-invalid']).toBe('true');
    } finally { api.dispose(); }
  });

  test('unchanged crop correction leaves an actual deferred preflight alive without another draft notification or POST', async () => {
    const root = element('main'); root.ownerDocument = documentStub(); const h = replacementHarness(); const checks = [];
    const api = mountProjectionConfig(root, { client: h.client, candidateValidator: { validateCandidate: args => new Promise(resolve => checks.push({ ...args, resolve })), dispose() {} } });
    try {
      h.respond(h.snapshot); await vi.waitFor(() => expect(h.client.getState().hydrating).toBe(false)); h.client.setLive(false);
      const applying = h.client.apply(); await vi.waitFor(() => expect(checks).toHaveLength(1));
      const before = h.client.getState(); const listener = vi.fn(); const unsubscribe = h.client.subscribe(listener); listener.mockClear();
      const input = find(root, node => node.dataset?.field === 'outputs.left.crop.x0' && node.dataset.input === 'number');
      input.value = '85'; input.dispatch('input'); input.dispatch('blur'); input.value = '0'; input.dispatch('input'); input.dispatch('blur');
      expect(find(root, node => node.dataset?.errorFor === 'outputs.left.crop.x0').textContent).toBe('');
      expect(h.client.getState()).toEqual(before); expect(listener).not.toHaveBeenCalled(); expect(checks[0].signal.aborted).toBe(false); expect(h.requests).toHaveLength(0);
      unsubscribe(); checks[0].resolve({ identity: checks[0].identity, valid: true }); await vi.waitFor(() => expect(h.requests).toHaveLength(1));
      h.respond({ ...h.snapshot, revision: 1 }); await applying; expect(h.requests).toHaveLength(0); expect(checks).toHaveLength(1);
    } finally { api.dispose(); }
  });

  test.each(['load', 'revert', 'import'])('%s confirms pending text once and keeps the draft until replacement succeeds', async action => {
    const root = element('main'); root.ownerDocument = documentStub(); const confirm = vi.fn(() => false); root.ownerDocument.defaultView.confirm = confirm;
    const client = fakeClient(); let resolve; const replacement = new Promise(done => { resolve = done; });
    client.load.mockImplementation(() => replacement); client.revert.mockImplementation(() => replacement);
    const imported = vi.fn(() => replacement); const api = mountProjectionConfig(root, { client, onImport: imported });
    try {
      const input = find(root, node => node.dataset?.field === 'pre.scale' && node.dataset.input === 'number'); input.value = '1.'; input.dispatch('input');
      const trigger = () => action === 'import' ? api.handleAction('import', {}) : clickCommand(root, action);
      trigger(); expect(confirm).toHaveBeenCalledTimes(1); expect(client.load).not.toHaveBeenCalled(); expect(client.revert).not.toHaveBeenCalled(); expect(imported).not.toHaveBeenCalled();
      confirm.mockReturnValue(true); trigger(); expect(confirm).toHaveBeenCalledTimes(2); expect(client.getState().draft).toEqual(DEFAULTS); expect(client.setDraft).not.toHaveBeenCalled();
      expect(action === 'import' ? imported : client[action]).toHaveBeenCalledTimes(1);
      resolve(action === 'import' ? { config: clone(DEFAULTS) } : { draftReplaced: false }); await Promise.resolve();
    } finally { api.dispose(); }
  });

  test.each(['apply', 'save', 'save-new', 'node', 'profile', 'editor'])('%s rejects while a scalar range pointer is held', action => {
    const root = element('main'); root.ownerDocument = documentStub(); const client = fakeClient();
    client.getState().snapshot.selectedPresetId = 'desk'; client.getState().snapshot.presets.push({ id: 'desk', name: 'Desk', config: clone(DEFAULTS) });
    const api = mountProjectionConfig(root, { client });
    try {
      const range = find(root, node => node.dataset?.field === 'pre.scale' && node.dataset.input === 'range'); range.dispatch('pointerdown', { pointerId: 9 });
      const selected = vi.spyOn(find(root, node => node.dataset?.node === 'pre').classList, 'toggle');
      if (action === 'node') find(root, node => node.dataset?.node === 'left-fit').dispatch('click');
      else if (action === 'profile') { const select = find(root, node => node.className === 'names-wall-mode'); select.value = 'model'; select.dispatch('change'); }
      else if (action === 'editor') find(root, node => node.dataset?.action === 'parameter-editor-open').dispatch('click');
      else clickCommand(root, action);
      expect(client.apply).not.toHaveBeenCalled(); expect(client.save).not.toHaveBeenCalled(); expect(client.getState().draft).toEqual(DEFAULTS);
      expect(selected).toHaveBeenLastCalledWith('selected', true);
      expect(find(root, node => node.className === 'parameter-editor-dialog').hidden).toBe(true);
      range.dispatch('pointerup', { pointerId: 9 });
      api.handleAction('apply'); expect(client.apply).toHaveBeenCalledTimes(1);
    } finally { api.dispose(); }
  });

  test.each(['apply', 'save-new', 'node'])('%s rejects a held warp pointer', action => {
    const h = tracedWarpHarness();
    try {
      h.surface.dispatch('pointerdown', { pointerId: 4, isPrimary: true, button: 0, clientX: 72, clientY: 72, preventDefault() {} });
      h.surface.dispatch('pointermove', { pointerId: 4, clientX: 80, clientY: 72 });
      h.client.apply.mockClear(); h.client.save.mockClear();
      if (action === 'node') find(h.root, node => node.dataset?.node === 'pre').dispatch('click');
      else clickCommand(h.root, action);
      expect(h.client.apply).not.toHaveBeenCalled(); expect(h.client.save).not.toHaveBeenCalled();
      expect(find(h.root, node => node.className === 'action-error').textContent).toMatch(/active gesture/i);
    } finally { h.restore(); }
  });

  test.each(['load', 'revert'])('confirmed %s retires a held scalar range and ignores its remaining native events', async action => {
    const root = element('main'); root.ownerDocument = documentStub(); root.ownerDocument.defaultView.confirm = vi.fn(() => true);
    const client = fakeClient(); let resolve; client[action].mockImplementation(() => new Promise(done => { resolve = done; }));
    const api = mountProjectionConfig(root, { client });
    try {
      const range = find(root, node => node.dataset?.field === 'pre.scale' && node.dataset.input === 'range');
      find(find(root, n => n.dataset?.path === 'pre.scale'), n => n.dataset?.mode === 'coarse').dispatch('click');
      range.dispatch('pointerdown', { pointerId: 9 }); range.value = '1.5'; range.dispatch('input'); const draft = clone(client.getState().draft); client.setDraft.mockClear();
      api.handleAction(action, 'original'); expect(root.ownerDocument.defaultView.confirm).toHaveBeenCalledTimes(1);
      range.value = '2'; range.dispatch('input'); range.dispatch('change');
      expect(client.getState().draft).toEqual(draft); expect(client.setDraft).not.toHaveBeenCalled();
      range.dispatch('pointerup', { pointerId: 9 }); range.dispatch('change'); expect(client.setDraft).not.toHaveBeenCalled();
      resolve({ draftReplaced: false }); await Promise.resolve();
      range.dispatch('pointerdown', { pointerId: 10 }); range.value = '1.6'; range.dispatch('input'); range.dispatch('pointerup', { pointerId: 10 });
      expect(client.getState().draft.pre.scale).toBe(1.6); expect(client.setDraft).toHaveBeenCalledTimes(1);
    } finally { api.dispose(); }
  });

  test.each(['load', 'revert'])('confirmed %s retires a moved warp without publishing rollback before acknowledgement', async action => {
    const h = tracedWarpHarness(); const confirm = vi.fn(() => false); globalThis.document.defaultView.confirm = confirm;
    let resolve; h.client[action].mockImplementation(() => new Promise(done => { resolve = done; }));
    try {
      find(h.root, node => node.dataset?.action === 'warp-nudge' && node.dataset.direction === 'right').dispatch('click');
      expect(find(h.root, node => node.dataset?.action === 'warp-undo').disabled).toBe(false);
      h.surface.dispatch('pointerdown', { pointerId: 4, isPrimary: true, button: 0, clientX: 72, clientY: 72, preventDefault() {} });
      h.surface.dispatch('pointermove', { pointerId: 4, clientX: 82, clientY: 72 });
      const draft = clone(h.client.getState().draft); h.client.setDraft.mockClear(); h.client.apply.mockClear();
      const button = find(h.root, node => node.dataset?.action === action); button.dispatch('click');
      expect(confirm).toHaveBeenCalledTimes(1); expect(h.client[action]).not.toHaveBeenCalled();
      confirm.mockReturnValue(true); button.dispatch('click'); expect(confirm).toHaveBeenCalledTimes(2); expect(h.client[action]).toHaveBeenCalledTimes(1);
      h.surface.dispatch('pointerup', { pointerId: 4, clientX: 92, clientY: 72 });
      expect(h.client.getState().draft).toEqual(draft); expect(h.client.setDraft).not.toHaveBeenCalled(); expect(h.client.apply).not.toHaveBeenCalled();
      expect(find(h.root, node => node.dataset?.action === 'warp-undo').disabled).toBe(false);
      resolve({ draftReplaced: false }); await Promise.resolve();
      find(h.root, node => node.dataset?.action === 'apply').dispatch('click'); expect(h.client.apply).toHaveBeenCalledTimes(1);
      find(h.root, node => node.dataset?.action === 'warp-nudge' && node.dataset.direction === 'up').dispatch('click');
      expect(h.client.setDraft).toHaveBeenCalledTimes(1);
    } finally { h.restore(); }
  });

  test('commands finish the parameter dialog owner and preserve rejected text', () => {
    const root = element('main'); root.ownerDocument = documentStub(); const client = fakeClient(); const api = mountProjectionConfig(root, { client });
    try {
      find(root, node => node.dataset?.action === 'parameter-editor-open').dispatch('click');
      const dialog = find(root, node => node.className === 'parameter-editor-dialog');
      const input = find(dialog, node => node.dataset?.field === 'pre.scale' && node.dataset.input === 'number');
      input.value = '1.'; input.dispatch('input'); api.handleAction('apply'); expect(client.apply).not.toHaveBeenCalled(); expect(input.value).toBe('1.');
      input.value = '1.5'; input.dispatch('input'); api.handleAction('apply'); expect(client.apply).toHaveBeenCalledTimes(1); expect(client.getState().draft.pre.scale).toBe(1.5);
    } finally { api.dispose(); }
  });

  test.each(['apply', 'save-new'])('%s rejects conflicted text until the operator chooses a conflict action', action => {
    const root = element('main'); root.ownerDocument = documentStub(); const client = fakeClient(); const api = mountProjectionConfig(root, { client });
    try {
      const input = find(root, node => node.dataset?.field === 'pre.scale' && node.dataset.input === 'number'); input.value = '1.5'; input.dispatch('input');
      const next = clone(DEFAULTS); next.pre.scale = 2; client.report({ draft: next });
      api.handleAction(action, 'Desk'); expect(client.apply).not.toHaveBeenCalled(); expect(client.save).not.toHaveBeenCalled(); expect(client.getState().draft).toEqual(next);
      const field = find(root, node => node.dataset?.path === 'pre.scale'); field.children.find(node => node.dataset?.action === 'numeric-use-latest').dispatch('click');
      api.handleAction(action, 'Desk'); expect(action === 'apply' ? client.apply : client.save).toHaveBeenCalledTimes(1); expect(client.getState().draft).toEqual(next);
    } finally { api.dispose(); }
  });

  test('controller bounds errors report percentage display units and retain text for correction', () => {
    const root = element('main'); root.ownerDocument = documentStub(); const client = fakeClient(); const api = mountProjectionConfig(root, { client });
    try {
      const input = find(root, node => node.dataset?.field === 'pre.tx' && node.dataset.input === 'number'); input.value = '201'; input.dispatch('input');
      api.handleAction('apply'); expect(client.apply).not.toHaveBeenCalled(); expect(client.setDraft).not.toHaveBeenCalled(); expect(input.value).toBe('201');
      expect(find(root, node => node.dataset?.errorFor === 'pre.tx').textContent).toBe('must be between -200 and 200 %');
      input.value = '150'; input.dispatch('input'); api.handleAction('apply'); expect(client.getState().draft.pre.tx).toBe(1.5); expect(client.apply).toHaveBeenCalledTimes(1);
    } finally { api.dispose(); }
  });
  test.each(['identity', 'disabled', 'identity peer'])('pending TD load suspends full-config editor writes from %s and preserves latest fields', async (kind) => {
    const previousDocument = globalThis.document, previousFetch = globalThis.fetch;
    globalThis.document = documentStub();
    const f = await projectionCatalog('/otef-interactive/public/projection-calibration/td-baselines/');
    const gate = deferred();
    globalThis.fetch = vi.fn((url, options) => url.endsWith('manifest.json') ? gate.promise : f.fetchImpl(url, options));
    const client = fakeClient();
    if (kind === 'disabled') { const initial = clone(DEFAULTS); initial.outputs.left.warp.enabled = false; client.report({ draft: initial }); }
    const root = element('main');
    const api = mountProjectionConfig(root, { client });
    const action = (name) => find(root, (node) => node.dataset?.action === name);
    try {
      const output = kind === 'identity peer' ? 'right' : 'left';
      find(root, (node) => node.dataset?.node === `${output}-keystone`).dispatch('click');
      find(root, (node) => node.dataset?.action === 'warp-nudge' && node.dataset.direction === 'right').dispatch('click');
      const pending = f.config('selected'); pending.outputs.right.warp = clone(DEFAULTS.outputs.right.warp);
      pending.pre.tx = 0.12; pending.outputs.left.post.ty = -0.08;
      client.report({ draft: pending, hasLocalDraft: true });
      const input = find(root, (node) => node.dataset?.field === 'pre.tx' && node.dataset.input === 'number');
      expect(input).not.toBeNull(); input.value = '15'; input.dispatch('input'); input.dispatch('input'); input.dispatch('blur');
      const latest = clone(client.getState().draft);
      expect(latest.pre.tx).toBe(0.15);
      client.setDraft.mockClear(); client.apply.mockClear();
      for (const name of ['warp-undo', 'warp-redo', 'warp-reset-selection']) action(name).dispatch('click');
      find(root, (node) => node.dataset?.action === 'warp-nudge' && node.dataset.direction === 'up').dispatch('click');
      const numeric = find(root, (node) => node.attributes?.['aria-label'] === 'Selected warp X position');
      numeric.value = '32'; numeric.dispatch('change');
      expect(client.getState().draft).toEqual(latest);
      expect(client.setDraft).not.toHaveBeenCalled(); expect(client.apply).not.toHaveBeenCalled();
      gate.resolve(response(new TextEncoder().encode(JSON.stringify(f.manifestB))));
      await vi.waitFor(() => expect(find(root, (node) => node.textContent?.includes('TD baseline unavailable'))).toBeNull());
      expect(action('warp-undo').disabled).toBe(true);
      find(root, (node) => node.dataset?.action === 'warp-nudge' && node.dataset.direction === 'up').dispatch('click');
      expect(client.getState().draft.pre).toEqual(latest.pre);
      expect(client.getState().draft.outputs.left.post).toEqual(latest.outputs.left.post);
      expect(client.getState().draft.outputs.left.warp.baseline).toEqual(latest.outputs.left.warp.baseline);
    } finally { api.dispose(); globalThis.document = previousDocument; globalThis.fetch = previousFetch; }
  });

  test.each(['accept', 'switchback', 'dispose'])('editor fresh catalog %s preserves matching mesh, latest config and history without stale installation', async (operation) => {
    const previousDocument = globalThis.document; globalThis.document = documentStub();
    const f = await projectionCatalog('/otef-interactive/public/projection-calibration/td-baselines/');
    const gate = deferred(); let deferFraming = false;
    const fetchImpl = vi.fn((url, options) => deferFraming && url.endsWith('framing.json') ? gate.promise : f.fetchImpl(url, options));
    const loader = createProjectionBaselineCatalogLoader({ fetchImpl, base: f.base, initialSnapshot: f.snapshotA });
    const promote = vi.spyOn(loader, 'promote');
    const client = fakeClient(); client.setLive(false); client.report({ draft: f.config(), hasLocalDraft: true });
    const root = element('main'); const api = mountProjectionConfig(root, { client, baselineCatalogLoader: loader });
    const action = (name) => find(root, (node) => node.dataset?.action === name);
    const handle = () => find(root, (node) => node.attributes?.['data-index'] === '3' && node.attributes?.class?.includes('warp-handle'));
    try {
      action('warp-editor-open').dispatch('click');
      find(root, (node) => node.dataset?.node === 'left-grid').dispatch('click');
      await vi.waitFor(() => expect(promote).toHaveBeenCalledTimes(1));
      find(root, (node) => node.dataset?.action === 'warp-nudge' && node.dataset.direction === 'up').dispatch('click');
      const configA = clone(client.getState().draft), cxA = handle().attributes.cx;
      expect(action('warp-undo').disabled).toBe(false);
      deferFraming = true; const configB = f.config('selected'); configB.pre.tx = 0.17;
      client.report({ draft: configB, hasLocalDraft: true });
      await vi.waitFor(() => expect(fetchImpl.mock.calls.some(([url]) => url.endsWith('framing.json'))).toBe(true));
      const latest = clone(configB); latest.pre.tx = 0.23; latest.outputs.right.post.tx = -0.04;
      client.report({ draft: latest, hasLocalDraft: true });
      const priorDraftWrites = client.setDraft.mock.calls.length;
      if (operation === 'switchback') client.report({ draft: configA, hasLocalDraft: true });
      if (operation === 'dispose') api.dispose();
      const undo = action('warp-undo');
      const cxBeforeCompletion = handle()?.attributes.cx, undoBeforeCompletion = undo?.disabled;
      gate.resolve(response(f.payloads.get(`${f.base}framing.json`))); await new Promise((done) => setTimeout(done, 10));
      expect(client.setDraft.mock.calls.length).toBe(priorDraftWrites); expect(client.apply).not.toHaveBeenCalled();
      if (operation === 'accept') {
        await vi.waitFor(() => expect(promote).toHaveBeenCalledTimes(2));
        expect(handle().attributes.cx).not.toBe(cxA); expect(client.getState().draft).toEqual(latest);
        expect(action('warp-undo').disabled).toBe(true); expect(loader.getSnapshot().manifest).toEqual(f.manifestB);
        const prepared = await loader.prepare(latest); expect(prepared.loaded.left.manifest).toBe(prepared.loaded.right.manifest);
        const before = fetchImpl.mock.calls.filter(([url]) => url.endsWith('manifest.json') || url.endsWith('framing.json')).length;
        find(root, (node) => node.dataset?.node === 'left-grid').dispatch('click');
        find(root, (node) => node.dataset?.action === 'warp-nudge' && node.dataset.direction === 'up').dispatch('click');
        expect(fetchImpl.mock.calls.filter(([url]) => url.endsWith('manifest.json') || url.endsWith('framing.json')).length).toBe(before);
      } else {
        expect(promote).toHaveBeenCalledTimes(1); expect(loader.getSnapshot()).toBe(f.snapshotA);
        expect(handle()?.attributes.cx).toBe(cxBeforeCompletion); expect(undo?.disabled).toBe(undoBeforeCompletion);
        if (operation === 'switchback') {
          expect(client.getState().draft).toEqual(configA); expect(handle().attributes.cx).toBe(cxA); expect(action('warp-undo').disabled).toBe(false);
          deferFraming = false; client.report({ draft: configB, hasLocalDraft: true });
          await vi.waitFor(() => expect(promote).toHaveBeenCalledTimes(2)); expect(f.count('manifest.json')).toBe(2);
        }
      }
    } finally { api.dispose(); globalThis.document = previousDocument; }
  });

  test('pending baseline switch discards an active pointer without publishing rollback or retaining its drag after switchback', async () => {
    const previousDocument = globalThis.document; globalThis.document = documentStub();
    const f = await projectionCatalog('/otef-interactive/public/projection-calibration/td-baselines/'), gate = deferred();
    const loader = createProjectionBaselineCatalogLoader({ base: f.base, initialSnapshot: f.snapshotA,
      fetchImpl: (url, options) => url.endsWith('framing.json') ? gate.promise : f.fetchImpl(url, options) });
    const client = fakeClient(); client.setLive(false);
    const candidateValidator = { validateCandidate: async ({ identity }) => ({ identity, valid: true }), dispose() {} };
    const root = element('main'), api = mountProjectionConfig(root, { client, baselineCatalogLoader: loader, candidateValidator });
    try {
      find(root, (node) => node.dataset?.action === 'warp-editor-open' && node.parentElement?.dataset?.node === 'left-grid').dispatch('click');
      const surface = find(root, (node) => node.attributes?.class === 'warp-edit-surface');
      surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 2064, height: 1224 });
      surface.dispatch('pointerdown', { pointerId: 1, isPrimary: true, button: 0, clientX: 72, clientY: 72, preventDefault() {} });
      surface.dispatch('pointermove', { pointerId: 1, clientX: 82, clientY: 72 });
      const previous = clone(client.getState().draft), pending = f.config('selected');
      expect(previous.outputs.left.warp.grid.offsets[0][0]).toBeGreaterThan(0);
      const count = client.setDraft.mock.calls.length;
      client.report({ draft: pending, hasLocalDraft: true });
      surface.dispatch('pointerup', { pointerId: 1, clientX: 92, clientY: 72 });
      expect(client.setDraft.mock.calls.length).toBe(count); expect(client.getState().draft).toEqual(pending);
      client.report({ draft: previous, hasLocalDraft: true });
      const columns = find(root, (node) => node.dataset?.gridLayoutField === 'columns');
      columns.value = '4'; columns.dispatch('input'); columns.dispatch('blur');
      const confirm = find(root, (node) => node.dataset?.action === 'warp-grid-layout-confirm');
      await vi.waitFor(() => expect(confirm.disabled).toBe(false));
      confirm.dispatch('click');
      await vi.waitFor(() => expect(client.getState().draft.outputs.left.warp.grid.columns).toBe(4));
      expect(client.getState().draft.pre).toEqual(previous.pre);
      gate.resolve(response(f.payloads.get(`${f.base}framing.json`))); await new Promise((done) => setTimeout(done, 10));
      expect(client.getState().draft.outputs.left.warp.baseline.type).toBe('identity');
    } finally { api.dispose(); globalThis.document = previousDocument; }
  });

  test.each(['key order', 'hash case', 'local fields'])('equivalent TD reference preserves history: %s', async (kind) => {
    const previousDocument = globalThis.document, previousFetch = globalThis.fetch;
    globalThis.document = documentStub();
    const f = await projectionCatalog('/otef-interactive/public/projection-calibration/td-baselines/'); globalThis.fetch = f.fetchImpl;
    const client = fakeClient(); client.setLive(false); client.report({ draft: f.config('selected'), hasLocalDraft: true });
    const root = element('main'); const api = mountProjectionConfig(root, { client });
    try {
      find(root, (node) => node.dataset?.node === 'left-keystone').dispatch('click');
      await vi.waitFor(() => expect(f.count('selected/left.json')).toBe(1));
      await vi.waitFor(() => expect(find(root, (node) => node.textContent?.includes('TD baseline unavailable'))).toBeNull());
      find(root, (node) => node.dataset?.action === 'warp-nudge' && node.dataset.direction === 'up').dispatch('click');
      const candidate = clone(client.getState().draft);
      if (kind === 'key order') candidate.outputs.left.warp.baseline = Object.fromEntries(Object.entries(candidate.outputs.left.warp.baseline).reverse());
      if (kind === 'hash case') candidate.outputs.left.warp.baseline.sha256 = candidate.outputs.left.warp.baseline.sha256.toUpperCase();
      if (kind === 'local fields') candidate.pre.ty = 0.08;
      client.report({ draft: candidate, hasLocalDraft: true });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const undo = find(root, (node) => node.dataset?.action === 'warp-undo');
      expect(undo.disabled).toBe(false); expect(f.count('manifest.json')).toBe(1); expect(f.count('selected/left.json')).toBe(1);
      undo.dispatch('click'); expect(client.getState().draft.pre).toEqual(candidate.pre);
      client.report({ draft: candidate, snapshot: { ...client.getState().snapshot, config: candidate, selectedPresetId: 'accepted-other' }, hasLocalDraft: false });
      expect(undo.disabled).toBe(true);
    } finally { api.dispose(); globalThis.document = previousDocument; globalThis.fetch = previousFetch; }
  });
  test('switching A to pending B and back to A restores the matching editor mesh and ignores delayed B', async () => {
    const previousDocument = globalThis.document;
    const previousFetch = globalThis.fetch;
    globalThis.document = documentStub();
    const configA = clone(DEFAULTS);
    const configB = clone(DEFAULTS);
    const meshBytes = (scale) => {
      const mesh = createIdentityProjectionMesh({ side: 'left' });
      mesh.logicalGrid = { columns: 7, rows: 7 };
      mesh.vertices.forEach((point) => { point.x *= scale; });
      return new TextEncoder().encode(JSON.stringify(mesh));
    };
    const bytesA = meshBytes(0.85);
    const bytesB = meshBytes(0.72);
    const hashA = await sha256Hex(bytesA);
    const hashB = await sha256Hex(bytesB);
    const framingBytes = new TextEncoder().encode(JSON.stringify(DEFAULTS));
    const framingHash = await sha256Hex(framingBytes);
    const entry = (assetId, path, sha256) => ({ assetId, path, sha256, logicalGrid: { columns: 7, rows: 7 } });
    const manifest = { schemaVersion: 1, width: 1920, height: 1080,
      assets: { left: entry('legacy-left', 'legacy-left.json', hashA), right: { ...entry('legacy-right', 'legacy-right.json', hashA), logicalGrid: { columns: 8, rows: 7 } } },
      catalog: { left: [entry('capture-A', 'capture-A.json', hashA), entry('capture-B', 'capture-B.json', hashB)], right: [] },
      framing: { path: '../td-source-config.json', sha256: framingHash } };
    configA.outputs.left.warp.baseline = { type: 'tdMesh', assetId: 'capture-A', sha256: hashA, width: 1920, height: 1080, origin: 'top-left' };
    configB.outputs.left.warp.baseline = { type: 'tdMesh', assetId: 'capture-B', sha256: hashB, width: 1920, height: 1080, origin: 'top-left' };
    let releaseA;
    let releaseB;
    globalThis.fetch = vi.fn(async (url) => {
      if (url.endsWith('manifest.json')) return { ok: true, async arrayBuffer() { return new TextEncoder().encode(JSON.stringify(manifest)).buffer; } };
      if (url.endsWith('td-source-config.json')) return { ok: true, async arrayBuffer() { return framingBytes.buffer; } };
      if (url.endsWith('capture-A.json')) return new Promise((resolve) => { releaseA = () => resolve({ ok: true, async arrayBuffer() { return bytesA.buffer; } }); });
      if (url.endsWith('capture-B.json')) return new Promise((resolve) => { releaseB = () => resolve({ ok: true, async arrayBuffer() { return bytesB.buffer; } }); });
      throw new Error(`unexpected fixture request: ${url}`);
    });
    const root = element('main'); root.ownerDocument = globalThis.document;
    const client = fakeClient();
    const api = mountProjectionConfig(root, { client });
    try {
      find(root, (node) => node.dataset?.action === 'warp-editor-open' && node.parentElement?.dataset?.node === 'left-grid').dispatch('click');
      const handles = () => find(root, (node) => node.attributes?.['aria-label'] === 'Warp editing handles');
      const handle3 = () => find(root, (node) => node.attributes?.['data-index'] === '3' && node.attributes?.class?.includes('warp-handle'));
      const identityCx = handle3().attributes.cx;
      client.report({ draft: configA, hasLocalDraft: true });
      await vi.waitFor(() => expect(releaseA).toEqual(expect.any(Function)));
      releaseA();
      await vi.waitFor(() => expect(handle3().attributes.cx).not.toBe(identityCx));
      const cxA = handle3().attributes.cx;
      find(root, (node) => node.dataset?.action === 'warp-nudge' && node.dataset.direction === 'up').dispatch('click');
      expect(client.getState().draft.outputs.left.warp.baseline.assetId).toBe('capture-A');
      client.report({ draft: configB, hasLocalDraft: true });
      await vi.waitFor(() => expect(releaseB).toEqual(expect.any(Function)));
      await vi.waitFor(() => expect(find(root, (node) => node.textContent?.includes('TD baseline unavailable'))).not.toBeNull());
      client.report({ draft: configA, hasLocalDraft: true });
      await vi.waitFor(() => expect(handle3().attributes.cx).toBe(cxA));
      releaseB();
      await Promise.resolve(); await Promise.resolve();
      expect(handle3().attributes.cx).toBe(cxA);
      find(root, (node) => node.dataset?.action === 'warp-nudge' && node.dataset.direction === 'up').dispatch('click');
      expect(client.getState().draft.outputs.left.warp.baseline.assetId).toBe('capture-A');
      expect(handles().children.length).toBeGreaterThan(0);
    } finally {
      api.dispose(); globalThis.document = previousDocument; globalThis.fetch = previousFetch;
    }
  });

  test.each(["left-keystone", "right-keystone", "left-grid", "right-grid"])("%s retains its noninitial selection and navigation on ordinary reopen", (nodeId) => {
    const previousDocument = globalThis.document; const doc = documentStub();
    const events = new Map(); doc.defaultView.addEventListener = (type, fn) => events.set(type, fn);
    doc.defaultView.removeEventListener = (type) => events.delete(type); globalThis.document = doc;
    const root = element("main"); const client = fakeClient(); client.setLive(false);
    const api = mountProjectionConfig(root, { client });
    try {
      const action = (name) => find(root, (node) => node.dataset?.action === name);
      const card = find(root, (node) => node.dataset?.node === nodeId);
      const open = find(card, (node) => node.dataset?.action === "warp-editor-open"); open.dispatch("click");
      const surface = find(root, (node) => node.attributes?.["aria-label"] === "Warp editing handles");
      find(surface, (node) => node.attributes?.["data-index"] === "3").dispatch("keydown", { key: "Enter" });
      find(root, (node) => node.dataset?.action === "warp-nudge" && node.dataset.direction === "left").dispatch("click");
      const selectedStatus = find(root, (node) => node.className === "warp-selection-status").textContent;
      const pan = find(root, (node) => node.className === "warp-pan-toggle"); pan.dispatch("click");
      find(root, (node) => node.className === "warp-view-zoom-in").dispatch("click");
      const viewBox = surface.attributes.viewBox;
      action("warp-editor-close").dispatch("click"); open.dispatch("click");
      expect(find(root, (node) => node.className === "warp-selection-status").textContent).toBe(selectedStatus);
      expect(pan.attributes["aria-pressed"]).toBe("true"); expect(surface.attributes.viewBox).toBe(viewBox);
      expect(action("warp-undo").disabled).toBe(false);
      const output = nodeId.split("-")[0]; const mode = nodeId.split("-")[1];
      const before = clone(client.getState().draft.outputs[output].warp);
      find(root, (node) => node.dataset?.action === "warp-nudge" && node.dataset.direction === "left").dispatch("click");
      const after = client.getState().draft.outputs[output].warp;
      const points = (warp) => mode === "grid" ? warp.grid.offsets : warp.keystone.corners;
      expect(points(after)[0]).toEqual(points(before)[0]); expect(points(after)[3][0]).toBeLessThan(points(before)[3][0]);
      events.get("orientationchange")?.({ type: "orientationchange" });
      expect(find(root, (node) => node.className === "warp-selection-status").textContent).toBe(selectedStatus);
      expect(pan.attributes["aria-pressed"]).toBe("true"); expect(surface.attributes.viewBox).toBe(viewBox);
      action("warp-undo").dispatch("click"); expect(client.getState().draft.outputs[output].warp).toEqual(before);
      action("warp-redo").dispatch("click"); expect(client.getState().draft.outputs[output].warp).toEqual(after);
    } finally { api.dispose(); globalThis.document = previousDocument; }
  });
  test("both pattern controls follow the single active output and stop refreshes on Off", () => {
    const previousDocument = globalThis.document; globalThis.document = documentStub(); vi.useFakeTimers();
    const root = element("main"); const socket = { send: vi.fn(), on() {}, off() {} };
    const api = mountProjectionConfig(root, { client: fakeClient(), socket });
    try {
      const left = find(root, (node) => node.attributes?.["aria-label"] === "Left output test pattern");
      const right = find(root, (node) => node.attributes?.["aria-label"] === "Right output test pattern");
      left.value = "grid"; left.dispatch("change"); expect([left.value, right.value]).toEqual(["grid", "off"]);
      right.value = "output_id"; right.dispatch("change"); expect([left.value, right.value]).toEqual(["off", "output_id"]);
      left.value = "off"; left.dispatch("change"); expect([left.value, right.value]).toEqual(["off", "off"]);
      const patterns = () => socket.send.mock.calls.map(([m]) => m).filter((m) => m.type === "otef_projection_pattern");
      expect(patterns().map((m) => `${m.output}:${m.pattern}`)).toEqual(["left:grid", "left:off", "right:output_id", "right:off"]);
      vi.advanceTimersByTime(2100); expect(patterns()).toHaveLength(4);
      right.value = "grid"; right.dispatch("change"); vi.advanceTimersByTime(1100); expect(patterns().at(-1)).toMatchObject({ output: "right", pattern: "grid" });
      api.dispose(); const count = patterns().length; vi.advanceTimersByTime(2100); expect(patterns()).toHaveLength(count);
    } finally { api.dispose(); vi.useRealTimers(); globalThis.document = previousDocument; }
  });

  test.each(["save", "save-new"])("stale successful %s cannot retarget the protected checkpoint or next Save", async (operation) => {
    const previousDocument = globalThis.document; globalThis.document = documentStub();
    const h = replacementHarness(); h.snapshot.selectedPresetId = h.presetId;
    const foreignId = "22222222-2222-4222-8222-222222222222";
    h.snapshot.presets.push({ id: foreignId, name: "Foreign desk", config: clone(DEFAULTS), readOnly: false });
    const root = element("main"); const api = mountProjectionConfig(root, { client: h.client, candidateValidator: { validateCandidate: async ({ identity }) => ({ identity, valid: true }), dispose() {} } });
    try {
      h.respond(h.snapshot); await vi.waitFor(() => expect(h.client.getState().hydrating).toBe(false)); h.client.setLive(false);
      const action = (name) => find(root, (node) => node.dataset?.action === name);
      const nudge = () => find(root, (node) => node.dataset?.action === "warp-nudge" && node.dataset.direction === "right").dispatch("click");
      find(root, (node) => node.dataset?.node === "left-keystone").dispatch("click"); nudge();
      clickCommand(root, operation); await vi.waitFor(() => expect(h.requests).toHaveLength(1));
      nudge(); const draft = h.client.getState().draft;
      h.foreign({ ...h.snapshot, revision: 2, selectedPresetId: foreignId });
      h.respond({ ...h.snapshot, revision: 1 }); await vi.waitFor(() => expect(h.client.getState().pending).toBe(false));
      expect(find(root, (node) => node.className === "loaded-preset-identity").textContent).toBe("Loaded: Desk");
      expect(find(root, (node) => node.attributes?.["aria-label"] === "Preset name").value).toBe("Desk");
      expect(h.client.getState().draft).toEqual(draft); expect(action("warp-undo").disabled).toBe(false);
      action("save").dispatch("click"); await vi.waitFor(() => expect(h.requests).toHaveLength(1));
      expect(JSON.parse(h.requests[0].options.body).presetId).toBe(h.presetId);
      h.respond({ ...h.snapshot, revision: 3, config: draft }); await vi.waitFor(() => expect(h.client.getState().pending).toBe(false));
    } finally { api.dispose(); globalThis.document = previousDocument; }
  });

  test.each(["save", "save-new", "save-new-own-websocket"])("clean working %s acknowledgement preserves completed warp history", async (operation) => {
    const previousDocument = globalThis.document; globalThis.document = documentStub();
    const h = replacementHarness(); h.snapshot.selectedPresetId = h.presetId;
    const root = element("main"); const api = mountProjectionConfig(root, { client: h.client, candidateValidator: { validateCandidate: async ({ identity }) => ({ identity, valid: true }), dispose() {} } });
    try {
      h.respond(h.snapshot); await vi.waitFor(() => expect(h.client.getState().hydrating).toBe(false)); h.client.setLive(false);
      const action = (name) => find(root, (node) => node.dataset?.action === name);
      const open = find(find(root, (node) => node.dataset?.node === "left-keystone"), (node) => node.dataset?.action === "warp-editor-open"); open.dispatch("click");
      const surface = find(root, (node) => node.attributes?.["aria-label"] === "Warp editing handles");
      find(surface, (node) => node.attributes?.["data-index"] === "3").dispatch("keydown", { key: "Enter" });
      const pan = find(root, (node) => node.className === "warp-pan-toggle"); pan.dispatch("click");
      find(root, (node) => node.className === "warp-view-zoom-in").dispatch("click"); const viewBox = surface.attributes.viewBox;
      find(root, (node) => node.dataset?.action === "warp-nudge" && node.dataset.direction === "right").dispatch("click");
      const accepted = h.client.getState().draft; action("apply").dispatch("click");
      await vi.waitFor(() => expect(h.requests).toHaveLength(1));
      const working = { ...h.snapshot, revision: 1, config: accepted };
      h.respond(working); await vi.waitFor(() => expect(h.client.getState().pending).toBe(false));
      expect(h.client.getState().hasLocalDraft).toBe(false); expect(action("warp-undo").disabled).toBe(false);
      const id = operation === "save" ? h.presetId : "33333333-3333-4333-8333-333333333333";
      clickCommand(root, operation === "save" ? "save" : "save-new");
      await vi.waitFor(() => expect(h.requests).toHaveLength(1));
      const saved = { ...working, revision: 2, selectedPresetId: id, presets: [...working.presets.filter((p) => p.id !== id), { id, name: "Desk", config: accepted, readOnly: false }] };
      if (operation.endsWith("websocket")) { h.own(saved); expect(action("warp-undo").disabled).toBe(false); }
      h.respond(saved); await vi.waitFor(() => expect(h.client.getState().pending).toBe(false));
      expect(action("warp-undo").disabled).toBe(false);
      expect(find(root, (node) => node.className === "warp-selection-status").textContent).toContain("Bottom-right corner");
      expect(pan.attributes["aria-pressed"]).toBe("true"); expect(surface.attributes.viewBox).toBe(viewBox);
      expect(find(root, (node) => node.attributes?.["aria-label"] === "Preset").value).toBe(id);
      // A later accepted external checkpoint selection still establishes a baseline,
      // even when it has exactly the same working geometry as the own Save.
      h.foreign({ ...saved, revision: 3, selectedPresetId: "original" });
      expect(action("warp-undo").disabled).toBe(true);
      find(root, (node) => node.dataset?.action === "warp-nudge" && node.dataset.direction === "left").dispatch("click");
      action("warp-undo").dispatch("click"); expect(h.client.getState().draft.outputs.left.warp).toEqual(accepted.outputs.left.warp);
    } finally { api.dispose(); globalThis.document = previousDocument; }
  });

  test.each(["save", "save-new"])("an edit during successful %s preserves loaded identity and the next overwrite target", async (operation) => {
    const previousDocument = globalThis.document; globalThis.document = documentStub();
    const h = replacementHarness(); h.snapshot.selectedPresetId = h.presetId;
    const root = element("main"); const api = mountProjectionConfig(root, { client: h.client, candidateValidator: { validateCandidate: async ({ identity }) => ({ identity, valid: true }), dispose() {} } });
    try {
      h.respond(h.snapshot); await vi.waitFor(() => expect(h.client.getState().hydrating).toBe(false)); h.client.setLive(false);
      const action = (name) => find(root, (node) => node.dataset?.action === name);
      const nudge = () => find(root, (node) => node.dataset?.action === "warp-nudge" && node.dataset.direction === "left").dispatch("click");
      find(root, (node) => node.dataset?.node === "right-keystone").dispatch("click"); nudge();
      clickCommand(root, operation); await vi.waitFor(() => expect(h.requests).toHaveLength(1));
      const sent = JSON.parse(h.requests[0].options.body); nudge(); const draft = h.client.getState().draft;
      const id = operation === "save" ? h.presetId : "33333333-3333-4333-8333-333333333333";
      const saved = { ...h.snapshot, revision: 1, config: sent.config, selectedPresetId: id, presets: [...h.snapshot.presets.filter((p) => p.id !== id), { id, name: sent.name, config: sent.config, readOnly: false }] };
      h.respond(saved); await vi.waitFor(() => expect(h.client.getState().pending).toBe(false));
      expect(find(root, (node) => node.className === "loaded-preset-identity").textContent).toBe("Loaded: Desk");
      expect(h.client.getState()).toMatchObject({ draft, hasLocalDraft: true }); expect(action("warp-undo").disabled).toBe(false);
      action("save").dispatch("click"); await vi.waitFor(() => expect(h.requests).toHaveLength(1));
      expect(JSON.parse(h.requests[0].options.body).presetId).toBe(h.presetId);
      h.respond({ ...saved, revision: 2, selectedPresetId: h.presetId, config: draft, presets: saved.presets.map((p) => p.id === h.presetId ? { ...p, config: draft } : p) });
      await vi.waitFor(() => expect(h.client.getState().pending).toBe(false));
    } finally { api.dispose(); globalThis.document = previousDocument; }
  });

  test("a newer queued Load owns loaded identity after an earlier Save as new acknowledgement", async () => {
    const previousDocument = globalThis.document; globalThis.document = documentStub();
    const h = replacementHarness(); h.snapshot.selectedPresetId = h.presetId;
    const root = element("main"); const api = mountProjectionConfig(root, { client: h.client, candidateValidator: { validateCandidate: async ({ identity }) => ({ identity, valid: true }), dispose() {} } });
    try {
      h.respond(h.snapshot); await vi.waitFor(() => expect(h.client.getState().hydrating).toBe(false)); h.client.setLive(false);
      const action = (name) => find(root, (node) => node.dataset?.action === name);
      find(root, (node) => node.dataset?.node === "left-keystone").dispatch("click");
      find(root, (node) => node.dataset?.action === "warp-nudge" && node.dataset.direction === "right").dispatch("click");
      const draft = h.client.getState().draft; clickCommand(root, "save-new");
      await vi.waitFor(() => expect(h.requests).toHaveLength(1));
      const preset = find(root, (node) => node.attributes?.["aria-label"] === "Preset"); preset.value = h.presetId; preset.dispatch("change"); action("load").dispatch("click");
      const id = "33333333-3333-4333-8333-333333333333";
      const saved = { ...h.snapshot, revision: 1, config: draft, selectedPresetId: id, presets: [...h.snapshot.presets, { id, name: "Desk copy", config: draft, readOnly: false }] };
      h.respond(saved); await vi.waitFor(() => expect(h.requests).toHaveLength(1));
      expect(JSON.parse(h.requests[0].options.body)).toMatchObject({ action: "load", presetId: h.presetId });
      h.respond({ ...saved, revision: 2, config: h.snapshot.config, selectedPresetId: h.presetId });
      await vi.waitFor(() => expect(h.client.getState().pending).toBe(false));
      expect(preset.value).toBe(h.presetId); expect(find(root, (node) => node.className === "loaded-preset-identity").textContent).toBe("Loaded: Desk");
      expect(action("warp-undo").disabled).toBe(true);
      action("save").dispatch("click"); await vi.waitFor(() => expect(h.requests).toHaveLength(1));
      expect(JSON.parse(h.requests[0].options.body).presetId).toBe(h.presetId);
      h.respond({ ...saved, revision: 3, config: h.snapshot.config, selectedPresetId: h.presetId }); await vi.waitFor(() => expect(h.client.getState().pending).toBe(false));
    } finally { api.dispose(); globalThis.document = previousDocument; }
  });

  test("a genuinely accepted external replacement still rebases while Save is pending", async () => {
    const previousDocument = globalThis.document; globalThis.document = documentStub();
    const root = element("main"); const client = fakeClient(); client.setLive(false);
    let resolveSave; client.save = vi.fn(() => new Promise((resolve) => { resolveSave = resolve; }));
    const api = mountProjectionConfig(root, { client });
    try {
      const action = (name) => find(root, (node) => node.dataset?.action === name);
      find(root, (node) => node.dataset?.node === "left-keystone").dispatch("click");
      find(root, (node) => node.dataset?.action === "warp-nudge" && node.dataset.direction === "right").dispatch("click");
      clickCommand(root, "save-new"); expect(action("warp-undo").disabled).toBe(false);
      const external = clone(DEFAULTS); external.outputs.left.warp.keystone.corners[0] = [0.05, 0.01];
      client.report({ snapshot: { ...client.getState().snapshot, revision: 3, config: external }, draft: external, hasLocalDraft: false });
      expect(action("warp-undo").disabled).toBe(true);
      resolveSave({ ...client.getState(), savedPresetId: null }); await vi.waitFor(() => expect(find(root, (node) => node.className === "draft-status").textContent).not.toContain("Saving"));
      expect(client.getState().draft).toEqual(external);
    } finally { api.dispose(); globalThis.document = previousDocument; }
  });
  test("pending action wording follows the newest Save or Apply promise until it settles", async () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main");
    const client = fakeClient();
    let resolveSave;
    let resolveApply;
    client.getState().snapshot.presets[0].readOnly = false;
    const draft = clone(DEFAULTS); draft.pre.tx = 0.07;
    client.setDraft(draft);
    const socketEvents = new Map();
    const socket = {
      send: vi.fn(), getConnected: () => true,
      on(type, handler) { socketEvents.set(type, handler); }, off(type) { socketEvents.delete(type); },
    };
    client.save = vi.fn(() => new Promise((resolve) => { resolveSave = resolve; }));
    client.apply = vi.fn(() => new Promise((resolve) => { resolveApply = resolve; }));
    const api = mountProjectionConfig(root, { client, socket });
    const action = (name) => find(root, (node) => node.dataset?.action === name);
    find(root, (node) => node.tagName === "INPUT" && node.type === "text").value = "Draft";
    action("save").dispatch("click");
    expect(find(root, (node) => node.className === "draft-status").textContent).toContain("Saving preset");
    action("apply").dispatch("click");
    expect(find(root, (node) => node.className === "draft-status").textContent).toContain("Applying changes");
    resolveSave(client.getState());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(find(root, (node) => node.className === "draft-status").textContent).toContain("Applying changes");
    resolveApply(client.getState());
    client.report({ snapshot: { ...client.getState().snapshot, revision: 3, config: draft }, draft, hasLocalDraft: false, pending: false });
    await vi.waitFor(() => expect(find(root, (node) => node.className === "draft-status").textContent).toContain("Accepted · preset needs saving"));
    expect(find(root, (node) => node.className === "applied-summary").textContent).toBe("Outputs: pending");
    for (const output of ["left", "right"]) socketEvents.get("otef_projection_applied")({
      table: "otef", output, instanceId: `${output}-projector`, revision: 3, success: true, route: "browser", baseline: { type: "identity" },
    });
    expect(find(root, (node) => node.className === "applied-summary").textContent).toBe("Outputs: applied");
    api.dispose(); globalThis.document = previousDocument;
  });

  test("failed Save clears its pending wording and keeps the draft error visible", async () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main");
    const client = fakeClient();
    client.getState().snapshot.presets[0].readOnly = false;
    const draft = clone(DEFAULTS); draft.pre.tx = 0.08;
    client.setDraft(draft);
    let rejectSave;
    client.save = vi.fn(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
    const api = mountProjectionConfig(root, { client });
    find(root, (node) => node.tagName === "INPUT" && node.type === "text").value = "Draft";
    find(root, (node) => node.dataset?.action === "save").dispatch("click");
    expect(find(root, (node) => node.className === "draft-status").textContent).toContain("Saving preset");
    rejectSave(new Error("save unavailable"));
    await vi.waitFor(() => expect(find(root, (node) => node.className === "action-error").textContent).toContain("save unavailable"));
    expect(find(root, (node) => node.className === "draft-status").textContent).not.toContain("Saving preset");
    expect(find(root, (node) => node.className === "draft-status").textContent).toContain("Failed");
    expect(client.getState().draft).toEqual(draft);
    api.dispose(); globalThis.document = previousDocument;
  });

  test("an older failed action cannot replace a newer pending action or its error channel", async () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main");
    const client = fakeClient();
    client.getState().snapshot.presets[0].readOnly = false;
    let rejectSave; let resolveApply;
    client.save = vi.fn(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
    client.apply = vi.fn(() => new Promise((resolve) => { resolveApply = resolve; }));
    const api = mountProjectionConfig(root, { client });
    find(root, (node) => node.tagName === "INPUT" && node.attributes?.["aria-label"] === "Preset name").value = "Draft";
    find(root, (node) => node.dataset?.action === "save").dispatch("click");
    find(root, (node) => node.dataset?.action === "apply").dispatch("click");
    rejectSave(new Error("older save failed"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(find(root, (node) => node.className === "draft-status").textContent).toContain("Applying changes");
    expect(find(root, (node) => node.className === "action-error").hidden).toBe(true);
    resolveApply(client.getState());
    await vi.waitFor(() => expect(find(root, (node) => node.className === "draft-status").textContent).not.toContain("Applying changes"));
    api.dispose(); globalThis.document = previousDocument;
  });

  test("saving a draft labels the operation Apply & save with its full accessible meaning", () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main");
    const client = fakeClient();
    const api = mountProjectionConfig(root, { client });
    const draft = clone(DEFAULTS); draft.pre.tx = 0.09;
    client.report({ draft, hasLocalDraft: true });
    const save = find(root, (node) => node.dataset?.action === "save");
    expect(save.textContent).toBe("Apply & save");
    expect(save.attributes["aria-label"]).toBe("Apply and save preset");
    expect(save.title).toBe("Apply & save preset");
    api.dispose(); globalThis.document = previousDocument;
  });

  test("pending Save disables overwrite and Save as new until the request settles", async () => {
    const previousDocument = globalThis.document; globalThis.document = documentStub();
    const root = element("main"); const client = fakeClient();
    client.getState().snapshot.presets[0].readOnly = false;
    let resolveSave;
    client.save = vi.fn(() => new Promise((resolve) => { resolveSave = resolve; }));
    const api = mountProjectionConfig(root, { client });
    find(root, (node) => node.attributes?.["aria-label"] === "Preset name").value = "Draft";
    find(root, (node) => node.dataset?.action === "save").dispatch("click");
    const save = find(root, (node) => node.dataset?.action === "save");
    const saveNew = find(root, (node) => node.dataset?.action === "save-new");
    expect(save.disabled).toBe(true);
    expect(saveNew.disabled).toBe(true);
    resolveSave(client.getState());
    await vi.waitFor(() => { expect(save.disabled).toBe(false); expect(saveNew.disabled).toBe(false); });
    api.dispose(); globalThis.document = previousDocument;
  });

  test("output summary stays compact while full acknowledgements stay in Tools and errors remain visible", () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const events = new Map();
    const socket = { send: vi.fn(), getConnected: () => true, on: (type, handler) => events.set(type, handler), off: (type) => events.delete(type) };
    const root = element("main");
    const api = mountProjectionConfig(root, { client: fakeClient(), socket });
    events.get("otef_projection_applied")({
      table: "otef", output: "left", instanceId: "left-instance", revision: 2,
      success: false, error: "output renderer unavailable", route: "browser", baseline: { type: "identity" },
    });
    const tools = find(root, (node) => node.className === "config-tools");
    expect(tools.tagName).toBe("DETAILS");
    expect(tools.attributes?.open).toBeUndefined();
    expect(find(root, (node) => node.className === "applied-status").tagName).toBe("SECTION");
    const rows = find(root, (node) => node.className === "applied-details");
    let rowsInsideTools = false;
    for (let ancestor = rows.parentElement; ancestor; ancestor = ancestor.parentElement) rowsInsideTools ||= ancestor === tools;
    expect(rowsInsideTools).toBe(true);
    expect(find(root, (node) => node.className === "applied-summary").textContent).toBe("Outputs: failed");
    expect(find(root, (node) => node.className === "applied-failure").textContent).toContain("output renderer unavailable");
    const failure = find(root, (node) => node.className === "applied-failure");
    expect(failure.hidden).toBe(false);
    let failureInsideTools = false;
    for (let ancestor = failure.parentElement; ancestor; ancestor = ancestor.parentElement) failureInsideTools ||= ancestor === tools;
    expect(failureInsideTools).toBe(false);
    expect(find(root, (node) => node.className === "applied-details").children[0].textContent).toContain("revision 2");
    expect(find(root, (node) => node.className === "applied-details").children[0].textContent).toContain("left-instance");
    api.dispose(); globalThis.document = previousDocument;
  });

  test.each(["preset-select", "live", "pattern", "invalid-save"])("%s does not suppress a started Save failure", async (interaction) => {
    const previousDocument = globalThis.document; globalThis.document = documentStub();
    const root = element("main"); const client = fakeClient(); client.setLive(false);
    client.getState().snapshot.presets[0].readOnly = false;
    client.getState().snapshot.presets.push({ id: "desk", name: "Desk", config: clone(DEFAULTS), readOnly: false });
    const draft = clone(DEFAULTS); draft.pre.tx = 0.08; client.setDraft(draft);
    let rejectSave; client.save = vi.fn(() => new Promise((_resolve, reject) => { rejectSave = reject; }));
    const api = mountProjectionConfig(root, { client });
    const action = (name) => find(root, (node) => node.dataset?.action === name);
    const name = find(root, (node) => node.attributes?.["aria-label"] === "Preset name"); name.value = "Draft";
    action("save").dispatch("click");
    if (interaction === "preset-select") { const select = find(root, (node) => node.attributes?.["aria-label"] === "Preset"); select.value = "desk"; select.dispatch("change"); }
    if (interaction === "live") { action("live").checked = false; action("live").dispatch("change"); }
    if (interaction === "pattern") { const pattern = find(root, (node) => node.className === "pattern-selector"); pattern.value = "grid"; pattern.dispatch("change"); }
    if (interaction === "invalid-save") { name.value = ""; action("save").dispatch("click"); }
    rejectSave(new Error("save unavailable"));
    await vi.waitFor(() => expect(find(root, (node) => node.className === "action-error").textContent).toContain("save unavailable"));
    expect(client.getState().draft).toEqual(draft);
    api.dispose(); globalThis.document = previousDocument;
  });

  test.each(["load", "revert"])("real-client stale %s preserves history and loaded metadata", async (operation) => {
    const previousDocument = globalThis.document; globalThis.document = documentStub();
    const h = replacementHarness(); const root = element("main");
    const api = mountProjectionConfig(root, { client: h.client, candidateValidator: { validateCandidate: async ({ identity }) => ({ identity, valid: true }), dispose() {} } });
    h.respond(h.snapshot); await vi.waitFor(() => expect(h.client.getState().hydrating).toBe(false));
    h.client.setLive(false);
    const action = (name) => find(root, (node) => node.dataset?.action === name);
    find(root, (node) => node.dataset?.node === "left-keystone").dispatch("click");
    find(root, (node) => node.dataset?.action === "warp-nudge" && node.dataset.direction === "right").dispatch("click");
    const draft = h.client.getState().draft;
    const preset = find(root, (node) => node.attributes?.["aria-label"] === "Preset"); preset.value = h.presetId; preset.dispatch("change");
    action(operation).dispatch("click"); await vi.waitFor(() => expect(h.requests).toHaveLength(1));
    h.foreign({ ...h.snapshot, revision: 2 });
    h.respond({ ...h.snapshot, revision: 1, selectedPresetId: operation === "load" ? h.presetId : "original" });
    await vi.waitFor(() => expect(find(root, (node) => node.className === "draft-status").textContent).not.toMatch(/Loading preset|Reverting settings/));
    expect(h.client.getState()).toMatchObject({ snapshot: { revision: 2, selectedPresetId: "original" }, hasLocalDraft: true, draft });
    expect(find(root, (node) => node.className === "loaded-preset-identity").textContent).toBe("Loaded: Original calibration");
    expect(action("warp-undo").disabled).toBe(false);
    action("warp-undo").dispatch("click"); expect(h.client.getState().draft.outputs.left.warp).toEqual(DEFAULTS.outputs.left.warp);
    api.dispose(); globalThis.document = previousDocument;
  });

  test.each(["load", "revert"])("real-client edit during %s preserves history and loaded metadata", async (operation) => {
    const previousDocument = globalThis.document; globalThis.document = documentStub();
    const h = replacementHarness(); const root = element("main");
    const api = mountProjectionConfig(root, { client: h.client, candidateValidator: { validateCandidate: async ({ identity }) => ({ identity, valid: true }), dispose() {} } });
    h.respond(h.snapshot); await vi.waitFor(() => expect(h.client.getState().hydrating).toBe(false)); h.client.setLive(false);
    const action = (name) => find(root, (node) => node.dataset?.action === name);
    const preset = find(root, (node) => node.attributes?.["aria-label"] === "Preset"); preset.value = h.presetId; preset.dispatch("change");
    action(operation).dispatch("click"); await vi.waitFor(() => expect(h.requests).toHaveLength(1));
    find(root, (node) => node.dataset?.node === "left-keystone").dispatch("click");
    find(root, (node) => node.dataset?.action === "warp-nudge" && node.dataset.direction === "right").dispatch("click");
    const draft = h.client.getState().draft;
    h.respond({ ...h.snapshot, revision: 1, selectedPresetId: operation === "load" ? h.presetId : "original" });
    await vi.waitFor(() => expect(h.client.getState().pending).toBe(false));
    expect(h.client.getState()).toMatchObject({ hasLocalDraft: true, draft });
    expect(find(root, (node) => node.className === "loaded-preset-identity").textContent).toBe("Loaded: Original calibration");
    expect(action("warp-undo").disabled).toBe(false);
    api.dispose(); globalThis.document = previousDocument;
  });

  test.each(["load", "revert"])("real-client genuinely accepted identical %s rebases history", async (operation) => {
    const previousDocument = globalThis.document; globalThis.document = documentStub();
    const h = replacementHarness(); h.snapshot.selectedPresetId = h.presetId; const root = element("main");
    const api = mountProjectionConfig(root, { client: h.client, candidateValidator: { validateCandidate: async ({ identity }) => ({ identity, valid: true }), dispose() {} } });
    h.respond(h.snapshot); await vi.waitFor(() => expect(h.client.getState().hydrating).toBe(false)); h.client.setLive(false);
    const action = (name) => find(root, (node) => node.dataset?.action === name);
    find(root, (node) => node.dataset?.node === "left-keystone").dispatch("click");
    find(root, (node) => node.dataset?.action === "warp-nudge" && node.dataset.direction === "right").dispatch("click");
    const accepted = h.client.getState().draft;
    action("apply").dispatch("click"); await vi.waitFor(() => expect(h.requests).toHaveLength(1));
    const snapshot = { ...h.snapshot, revision: 1, config: accepted, presets: h.snapshot.presets.map((p) => p.id === h.presetId ? { ...p, config: accepted } : p) };
    h.respond(snapshot); await vi.waitFor(() => expect(h.client.getState().pending).toBe(false));
    expect(action("warp-undo").disabled).toBe(false);
    action(operation).dispatch("click"); await vi.waitFor(() => expect(h.requests).toHaveLength(1));
    h.respond({ ...snapshot, revision: 2 });
    await vi.waitFor(() => expect(action("warp-undo").disabled).toBe(true));
    expect(h.client.getState().draft).toEqual(accepted);
    api.dispose(); globalThis.document = previousDocument;
  });

  test("preset dropdown selection alone keeps the draft and does not load", () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const client = fakeClient();
    const draft = clone(DEFAULTS); draft.pre.tx = 0.06;
    client.setDraft(draft);
    client.getState().snapshot.presets.push({ id: "desk", name: "Desk", config: clone(DEFAULTS), readOnly: false });
    const root = element("main");
    const api = mountProjectionConfig(root, { client });
    const preset = find(root, (node) => node.attributes?.["aria-label"] === "Preset");
    preset.value = "desk";
    preset.dispatch("change");
    expect(client.load).not.toHaveBeenCalled();
    expect(client.getState().draft).toEqual(draft);
    expect(preset.value).toBe("desk");
    api.dispose(); globalThis.document = previousDocument;
  });

  test.each(["load", "revert"])("accepted same-value %s rebases existing warp history", async (operation) => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main");
    const client = fakeClient();
    client.setLive(false);
    const api = mountProjectionConfig(root, { client });
    const action = (name) => find(root, (node) => node.dataset?.action === name);
    find(root, (node) => node.dataset?.node === "left-keystone").dispatch("click");
    find(root, (node) => node.dataset?.action === "warp-nudge" && node.dataset?.direction === "right").dispatch("click");
    const acceptedConfig = clone(client.getState().draft);
    client.report({
      snapshot: { ...client.getState().snapshot, revision: 3, config: acceptedConfig,
        presets: [{ id: "original", name: "Original calibration", config: clone(acceptedConfig), readOnly: true }],
        selectedPresetId: "original" },
      draft: acceptedConfig, hasLocalDraft: false,
    });
    expect(action("warp-undo").disabled).toBe(false);
    if (operation === "load") { find(root, (node) => node.dataset?.action === "load").dispatch("click"); }
    else action("revert").dispatch("click");
    await vi.waitFor(() => expect(action("warp-undo").disabled).toBe(true));
    expect(client.getState().draft).toEqual(acceptedConfig);
    expect(action("warp-undo").disabled).toBe(true);
    api.dispose(); globalThis.document = previousDocument;
  });


  test("Nova explainers editor opens from its card and disposes on node change or shutdown", () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const editor = { close: vi.fn(), dispose: vi.fn() };
    const novaExplainerEditorFactory = vi.fn(() => editor);
    const clockEditorFactory = vi.fn(() => ({ close: vi.fn(), dispose: vi.fn(), setSelection: vi.fn(), calibrationChanged: vi.fn() }));
    const layoutClient = {
      getSlot: vi.fn((resource) => resource === "gisNovaExplainers"
        ? { acknowledged: { close: {}, wide: {} }, draft: { close: { "100": { leftPct: 4, topPct: 5 } }, wide: { "104": { leftPct: 8, topPct: 9 } } }, status: "Conflict" }
        : { acknowledged: { leftPct: 8, topPct: 8, widthPct: 20, heightPct: 10, fontPx: 22, rotateDeg: 0 }, draft: null, status: "Saved" }),
      getHydrationState: () => ({ status: "Saved" }),
      subscribe: () => () => {},
      destroy: vi.fn(),
    };
    const root = element("main");
    const api = mountProjectionConfig(root, { client: fakeClient(), layoutClient, clockEditorFactory, novaExplainerEditorFactory });
    const nova = find(root, (node) => node.dataset?.node === "nova-explainers");
    expect(find(nova, (node) => node.textContent === "Nova explainers")).toBeTruthy();
    expect(find(nova, (node) => node.textContent === "Show on exhibit")).toBeNull();
    expect(find(nova, (node) => node.className === "clock-layout-status").textContent).toBe("Changed on another screen");
    find(nova, (node) => node.dataset?.action === "nova-explainer-editor-open").dispatch("click");
    expect(novaExplainerEditorFactory).toHaveBeenCalledOnce();
    expect(novaExplainerEditorFactory.mock.calls[0][0].layoutClient).toBe(layoutClient);
    expect(novaExplainerEditorFactory.mock.calls[0][0].onShowOnExhibit).toBeUndefined();
    expect(clockEditorFactory).not.toHaveBeenCalled();
    find(root, (node) => node.dataset?.node === "left-fit").dispatch("click");
    expect(editor.dispose).toHaveBeenCalledOnce();
    find(nova, (node) => node.dataset?.action === "nova-explainer-editor-open").dispatch("click");
    expect(novaExplainerEditorFactory).toHaveBeenCalledTimes(2);
    api.dispose();
    expect(editor.dispose).toHaveBeenCalledTimes(2);
    expect(layoutClient.destroy).not.toHaveBeenCalled();
    globalThis.document = previousDocument;
  });

  test("projection-opened reusable editor retains the GIS exhibit callback after switching nodes", () => {
    const previousDocument = globalThis.document; globalThis.document = documentStub();
    const editor = { close: vi.fn(), dispose: vi.fn(), setSelection: vi.fn(), calibrationChanged: vi.fn() };
    const factory = vi.fn(() => editor); const root = element("main");
    const api = mountProjectionConfig(root, { client: fakeClient(), layoutClient: {}, clockEditorFactory: factory });
    const open = (id) => find(find(root, (node) => node.dataset?.node === id), (node) => node.dataset?.action === "clock-editor-open").dispatch("click");
    open("clock-projection"); open("clock-gis");
    expect(factory).toHaveBeenCalledOnce();
    expect(factory.mock.calls[0][0].onShowOnExhibit).toBeTypeOf("function");
    expect(editor.setSelection).toHaveBeenCalledWith(expect.objectContaining({ nodeId: "clock-gis" }));
    api.dispose(); globalThis.document = previousDocument;
  });
  test("projection calibration reload follows accepted effective config changes only", () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const client = fakeClient();
    const layoutClient = { getSlot: vi.fn(() => ({ acknowledged: {}, draft: null, status: "Saved" })), subscribe: () => () => {}, commit: vi.fn() };
    const editor = { close: vi.fn(), dispose: vi.fn(), setSelection: vi.fn(), calibrationChanged: vi.fn() };
    const clockEditorFactory = vi.fn(() => editor);
    const root = element("main");
    const api = mountProjectionConfig(root, { client, layoutClient, clockEditorFactory });
    const projectionNode = find(root, (node) => node.dataset?.node === "clock-projection");
    find(projectionNode, (node) => node.dataset?.action === "clock-editor-open").dispatch("click");
    expect(clockEditorFactory).toHaveBeenCalledWith(expect.objectContaining({ nodeId: "clock-projection", layoutClient }));
    const draft = clone(DEFAULTS); draft.pre.tx = 0.2;
    client.report({ draft, hasLocalDraft: true });
    client.report({ snapshot: { ...client.getState().snapshot, revision: 3, selectedPresetId: "metadata-only" }, draft });
    expect(editor.calibrationChanged).not.toHaveBeenCalled();
    client.report({ snapshot: { ...client.getState().snapshot, revision: 4 }, draft });
    expect(editor.calibrationChanged).not.toHaveBeenCalled();
    const effective = clone(DEFAULTS); effective.pre.tx = 0.1;
    client.report({ snapshot: { ...client.getState().snapshot, revision: 5, config: effective }, draft: effective, hasLocalDraft: false });
    expect(editor.calibrationChanged).toHaveBeenCalledOnce();
    find(root, (node) => node.dataset?.node === "left-fit").dispatch("click");
    expect(editor.close).toHaveBeenCalledOnce();
    api.dispose(); globalThis.document = previousDocument;
  });

  test('geometry edits do not trigger names placement; explicit candidate checks use the geometry validator', async () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element('main'); const client = fakeClient();
    const config = clone(client.getState().draft);
    const candidateValidator = { validateCandidate: vi.fn(async ({ identity }) => ({ identity, valid: true })), dispose: vi.fn() };
    const api = mountProjectionConfig(root, { client, candidateValidator, readNamesDataset: async () => ({ datasetVersion: 'release' }) });
    const frames = []; const collect = (node) => { if (node.tagName === 'IFRAME') frames.push(node); for (const child of node.children || []) collect(child); };
    collect(root); expect(frames).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(candidateValidator.validateCandidate).not.toHaveBeenCalled();
    expect((await client.validateCandidate({ config, identity: JSON.stringify(config), generation: 1, revision: 3 })).valid).toBe(true);
    expect(candidateValidator.validateCandidate).toHaveBeenCalledOnce();
    expect(find(root, (node) => node.className === 'names-wall-status').textContent).toContain('Waiting for names output status');
    api.dispose(); expect(candidateValidator.dispose).toHaveBeenCalledOnce(); globalThis.document = previousDocument;
  });
  test("ordinary hydration and draft changes do not start a names preflight worker", async () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main");
    const client = fakeClient();
    const api = mountProjectionConfig(root, { client });
    const status = find(root, (node) => node.className === "names-wall-status");
    expect(status.textContent).toContain("Waiting for names output status");
    expect(find(root, (node) => node.dataset?.action === "projection-names-run")).toBeTruthy();

    const config = clone(client.getState().draft);
    const identity = JSON.stringify(config);
    const first = await client.validateCandidate({ config, identity, generation: 1, revision: 3 });
    const second = await client.validateCandidate({ config, identity, generation: 2, revision: 4 });
    expect(first.reason).toBe("Geometry validator unavailable");
    expect(second.reason).toBe("Geometry validator unavailable");
    api.dispose(); globalThis.document = previousDocument;
  });
  test("Run names requires an applied Live snapshot and sends the exact placement target once ready", async () => {
    const previousDocument = globalThis.document; globalThis.document = documentStub();
    const client = fakeClient(); const sent = [];
    const socketHandlers = new Map();
    const socket = { on: (type, handler) => socketHandlers.set(type, handler), off() {}, send: (message) => sent.push(message), getConnected: () => true };
    const candidateValidator = { validateCandidate: vi.fn(async ({ identity }) => ({ identity, valid: true })), dispose() {} };
    let holdDatasetRead = false; let releaseDatasetRead; let runReads = 0;
    const root = element('main');
    const api = mountProjectionConfig(root, { client, socket, candidateValidator, readNamesDataset: async () => {
      if (holdDatasetRead) { runReads += 1; await new Promise((resolve) => { releaseDatasetRead = resolve; }); }
      return { datasetVersion: 'release-1' };
    } });
    await vi.waitFor(() => expect(sent.some((message) => message.type === 'otef_projection_status_request')).toBe(true));
    const button = find(root, (node) => node.dataset?.action === 'projection-names-run');
    client.report({ live: false });
    const changed = clone(client.getState().draft); changed.pre.tx += 0.01;
    client.report({ draft: changed, hasLocalDraft: true });
    button.dispatch('click');
    expect(sent.filter((message) => message.type === 'otef_projection_names_run')).toHaveLength(0);
    client.report({ draft: clone(client.getState().snapshot.config), hasLocalDraft: false, pending: true });
    button.dispatch('click');
    expect(sent.filter((message) => message.type === 'otef_projection_names_run')).toHaveLength(0);
    client.report({ pending: false });
    const applied = (output, replacementInstanceId = null) => {
      const warp = client.getState().snapshot.config.outputs[output].warp;
      const baseline = warp.enabled === false ? { type: 'identity' } : (warp.baseline || { type: 'identity' });
      const instanceId = replacementInstanceId || (output === 'left' ? '10000000-0000-4000-8000-000000000001' : '20000000-0000-4000-8000-000000000002');
      socketHandlers.get('otef_projection_applied')({ table: 'otef', output, instanceId, revision: 2, success: true, route: 'browser', baseline });
    };
    applied('left'); applied('right');
    expect(button.title).toBe('Run names for the applied calibration.');
    holdDatasetRead = true;
    button.dispatch('click');
    expect(button.disabled).toBe(true);
    button.dispatch('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runReads).toBe(1);
    expect(button.disabled).toBe(true);
    releaseDatasetRead();
    await vi.waitFor(() => expect(sent.filter((message) => message.type === 'otef_projection_names_run')).toHaveLength(1));
    expect(sent.find((message) => message.type === 'otef_projection_names_run')).toMatchObject({
      table: 'otef', revision: 2, datasetVersion: 'release-1', placementIdentity: expect.stringMatching(/^[a-f0-9]{64}$/i), requestId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    });
    const run = sent.find((message) => message.type === 'otef_projection_names_run');
    const reportNames = (output, instanceId, requestId, state) => socketHandlers.get('otef_projection_names_status')({
      type: 'otef_projection_names_status', table: 'otef', output, instanceId, requestId, revision: run.revision,
      datasetVersion: run.datasetVersion, placementIdentity: run.placementIdentity, state, installed: null,
    });
    reportNames('left', '10000000-0000-4000-8000-000000000001', run.requestId, 'rebuilding');
    reportNames('right', '20000000-0000-4000-8000-000000000002', run.requestId, 'rebuilding');
    const replacementId = '30000000-0000-4000-8000-000000000003';
    applied('left', replacementId);
    expect(button.disabled).toBe(true);
    reportNames('left', replacementId, null, 'stale');
    expect(button.disabled).toBe(false);
    expect(client.getState().live).toBe(false);
    api.dispose(); globalThis.document = previousDocument;
  });
  test('dataset events refresh target identity without launching placement workers', async () => {
    const previousDocument = globalThis.document;
    const doc = documentStub(); const handlers = new Map();
    doc.defaultView.addEventListener = (type, fn) => handlers.set(type, fn);
    doc.defaultView.removeEventListener = (type) => handlers.delete(type);
    globalThis.document = doc;
    const socketHandlers = new Map();
    const socket = { on: (type, fn) => socketHandlers.set(type, fn), off: (type) => socketHandlers.delete(type) };
    let datasetVersion = 'release';
    const readNamesDataset = vi.fn(async () => ({ datasetVersion }));
    const candidateValidator = { validateCandidate: vi.fn(async ({ identity }) => ({ identity, valid: true })), dispose: vi.fn() };
    const api = mountProjectionConfig(element('main'), { client: fakeClient(), socket, candidateValidator, readNamesDataset });
    await vi.waitFor(() => expect(readNamesDataset).toHaveBeenCalledTimes(1));
    socketHandlers.get('otef_person_selection_changed')({ personSelection: { datasetVersion } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(readNamesDataset).toHaveBeenCalledTimes(2);
    expect(candidateValidator.validateCandidate).not.toHaveBeenCalled();
    datasetVersion = 'next-release';
    socketHandlers.get('otef_narrative_scene_changed')({ datasetVersion });
    await vi.waitFor(() => expect(readNamesDataset).toHaveBeenCalledTimes(3));
    expect(candidateValidator.validateCandidate).not.toHaveBeenCalled();
    expect(handlers.has('storage')).toBe(false);
    api.dispose(); expect(socketHandlers.has('otef_person_selection_changed')).toBe(false);
    expect(handlers.has('storage')).toBe(false); globalThis.document = previousDocument;
  });
  test('fresh editor replays names status only after the newest hydrated target is ready', async () => {
    const previousDocument = globalThis.document; globalThis.document = documentStub();
    const client = fakeClient(null); const socketHandlers = new Map(); const sent = [];
    const socket = { on: (type, handler) => socketHandlers.set(type, handler), off() {}, send: (message) => sent.push(message), getConnected: () => true };
    const reads = [];
    const readNamesDataset = vi.fn(() => new Promise((resolve) => reads.push(resolve)));
    const originalDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    const deferredDigests = [];
    const digestSpy = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation((algorithm, bytes) =>
      new Promise((resolve) => deferredDigests.push(async () => resolve(await originalDigest(algorithm, bytes)))));
    const candidateValidator = { validateCandidate: vi.fn(), dispose: vi.fn() };
    const root = element('main');
    const api = mountProjectionConfig(root, { client, socket, candidateValidator, readNamesDataset });
    const earlyIdentity = 'a'.repeat(64);
    for (const output of ['left', 'right']) socketHandlers.get('otef_projection_names_status')({
      type: 'otef_projection_names_status', table: 'otef', output,
      instanceId: output === 'left' ? '10000000-0000-4000-8000-000000000001' : '20000000-0000-4000-8000-000000000002',
      requestId: null, revision: 2, datasetVersion: 'release-1', placementIdentity: earlyIdentity,
      state: 'current', installed: null,
    });
    expect(sent.filter((message) => message.type === 'otef_projection_status_request')).toHaveLength(0);
    const snapshot = clone(fakeClient().getState().snapshot);
    client.hydrate(snapshot);
    await vi.waitFor(() => expect(reads).toHaveLength(1));
    client.report({ snapshot: { ...snapshot, revision: 3 }, draft: clone(snapshot.config) });
    await vi.waitFor(() => expect(reads).toHaveLength(2));
    reads[0]({ datasetVersion: 'obsolete-release' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent.filter((message) => message.type === 'otef_projection_status_request')).toHaveLength(0);
    reads[1]({ datasetVersion: 'release-1' });
    await vi.waitFor(() => expect(deferredDigests).toHaveLength(1));
    expect(sent.filter((message) => message.type === 'otef_projection_status_request')).toHaveLength(0);
    await deferredDigests[0](); digestSpy.mockRestore();
    await vi.waitFor(() => expect(sent.filter((message) => message.type === 'otef_projection_status_request')).toHaveLength(1));
    const placementIdentity = await projectionPlacementInputIdentity(snapshot.config);
    const installed = { revision: 3, datasetVersion: 'release-1', placementIdentity, mode: 'wall', digest: 'b'.repeat(64), expected: 1200, placed: 1200 };
    for (const output of ['left', 'right']) socketHandlers.get('otef_projection_names_status')({
      type: 'otef_projection_names_status', table: 'otef', output,
      instanceId: output === 'left' ? '10000000-0000-4000-8000-000000000001' : '20000000-0000-4000-8000-000000000002',
      requestId: null, revision: 3, datasetVersion: 'release-1', placementIdentity, state: 'current', installed,
    });
    expect(find(root, (node) => node.className === 'names-wall-status').textContent).toContain('Names current');
    expect(sent.some((message) => message.type === 'otef_projection_names_run')).toBe(false);
    expect(candidateValidator.validateCandidate).not.toHaveBeenCalled();
    api.dispose(); globalThis.document = previousDocument;
  });
  test('fresh editor disposal suppresses a deferred target replay', async () => {
    const previousDocument = globalThis.document; globalThis.document = documentStub();
    const client = fakeClient(null); const socketHandlers = new Map(); const sent = [];
    const socket = { on: (type, handler) => socketHandlers.set(type, handler), off() {}, send: (message) => sent.push(message), getConnected: () => true };
    let resolveDataset;
    const api = mountProjectionConfig(element('main'), { client, socket, readNamesDataset: () => new Promise((resolve) => { resolveDataset = resolve; }) });
    const snapshot = clone(fakeClient().getState().snapshot);
    client.hydrate(snapshot);
    await vi.waitFor(() => expect(resolveDataset).toBeTypeOf('function'));
    api.dispose();
    resolveDataset({ datasetVersion: 'release-1' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent.filter((message) => message.type === 'otef_projection_status_request')).toHaveLength(0);
    globalThis.document = previousDocument;
  });
  test('accepted revision changes replay after the cached-dataset target hash is ready', async () => {
    const previousDocument = globalThis.document; globalThis.document = documentStub();
    const client = fakeClient(); const socketHandlers = new Map(); const sent = [];
    const socket = { on: (type, handler) => socketHandlers.set(type, handler), off() {}, send: (message) => sent.push(message), getConnected: () => true };
    const root = element('main');
    const api = mountProjectionConfig(root, { client, socket, readNamesDataset: async () => ({ datasetVersion: 'release-1' }) });
    const statusRequestCount = () => sent.filter((message) => message.type === 'otef_projection_status_request').length;
    await vi.waitFor(() => expect(statusRequestCount()).toBe(1));
    const initial = client.getState().snapshot;
    const initialIdentity = await projectionPlacementInputIdentity(initial.config);
    const emitCurrent = (revision, placementIdentity) => {
      const installed = { revision, datasetVersion: 'release-1', placementIdentity, mode: 'wall', digest: 'b'.repeat(64), expected: 1200, placed: 1200 };
      for (const output of ['left', 'right']) socketHandlers.get('otef_projection_names_status')({
        type: 'otef_projection_names_status', table: 'otef', output,
        instanceId: output === 'left' ? '10000000-0000-4000-8000-000000000001' : '20000000-0000-4000-8000-000000000002',
        requestId: null, revision, datasetVersion: 'release-1', placementIdentity, state: 'current', installed,
      });
    };
    emitCurrent(initial.revision, initialIdentity);
    expect(find(root, (node) => node.className === 'names-wall-status').textContent).toContain('Names current');
    const nextConfig = clone(initial.config); nextConfig.pre.scale += 0.01;
    const originalDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    let releaseDigest;
    const digestSpy = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation((algorithm, bytes) =>
      new Promise((resolve) => { releaseDigest = async () => resolve(await originalDigest(algorithm, bytes)); }));
    client.report({ snapshot: { ...initial, revision: initial.revision + 1, config: nextConfig }, draft: clone(nextConfig), hasLocalDraft: false, pending: false });
    await vi.waitFor(() => expect(releaseDigest).toBeTypeOf('function'));
    emitCurrent(initial.revision + 1, 'c'.repeat(64));
    expect(statusRequestCount()).toBe(1);
    await releaseDigest(); digestSpy.mockRestore();
    await vi.waitFor(() => expect(statusRequestCount()).toBe(2));
    const nextIdentity = await projectionPlacementInputIdentity(nextConfig);
    emitCurrent(initial.revision + 1, nextIdentity);
    expect(find(root, (node) => node.className === 'names-wall-status').textContent).toContain('Names current');
    expect(sent.some((message) => message.type === 'otef_projection_names_run')).toBe(false);
    api.dispose(); globalThis.document = previousDocument;
  });
  test('geometry apply status requires both current outputs and rejects duplicate instances', () => {
    const wall = { datasetVersion: 'release', mode: 'wall', digest: 'a'.repeat(64), expected: 1228, placed: 1228 };
    const left = { output: 'left', instanceId: 'left-a', revision: 8, success: true, wall };
    const right = { output: 'right', instanceId: 'right-a', revision: 8, success: true, wall };
    expect(projectionAppliedStatus([left], 8)).toBe('Pending');
    expect(projectionAppliedStatus([left, right], 8)).toBe('Applied');
    expect(projectionAppliedStatus([left, { ...right, wall: { ...wall, digest: 'b'.repeat(64) } }], 8)).toBe('Applied');
    expect(projectionAppliedStatus([left, right, { ...left, instanceId: 'left-b', wall: { ...wall, datasetVersion: 'other' } }], 8)).toBe('Unconfirmed');
    expect(projectionAppliedStatus([left, { ...right, revision: 7 }], 8)).toBe('Pending');
    expect(projectionAppliedStatus([left, { ...right, success: false, error: 'draw failed' }], 8)).toBe('Failed');
    expect(projectionAppliedStatus([{ ...left, wall: undefined }, { ...right, wall: undefined }], 8)).toBe('Applied');
  });
  test('editor clears paired wall Applied on duplicate conflict and reconnect', () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element('main'); const listeners = new Map();
    const socket = { on: (event, handler) => listeners.set(event, handler), off: (event) => listeners.delete(event), send: vi.fn(), getConnected: () => true };
    const api = mountProjectionConfig(root, { client: fakeClient(), socket });
    const wall = { datasetVersion: 'release', mode: 'wall', digest: 'a'.repeat(64), expected: 1228, placed: 1228 };
    const ack = (output, instanceId, nextWall = wall) => listeners.get('otef_projection_applied')({ table: 'otef', output, instanceId, revision: 2, success: true, route: 'browser', baseline: { type: 'identity' }, wall: nextWall });
    ack('left', 'left-a'); ack('right', 'right-a');
    expect(find(root, (node) => node.className === 'applied-summary').textContent).toBe('Outputs: applied');
    ack('left', 'left-b', { ...wall, digest: 'b'.repeat(64) });
    expect(api.getStatusRows()).toHaveLength(2);
    expect(find(root, (node) => node.className === 'applied-summary').textContent).toBe('Outputs: applied');
    listeners.get('disconnect')();
    expect(find(root, (node) => node.className === 'applied-summary').textContent).toBe('Outputs: pending');
    api.dispose(); globalThis.document = previousDocument;
  });
  test('geometry acknowledgements remain valid while previous installed names use another mode', () => {
    const previousDocument = globalThis.document; globalThis.document = documentStub();
    const listeners = new Map(); const root = element('main');
    const socket = { on: (event, handler) => listeners.set(event, handler), off: (event) => listeners.delete(event), send: vi.fn(), getConnected: () => true };
    const api = mountProjectionConfig(root, { client: fakeClient(), socket });
    const wall = { datasetVersion: 'release', mode: 'model', digest: 'a'.repeat(64), expected: 1, placed: 1 };
    for (const output of ['left', 'right']) listeners.get('otef_projection_applied')({ table: 'otef', output,
      instanceId: output === 'left' ? '10000000-0000-4000-8000-000000000001' : '20000000-0000-4000-8000-000000000002',
      revision: 2, success: true, route: 'browser', baseline: { type: 'identity' }, wall });
    expect(find(root, (node) => node.className === 'applied-summary').textContent).toBe('Outputs: applied');
    api.dispose(); globalThis.document = previousDocument;
  });
  test("shows hydration failure with a retry action and automatic preview errors", async () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main");
    const client = fakeClient();
    const api = mountProjectionConfig(root, { client });
    client.report({ hydrating: true, hydrationError: "GET unavailable", previewError: "preview failed" });
    const retry = find(root, (node) => node.dataset?.action === "retry-hydration");
    expect(retry.hidden).toBe(false);
    expect(find(root, (node) => node.className === "connection-status").textContent).toMatch(/GET unavailable/);
    expect(find(root, (node) => node.className === "action-error").textContent).toMatch(/preview failed/);
    retry.dispatch("click");
    await vi.waitFor(() => expect(client.retryHydration).toHaveBeenCalledTimes(1));
    api.dispose(); globalThis.document = previousDocument;
  });

  test("shows the cause of an Apply failure in the action error channel", async () => {
    const previousDocument = globalThis.document; globalThis.document = documentStub();
    const client = fakeClient();
    client.apply.mockRejectedValue(new Error("projection config operation superseded"));
    const root = element("main"); const api = mountProjectionConfig(root, { client });
    find(root, (node) => node.dataset?.action === "apply").dispatch("click");
    await vi.waitFor(() => expect(find(root, (node) => node.className === "action-error").textContent).toContain("projection config operation superseded"));
    api.dispose(); globalThis.document = previousDocument;
  });
  test("empty numeric entry never applies a zero draft", () => {
    const descriptor = FIELD_DESCRIPTORS.find((item) => item.path === "pre.tx");
    expect(Number.isNaN(fieldValueFromInput(descriptor, ""))).toBe(true);
    expect(Number.isNaN(fieldValueFromInput(descriptor, "   "))).toBe(true);
  });

  test("prefills the loaded preset name, preserves edits, and resets on explicit reload", async () => {
    const previousDocument = globalThis.document; globalThis.document = documentStub();
    const client = fakeClient();
    const snapshot = clone(client.getState().snapshot);
    snapshot.presets.push({ id: "desk", name: "Desk calibration", config: clone(DEFAULTS) });
    snapshot.selectedPresetId = "desk";
    client.hydrate(snapshot);
    const root = element("main"); const api = mountProjectionConfig(root, { client });
    const name = find(root, (node) => node.attributes?.["aria-label"] === "Preset name");
    expect(name.value).toBe("Desk calibration");
    name.value = "My working copy";
    client.report({ pending: true });
    expect(name.value).toBe("My working copy");
    find(root, (node) => node.dataset?.action === "load").dispatch("click");
    await vi.waitFor(() => expect(name.value).toBe("Desk calibration"));
    api.dispose(); globalThis.document = previousDocument;
  });

  test("prefills the original preset after a cold mount hydrates", () => {
    const previousDocument = globalThis.document; globalThis.document = documentStub();
    const client = fakeClient(null); const root = element("main"); const api = mountProjectionConfig(root, { client });
    const name = find(root, (node) => node.attributes?.["aria-label"] === "Preset name");
    expect(name.value).toBe("");
    client.hydrate({ revision: 3, config: clone(DEFAULTS), presets: [{ id: "original", name: "Original calibration", config: clone(DEFAULTS), readOnly: true }], selectedPresetId: "original" });
    expect(name.value).toBe("Original calibration");
    api.dispose(); globalThis.document = previousDocument;
  });

  test("preserves a manually typed preset name entered before first hydration", () => {
    const previousDocument = globalThis.document; globalThis.document = documentStub();
    const client = fakeClient(null); const root = element("main"); const api = mountProjectionConfig(root, { client });
    const name = find(root, (node) => node.attributes?.["aria-label"] === "Preset name");
    name.value = "Typed before load"; name.dispatch("input");
    client.hydrate({ revision: 3, config: clone(DEFAULTS), presets: [{ id: "original", name: "Original calibration", config: clone(DEFAULTS), readOnly: true }], selectedPresetId: "original" });
    expect(name.value).toBe("Typed before load");
    api.dispose(); globalThis.document = previousDocument;
  });

  test("explains unsaved Live-off drafts and hides the reload warning for saved or accepted edits", () => {
    const previousDocument = globalThis.document; globalThis.document = documentStub();
    const root = element("main"); const client = fakeClient(); const api = mountProjectionConfig(root, { client });
    const status = find(root, (node) => node.className === "draft-status");
    client.report({ live: false, hasLocalDraft: true });
    expect(status.textContent).toContain("Changes have not reached the outputs");
    expect(status.textContent).toContain("Apply or save before reload");
    expect(status.textContent).toContain("Reloading discards this local draft");
    client.report({ live: true, hasLocalDraft: false });
    expect(status.textContent).not.toContain("Reloading discards");
    expect(status.textContent).toBe("Saved");
    api.dispose(); globalThis.document = previousDocument;
  });

  test("selecting a warp node opens its own Edit workflow without a mode selector", () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main");
    const api = mountProjectionConfig(root, { client: fakeClient() });
    const gridEdit = find(root, (node) => node.dataset?.action === "warp-editor-open" && node.parentElement?.dataset?.node === "right-grid");
    gridEdit.dispatch("click");
    expect(find(root, (node) => node.className === "warp-editor-dialog").dataset.mode).toBe("grid");
    expect(find(root, (node) => node.className === "inspector")).toBeNull();
    expect(find(root, (node) => node.attributes?.["aria-label"] === "Warp stage")).toBeNull();
    api.dispose();
    globalThis.document = previousDocument;
  });

  test("each warp node opens the mode shown in its editor title", () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main");
    const api = mountProjectionConfig(root, { client: fakeClient() });
    find(root, (node) => node.dataset?.node === "right-grid").dispatch("click");
    find(root, (node) => node.dataset?.action === "warp-editor-open" && node.parentElement?.dataset?.node === "right-grid").dispatch("click");
    expect(find(root, (node) => node.className === "warp-editor-title").textContent).toContain("Right · Grid Warp");
    find(root, (node) => node.dataset?.action === "warp-editor-close").dispatch("click");
    find(root, (node) => node.dataset?.action === "warp-editor-open" && node.parentElement?.dataset?.node === "left-keystone").dispatch("click");
    expect(find(root, (node) => node.className === "warp-editor-title").textContent).toContain("Left · Keystone");
    api.dispose(); globalThis.document = previousDocument;
  });

  test("first hydration re-requests status and reconnect renews the selected pattern", async () => {
    vi.useFakeTimers();
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const listeners = new Map();
    const socket = {
      send: vi.fn(), getConnected: () => true,
      on(type, handler) { listeners.set(type, handler); }, off(type) { listeners.delete(type); },
    };
    const client = fakeClient(null);
    const root = element("main");
    const api = mountProjectionConfig(root, { client, socket, readNamesDataset: async () => ({ datasetVersion: 'release-1' }) });
    const snapshot = { revision: 4, config: clone(DEFAULTS), presets: [{ id: "original", name: "Original calibration", config: clone(DEFAULTS), readOnly: true }], selectedPresetId: "original" };
    listeners.get("otef_projection_applied")({ table: "otef", output: "left", instanceId: "first", revision: 4, success: true, route: "browser", baseline: { type: "identity" } });
    expect(api.getStatusRows()).toHaveLength(0);
    const beforeHydration = socket.send.mock.calls.length;
    client.hydrate(snapshot);
    await vi.waitFor(() => expect(socket.send.mock.calls.slice(beforeHydration).some(([message]) => message.type === "otef_projection_status_request")).toBe(true));
    listeners.get("otef_projection_applied")({ table: "otef", output: "left", instanceId: "first", revision: 4, success: true, route: "browser", baseline: { type: "identity" } });
    listeners.get("otef_projection_applied")({ table: "otef", output: "left", instanceId: "second", revision: 4, success: true, route: "browser", baseline: { type: "identity" } });
    expect(api.getStatusRows()).toHaveLength(1);
    listeners.get("otef_projection_applied")({ table: "otef", output: "left", instanceId: "missing-route", revision: 4, success: true, baseline: { type: "identity" } });
    listeners.get("otef_projection_applied")({ table: "otef", output: "left", instanceId: "missing-baseline", revision: 4, success: true, route: "browser" });
    expect(api.getStatusRows()).toHaveLength(1);
    listeners.get("otef_projection_applied")({ table: "otef", output: "left", instanceId: "wrong-route", revision: 4, success: true, route: "td" });
    listeners.get("otef_projection_applied")({ table: "otef", output: "left", instanceId: "wrong-baseline", revision: 4, success: true, route: "browser", baseline: { type: "tdMesh", assetId: "other" } });
    expect(api.getStatusRows()).toHaveLength(1);
    const pattern = find(root, (node) => node.attributes?.["aria-label"] === "Left output test pattern");
    pattern.value = "grid"; pattern.dispatch("change");
    listeners.get("disconnect")();
    expect(api.getStatusRows()).toHaveLength(0);
    const beforeReconnect = socket.send.mock.calls.length;
    listeners.get("connect")();
    const afterConnect = socket.send.mock.calls.length;
    client.hydrate(snapshot); // cached-state notification before the newer HTTP hydration
    expect(socket.send.mock.calls.length).toBe(afterConnect);
    listeners.get("otef_projection_applied")({ table: "otef", output: "left", instanceId: "first", revision: 5, success: true, route: "browser", baseline: { type: "identity" } });
    expect(api.getStatusRows()).toHaveLength(0);
    const beforeRehydration = socket.send.mock.calls.length;
    client.hydrate({ ...snapshot, revision: 5 });
    await vi.waitFor(() => expect(socket.send.mock.calls.slice(beforeRehydration).some(([message]) => message.type === "otef_projection_status_request")).toBe(true));
    vi.advanceTimersByTime(1100);
    expect(socket.send.mock.calls.slice(beforeReconnect).filter(([message]) => message.type === "otef_projection_pattern" && message.pattern === "grid").length).toBeGreaterThanOrEqual(2);
    vi.advanceTimersByTime(3900);
    expect(api.getStatusRows().map((row) => row.output).sort()).toEqual(["left", "right"]);
    api.dispose(); globalThis.document = previousDocument; vi.useRealTimers();
  });

  test("Live off stages edits; Save, Load, and Apply work without preview frames", async () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main");
    const client = fakeClient();
    const api = mountProjectionConfig(root, { client });
    const action = (name) => find(root, (node) => node.dataset?.action === name);
    const live = action("live");
    live.checked = false; live.dispatch("change");
    expect(client.setLive).toHaveBeenLastCalledWith(false);
    const offset = find(root, (node) => node.dataset?.field === "pre.tx" && node.dataset.input === "number");
    offset.value = "1.2"; offset.dispatch("input"); offset.dispatch("blur");
    expect(client.setDraft).toHaveBeenCalled();
    expect(client.getState().draft.pre.tx).toBe(0.012);
    const setDraftCalls = client.setDraft.mock.calls.length;
    offset.value = ""; offset.dispatch("input");
    expect(client.setDraft).toHaveBeenCalledTimes(setDraftCalls);
    expect(client.getState().draft.pre.tx).toBe(0.012);
    expect(client.getState().live).toBe(false);
    const name = find(root, (node) => node.attributes?.["aria-label"] === "Preset name");
    name.value = "Imported";
    clickCommand(root, "save-new");
    expect(client.save).not.toHaveBeenCalled();
    offset.dispatch("keydown", { key: "Escape", preventDefault() {}, stopPropagation() {} });
    clickCommand(root, "save-new");
    await vi.waitFor(() => expect(client.save).toHaveBeenCalledWith({ presetId: null, name: "Imported" }));
    expect(client.savedDrafts.at(-1).pre.tx).toBe(0.012);
    const preset = find(root, (node) => node.attributes?.["aria-label"] === "Preset");
    preset.value = "original"; preset.dispatch("change");
    action("load").dispatch("click");
    await vi.waitFor(() => expect(client.load).toHaveBeenCalledWith("original"));
    action('apply').dispatch('click');
    await vi.waitFor(() => expect(client.apply).toHaveBeenCalledTimes(1));
    action("revert").dispatch("click");
    await vi.waitFor(() => expect(client.revert).toHaveBeenCalledTimes(1));
    expect(client.getState().snapshot.presets.find((item) => item.id === "original").readOnly).toBe(true);
    const frames = []; const collect = (node) => { if (node.tagName === 'IFRAME') frames.push(node); for (const child of node.children || []) collect(child); };
    collect(root); expect(frames).toHaveLength(0);
    api.dispose(); globalThis.document = previousDocument;
  });

  test("the permanent inspector no longer exposes import or export controls", () => {
    const previousDocument = globalThis.document; globalThis.document = documentStub();
    const root = element("main"); const api = mountProjectionConfig(root, { client: fakeClient() });
    expect(find(root, (node) => node.attributes?.["aria-label"] === "Import calibration")).toBeNull();
    expect(find(root, (node) => node.dataset?.action === "export")).toBeNull();
    api.dispose(); globalThis.document = previousDocument;
  });
  test("v1 accepted snapshots are migrated before editor hydration", () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const legacy = clone(DEFAULTS);
    legacy.schemaVersion = 1;
    delete legacy.namesWall;
    for (const output of ["left", "right"]) {
      delete legacy.outputs[output].presentationEffect;
      delete legacy.outputs[output].warp;
    }
    const client = fakeClient(null);
    const root = element("main");
    const api = mountProjectionConfig(root, { client });
    client.hydrate({ revision: 5, config: legacy, presets: [{ id: "legacy", name: "Legacy", config: legacy }], selectedPresetId: "legacy" });
    find(root, (node) => node.dataset?.node === "right-grid").dispatch("click");
    find(root, (node) => node.dataset?.action === "warp-editor-open" && node.parentElement?.dataset?.node === "right-grid").dispatch("click");
    expect(find(root, (node) => node.className === "warp-editor-title").textContent).toContain("Right · Grid Warp");
    api.dispose(); globalThis.document = previousDocument;
  });
  test("percentage edit maps once to normalized offset", () => {
    const descriptor = FIELD_DESCRIPTORS.find((item) => item.path === "pre.tx");
    expect(fieldValueFromInput(descriptor, "1.2")).toBe(0.012);
    expect(fineStepFor(descriptor)).toBeCloseTo(0.0001);
  });

  test("saved indicator compares the loaded checkpoint semantically", () => {
    const checkpoint = { schemaVersion: 1, pre: { scale: 1, rotateDeg: 0, tx: 0, ty: 0 }, outputs: { left: { crop: { x0: 0, x1: 1, y0: 0, y1: 1 }, post: { scale: 1, tx: 0, ty: 0 } }, right: { crop: { x0: 0, x1: 1, y0: 0, y1: 1 }, post: { scale: 1, tx: 0, ty: 0 } } } };
    const state = { snapshot: { config: { ...checkpoint, pre: { ...checkpoint.pre } }, presets: [{ id: "desk", config: checkpoint }] }, draft: checkpoint, pending: false, hasLocalDraft: false };
    expect(statusText(state, "desk")).toBe("Saved");
    const changed = { ...checkpoint, pre: { ...checkpoint.pre, tx: 0.01 } };
    expect(statusText({ ...state, snapshot: { ...state.snapshot, config: changed }, draft: changed }, "desk")).toBe("Accepted · preset needs saving");
    expect(statusText({ ...state, hydrating: true }, "desk")).toBe("Connecting");
    expect(statusText({ ...state, hydrating: true, hydrationError: "GET unavailable" }, "desk")).toBe("Settings check failed");
  });

  test("mount exposes fixed graph, mobile selector, and shared field descriptors", () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main");
    const client = fakeClient();
    const api = mountProjectionConfig(root, { client });
    expect(root.querySelectorAll).toBeTypeOf("function");
    expect(root.children.length).toBeGreaterThan(0);
    const text = [];
    const walk = (node) => { if (node.textContent) text.push(node.textContent); for (const child of node.children || []) walk(child); };
    walk(root);
    expect(text.join(" ")).toContain("Affects both projectors");
    expect(FIELD_DESCRIPTORS.some((item) => item.path === "outputs.left.crop.x0")).toBe(true);
    api.dispose();
    expect(client.stop).toHaveBeenCalledTimes(1);
    globalThis.document = previousDocument;
  });

  test("server hydration replaces the cached preset selection", () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const client = fakeClient(null);
    const root = element("main");
    const api = mountProjectionConfig(root, { client });
    const serverConfig = clone(DEFAULTS);
    const snapshot = {
      revision: 9,
      config: serverConfig,
      presets: [
        { id: "original", name: "Original calibration", config: clone(DEFAULTS), readOnly: true },
        { id: "td-baseline", name: "TD migration baseline", config: serverConfig, readOnly: false },
      ],
      selectedPresetId: "td-baseline",
    };
    client.hydrate(snapshot);
    expect(find(root, (node) => node.attributes?.["aria-label"] === "Preset").value).toBe("td-baseline");
    api.dispose(); globalThis.document = previousDocument;
  });

  test("warp arrows use the draft path and flush only while Live is enabled", async () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main");
    const client = fakeClient();
    const api = mountProjectionConfig(root, { client });
    const leftNode = find(root, (node) => node.dataset?.node === "left-keystone");
    leftNode.dispatch("click");
    const arrow = find(root, (node) => node.dataset?.action === "warp-nudge" && node.dataset?.direction === "right");
    arrow.dispatch("click");
    expect(client.setDraft).toHaveBeenCalled();
    await vi.waitFor(() => expect(client.apply).toHaveBeenCalled());
    client.setLive(false);
    arrow.dispatch("click");
    expect(client.apply).toHaveBeenCalledTimes(1);
    const enabled = find(root, (node) => node.attributes?.["aria-label"] === "Enable browser warp");
    enabled.checked = false; enabled.dispatch("change");
    expect(client.getState().draft.outputs.left.warp.enabled).toBe(false);
    api.dispose(); globalThis.document = previousDocument;
  });

  test("Live-off warp undo and redo survive synchronous draft notifications", () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main");
    const client = fakeClient();
    const api = mountProjectionConfig(root, { client });
    client.setLive(false);
    find(root, (node) => node.dataset?.node === "left-keystone").dispatch("click");
    const arrow = find(root, (node) => node.dataset?.action === "warp-nudge" && node.dataset?.direction === "right");
    const undo = find(root, (node) => node.dataset?.action === "warp-undo");
    const redo = find(root, (node) => node.dataset?.action === "warp-redo");
    arrow.dispatch("click");
    const moved = clone(client.getState().draft);
    undo.dispatch("click");
    expect(client.getState().draft.outputs.left.warp.keystone.corners[0][0]).toBe(0);
    redo.dispatch("click");
    expect(client.getState().draft).toEqual(moved);
    expect(client.apply).not.toHaveBeenCalled();
    api.dispose(); globalThis.document = previousDocument;
  });

  test("warp history survives close/reopen and orientation change", () => {
    const previousDocument = globalThis.document;
    const doc = documentStub();
    const windowListeners = new Map();
    doc.defaultView.addEventListener = (type, callback) => windowListeners.set(type, callback);
    doc.defaultView.removeEventListener = (type) => windowListeners.delete(type);
    doc.defaultView.dispatch = (type) => windowListeners.get(type)?.({ type });
    globalThis.document = doc;
    const root = element("main"); const client = fakeClient();
    const api = mountProjectionConfig(root, { client });
    client.setLive(false);
    const action = (name) => find(root, (node) => node.dataset?.action === name);
    const nudgeRight = () => find(root, (node) => node.dataset?.action === "warp-nudge" && node.dataset?.direction === "right").dispatch("click");
    find(root, (node) => node.dataset?.node === "left-keystone").dispatch("click");
    action("warp-editor-open").dispatch("click");
    nudgeRight();
    const keystoneMoved = clone(client.getState().draft.outputs.left.warp.keystone.corners);
    action("warp-editor-close").dispatch("click");
    find(root, (node) => node.dataset?.node === "left-keystone").dispatch("click");
    action("warp-editor-open").dispatch("click");
    doc.defaultView.dispatch("orientationchange");
    action("warp-undo").dispatch("click");
    expect(client.getState().draft.outputs.left.warp.keystone.corners).not.toEqual(keystoneMoved);
    expect(client.getState().draft.outputs.left.warp.keystone.corners[0][0]).toBe(0);
    api.dispose(); globalThis.document = previousDocument;
  });

  test("own Live acknowledgement preserves warp history independently per output", () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const listeners = new Map();
    const socket = {
      send: vi.fn(), getConnected: () => true,
      on(type, handler) { listeners.set(type, handler); }, off(type) { listeners.delete(type); },
    };
    const root = element("main");
    const client = fakeClient();
    const api = mountProjectionConfig(root, { client, socket });
    const initial = clone(client.getState().draft);
    find(root, (node) => node.dataset?.node === "left-keystone").dispatch("click");
    find(root, (node) => node.dataset?.action === "warp-nudge" && node.dataset?.direction === "right").dispatch("click");
    const leftMoved = clone(client.getState().draft);
    expect(leftMoved.outputs.left.warp.keystone.corners).not.toEqual(initial.outputs.left.warp.keystone.corners);
    listeners.get("otef_projection_applied")({ table: "otef", output: "left", instanceId: "local", revision: 2, success: true, route: "browser", baseline: clone(initial.outputs.left.warp.baseline) });
    find(root, (node) => node.dataset?.node === "right-keystone").dispatch("click");
    find(root, (node) => node.dataset?.action === "warp-nudge" && node.dataset?.direction === "down").dispatch("click");
    const rightMoved = clone(client.getState().draft);
    find(root, (node) => node.dataset?.node === "left-keystone").dispatch("click");
    find(root, (node) => node.dataset?.action === "warp-undo").dispatch("click");
    expect(client.getState().draft.outputs.left.warp.keystone.corners).toEqual(initial.outputs.left.warp.keystone.corners);
    expect(client.getState().draft.outputs.right.warp.keystone.corners).toEqual(rightMoved.outputs.right.warp.keystone.corners);
    expect(client.getState().draft.outputs.left.warp.keystone.corners).not.toEqual(leftMoved.outputs.left.warp.keystone.corners);
    api.dispose(); globalThis.document = previousDocument;
  });

  test("accepted external replacement rebases warp history", () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main"); const client = fakeClient();
    const api = mountProjectionConfig(root, { client });
    client.setLive(false);
    find(root, (node) => node.dataset?.node === "left-keystone").dispatch("click");
    find(root, (node) => node.dataset?.action === "warp-nudge" && node.dataset?.direction === "right").dispatch("click");
    expect(client.getState().draft.outputs.left.warp.keystone.corners[0][0]).toBeCloseTo(0.25 / 1920);
    const authoritative = clone(client.getState().draft);
    authoritative.outputs.left.warp.keystone.corners[0] = [0.12, 0.03];
    client.report({ draft: authoritative, hasLocalDraft: false });
    find(root, (node) => node.dataset?.action === "warp-undo").dispatch("click");
    expect(client.getState().draft.outputs.left.warp.keystone.corners[0]).toEqual([0.12, 0.03]);
    api.dispose(); globalThis.document = previousDocument;
  });

  test("wires workstation display assignment and browser output actions into the existing toolbar", async () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main");
    const screens = [
      { key: "left-screen", displayNumber: 1, label: "Left screen", left: -100, top: 0, width: 1920, height: 1080 },
      { key: "right-screen", displayNumber: 2, label: "Right screen", left: 1820, top: 0, width: 1920, height: 1080 },
    ];
    let outputState = { screens: [], assignments: { left: null, right: null }, message: "Identify displays", error: "", ownedSpans: [] };
    const outputListeners = new Set();
    const outputController = {
      refreshDisplays: vi.fn(async () => { outputState = { ...outputState, screens, message: "Displays detected" }; outputListeners.forEach((listener) => listener(outputState)); return screens; }),
      identifyDisplays: vi.fn(() => { outputListeners.forEach((listener) => listener(outputState)); return screens; }),
      dispose: vi.fn(),
      assignDisplays: vi.fn((selection) => { outputState = { ...outputState, assignments: selection, message: "Assignment saved" }; outputListeners.forEach((listener) => listener(outputState)); return outputState; }),
      openBoth: vi.fn(async () => { outputState = { ...outputState, ownedSpans: ["left", "right"], message: "Browser outputs opened" }; outputListeners.forEach((listener) => listener(outputState)); return outputState.ownedSpans; }),
      closeBoth: vi.fn(() => { outputState = { ...outputState, ownedSpans: [], message: "Browser outputs closed" }; outputListeners.forEach((listener) => listener(outputState)); return outputState; }),
      getState: () => outputState,
      subscribe(listener) { outputListeners.add(listener); listener(outputState); return () => outputListeners.delete(listener); },
    };
    const client = fakeClient();
    const api = mountProjectionConfig(root, { client, outputController });
    const action = (name) => find(root, (node) => node.dataset?.action === name);
    await vi.waitFor(() => expect(outputController.refreshDisplays).toHaveBeenCalledTimes(1));
    expect(outputController.identifyDisplays).not.toHaveBeenCalled();
    action("output-identify").dispatch("click");
    await vi.waitFor(() => expect(outputController.identifyDisplays).toHaveBeenCalledTimes(1));
    const left = find(root, (node) => node.dataset?.action === "output-left-display");
    const right = find(root, (node) => node.dataset?.action === "output-right-display");
    expect(left.children.map((option) => option.textContent)).toEqual(["Display 1 · Left screen", "Display 2 · Right screen"]);
    expect(right.children.map((option) => option.textContent)).toEqual(["Display 1 · Left screen", "Display 2 · Right screen"]);
    left.value = "left-screen"; right.value = "right-screen"; left.dispatch("change"); right.dispatch("change");
    action("output-identify").dispatch("click");
    client.report({ previewError: "unrelated preview refresh" });
    expect(left.value).toBe("left-screen");
    expect(right.value).toBe("right-screen");
    expect(outputController.assignDisplays).not.toHaveBeenCalled();
    action("output-assign").dispatch("click");
    expect(outputController.assignDisplays).toHaveBeenCalledWith({ left: "left-screen", right: "right-screen" });
    action("output-open-both").dispatch("click");
    await vi.waitFor(() => expect(outputController.openBoth).toHaveBeenCalledTimes(1));
    action("output-close-both").dispatch("click");
    expect(outputController.closeBoth).toHaveBeenCalledTimes(1);
    api.dispose(); expect(outputController.dispose).toHaveBeenCalledTimes(1); globalThis.document = previousDocument;
  });

  test("authoritative rebase discards an active drag without publishing its rollback", () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main");
    const client = fakeClient();
    const api = mountProjectionConfig(root, { client });
    client.setLive(false);
    find(root, (node) => node.dataset?.action === "warp-editor-open" && node.parentElement?.dataset?.node === "left-keystone").dispatch("click");
    const surface = find(root, (node) => node.attributes?.class === "warp-edit-surface");
    surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 2064, height: 1224 });
    surface.dispatch("pointerdown", { pointerId: 1, isPrimary: true, button: 0, clientX: 72, clientY: 72, preventDefault() {} });
    surface.dispatch("pointermove", { pointerId: 1, clientX: 92, clientY: 72 });
    expect(client.getState().draft.outputs.left.warp.keystone.corners[0][0]).toBeCloseTo(20 / 1920);
    const authoritative = clone(client.getState().draft);
    authoritative.outputs.left.warp.keystone.corners[0][0] = 0.02;
    const before = client.setDraft.mock.calls.length;
    client.report({ draft: authoritative, hasLocalDraft: false });
    surface.dispatch("pointerdown", { pointerId: 2, isPrimary: true, button: 0, clientX: 72 + 0.02 * 1920, clientY: 72, preventDefault() {} });
    surface.dispatch("pointermove", { pointerId: 2, clientX: 72 + 0.02 * 1920 + 10, clientY: 72 });
    expect(client.getState().draft.outputs.left.warp.keystone.corners[0][0]).toBeCloseTo(0.02 + 10 / 1920);
    surface.dispatch("pointercancel", { pointerId: 2 });
    surface.dispatch("lostpointercapture", { pointerId: 1 });
    expect(client.setDraft.mock.calls.length).toBeGreaterThan(before);
    expect(client.getState().draft.outputs.left.warp.keystone.corners[0][0]).toBe(0.02);
    api.dispose(); globalThis.document = previousDocument;
  });

  test("pointer-up displacement commits a drag even without a pointermove event", () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main"); const client = fakeClient();
    const api = mountProjectionConfig(root, { client });
    client.setLive(false);
    find(root, (node) => node.dataset?.action === "warp-editor-open" && node.parentElement?.dataset?.node === "left-keystone").dispatch("click");
    const surface = find(root, (node) => node.attributes?.class === "warp-edit-surface");
    surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 2064, height: 1224 });
    surface.dispatch("pointerdown", { pointerId: 1, isPrimary: true, button: 0, clientX: 72, clientY: 72, preventDefault() {} });
    surface.dispatch("pointerup", { pointerId: 1, clientX: 92, clientY: 72 });
    expect(client.getState().draft.outputs.left.warp.keystone.corners[0][0]).toBeCloseTo(20 / 1920);
    find(root, (node) => node.dataset?.action === "warp-undo").dispatch("click");
    expect(client.getState().draft.outputs.left.warp.keystone.corners[0][0]).toBe(0);
    api.dispose(); globalThis.document = previousDocument;
  });

  test("pointer-up position supersedes the last pointermove position", () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main"); const client = fakeClient();
    const api = mountProjectionConfig(root, { client });
    client.setLive(false);
    find(root, (node) => node.dataset?.action === "warp-editor-open" && node.parentElement?.dataset?.node === "left-keystone").dispatch("click");
    const surface = find(root, (node) => node.attributes?.class === "warp-edit-surface");
    surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 2064, height: 1224 });
    surface.dispatch("pointerdown", { pointerId: 1, isPrimary: true, button: 0, clientX: 72, clientY: 72, preventDefault() {} });
    surface.dispatch("pointermove", { pointerId: 1, clientX: 82, clientY: 72 });
    surface.dispatch("pointerup", { pointerId: 1, clientX: 92, clientY: 72 });
    expect(client.getState().draft.outputs.left.warp.keystone.corners[0][0]).toBeCloseTo(20 / 1920);
    find(root, (node) => node.dataset?.action === "warp-undo").dispatch("click");
    expect(client.getState().draft.outputs.left.warp.keystone.corners[0][0]).toBe(0);
    api.dispose(); globalThis.document = previousDocument;
  });

  test("accepted warp movement and pointer-up redraw once while updating the draft immediately", () => {
    const { root, client, trace, surface, redraws, restore } = tracedWarpHarness();
    const initialWarp = clone(client.getState().draft.outputs.left.warp);
    surface.dispatch("pointerdown", { pointerId: 1, isPrimary: true, button: 0, clientX: 72, clientY: 72, preventDefault() {} });
    trace.record.mockClear();
    surface.dispatch("pointermove", { pointerId: 1, clientX: 82, clientY: 72 });
    expect(client.getState().draft.outputs.left.warp.keystone.corners[0][0]).toBeCloseTo(10 / 1920);
    expect(redraws()).toBe(1);

    surface.dispatch("pointerup", { pointerId: 1, clientX: 92, clientY: 72 });
    expect(client.getState().draft.outputs.left.warp.keystone.corners[0][0]).toBeCloseTo(20 / 1920);
    expect(redraws()).toBe(2);
    find(root, (node) => node.dataset?.action === "warp-undo").dispatch("click");
    expect(client.getState().draft.outputs.left.warp).toEqual(initialWarp);
    expect(redraws()).toBe(3);
    restore();
  });

  test("warp nudge and undo each redraw once", () => {
    const { root, client, trace, redraws, restore } = tracedWarpHarness();
    const arrow = find(root, (node) => node.dataset?.action === "warp-nudge" && node.dataset?.direction === "right");
    const undo = find(root, (node) => node.dataset?.action === "warp-undo");
    trace.record.mockClear();
    arrow.dispatch("click");
    expect(client.getState().draft.outputs.left.warp.keystone.corners[0][0]).not.toBe(0);
    expect(redraws()).toBe(1);

    trace.record.mockClear();
    undo.dispatch("click");
    expect(client.getState().draft.outputs.left.warp.keystone.corners[0][0]).toBe(0);
    expect(redraws()).toBe(1);
    restore();
  });

  test("Grid axis resize preserves selection and flushes once in Live after candidate validation", async () => {
    const { root, client, trace, redraws, restore } = tracedWarpHarness({ candidateValidator: { validateCandidate: async ({ identity }) => ({ identity, valid: true }), dispose() {} } });
    find(root, (node) => node.dataset?.action === "warp-editor-close").dispatch("click");
    client.setLive(true);
    find(root, (node) => node.dataset?.action === "warp-editor-open" && node.parentElement?.dataset?.node === "left-grid").dispatch("click");
    const chooseColumn = find(root, (node) => node.dataset?.warpSelectionKind === "column");
    chooseColumn.dispatch("click");
    const columnPicker = find(root, (node) => node.className === "warp-selection-picker");
    columnPicker.value = "2"; columnPicker.dispatch("change");
    const before = clone(client.getState().draft.outputs.left.warp.grid);
    client.setDraft.mockClear(); client.apply.mockClear(); trace.record.mockClear();
    const rows = find(root, (node) => node.dataset?.gridLayoutField === "rows");
    rows.value = "3"; rows.dispatch("input"); rows.dispatch("change");
    await vi.waitFor(() => expect(client.getState().draft.outputs.left.warp.grid.rows).toBe(3));
    expect(client.getState().draft.outputs.left.warp.grid.rows).toBe(3);
    expect(client.setDraft).toHaveBeenCalledTimes(1);
    expect(client.apply).toHaveBeenCalledTimes(1);
    expect(redraws()).toBeGreaterThan(0); // Preview, validation, and commit each refresh the shared panel.
    expect(columnPicker.value).toBe("2");
    find(root, (node) => node.dataset?.action === "warp-undo").dispatch("click");
    expect(client.getState().draft.outputs.left.warp.grid).toEqual(before);
    expect(client.setDraft).toHaveBeenCalledTimes(2);
    expect(client.apply).toHaveBeenCalledTimes(2);
    expect(columnPicker.value).toBe("2");
    restore();
  });

  test('rejected warp coordinates stay pending and block selection switches until cancelled', () => {
    const { root, client, restore } = tracedWarpHarness();
    const input = find(root, node => node.dataset?.field === 'warp.position.x');
    const before = clone(client.getState().draft.outputs.left.warp);
    input.value = '999999'; input.dispatch('input'); input.dispatch('change');
    expect(client.getState().draft.outputs.left.warp).toEqual(before);
    expect(input.attributes['aria-invalid']).toBe('true');
    const gridOpen = find(root, node => node.dataset?.action === 'warp-editor-open' && node.parentElement?.dataset?.node === 'left-grid');
    gridOpen.dispatch('click');
    expect(find(root, node => node.className === 'warp-editor-dialog').dataset.mode).toBe('keystone');
    expect(find(root, node => node.className === 'warp-precision-panel').hidden).toBe(false);
    expect(client.getState().draft.outputs.left.warp).toEqual(before);
    find(root, node => node.dataset?.action === 'warp-editor-close').dispatch('click');
    expect(find(root, node => node.className === 'warp-editor-dialog').hidden).toBe(false);
    input.dispatch('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} });
    find(root, node => node.dataset?.action === 'warp-editor-close').dispatch('click');
    expect(find(root, node => node.className === 'warp-editor-dialog').hidden).toBe(true);
    restore();
  });

  test("warp view exposes direct Edit and Move controls with clear pressed state", () => {
    const h = tracedWarpHarness();
    try {
      const edit = find(h.root, node => node.className === "warp-edit-toggle");
      const move = find(h.root, node => node.className === "warp-pan-toggle");
      expect(edit.textContent).toBe("Edit");
      expect(move.textContent).toBe("Move view");
      expect(edit.attributes["aria-pressed"]).toBe("true");
      expect(move.attributes["aria-pressed"]).toBe("false");
      move.dispatch("click");
      expect(edit.attributes["aria-pressed"]).toBe("false");
      expect(move.attributes["aria-pressed"]).toBe("true");
      edit.dispatch("click");
      expect(edit.attributes["aria-pressed"]).toBe("true");
      expect(move.attributes["aria-pressed"]).toBe("false");
    } finally { h.restore(); }
  });

  test("an own Live draft acknowledgment during a warp drag retains the active gesture and one Undo", () => {
    const h = tracedWarpHarness();
    try {
      h.client.setLive(true);
      const initial = clone(h.client.getState().draft.outputs.left.warp);
      h.surface.dispatch("pointerdown", { pointerId: 1, isPrimary: true, button: 0, clientX: 72, clientY: 72, preventDefault() {} });
      h.surface.dispatch("pointermove", { pointerId: 1, clientX: 82, clientY: 72 });
      const ownDraft = clone(h.client.getState().draft);
      expect(ownDraft.outputs.left.warp.keystone.corners[0]).not.toEqual(initial.keystone.corners[0]);
      h.client.setDraft.mockClear();
      h.client.report({
        snapshot: { ...h.client.getState().snapshot, revision: 3, config: clone(ownDraft) },
        draft: clone(ownDraft),
        hasLocalDraft: true,
      });
      h.surface.dispatch("pointermove", { pointerId: 1, clientX: 92, clientY: 72 });
      h.surface.dispatch("pointerup", { pointerId: 1, clientX: 94, clientY: 72 });
      expect(h.client.getState().draft.outputs.left.warp.keystone.corners[0]).not.toEqual(initial.keystone.corners[0]);
      expect(h.client.setDraft).toHaveBeenCalledTimes(3);
      expect(find(h.root, node => node.dataset?.action === "warp-undo").disabled).toBe(false);
      find(h.root, node => node.dataset?.action === "warp-undo").dispatch("click");
      expect(h.client.getState().draft.outputs.left.warp).toEqual(initial);
    } finally { h.restore(); }
  });

  test.each(["left-keystone", "right-keystone", "left-grid", "right-grid"])("bypassed %s keeps selection and navigation available, disables geometry, and offers Enable correction", nodeId => {
    const previousDocument = globalThis.document; globalThis.document = documentStub();
    const root = element("main"); const client = fakeClient();
    const config = clone(client.getState().draft);
    const output = nodeId.startsWith("right-") ? "right" : "left";
    config.outputs[output].warp.enabled = false;
    config.outputs[output].warp.keystone.corners[0] = [0.03, 0.02];
    client.report({ draft: config });
    const api = mountProjectionConfig(root, { client });
    try {
      find(root, node => node.dataset?.node === nodeId).dispatch("click");
      find(root, node => node.dataset?.action === "warp-editor-open" && node.parentElement?.dataset?.node === nodeId).dispatch("click");
      const status = find(root, node => node.className === "warp-selection-status");
      const enable = find(root, node => node.dataset?.action === "warp-enable-correction");
      const nudge = find(root, node => node.dataset?.action === "warp-nudge" && node.dataset?.direction === "right");
      const surface = find(root, node => node.attributes?.class === "warp-edit-surface");
      expect(status.textContent).toContain("Correction bypassed; geometry editing disabled");
      expect(enable.textContent).toBe("Enable correction to edit");
      expect(enable.hidden).toBe(false);
      expect(nudge.disabled).toBe(true);
      expect(find(root, node => node.dataset?.action === "warp-undo").disabled).toBe(true);
      expect(find(root, node => node.dataset?.action === "warp-redo").disabled).toBe(true);
      expect(find(root, node => node.attributes?.["aria-label"] === "Selected warp X position").disabled).toBe(true);
      find(surface, node => node.attributes?.["data-index"] === "3").dispatch("keydown", { key: "Enter", preventDefault() {} });
      expect(status.textContent).toContain(nodeId.endsWith("-grid") ? "Point 4" : "Bottom-right corner");
      enable.dispatch("click");
      expect(client.getState().draft.outputs[output].warp.enabled).toBe(true);
      expect(enable.hidden).toBe(true);
      expect(nudge.disabled).toBe(false);
    } finally { api.dispose(); globalThis.document = previousDocument; }
  });

  test('warp panel Escape retires rejected coordinate validation without draft or history writes', () => {
    const { root, client, restore } = tracedWarpHarness();
    const doc = globalThis.document;
    const input = find(root, node => node.dataset?.field === 'warp.position.x');
    input.value = '999999'; input.dispatch('input'); input.dispatch('change');
    expect(input.attributes['aria-invalid']).toBe('true');
    const before = clone(client.getState().draft.outputs.left.warp);
    client.setDraft.mockClear(); client.apply.mockClear();

    doc.dispatch('keydown', { key: 'Escape', preventDefault() {} });
    expect(find(root, node => node.className === 'warp-editor-dialog').hidden).toBe(false);
    expect(input.attributes['aria-invalid']).toBe('false');
    expect(find(root, node => node.className === 'warp-selection-status').textContent).not.toContain('Move rejected:');
    expect(client.getState().draft.outputs.left.warp).toEqual(before);
    expect(client.setDraft).not.toHaveBeenCalled(); expect(client.apply).not.toHaveBeenCalled();

    doc.dispatch('keydown', { key: 'Escape', preventDefault() {} });
    expect(find(root, node => node.className === 'warp-editor-dialog').hidden).toBe(true);
    restore();
  });

  test("invalid source-line geometry reports in the preview status without draft, apply, or history writes", async () => {
    const { root, client, trace, restore } = tracedWarpHarness();
    find(root, (node) => node.dataset?.action === "warp-editor-close").dispatch("click");
    find(root, (node) => node.dataset?.action === "warp-editor-open" && node.parentElement?.dataset?.node === "left-grid").dispatch("click");
    find(root, (node) => node.dataset?.warpSelectionKind === "row").dispatch("click");
    const picker = find(root, (node) => node.className === "warp-selection-picker"); picker.value = "1"; picker.dispatch("change");
    const before = clone(client.getState().draft.outputs.left.warp);
    client.setDraft.mockClear(); client.apply.mockClear(); trace.record.mockClear();
    const sourceY = find(root, (node) => node.dataset?.gridLayoutField === "source-y");
    sourceY.value = "100"; sourceY.dispatch("input"); sourceY.dispatch("change"); sourceY.dispatch("blur");
    expect(client.getState().draft.outputs.left.warp).toEqual(before);
    expect(client.setDraft).not.toHaveBeenCalled();
    expect(client.apply).not.toHaveBeenCalled();
    expect(find(root, (node) => node.dataset?.action === "warp-undo").disabled).toBe(true);
    await vi.waitFor(() => expect(find(root, (node) => node.className === "warp-grid-layout-preview-status").textContent).toContain("between its neighbors"));
    restore();
  });

  test("invalid or stale async grid candidates expose a reason without draft, history, or Live writes", async () => {
    const checks = [];
    const candidateValidator = { validateCandidate: vi.fn(({ identity }) => candidateValidator.validateCandidate.mock.calls.length === 1
      ? Promise.resolve({ identity, valid: false, reason: "Candidate geometry was rejected." })
      : new Promise(resolve => checks.push({ identity, resolve }))), dispose() {} };
    const { root, client, api, restore } = tracedWarpHarness({ candidateValidator });
    try {
      find(root, node => node.dataset?.action === "warp-editor-close").dispatch("click");
      find(root, node => node.dataset?.action === "warp-editor-open" && node.parentElement?.dataset?.node === "left-grid").dispatch("click");
      find(root, node => node.dataset?.warpSelectionKind === "row").dispatch("click");
      const picker = find(root, node => node.className === "warp-selection-picker"); picker.value = "2"; picker.dispatch("change");
      const remove = find(root, node => node.dataset?.gridLayoutAction === "remove-row");
      client.setDraft.mockClear(); client.apply.mockClear();
      remove.dispatch("click"); await vi.waitFor(() => expect(candidateValidator.validateCandidate).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(find(root, node => node.className === "warp-grid-layout-preview-status").textContent).toContain("Candidate geometry was rejected."));
      expect(client.setDraft).not.toHaveBeenCalled(); expect(client.apply).not.toHaveBeenCalled();
      find(root, node => node.dataset?.action === "warp-grid-layout-cancel").dispatch("click");

      remove.dispatch("click"); await vi.waitFor(() => expect(checks).toHaveLength(1));
      const replacement = clone(client.getState().draft); replacement.outputs.left.warp.keystone.corners[0][0] = .02;
      client.report({ draft: replacement, hasLocalDraft: true });
      checks[0].resolve({ identity: checks[0].identity, valid: true });
      await vi.waitFor(() => expect(find(root, node => node.className === "warp-grid-layout-preview-status").textContent).toContain("warp changed"));
      expect(client.setDraft).not.toHaveBeenCalled(); expect(client.apply).not.toHaveBeenCalled();
      expect(find(root, node => node.dataset?.action === "warp-undo").disabled).toBe(true);
    } finally { restore(); }
  });

  test("accepted replacement cancels a pending source input and syncs the new source axis", () => {
    const { root, client, restore } = tracedWarpHarness();
    find(root, (node) => node.dataset?.action === "warp-editor-close").dispatch("click");
    find(root, (node) => node.dataset?.action === "warp-editor-open" && node.parentElement?.dataset?.node === "left-grid").dispatch("click");
    find(root, (node) => node.dataset?.warpSelectionKind === "row").dispatch("click");
    const picker = find(root, (node) => node.className === "warp-selection-picker"); picker.value = "1"; picker.dispatch("change");
    const sourceY = find(root, (node) => node.dataset?.gridLayoutField === "source-y");
    sourceY.value = "55"; sourceY.dispatch("input");
    const external = clone(client.getState().draft);
    external.outputs.left.warp.grid.rowPositions[1] = 0.2;
    client.setDraft.mockClear(); client.apply.mockClear();
    client.report({ draft: external, hasLocalDraft: false, snapshot: { ...client.getState().snapshot, revision: 3, config: clone(external) } });
    expect(sourceY.value).toBe("20");
    sourceY.dispatch("change"); sourceY.dispatch("blur");
    expect(client.setDraft).not.toHaveBeenCalled(); expect(client.apply).not.toHaveBeenCalled();
    restore();
  });

  test("warp pointer cancel rolls back and redraws once", () => {
    const { client, trace, surface, redraws, restore } = tracedWarpHarness();
    const initialWarp = clone(client.getState().draft.outputs.left.warp);
    surface.dispatch("pointerdown", { pointerId: 1, isPrimary: true, button: 0, clientX: 72, clientY: 72, preventDefault() {} });
    surface.dispatch("pointermove", { pointerId: 1, clientX: 82, clientY: 72 });
    expect(client.getState().draft.outputs.left.warp).not.toEqual(initialWarp);
    trace.record.mockClear();
    surface.dispatch("pointercancel", { pointerId: 1 });
    expect(client.getState().draft.outputs.left.warp).toEqual(initialWarp);
    expect(redraws()).toBe(1);
    restore();
  });

  test("warp draft errors still redraw once", () => {
    const { client, trace, surface, redraws, restore } = tracedWarpHarness();
    surface.dispatch("pointerdown", { pointerId: 1, isPrimary: true, button: 0, clientX: 72, clientY: 72, preventDefault() {} });
    client.setDraft.mockImplementationOnce(() => { throw new Error("draft rejected"); });
    trace.record.mockClear();
    expect(() => surface.dispatch("pointermove", { pointerId: 1, clientX: 82, clientY: 72 })).not.toThrow();
    expect(client.getState().draft.outputs.left.warp.keystone.corners[0][0]).toBe(0);
    expect(redraws()).toBe(1);
    restore();
  });

  test("asynchronous apply rejection redraws after the warp batch", async () => {
    const { root, client, trace, surface, redraws, restore } = tracedWarpHarness();
    client.apply.mockRejectedValueOnce(new Error("apply rejected"));
    const actionError = find(root, (node) => node.className === "action-error");
    client.setLive(true);
    surface.dispatch("pointerdown", { pointerId: 1, isPrimary: true, button: 0, clientX: 72, clientY: 72, preventDefault() {} });
    surface.dispatch("pointermove", { pointerId: 1, clientX: 82, clientY: 72 });
    trace.record.mockClear();
    surface.dispatch("pointerup", { pointerId: 1, clientX: 92, clientY: 72 });
    expect(redraws()).toBe(1);
    expect(actionError.textContent).not.toContain("apply rejected");
    await vi.waitFor(() => expect(actionError.textContent).toContain("apply rejected"));
    expect(redraws()).toBeGreaterThan(1);
    restore();
  });

  test("an invalid release keeps the last valid drag position and one undo entry", () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main"); const client = fakeClient();
    const api = mountProjectionConfig(root, { client });
    client.setLive(false);
    find(root, (node) => node.dataset?.action === "warp-editor-open" && node.parentElement?.dataset?.node === "left-keystone").dispatch("click");
    const surface = find(root, (node) => node.attributes?.class === "warp-edit-surface");
    surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 2064, height: 1224 });
    surface.dispatch("pointerdown", { pointerId: 1, isPrimary: true, button: 0, clientX: 72, clientY: 72, preventDefault() {} });
    surface.dispatch("pointermove", { pointerId: 1, clientX: 82, clientY: 72 });
    surface.dispatch("pointerup", { pointerId: 1, clientX: 10000, clientY: 72 });
    expect(client.getState().draft.outputs.left.warp.keystone.corners[0][0]).toBeCloseTo(10 / 1920);
    find(root, (node) => node.dataset?.action === "warp-undo").dispatch("click");
    expect(client.getState().draft.outputs.left.warp.keystone.corners[0][0]).toBe(0);
    api.dispose(); globalThis.document = previousDocument;
  });

  test('hydration presents a historical seam-gap readjustment notice', () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element('main'); const client = fakeClient();
    const api = mountProjectionConfig(root, { client });
    client.report({ migrationWarnings: ['The wall seam gap needs readjustment in final-output pixels.'] });
    const notice = find(root, (node) => node.className === 'conflict-banner');
    expect(notice.textContent).toContain('seam gap needs readjustment');
    api.dispose(); globalThis.document = previousDocument;
  });

  test('wall rotation is a shared top-level field and obeys Live off', () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element('main');
    const client = fakeClient();
    client.setLive(false);
    const before = clone(client.getState().snapshot.config.outputs);
    const api = mountProjectionConfig(root, { client });
    try {
      const node = find(root, item => item.dataset?.node === 'names-wall');
      const input = find(node, item => item.dataset?.field === 'namesWall.rotateDeg' && item.dataset.input === 'number');
      expect(input.value).toBe('35');
      input.value = '70'; input.dispatch('input'); input.dispatch('blur');
      expect(client.getState().draft.namesWall.rotateDeg).toBe(70);
      expect(client.getState().draft.namesWall.profiles.wall.rotateDeg).toBeUndefined();
      expect(client.getState().draft.namesWall.profiles.model.rotateDeg).toBeUndefined();
      expect(client.getState().snapshot.config.namesWall.rotateDeg).toBe(35);
      expect(client.getState().snapshot.config.outputs).toEqual(before);
      expect(client.getState().draft.pre.rotateDeg).toBe(DEFAULTS.pre.rotateDeg);
      expect(client.apply).not.toHaveBeenCalled();
      const mode = find(node, (item) => item.attributes?.['aria-label'] === 'Names wall profile');
      mode.value = 'model'; mode.dispatch('change');
      expect(input.value).toBe('70');
      expect(client.getState().draft.namesWall.rotateDeg).toBe(70);
    } finally {
      api.dispose(); globalThis.document = previousDocument;
    }
  });

  test('empty and out-of-range wall rotation keeps the previous draft', () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element('main');
    const client = fakeClient();
    const api = mountProjectionConfig(root, { client });
    try {
      const node = find(root, (item) => item.dataset?.node === 'names-wall');
      const input = find(node, (item) => item.dataset?.field === 'namesWall.rotateDeg' && item.dataset.input === 'number');
      const error = find(node, (item) => item.dataset?.errorFor === 'namesWall.rotateDeg');
      input.value = ''; input.dispatch('input'); input.dispatch('blur');
      expect(client.getState().draft.namesWall.rotateDeg).toBe(35);
      expect(error.textContent).toMatch(/complete number/i);
      input.value = '181'; input.dispatch('input'); input.dispatch('blur');
      expect(client.getState().draft.namesWall.rotateDeg).toBe(35);
      expect(error.textContent).toMatch(/between -180 and 180/);
      expect(client.getState().snapshot.config.namesWall.rotateDeg).toBe(35);
    } finally {
      api.dispose(); globalThis.document = previousDocument;
    }
  });

  test('preset load uses the saved wall rotation', async () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element('main');
    const client = fakeClient();
    const turned = clone(DEFAULTS);
    turned.namesWall.rotateDeg = 12;
    const snapshot = clone(client.getState().snapshot);
    snapshot.presets.push({ id: 'turned', name: 'Turned', config: turned, readOnly: false });
    client.hydrate(snapshot);
    const api = mountProjectionConfig(root, { client });
    try {
      const presets = find(root, (item) => item.attributes?.['aria-label'] === 'Preset');
      presets.value = 'turned';
      presets.dispatch('change');
      find(root, (item) => item.dataset?.action === 'load').dispatch('click');
      await vi.waitFor(() => expect(client.getState().draft.namesWall.rotateDeg).toBe(12));
      const input = find(root, (item) => item.dataset?.field === 'namesWall.rotateDeg' && item.dataset.input === 'number');
      expect(input.value).toBe('12');
      expect(client.getState().draft.pre.rotateDeg).toBe(DEFAULTS.pre.rotateDeg);
      expect(client.getState().draft.namesWall.profiles.wall.rotateDeg).toBeUndefined();
      expect(client.getState().snapshot.config.namesWall.rotateDeg).toBe(35);
    } finally {
      api.dispose(); globalThis.document = previousDocument;
    }
  });

  test("Names wall edits the active profile and preserves the other profile", () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main");
    const client = fakeClient();
    const api = mountProjectionConfig(root, { client });
    const node = find(root, (item) => item.dataset?.node === "names-wall");
    expect(node).not.toBeNull();
    const mode = find(node, (item) => item.attributes?.["aria-label"] === "Names wall profile");
    mode.value = "model";
    mode.dispatch("change");
    expect(client.getState().draft.namesWall.activeMode).toBe("model");
    const inset = find(node, (item) => item.dataset?.field === "namesWall.innerEdgeInsetPx.left" && item.dataset.input === "number");
    inset.value = "60";
    inset.dispatch("input"); inset.dispatch("blur");
    const font = find(node, (item) => item.dataset?.field === "namesWall.requestedFontPx" && item.dataset.input === "number");
    font.value = "6";
    font.dispatch("input"); font.dispatch("blur");
    expect(client.getState().draft.namesWall.profiles.model.requestedFontPx).toBe(6);
    expect(client.getState().draft.namesWall.profiles.wall.requestedFontPx).toBe(12);
    expect(client.getState().draft.namesWall.innerEdgeInsetPx.left).toBe(60);
    const spacing = find(node, (item) => item.dataset?.field === "namesWall.spacingPx" && item.dataset.input === "number");
    spacing.value = "1";
    spacing.dispatch("input"); spacing.dispatch("blur");
    expect(client.getState().draft.namesWall.profiles.model.spacingPx).toBe(1);
    expect(client.getState().draft.namesWall.profiles.wall.spacingPx).toBe(2);
    api.dispose(); globalThis.document = previousDocument;
  });

  test("Names wall numeric descriptors use the shared integer bounds", () => {
    expect(NAMES_WALL_DESCRIPTORS.map(({ path, min, max, step }) => [path, min, max, step])).toEqual([
      ["namesWall.rotateDeg", -180, 180, 1],
      ["namesWall.strokeWidthPx", 1, 6, 1],
      ["namesWall.requestedFontPx", 1, 48, 1],
      ["namesWall.spacingPx", 0, 32, 1], ["namesWall.edgeInsetPx", 0, 256, 1],
      ["namesWall.inwardShiftPercent", 0, 100, 1],
      ["namesWall.innerEdgeInsetPx.left", 0, 960, 1], ["namesWall.innerEdgeInsetPx.right", 0, 960, 1],
    ]);
  });

  test("Names wall settings survive Live, preset, conflict, save, and Revert paths", async () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main"); const client = fakeClient();
    const api = mountProjectionConfig(root, { client });
    const action = (name) => find(root, (item) => item.dataset?.action === name);
    const node = find(root, (item) => item.dataset?.node === "names-wall");
    const live = action("live"); live.checked = false; live.dispatch("change");
    const setField = (path, value) => { const input = find(node, (item) => item.dataset?.field === path && item.dataset.input === "number"); input.value = String(value); input.dispatch("input"); input.dispatch("blur"); };
    setField("namesWall.inwardShiftPercent", 50);
    const mode = find(node, (item) => item.attributes?.["aria-label"] === "Names wall profile"); mode.value = "model"; mode.dispatch("change");
    setField("namesWall.innerEdgeInsetPx.left", 60); setField("namesWall.requestedFontPx", 6); setField("namesWall.spacingPx", 1);
    expect(find(node, (item) => item.dataset?.field === "namesWall.strokeWidthPx" && item.dataset.input === "number").value).toBe("2");
    setField("namesWall.strokeWidthPx", 3);
    expect(client.getState().draft.namesWall.profiles.model.strokeWidthPx).toBe(3);
    expect(client.getState().draft.namesWall.profiles.wall.strokeWidthPx).toBe(3);
    mode.value = "wall"; mode.dispatch("change");
    setField("namesWall.strokeWidthPx", 5);
    expect(client.getState().draft.namesWall.profiles.wall.strokeWidthPx).toBe(5);
    mode.value = "model"; mode.dispatch("change");
    expect(find(node, (item) => item.dataset?.field === "namesWall.strokeWidthPx" && item.dataset.input === "number").value).toBe("3");
    action("apply").dispatch("click");
    await vi.waitFor(() => expect(client.apply).toHaveBeenCalledTimes(1));
    const name = find(root, (item) => item.attributes?.["aria-label"] === "Preset name"); name.value = "Wall profile";
    clickCommand(root, "save-new");
    await vi.waitFor(() => expect(client.savedDrafts.at(-1).namesWall.profiles.model.requestedFontPx).toBe(6));
    expect(client.savedDrafts.at(-1).namesWall.profiles.wall.inwardShiftPercent).toBe(50);
    api.setConflict("Remote update");
    action("revert").dispatch("click");
    await vi.waitFor(() => expect(client.revert).toHaveBeenCalledTimes(1));
    expect(client.getState().draft.namesWall).toEqual(client.getState().snapshot.config.namesWall);
    expect(client.getState().draft.namesWall.profiles.wall.inwardShiftPercent).toBe(50);
    api.dispose(); globalThis.document = previousDocument;
  });

  test("coarse pointer support does not block local output actions", () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub({ coarse: true });
    const root = element("main");
    const outputController = {
      identifyDisplays: vi.fn(), assignDisplays: vi.fn(), openBoth: vi.fn(), closeBoth: vi.fn(),
      getState: () => ({ screens: [{ key: "display-1", displayNumber: 1 }], assignments: { left: null, right: null }, message: "Identify displays", error: "", ownedSpans: [] }),
      subscribe(listener) { listener(this.getState()); return () => {}; },
    };
    const api = mountProjectionConfig(root, { client: fakeClient(), outputController });
    const identify = find(root, (node) => node.dataset?.action === "output-identify");
    identify.dispatch("click");
    expect(identify.disabled).toBe(false);
    expect(outputController.identifyDisplays).toHaveBeenCalledTimes(1);
    api.dispose(); globalThis.document = previousDocument;
  });
});
