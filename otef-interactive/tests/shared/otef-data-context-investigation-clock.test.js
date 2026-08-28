import { beforeEach, describe, expect, test, vi } from "vitest";
import { INVESTIGATION_LINES_FULL_ID } from "../../frontend/src/shared/nli-investigation-beats.js";

function wireClock(overrides = {}) {
  return {
    phase: "paused",
    membership: [INVESTIGATION_LINES_FULL_ID],
    beats: [400, 420],
    loop: false,
    beatIndex: 1,
    beatElapsedMs: 0,
    playEpochMs: null,
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
      beatIndex: 1,
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
    OTEFDataContext._setInvestigationClock(wireClock({ revision: 4, phase: "paused", beatIndex: 1 }));

    expect(typeof websocket.applyInvestigationClockIfNewer).toBe("function");

    websocket.applyInvestigationClockIfNewer(
      OTEFDataContext,
      wireClock({ revision: 4, phase: "playing", beatIndex: 0, seekKind: "none" }),
    );
    expect(OTEFDataContext.getInvestigationClock()).toMatchObject({
      phase: "paused",
      revision: 4,
      beatIndex: 1,
    });

    websocket.applyInvestigationClockIfNewer(
      OTEFDataContext,
      wireClock({ revision: 3, phase: "playing", beatIndex: 0 }),
    );
    expect(OTEFDataContext.getInvestigationClock()).toMatchObject({
      phase: "paused",
      revision: 4,
      beatIndex: 1,
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
        beatIndex: 0,
        playEpochMs: 1_000,
        seekKind: "none",
        serverNowMs: 21_000,
      }),
    );

    expect(OTEFDataContext.getInvestigationClock()).toMatchObject({
      phase: "playing",
      revision: 5,
      beatIndex: 0,
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

    const first = wireClock({ phase: "playing", revision: 1, seekKind: "none", playEpochMs: 100 });
    const second = wireClock({ phase: "paused", revision: 1, beatIndex: 1 });
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
    vi.spyOn(api.OTEF_API, "updateInvestigationClock").mockResolvedValue({
      investigation_clock: wireClock({
        phase: "paused",
        revision: 9,
        serverNowMs: 41_000,
      }),
    });

    const { default: OTEFDataContext } = await import(
      "../../frontend/src/shared/OTEFDataContext.js"
    );
    OTEFDataContext._tableName = "otef";
    OTEFDataContext._clientId = "clock-client";

    await OTEFDataContext.patchInvestigationClock(
      wireClock({ phase: "playing", revision: 8, playEpochMs: 1 }),
    );

    expect(api.OTEF_API.updateInvestigationClock).toHaveBeenCalledWith(
      "otef",
      expect.objectContaining({ phase: "playing" }),
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
    const clock = { phase: "idle", loop: true };

    await OTEF_API.updateInvestigationClock("otef", clock, {
      sourceId: "remote-1",
      timestamp: 42,
    });

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.investigation_clock).toEqual(clock);
    expect(body.sourceId).toBe("remote-1");
    expect(body.timestamp).toBe(42);
  });
});
