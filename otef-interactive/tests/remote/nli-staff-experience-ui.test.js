// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { initNliStaffRemote } from "../../frontend/src/remote/nli-staff-remote.js";
import { HOME_LAYER_IDS } from "../../frontend/src/remote/nli-staff-script.js";
import { setLocale } from "../../frontend/src/remote/remote-locale.js";

let remote;
const emptyPerson = { personId: null, datasetVersion: null, revision: 1 };
const home = { scriptId: null, step: 0, returnTo: null };

function context(bookmark = home, { active = true, canonicalHome = false } = {}) {
  const listeners = new Map();
  let clock = { phase: "idle", revision: 1, membership: [], beats: [], positionMs: 0, anchorMs: null };
  let narrative = { id: null, transition: canonicalHome ? "exit" : "initial", revision: 1 };
  const ctx = {
    getExperienceState: () => ({ active_experience: active ? "nli" : "regular", revision: 2, nli_bookmark: bookmark }),
    isExperienceActive: () => active,
    captureExperienceScope: () => ({ experience: "nli", experience_revision: 2 }),
    isExperienceScopeCurrent: () => active,
    getNarrativeState: () => narrative,
    getInvestigationClock: () => clock,
    getPersonSelection: () => emptyPerson,
    getEscapeOverlay: () => ({ individual: false, overlap: false, mor: false, settled: false }),
    getLayerGroups: () => canonicalHome ? [...new Set(HOME_LAYER_IDS.map(id => id.split(".")[0]))].map(id => ({ id, layers: HOME_LAYER_IDS.filter(full => full.startsWith(id + ".")).map(full => ({ id: full.slice(id.length + 1), enabled: true })) })) : [],
    getLegendSettings: () => ({ language: "en" }),
    isConnected: () => true,
    setExhibitMode: vi.fn(),
    setEnabledLayerIds: vi.fn(async () => ({ ok: true })),
    setEscapeOverlay: vi.fn(async () => ({ ok: true })),
    setNarrative: vi.fn(async id => { narrative = { id, transition: id ? "enter" : "exit", revision: narrative.revision + 1 }; return { ok: true }; }),
    patchInvestigationClock: vi.fn(async next => { clock = { ...next, revision: clock.revision + 1 }; return { ok: true, clock }; }),
    clearPerson: vi.fn(async () => ({ person_selection: emptyPerson })),
    saveNliBookmark: vi.fn(async () => ({ ok: true })),
    narrativePresentationCommand: vi.fn(async () => ({ status: "ok" })),
    archiveWindowCommand: vi.fn(async () => ({ acknowledged: true })),
    subscribe(topic, fn) { const set = listeners.get(topic) || new Set(); set.add(fn); listeners.set(topic, set); return () => set.delete(fn); },
    emit(topic, value) { for (const fn of listeners.get(topic) || []) fn(value); },
  };
  return ctx;
}

beforeEach(() => {
  document.body.innerHTML = readFileSync("frontend/nli-staff-remote.html", "utf8");
  setLocale("en", { persist: false });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { remote?.dispose(); remote = null; document.body.innerHTML = ""; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function expectNoSceneWrites(ctx) {
  for (const name of ["setExhibitMode", "setEnabledLayerIds", "setEscapeOverlay", "setNarrative", "patchInvestigationClock", "clearPerson", "narrativePresentationCommand", "archiveWindowCommand", "saveNliBookmark"]) expect(ctx[name]).not.toHaveBeenCalled();
}

test("reload hydrates the authored scene without Home, presentation, clock or bookmark writes", async () => {
  const ctx = context({ scriptId: "segev", step: 0, returnTo: null });
  remote = initNliStaffRemote(ctx);
  expect(document.getElementById("stepTitle").textContent).toBe("The house in Be'eri");
  ctx.emit("connection", true);
  ctx.emit("narrativeState", ctx.getNarrativeState());
  window.dispatchEvent(new Event("pagehide"));
  window.dispatchEvent(new Event("beforeunload"));
  await Promise.resolve();
  expect(remote.getExperienceBookmark()).toEqual({ scriptId: "segev", step: 0, returnTo: null });
  expectNoSceneWrites(ctx);
});

test("hydrate of a names-wall bookmark leaves auto media closed", () => {
  const ctx = context({ scriptId: "show", step: 6, returnTo: null });
  remote = initNliStaffRemote(ctx);
  expect(document.getElementById("stepTitle").textContent).toBe("Wall of names");
  expectNoSceneWrites(ctx);
});

test("confirmed canonical Home hydration reports management readiness without resetting output", () => {
  const ctx = context(home, { canonicalHome: true });
  const onHomeSuccess = vi.fn();
  remote = initNliStaffRemote(ctx, { onHomeSuccess });
  expect(onHomeSuccess).toHaveBeenCalledTimes(1);
  expect(remote.getRefreshState()).toEqual({ ready: true, refreshBlockReason: null });
  ctx.emit("connection", true);
  ctx.emit("narrativeState", ctx.getNarrativeState());
  expect(onHomeSuccess).toHaveBeenCalledTimes(1);
  expectNoSceneWrites(ctx);
});

test("an inactive NLI document cannot issue a new Home or authored scene action", async () => {
  const ctx = context(home, { active: false });
  remote = initNliStaffRemote(ctx);
  document.querySelector('[data-show-step="identity-database"]').click();
  document.getElementById("homeBtn").click();
  await Promise.resolve();
  expectNoSceneWrites(ctx);
});

test("successful navigation awaits bookmark persistence and flush before confirming its intent", async () => {
  const ctx = context();
  let release;
  ctx.saveNliBookmark.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  remote = initNliStaffRemote(ctx);
  document.querySelector('[data-show-step="identity-database"]').click();
  await vi.waitFor(() => expect(ctx.saveNliBookmark).toHaveBeenCalledTimes(1));
  expect(remote.getExperienceBookmark()).toEqual(home);
  let flushed = false;
  const flush = remote.flushBookmark().then(() => { flushed = true; });
  await Promise.resolve();
  expect(flushed).toBe(false);
  release({ ok: true });
  await flush;
  expect(remote.getExperienceBookmark()).toEqual({ scriptId: "show", step: 5, returnTo: null });
});

test("exit flush waits for a scene still applying before its bookmark save has started", async () => {
  const ctx = context();
  let releaseLayers, releaseBookmark;
  ctx.setEnabledLayerIds.mockImplementation(() => new Promise(resolve => { releaseLayers = () => resolve({ ok: true }); }));
  ctx.saveNliBookmark.mockImplementation(() => new Promise(resolve => { releaseBookmark = () => resolve({ ok: true }); }));
  remote = initNliStaffRemote(ctx);
  document.querySelector('[data-show-step="identity-database"]').click();
  await vi.waitFor(() => expect(ctx.setEnabledLayerIds).toHaveBeenCalledTimes(1));
  let flushed = false;
  const flush = remote.flushBookmark().then(() => { flushed = true; });
  await Promise.resolve();
  await Promise.resolve();
  expect(flushed).toBe(false);
  releaseLayers();
  await vi.waitFor(() => expect(ctx.saveNliBookmark).toHaveBeenCalledTimes(1));
  expect(flushed).toBe(false);
  releaseBookmark();
  await flush;
  expect(remote.getExperienceBookmark()).toEqual({ scriptId: "show", step: 5, returnTo: null });
});

test("bookmark retry persists intent without reapplying a successful scene", async () => {
  const ctx = context();
  ctx.saveNliBookmark.mockRejectedValueOnce(new Error("offline"));
  remote = initNliStaffRemote(ctx);
  document.querySelector('[data-show-step="identity-database"]').click();
  await vi.waitFor(() => expect(document.getElementById("playerCueFailure").hidden).toBe(false));
  expect(remote.getExperienceBookmark()).toEqual(home);
  await expect(remote.flushBookmark()).rejects.toThrow("offline");
  const layerWrites = ctx.setEnabledLayerIds.mock.calls.length;
  document.getElementById("playerCueRetry").click();
  await vi.waitFor(() => expect(remote.getExperienceBookmark().scriptId).toBe("show"));
  expect(ctx.setEnabledLayerIds).toHaveBeenCalledTimes(layerWrites);
  expect(ctx.narrativePresentationCommand).not.toHaveBeenCalled();
});

test("suspend waits for the existing presentation viewer to acknowledge Close", async () => {
  const ctx = context({ scriptId: "segev", step: 0, returnTo: null });
  remote = initNliStaffRemote(ctx);
  document.querySelector('[data-presentation-action="open"]').click();
  await vi.waitFor(() => expect(ctx.narrativePresentationCommand).toHaveBeenCalledTimes(1));
  const opened = ctx.narrativePresentationCommand.mock.calls[0][0];
  ctx.emit("narrativePresentationResult", { ...opened, outcome: "opened", sourceId: "gis-viewer" });
  let settled = false;
  const suspend = remote.suspendForExperienceSwitch().then(result => { settled = true; return result; });
  await vi.waitFor(() => expect(ctx.narrativePresentationCommand).toHaveBeenCalledTimes(2));
  expect(settled).toBe(false);
  const close = ctx.narrativePresentationCommand.mock.calls[1][0];
  expect(close.presentationAction).toBe("close");
  ctx.emit("narrativePresentationResult", { ...close, outcome: "closed", sourceId: "gis-viewer" });
  await expect(suspend).resolves.toBe(true);
  remote.resumeAfterSwitchFailure();
  expect(ctx.narrativePresentationCommand).toHaveBeenCalledTimes(2);
});

test("a failed presentation cleanup keeps switch unsuccessful and recovery never reopens media", async () => {
  const ctx = context({ scriptId: "segev", step: 0, returnTo: null });
  remote = initNliStaffRemote(ctx);
  document.querySelector('[data-presentation-action="open"]').click();
  await vi.waitFor(() => expect(ctx.narrativePresentationCommand).toHaveBeenCalledTimes(1));
  const opened = ctx.narrativePresentationCommand.mock.calls[0][0];
  ctx.emit("narrativePresentationResult", { ...opened, outcome: "opened", sourceId: "gis-viewer" });
  ctx.narrativePresentationCommand.mockRejectedValueOnce(new Error("close unavailable"));
  await expect(remote.suspendForExperienceSwitch()).resolves.toBe(false);
  remote.resumeAfterSwitchFailure();
  expect(ctx.narrativePresentationCommand).toHaveBeenCalledTimes(2);
  expect(ctx.narrativePresentationCommand.mock.calls[1][0].presentationAction).toBe("close");
});
