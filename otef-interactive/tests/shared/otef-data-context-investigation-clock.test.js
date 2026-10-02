import { beforeEach, describe, expect, test, vi } from "vitest";
import { INVESTIGATION_LINES_FULL_ID } from "../../frontend/src/shared/nli-investigation-beats.js";

function wireClock(overrides = {}) {
  return {
    phase: "paused",
    membership: [INVESTIGATION_LINES_FULL_ID],
    beats: [400, 420],
    loop: false,
    positionMs: 3200,
    anchorMs: 24_000,
    seekKind: "jump",
    revision: 4,
    serverNowMs: 25_000,
    ...overrides,
  };
}

describe("OTEFDataContext investigation clock", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  test("hydrate sets clock from GET investigation_clock", async () => {
    vi.spyOn(Date, "now").mockReturnValue(20_000);
    const { applyStateFromApi } = await import(
      "../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js"
    );
    const { default: OTEFDataContext } = await import(
      "../../frontend/src/shared/OTEFDataContext.js"
    );
    const wire = wireClock();

    applyStateFromApi(OTEFDataContext, { investigation_clock: wire }, { notify: false });

    expect(OTEFDataContext.getInvestigationClock()).toMatchObject({
      phase: "paused",
      membership: [INVESTIGATION_LINES_FULL_ID],
      beats: [400, 420],
      positionMs: 3200,
      seekKind: "jump",
      revision: 4,
      serverNowMs: 25_000,
    });
    expect(OTEFDataContext.getClockOffsetMs()).toBe(5_000);
  });

  test("WS ignores equal or older revision", async () => {
    const websocket = await import(
      "../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js"
    );
    const { default: OTEFDataContext } = await import(
      "../../frontend/src/shared/OTEFDataContext.js"
    );
    OTEFDataContext._setInvestigationClock(wireClock({ revision: 4, phase: "paused", positionMs: 3200 }));

    expect(typeof websocket.applyInvestigationClockIfNewer).toBe("function");

    websocket.applyInvestigationClockIfNewer(
      OTEFDataContext,
      wireClock({ revision: 4, phase: "playing", positionMs: 0, seekKind: "none" }),
    );
    expect(OTEFDataContext.getInvestigationClock()).toMatchObject({
      phase: "paused",
      revision: 4,
      positionMs: 3200,
    });

    websocket.applyInvestigationClockIfNewer(
      OTEFDataContext,
      wireClock({ revision: 3, phase: "playing", positionMs: 0 }),
    );
    expect(OTEFDataContext.getInvestigationClock()).toMatchObject({
      phase: "paused",
      revision: 4,
      positionMs: 3200,
    });
  });

  test("WS applies a newer revision", async () => {
    vi.spyOn(Date, "now").mockReturnValue(20_000);
    const websocket = await import(
      "../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js"
    );
    const { default: OTEFDataContext } = await import(
      "../../frontend/src/shared/OTEFDataContext.js"
    );
    OTEFDataContext._setInvestigationClock(wireClock({ revision: 4, phase: "paused" }));

    websocket.applyInvestigationClockIfNewer(
      OTEFDataContext,
      wireClock({
        revision: 5,
        phase: "playing",
        positionMs: 0,
        anchorMs: 1_000,
        seekKind: "none",
        serverNowMs: 21_000,
      }),
    );

    expect(OTEFDataContext.getInvestigationClock()).toMatchObject({
      phase: "playing",
      revision: 5,
      positionMs: 0,
    });
    expect(OTEFDataContext.getClockOffsetMs()).toBe(1_000);
  });

  test("PATCH queue serializes so one clock patch is in flight", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    expect(typeof api.OTEF_API.updateInvestigationClock).toBe("function");

    let inflight = 0;
    let maxInflight = 0;
    const gates = [];
    vi.spyOn(api.OTEF_API, "updateInvestigationClock").mockImplementation(async (_table, clock) => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((resolve) => {
        gates.push(resolve);
      });
      inflight -= 1;
      return {
        investigation_clock: {
          ...clock,
          revision: (Number(clock?.revision) || 0) + 1,
          serverNowMs: 9_000,
        },
      };
    });

    const { default: OTEFDataContext } = await import(
      "../../frontend/src/shared/OTEFDataContext.js"
    );
    OTEFDataContext._tableName = "otef";
    OTEFDataContext._clientId = "clock-client";

    const first = wireClock({ phase: "playing", revision: 1, seekKind: "none", positionMs: 0, anchorMs: 100 });
    const second = wireClock({ phase: "paused", revision: 1, positionMs: 3200 });
    const p1 = OTEFDataContext.patchInvestigationClock(first);
    const p2 = OTEFDataContext.patchInvestigationClock(second);

    await Promise.resolve();
    await Promise.resolve();
    expect(api.OTEF_API.updateInvestigationClock).toHaveBeenCalledTimes(1);
    expect(maxInflight).toBe(1);

    gates[0]();
    await p1;
    await vi.waitFor(() => {
      expect(api.OTEF_API.updateInvestigationClock).toHaveBeenCalledTimes(2);
    });
    expect(maxInflight).toBe(1);

    gates[1]();
    await p2;
    expect(maxInflight).toBe(1);
    expect(OTEFDataContext.getInvestigationClock().phase).toBe("paused");
  });

  test("PATCH applies investigation_clock from the response", async () => {
    vi.spyOn(Date, "now").mockReturnValue(40_000);
    const api = await import("../../frontend/src/shared/api-client.js");
    const requested = wireClock({ phase: "paused", revision: 8 });
    vi.spyOn(api.OTEF_API, "updateInvestigationClock").mockResolvedValue({
      investigation_clock: {
        ...requested,
        revision: 9,
        serverNowMs: 41_000,
      },
    });

    const { default: OTEFDataContext } = await import(
      "../../frontend/src/shared/OTEFDataContext.js"
    );
    OTEFDataContext._tableName = "otef";
    OTEFDataContext._clientId = "clock-client";

    const result = await OTEFDataContext.patchInvestigationClock(requested);
    expect(result).toMatchObject({ ok: true, clock: { phase: "paused", revision: 9 } });

    expect(api.OTEF_API.updateInvestigationClock.mock.calls[0][1]).not.toHaveProperty(
      "serverNowMs",
    );
    expect(api.OTEF_API.updateInvestigationClock).toHaveBeenCalledWith(
      "otef",
      expect.objectContaining({ phase: "paused" }),
      expect.objectContaining({ sourceId: "clock-client" }),
    );
    expect(OTEFDataContext.getInvestigationClock()).toMatchObject({
      phase: "paused",
      revision: 9,
    });
    expect(OTEFDataContext.getClockOffsetMs()).toBe(1_000);
  });

  test("updateInvestigationClock PATCHes investigation_clock with sourceId", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    const { OTEF_API } = await import("../../frontend/src/shared/api-client.js");
    const clock = { phase: "idle", loop: true, serverNowMs: 1234 };

    await OTEF_API.updateInvestigationClock("otef", clock, {
      sourceId: "remote-1",
      timestamp: 42,
    });

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.investigation_clock).toEqual({ phase: "idle", loop: true });
    expect(body.sourceId).toBe("remote-1");
    expect(body.timestamp).toBe(42);
  });

  test("a matching clock acknowledgement returns the adopted clock", async () => {
    vi.spyOn(Date, "now").mockReturnValue(40_000);
    const api = await import("../../frontend/src/shared/api-client.js");
    const requested = wireClock({
      phase: "playing",
      revision: 8,
      positionMs: 0,
      anchorMs: 1,
      seekKind: "none",
    });
    vi.spyOn(api.OTEF_API, "updateInvestigationClock").mockResolvedValue({
      investigation_clock: {
        ...requested,
        revision: 9,
        serverNowMs: 41_000,
      },
    });
    const { default: OTEFDataContext } = await import(
      "../../frontend/src/shared/OTEFDataContext.js"
    );
    OTEFDataContext._tableName = "otef";
    OTEFDataContext._clientId = "clock-client";

    const result = await OTEFDataContext.patchInvestigationClock(requested);

    expect(result).toMatchObject({
      ok: true,
      clock: { phase: "playing", revision: 9, positionMs: 0, serverNowMs: 41_000 },
    });
    expect(api.OTEF_API.updateInvestigationClock.mock.calls[0][1]).not.toHaveProperty("isCurrent");
    expect(api.OTEF_API.updateInvestigationClock.mock.calls[0][2]).not.toHaveProperty("isCurrent");
    expect(OTEFDataContext.getInvestigationClock()).toMatchObject({ phase: "playing", revision: 9 });
  });

  test("missing table fails the clock patch without a request", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const update = vi.spyOn(api.OTEF_API, "updateInvestigationClock");
    const actions = await import(
      "../../frontend/src/shared/otef-data-context/OTEFDataContext-actions.js"
    );
    const { default: OTEFDataContext } = await import(
      "../../frontend/src/shared/OTEFDataContext.js"
    );
    OTEFDataContext._tableName = "";

    const missingTable = await OTEFDataContext.patchInvestigationClock(wireClock());
    const missingContext = await actions.patchInvestigationClock(null, wireClock()).catch((error) => error);

    expect(missingTable).toEqual({ ok: false, error: "Missing table" });
    expect(missingContext).toEqual({ ok: false, error: "Missing table" });
    expect(update).not.toHaveBeenCalled();
  });

  test("an absent response clock is not success when the phase already matches", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    vi.spyOn(api.OTEF_API, "updateInvestigationClock").mockResolvedValue({});
    const { default: OTEFDataContext } = await import(
      "../../frontend/src/shared/OTEFDataContext.js"
    );
    OTEFDataContext._tableName = "otef";
    OTEFDataContext._clientId = "clock-client";
    const requested = wireClock({ phase: "playing", revision: 4, positionMs: 0, anchorMs: 1, seekKind: "none" });
    OTEFDataContext._setInvestigationClock(requested);

    const result = await OTEFDataContext.patchInvestigationClock(requested);

    expect(result?.ok).toBe(false);
    expect(result?.stale).not.toBe(true);
    expect(OTEFDataContext.getInvestigationClock().revision).toBe(4);
  });

  test("a malformed or mismatched response clock is not applied", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const requested = wireClock({ phase: "playing", revision: 4, positionMs: 0, anchorMs: 1, seekKind: "none" });
    vi.spyOn(api.OTEF_API, "updateInvestigationClock").mockResolvedValue({
      investigation_clock: { phase: "paused", revision: 9, serverNowMs: 41_000 },
    });
    const { default: OTEFDataContext } = await import(
      "../../frontend/src/shared/OTEFDataContext.js"
    );
    OTEFDataContext._tableName = "otef";
    OTEFDataContext._clientId = "clock-client";
    OTEFDataContext._setInvestigationClock(wireClock({ phase: "idle", revision: 1 }));

    const result = await OTEFDataContext.patchInvestigationClock(requested);

    expect(result?.ok).toBe(false);
    expect(OTEFDataContext.getInvestigationClock()).toMatchObject({ phase: "idle", revision: 1 });
  });

  test("a narrative change during the request makes the old clock stale", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: OTEFDataContext } = await import(
      "../../frontend/src/shared/OTEFDataContext.js"
    );
    const requested = wireClock({ phase: "playing", revision: 4, positionMs: 0, anchorMs: 1, seekKind: "none" });
    vi.spyOn(api.OTEF_API, "updateInvestigationClock").mockImplementation(async () => {
      OTEFDataContext._narrativeState = { id: "nova", transition: "enter", revision: 3 };
      return { investigation_clock: { ...requested, revision: 5, serverNowMs: 9_000 } };
    });
    OTEFDataContext._tableName = "otef";
    OTEFDataContext._clientId = "clock-client";
    OTEFDataContext._narrativeState = { id: "segev", transition: "enter", revision: 2 };
    OTEFDataContext._setInvestigationClock(wireClock({ phase: "idle", revision: 1 }));

    const result = await OTEFDataContext.patchInvestigationClock(requested);

    expect(result).toMatchObject({ ok: false, stale: true });
    expect(OTEFDataContext.getInvestigationClock()).toMatchObject({ phase: "idle", revision: 1 });
  });

  test("a newer incompatible clock adopted during the request is stale", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: OTEFDataContext } = await import(
      "../../frontend/src/shared/OTEFDataContext.js"
    );
    const requested = wireClock({ phase: "playing", revision: 4, positionMs: 0, anchorMs: 1, seekKind: "none" });
    vi.spyOn(api.OTEF_API, "updateInvestigationClock").mockImplementation(async () => {
      OTEFDataContext._setInvestigationClock(wireClock({
        phase: "paused",
        revision: 20,
        positionMs: 10,
        anchorMs: 2,
        seekKind: "jump",
      }));
      return { investigation_clock: { ...requested, revision: 21, serverNowMs: 9_000 } };
    });
    OTEFDataContext._tableName = "otef";
    OTEFDataContext._clientId = "clock-client";
    OTEFDataContext._setInvestigationClock(wireClock({ phase: "idle", revision: 1 }));

    const result = await OTEFDataContext.patchInvestigationClock(requested);

    expect(result).toMatchObject({ ok: false, stale: true });
    expect(OTEFDataContext.getInvestigationClock()).toMatchObject({ phase: "paused", revision: 20 });
  });

  test("a matching websocket clock adopted before HTTP is success", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const { default: OTEFDataContext } = await import(
      "../../frontend/src/shared/OTEFDataContext.js"
    );
    const requested = wireClock({ phase: "playing", revision: 4, positionMs: 0, anchorMs: 1, seekKind: "none" });
    vi.spyOn(api.OTEF_API, "updateInvestigationClock").mockImplementation(async () => {
      OTEFDataContext._setInvestigationClock({ ...requested, revision: 8, serverNowMs: 70_000 });
      return {};
    });
    OTEFDataContext._tableName = "otef";
    OTEFDataContext._clientId = "clock-client";
    OTEFDataContext._setInvestigationClock(wireClock({ phase: "idle", revision: 1 }));

    const result = await OTEFDataContext.patchInvestigationClock(requested);

    expect(result).toMatchObject({
      ok: true,
      clock: { phase: "playing", revision: 8, positionMs: 0, serverNowMs: 70_000 },
    });
  });

  test("a failed HTTP clock patch is not success", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const failure = new Error("offline");
    vi.spyOn(api.OTEF_API, "updateInvestigationClock").mockRejectedValue(failure);
    const { default: OTEFDataContext } = await import(
      "../../frontend/src/shared/OTEFDataContext.js"
    );
    OTEFDataContext._tableName = "otef";
    OTEFDataContext._clientId = "clock-client";

    const result = await OTEFDataContext.patchInvestigationClock(wireClock()).catch((error) => error);

    expect(result?.ok).toBe(false);
    expect(result?.error).toBe(failure);
  });

  test("a stale predicate skips the send and a queued predicate is checked before send", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    const resolvers = [];
    const update = vi.spyOn(api.OTEF_API, "updateInvestigationClock").mockImplementation(
      () => new Promise((resolve) => {
        resolvers.push(resolve);
      }),
    );
    const { default: OTEFDataContext } = await import(
      "../../frontend/src/shared/OTEFDataContext.js"
    );
    OTEFDataContext._tableName = "otef";
    OTEFDataContext._clientId = "clock-client";
    const firstClock = wireClock({ phase: "playing", revision: 1, positionMs: 0, anchorMs: 1, seekKind: "none" });
    const secondClock = wireClock({
      phase: "idle",
      revision: 1,
      membership: [],
      beats: [],
      positionMs: 0,
      anchorMs: null,
    });

    const skipped = OTEFDataContext.patchInvestigationClock(firstClock, { isCurrent: () => false });
    await Promise.resolve();
    expect(update).not.toHaveBeenCalled();
    await expect(skipped).resolves.toMatchObject({ ok: false, stale: true });

    const first = OTEFDataContext.patchInvestigationClock(firstClock);
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    let secondCurrent = true;
    const second = OTEFDataContext.patchInvestigationClock(secondClock, {
      isCurrent: () => secondCurrent,
    });
    secondCurrent = false;
    resolvers[0]({
      investigation_clock: { ...firstClock, revision: 2, serverNowMs: 9_000 },
    });
    await first;
    if (resolvers[1]) {
      resolvers[1]({
        investigation_clock: { ...secondClock, revision: 3, serverNowMs: 9_000 },
      });
    }
    const queued = await second;

    expect(update).toHaveBeenCalledTimes(1);
    expect(queued).toMatchObject({ ok: false, stale: true });
    expect(OTEFDataContext.getInvestigationClock()).toMatchObject({ phase: "playing", revision: 2 });
  });

  test("clock layout starts with empty nova explainer maps", async () => {
    const { default: OTEFDataContext } = await import(
      "../../frontend/src/shared/OTEFDataContext.js"
    );
    expect(OTEFDataContext.getNliClockLayout()).toEqual({
      gis: {},
      projection: {},
      gisOverlays: { novaExplainers: { close: {}, wide: {} } },
    });
  });

  test("HTTP snapshot and a newer clock-layout event retain distinct nova maps", async () => {
    vi.doMock("../../frontend/src/shared/websocket-client.js", () => ({
      OTEFWebSocketClient: class {
        constructor() { this.listeners = new Map(); }
        on(type, callback) { this.listeners.set(type, callback); }
        connect() {}
        disconnect() {}
      },
    }));
    const websocket = await import(
      "../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js"
    );
    const { default: OTEFDataContext } = await import(
      "../../frontend/src/shared/OTEFDataContext.js"
    );
    OTEFDataContext._tableName = "otef";
    const httpLayout = {
      gis: {},
      projection: {},
      gisOverlays: {
        novaExplainers: {
          close: { "100": { leftPct: 12.5, topPct: 20 }, "107": { leftPct: 1, topPct: 1 } },
          wide: { "104": { leftPct: 8, topPct: 18 } },
        },
      },
    };
    websocket.applyStateFromApi(OTEFDataContext, {
      nli_clock_layout: httpLayout,
      nli_clock_layout_revision: 2,
    });
    expect(OTEFDataContext.getNliClockLayout().gisOverlays.novaExplainers).toEqual({
      close: { "100": { leftPct: 12.5, topPct: 20 } },
      wide: { "104": { leftPct: 8, topPct: 18 } },
    });

    websocket.setupWebSocket(OTEFDataContext);
    const newer = {
      gis: {},
      projection: {},
      gisOverlays: {
        novaExplainers: {
          close: { "100": { leftPct: 3, topPct: 4 } },
          wide: { "100": { leftPct: 9, topPct: 10 } },
        },
      },
    };
    OTEFDataContext._wsClient.listeners.get("otef_nli_clock_layout_changed")({
      table: "otef",
      nliClockLayout: newer,
      nliClockLayoutRevision: 3,
    });
    expect(OTEFDataContext.getNliClockLayout().gisOverlays.novaExplainers).toEqual({
      close: { "100": { leftPct: 3, topPct: 4 } },
      wide: { "100": { leftPct: 9, topPct: 10 } },
    });
    OTEFDataContext._wsClient.listeners.get("otef_nli_clock_layout_changed")({
      table: "otef",
      nliClockLayout: httpLayout,
      nliClockLayoutRevision: 2,
    });
    expect(OTEFDataContext.getNliClockLayout().gisOverlays.novaExplainers.close["100"].leftPct).toBe(3);
    expect(OTEFDataContext.getNliClockLayout().gisOverlays.novaExplainers.wide["100"].topPct).toBe(10);
  });
});
