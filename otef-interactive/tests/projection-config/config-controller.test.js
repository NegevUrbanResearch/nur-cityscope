import { describe, expect, test, vi } from "vitest";
import { DEFAULT_PROJECTION_CONFIG as DEFAULTS, LEGACY_DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { migrateNamesWallToV5 } from "../../frontend/src/shared/nli-name-wall-config.js";
import { projectionPlacementInputIdentity } from "../../frontend/src/projection/projection-names-run.js";
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
    classList: { toggle() {} },
  };
}

function documentStub({ coarse = false, noHover = false } = {}) {
  return {
    activeElement: null,
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
    load: vi.fn(async (id) => { state = { ...state, snapshot: { ...state.snapshot, selectedPresetId: id }, draft: clone(state.snapshot.presets.find((preset) => preset.id === id).config), hasLocalDraft: false }; notify(); return state; }),
    revert: vi.fn(async () => { state = { ...state, draft: clone(state.snapshot.config), hasLocalDraft: false }; notify(); return state; }),
    getState: () => state,
  };
}

describe("projection config controller", () => {
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
    expect(find(root, (node) => node.className === 'applied-summary').textContent).toBe('Applied');
    ack('left', 'left-b', { ...wall, digest: 'b'.repeat(64) });
    expect(api.getStatusRows()).toHaveLength(2);
    expect(find(root, (node) => node.className === 'applied-summary').textContent).toBe('Applied');
    listeners.get('disconnect')();
    expect(find(root, (node) => node.className === 'applied-summary').textContent).toBe('Pending');
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
    expect(find(root, (node) => node.className === 'applied-summary').textContent).toBe('Applied');
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
    await vi.waitFor(() => expect(find(root, (node) => node.className === "action-error").textContent).toBe("projection config operation superseded"));
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

  test("preserves an imported preset name entered before first hydration", async () => {
    const previousDocument = globalThis.document; globalThis.document = documentStub();
    const client = fakeClient(null); const root = element("main");
    const api = mountProjectionConfig(root, { client, onImport: async () => ({ name: "Imported fieldwork", config: clone(DEFAULTS) }) });
    const fileInput = find(root, (node) => node.attributes?.["aria-label"] === "Import calibration");
    fileInput.files = [{}]; fileInput.dispatch("change");
    const name = find(root, (node) => node.attributes?.["aria-label"] === "Preset name");
    await vi.waitFor(() => expect(name.value).toBe("Imported fieldwork"));
    client.hydrate({ revision: 3, config: clone(DEFAULTS), presets: [{ id: "original", name: "Original calibration", config: clone(DEFAULTS), readOnly: true }], selectedPresetId: "original" });
    expect(name.value).toBe("Imported fieldwork");
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

  test("selecting a warp stage synchronizes the editor mode and opens its inspector", () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main");
    const api = mountProjectionConfig(root, { client: fakeClient() });
    const grid = find(root, (node) => node.dataset?.node === "right-grid");
    grid.dispatch("click");
    const mode = find(root, (node) => node.attributes?.["aria-label"] === "Warp stage");
    const inspector = find(root, (node) => node.className === "inspector");
    expect(mode.value).toBe("grid");
    expect(inspector.open).toBe(true);
    const keystone = find(root, (node) => node.dataset?.node === "left-keystone");
    keystone.dispatch("click");
    expect(mode.value).toBe("keystone");
    api.dispose();
    globalThis.document = previousDocument;
  });

  test("warp stage picker navigates the matching calibration node", () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main");
    const api = mountProjectionConfig(root, { client: fakeClient() });
    find(root, (node) => node.dataset?.node === "right-grid").dispatch("click");
    const mode = find(root, (node) => node.attributes?.["aria-label"] === "Warp stage");
    mode.value = "keystone"; mode.dispatch("change");
    expect(mode.value).toBe("keystone");
    expect(find(root, (node) => node.className === "warp-selection-status").textContent).toContain("Right · Keystone");
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
    const pattern = find(root, (node) => node.attributes?.["aria-label"] === "Pattern");
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

  test("Live off stages edits and import; Save, Load, and Apply work without preview frames", async () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main");
    const client = fakeClient();
    const imported = clone(DEFAULTS);
    imported.pre.tx = 0.025;
    const api = mountProjectionConfig(root, { client, onImport: async () => ({ name: "Imported", config: imported }) });
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
    const importedInput = find(root, (node) => node.attributes?.["aria-label"] === "Import calibration");
    importedInput.files = [{}]; importedInput.dispatch("change");
    await vi.waitFor(() => expect(client.getState().draft.pre.tx).toBe(0.025));
    expect(client.getState().live).toBe(false);
    const name = find(root, (node) => node.attributes?.["aria-label"] === "Preset name");
    name.value = "Imported";
    action("save-new").dispatch("click");
    await vi.waitFor(() => expect(client.save).toHaveBeenCalledWith({ presetId: null, name: "Imported" }));
    expect(client.savedDrafts.at(-1).pre.tx).toBe(0.025);
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

  test("v1 imports are migrated before entering the v2 warp editor", async () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const legacy = clone(DEFAULTS);
    legacy.schemaVersion = 1;
    legacy.pre.tx = 0.044;
    for (const output of ["left", "right"]) {
      delete legacy.outputs[output].presentationEffect;
      delete legacy.outputs[output].warp;
    }
    const root = element("main");
    const client = fakeClient();
    const api = mountProjectionConfig(root, { client, onImport: async () => ({ name: "Legacy checkpoint", config: legacy }) });
    const importedInput = find(root, (node) => node.attributes?.["aria-label"] === "Import calibration");
    importedInput.files = [{}]; importedInput.dispatch("change");
    await vi.waitFor(() => expect(client.getState().draft.pre.tx).toBe(0.044));
    expect(client.getState().draft.schemaVersion).toBe(6);
    expect(client.getState().draft.namesWall.rotateDeg).toBe(DEFAULTS.namesWall.rotateDeg);
    expect(client.getState().draft.pre).toEqual(legacy.pre);
    expect(client.getState().draft.outputs.left.warp.baseline.type).toBe("identity");
    expect(client.getState().draft.outputs.right.warp.grid.offsets).toHaveLength(56);
    api.dispose(); globalThis.document = previousDocument;
  });
  test("v1 accepted snapshots are migrated before editor hydration", () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const legacy = clone(DEFAULTS);
    legacy.schemaVersion = 1;
    for (const output of ["left", "right"]) {
      delete legacy.outputs[output].presentationEffect;
      delete legacy.outputs[output].warp;
    }
    const client = fakeClient(null);
    const root = element("main");
    const api = mountProjectionConfig(root, { client });
    client.hydrate({ revision: 5, config: legacy, presets: [{ id: "legacy", name: "Legacy", config: legacy }], selectedPresetId: "legacy" });
    find(root, (node) => node.dataset?.node === "right-grid").dispatch("click");
    expect(find(root, (node) => node.className === "warp-selection-status").textContent).toContain("Right · Grid Warp");
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
    expect(statusText({ ...state, snapshot: { ...state.snapshot, config: changed }, draft: changed }, "desk")).toBe("Live changes");
    expect(statusText({ ...state, hydrating: true }, "desk")).toBe("Checking settings");
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
    expect(left.children.map((option) => option.textContent)).toEqual(["Display 1", "Display 2"]);
    expect(right.children.map((option) => option.textContent)).toEqual(["Display 1", "Display 2"]);
    left.value = "left-screen"; right.value = "right-screen"; left.dispatch("change"); right.dispatch("change");
    action("output-identify").dispatch("click");
    client.report({ previewError: "unrelated preview refresh" });
    expect(left.value).toBe("left-screen");
    expect(right.value).toBe("right-screen");
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

  test('import reports a nonzero historical seam gap conversion notice', async () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element('main'); const client = fakeClient();
    const api = mountProjectionConfig(root, { client, onImport: async () => ({
      name: 'Old wall', config: clone(DEFAULTS), warnings: ['The wall seam gap needs readjustment in final-output pixels.'],
    }) });
    const importedInput = find(root, (node) => node.attributes?.['aria-label'] === 'Import calibration');
    importedInput.files = [{}]; importedInput.dispatch('change');
    const notice = find(root, (node) => node.className === 'conflict-banner');
    await vi.waitFor(() => expect(notice.textContent).toContain('seam gap needs readjustment'));
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
      input.value = '70'; input.dispatch('blur');
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
      input.value = ''; input.dispatch('blur');
      expect(client.getState().draft.namesWall.rotateDeg).toBe(35);
      expect(error.textContent).toMatch(/finite number/i);
      input.value = '181'; input.dispatch('blur');
      expect(client.getState().draft.namesWall.rotateDeg).toBe(35);
      expect(error.textContent).toMatch(/between -180 and 180/);
      expect(client.getState().snapshot.config.namesWall.rotateDeg).toBe(35);
    } finally {
      api.dispose(); globalThis.document = previousDocument;
    }
  });

  test('preset load and a V6 import use the saved wall rotation', async () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element('main');
    const client = fakeClient();
    const turned = clone(DEFAULTS);
    turned.namesWall.rotateDeg = 12;
    const snapshot = clone(client.getState().snapshot);
    snapshot.presets.push({ id: 'turned', name: 'Turned', config: turned, readOnly: false });
    client.hydrate(snapshot);
    const imported = clone(DEFAULTS);
    imported.namesWall.rotateDeg = 80;
    const api = mountProjectionConfig(root, { client, onImport: async () => JSON.stringify({
      schemaVersion: 6, name: 'Turned file', config: imported,
    }) });
    try {
      const presets = find(root, (item) => item.attributes?.['aria-label'] === 'Preset');
      presets.value = 'turned';
      presets.dispatch('change');
      find(root, (item) => item.dataset?.action === 'load').dispatch('click');
      await vi.waitFor(() => expect(client.getState().draft.namesWall.rotateDeg).toBe(12));
      const input = find(root, (item) => item.dataset?.field === 'namesWall.rotateDeg' && item.dataset.input === 'number');
      expect(input.value).toBe('12');
      expect(client.getState().draft.pre.rotateDeg).toBe(DEFAULTS.pre.rotateDeg);
      const importedInput = find(root, (item) => item.attributes?.['aria-label'] === 'Import calibration');
      importedInput.files = [{}];
      importedInput.dispatch('change');
      await vi.waitFor(() => expect(client.getState().draft.namesWall.rotateDeg).toBe(80));
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
    inset.dispatch("blur");
    const font = find(node, (item) => item.dataset?.field === "namesWall.requestedFontPx" && item.dataset.input === "number");
    font.value = "6";
    font.dispatch("blur");
    expect(client.getState().draft.namesWall.profiles.model.requestedFontPx).toBe(6);
    expect(client.getState().draft.namesWall.profiles.wall.requestedFontPx).toBe(12);
    expect(client.getState().draft.namesWall.innerEdgeInsetPx.left).toBe(60);
    const spacing = find(node, (item) => item.dataset?.field === "namesWall.spacingPx" && item.dataset.input === "number");
    spacing.value = "1";
    spacing.dispatch("blur");
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

  test("Names wall settings survive Live, preset, import, export, conflict, and Revert paths", async () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main"); const client = fakeClient(); const exported = vi.fn();
    const api = mountProjectionConfig(root, { client, onExport: exported, onImport: async () => ({ name: "Wall profile", config: {
      ...clone(DEFAULTS), namesWall: { ...clone(DEFAULTS.namesWall), activeMode: "model", profiles: {
        wall: { ...clone(DEFAULTS.namesWall.profiles.wall) }, model: { ...clone(DEFAULTS.namesWall.profiles.model), requestedFontPx: 7, spacingPx: 1, edgeInsetPx: 12 },
      } },
    } }) });
    const action = (name) => find(root, (item) => item.dataset?.action === name);
    const node = find(root, (item) => item.dataset?.node === "names-wall");
    const live = action("live"); live.checked = false; live.dispatch("change");
    const setField = (path, value) => { const input = find(node, (item) => item.dataset?.field === path && item.dataset.input === "number"); input.value = String(value); input.dispatch("blur"); };
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
    action("export").dispatch("click");
    const exportValue = JSON.parse(exported.mock.calls.at(-1)[0]);
    expect(exportValue.config.namesWall.profiles.model).toMatchObject({ requestedFontPx: 6, spacingPx: 1 });
    expect(exportValue.config.namesWall.profiles.wall.inwardShiftPercent).toBe(50);
    expect(exportValue.config.namesWall.innerEdgeInsetPx.left).toBe(60);
    const name = find(root, (item) => item.attributes?.["aria-label"] === "Preset name"); name.value = "Wall profile";
    action("save-new").dispatch("click");
    await vi.waitFor(() => expect(client.savedDrafts.at(-1).namesWall.profiles.model.requestedFontPx).toBe(6));
    expect(client.savedDrafts.at(-1).namesWall.profiles.wall.inwardShiftPercent).toBe(50);
    const importInput = find(root, (item) => item.attributes?.["aria-label"] === "Import calibration"); importInput.files = [{}]; importInput.dispatch("change");
    await vi.waitFor(() => expect(client.getState().draft.namesWall.profiles.model.requestedFontPx).toBe(7));
    expect(client.getState().draft.namesWall.profiles.model).toMatchObject({ spacingPx: 1, edgeInsetPx: 12 });
    api.setConflict("Remote update");
    expect(client.getState().draft.namesWall.profiles.model.requestedFontPx).toBe(7);
    action("revert").dispatch("click");
    await vi.waitFor(() => expect(client.revert).toHaveBeenCalledTimes(1));
    expect(client.getState().draft.namesWall).toEqual(client.getState().snapshot.config.namesWall);
    expect(client.getState().draft.namesWall.profiles.wall.inwardShiftPercent).toBe(50);
    api.dispose(); globalThis.document = previousDocument;
  });

  test("blocks local output actions on coarse or no-hover surfaces and shows workstation instructions", () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub({ coarse: true });
    const root = element("main");
    const outputController = {
      identifyDisplays: vi.fn(), assignDisplays: vi.fn(), openBoth: vi.fn(), closeBoth: vi.fn(),
      getState: () => ({ screens: [], assignments: { left: null, right: null }, message: "Identify displays", error: "", ownedSpans: [] }),
      subscribe(listener) { listener(this.getState()); return () => {}; },
    };
    const api = mountProjectionConfig(root, { client: fakeClient(), outputController });
    const identify = find(root, (node) => node.dataset?.action === "output-identify");
    const status = find(root, (node) => node.className === "output-launch-status");
    identify.dispatch("click");
    expect(identify.disabled).toBe(true);
    expect(outputController.identifyDisplays).not.toHaveBeenCalled();
    expect(status.textContent).toMatch(/workstation-only/i);
    api.dispose(); globalThis.document = previousDocument;
  });

  test("initialized import converts a V5 checkpoint with the acknowledged wall angle", async () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main");
    const client = fakeClient();
    const snapshot = clone(client.getState().snapshot);
    snapshot.config.namesWall.rotateDeg = 70;
    snapshot.presets[0].config.namesWall.rotateDeg = 70;
    client.hydrate(snapshot);
    const v5 = migrateNamesWallToV5(clone(LEGACY_DEFAULT_PROJECTION_CONFIG));
    v5.pre.tx = 0.21;
    v5.namesWall.profiles.wall.inwardShiftPercent = 40;
    const api = mountProjectionConfig(root, { client, onImport: async () => ({ name: "Old desk", config: v5 }) });
    const importedInput = find(root, (node) => node.attributes?.["aria-label"] === "Import calibration");
    importedInput.files = [{}];
    importedInput.dispatch("change");
    await vi.waitFor(() => expect(client.getState().draft.pre.tx).toBe(0.21));
    expect(client.getState().draft.schemaVersion).toBe(6);
    expect(client.getState().draft.namesWall.rotateDeg).toBe(70);
    expect(client.getState().draft.namesWall.profiles.wall.inwardShiftPercent).toBe(40);
    api.dispose();
    globalThis.document = previousDocument;
  });

  test("initialized file import converts a V1 document with the acknowledged wall angle", async () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main");
    const client = fakeClient();
    const snapshot = clone(client.getState().snapshot);
    snapshot.config.namesWall.rotateDeg = 70;
    snapshot.presets[0].config.namesWall.rotateDeg = 70;
    client.hydrate(snapshot);
    const legacy = clone(LEGACY_DEFAULT_PROJECTION_CONFIG);
    legacy.pre.tx = 0.033;
    const api = mountProjectionConfig(root, { client });
    const importedInput = find(root, (node) => node.attributes?.["aria-label"] === "Import calibration");
    importedInput.files = [{ text: async () => JSON.stringify({ schemaVersion: 1, name: "Legacy file", config: legacy }) }];
    importedInput.dispatch("change");
    await vi.waitFor(() => expect(client.getState().draft.pre.tx).toBe(0.033));
    expect(client.getState().draft.schemaVersion).toBe(6);
    expect(client.getState().draft.namesWall.rotateDeg).toBe(70);
    api.dispose();
    globalThis.document = previousDocument;
  });
});
