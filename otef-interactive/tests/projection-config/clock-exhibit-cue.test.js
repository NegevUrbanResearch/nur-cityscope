import { afterEach, expect, test, vi } from "vitest";
import { createClockExhibitCueAction } from "../../frontend/src/projection-config/clock-exhibit-cue.js";
import layerRegistry from "../../frontend/src/shared/layer-registry.js";
import { HOME_CUE, TIMELINE, NARRATIVES } from "../../frontend/src/remote/nli-staff-script.js";
afterEach(() => vi.restoreAllMocks());

function sceneAction(options = {}) {
  vi.spyOn(layerRegistry, "init").mockResolvedValue();
  vi.spyOn(layerRegistry, "getGroups").mockReturnValue([{ id: "nli", layers: allLayerIds().map((id) => ({ id: id.slice(id.indexOf(".") + 1) })) }]);
  const rig = fixture(options);
  return { ...rig, action: createClockExhibitCueAction({ api: rig.api, tableName: "otef", sourceId: "test" }) };
}

function allLayerIds() {
  const cues = [HOME_CUE, ...TIMELINE.steps.map((step) => step.cue), ...NARRATIVES.flatMap((narrative) => narrative.steps.map((step) => step.cue))];
  return [...new Set(cues.flatMap((cue) => cue.layers || []))];
}

function fixture({ narrativeId = null, personId = null, staleClear = false, badNarrativeAck = false, badLayerAck = false } = {}) {
  const ids = allLayerIds();
  const registryGroups = [{ id: "nli", registryNote: "keep", layers: ids.map((id) => ({ id: id.slice(id.indexOf(".") + 1), registryNote: "keep" })) }];
  const state = {
    narrative_state: { id: narrativeId, revision: 4 },
    person_selection: { personId, revision: 7 },
    investigation_clock: { phase: "idle", revision: 8, membership: [], beats: [] },
    escapeOverlay: { individual: false, overlap: false, mor: false, settled: false },
    layerGroups: [{ id: "nli", enabled: false, metadata: "keep", layers: ids.map((id) => ({ id: id.slice(id.indexOf(".") + 1), enabled: false, metadata: "keep" })) }],
  };
  const api = {
    getState: vi.fn(async () => structuredClone(state)),
    setLayerToggles: vi.fn(async (_table, changes) => {
      for (const change of changes) {
        const id = change.full_layer_id.slice(change.full_layer_id.indexOf(".") + 1);
        const layer = state.layerGroups[0].layers.find((item) => item.id === id);
        if (layer) layer.enabled = change.enabled;
      }
      const layerGroups = structuredClone(state.layerGroups);
      if (badLayerAck) layerGroups[0].layers[0].enabled = !layerGroups[0].layers[0].enabled;
      return { layerGroups };
    }),
    setNarrative: vi.fn(async (_table, id, revision) => {
      state.narrative_state = { id, revision: revision + 1 };
      return { scene: { narrativeState: badNarrativeAck ? { id: "wrong", revision: revision + 1 } : structuredClone(state.narrative_state) } };
    }),
    clearPerson: vi.fn(async (revision) => {
      if (staleClear) throw Object.assign(new Error("stale person selection"), { status: 409 });
      state.person_selection = { personId: null, revision: revision + 1 };
      return { personSelection: structuredClone(state.person_selection) };
    }),
    setEscapeOverlay: vi.fn(async (_table, overlay) => ({ escapeOverlay: structuredClone(overlay) })),
    updateInvestigationClock: vi.fn(async (_table, clock) => {
      state.investigation_clock = { ...clock, revision: state.investigation_clock.revision + 1 };
      return { investigation_clock: structuredClone(state.investigation_clock) };
    }),
  };
  return { api, state, registryGroups };
}

test("already-active narrative clears selected person and requires the clear acknowledgement", async () => {
  const savedInit = vi.spyOn(layerRegistry, "init").mockResolvedValue();
  const savedGetGroups = vi.spyOn(layerRegistry, "getGroups").mockReturnValue([{ id: "nli", layers: allLayerIds().map((id) => ({ id: id.slice(id.indexOf(".") + 1) })) }]);
  const { api } = fixture({ narrativeId: "segev", personId: "person-1" });
  const action = createClockExhibitCueAction({ api, tableName: "otef", sourceId: "test-source" });
  await expect(action.show("segev")).resolves.toMatchObject({ status: "ready" });
  expect(api.clearPerson).toHaveBeenCalledWith(7, expect.objectContaining({ tableName: "otef", sourceId: "test-source" }));
  expect(api.updateInvestigationClock).toHaveBeenCalledTimes(1);
  action.cancel(); savedGetGroups.mockRestore(); savedInit.mockRestore();
});

test("stale clear-person acknowledgement stops the cue before clock changes", async () => {
  const savedInit = vi.spyOn(layerRegistry, "init").mockResolvedValue();
  const savedGetGroups = vi.spyOn(layerRegistry, "getGroups").mockReturnValue([{ id: "nli", layers: allLayerIds().map((id) => ({ id: id.slice(id.indexOf(".") + 1) })) }]);
  const { api } = fixture({ narrativeId: "segev", personId: "person-1", staleClear: true });
  const action = createClockExhibitCueAction({ api, tableName: "otef", sourceId: "test-source" });
  await expect(action.show("segev")).rejects.toThrow("stale person selection");
  expect(api.updateInvestigationClock).not.toHaveBeenCalled();
  action.cancel(); savedGetGroups.mockRestore(); savedInit.mockRestore();
});

test("mismatched narrative and layer acknowledgements stop the cue before clock changes", async () => {
  const savedInit = vi.spyOn(layerRegistry, "init").mockResolvedValue();
  const savedGetGroups = vi.spyOn(layerRegistry, "getGroups").mockReturnValue([{ id: "nli", layers: allLayerIds().map((id) => ({ id: id.slice(id.indexOf(".") + 1) })) }]);
  for (const overrides of [{ badNarrativeAck: true }, { badLayerAck: true }]) {
    const { api } = fixture(overrides);
    const action = createClockExhibitCueAction({ api, tableName: "otef", sourceId: "test-source" });
    await expect(action.show("segev")).rejects.toThrow(/acknowledgement|requested scene/);
    expect(api.updateInvestigationClock).not.toHaveBeenCalled();
    action.cancel();
  }
  savedGetGroups.mockRestore(); savedInit.mockRestore();
});

test("fresh scene state must include every registered layer before applying the cue", async () => {
  const savedInit = vi.spyOn(layerRegistry, "init").mockResolvedValue();
  const savedGetGroups = vi.spyOn(layerRegistry, "getGroups").mockReturnValue([{ id: "nli", layers: allLayerIds().map((id) => ({ id: id.slice(id.indexOf(".") + 1) })) }]);
  const { api, state } = fixture();
  state.layerGroups[0].layers.pop();
  const action = createClockExhibitCueAction({ api, tableName: "otef", sourceId: "test-source" });
  await expect(action.show("segev")).rejects.toThrow("Fresh layer settings do not include every registered scene layer");
  expect(api.setLayerToggles).not.toHaveBeenCalled();
  action.cancel(); savedGetGroups.mockRestore(); savedInit.mockRestore();
});

test("cancellation while loading fresh state prevents the cue sequence from starting", async () => {
  const savedInit = vi.spyOn(layerRegistry, "init").mockResolvedValue();
  const savedGetGroups = vi.spyOn(layerRegistry, "getGroups").mockReturnValue([{ id: "nli", layers: allLayerIds().map((id) => ({ id: id.slice(id.indexOf(".") + 1) })) }]);
  const { api, state } = fixture();
  let resolveFresh;
  api.getState.mockImplementation(() => new Promise((resolve) => { resolveFresh = resolve; }));
  const action = createClockExhibitCueAction({ api, tableName: "otef", sourceId: "test-source" });
  const showing = action.show("segev");
  await vi.waitFor(() => expect(resolveFresh).toBeTypeOf("function"));
  action.cancel();
  resolveFresh(structuredClone(state));
  await expect(showing).rejects.toMatchObject({ cancelled: true });
  expect(api.setLayerToggles).not.toHaveBeenCalled();
  expect(api.setNarrative).not.toHaveBeenCalled();
  expect(api.updateInvestigationClock).not.toHaveBeenCalled();
  savedGetGroups.mockRestore(); savedInit.mockRestore();
});

test("scene commands resolve Home, Timeline, and each narrative to an idle cue", async () => {
  const savedInit = vi.spyOn(layerRegistry, "init").mockResolvedValue();
  const savedGetGroups = vi.spyOn(layerRegistry, "getGroups").mockReturnValue([{ id: "nli", layers: allLayerIds().map((id) => ({ id: id.slice(id.indexOf(".") + 1) })) }]);
  const expected = { home: null, timeline: null, segev: "segev", nova: "nova", sderot: "sderot", hostages: "hostages", hostages_all: "hostages_all" };
  for (const [sceneId, narrativeId] of Object.entries(expected)) {
    const { api } = fixture();
    const action = createClockExhibitCueAction({ api, tableName: "otef", sourceId: "test-source" });
    await expect(action.show(sceneId)).resolves.toMatchObject({ status: "ready", sceneId });
    expect(api.updateInvestigationClock).toHaveBeenCalledTimes(1);
    expect(api.setNarrative.mock.calls.at(-1)?.[1]).toBe(narrativeId);
    action.cancel();
  }
  savedGetGroups.mockRestore(); savedInit.mockRestore();
});

test("narrative conflict stops the cue without retry or continuation", async () => {
  const { action, api } = sceneAction();
  api.setNarrative.mockRejectedValue(Object.assign(new Error("Narrative changed"), { status: 409 }));
  await expect(action.show("segev")).rejects.toMatchObject({ status: 409 });
  expect(api.setNarrative).toHaveBeenCalledOnce();
  expect(api.setLayerToggles).toHaveBeenCalledOnce();
  expect(api.setLayerToggles.mock.invocationCallOrder[0]).toBeLessThan(api.setNarrative.mock.invocationCallOrder[0]);
  expect(api.setEscapeOverlay).not.toHaveBeenCalled();
  expect(api.updateInvestigationClock).not.toHaveBeenCalled();
  action.cancel();
});

test.each(["setNarrative", "clearPerson", "setEscapeOverlay", "updateInvestigationClock"])("missing %s acknowledgement cannot report ready or continue", async (method) => {
  const { action, api } = sceneAction(method === "clearPerson" ? { narrativeId: "segev", personId: "selected" } : {});
  api[method].mockResolvedValue({});
  await expect(action.show("segev")).rejects.toThrow(/acknowledgement/);
  expect(api[method]).toHaveBeenCalledOnce();
  if (method !== "updateInvestigationClock") expect(api.updateInvestigationClock).not.toHaveBeenCalled();
  if (method === "setNarrative" || method === "clearPerson") expect(api.setEscapeOverlay).not.toHaveBeenCalled();
  action.cancel();
});

test("stale idle-clock acknowledgement cannot report ready", async () => {
  const { action, api, state } = sceneAction();
  api.updateInvestigationClock.mockResolvedValue({ investigation_clock: structuredClone(state.investigation_clock) });
  await expect(action.show("segev")).rejects.toThrow("stale or invalid");
  expect(api.updateInvestigationClock).toHaveBeenCalledOnce(); action.cancel();
});

test.each(["setNarrative", "setLayerToggles", "setEscapeOverlay"])("cancel after acknowledged %s stops the next cue step", async (method) => {
  const { action, api } = sceneAction();
  const original = api[method].getMockImplementation();
  api[method].mockImplementation(async (...args) => { const reply = await original(...args); action.cancel(); return reply; });
  await expect(action.show("segev")).rejects.toThrow();
  expect(api[method]).toHaveBeenCalledOnce();
  expect(api.updateInvestigationClock).not.toHaveBeenCalled();
  if (method !== "setEscapeOverlay") expect(api.setEscapeOverlay).not.toHaveBeenCalled();
});
