import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

async function setup(deadline) {
  const { default: dataContext } = await import("../../frontend/src/shared/OTEFDataContext.js");
  let clock = {
    phase: "idle", membership: [], beats: [], loop: false,
    positionMs: 0, anchorMs: null, seekKind: "none", revision: 1, serverNowMs: 1000,
    ...(deadline == null ? {} : { presentationPendingUntilMs: deadline }),
  };
  dataContext._tableName = "otef";
  dataContext._clientId = "public-hold-test";
  dataContext._narrativeState = { id: null, transition: "initial", revision: 0 };
  dataContext._setInvestigationClock(clock);
  const requests = [];
  vi.stubGlobal("fetch", async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    clock = { ...body.investigation_clock, revision: clock.revision + 1, serverNowMs: 1000 };
    return { ok: true, status: 200, json: async () => ({ investigation_clock: clock }) };
  });
  return { dataContext, requests };
}

describe("public OTEFDataContext presentation hold contract", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(Date, "now").mockReturnValue(1000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("a public claim installs and serializes the requested hold", async () => {
    const { dataContext, requests } = await setup();
    const result = await dataContext.patchInvestigationClock({
      ...dataContext.getInvestigationClock(), presentationPendingUntilMs: 16_000,
    }, { claimPresentationHold: true, isCurrent: () => true });

    expect(result).toMatchObject({ ok: true, clock: { presentationPendingUntilMs: 16_000 } });
    expect(dataContext.getInvestigationClock().presentationPendingUntilMs).toBe(16_000);
    expect(requests).toHaveLength(1);
    expect(requests[0].investigation_clock.presentationPendingUntilMs).toBe(16_000);
    for (const key of ["claimPresentationHold", "releasePresentationHold", "isCurrent"]) {
      expect(requests[0]).not.toHaveProperty(key);
      expect(requests[0].investigation_clock).not.toHaveProperty(key);
    }
  });

  test("an ordinary public clock patch preserves a live hold", async () => {
    const { dataContext, requests } = await setup(16_000);
    const next = { ...dataContext.getInvestigationClock(), hiddenDisplays: ["projection"] };
    delete next.presentationPendingUntilMs;

    expect(await dataContext.patchInvestigationClock(next)).toMatchObject({
      ok: true, clock: { hiddenDisplays: ["projection"], presentationPendingUntilMs: 16_000 },
    });
    expect(requests[0].investigation_clock.presentationPendingUntilMs).toBe(16_000);
  });

  test("the owning public release clears the hold", async () => {
    const { dataContext, requests } = await setup(16_000);
    const next = { ...dataContext.getInvestigationClock() };
    delete next.presentationPendingUntilMs;

    expect(await dataContext.patchInvestigationClock(next, {
      releasePresentationHold: 16_000,
    })).toMatchObject({ ok: true });
    expect(dataContext.getInvestigationClock()).not.toHaveProperty("presentationPendingUntilMs");
    expect(requests).toHaveLength(1);
    expect(requests[0].investigation_clock).not.toHaveProperty("presentationPendingUntilMs");
  });

  test("an older public release cannot write over a newer hold", async () => {
    const { dataContext, requests } = await setup(17_000);
    const next = { ...dataContext.getInvestigationClock() };
    delete next.presentationPendingUntilMs;

    expect(await dataContext.patchInvestigationClock(next, {
      releasePresentationHold: 16_000,
    })).toMatchObject({ ok: false, stale: true });
    expect(dataContext.getInvestigationClock().presentationPendingUntilMs).toBe(17_000);
    expect(requests).toEqual([]);
  });

  test("the cue runner holds presentation preparation and releases through the public API", async () => {
    const { dataContext, requests } = await setup();
    const { createCueRunner } = await import("../../frontend/src/remote/nli-staff-cues.js");
    const runner = createCueRunner({ dataContext });
    let preparingDeadline;

    expect(await runner.apply({ hiddenDisplays: ["projection"] }, null, () => {
      preparingDeadline = dataContext.getInvestigationClock().presentationPendingUntilMs;
    })).toEqual({ status: "ready" });

    expect(preparingDeadline).toBe(16_000);
    expect(requests.map(({ investigation_clock: value }) => value.presentationPendingUntilMs))
      .toEqual([16_000, undefined]);
    expect(dataContext.getInvestigationClock()).not.toHaveProperty("presentationPendingUntilMs");
  });
});
