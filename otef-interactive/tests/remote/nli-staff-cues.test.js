import { describe, expect, test, vi } from "vitest";
import { createCueRunner } from "../../frontend/src/remote/nli-staff-cues.js";

function setup({ narrativeId = null, personId = null } = {}) {
  const calls = [];
  const record = (name) => vi.fn(async (...args) => { calls.push([name, ...args]); });
  const dataContext = {
    getNarrativeState: () => ({ id: narrativeId }),
    getPersonSelection: () => ({ personId }),
    setNarrative: record("narrative"),
    clearPerson: record("clearPerson"),
    setEscapeOverlay: record("escape"),
  };
  const statuses = [];
  const runner = createCueRunner({
    dataContext,
    commitLayers: record("layers"),
    stopClock: record("stop"),
    playClock: record("play"),
    onStatus: (status) => statuses.push(status),
  });
  return { runner, calls, statuses };
}

describe("NLI staff cue runner", () => {
  test("enters a changed narrative, then stops, sets layers and escape, and plays the window", async () => {
    const { runner, calls, statuses } = setup();
    await runner.apply({ layers: ["a"], clock: { from: 401 }, escape: { mor: true } }, "nova");
    expect(calls.map(([name]) => name)).toEqual(["narrative", "stop", "layers", "escape", "play"]);
    expect(calls[0][1]).toBe("nova");
    expect(calls[3][1]).toEqual({ individual: false, overlap: false, mor: true });
    expect(calls[4][1]).toEqual({ from: 401 });
    expect(statuses).toEqual(["applying", "ready"]);
  });

  test("keeps the active narrative and only clears a leftover person", async () => {
    const { runner, calls } = setup({ narrativeId: "nova", personId: "p1" });
    await runner.apply({ layers: ["a"] }, "nova");
    expect(calls.map(([name]) => name)).toEqual(["clearPerson", "layers"]);
  });

  test("an explicit null narrative exits to the overview", async () => {
    const { runner, calls } = setup({ narrativeId: "segev" });
    await runner.apply({ narrative: null, clock: "idle" }, "segev");
    expect(calls).toEqual([["narrative", null], ["stop"]]);
  });

  test("a newer cue cancels the rest of an older one", async () => {
    const { runner, calls, statuses } = setup();
    const first = runner.apply({ layers: ["old"], clock: { to: 401 } }, "segev");
    const second = runner.apply({ layers: ["new"] }, null);
    await Promise.all([first, second]);
    expect(calls).toEqual([["layers", ["new"]]]);
    expect(statuses).toEqual(["applying", "applying", "ready"]);
  });

  test("a step without a cue clears the status and touches nothing", async () => {
    const { runner, calls, statuses } = setup();
    await runner.apply(undefined, "segev");
    expect(calls).toEqual([]);
    expect(statuses).toEqual([null]);
  });

  test("reports a failure when a map command rejects", async () => {
    const statuses = [];
    const failing = createCueRunner({
      dataContext: { getNarrativeState: () => ({ id: null }) },
      commitLayers: async () => { throw new Error("offline"); },
      stopClock: async () => {},
      playClock: async () => {},
      onStatus: (status) => statuses.push(status),
    });
    await failing.apply({ layers: ["a"] });
    expect(statuses).toEqual(["applying", "failed"]);
  });
});
