import { afterEach, describe, expect, test, vi } from "vitest";
import { createSettlementNameClient } from "../../frontend/src/projection-config/settlement-name-client.js";

const EVENT = "otef_settlement_names_changed";

function settingsFixture() {
  return {
    baseline: {
      captureId: "fixture-settlement-name",
      captureDigest: "a".repeat(64),
      sourceDigest: "b".repeat(64),
      catalogDigest: "c".repeat(64),
      predecessor: { revision: 749, configDigest: "d".repeat(64) },
      successor: { revision: 750, configDigest: "e".repeat(64) },
      outputs: {
        left: { "0067": { x: 510, y: 350 }, "0424": { x: -40, y: 1400 } },
        right: { "0067": { x: 1200, y: 350 }, "0424": { x: 3000, y: -20 } },
      },
    },
    style: { fontFamily: "Guttman Hatzvi", fontPx: 14, rotateDeg: 35 },
    outputs: { left: {}, right: {} },
  };
}

function viewportFixture(overrides = {}) {
  return {
    settlement_name_settings: settingsFixture(),
    settlement_name_revision: 0,
    ...overrides,
  };
}

function ackFixture(revision, outputs = {}) {
  const settings = settingsFixture();
  settings.outputs = {
    left: { ...(outputs.left || {}) },
    right: { ...(outputs.right || {}) },
  };
  return {
    status: "ok",
    action: "set_settlement_names",
    settlementNameSettings: settings,
    settlementNameRevision: revision,
  };
}

function serverWriteFixture(operation) {
  const settings = settingsFixture();
  if (operation.operation === "position") {
    settings.outputs[operation.output][operation.citycode] = { ...operation.position };
  } else if (operation.operation === "reset_position") {
    delete settings.outputs[operation.output][operation.citycode];
  } else if (operation.operation === "style") {
    settings.style = { ...operation.style };
  }
  return {
    status: "ok",
    action: "set_settlement_names",
    settlementNameSettings: settings,
    settlementNameRevision: operation.baseRevision + 1,
  };
}

function accumulatingWriter() {
  let settings = settingsFixture();
  return (operation) => {
    settings = structuredClone(settings);
    if (operation.operation === "position") {
      settings.outputs[operation.output][operation.citycode] = { ...operation.position };
    } else if (operation.operation === "reset_position") {
      delete settings.outputs[operation.output][operation.citycode];
    } else if (operation.operation === "style") {
      settings.style = { ...operation.style };
    }
    return {
      status: "ok",
      action: "set_settlement_names",
      settlementNameSettings: structuredClone(settings),
      settlementNameRevision: operation.baseRevision + 1,
    };
  };
}

function baselineFixture(value = null, revision = 0) {
  return { value, revision };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function socketFixture() {
  const listeners = new Map();
  return {
    on: vi.fn((type, callback) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    }),
    off: vi.fn((type, callback) => listeners.get(type)?.delete(callback)),
    emit(type, message) {
      for (const callback of listeners.get(type) || []) callback(message);
    },
    listeners,
  };
}

function changed(settings, revision, extra = {}) {
  return {
    type: EVENT,
    table: "otef",
    settlementNameSettings: settings,
    settlementNameRevision: revision,
    ...extra,
  };
}

function withOverride(output, citycode, position, revision = 1) {
  const settings = settingsFixture();
  settings.outputs[output][citycode] = position;
  return changed(settings, revision);
}

const leftTarget = { kind: "position", output: "left", citycode: "0067" };
const otherTarget = { kind: "position", output: "left", citycode: "0424" };
const rightTarget = { kind: "position", output: "right", citycode: "0067" };
const styleTarget = { kind: "style" };
const styleValue = { fontFamily: "Arial", fontPx: 18, rotateDeg: 10 };

describe("settlement name client", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete globalThis.addEventListener;
    delete globalThis.removeEventListener;
  });

  test("an acknowledgement cannot clear a newer position draft or switch its output", async () => {
    const first = deferred();
    const client = createSettlementNameClient({
      getSnapshot: async () => viewportFixture(),
      writeOperation: vi.fn().mockReturnValueOnce(first.promise).mockImplementation(serverWriteFixture),
      socket: socketFixture(),
      tableName: "otef",
    });
    await client.hydrate();
    const target = { kind: "position", output: "left", citycode: "0067" };
    const a = client.commit(target, { x: 510, y: 350 }, { baseline: baselineFixture() });
    const b = client.commit(target, { x: 520, y: 350 }, { baseline: baselineFixture() });
    first.resolve(ackFixture(1, { left: { "0067": { x: 510, y: 350 } } }));
    await a;
    expect(client.getTarget(target).draft).toEqual({ x: 520, y: 350 });
    await b;
    expect(client.getTarget(target).status).toBe("Saved");
    expect(client.getSnapshot().settings.outputs.right).toEqual({});
    client.destroy();
  });

  test("rejects stale snapshots from GET, events, and HTTP acknowledgements", async () => {
    const socket = socketFixture();
    let current = viewportFixture({ settlement_name_revision: 2 });
    const writeOperation = vi.fn(async () => ackFixture(1, { left: { "0067": { x: 1, y: 1 } } }));
    const client = createSettlementNameClient({
      getSnapshot: async () => current,
      writeOperation,
      socket,
    });
    await client.hydrate();
    const advanced = settingsFixture();
    advanced.outputs.left["0067"] = { x: 12, y: 18 };
    socket.emit(EVENT, changed(advanced, 3));
    expect(client.getTarget(leftTarget).acknowledged).toEqual({ x: 12, y: 18 });
    socket.emit(EVENT, changed(settingsFixture(), 1));
    current = viewportFixture({ settlement_name_revision: 1 });
    await client.hydrate({ forceFresh: true });
    expect(client.getTarget(leftTarget).acknowledged).toEqual({ x: 12, y: 18 });
    await expect(client.commit(leftTarget, { x: 20, y: 20 })).rejects.toThrow(/acknowledgement revision/i);
    expect(writeOperation).toHaveBeenCalledTimes(1);
    expect(client.getTarget(leftTarget).draft).toEqual({ x: 20, y: 20 });
    expect(client.getTarget(leftTarget).status).not.toBe("Saved");
    client.destroy();
  });

  test("refreshes once when an equal revision carries a different snapshot", async () => {
    const socket = socketFixture();
    const refreshed = settingsFixture();
    refreshed.outputs.left["0067"] = { x: 48, y: 350 };
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce(viewportFixture())
      .mockResolvedValueOnce(viewportFixture({
        settlement_name_settings: refreshed,
        settlement_name_revision: 0,
      }));
    const client = createSettlementNameClient({ getSnapshot, writeOperation: vi.fn(), socket });
    await client.hydrate();
    const mismatched = settingsFixture();
    mismatched.outputs.left["0067"] = { x: 37, y: 350 };
    socket.emit(EVENT, changed(mismatched, 0));
    await vi.waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));
    expect(getSnapshot).toHaveBeenLastCalledWith({ forceFresh: true });
    expect(client.getTarget(leftTarget).acknowledged).toEqual({ x: 48, y: 350 });
    expect(getSnapshot).toHaveBeenCalledTimes(2);
    client.destroy();
  });

  test("a matching event acknowledges a save before a late HTTP failure", async () => {
    const socket = socketFixture();
    let rejectWrite;
    const writeOperation = vi.fn(() => new Promise((_resolve, reject) => { rejectWrite = reject; }));
    const client = createSettlementNameClient({
      getSnapshot: async () => viewportFixture(),
      writeOperation,
      socket,
    });
    await client.hydrate();
    const save = client.commit(leftTarget, { x: 510, y: 350 });
    await vi.waitFor(() => expect(writeOperation).toHaveBeenCalledTimes(1));
    socket.emit(EVENT, withOverride("left", "0067", { x: 510, y: 350 }, 1));
    rejectWrite(new Error("late transport failure"));
    await expect(save).resolves.toBeDefined();
    expect(client.getTarget(leftTarget).status).toBe("Saved");
    expect(client.getTarget(leftTarget).draft).toBeNull();
    client.destroy();
  });

  test("an external same-target change before release preserves the gesture baseline and conflicts", async () => {
    const socket = socketFixture();
    const writeOperation = vi.fn();
    const client = createSettlementNameClient({
      getSnapshot: async () => viewportFixture(),
      writeOperation,
      socket,
    });
    await client.hydrate();
    const baseline = baselineFixture(null, 0);
    socket.emit(EVENT, withOverride("left", "0067", { x: 1, y: 1 }, 1));
    const save = client.commit(leftTarget, { x: 510, y: 350 }, { baseline });
    expect(client.getTarget(leftTarget)).toMatchObject({
      acknowledged: { x: 1, y: 1 },
      draft: { x: 510, y: 350 },
      status: "Conflict",
      conflict: { value: { x: 1, y: 1 }, revision: 1 },
    });
    await expect(save).rejects.toMatchObject({ code: "conflict" });
    expect(writeOperation).not.toHaveBeenCalled();
    expect(client.getSnapshot().settings.outputs.right).toEqual({});
    expect(client.getSnapshot().settings.baseline.outputs.left["0067"]).toEqual({ x: 510, y: 350 });
    client.destroy();
  });

  test("an unrelated target event keeps the in-flight draft and the other output", async () => {
    const socket = socketFixture();
    const writeOperation = vi.fn(() => new Promise(() => {}));
    const client = createSettlementNameClient({
      getSnapshot: async () => viewportFixture(),
      writeOperation,
      socket,
    });
    await client.hydrate();
    const save = client.commit(leftTarget, { x: 510, y: 350 });
    await vi.waitFor(() => expect(writeOperation).toHaveBeenCalledTimes(1));
    const settings = settingsFixture();
    settings.outputs.left["0424"] = { x: 80, y: 90 };
    socket.emit(EVENT, changed(settings, 1));
    expect(client.getTarget(leftTarget)).toMatchObject({ draft: { x: 510, y: 350 }, status: "Saving" });
    expect(client.getTarget(otherTarget).acknowledged).toEqual({ x: 80, y: 90 });
    expect(client.getSnapshot().settings.outputs.right).toEqual({});
    expect(client.getSnapshot().settings.outputs.left["0067"]).toEqual({ x: 510, y: 350 });
    await expect(Promise.race([save, Promise.resolve("pending")])).resolves.toBe("pending");
    client.destroy();
  });

  test("serialized edits use the preceding acknowledged revision", async () => {
    let revision = 0;
    let settings = settingsFixture();
    const writeOperation = vi.fn(async (operation) => {
      expect(operation.baseRevision).toBe(revision);
      settings = structuredClone(settings);
      settings.outputs[operation.output][operation.citycode] = { ...operation.position };
      revision += 1;
      return {
        status: "ok",
        action: "set_settlement_names",
        settlementNameSettings: settings,
        settlementNameRevision: revision,
      };
    });
    const client = createSettlementNameClient({
      getSnapshot: async () => viewportFixture(),
      writeOperation,
    });
    await client.hydrate();
    await Promise.all([
      client.commit(leftTarget, { x: 11, y: 12 }),
      client.commit(otherTarget, { x: 21, y: 22 }),
    ]);
    expect(writeOperation.mock.calls.map(([intent]) => intent.baseRevision)).toEqual([0, 1]);
    expect(client.getTarget(leftTarget).status).toBe("Saved");
    expect(client.getTarget(otherTarget).acknowledged).toEqual({ x: 21, y: 22 });
    client.destroy();
  });

  test("registers numeric drafts synchronously and sends only the latest intent after 150ms", async () => {
    vi.useFakeTimers();
    const writeOperation = vi.fn(async (operation) => serverWriteFixture(operation));
    const client = createSettlementNameClient({
      getSnapshot: async () => viewportFixture(),
      writeOperation,
    });
    await client.hydrate();
    const first = client.commit(leftTarget, { x: 510, y: 350 }, { numeric: true });
    expect(client.getTarget(leftTarget)).toMatchObject({ draft: { x: 510, y: 350 }, status: "Saving" });
    expect(writeOperation).not.toHaveBeenCalled();
    const second = client.commit(leftTarget, { x: 520, y: 360 }, { numeric: true });
    const styleSave = client.commit(styleTarget, styleValue, { numeric: true });
    await vi.advanceTimersByTimeAsync(149);
    expect(writeOperation).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([first, second, styleSave]);
    expect(writeOperation).toHaveBeenCalledTimes(2);
    const positionWrite = writeOperation.mock.calls.map(([intent]) => intent).find((intent) => intent.operation === "position");
    const styleWrite = writeOperation.mock.calls.map(([intent]) => intent).find((intent) => intent.operation === "style");
    expect(positionWrite.position).toEqual({ x: 520, y: 360 });
    expect(styleWrite.style).toEqual(styleValue);
    client.destroy();
  });

  test("a stale numeric timer does not dispatch after a newer same-target save fails", async () => {
    vi.useFakeTimers();
    const writeOperation = vi.fn().mockRejectedValueOnce(new Error("save failed"));
    const client = createSettlementNameClient({
      getSnapshot: async () => viewportFixture(),
      writeOperation,
    });
    await client.hydrate();
    const numeric = client.commit(leftTarget, { x: 510, y: 350 }, { numeric: true });
    const numericSettled = numeric.then((value) => value, (error) => error);
    const newer = client.commit(leftTarget, { x: 520, y: 360 });
    await expect(newer).rejects.toThrow("save failed");
    expect(writeOperation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(150);
    await numericSettled;
    expect(writeOperation).toHaveBeenCalledTimes(1);
    expect(writeOperation.mock.calls[0][0]).toMatchObject({
      operation: "position",
      position: { x: 520, y: 360 },
    });
    expect(client.getTarget(leftTarget).draft).toEqual({ x: 520, y: 360 });
    client.destroy();
  });

  test("an output switch keeps each in-flight intent on its own target", async () => {
    let releaseLeft;
    const apply = accumulatingWriter();
    const writeOperation = vi.fn()
      .mockImplementationOnce((operation) => new Promise((resolve) => {
        releaseLeft = () => resolve(apply(operation));
      }))
      .mockImplementation((operation) => Promise.resolve(apply(operation)));
    const client = createSettlementNameClient({
      getSnapshot: async () => viewportFixture(),
      writeOperation,
    });
    await client.hydrate();
    const leftSave = client.commit(leftTarget, { x: 510, y: 350 });
    await vi.waitFor(() => expect(writeOperation).toHaveBeenCalledTimes(1));
    const rightSave = client.commit(rightTarget, { x: 800, y: 400 });
    expect(client.getTarget(leftTarget).draft).toEqual({ x: 510, y: 350 });
    expect(client.getTarget(rightTarget).draft).toEqual({ x: 800, y: 400 });
    releaseLeft();
    await leftSave;
    await rightSave;
    expect(writeOperation.mock.calls.map(([intent]) => intent.output)).toEqual(["left", "right"]);
    expect(writeOperation.mock.calls[1][0].baseRevision).toBe(1);
    expect(client.getTarget(leftTarget)).toMatchObject({ status: "Saved", acknowledged: { x: 510, y: 350 } });
    expect(client.getTarget(rightTarget).acknowledged).toEqual({ x: 800, y: 400 });
    client.destroy();
  });

  test("style and position drafts stay independent", async () => {
    let releasePosition;
    const apply = accumulatingWriter();
    const writeOperation = vi.fn()
      .mockImplementationOnce((operation) => new Promise((resolve) => {
        releasePosition = () => resolve(apply(operation));
      }))
      .mockImplementation((operation) => Promise.resolve(apply(operation)));
    const client = createSettlementNameClient({
      getSnapshot: async () => viewportFixture(),
      writeOperation,
    });
    await client.hydrate();
    const positionSave = client.commit(leftTarget, { x: 510, y: 350 });
    await vi.waitFor(() => expect(writeOperation).toHaveBeenCalledTimes(1));
    const styleSave = client.commit(styleTarget, styleValue);
    expect(client.getTarget(leftTarget).draft).toEqual({ x: 510, y: 350 });
    expect(client.getTarget(styleTarget).draft).toEqual(styleValue);
    expect(client.getSnapshot().settings.baseline).toEqual(settingsFixture().baseline);
    releasePosition();
    await positionSave;
    await styleSave;
    expect(client.getTarget(leftTarget).status).toBe("Saved");
    expect(client.getTarget(styleTarget).status).toBe("Saved");
    expect(client.getSnapshot().settings.style).toEqual(styleValue);
    expect(client.getSnapshot().settings.outputs.left["0067"]).toEqual({ x: 510, y: 350 });
    client.destroy();
  });

  test("hydrates once after a WebSocket reconnect", async () => {
    const socket = socketFixture();
    const getSnapshot = vi.fn(async () => viewportFixture());
    const client = createSettlementNameClient({ getSnapshot, writeOperation: vi.fn(), socket });
    await client.hydrate();
    socket.emit("connect");
    socket.emit("disconnect");
    socket.emit("connect");
    await vi.waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));
    expect(getSnapshot).toHaveBeenLastCalledWith({ forceFresh: true });
    client.destroy();
  });

  test("does not report Saved when the acknowledgement value differs from the draft", async () => {
    const writeOperation = vi.fn(async (operation) => ackFixture(operation.baseRevision + 1, {
      left: { "0067": { x: 1, y: 1 } },
    }));
    const client = createSettlementNameClient({
      getSnapshot: async () => viewportFixture(),
      writeOperation,
    });
    await client.hydrate();
    await expect(client.commit(leftTarget, { x: 510, y: 350 })).rejects.toThrow(/did not match/i);
    expect(client.getTarget(leftTarget).status).not.toBe("Saved");
    expect(client.getTarget(leftTarget).draft).toEqual({ x: 510, y: 350 });
    client.destroy();
  });

  test("missing initialization is a visible hydration error and blocks commits", async () => {
    const writeOperation = vi.fn();
    const client = createSettlementNameClient({
      getSnapshot: async () => ({ settlement_name_settings: {}, settlement_name_revision: 0 }),
      writeOperation,
    });
    await expect(client.hydrate()).rejects.toThrow(/Initialization required/);
    expect(client.getHydrationState()).toMatchObject({
      status: "Failed",
      error: expect.stringMatching(/Initialization required/),
    });
    expect(client.getSnapshot().settings).toBeNull();
    await expect(client.commit(leftTarget, { x: 1, y: 1 })).rejects.toThrow(/not loaded/i);
    expect(writeOperation).not.toHaveBeenCalled();
    client.destroy();
  });

  test("reset sends reset_position and does not disguise it as a position write", async () => {
    const writeOperation = vi.fn(async (operation) => serverWriteFixture(operation));
    const client = createSettlementNameClient({
      getSnapshot: async () => viewportFixture(),
      writeOperation,
    });
    await client.hydrate();
    await client.commit(leftTarget, { x: 9, y: 9 });
    await client.resetPosition("left", "0067", { baseline: baselineFixture({ x: 9, y: 9 }, 1) });
    expect(writeOperation.mock.calls[1][0]).toEqual({
      operation: "reset_position",
      output: "left",
      citycode: "0067",
      baseRevision: 1,
    });
    expect(writeOperation.mock.calls[1][0].position).toBeUndefined();
    expect(client.getTarget(leftTarget)).toMatchObject({ acknowledged: null, draft: null, status: "Saved" });
    client.destroy();
  });

  test("an in-flight position write keeps its captured operation when reset follows", async () => {
    let releaseFirst;
    const apply = accumulatingWriter();
    const writeOperation = vi.fn()
      .mockImplementationOnce((operation) => new Promise((resolve) => {
        releaseFirst = () => resolve(apply(operation));
      }))
      .mockImplementation((operation) => Promise.resolve(apply(operation)));
    const client = createSettlementNameClient({
      getSnapshot: async () => viewportFixture(),
      writeOperation,
    });
    await client.hydrate();
    const positionSave = client.commit(leftTarget, { x: 510, y: 350 });
    const resetSave = client.resetPosition("left", "0067");
    await vi.waitFor(() => expect(writeOperation).toHaveBeenCalledTimes(1));
    expect(writeOperation.mock.calls[0][0]).toEqual({
      operation: "position",
      output: "left",
      citycode: "0067",
      position: { x: 510, y: 350 },
      baseRevision: 0,
    });
    releaseFirst();
    await positionSave;
    await resetSave;
    expect(writeOperation.mock.calls[1][0]).toEqual({
      operation: "reset_position",
      output: "left",
      citycode: "0067",
      baseRevision: 1,
    });
    client.destroy();
  });

  test("Retry refreshes the current revision before reapplying the retained draft", async () => {
    const refreshed = settingsFixture();
    refreshed.outputs.left["0424"] = { x: 3, y: 4 };
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce(viewportFixture())
      .mockResolvedValueOnce({
        settlement_name_settings: refreshed,
        settlement_name_revision: 4,
      });
    const writeOperation = vi.fn()
      .mockRejectedValueOnce(new Error("lost response"))
      .mockImplementation(async (operation) => serverWriteFixture({ ...operation, baseRevision: operation.baseRevision }));
    const client = createSettlementNameClient({ getSnapshot, writeOperation });
    await client.hydrate();
    await expect(client.commit(leftTarget, { x: 17, y: 18 })).rejects.toThrow("lost response");
    expect(client.getTarget(leftTarget).status).toBe("Failed");
    await client.retry(leftTarget);
    expect(getSnapshot).toHaveBeenLastCalledWith({ forceFresh: true });
    expect(writeOperation).toHaveBeenCalledTimes(2);
    expect(writeOperation.mock.calls[1][0].baseRevision).toBe(4);
    expect(client.getTarget(leftTarget).status).toBe("Saved");
    expect(getSnapshot).toHaveBeenCalledTimes(2);
    client.destroy();
  });

  test("Load saved drops the draft and a pending numeric write", async () => {
    vi.useFakeTimers();
    const writeOperation = vi.fn(async (operation) => serverWriteFixture(operation));
    const client = createSettlementNameClient({
      getSnapshot: async () => viewportFixture(),
      writeOperation,
    });
    await client.hydrate();
    const pending = client.commit(leftTarget, { x: 510, y: 350 }, { numeric: true });
    expect(client.getTarget(leftTarget).draft).toEqual({ x: 510, y: 350 });
    client.loadSaved(leftTarget);
    expect(client.getTarget(leftTarget)).toMatchObject({ draft: null, status: "Saved", conflict: null });
    await vi.advanceTimersByTimeAsync(150);
    await expect(pending).resolves.toMatchObject({ status: "loaded" });
    expect(writeOperation).not.toHaveBeenCalled();
    client.destroy();
  });

  test("destroy removes this client's handlers and timers without closing the shared socket", async () => {
    vi.useFakeTimers();
    const socket = socketFixture();
    socket.disconnect = vi.fn();
    const writeOperation = vi.fn(async (operation) => serverWriteFixture(operation));
    const client = createSettlementNameClient({
      getSnapshot: async () => viewportFixture(),
      writeOperation,
      socket,
    });
    await client.hydrate();
    const pending = client.commit(leftTarget, { x: 510, y: 350 }, { numeric: true });
    client.destroy();
    expect(socket.off).toHaveBeenCalledWith(EVENT, expect.any(Function));
    expect(socket.disconnect).not.toHaveBeenCalled();
    socket.emit(EVENT, withOverride("left", "0067", { x: 9, y: 9 }, 1));
    await vi.advanceTimersByTimeAsync(150);
    await expect(pending).resolves.toBeUndefined();
    expect(writeOperation).not.toHaveBeenCalled();
    expect(client.getTarget(leftTarget).acknowledged).toBeNull();
  });

  test("closing the editor does not destroy the client", async () => {
    const socket = socketFixture();
    const client = createSettlementNameClient({
      getSnapshot: async () => viewportFixture(),
      writeOperation: vi.fn(),
      socket,
    });
    await client.hydrate();
    socket.emit(EVENT, withOverride("left", "0067", { x: 15, y: 16 }, 1));
    expect(client.getTarget(leftTarget).acknowledged).toEqual({ x: 15, y: 16 });
    expect(socket.off).not.toHaveBeenCalled();
    client.destroy();
    socket.emit(EVENT, withOverride("left", "0067", { x: 30, y: 31 }, 2));
    expect(client.getTarget(leftTarget).acknowledged).toEqual({ x: 15, y: 16 });
  });

  test("foreign-table events do not change revision or the next write base", async () => {
    const socket = socketFixture();
    const writeOperation = vi.fn(async (operation) => serverWriteFixture(operation));
    const client = createSettlementNameClient({
      tableName: "otef",
      getSnapshot: async () => viewportFixture(),
      writeOperation,
      socket,
    });
    await client.hydrate();
    socket.emit(EVENT, { ...withOverride("left", "0067", { x: 70, y: 70 }, 50), table: "another" });
    expect(client.getTarget(leftTarget).acknowledged).toBeNull();
    await client.commit(leftTarget, { x: 11, y: 12 });
    expect(writeOperation.mock.calls[0][0].baseRevision).toBe(0);
    client.destroy();
  });

  test("beforeunload warns only while this client has unsaved work", async () => {
    const listeners = new Map();
    globalThis.addEventListener = (type, callback) => listeners.set(type, callback);
    globalThis.removeEventListener = (type, callback) => {
      if (listeners.get(type) === callback) listeners.delete(type);
    };
    const writeOperation = vi.fn(async (operation) => serverWriteFixture(operation));
    const client = createSettlementNameClient({
      getSnapshot: async () => viewportFixture(),
      writeOperation,
    });
    await client.hydrate();
    const warn = () => {
      const event = { preventDefault: vi.fn(), returnValue: undefined };
      listeners.get("beforeunload")(event);
      return event;
    };
    expect(warn().preventDefault).not.toHaveBeenCalled();
    const save = client.commit(leftTarget, { x: 510, y: 350 });
    expect(warn().preventDefault).toHaveBeenCalled();
    await save;
    expect(warn().preventDefault).not.toHaveBeenCalled();
    client.destroy();
    expect(listeners.has("beforeunload")).toBe(false);
  });

  test("rejects empty, nonfinite, and boolean positions without sending them", async () => {
    const writeOperation = vi.fn();
    const client = createSettlementNameClient({
      getSnapshot: async () => viewportFixture(),
      writeOperation,
    });
    await client.hydrate();
    await expect(client.commit(leftTarget, { x: true, y: 1 })).rejects.toThrow(/position\.x/);
    await expect(client.commit(leftTarget, { x: Number.NaN, y: 1 })).rejects.toThrow(/position\.x/);
    await expect(client.commit(leftTarget, {})).rejects.toThrow(/position/);
    expect(writeOperation).not.toHaveBeenCalled();
    client.destroy();
  });

  test("warns for an offscreen position and still saves the captured coordinates", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const writeOperation = vi.fn(async (operation) => serverWriteFixture(operation));
    const client = createSettlementNameClient({
      getSnapshot: async () => viewportFixture(),
      writeOperation,
    });
    await client.hydrate();
    await client.commit(leftTarget, { x: -40, y: 350 });
    expect(writeOperation.mock.calls[0][0].position).toEqual({ x: -40, y: 350 });
    expect(warn.mock.calls.some((call) => String(call[0]).includes("offscreen") || String(call.join(" ")).includes("offscreen"))).toBe(true);
    client.destroy();
  });

  test("getTarget is immutable and preview drafts do not rewrite baseline", async () => {
    const client = createSettlementNameClient({
      getSnapshot: async () => viewportFixture(),
      writeOperation: vi.fn(() => new Promise(() => {})),
    });
    await client.hydrate();
    const save = client.commit(leftTarget, { x: 510, y: 350 });
    const target = client.getTarget(leftTarget);
    expect(Object.isFrozen(target)).toBe(true);
    expect(() => { target.draft.x = 1; }).toThrow();
    const preview = client.getSnapshot();
    expect(preview.settings.outputs.left["0067"]).toEqual({ x: 510, y: 350 });
    expect(preview.settings.baseline).toEqual(settingsFixture().baseline);
    await expect(Promise.race([save, Promise.resolve("pending")])).resolves.toBe("pending");
    client.destroy();
  });
});
