import { describe, expect, test, vi } from "vitest";
import { DEFAULT_PROJECTION_CONFIG as DEFAULTS } from "../../frontend/src/shared/projection-config-schema.js";
import {
  FIELD_DESCRIPTORS,
  fieldValueFromInput,
  fineStepFor,
  mountProjectionConfig,
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
  return {
    state,
    savedDrafts,
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
  test("empty numeric entry never applies a zero draft", () => {
    const descriptor = FIELD_DESCRIPTORS.find((item) => item.path === "pre.tx");
    expect(Number.isNaN(fieldValueFromInput(descriptor, ""))).toBe(true);
    expect(Number.isNaN(fieldValueFromInput(descriptor, "   "))).toBe(true);
  });

  test("first hydration re-requests status and reconnect renews the selected pattern", () => {
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
    const api = mountProjectionConfig(root, { client, socket });
    const snapshot = { revision: 4, config: clone(DEFAULTS), presets: [{ id: "original", name: "Original calibration", config: clone(DEFAULTS), readOnly: true }], selectedPresetId: "original" };
    listeners.get("otef_projection_applied")({ table: "otef", output: "left", instanceId: "first", revision: 4, success: true, route: "browser", baseline: { type: "identity" } });
    expect(api.getStatusRows()).toHaveLength(0);
    const beforeHydration = socket.send.mock.calls.length;
    client.hydrate(snapshot);
    expect(socket.send.mock.calls.slice(beforeHydration).some(([message]) => message.type === "otef_projection_status_request")).toBe(true);
    listeners.get("otef_projection_applied")({ table: "otef", output: "left", instanceId: "first", revision: 4, success: true, route: "browser", baseline: { type: "identity" } });
    listeners.get("otef_projection_applied")({ table: "otef", output: "left", instanceId: "second", revision: 4, success: true, route: "browser", baseline: { type: "identity" } });
    expect(api.getStatusRows()).toHaveLength(2);
    listeners.get("otef_projection_applied")({ table: "otef", output: "left", instanceId: "missing-route", revision: 4, success: true, baseline: { type: "identity" } });
    listeners.get("otef_projection_applied")({ table: "otef", output: "left", instanceId: "missing-baseline", revision: 4, success: true, route: "browser" });
    expect(api.getStatusRows()).toHaveLength(2);
    listeners.get("otef_projection_applied")({ table: "otef", output: "left", instanceId: "wrong-route", revision: 4, success: true, route: "td" });
    listeners.get("otef_projection_applied")({ table: "otef", output: "left", instanceId: "wrong-baseline", revision: 4, success: true, route: "browser", baseline: { type: "tdMesh", assetId: "other" } });
    expect(api.getStatusRows()).toHaveLength(2);
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
    expect(socket.send.mock.calls.slice(beforeRehydration).some(([message]) => message.type === "otef_projection_status_request")).toBe(true);
    vi.advanceTimersByTime(1100);
    expect(socket.send.mock.calls.slice(beforeReconnect).filter(([message]) => message.type === "otef_projection_pattern" && message.pattern === "grid").length).toBeGreaterThanOrEqual(2);
    vi.advanceTimersByTime(3900);
    expect(api.getStatusRows().map((row) => row.output).sort()).toEqual(["left", "right"]);
    api.dispose(); globalThis.document = previousDocument; vi.useRealTimers();
  });

  test("Live off stages edits and import; Save as new keeps its own ID for Load and Revert", async () => {
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
    action("revert").dispatch("click");
    await vi.waitFor(() => expect(client.revert).toHaveBeenCalledTimes(1));
    expect(client.getState().snapshot.presets.find((item) => item.id === "original").readOnly).toBe(true);
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

  test("wires workstation display assignment and browser output actions into the existing toolbar", async () => {
    const previousDocument = globalThis.document;
    globalThis.document = documentStub();
    const root = element("main");
    const screens = [
      { key: "left-screen", label: "Left screen", left: -100, top: 0, width: 1920, height: 1080 },
      { key: "right-screen", label: "Right screen", left: 1820, top: 0, width: 1920, height: 1080 },
    ];
    let outputState = { screens: [], assignments: { left: null, right: null }, message: "Identify displays", error: "", ownedSpans: [] };
    const outputListeners = new Set();
    const outputController = {
      identifyDisplays: vi.fn(async () => { outputState = { ...outputState, screens, message: "Displays identified" }; outputListeners.forEach((listener) => listener(outputState)); return screens; }),
      assignDisplays: vi.fn((selection) => { outputState = { ...outputState, assignments: selection, message: "Assignment saved" }; outputListeners.forEach((listener) => listener(outputState)); return outputState; }),
      openBoth: vi.fn(async () => { outputState = { ...outputState, ownedSpans: ["left", "right"], message: "Browser outputs opened" }; outputListeners.forEach((listener) => listener(outputState)); return outputState.ownedSpans; }),
      closeBoth: vi.fn(() => { outputState = { ...outputState, ownedSpans: [], message: "Browser outputs closed" }; outputListeners.forEach((listener) => listener(outputState)); return outputState; }),
      getState: () => outputState,
      subscribe(listener) { outputListeners.add(listener); listener(outputState); return () => outputListeners.delete(listener); },
    };
    const client = fakeClient();
    const api = mountProjectionConfig(root, { client, outputController });
    const action = (name) => find(root, (node) => node.dataset?.action === name);
    action("output-identify").dispatch("click");
    await vi.waitFor(() => expect(outputController.identifyDisplays).toHaveBeenCalledTimes(1));
    const left = find(root, (node) => node.dataset?.action === "output-left-display");
    const right = find(root, (node) => node.dataset?.action === "output-right-display");
    expect(left.children.map((option) => option.textContent).join(" ")).toContain("-100,0");
    expect(right.children.map((option) => option.textContent).join(" ")).toContain("1820,0");
    left.value = "left-screen"; right.value = "right-screen"; left.dispatch("change"); right.dispatch("change");
    client.report({ previewError: "unrelated preview refresh" });
    expect(left.value).toBe("left-screen");
    expect(right.value).toBe("right-screen");
    action("output-assign").dispatch("click");
    expect(outputController.assignDisplays).toHaveBeenCalledWith({ left: "left-screen", right: "right-screen" });
    action("output-open-both").dispatch("click");
    await vi.waitFor(() => expect(outputController.openBoth).toHaveBeenCalledTimes(1));
    action("output-close-both").dispatch("click");
    expect(outputController.closeBoth).toHaveBeenCalledTimes(1);
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
});
