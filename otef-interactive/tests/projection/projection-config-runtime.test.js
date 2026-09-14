import { describe, expect, test, vi } from "vitest";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { createProjectionConfigRuntime } from "../../frontend/src/projection/projection-config-runtime.js";
import { applyProjectionSpanView } from "../../frontend/src/projection/projection-span-view.js";
import { createNliNameFieldController } from "../../frontend/src/shared/nli-name-field-controller.js";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";

function makeHarness(spanId = "left", instanceId = "11111111-1111-4111-8111-111111111111", options = {}) {
  let listener;
  const queued = [];
  const sent = [];
  const renderListeners = new Set();
  const errorListeners = new Set();
  const socketListeners = new Map();
  const applied = [];
  const client = {
    subscribe(fn) { listener = fn; fn({ snapshot: null }); return () => { listener = null; }; },
    start: vi.fn(() => Promise.resolve()),
    getState: () => ({ snapshot: null }),
  };
  const socket = {
    on: (name, fn) => { socketListeners.set(name, fn); },
    off: (name) => { socketListeners.delete(name); },
    send: (message) => { sent.push(message); return true; },
  };
  const map = {
    on: (name, fn) => { if (name === "render") renderListeners.add(fn); if (name === "error") errorListeners.add(fn); },
    off: (name, fn) => { if (name === "render") renderListeners.delete(fn); if (name === "error") errorListeners.delete(fn); },
    triggerRepaint: vi.fn(),
    getEffectiveProjectionConfig: () => options.initialConfig || DEFAULT_PROJECTION_CONFIG,
  };
  const runtime = createProjectionConfigRuntime({
    map, spanId, client, socket, instanceId,
    requestFrame: (fn) => { queued.push(fn); return queued.length; },
    cancelFrame: vi.fn(),
    applyConfig: (config, revision) => { applied.push({ config, revision }); options.applyConfig?.(config, revision, { render: () => [...renderListeners].forEach((fn) => fn()) }); },
  });
  return {
    runtime,
    state(revision, config = DEFAULT_PROJECTION_CONFIG) { listener?.({ snapshot: { revision, config } }); },
    frame() { queued.shift()?.(); },
    render(event = {}) { [...renderListeners].forEach((fn) => fn(event)); },
    error(event = {}) { [...errorListeners].forEach((fn) => fn(event)); },
    sent: () => sent,
    applied,
    socketListeners,
    map,
    renderListeners,
    errorListeners,
  };
}

function spanNode(id) {
  return {
    id, style: {}, dataset: {}, clientWidth: 1600, clientHeight: 900, children: [], parentElement: null,
    appendChild(child) { child.parentElement = this; this.children.push(child); return child; },
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentElement = null; return child; },
    querySelector(selector) { return this.id === selector.slice(1) ? this : this.children.map((child) => child.querySelector(selector)).find(Boolean) || null; },
  };
}

function realSpanAndNames() {
  const display = spanNode("displayContainer");
  const image = spanNode("displayedImage");
  const container = spanNode("projectionMap");
  display.appendChild(image); display.appendChild(container);
  globalThis.document = { createElement: () => spanNode("") };
  const map = createFakeMapLibreMap();
  let camera = { center: { lng: 34.5, lat: 31.5 }, zoom: 10, bearing: 7, pitch: 0, padding: 0 };
  map.getContainer = () => container;
  map.getCanvas = () => ({ style: {} });
  map.getCenter = () => camera.center;
  map.getZoom = () => camera.zoom;
  map.getBearing = () => camera.bearing;
  map.getPitch = () => camera.pitch;
  map.getPadding = () => camera.padding;
  map.unproject = ([x, y]) => ({ lng: camera.center.lng + (x - 800) / 1000, lat: camera.center.lat + (y - 450) / 1000 });
  map.jumpTo = (next) => { camera = { ...camera, ...next }; };
  const controller = createNliNameFieldController({ map, context: { subscribe: () => () => {} }, projectionSpan: "left" });
  let effective = DEFAULT_PROJECTION_CONFIG;
  map.getEffectiveProjectionConfig = () => effective;
  map.setEffectiveProjectionConfig = (config, revision) => {
    if (Number.isFinite(map._otefProjectionSpanRevision) && revision < map._otefProjectionSpanRevision) return false;
    effective = config;
    return applyProjectionSpanView({ map, imageEl: image, containerEl: display, spanId: "left", config, revision });
  };
  return { map, controller, getEffective: () => effective };
}

describe("projection config runtime", () => {
  test("coalesces revisions before a frame and acknowledges only after render", async () => {
    const h = makeHarness();
    await h.runtime.start();
    h.state(2);
    h.state(3);
    h.frame();
    expect(h.applied.map((item) => item.revision)).toEqual([3]);
    expect(h.sent().filter((message) => message.type === "otef_projection_applied")).toEqual([]);
    h.render();
    expect(h.sent()).toContainEqual(expect.objectContaining({
      type: "otef_projection_applied", revision: 3, success: true, output: "left",
    }));
  });

  test("metadata updates with the same snapshot keep the pending render waiter", async () => {
    const h = makeHarness();
    await h.runtime.start();
    h.state(1); h.frame();
    const waiter = [...h.renderListeners][0];
    h.state(1, structuredClone(DEFAULT_PROJECTION_CONFIG));
    h.frame();
    expect(h.applied).toHaveLength(1);
    expect([...h.renderListeners][0]).toBe(waiter);
    h.render();
    expect(h.sent().filter((message) => message.type === "otef_projection_applied" && message.success)).toHaveLength(1);
  });

  test("does not acknowledge a stale render callback", async () => {
    const h = makeHarness();
    await h.runtime.start();
    h.state(2); h.frame();
    const stale = [...h.renderListeners][0];
    h.state(3); h.frame();
    stale?.();
    h.render();
    expect(h.sent()).toContainEqual(expect.objectContaining({ revision: 3, success: true }));
    expect(h.sent()).not.toContainEqual(expect.objectContaining({ revision: 2, success: true }));
  });

  test("removes scoped error listener on success, invalidation, failure, and stop", async () => {
    const h = makeHarness();
    await h.runtime.start();
    h.state(1); h.frame();
    expect(h.errorListeners.size).toBe(1);
    h.render();
    expect(h.errorListeners.size).toBe(0);
    h.state(2); h.frame(); h.runtime.invalidate();
    expect(h.errorListeners.size).toBe(0);
    h.runtime.resume(); h.frame(); h.error({ error: new Error("render failed") });
    expect(h.errorListeners.size).toBe(0);
    h.state(3); h.frame(); h.runtime.stop();
    expect(h.errorListeners.size).toBe(0);
  });

  test("requires a render after apply returns even if apply emitted a render", async () => {
    const h = makeHarness("left", "11111111-1111-4111-8111-111111111111", { applyConfig: (_config, _revision, { render }) => render() });
    await h.runtime.start();
    h.state(1); h.frame();
    expect(h.sent().filter((message) => message.type === "otef_projection_applied")).toEqual([]);
    h.render();
    expect(h.sent()).toContainEqual(expect.objectContaining({ revision: 1, success: true }));
  });

  test("a superseded render error cannot fail the old or new revision", async () => {
    const h = makeHarness();
    await h.runtime.start();
    h.state(1); h.frame();
    const oldError = [...h.errorListeners][0];
    h.state(2);
    oldError({ error: new Error("old render failed") });
    h.frame();
    oldError({ error: new Error("old render failed") });
    h.render();
    expect(h.sent()).not.toContainEqual(expect.objectContaining({ revision: 1, success: false }));
    expect(h.sent()).not.toContainEqual(expect.objectContaining({ revision: 2, success: false }));
    expect(h.sent()).toContainEqual(expect.objectContaining({ revision: 2, success: true }));
  });

  test("initial partial apply failure restores the default presentation without confirming it", async () => {
    const initial = { ...DEFAULT_PROJECTION_CONFIG, pre: { ...DEFAULT_PROJECTION_CONFIG.pre, tx: 0.05 } };
    let current = initial;
    let calls = 0;
    const h = makeHarness("left", "11111111-1111-4111-8111-111111111111", { applyConfig: (config) => {
      current = config;
      if (++calls === 1) throw new Error("partial first apply");
    }, initialConfig: initial });
    await h.runtime.start();
    h.state(1, DEFAULT_PROJECTION_CONFIG); h.frame();
    expect(current).toEqual(initial);
    expect(h.sent()).toContainEqual(expect.objectContaining({ revision: 1, success: false }));
    expect(h.sent()).not.toContainEqual(expect.objectContaining({ revision: 1, success: true }));
    h.sent().length = 0;
    h.socketListeners.get("otef_projection_status_request")?.({ table: "otef" });
    expect(h.sent()).toContainEqual(expect.objectContaining({ revision: 1, success: false }));
  });

  test("restores real span and name-controller guards after partial bridge mutation", async () => {
    const { map, controller, getEffective } = realSpanAndNames();
    let listener;
    const queued = [];
    const sent = [];
    const client = { subscribe(fn) { listener = fn; fn({ snapshot: null }); return () => {}; }, start: () => Promise.resolve() };
    const socket = { on() {}, off() {}, send: (message) => sent.push(message) };
    let failOnce = true;
    const applyConfig = (config, revision) => {
      if (map.setEffectiveProjectionConfig(config, revision) === false) throw new Error("camera rejected");
      if (revision === 2 && failOnce) { failOnce = false; throw new Error("after camera"); }
      if (!controller.setProjectionConfig(config, revision)) throw new Error("names rejected");
    };
    const runtime = createProjectionConfigRuntime({ map, spanId: "left", client, socket, applyConfig, instanceId: "11111111-1111-4111-8111-111111111111", requestFrame: (fn) => queued.push(fn), cancelFrame() {} });
    await runtime.start();
    listener({ snapshot: { revision: 1, config: DEFAULT_PROJECTION_CONFIG } }); queued.shift()(); map.emit("render");
    const changed = { ...DEFAULT_PROJECTION_CONFIG, pre: { ...DEFAULT_PROJECTION_CONFIG.pre, tx: 0.2 } };
    listener({ snapshot: { revision: 2, config: changed } }); queued.shift()();
    expect(getEffective()).toEqual(DEFAULT_PROJECTION_CONFIG);
    expect(map._otefProjectionSpanEffectiveConfig).toEqual(DEFAULT_PROJECTION_CONFIG);
    expect(map._otefProjectionSpanRevision).toBe(2);
    expect(controller.getProjectionNameDiagnostics().revision).toBe(2);
    expect(sent).toContainEqual(expect.objectContaining({ revision: 2, success: false, error: "after camera" }));
    controller.dispose(); runtime.stop();
  });

  test("holds status requests and new snapshots during resize until reapplication", async () => {
    const h = makeHarness();
    await h.runtime.start();
    h.state(1); h.frame(); h.render();
    h.sent().length = 0;
    h.runtime.invalidate();
    h.runtime.requestStatus();
    h.state(2); h.frame(); h.render();
    expect(h.sent().filter((message) => message.type === "otef_projection_applied")).toEqual([]);
    h.runtime.resume(); h.frame(); h.render();
    expect(h.sent()).toContainEqual(expect.objectContaining({ revision: 2, success: true }));
  });

  test("restores the last valid config and reports an apply error", async () => {
    let listener;
    const queued = [];
    const sent = [];
    const renderListeners = new Set();
    const client = { subscribe: (fn) => { listener = fn; fn({ snapshot: null }); return () => {}; }, start: () => Promise.resolve() };
    const socket = { on() {}, off() {}, send: (message) => { sent.push(message); return true; } };
    const map = { on: (name, fn) => { if (name === "render") renderListeners.add(fn); }, off: (name, fn) => { if (name === "render") renderListeners.delete(fn); }, triggerRepaint() {} };
    let calls = 0;
    let bridgeRevision = -1;
    let controllerRevision = -1;
    const configs = [];
    const runtime = createProjectionConfigRuntime({
      map, spanId: "left", client, socket, instanceId: "11111111-1111-4111-8111-111111111111",
      requestFrame: (fn) => { queued.push(fn); }, cancelFrame() {},
      applyConfig: (config, revision) => { calls += 1; if (revision < bridgeRevision || revision < controllerRevision) throw new Error("stale revision"); bridgeRevision = revision; controllerRevision = revision; configs.push({ config, revision }); if (revision === 2 && calls === 2) throw new Error("camera failed"); },
    });
    await runtime.start();
    listener({ snapshot: { revision: 1, config: DEFAULT_PROJECTION_CONFIG } }); queued.shift()();
    [...renderListeners].forEach((fn) => fn());
    listener({ snapshot: { revision: 2, config: DEFAULT_PROJECTION_CONFIG } }); queued.shift()();
    expect(calls).toBe(3);
    expect(configs.map((item) => item.revision)).toEqual([1, 2, 2]);
    expect(sent).toContainEqual(expect.objectContaining({ revision: 2, success: false, error: "camera failed" }));
  });

  test("does not acknowledge synchronously rendered apply that later throws", async () => {
    const h = makeHarness();
    h.runtime.stop();
    let listener;
    const queued = [];
    const socket = { on() {}, off() {}, send: (message) => h.sent().push(message) };
    const client = { subscribe: (fn) => { listener = fn; fn({ snapshot: null }); return () => {}; }, start: () => Promise.resolve() };
    const map = { on: (name, fn) => { if (name === "render") h.renderListeners.add(fn); }, off: (name, fn) => { if (name === "render") h.renderListeners.delete(fn); }, triggerRepaint() {} };
    const runtime = createProjectionConfigRuntime({ map, spanId: "left", client, socket, instanceId: "11111111-1111-4111-8111-111111111111", requestFrame: (fn) => { queued.push(fn); }, cancelFrame() {}, applyConfig: () => { h.render(); throw new Error("late apply failure"); } });
    await runtime.start();
    listener({ snapshot: { revision: 4, config: DEFAULT_PROJECTION_CONFIG } });
    queued.shift()();
    expect(h.sent().filter((message) => message.type === "otef_projection_applied").map((message) => message.success)).toEqual([false]);
  });

  test("rolls back an asynchronous render error to the last completed config", async () => {
    const h = makeHarness();
    await h.runtime.start();
    h.state(1); h.frame(); h.render();
    const next = { ...DEFAULT_PROJECTION_CONFIG, pre: { ...DEFAULT_PROJECTION_CONFIG.pre, tx: 0.2 } };
    h.state(2, next); h.frame(); h.error({ error: new Error("render failed") });
    expect(h.applied.at(-1).revision).toBe(2);
    expect(h.sent()).toContainEqual(expect.objectContaining({ revision: 2, success: false, error: "render failed" }));
  });

  test("full reference ignores calibration and patterns", async () => {
    const h = makeHarness(null);
    await h.runtime.start();
    h.state(4); h.frame(); h.render();
    expect(h.applied).toEqual([]);
    h.socketListeners.get("otef_projection_pattern")?.({ type: "otef_projection_pattern", output: "left", pattern: "grid", table: "otef" });
    expect(h.sent()).toEqual([]);
  });

  test("status request asks for a completed-render response", async () => {
    const h = makeHarness();
    await h.runtime.start();
    h.state(1); h.frame(); h.render();
    h.sent().length = 0;
    h.runtime.requestStatus();
    expect(h.sent()).toContainEqual(expect.objectContaining({ type: "otef_projection_status_request", sourceId: expect.any(String) }));
    expect(h.sent().filter((message) => message.type === "otef_projection_applied")).toEqual([]);
    h.render();
    expect(h.sent()).toContainEqual(expect.objectContaining({ type: "otef_projection_applied", revision: 1, success: true }));
  });

  test("same-span instances retain distinct status identities", async () => {
    const a = makeHarness("left", "11111111-1111-4111-8111-111111111111");
    const b = makeHarness("left", "22222222-2222-4222-8222-222222222222");
    await a.runtime.start(); await b.runtime.start();
    a.runtime.requestStatus(); b.runtime.requestStatus();
    a.state(1); b.state(1); a.frame(); b.frame(); a.render(); b.render();
    const aApplied = a.sent().find((message) => message.type === "otef_projection_applied");
    const bApplied = b.sent().find((message) => message.type === "otef_projection_applied");
    expect(aApplied.instanceId).not.toBe(bApplied.instanceId);
  });

  test("resize invalidation rejects an interim render callback", async () => {
    const h = makeHarness();
    await h.runtime.start();
    h.state(1); h.frame();
    const oldRender = [...h.renderListeners][0];
    h.runtime.invalidate();
    oldRender();
    expect(h.sent().filter((message) => message.type === "otef_projection_applied")).toEqual([]);
  });

  test("bounded render timeout reports failure when no frame completes", async () => {
    const h = makeHarness();
    const timers = [];
    const runtime = createProjectionConfigRuntime({
      map: h.map, spanId: "left", client: { subscribe: (fn) => { h.state = (revision) => fn({ snapshot: { revision, config: DEFAULT_PROJECTION_CONFIG } }); fn({ snapshot: null }); return () => {}; }, start: () => Promise.resolve() },
      socket: { on() {}, off() {}, send: (message) => h.sent().push(message) }, instanceId: "11111111-1111-4111-8111-111111111111",
      requestFrame: (fn) => { h._frame = fn; }, cancelFrame() {}, clock: { setTimeout: (fn) => { timers.push(fn); return fn; }, clearTimeout() {} }, renderTimeoutMs: 25,
      applyConfig() {},
    });
    await runtime.start();
    h.state(5); h._frame();
    timers.at(-1)();
    expect(h.sent()).toContainEqual(expect.objectContaining({ revision: 5, success: false, error: "render completion timeout" }));
  });

  test("hidden output defers render timeout until it can render", async () => {
    const h = makeHarness();
    const timers = [];
    let visible = false;
    let state;
    let frame;
    const runtime = createProjectionConfigRuntime({
      map: h.map, spanId: "left", client: { subscribe: (fn) => { state = fn; fn({ snapshot: null }); return () => {}; }, start: () => Promise.resolve() },
      socket: { on() {}, off() {}, send: (message) => h.sent().push(message) }, instanceId: "11111111-1111-4111-8111-111111111111",
      requestFrame: (fn) => { frame = fn; }, cancelFrame() {}, clock: { setTimeout: (fn) => { timers.push(fn); return fn; }, clearTimeout() {} }, renderTimeoutMs: 25,
      isDocumentVisible: () => visible, applyConfig() {},
    });
    await runtime.start();
    state({ snapshot: { revision: 5, config: DEFAULT_PROJECTION_CONFIG } }); frame();
    timers.shift()();
    expect(h.sent().filter((message) => message.type === "otef_projection_applied")).toEqual([]);
    visible = true;
    h.render();
    expect(h.sent()).toContainEqual(expect.objectContaining({ revision: 5, success: true }));
    runtime.stop();
  });
});
