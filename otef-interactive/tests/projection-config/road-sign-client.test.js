import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRoadSignClient } from "../../frontend/src/projection-config/road-sign-client.js";
import { emptyRoadSignSettings } from "../../frontend/src/shared/road-sign-settings.js";

const sign = (id = "11111111-1111-4111-8111-111111111111", x = 960) => ({
  id, x, y: 540, scale: 0.7, rotateDeg: 0, theme: "dark", visible: true,
  leader: { enabled: false, x, y: 540 },
});
const doc = (...signs) => ({ version: 1, outputs: { left: signs, right: [] } });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe("Road 232 sign client", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("hydrates a normalized empty document and publishes state", async () => {
    const client = createRoadSignClient({
      getSnapshot: async () => ({ road_sign_settings: {}, road_sign_revision: 0 }),
      writeSettings: vi.fn(),
    });
    const seen = [];
    client.subscribe(() => seen.push(client.getState()));
    await client.hydrate();
    expect(client.getState()).toMatchObject({ acknowledged: emptyRoadSignSettings(), revision: 0, draft: null, status: "Saved" });
    expect(seen.length).toBeGreaterThan(0);
    client.destroy();
  });

  test("does not report an unsaved draft when only the initial snapshot failed", async () => {
    const client = createRoadSignClient({ getSnapshot: async () => { throw new Error("offline"); }, writeSettings: vi.fn() });
    await expect(client.hydrate()).rejects.toThrow("offline");
    expect(client.getState()).toMatchObject({ status: "Failed", draft: null, dirty: false, pending: false });
    expect(client.hasUnsavedWork()).toBe(false);
    client.destroy();
  });

  test("ignores older snapshots and rejects a different document at the same revision", async () => {
    const listeners = new Map();
    const socket = { on: (name, fn) => listeners.set(name, fn), off: vi.fn() };
    const getSnapshot = vi.fn().mockResolvedValue({ road_sign_settings: doc(sign()), road_sign_revision: 2 });
    const client = createRoadSignClient({ getSnapshot, writeSettings: vi.fn(), socket, tableName: "otef" });
    await client.hydrate();
    listeners.get("otef_road_signs_changed")({ table: "otef", roadSignSettings: doc(sign(undefined, 100)), roadSignRevision: 2 });
    await vi.waitFor(() => expect(getSnapshot).toHaveBeenCalledWith({ forceFresh: true }));
    expect(client.getState().revision).toBe(2);
    expect(client.getState().acknowledged).toEqual(doc(sign()));
    client.destroy();
  });

  test("filters events by table and accepts only newer valid revisions", async () => {
    const listeners = new Map();
    const socket = { on: (name, fn) => listeners.set(name, fn), off: vi.fn() };
    const client = createRoadSignClient({
      getSnapshot: async () => ({ road_sign_settings: doc(sign()), road_sign_revision: 2 }),
      writeSettings: vi.fn(), socket, tableName: "otef",
    });
    await client.hydrate();
    listeners.get("otef_road_signs_changed")({ table: "other", roadSignSettings: doc(sign(undefined, 100)), roadSignRevision: 3 });
    expect(client.getState().revision).toBe(2);
    listeners.get("otef_road_signs_changed")({ table: "otef", roadSignSettings: doc(sign(undefined, 100)), roadSignRevision: 3 });
    expect(client.getState().revision).toBe(3);
    expect(client.getState().acknowledged.outputs.left[0].x).toBe(100);
    client.destroy();
  });

  test("a late GET cannot roll back a newer WebSocket revision", async () => {
    const pendingSnapshot = deferred();
    const handlers = new Map();
    const socket = { on: (name, fn) => handlers.set(name, fn), off: vi.fn() };
    const getSnapshot = vi.fn().mockReturnValueOnce(pendingSnapshot.promise);
    const client = createRoadSignClient({ getSnapshot, writeSettings: vi.fn(), socket });
    const hydration = client.hydrate();
    handlers.get("otef_road_signs_changed")({ table: "otef", roadSignSettings: doc(sign(undefined, 400)), roadSignRevision: 2 });
    pendingSnapshot.resolve({ road_sign_settings: doc(sign()), road_sign_revision: 1 });
    await hydration;
    expect(client.getState()).toMatchObject({ acknowledged: doc(sign(undefined, 400)), revision: 2, status: "Saved" });
    client.destroy();
  });

  test("debounces numeric drafts for 150 ms and coalesces them into one write", async () => {
    const writeSettings = vi.fn(async (settings, meta) => ({ status: "ok", roadSignSettings: settings, roadSignRevision: meta.baseRevision + 1 }));
    const client = createRoadSignClient({ getSnapshot: async () => ({ road_sign_settings: doc(sign()), road_sign_revision: 4 }), writeSettings });
    await client.hydrate();
    const first = client.replaceDraft(doc(sign(undefined, 900)));
    const second = client.replaceDraft(doc(sign(undefined, 800)));
    await vi.advanceTimersByTimeAsync(149);
    expect(writeSettings).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([first, second]);
    expect(writeSettings).toHaveBeenCalledTimes(1);
    expect(writeSettings).toHaveBeenCalledWith(doc(sign(undefined, 800)), expect.objectContaining({ baseRevision: 4 }));
    client.destroy();
  });

  test("reports no unsaved work after a queued draft is returned to the acknowledged document", async () => {
    const writeSettings = vi.fn();
    const saved = doc(sign());
    const client = createRoadSignClient({ getSnapshot: async () => ({ road_sign_settings: saved, road_sign_revision: 4 }), writeSettings });
    await client.hydrate();
    client.replaceDraft(doc(sign(undefined, 800)));
    expect(client.hasUnsavedWork()).toBe(true);
    await client.replaceDraft(saved);
    expect(client.getState()).toMatchObject({ draft: null, dirty: false, pending: false, status: "Saved" });
    expect(client.hasUnsavedWork()).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(writeSettings).not.toHaveBeenCalled();
    client.destroy();
  });

  test("flushes one write immediately when a gesture is released", async () => {
    const writeSettings = vi.fn(async (settings, meta) => ({ status: "ok", roadSignSettings: settings, roadSignRevision: meta.baseRevision + 1 }));
    const client = createRoadSignClient({ getSnapshot: async () => ({ road_sign_settings: doc(sign()), road_sign_revision: 1 }), writeSettings });
    await client.hydrate();
    const done = client.replaceDraft(doc(sign(undefined, 700)), { flush: true });
    await vi.advanceTimersByTimeAsync(0);
    await done;
    expect(writeSettings).toHaveBeenCalledTimes(1);
    expect(writeSettings.mock.calls[0][0].outputs.left[0].x).toBe(700);
    client.destroy();
  });

  test("acknowledges only the sent generation and saves a newer in-flight draft against its revision", async () => {
    const pending = deferred();
    const writeSettings = vi.fn().mockReturnValueOnce(pending.promise).mockImplementation(async (settings, meta) => ({ status: "ok", roadSignSettings: settings, roadSignRevision: meta.baseRevision + 1 }));
    const client = createRoadSignClient({ getSnapshot: async () => ({ road_sign_settings: doc(sign()), road_sign_revision: 1 }), writeSettings });
    await client.hydrate();
    const sent = doc(sign(undefined, 700));
    const first = client.replaceDraft(sent, { flush: true });
    await vi.advanceTimersByTimeAsync(0);
    const newer = doc(sign(undefined, 650));
    const second = client.replaceDraft(newer);
    pending.resolve({ status: "ok", roadSignSettings: sent, roadSignRevision: 2 });
    await vi.advanceTimersByTimeAsync(0);
    await first;
    await vi.advanceTimersByTimeAsync(150);
    await second;
    expect(writeSettings).toHaveBeenCalledTimes(2);
    expect(writeSettings.mock.calls[1][1].baseRevision).toBe(2);
    expect(client.getState()).toMatchObject({ acknowledged: newer, revision: 3, draft: null, status: "Saved" });
    client.destroy();
  });

  test("a late HTTP acknowledgement cannot replace a newer conflicting WebSocket document", async () => {
    const pending = deferred();
    const handlers = new Map();
    const socket = { on: (name, fn) => handlers.set(name, fn), off: vi.fn() };
    const sent = doc(sign(undefined, 700));
    const remote = doc(sign(undefined, 500));
    const seen = [];
    const client = createRoadSignClient({
      getSnapshot: async () => ({ road_sign_settings: doc(sign()), road_sign_revision: 1 }),
      writeSettings: () => pending.promise,
      socket,
    });
    client.subscribe((state) => seen.push(state));
    await client.hydrate();
    const save = client.replaceDraft(sent, { flush: true });
    const saveResult = expect(save).resolves.toMatchObject({ status: "Conflict" });
    await vi.advanceTimersByTimeAsync(0);
    handlers.get("otef_road_signs_changed")({ table: "otef", roadSignSettings: remote, roadSignRevision: 3 });
    pending.resolve({ status: "ok", roadSignSettings: sent, roadSignRevision: 2 });
    await saveResult;
    expect(client.getState()).toMatchObject({ acknowledged: remote, revision: 3, draft: sent, status: "Conflict" });
    expect(seen.at(-1)).toMatchObject({ status: "Conflict", pending: false });
    client.destroy();
  });

  test("retains a failed draft and retry rechecks the current snapshot before writing", async () => {
    const writeSettings = vi.fn().mockRejectedValueOnce(new Error("offline"));
    const getSnapshot = vi.fn().mockResolvedValue({ road_sign_settings: doc(sign()), road_sign_revision: 1 });
    const client = createRoadSignClient({ getSnapshot, writeSettings });
    await client.hydrate();
    const draft = doc(sign(undefined, 700));
    const save = client.replaceDraft(draft, { flush: true });
    const failed = expect(save).rejects.toThrow("offline");
    await vi.advanceTimersByTimeAsync(0);
    await failed;
    expect(client.getState()).toMatchObject({ draft, status: "Failed" });
    expect(client.hasUnsavedWork()).toBe(true);
    writeSettings.mockImplementationOnce(async (settings, meta) => ({ status: "ok", roadSignSettings: settings, roadSignRevision: meta.baseRevision + 1 }));
    await client.retry();
    expect(getSnapshot).toHaveBeenLastCalledWith({ forceFresh: true });
    expect(writeSettings).toHaveBeenCalledTimes(2);
    expect(client.getState()).toMatchObject({ draft: null, status: "Saved" });
    client.destroy();
  });

  test("publishes the settled pending state after a terminal write failure", async () => {
    const client = createRoadSignClient({
      getSnapshot: async () => ({ road_sign_settings: doc(sign()), road_sign_revision: 1 }),
      writeSettings: vi.fn().mockRejectedValue(new Error("offline")),
    });
    const seen = [];
    client.subscribe((state) => seen.push(state));
    await client.hydrate();
    const save = client.replaceDraft(doc(sign(undefined, 700)), { flush: true });
    const failed = expect(save).rejects.toThrow("offline");
    await vi.advanceTimersByTimeAsync(0);
    await failed;
    expect(client.getState()).toMatchObject({ status: "Failed", pending: false });
    expect(seen.at(-1)).toMatchObject({ status: "Failed", pending: false });
    expect(client.hasUnsavedWork()).toBe(true);
    client.destroy();
  });

  test("refuses Retry when a different editor has advanced the revision", async () => {
    const remote = doc(sign(undefined, 500));
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce({ road_sign_settings: doc(sign()), road_sign_revision: 1 })
      .mockResolvedValueOnce({ road_sign_settings: doc(sign()), road_sign_revision: 1 })
      .mockResolvedValueOnce({ road_sign_settings: remote, road_sign_revision: 2 });
    const writeSettings = vi.fn().mockRejectedValueOnce(new Error("offline"));
    const client = createRoadSignClient({ getSnapshot, writeSettings });
    await client.hydrate();
    const save = client.replaceDraft(doc(sign(undefined, 700)), { flush: true });
    const saveFailure = expect(save).rejects.toThrow("offline");
    await vi.advanceTimersByTimeAsync(0);
    await saveFailure;
    expect(client.getState().status).toBe("Failed");
    await expect(client.retry()).resolves.toMatchObject({ status: "Conflict" });
    expect(client.getState()).toMatchObject({ acknowledged: remote, revision: 2, status: "Conflict" });
    expect(writeSettings).toHaveBeenCalledTimes(1);
    client.destroy();
  });

  test("failure reconciliation preserves a newer WebSocket conflict when its GET returns the old base", async () => {
    const failureSnapshot = deferred();
    const write = deferred();
    const handlers = new Map();
    const socket = { on: (name, fn) => handlers.set(name, fn), off: vi.fn() };
    const base = doc(sign());
    const remote = doc(sign(undefined, 500));
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce({ road_sign_settings: base, road_sign_revision: 2 })
      .mockReturnValueOnce(failureSnapshot.promise);
    const writeSettings = vi.fn(() => write.promise);
    const client = createRoadSignClient({ getSnapshot, writeSettings, socket });
    await client.hydrate();
    const save = client.replaceDraft(doc(sign(undefined, 700)), { flush: true });
    const saveResult = expect(save).resolves.toMatchObject({ status: "Conflict" });
    await vi.advanceTimersByTimeAsync(0);
    write.reject(new Error("offline"));
    await vi.waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));
    handlers.get("otef_road_signs_changed")({ table: "otef", roadSignSettings: remote, roadSignRevision: 3 });
    failureSnapshot.resolve({ road_sign_settings: base, road_sign_revision: 2 });
    await saveResult;
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getState()).toMatchObject({ acknowledged: remote, revision: 3, status: "Conflict", draft: doc(sign(undefined, 700)) });
    await expect(client.retry()).resolves.toMatchObject({ status: "Conflict" });
    expect(writeSettings).toHaveBeenCalledTimes(1);
    client.destroy();
  });

  test("Retry reconciliation preserves a newer WebSocket conflict when its GET returns the failed base", async () => {
    const retrySnapshot = deferred();
    const handlers = new Map();
    const socket = { on: (name, fn) => handlers.set(name, fn), off: vi.fn() };
    const base = doc(sign());
    const remote = doc(sign(undefined, 500));
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce({ road_sign_settings: base, road_sign_revision: 2 })
      .mockResolvedValueOnce({ road_sign_settings: base, road_sign_revision: 2 })
      .mockReturnValueOnce(retrySnapshot.promise);
    const writeSettings = vi.fn().mockRejectedValueOnce(new Error("offline"));
    const client = createRoadSignClient({ getSnapshot, writeSettings, socket });
    await client.hydrate();
    const save = client.replaceDraft(doc(sign(undefined, 700)), { flush: true });
    const saveFailure = expect(save).rejects.toThrow("offline");
    await vi.advanceTimersByTimeAsync(0);
    await saveFailure;
    const retry = client.retry();
    await vi.waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(3));
    handlers.get("otef_road_signs_changed")({ table: "otef", roadSignSettings: remote, roadSignRevision: 3 });
    retrySnapshot.resolve({ road_sign_settings: base, road_sign_revision: 2 });
    await expect(retry).resolves.toMatchObject({ status: "Conflict" });
    expect(client.getState()).toMatchObject({ acknowledged: remote, revision: 3, status: "Conflict" });
    expect(writeSettings).toHaveBeenCalledTimes(1);
    client.destroy();
  });

  test("forced refresh during an in-flight write acknowledges that sent generation", async () => {
    const refreshSnapshot = deferred();
    const response = deferred();
    const handlers = new Map();
    const socket = { on: (name, fn) => handlers.set(name, fn), off: vi.fn() };
    const base = doc(sign());
    const sent = doc(sign(undefined, 700));
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce({ road_sign_settings: base, road_sign_revision: 1 })
      .mockReturnValueOnce(refreshSnapshot.promise);
    const writeSettings = vi.fn(() => response.promise);
    const client = createRoadSignClient({ getSnapshot, writeSettings, socket });
    await client.hydrate();
    const save = client.replaceDraft(sent, { flush: true });
    await vi.advanceTimersByTimeAsync(0);
    handlers.get("otef_road_signs_changed")({ table: "otef", roadSignSettings: doc(sign(undefined, 600)), roadSignRevision: 1 });
    await vi.waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));
    refreshSnapshot.resolve({ roadSignSettings: sent, roadSignRevision: 2 });
    await vi.advanceTimersByTimeAsync(0);
    response.resolve({ status: "ok", roadSignSettings: sent, roadSignRevision: 2 });
    await save;
    expect(client.getState()).toMatchObject({ acknowledged: sent, revision: 2, draft: null, status: "Saved" });
    expect(client.hasUnsavedWork()).toBe(false);
    client.destroy();
  });

  test("does not auto-dispatch a newer queued draft after unchanged-base failure", async () => {
    const failureSnapshot = deferred();
    const firstWrite = deferred();
    const base = doc(sign());
    const first = doc(sign(undefined, 700));
    const newer = doc(sign(undefined, 650));
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce({ road_sign_settings: base, road_sign_revision: 1 })
      .mockReturnValueOnce(failureSnapshot.promise)
      .mockResolvedValue({ road_sign_settings: base, road_sign_revision: 1 });
    const writeSettings = vi.fn()
      .mockReturnValueOnce(firstWrite.promise)
      .mockImplementation(async (settings, meta) => ({ status: "ok", roadSignSettings: settings, roadSignRevision: meta.baseRevision + 1 }));
    const client = createRoadSignClient({ getSnapshot, writeSettings });
    await client.hydrate();
    const firstSave = client.replaceDraft(first, { flush: true });
    const firstFailure = expect(firstSave).rejects.toThrow("offline");
    await vi.advanceTimersByTimeAsync(0);
    const newerSave = client.replaceDraft(newer);
    await vi.advanceTimersByTimeAsync(150);
    firstWrite.reject(new Error("offline"));
    await vi.waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));
    failureSnapshot.resolve({ road_sign_settings: base, road_sign_revision: 1 });
    await firstFailure;
    await vi.advanceTimersByTimeAsync(0);
    await expect(newerSave).resolves.toMatchObject({ status: "Failed" });
    expect(writeSettings).toHaveBeenCalledTimes(1);
    expect(client.getState()).toMatchObject({ draft: newer, status: "Failed", pending: false });
    expect(client.hasUnsavedWork()).toBe(true);
    await client.retry();
    expect(writeSettings).toHaveBeenCalledTimes(2);
    expect(client.getState()).toMatchObject({ acknowledged: newer, revision: 2, draft: null, status: "Saved" });
    client.destroy();
  });

  test("treats an uncertain sent-document match as acknowledgement while retaining a newer draft", async () => {
    const sent = doc(sign(undefined, 700));
    const newer = doc(sign(undefined, 650));
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce({ road_sign_settings: doc(sign()), road_sign_revision: 1 })
      .mockResolvedValueOnce({ road_sign_settings: sent, road_sign_revision: 2 });
    const writeSettings = vi.fn()
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockImplementation(async (settings, meta) => ({ status: "ok", roadSignSettings: settings, roadSignRevision: meta.baseRevision + 1 }));
    const client = createRoadSignClient({ getSnapshot, writeSettings });
    await client.hydrate();
    const first = client.replaceDraft(sent, { flush: true });
    await vi.advanceTimersByTimeAsync(0);
    client.replaceDraft(newer);
    expect(client.getState()).toMatchObject({ draft: newer, dirty: true, pending: true });
    expect(client.hasUnsavedWork()).toBe(true);
    const firstResult = expect(first).resolves.toMatchObject({ status: "ok", revision: 2 });
    await firstResult;
    await vi.runAllTimersAsync();
    expect(client.getState()).toMatchObject({ acknowledged: newer, revision: 3, draft: null, status: "Saved" });
    expect(writeSettings.mock.calls[1][1].baseRevision).toBe(2);
    expect(client.hasUnsavedWork()).toBe(false);
    client.destroy();
  });

  test("marks a different newer snapshot as Conflict and Use latest drops only the local draft", async () => {
    const remote = doc(sign(undefined, 500));
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce({ road_sign_settings: doc(sign()), road_sign_revision: 1 })
      .mockResolvedValue({ road_sign_settings: remote, road_sign_revision: 2 });
    const client = createRoadSignClient({ getSnapshot, writeSettings: vi.fn(), tableName: "otef" });
    await client.hydrate();
    client.replaceDraft(doc(sign(undefined, 700)));
    // A fresh snapshot reconciles the draft against another editor's accepted revision.
    const result = await client.hydrate({ forceFresh: true });
    expect(result).toBe(true);
    expect(client.getState()).toMatchObject({ acknowledged: remote, revision: 2, draft: doc(sign(undefined, 700)), status: "Conflict" });
    client.useLatest();
    expect(client.getState()).toMatchObject({ acknowledged: remote, draft: null, status: "Saved" });
    client.destroy();
  });

  test("a conflicting draft rejects ordinary replacement until Use latest and reapplication preserves remote output", async () => {
    const handlers = new Map();
    const socket = { on: (name, fn) => handlers.set(name, fn), off: vi.fn() };
    const initial = doc(sign());
    const remote = { version: 1, outputs: { left: [sign()], right: [sign("22222222-2222-4222-8222-222222222222", 300)] } };
    const writes = [];
    const client = createRoadSignClient({
      getSnapshot: vi.fn().mockResolvedValue({ road_sign_settings: initial, road_sign_revision: 1 }),
      writeSettings: vi.fn(async (settings, meta) => { writes.push({ settings, meta }); return { roadSignSettings: settings, roadSignRevision: meta.baseRevision + 1 }; }),
      socket, tableName: "otef",
    });
    await client.hydrate();
    const stale = doc(sign(undefined, 700));
    void client.replaceDraft(stale);
    handlers.get("otef_road_signs_changed")({ table: "otef", roadSignSettings: remote, roadSignRevision: 2 });
    expect(client.getState()).toMatchObject({ status: "Conflict", draft: stale, acknowledged: remote, revision: 2 });
    const attempted = structuredClone(stale); attempted.outputs.left[0].rotateDeg = 12;
    const attempt = client.replaceDraft(attempted, { flush: true }).then(() => null, (failure) => failure);
    await vi.runAllTimersAsync();
    expect(await attempt).toMatchObject({ code: "conflict", status: 409 });
    expect(writes).toHaveLength(0);
    expect(client.getState().status).toBe("Conflict");
    client.useLatest();
    const reapplied = structuredClone(client.getState().acknowledged);
    reapplied.outputs.left[0].x = 700; reapplied.outputs.left[0].rotateDeg = 12;
    const reappliedSave = client.replaceDraft(reapplied, { flush: true });
    await vi.runAllTimersAsync();
    await reappliedSave;
    expect(writes).toHaveLength(1);
    expect(writes[0].settings.outputs.right).toEqual(remote.outputs.right);
    expect(client.getState()).toMatchObject({ status: "Saved", draft: null, acknowledged: reapplied });
    client.destroy();
  });

  test("clean reconnect hydrates fresh state and dirty reconnect becomes an explicit conflict", async () => {
    const handlers = new Map();
    const socket = { on: (name, fn) => handlers.set(name, fn), off: vi.fn() };
    const remote = doc(sign(undefined, 500));
    const newest = doc(sign(undefined, 400));
    let snapshots = 0;
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce({ road_sign_settings: doc(sign()), road_sign_revision: 1 })
      .mockImplementation(async () => {
        snapshots += 1;
        return snapshots === 1
          ? { road_sign_settings: remote, road_sign_revision: 2 }
          : { road_sign_settings: newest, road_sign_revision: 3 };
      });
    const client = createRoadSignClient({ getSnapshot, writeSettings: vi.fn(), socket });
    await client.hydrate();
    handlers.get("disconnect")();
    handlers.get("connect")();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getState().acknowledged).toEqual(remote);
    client.replaceDraft(doc(sign(undefined, 700)));
    handlers.get("disconnect")();
    handlers.get("connect")();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.getState().draft.outputs.left[0].x).toBe(700);
    expect(client.hasUnsavedWork()).toBe(true);
    client.useLatest();
    expect(client.getState()).toMatchObject({ acknowledged: newest, revision: 3, draft: null, status: "Saved" });
    expect(client.hasUnsavedWork()).toBe(false);
    client.destroy();
  });

  test("does not send a queued draft after reconnect until the forced snapshot completes", async () => {
    const handlers = new Map();
    const socket = { on: (name, fn) => handlers.set(name, fn), off: vi.fn() };
    const reconnectSnapshot = deferred();
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce({ road_sign_settings: doc(sign()), road_sign_revision: 1 })
      .mockReturnValueOnce(reconnectSnapshot.promise);
    const writeSettings = vi.fn(async (settings, meta) => ({ status: "ok", roadSignSettings: settings, roadSignRevision: meta.baseRevision + 1 }));
    const client = createRoadSignClient({ getSnapshot, writeSettings, socket });
    await client.hydrate();
    client.replaceDraft(doc(sign(undefined, 700)));
    handlers.get("disconnect")();
    handlers.get("connect")();
    await vi.advanceTimersByTimeAsync(200);
    expect(writeSettings).not.toHaveBeenCalled();
    reconnectSnapshot.resolve({ road_sign_settings: doc(sign()), road_sign_revision: 1 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.runAllTimersAsync();
    expect(writeSettings).toHaveBeenCalledTimes(1);
    expect(writeSettings.mock.calls[0][1].baseRevision).toBe(1);
    client.destroy();
  });

  test("failed reconnect hydration keeps writes blocked until Retry gets a fresh snapshot", async () => {
    const handlers = new Map();
    const socket = { on: (name, fn) => handlers.set(name, fn), off: vi.fn() };
    const reconnect = deferred();
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce({ road_sign_settings: doc(sign()), road_sign_revision: 1 })
      .mockReturnValueOnce(reconnect.promise)
      .mockResolvedValue({ road_sign_settings: doc(sign()), road_sign_revision: 1 });
    const writeSettings = vi.fn(async (settings, meta) => ({ status: "ok", roadSignSettings: settings, roadSignRevision: meta.baseRevision + 1 }));
    const client = createRoadSignClient({ getSnapshot, writeSettings, socket });
    await client.hydrate();
    handlers.get("disconnect")();
    handlers.get("connect")();
    await vi.waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));
    reconnect.reject(new Error("offline"));
    await vi.advanceTimersByTimeAsync(0);
    client.replaceDraft(doc(sign(undefined, 700)), { flush: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(writeSettings).not.toHaveBeenCalled();
    await client.retry();
    expect(getSnapshot).toHaveBeenLastCalledWith({ forceFresh: true });
    expect(writeSettings).toHaveBeenCalledTimes(1);
    expect(client.getState().status).toBe("Saved");
    client.destroy();
  });

  test("Retry started before a new reconnect cannot release that reconnect's write block", async () => {
    const handlers = new Map();
    const socket = { on: (name, fn) => handlers.set(name, fn), off: vi.fn() };
    const retrySnapshot = deferred();
    const reconnectSnapshot = deferred();
    const base = doc(sign());
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce({ road_sign_settings: base, road_sign_revision: 1 })
      .mockResolvedValueOnce({ road_sign_settings: base, road_sign_revision: 1 })
      .mockReturnValueOnce(retrySnapshot.promise)
      .mockReturnValueOnce(reconnectSnapshot.promise)
      .mockResolvedValue({ road_sign_settings: base, road_sign_revision: 1 });
    const writeSettings = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(async (settings, meta) => ({ status: "ok", roadSignSettings: settings, roadSignRevision: meta.baseRevision + 1 }));
    const client = createRoadSignClient({ getSnapshot, writeSettings, socket });
    await client.hydrate();
    const failedSave = client.replaceDraft(doc(sign(undefined, 700)), { flush: true });
    const saveFailure = expect(failedSave).rejects.toThrow("offline");
    await vi.advanceTimersByTimeAsync(0);
    await saveFailure;

    const retry = client.retry();
    await vi.waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(3));
    handlers.get("disconnect")();
    handlers.get("connect")();
    await vi.waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(4));

    retrySnapshot.resolve({ road_sign_settings: base, road_sign_revision: 1 });
    await expect(retry).resolves.toMatchObject({ status: "superseded" });
    expect(writeSettings).toHaveBeenCalledTimes(1);

    reconnectSnapshot.resolve({ road_sign_settings: base, road_sign_revision: 1 });
    await vi.advanceTimersByTimeAsync(0);
    await client.retry();
    expect(writeSettings).toHaveBeenCalledTimes(2);
    expect(client.getState()).toMatchObject({ draft: null, revision: 2, status: "Saved" });
    client.destroy();
  });

  test("overlapping reconnect reads keep writes blocked until the newest read succeeds", async () => {
    const handlers = new Map();
    const socket = { on: (name, fn) => handlers.set(name, fn), off: vi.fn() };
    const olderReconnect = deferred();
    const latestReconnect = deferred();
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce({ road_sign_settings: doc(sign()), road_sign_revision: 1 })
      .mockReturnValueOnce(olderReconnect.promise)
      .mockReturnValueOnce(latestReconnect.promise);
    const writeSettings = vi.fn(async (settings, meta) => ({ status: "ok", roadSignSettings: settings, roadSignRevision: meta.baseRevision + 1 }));
    const client = createRoadSignClient({ getSnapshot, writeSettings, socket });
    await client.hydrate();
    handlers.get("disconnect")();
    handlers.get("connect")();
    handlers.get("disconnect")();
    handlers.get("connect")();
    await vi.waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(3));
    olderReconnect.resolve({ road_sign_settings: doc(sign()), road_sign_revision: 1 });
    await vi.advanceTimersByTimeAsync(0);
    client.replaceDraft(doc(sign(undefined, 700)), { flush: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(writeSettings).not.toHaveBeenCalled();
    latestReconnect.resolve({ road_sign_settings: doc(sign()), road_sign_revision: 1 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.runAllTimersAsync();
    expect(writeSettings).toHaveBeenCalledTimes(1);
    expect(writeSettings.mock.calls[0][1].baseRevision).toBe(1);
    client.destroy();
  });

  test("Use latest still reports an unresolved in-flight write as unsaved work", async () => {
    const pending = deferred();
    const handlers = new Map();
    const socket = { on: (name, fn) => handlers.set(name, fn), off: vi.fn() };
    const remote = doc(sign(undefined, 500));
    const seen = [];
    const client = createRoadSignClient({
      getSnapshot: async () => ({ road_sign_settings: doc(sign()), road_sign_revision: 1 }),
      writeSettings: () => pending.promise,
      socket,
    });
    client.subscribe((state) => seen.push(state));
    await client.hydrate();
    const save = client.replaceDraft(doc(sign(undefined, 700)), { flush: true });
    const saveResult = expect(save).resolves.toMatchObject({ status: "Conflict" });
    await vi.advanceTimersByTimeAsync(0);
    handlers.get("otef_road_signs_changed")({ table: "otef", roadSignSettings: remote, roadSignRevision: 3 });
    client.useLatest();
    expect(client.getState().pending).toBe(true);
    expect(client.hasUnsavedWork()).toBe(true);
    pending.resolve({ status: "ok", roadSignSettings: doc(sign(undefined, 700)), roadSignRevision: 2 });
    await saveResult;
    expect(client.getState()).toMatchObject({ acknowledged: remote, revision: 3, draft: null, status: "Saved" });
    expect(client.hasUnsavedWork()).toBe(false);
    expect(seen.at(-1)).toMatchObject({ status: "Saved", pending: false });
    client.destroy();
  });
});
