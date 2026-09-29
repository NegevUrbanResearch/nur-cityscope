import { afterEach, describe, expect, test, vi } from "vitest";
import { createClockLayoutClient } from "../../frontend/src/projection-config/clock-layout-client.js";

const clockLayout = (leftPct) => ({
  leftPct, topPct: 80, widthPct: 20, heightPct: 8, fontPx: 22, rotateDeg: 0,
});
const legendLayout = (leftPct) => ({ leftPct, topPct: 20, widthPct: 30, heightPct: 10, fontPx: 22, rotateDeg: 0, dwellSeconds: 8 });

function snapshot(overrides = {}) {
  return {
    nli_clock_layout: { gis: { start: clockLayout(10), nova: clockLayout(20) }, projection: { left: clockLayout(30) } },
    nli_clock_layout_revision: 0,
    legend_settings: { language: "he", projection: { left: legendLayout(40), full: legendLayout(30), right: legendLayout(60) }, summarizedGroupIds: ["g1"] },
    legend_layout_revision: 0,
    ...overrides,
  };
}

function socketHarness() {
  const listeners = new Map();
  return {
    on: vi.fn((type, callback) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    }),
    off: vi.fn((type, callback) => listeners.get(type)?.delete(callback)),
    emit(type, message) { for (const callback of listeners.get(type) || []) callback(message); },
    listeners,
  };
}

describe("clock layout client", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("serialized edits use the preceding acknowledged revision", async () => {
    const initial = snapshot();
    const layouts = structuredClone(initial.nli_clock_layout);
    let revision = 0;
    const writeClockSlot = vi.fn(async ({ surface, slot, layout, baseRevision }) => {
      expect(baseRevision).toBe(revision);
      layouts[surface][slot] = layout;
      return { status: "ok", action: "set_nli_clock_layout", nliClockLayout: structuredClone(layouts), nliClockLayoutRevision: ++revision };
    });
    const client = createClockLayoutClient({ getSnapshot: async () => initial, writeClockSlot });
    await client.hydrate();
    await Promise.all([
      client.commit("gisClock", "start", clockLayout(11)),
      client.commit("gisClock", "nova", clockLayout(21)),
    ]);
    expect(writeClockSlot.mock.calls.map(([intent]) => intent.baseRevision)).toEqual([0, 1]);
    expect(client.getSlot("gisClock", "nova").status).toBe("Saved");
    client.destroy();
  });

  test("keeps a gesture baseline and exposes a conflict when a newer event arrives before release", async () => {
    const socket = socketHarness();
    const client = createClockLayoutClient({ getSnapshot: async () => snapshot(), writeClockSlot: vi.fn(), socket });
    await client.hydrate();
    const baseline = { layout: client.getSlot("gisClock", "start").acknowledged, revision: 0 };
    socket.emit("otef_nli_clock_layout_changed", {
      nliClockLayout: { gis: { start: clockLayout(12), nova: clockLayout(20) }, projection: { left: clockLayout(30) } },
      nliClockLayoutRevision: 1,
    });
    const save = client.commit("gisClock", "start", clockLayout(15), { baseline });
    expect(client.getSlot("gisClock", "start")).toMatchObject({ status: "Conflict", conflict: { revision: 1 } });
    await expect(save).rejects.toMatchObject({ code: "conflict" });
    expect(client.getSlot("gisClock", "start").draft).toEqual(clockLayout(15));
    client.destroy();
  });

  test("accepts only monotonic snapshots and preserves dirty drafts on remote changes", async () => {
    const socket = socketHarness();
    const client = createClockLayoutClient({ getSnapshot: async () => snapshot(), writeClockSlot: vi.fn(), socket });
    await client.hydrate();
    const save = client.commit("gisClock", "nova", clockLayout(25));
    socket.emit("otef_nli_clock_layout_changed", {
      nliClockLayout: { gis: { start: clockLayout(13), nova: clockLayout(22) }, projection: { left: clockLayout(30) } },
      nliClockLayoutRevision: 2,
    });
    socket.emit("otef_nli_clock_layout_changed", {
      nliClockLayout: { gis: { start: clockLayout(1), nova: clockLayout(1) }, projection: { left: clockLayout(1) } },
      nliClockLayoutRevision: 1,
    });
    expect(client.getSlot("gisClock", "start").acknowledged).toEqual(clockLayout(13));
    expect(client.getSlot("gisClock", "nova")).toMatchObject({ draft: clockLayout(25), status: "Conflict" });
    await expect(save).rejects.toBeDefined();
    client.destroy();
  });

  test("merges legend metadata patches without replacing layout state", async () => {
    const socket = socketHarness();
    const client = createClockLayoutClient({ getSnapshot: async () => snapshot(), writeLegendSlot: vi.fn(), socket });
    await client.hydrate();
    const save = client.commit("projectionLegend", "left", legendLayout(45));
    socket.emit("otef_legend_settings_changed", { changeKind: "metadata", legendSettingsPatch: { language: "en" } });
    expect(client.getSlot("projectionLegend", "left").draft).toEqual(legendLayout(45));
    expect(client.getSlot("projectionLegend", "left").status).toBe("Saving");
    await expect(save).rejects.toBeDefined();
    client.destroy();
  });

  test("writes legend placements with the legend revision and accepts layout acknowledgments", async () => {
    const initial = snapshot();
    let projection = structuredClone(initial.legend_settings.projection);
    let revision = 0;
    const writeLegendSlot = vi.fn(async ({ span, layout, baseRevision }) => {
      expect(baseRevision).toBe(revision);
      projection[span] = layout;
      return { changeKind: "layout", legendProjection: structuredClone(projection), legendLayoutRevision: ++revision };
    });
    const client = createClockLayoutClient({ getSnapshot: async () => initial, writeLegendSlot });
    await client.hydrate();
    await client.commit("projectionLegend", "left", legendLayout(45));
    expect(writeLegendSlot).toHaveBeenCalledWith({ span: "left", layout: legendLayout(45), baseRevision: 0 });
    expect(client.getSlot("projectionLegend", "left").status).toBe("Saved");
    client.destroy();
  });

  test("registers numeric drafts synchronously and debounces each slot independently", async () => {
    vi.useFakeTimers();
    const writeClockSlot = vi.fn(async ({ surface, slot, layout, baseRevision }) => ({
      status: "ok", nliClockLayout: { gis: { start: clockLayout(slot === "start" ? layout.leftPct : 10), nova: clockLayout(slot === "nova" ? layout.leftPct : 20) }, projection: { left: clockLayout(30) } }, nliClockLayoutRevision: baseRevision + 1,
    }));
    const client = createClockLayoutClient({ getSnapshot: async () => snapshot(), writeClockSlot });
    await client.hydrate();
    const first = client.commit("gisClock", "start", clockLayout(14), { numeric: true });
    expect(client.getSlot("gisClock", "start")).toMatchObject({ draft: clockLayout(14), status: "Saving" });
    const second = client.commit("gisClock", "nova", clockLayout(24), { numeric: true });
    await vi.advanceTimersByTimeAsync(150);
    await Promise.all([first, second]);
    expect(writeClockSlot).toHaveBeenCalledTimes(2);
    client.destroy();
  });

  test("matching layout event acknowledges a save before a late HTTP failure", async () => {
    const socket = socketHarness();
    let rejectWrite;
    const writeClockSlot = vi.fn(() => new Promise((_resolve, reject) => { rejectWrite = reject; }));
    const client = createClockLayoutClient({ getSnapshot: async () => snapshot(), writeClockSlot, socket });
    await client.hydrate();
    const save = client.commit("gisClock", "start", clockLayout(16));
    await vi.waitFor(() => expect(writeClockSlot).toHaveBeenCalledTimes(1));
    socket.emit("otef_nli_clock_layout_changed", {
      sourceId: "local", nliClockLayout: { gis: { start: clockLayout(16), nova: clockLayout(20) }, projection: { left: clockLayout(30) } },
      nliClockLayoutRevision: 1,
    });
    rejectWrite(new Error("late transport failure"));
    await expect(save).resolves.toBeDefined();
    expect(client.getSlot("gisClock", "start").status).toBe("Saved");
    client.destroy();
  });

  test("refreshes once when an equal revision carries a different snapshot", async () => {
    const socket = socketHarness();
    const initial = snapshot();
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(snapshot({
        nli_clock_layout: { gis: { start: clockLayout(14), nova: clockLayout(20) }, projection: { left: clockLayout(30) } },
        nli_clock_layout_revision: 0,
      }));
    const client = createClockLayoutClient({ getSnapshot, writeClockSlot: vi.fn(), socket });
    await client.hydrate();
    socket.emit("otef_nli_clock_layout_changed", {
      nliClockLayout: { gis: { start: clockLayout(13), nova: clockLayout(20) }, projection: { left: clockLayout(30) } },
      nliClockLayoutRevision: 0,
    });
    await vi.waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));
    expect(getSnapshot).toHaveBeenLastCalledWith({ forceFresh: true });
    expect(client.getSlot("gisClock", "start").acknowledged).toEqual(clockLayout(14));
    client.destroy();
  });

  test("hydrates once after a WebSocket reconnect", async () => {
    const socket = socketHarness();
    const getSnapshot = vi.fn(async () => snapshot());
    const client = createClockLayoutClient({ getSnapshot, writeClockSlot: vi.fn(), socket });
    await client.hydrate();
    socket.emit("connect");
    socket.emit("disconnect");
    socket.emit("connect");
    await vi.waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(2));
    expect(getSnapshot).toHaveBeenLastCalledWith({ forceFresh: true });
    client.destroy();
  });

  test("an earlier same-slot acknowledgment advances the queued draft baseline", async () => {
    const socket = socketHarness();
    let finishFirst;
    let calls = 0;
    const layouts = { gis: { start: clockLayout(10), nova: clockLayout(20) }, projection: { left: clockLayout(30) } };
    const writeClockSlot = vi.fn(({ slot, layout, baseRevision }) => {
      calls += 1;
      if (calls === 1) return new Promise((resolve) => { finishFirst = () => resolve({ status: "ok", nliClockLayout: structuredClone(layouts), nliClockLayoutRevision: baseRevision + 1 }); });
      expect(baseRevision).toBe(1);
      layouts.gis[slot] = layout;
      return Promise.resolve({ status: "ok", nliClockLayout: structuredClone(layouts), nliClockLayoutRevision: baseRevision + 1 });
    });
    const client = createClockLayoutClient({ getSnapshot: async () => snapshot(), writeClockSlot, socket });
    await client.hydrate();
    const first = client.commit("gisClock", "start", clockLayout(11));
    await vi.waitFor(() => expect(writeClockSlot).toHaveBeenCalledTimes(1));
    const second = client.commit("gisClock", "start", clockLayout(12));
    const nextSnapshot = structuredClone(layouts);
    nextSnapshot.gis.start = clockLayout(11);
    socket.emit("otef_nli_clock_layout_changed", { nliClockLayout: nextSnapshot, nliClockLayoutRevision: 1 });
    finishFirst();
    await first;
    await second;
    expect(writeClockSlot.mock.calls.map(([intent]) => intent.baseRevision)).toEqual([0, 1]);
    expect(client.getSlot("gisClock", "start").acknowledged).toEqual(clockLayout(12));
    client.destroy();
  });

  test("a conflicting event releases an in-flight save and keeps its draft", async () => {
    const socket = socketHarness();
    const writeClockSlot = vi.fn(() => new Promise(() => {}));
    const client = createClockLayoutClient({ getSnapshot: async () => snapshot(), writeClockSlot, socket });
    await client.hydrate();
    const save = client.commit("gisClock", "start", clockLayout(17));
    await vi.waitFor(() => expect(writeClockSlot).toHaveBeenCalledTimes(1));
    socket.emit("otef_nli_clock_layout_changed", {
      nliClockLayout: { gis: { start: clockLayout(19), nova: clockLayout(20) }, projection: { left: clockLayout(30) } },
      nliClockLayoutRevision: 1,
    });
    await expect(save).rejects.toMatchObject({ code: "conflict" });
    expect(client.getSlot("gisClock", "start")).toMatchObject({
      acknowledged: clockLayout(19), draft: clockLayout(17), status: "Conflict",
      conflict: { layout: clockLayout(19), revision: 1 },
    });
    client.destroy();
  });

  test.each([false, true])("keeps Conflict across a completed edit after an in-flight conflict (numeric=%s)", async (numeric) => {
    const socket = socketHarness();
    const writeClockSlot = vi.fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementation(async ({ layout, baseRevision }) => ({
        status: "ok", nliClockLayout: { ...snapshot().nli_clock_layout, gis: { start: layout, nova: clockLayout(20) } },
        nliClockLayoutRevision: baseRevision + 1,
      }));
    const client = createClockLayoutClient({ getSnapshot: async () => snapshot(), writeClockSlot, socket });
    await client.hydrate();
    const first = client.commit("gisClock", "start", clockLayout(17));
    await vi.waitFor(() => expect(writeClockSlot).toHaveBeenCalledTimes(1));
    socket.emit("otef_nli_clock_layout_changed", {
      nliClockLayout: { ...snapshot().nli_clock_layout, gis: { start: clockLayout(19), nova: clockLayout(20) } },
      nliClockLayoutRevision: 1,
    });
    await expect(first).rejects.toMatchObject({ code: "conflict" });
    const generation = client.getSlot("gisClock", "start").generation;
    if (numeric) vi.useFakeTimers();
    const edit = client.commit("gisClock", "start", clockLayout(18), {
      numeric, baseline: { layout: clockLayout(19), revision: 1 },
    });
    const settled = edit.then((value) => ({ value }), (error) => ({ error }));
    const completed = client.getSlot("gisClock", "start");
    if (numeric) await vi.advanceTimersByTimeAsync(150);
    expect((await settled).error).toMatchObject({ code: "conflict" });
    expect(completed).toMatchObject({
      draft: clockLayout(18), status: "Conflict", generation: generation + 1,
      conflict: { layout: clockLayout(19), revision: 1 },
    });
    expect(writeClockSlot).toHaveBeenCalledTimes(1);
    // Returning to the original target does not replace the explicit decision.
    socket.emit("otef_nli_clock_layout_changed", {
      nliClockLayout: snapshot().nli_clock_layout, nliClockLayoutRevision: 2,
    });
    const laterEdit = client.commit("gisClock", "start", clockLayout(21));
    await expect(laterEdit).rejects.toMatchObject({ code: "conflict" });
    expect(client.getSlot("gisClock", "start")).toMatchObject({
      acknowledged: clockLayout(10), draft: clockLayout(21), status: "Conflict",
      conflict: { layout: clockLayout(10), revision: 2 },
    });
    expect(writeClockSlot).toHaveBeenCalledTimes(1);
    client.loadSaved("gisClock", "start");
    expect(client.getSlot("gisClock", "start")).toMatchObject({ acknowledged: clockLayout(10), draft: null, status: "Saved", conflict: null });
    client.destroy();
  });

  test("Retry captures the latest server target and conflicts if that target changes again before dispatch", async () => {
    const socket = socketHarness();
    const writeClockSlot = vi.fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementation(async ({ layout, baseRevision }) => ({
        status: "ok", nliClockLayout: { ...snapshot().nli_clock_layout, gis: { start: layout, nova: clockLayout(20) } },
        nliClockLayoutRevision: baseRevision + 1,
      }));
    const client = createClockLayoutClient({ getSnapshot: async () => snapshot(), writeClockSlot, socket });
    await client.hydrate();
    const save = client.commit("gisClock", "start", clockLayout(17));
    await vi.waitFor(() => expect(writeClockSlot).toHaveBeenCalledTimes(1));
    socket.emit("otef_nli_clock_layout_changed", {
      nliClockLayout: { ...snapshot().nli_clock_layout, gis: { start: clockLayout(19), nova: clockLayout(20) } },
      nliClockLayoutRevision: 1,
    });
    await expect(save).rejects.toMatchObject({ code: "conflict" });
    const retry = client.retry("gisClock", "start");
    socket.emit("otef_nli_clock_layout_changed", { nliClockLayout: snapshot().nli_clock_layout, nliClockLayoutRevision: 2 });
    await expect(retry).rejects.toMatchObject({ code: "conflict" });
    expect(writeClockSlot).toHaveBeenCalledTimes(1);
    expect(client.getSlot("gisClock", "start")).toMatchObject({ acknowledged: clockLayout(10), draft: clockLayout(17), status: "Conflict" });
    client.destroy();
  });

  test.each(["reconnect", "equal revision"])("reports a failed %s read and retains the draft", async (readKind) => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = new Error("state GET unavailable");
    const socket = socketHarness();
    const getSnapshot = vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(error).mockResolvedValue(snapshot());
    const client = createClockLayoutClient({
      getSnapshot, writeClockSlot: async () => { throw new Error("save unavailable"); }, socket,
    });
    await client.hydrate();
    await expect(client.commit("gisClock", "start", clockLayout(17))).rejects.toThrow("save unavailable");
    const before = client.getSlot("gisClock", "start");
    const requestRead = () => {
      if (readKind === "reconnect") {
        socket.emit("disconnect");
        socket.emit("connect");
      } else {
        socket.emit("otef_nli_clock_layout_changed", {
          nliClockLayout: { ...snapshot().nli_clock_layout, gis: { start: clockLayout(19), nova: clockLayout(20) } },
          nliClockLayoutRevision: 0,
        });
      }
    };
    requestRead();
    await vi.waitFor(() => expect(warning).toHaveBeenCalledWith(expect.stringContaining("[ClockLayoutClient]"), error));
    expect(client.getSlot("gisClock", "start")).toEqual(before);
    requestRead();
    await vi.waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(3));
    expect(getSnapshot).toHaveBeenLastCalledWith({ forceFresh: true });
    client.destroy();
  });

  test("retry uses the latest server revision and loadSaved discards the draft", async () => {
    const socket = socketHarness();
    let writes = 0;
    const writeClockSlot = vi.fn(({ slot, layout, baseRevision }) => {
      writes += 1;
      if (writes === 1) return new Promise(() => {});
      return Promise.resolve({
        status: "ok",
        nliClockLayout: { gis: { start: layout, nova: clockLayout(20) }, projection: { left: clockLayout(30) } },
        nliClockLayoutRevision: baseRevision + 1,
      });
    });
    const client = createClockLayoutClient({ getSnapshot: async () => snapshot(), writeClockSlot, socket });
    await client.hydrate();
    const save = client.commit("gisClock", "start", clockLayout(18));
    await vi.waitFor(() => expect(writeClockSlot).toHaveBeenCalledTimes(1));
    socket.emit("otef_nli_clock_layout_changed", {
      nliClockLayout: { gis: { start: clockLayout(19), nova: clockLayout(20) }, projection: { left: clockLayout(30) } },
      nliClockLayoutRevision: 1,
    });
    await expect(save).rejects.toMatchObject({ code: "conflict" });
    await client.retry("gisClock", "start");
    expect(writeClockSlot.mock.calls.map(([intent]) => intent.baseRevision)).toEqual([0, 1]);
    expect(client.getSlot("gisClock", "start").status).toBe("Saved");
    client.commit("gisClock", "start", clockLayout(22));
    client.loadSaved("gisClock", "start");
    expect(client.getSlot("gisClock", "start")).toMatchObject({ draft: null, status: "Saved" });
    client.destroy();
  });
});
