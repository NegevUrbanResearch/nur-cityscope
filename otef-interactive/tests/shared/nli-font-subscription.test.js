import { expect, test, vi } from "vitest";
import { createNliFontSubscription } from "../../frontend/src/shared/nli-font-subscription.js";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";

const { projectionClientInstrumentation } = vi.hoisted(() => ({ projectionClientInstrumentation: { factory: null } }));
vi.mock("../../frontend/src/shared/projection-config-client.js", async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    createProjectionConfigClient: (...args) => projectionClientInstrumentation.factory
      ? projectionClientInstrumentation.factory(...args)
      : actual.createProjectionConfigClient(...args),
  };
});

const clone = value => structuredClone(value);
const stateFor = (revision, choices, geometry = {}) => {
  const config = clone(DEFAULT_PROJECTION_CONFIG);
  config.nliFonts = clone(choices);
  if (geometry.pre) config.pre = { ...config.pre, ...geometry.pre };
  for (const output of ["left", "right"]) if (geometry.outputs?.[output]) config.outputs[output] = { ...config.outputs[output], ...geometry.outputs[output] };
  return { revision, config, selectedPresetId: "original", presets: [{ id: "original", name: "Original calibration", config: clone(DEFAULT_PROJECTION_CONFIG), readOnly: true }] };
};

function harness(snapshots) {
  let connected = true;
  const events = new Map();
  const requests = [];
  const socket = {
    on(type, callback) { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(callback); },
    off(type, callback) { events.get(type)?.delete(callback); },
    getConnected: () => connected,
    emit(type, message) { for (const callback of events.get(type) || []) callback(message); },
  };
  const fetchImpl = vi.fn(async (_url, options = {}) => {
    requests.push(options.method || "GET");
    const config = snapshots.shift();
    return { ok: true, status: 200, json: async () => clone(config) };
  });
  const wait = () => new Promise(resolve => setTimeout(resolve, 0));
  return { socket, fetchImpl, requests, wait, disconnect() { connected = false; socket.emit("disconnect"); }, reconnect() { connected = true; socket.emit("connect"); } };
}

test("published_choices_only extracts exact font choices from snapshot despite a different draft", async () => {
  const publishedConfig = clone(DEFAULT_PROJECTION_CONFIG);
  publishedConfig.nliFonts = { he: "narkiss", en: "arial" };
  publishedConfig.pre = { ...publishedConfig.pre, scale: 7 };
  const draft = clone(DEFAULT_PROJECTION_CONFIG);
  draft.nliFonts = { he: "guttman", en: "marcellus" };
  draft.pre = { ...draft.pre, scale: 99 };
  const state = { snapshot: { revision: 4, config: publishedConfig }, draft };
  const fakeClient = {
    subscribe(listener) { listener(state); return () => {}; },
    getState: () => state,
    start: async () => state,
    stop: vi.fn(),
  };
  projectionClientInstrumentation.factory = vi.fn(() => fakeClient);
  const onChoices = vi.fn();
  const subscription = createNliFontSubscription({ socket: {}, sourceId: "00000000-0000-4000-8000-00000000000a", onChoices });
  try {
    await subscription.start();
    expect(state.snapshot.config.nliFonts).toEqual({ he: "narkiss", en: "arial" });
    expect(state.draft.nliFonts).toEqual({ he: "guttman", en: "marcellus" });
    expect(onChoices.mock.calls).toEqual([[{ he: "narkiss", en: "arial" }]]);
    expect(Object.keys(subscription).sort()).toEqual(["start", "stop"]);
  } finally {
    subscription.stop();
    projectionClientInstrumentation.factory = null;
  }
});

test("reconnect_restores_latest_revision through the existing client's hydration", async () => {
  const mock = harness([stateFor(7, { he: "default", en: "arial" }), stateFor(8, { he: "narkiss", en: "belleza" })]);
  const onChoices = vi.fn();
  const subscription = createNliFontSubscription({ socket: mock.socket, sourceId: "00000000-0000-4000-8000-00000000000a", fetchImpl: mock.fetchImpl, onChoices });
  await subscription.start();
  mock.disconnect();
  mock.reconnect();
  await mock.wait();
  expect(onChoices.mock.calls.map(([choices]) => choices)).toEqual([
    { he: "default", en: "arial" },
    { he: "narkiss", en: "belleza" },
  ]);
  expect(mock.requests).toEqual(["GET", "GET"]);
  subscription.stop();
});

test("stop_disposes_without_mutations", async () => {
  const mock = harness([stateFor(2, { he: "default", en: "hadassah" })]);
  const onChoices = vi.fn();
  const onError = vi.fn();
  const subscription = createNliFontSubscription({ socket: mock.socket, sourceId: "00000000-0000-4000-8000-00000000000a", fetchImpl: mock.fetchImpl, onChoices, onError });
  await subscription.start();
  subscription.stop();
  mock.disconnect();
  mock.reconnect();
  await mock.wait();
  expect(mock.fetchImpl).toHaveBeenCalledTimes(1);
  expect(mock.requests).toEqual(["GET"]);
  expect(onError).not.toHaveBeenCalled();
});
