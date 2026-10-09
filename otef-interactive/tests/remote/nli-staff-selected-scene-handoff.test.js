import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

async function setup({ clearSucceeds = true, delayClear = false, focus = "person" } = {}) {
  const { default: dataContext } = await import("../../frontend/src/shared/OTEFDataContext.js");
  const { createCueRunner } = await import("../../frontend/src/remote/nli-staff-cues.js");
  const { createNliStaffSearchEventHandlers } = await import("../../frontend/src/remote/nli-staff-remote.js");
  const { createNliStaffSearchTransition } = await import("../../frontend/src/remote/nli-staff-search-transition.js");
  let clock = {
    phase: "idle", membership: [], beats: [], loop: false,
    positionMs: 0, anchorMs: null, seekKind: "none", revision: 1, serverNowMs: 1000,
  };
  let person = focus === "person"
    ? { personId: "11", datasetVersion: "test-version", revision: 1 }
    : { personId: null, datasetVersion: null, revision: 1 };
  let placeFocused = focus === "place";
  dataContext._tableName = "otef";
  dataContext._clientId = "selected-handoff-test";
  dataContext._narrativeState = { id: null, transition: "initial", revision: 0 };
  dataContext._setInvestigationClock(clock);
  dataContext._setPersonSelection(person);
  const requests = [], clears = [], destinations = [], errors = [];
  let releaseClear;
  vi.stubGlobal("fetch", async (_url, options) => {
    if (!options?.body) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    const body = JSON.parse(options.body);
    requests.push(body);
    let response;
    if (body.investigation_clock) {
      clock = { ...body.investigation_clock, revision: clock.revision + 1, serverNowMs: 1000 };
      response = { investigation_clock: clock };
    } else if (body.action === "clear_person") {
      clears.push(dataContext.getInvestigationClock().presentationPendingUntilMs);
      if (delayClear && clears.length === 1) await new Promise(resolve => { releaseClear = resolve; });
      if (clearSucceeds) person = { personId: null, datasetVersion: null, revision: person.revision + 1 };
      response = { status: "ok", person_selection: person };
    } else if (body.action === "cancel_navigation_focus") {
      clears.push(dataContext.getInvestigationClock().presentationPendingUntilMs);
      response = { status: "ok", command: { id: "cancel-place", cancelFocus: true } };
    } else if (typeof body.exhibit_mode === "boolean") {
      response = { exhibit_mode: body.exhibit_mode };
    } else throw new Error("Unexpected selected-handoff request: " + JSON.stringify(body));
    return { ok: true, status: 200, json: async () => response };
  });
  const runner = createCueRunner({ dataContext });
  const transition = createNliStaffSearchTransition({
    clearPersonSelection: async () => {
      if (!dataContext.getPersonSelection().personId) return true;
      const result = await dataContext.clearPerson();
      return result.person_selection.personId === null;
    },
    cancelPlaceFocus: async () => {
      const result = await dataContext.cancelNavigationFocus();
      if (result.status === "ok") placeFocused = false;
      return result;
    },
    hasPlaceFocus: () => placeFocused,
  });
  const handlers = createNliStaffSearchEventHandlers({
    transition,
    cancelCues: () => runner.cancel(),
    showClearFailed: () => errors.push("clear failed"),
    setDestination: (item, index) => destinations.push({ id: item.id, index, hold: dataContext.getInvestigationClock().presentationPendingUntilMs }),
    applyDestinationCue: (item, index) => runner.apply(item.steps[index].cue),
    runDestinationTransition: (item, index, prepareDestination) => runner.apply(
      item.steps[index].cue, null, isCurrent => prepareDestination(isCurrent),
    ),
  });
  return { dataContext, requests, clears, destinations, errors, runner, handlers, releaseClear: () => releaseClear?.() };
}

describe("selected staff scene handoff through the public clock API", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(Date, "now").mockReturnValue(1000);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const step = (id, withCue = true) => ({ id, steps: [{ cue: withCue ? {} : undefined }] });

  test.each(["person", "place"])("acquires one cue hold before clearing the selected %s", async focus => {
    const h = await setup({ focus });
    expect(await h.handlers.transitionToStep(step("wall"), 0)).toBe(true);
    expect(h.clears).toHaveLength(1);
    expect(h.clears[0]).toEqual(expect.any(Number));
    expect(h.clears[0]).toBeGreaterThan(1000);
    expect(h.destinations[0]).toMatchObject({ id: "wall", hold: h.clears[0] });
    expect(h.requests.map(body => body.action || "clock"))
      .toEqual(["clock", focus === "person" ? "clear_person" : "cancel_navigation_focus", "clock"]);
    expect(h.dataContext.getInvestigationClock()).not.toHaveProperty("presentationPendingUntilMs");
  });

  test.each(["scene", "cleanup-only"])("a failed %s clear releases its hold without publishing a destination", async kind => {
    const h = await setup({ clearSucceeds: false });
    expect(await h.handlers.transitionToStep(step("wall", kind === "scene"), 0)).toBe(false);
    expect(h.clears[0]).toEqual(expect.any(Number));
    expect(h.clears[0]).toBeGreaterThan(1000);
    expect(h.destinations).toEqual([]);
    expect(h.errors).toEqual(["clear failed"]);
    expect(h.requests.map(body => body.action || "clock")).toEqual(["clock", "clear_person", "clock"]);
    expect(h.dataContext.getInvestigationClock()).not.toHaveProperty("presentationPendingUntilMs");
  });

  test.each(["scene", "cleanup-only"])("cancelling %s preparation releases its hold and prevents stale destination UI", async kind => {
    const h = await setup({ delayClear: true });
    const pending = h.handlers.transitionToStep(step("wall", kind === "scene"), 0);
    await vi.waitFor(() => expect(h.clears).toHaveLength(1));
    const cleanupHold = h.clears[0];
    h.runner.cancel();
    h.releaseClear();
    expect(await pending).toBe(false);
    expect(cleanupHold).toEqual(expect.any(Number));
    expect(cleanupHold).toBeGreaterThan(1000);
    await h.dataContext._clockPatchQueue;
    await vi.waitFor(() => expect(h.dataContext.getInvestigationClock()).not.toHaveProperty("presentationPendingUntilMs"));
    expect(h.destinations).toEqual([]);
  });

  test("the newest transition retains hold ownership until its destination is prepared", async () => {
    const h = await setup({ delayClear: true });
    const old = h.handlers.transitionToStep(step("old"), 0);
    await vi.waitFor(() => expect(h.clears).toHaveLength(1));
    const current = h.handlers.transitionToStep(step("current"), 0);
    h.releaseClear();
    expect(await old).toBe(false);
    expect(await current).toBe(true);
    const writes = h.requests.filter(body => body.investigation_clock).map(body => body.investigation_clock);
    expect(writes).toHaveLength(3);
    expect(writes[0].presentationPendingUntilMs).toBeGreaterThan(1000);
    expect(writes[1].presentationPendingUntilMs).toBeGreaterThan(1000);
    expect(writes[1].presentationPendingUntilMs).not.toBe(writes[0].presentationPendingUntilMs);
    expect(writes[2]).not.toHaveProperty("presentationPendingUntilMs");
    expect(h.destinations).toEqual([{ id: "current", index: 0, hold: writes[1].presentationPendingUntilMs }]);
  });

  test("a cue-less branch prepares under the public hold without changing the retained story", async () => {
    const h = await setup();
    h.dataContext._narrativeState = { id: "segev", transition: "enter", revision: 2 };
    h.dataContext._legendSettings = { ...h.dataContext.getLegendSettings(), language: "en" };
    h.dataContext._setInvestigationClock({ ...h.dataContext.getInvestigationClock(), hiddenDisplays: ["projection"] });
    h.dataContext._setLayerGroups([{ id: "nli", layers: [{ id: "people", enabled: true }] }]);
    const layersBefore = structuredClone(h.dataContext.getLayerGroups());
    document.body.innerHTML = readFileSync("frontend/nli-staff-remote.html", "utf8");
    const { setLocale } = await import("../../frontend/src/remote/remote-locale.js");
    setLocale("en", { persist: false });
    const { initNliStaffRemote } = await import("../../frontend/src/remote/nli-staff-remote.js");
    const remote = initNliStaffRemote(h.dataContext);
    try {
      const shortcut = document.createElement("button");
      shortcut.dataset.showStep = "segev-family";
      document.getElementById("narrativeList").append(shortcut);
      shortcut.click();
      await vi.waitFor(() => expect(document.getElementById("stepTitle").textContent).toBe("Segev family"));
      await vi.waitFor(() => expect(h.requests.filter(body => body.investigation_clock)).toHaveLength(2));
      await h.dataContext._clockPatchQueue;
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(h.clears[0]).toBeGreaterThan(1000);
      expect(h.requests.filter(body => body.action || body.investigation_clock).map(body => body.action || "clock"))
        .toEqual(["clock", "clear_person", "clock"]);
      expect(h.dataContext.getNarrativeState()).toMatchObject({ id: "segev", revision: 2 });
      expect(h.dataContext.getLayerGroups()).toEqual(layersBefore);
      expect(h.dataContext.getInvestigationClock()).toMatchObject({ phase: "idle", hiddenDisplays: ["projection"] });
      expect(h.dataContext.getInvestigationClock()).not.toHaveProperty("presentationPendingUntilMs");
    } finally {
      remote.dispose();
      document.body.innerHTML = "";
    }
  });

  test.each(["step", "home"])("disposing during held %s cleanup releases ownership without late rendering", async kind => {
    const h = await setup({ delayClear: true });
    h.dataContext._legendSettings = { ...h.dataContext.getLegendSettings(), language: "en" };
    document.body.innerHTML = readFileSync("frontend/nli-staff-remote.html", "utf8");
    const { initNliStaffRemote } = await import("../../frontend/src/remote/nli-staff-remote.js");
    const remote = initNliStaffRemote(h.dataContext);
    if (kind === "step") document.querySelector('[data-show-step="identity-database"]').click();
    else {
      h.dataContext._notify("narrativeState", h.dataContext.getNarrativeState());
      h.dataContext._notify("connection", true);
    }
    await vi.waitFor(() => expect(h.clears).toHaveLength(1));
    expect(h.clears[0]).toBeGreaterThan(1000);
    remote.dispose();
    document.body.innerHTML = "";
    h.releaseClear();
    await vi.waitFor(() => expect(h.dataContext.getInvestigationClock()).not.toHaveProperty("presentationPendingUntilMs"));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(h.requests.filter(body => body.action || body.investigation_clock).map(body => body.action || "clock"))
      .toEqual(["clock", "clear_person", "clock"]);
    expect(document.body.childElementCount).toBe(0);
  });
});
/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
