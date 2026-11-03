import { afterEach, beforeEach, expect, test, vi } from "vitest";

const IDENTITY = [{ id: "nli", layers: [{ id: "people", enabled: true }, { id: "people_names", enabled: false }] }];
const WALL = [{ id: "nli", layers: [{ id: "people", enabled: false }, { id: "people_names", enabled: true }] }];
const enabled = context => context.getLayerGroups().find(group => group.id === "nli").layers
  .filter(layer => layer.enabled).map(layer => layer.id);
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
let context, api;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal("window", { location: { protocol: "http:", host: "exhibit.test" } });
  vi.stubGlobal("WebSocket", class {
    static CONNECTING = 0;
    static OPEN = 1;
    constructor() { this.readyState = 0; }
    close() { this.readyState = 3; }
  });
  ({ default: context } = await import("../../frontend/src/shared/OTEFDataContext.js"));
  ({ OTEF_API: api } = await import("../../frontend/src/shared/api-client.js"));
  context._tableName = "otef";
  context._setLayerGroups(IDENTITY);
  context._setAnimations({});
  context._setupWebSocket();
});

afterEach(() => {
  context?._wsClient?.disconnect();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const deliver = (type, message = {}) => context._wsClient.listeners.get(type)[0]({ table: "otef", ...message });

test("a delayed animation snapshot cannot replace a newer names-wall layer update", async () => {
  const old = deferred();
  vi.spyOn(api, "getState").mockReturnValue(old.promise);
  const animation = deliver("otef_animation_changed", { animations: { route: false } });
  await deliver("otef_layers_changed", { layerGroups: WALL });
  old.resolve({ layerGroups: IDENTITY, animations: { route: true } });
  await animation;
  expect(enabled(context)).toEqual(["people_names"]);
  expect(context._layerPatchLastAcked.find(group => group.id === "nli").layers).toEqual(WALL[0].layers);
  expect(context.getAnimations()).toEqual({ route: false });
});

test("a delayed layer fallback cannot replace a newer names-wall payload", async () => {
  const old = deferred();
  vi.spyOn(api, "getState").mockReturnValue(old.promise);
  const fallback = deliver("otef_layers_changed");
  await deliver("otef_layers_changed", { layerGroups: WALL });
  old.resolve({ layerGroups: IDENTITY });
  await fallback;
  expect(enabled(context)).toEqual(["people_names"]);
});

test.each(["older-first", "newer-first"])("layer fallbacks keep the latest request when responses finish %s", async order => {
  const old = deferred(), next = deferred();
  vi.spyOn(api, "getState").mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const first = deliver("otef_layers_changed"), second = deliver("otef_layers_changed");
  if (order === "older-first") {
    old.resolve({ layerGroups: IDENTITY }); await first;
    next.resolve({ layerGroups: WALL }); await second;
  } else {
    next.resolve({ layerGroups: WALL }); await second;
    old.resolve({ layerGroups: IDENTITY }); await first;
  }
  expect(enabled(context)).toEqual(["people_names"]);
});

test.each(["older-first", "newer-first"])("animation snapshots keep the latest request when responses finish %s", async order => {
  const old = deferred(), next = deferred();
  vi.spyOn(api, "getState").mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const first = deliver("otef_animation_changed", { animations: { route: true } });
  const second = deliver("otef_animation_changed", { animations: { route: false } });
  if (order === "older-first") {
    old.resolve({ layerGroups: IDENTITY, animations: { route: true } }); await first;
    next.resolve({ layerGroups: WALL, animations: { route: false } }); await second;
  } else {
    next.resolve({ layerGroups: WALL, animations: { route: false } }); await second;
    old.resolve({ layerGroups: IDENTITY, animations: { route: true } }); await first;
  }
  expect(enabled(context)).toEqual(["people_names"]);
  expect(context.getAnimations()).toEqual({ route: false });
});

test("a reconnect snapshot preserves layers and animations received while its GET was pending", async () => {
  const old = deferred();
  vi.spyOn(api, "getState").mockReturnValue(old.promise);
  const reconnect = context._wsClient.onConnectCallback();
  await deliver("otef_layers_changed", { layerGroups: WALL });
  context._setAnimations({ route: false });
  old.resolve({ layerGroups: IDENTITY, animations: { route: true } });
  await reconnect;
  expect(enabled(context)).toEqual(["people_names"]);
  expect(context.getAnimations()).toEqual({ route: false });
  expect(context.isConnected()).toBe(true);
});

test("a snapshot from a disconnected socket cannot apply or mark the context connected", async () => {
  const old = deferred();
  vi.spyOn(api, "getState").mockReturnValue(old.promise);
  const reconnect = context._wsClient.onConnectCallback();
  context._wsClient.onDisconnectCallback();
  old.resolve({ layerGroups: WALL, animations: { route: true } });
  await reconnect;
  expect(enabled(context)).toEqual(["people"]);
  expect(context.getAnimations()).toEqual({});
  expect(context.isConnected()).toBe(false);
});

test("a layer fallback from a disconnected socket cannot change the retained scene", async () => {
  const old = deferred();
  vi.spyOn(api, "getState").mockReturnValue(old.promise);
  const fallback = deliver("otef_layers_changed");
  context._wsClient.onDisconnectCallback();
  old.resolve({ layerGroups: WALL });
  await fallback;
  expect(enabled(context)).toEqual(["people"]);
});

test("a retired animation GET cannot invalidate fresh reconnect animation hydration", async () => {
  const old = deferred(), fresh = deferred();
  vi.spyOn(api, "getState").mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const animation = deliver("otef_animation_changed", { animations: { route: false } });
  context._wsClient.onDisconnectCallback();
  const reconnect = context._wsClient.onConnectCallback();
  old.resolve({ layerGroups: IDENTITY, animations: { route: false } }); await animation;
  fresh.resolve({ layerGroups: WALL, animations: { route: true } }); await reconnect;
  expect(enabled(context)).toEqual(["people_names"]);
  expect(context.getAnimations()).toEqual({ route: true });
});

test("explicit layer refresh cannot overwrite a subsequent scene update", async () => {
  const old = deferred();
  vi.spyOn(api, "getState").mockReturnValue(old.promise);
  const refresh = context.refreshLayerGroupsFromApi();
  await deliver("otef_layers_changed", { layerGroups: WALL });
  old.resolve({ layerGroups: IDENTITY });
  await refresh;
  expect(enabled(context)).toEqual(["people_names"]);
});

test("a same-value scene confirmation still invalidates an older snapshot", async () => {
  context._setLayerGroups(WALL);
  const old = deferred();
  vi.spyOn(api, "getState").mockReturnValue(old.promise);
  const refresh = context.refreshLayerGroupsFromApi();
  context._setLayerGroups(structuredClone(WALL));
  old.resolve({ layerGroups: IDENTITY });
  await refresh;
  expect(enabled(context)).toEqual(["people_names"]);
});

test("a layer snapshot cannot replace an optimistic local operation still awaiting acknowledgement", async () => {
  const old = deferred();
  vi.spyOn(api, "getState").mockReturnValue(old.promise);
  const refresh = context.refreshLayerGroupsFromApi();
  context._pendingLayerOps = 1;
  old.resolve({ layerGroups: WALL });
  await refresh;
  expect(enabled(context)).toEqual(["people"]);
});

test("an uncontested reconnect still hydrates layers and animations", async () => {
  vi.spyOn(api, "getState").mockResolvedValue({ layerGroups: WALL, animations: { route: false } });
  await context._wsClient.onConnectCallback();
  expect(enabled(context)).toEqual(["people_names"]);
  expect(context.getAnimations()).toEqual({ route: false });
});

test("a delayed narrative-conflict refresh preserves newer scene layers and animations", async () => {
  const old = deferred();
  const conflict = Object.assign(new Error("stale narrative revision"), {
    status: 409, details: { reason: "stale", narrative_state: { id: null, revision: 4 } },
  });
  vi.spyOn(api, "setNarrative").mockRejectedValue(conflict);
  const getState = vi.spyOn(api, "getState").mockReturnValue(old.promise);
  const change = context.setNarrative("segev").catch(error => error);
  await vi.waitFor(() => expect(getState).toHaveBeenCalled());
  await deliver("otef_layers_changed", { layerGroups: WALL });
  context._setAnimations({ route: false });
  old.resolve({ layerGroups: IDENTITY, animations: { route: true } });
  expect(await change).toBe(conflict);
  expect(enabled(context)).toEqual(["people_names"]);
  expect(context.getAnimations()).toEqual({ route: false });
});

test("a layer observer's newer animation update survives animation snapshot application", async () => {
  vi.spyOn(api, "getState").mockResolvedValue({ layerGroups: WALL, animations: { route: true } });
  context.subscribe("layerGroups", () => context._setAnimations({ route: false }));
  await deliver("otef_animation_changed", { animations: { route: true } });
  expect(enabled(context)).toEqual(["people_names"]);
  expect(context.getAnimations()).toEqual({ route: false });
});

test("a nested newer layer payload retains its acknowledged server baseline", async () => {
  let armed = false, nested = false;
  context.subscribe("layerGroups", () => {
    if (!armed || nested) return;
    nested = true;
    void deliver("otef_layers_changed", { layerGroups: WALL });
  });
  armed = true;
  await deliver("otef_layers_changed", { layerGroups: IDENTITY });
  expect(enabled(context)).toEqual(["people_names"]);
  expect(context._layerPatchLastAcked.find(group => group.id === "nli").layers).toEqual(WALL[0].layers);
});
