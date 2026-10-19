import { afterEach, beforeEach, expect, test, vi } from "vitest";

let context, api;
const snapshot = (active = "regular", revision = 1) => ({
  experience_state: { active_experience: active, revision, pending_transition: null, last_transition: null, nli_bookmark: null },
  viewport: { bbox: [1, 2, 11, 12], zoom: 15 },
  layerGroups: [{ id: active, layers: [{ id: "a", enabled: true }] }],
  animations: {}, basemap: "osm", exhibit_mode: active === "nli",
  narrative_state: { id: null, revision },
  investigation_clock: { phase: "idle", revision }, person_selection: { revision },
});

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("window", { location: { protocol: "http:", host: "test" } });
  ({ default: context } = await import("../../frontend/src/shared/OTEFDataContext.js"));
  ({ OTEF_API: api } = await import("../../frontend/src/shared/api-client.js"));
  context._tableName = "otef";
});
afterEach(() => { context?._wsClient?.disconnect(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("experience snapshots are fully adopted before any subscriber sees the transition", () => {
  expect(typeof context.adoptAuthoritativeSnapshot).toBe("function");
  context.adoptAuthoritativeSnapshot(snapshot("nli", 1));
  const observations = [];
  context.subscribe("experienceState", () => observations.push([context.getExperienceState().active_experience, context.getLayerGroups()[0].id]));
  context.subscribe("layerGroups", () => observations.push([context.getExperienceState().active_experience, context.getLayerGroups()[0].id]));
  observations.length = 0;
  context.adoptAuthoritativeSnapshot(snapshot("regular", 2));
  expect(observations.length).toBeGreaterThan(0);
  expect(observations.every(([mode, group]) => mode === "regular" && group === "regular")).toBe(true);
  context.adoptAuthoritativeSnapshot(snapshot("nli", 1));
  expect(context.getExperienceState().active_experience).toBe("regular");
});

test("an inactive NLI document retains its command identity after regular mode activates", () => {
  expect(typeof context.configureCommandExperience).toBe("function");
  context.configureCommandExperience("nli");
  context.adoptAuthoritativeSnapshot(snapshot("nli", 1));
  const old = context.captureExperienceScope();
  context.adoptAuthoritativeSnapshot(snapshot("regular", 2));
  expect(context.isExperienceScopeCurrent(old)).toBe(false);
  expect(context.isExperienceActive()).toBe(false);
  expect(api.captureExperienceScope("otef")).toEqual({ experience: "nli", experience_revision: 2 });
});

test("regular slideshow drafts persist without replaying an older scene snapshot", async () => {
  context.configureCommandExperience("regular");
  context.adoptAuthoritativeSnapshot(snapshot("regular", 2));
  const response = snapshot("regular", 2);
  response.viewport.zoom = 3;
  response.experience_state.state_sequence = 1;
  response.experience_state.regular_slideshow_settings = { intervalMs: 9000 };
  const write = vi.spyOn(api, "updateState").mockResolvedValue(response);
  await context.saveRegularSlideshowSettings({ intervalMs: 9000 });
  expect(write).toHaveBeenCalledWith("otef", {
    regular_slideshow_settings: { intervalMs: 9000 }, experience: "regular", experience_revision: 2,
  });
  expect(context.getViewport().zoom).toBe(15);
  expect(context.getExperienceState().regular_slideshow_settings).toEqual({ intervalMs: 9000 });
});

test("a slideshow draft response cannot cross an activation boundary", async () => {
  context.configureCommandExperience("regular");
  context.adoptAuthoritativeSnapshot(snapshot("regular", 2));
  let release;
  vi.spyOn(api, "updateState").mockImplementation(() => new Promise(resolve => { release = resolve; }));
  const operation = context.saveRegularSlideshowSettings({ intervalMs: 1000 });
  await Promise.resolve();
  context.adoptAuthoritativeSnapshot(snapshot("regular", 4));
  release(snapshot("regular", 2));
  await expect(operation).rejects.toThrow("experience changed");
  expect(context.getExperienceState().revision).toBe(4);
});

test("a network failure cannot broadcast a slideshow across a confirmed activation boundary", async () => {
  expect(typeof context.adoptAuthoritativeSnapshot).toBe("function");
  context.configureCommandExperience("regular");
  context.adoptAuthoritativeSnapshot(snapshot("regular", 1));
  const post = vi.fn();
  vi.stubGlobal("BroadcastChannel", class { postMessage = post; close() {} });
  let reject;
  vi.spyOn(api, "updateState").mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  const operation = context.patchProjectionSlideshow({ type: "stop" });
  context.adoptAuthoritativeSnapshot(snapshot("nli", 2));
  reject(new Error("network failed"));
  await expect(operation).rejects.toThrow();
  expect(post).not.toHaveBeenCalled();
});

test("a clock queued before activation cannot write or restore its old state afterward", async () => {
  context.configureCommandExperience("nli");
  context.adoptAuthoritativeSnapshot(snapshot("nli", 1));
  let release;
  context._clockPatchQueue = new Promise(resolve => { release = resolve; });
  const write = vi.spyOn(api, "updateInvestigationClock");
  const operation = context.patchInvestigationClock({ phase: "idle" });
  context.adoptAuthoritativeSnapshot(snapshot("regular", 2));
  release();
  const result = await operation;
  expect(result.ok).toBe(false);
  expect(write).not.toHaveBeenCalled();
  expect(context.getExperienceState().active_experience).toBe("regular");
});

test("a queued layer flush cannot change the destination layer snapshot", async () => {
  context.configureCommandExperience("regular");
  context.adoptAuthoritativeSnapshot(snapshot("regular", 1));
  let release;
  context._layerPatchMutex = new Promise(resolve => { release = resolve; });
  const write = vi.spyOn(api, "setLayerToggles");
  const operation = context.setLayersEnabled(["regular.a"], false);
  context.adoptAuthoritativeSnapshot(snapshot("nli", 2));
  release();
  await operation;
  expect(write).not.toHaveBeenCalled();
  expect(context.getLayerGroups()[0].id).toBe("nli");
});

test("a late zoom response cannot replace the restored destination camera", async () => {
  context.configureCommandExperience("regular");
  context.adoptAuthoritativeSnapshot(snapshot("regular", 1));
  context._isConnected = true;
  let finish;
  vi.spyOn(api, "executeCommand").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const operation = context.zoom(16);
  const destination = snapshot("nli", 2);
  destination.viewport = { bbox: [20, 20, 30, 30], zoom: 14 };
  context.adoptAuthoritativeSnapshot(destination);
  finish({ viewport: { bbox: [1, 1, 5, 5], zoom: 16 } });
  await operation;
  expect(context.getViewport().bbox).toEqual([20, 20, 30, 30]);
});

test("queued archive work is checked again after activation, and stale layer events are ignored", () => {
  vi.stubGlobal("WebSocket", class {
    static CONNECTING = 0; static OPEN = 1;
    constructor() { this.readyState = 0; } close() { this.readyState = 3; }
  });
  context._setupWebSocket();
  context.adoptAuthoritativeSnapshot(snapshot("nli", 1));
  const archive = vi.fn();context.subscribe("archiveWindow", archive);
  const deliver = (type, data) => context._wsClient.listeners.get(type)[0]({ table: "otef", ...data });
  deliver("otef_archive_window_command", { experience: "nli", experience_revision: 1, action: "open" });
  context.adoptAuthoritativeSnapshot(snapshot("regular", 2));
  context._markArchiveWindowBridgeReady(true);
  expect(archive).not.toHaveBeenCalled();
  deliver("otef_layers_changed", { experience: "nli", experience_revision: 1, layerGroups: snapshot("nli", 1).layerGroups });
  expect(context.getLayerGroups()[0].id).toBe("regular");
});

test("an older prepared snapshot cannot undo a cleanup receipt at the same revision", () => {
  const prepared = snapshot("nli", 1);
  prepared.experience_state.state_sequence = 1;
  prepared.experience_state.pending_transition = { request_id: "r", cleanup_confirmed: false };
  context.adoptAuthoritativeSnapshot(prepared);
  const confirmed = structuredClone(prepared);
  confirmed.experience_state.state_sequence = 2;
  confirmed.experience_state.pending_transition.cleanup_confirmed = true;
  confirmed.viewport.zoom = 16;
  context.adoptAuthoritativeSnapshot(confirmed);
  context.adoptAuthoritativeSnapshot(prepared);
  expect(context.getExperienceState().pending_transition.cleanup_confirmed).toBe(true);
  expect(context.getViewport().zoom).toBe(16);
});

test("prepare drops queued opens from this same activation after display cleanup", () => {
  vi.stubGlobal("WebSocket", class {
    static CONNECTING = 0; static OPEN = 1;
    constructor() { this.readyState = 0; } close() { this.readyState = 3; }
  });
  context._setupWebSocket();
  context.adoptAuthoritativeSnapshot(snapshot("nli", 1));
  const archive = vi.fn(); context.subscribe("archiveWindow", archive);
  const prepared = snapshot("nli", 1);
  prepared.experience_state.pending_transition = { request_id: "r", cleanup_confirmed: true };
  context.adoptAuthoritativeSnapshot(prepared);
  context._markArchiveWindowBridgeReady(true);
  const deliver = context._wsClient.listeners.get("otef_archive_window_command")[0];
  deliver({ table: "otef", experience: "nli", experience_revision: 1, archiveAction: "open" });
  expect(archive).not.toHaveBeenCalled();
  deliver({ table: "otef", experience: "nli", experience_revision: 1, archiveAction: "close" });
  expect(archive).toHaveBeenCalledTimes(1);
});

const borderGroups = enabled => [{ id: "gaza", enabled, layers: [{ id: "gaza_border", enabled }] }];

test.each(["setLayersEnabled", "toggleGroup"])("%s adopts the border row and display visibility from one command acknowledgement", async action => {
  const initial = snapshot("regular", 1);
  initial.layerGroups = borderGroups(false);
  initial.gaza_border_visible = false;
  context.adoptAuthoritativeSnapshot(initial);
  const ack = { layerGroups: borderGroups(true), gaza_border_visible: true };
  vi.spyOn(api, "setLayerToggles").mockResolvedValue(ack);
  vi.spyOn(api, "setGroupEnabled").mockResolvedValue(ack);
  const observed = [];
  context.subscribe("gazaBorderVisibility", visible => observed.push([visible, context.getLayerGroups()[0].layers[0].enabled]));
  await (action === "toggleGroup" ? context.toggleGroup("gaza", true) : context.setLayersEnabled(["gaza.gaza_border"], true));
  expect(context.getGazaBorderVisible()).toBe(true);
  expect(observed.at(-1)).toEqual([true, true]);
});

test("a layer fallback PATCH acknowledges border display visibility too", async () => {
  const initial = snapshot("regular", 1);
  initial.layerGroups = borderGroups(false);
  initial.gaza_border_visible = false;
  context.adoptAuthoritativeSnapshot(initial);
  vi.spyOn(api, "setLayerToggles").mockRejectedValue(new Error("command unavailable"));
  vi.spyOn(api, "updateLayerGroups").mockResolvedValue({ layerGroups: borderGroups(true), gaza_border_visible: true });
  await context.setLayersEnabled(["gaza.gaza_border"], true);
  expect(context.getGazaBorderVisible()).toBe(true);
});

test.each([
  ["setLayersEnabled", "command"], ["toggleGroup", "command"],
  ["setLayersEnabled", "patch"], ["toggleGroup", "patch"],
  ["toggleGroup", "legacy compensation"],
])("%s %s ACK keeps a newer border visibility event while adopting its layer rows", async (action, route) => {
  vi.stubGlobal("WebSocket", class {
    static CONNECTING = 0; static OPEN = 1;
    constructor() { this.readyState = 0; } close() { this.readyState = 3; }
  });
  context._setupWebSocket();
  const initial = snapshot("regular", 1);
  initial.layerGroups = borderGroups(false);
  initial.gaza_border_visible = false;
  context.adoptAuthoritativeSnapshot(initial);
  let finish;
  const pending = () => new Promise(resolve => { finish = resolve; });
  const command = vi.spyOn(api, action === "toggleGroup" ? "setGroupEnabled" : "setLayerToggles");
  if (route === "patch") {
    command.mockRejectedValue(new Error("command unavailable"));
    vi.spyOn(api, "updateLayerGroups").mockImplementation(pending);
  } else if (route === "legacy compensation") {
    command.mockResolvedValue({ layerGroups: [{ id: "gaza", layers: [{ id: "Gaza_Roads", enabled: true }] }] });
    vi.spyOn(api, "setLayerToggles").mockImplementation(pending);
  } else command.mockImplementation(pending);
  const operation = action === "toggleGroup"
    ? context.toggleGroup("gaza", true) : context.setLayersEnabled(["gaza.gaza_border"], true);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  context._wsClient.listeners.get("otef_gaza_border_visibility_changed")[0]({
    table: "otef", experience: "regular", experience_revision: 1, gazaBorderVisible: false,
  });
  finish({ layerGroups: borderGroups(true), gaza_border_visible: true });
  await expect(operation).resolves.toMatchObject({ ok: true });
  expect(context.getGazaBorderVisible()).toBe(false);
  expect(context.getLayerGroups()).toEqual(borderGroups(true));
  expect(context._layerPatchLastAcked).toEqual(borderGroups(true));
});

test("a layer socket event applies border visibility before notifying scene consumers", () => {
  vi.stubGlobal("WebSocket", class {
    static CONNECTING = 0; static OPEN = 1;
    constructor() { this.readyState = 0; } close() { this.readyState = 3; }
  });
  context._setupWebSocket();
  const initial = snapshot("regular", 1);
  initial.layerGroups = borderGroups(false);
  initial.gaza_border_visible = false;
  context.adoptAuthoritativeSnapshot(initial);
  const observed = [];
  context.subscribe("layerGroups", () => observed.push([context.getGazaBorderVisible(), context.getLayerGroups()[0].layers[0].enabled]));
  context._wsClient.listeners.get("otef_layers_changed")[0]({
    type: "otef_layers_changed", table: "otef", experience: "regular", experience_revision: 1,
    layerGroups: borderGroups(true), gazaBorderVisible: true,
  });
  expect(observed.at(-1)).toEqual([true, true]);
});

test("a delayed layer fallback cannot replace a newer border display override", async () => {
  vi.stubGlobal("WebSocket", class {
    static CONNECTING = 0; static OPEN = 1;
    constructor() { this.readyState = 0; } close() { this.readyState = 3; }
  });
  context._setupWebSocket();
  const initial = snapshot("regular", 1);
  initial.layerGroups = borderGroups(false);
  initial.gaza_border_visible = false;
  context.adoptAuthoritativeSnapshot(initial);
  let finish;
  vi.spyOn(api, "getState").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = context._wsClient.listeners.get("otef_layers_changed")[0]({ table: "otef", experience: "regular", experience_revision: 1 });
  context._wsClient.listeners.get("otef_gaza_border_visibility_changed")[0]({ table: "otef", experience: "regular", experience_revision: 1, gazaBorderVisible: true });
  finish({ layerGroups: borderGroups(true), gaza_border_visible: false });
  await pending;
  expect(context.getGazaBorderVisible()).toBe(true);
});
