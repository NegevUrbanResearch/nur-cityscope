// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
const spies = vi.hoisted(() => ({ management: vi.fn(), updates: vi.fn(), reload: vi.fn(), view: vi.fn() }));
vi.mock("../../frontend/src/remote/staff-remote-management.js", () => ({
  createStaffRemoteDocumentIdentity: ({ storage }) => ({ remoteId: storage.getItem("otef-staff-remote-id") || "same-document", instanceId: "instance" }),
  createStaffRemoteManagement: spies.management,
}));
vi.mock("../../frontend/src/remote/staff-remote-reload.js", () => ({ createStaffRemoteReload: spies.reload }));
vi.mock("../../frontend/src/remote/staff-remote-updates.js", () => ({ createStaffRemoteUpdates: spies.updates }));
vi.mock("../../frontend/src/remote/staff-remote-update-view.js", () => ({ createStaffRemoteUpdateView: spies.view }));
import { installRegularRemoteManagement } from "../../frontend/src/remote/regular-remote-management.js";
import { OTEF_API } from "../../frontend/src/shared/api-client.js";
afterEach(() => { vi.clearAllMocks(); sessionStorage.clear(); });

test("uncommitted timing edits block refresh until change handlers finish and persistence settles", async () => {
  const dispose = vi.fn(), changed = vi.fn();
  spies.management.mockReturnValue({ dispose, noteHomeSuccess: vi.fn() });
  spies.updates.mockReturnValue({ dispose, refreshStateChanged: changed });
  spies.reload.mockReturnValue({ dispose }); spies.view.mockReturnValue({ dispose });
  const pending = vi.spyOn(OTEF_API, "hasPendingWrites").mockReturnValue(false);
  let saving = false;
  window.slideshowTabController = { settingsPersistence: { hasPending: () => saving } };
  const dataContext = { getManagementSocket: () => ({ getConnected: () => true }), isConnected: () => true,
    getExperienceState: () => ({ active_experience: "regular", revision: 1 }), getNarrativeState: () => ({ id: null }),
    getInvestigationClock: () => ({ phase: "idle" }), getProjectionSlideshow: () => null, subscribe: () => () => {} };
  const input = document.createElement("input"); input.type = "number"; input.value = "10";
  document.body.append(input);
  const lifecycle = installRegularRemoteManagement({ dataContext, loadedBuildId: "loaded", window, document });
  try {
    input.focus();
    expect(lifecycle.getRefreshState().refreshBlockReason).toBeNull();
    input.value = "12"; input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(lifecycle.getRefreshState().refreshBlockReason).toBe("busy");
    await Promise.resolve();
    expect(lifecycle.getRefreshState().refreshBlockReason).toBe("busy");
    input.value = "10"; input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
    expect(lifecycle.getRefreshState().refreshBlockReason).toBeNull();
    input.value = "15"; input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve(); changed.mockClear();
    input.addEventListener("change", () => {
      expect(lifecycle.getRefreshState().refreshBlockReason).toBe("busy");
      expect(changed).not.toHaveBeenCalled();
      saving = true;
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
    expect(lifecycle.getRefreshState().refreshBlockReason).toBe("busy");
    saving = false;
    expect(lifecycle.getRefreshState().refreshBlockReason).toBeNull();
  } finally { lifecycle.dispose(); input.remove(); delete window.slideshowTabController; pending.mockRestore(); }
});

test("regular boot waits for its controller and captures loaded version with update stylesheet", () => {
  const source = readFileSync("frontend/src/entries/remote-main.js", "utf8");
  expect(source.indexOf("await remoteReady")).toBeLessThan(source.indexOf("installRegularRemoteManagement({"));
  const html = readFileSync("frontend/remote-controller.html", "utf8");
  expect(html).toContain('href="./src/remote/staff-remote-updates.css"');
  expect(source).toContain("loadedBuildId: FRONTEND_BUILD_ID");
  expect(source).toContain("document.documentElement.dataset.frontendBuildId = FRONTEND_BUILD_ID");
});
test("regular lifecycle shares persisted identity, checks fresh canonical state, tracks gestures and cleans up", async () => {
  const dispose = vi.fn(), changed = vi.fn(), noteHomeSuccess = vi.fn(), stops = [];
  spies.management.mockReturnValue({ dispose, noteHomeSuccess, getIdentity: vi.fn(), reportDeviceBinding: vi.fn() });
  spies.updates.mockReturnValue({ dispose, refreshStateChanged: changed, getStoredDeviceId: () => "stored-device" });
  spies.reload.mockReturnValue({ dispose }); spies.view.mockReturnValue({ dispose });
  sessionStorage.setItem("otef-staff-remote-id", "persisted-across-navigation");
  const snapshot = { experience_state: { active_experience: "regular", revision: 7 }, narrative_state: { id: null },
    investigation_clock: { phase: "idle" }, projection_slideshow: null };
  const socket = { getConnected: () => true };
  const dataContext = { getManagementSocket: () => socket, isConnected: () => true,
    getExperienceState: () => snapshot.experience_state, getNarrativeState: () => snapshot.narrative_state,
    getInvestigationClock: () => snapshot.investigation_clock, getProjectionSlideshow: () => snapshot.projection_slideshow,
    subscribe: vi.fn(() => { const stop = vi.fn(); stops.push(stop); return stop; }) };
  window.fetch = vi.fn(async () => ({ ok: true, json: async () => snapshot }));
  const lifecycle = installRegularRemoteManagement({ dataContext, loadedBuildId: "frontend-loaded", window, document });
  expect(spies.management.mock.calls[0][0].ids.remoteId).toBe("persisted-across-navigation");
  expect(spies.updates.mock.calls[0][0].loadedBuildId).toBe("frontend-loaded");
  const options = spies.reload.mock.calls[0][0];
  expect(options.canonicalBlockReason).toBe("owned_session");
  await options.readCanonicalState({ signal: undefined }); expect(window.fetch.mock.calls[0][1].cache).toBe("no-store");
  expect(options.isCanonicalRefreshSafe(snapshot)).toBe(true);
  expect(options.isCanonicalRefreshSafe({ ...snapshot, experience_state: { ...snapshot.experience_state, revision: 6 } })).toBe(false);
  document.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  expect(lifecycle.getRefreshState().refreshBlockReason).toBe("busy");
  window.dispatchEvent(new MouseEvent("pointerup")); expect(lifecycle.getRefreshState().refreshBlockReason).toBeNull();
  const persisted = new Event("pagehide"); Object.defineProperty(persisted, "persisted", { value: true });
  window.dispatchEvent(persisted); expect(dispose).not.toHaveBeenCalled();
  window.dispatchEvent(new Event("pagehide")); expect(dispose).toHaveBeenCalledTimes(4);
  stops.forEach(stop => expect(stop).toHaveBeenCalledOnce());
  const count = changed.mock.calls.length; document.dispatchEvent(new MouseEvent("pointerdown"));
  expect(changed).toHaveBeenCalledTimes(count); lifecycle.dispose(); expect(dispose).toHaveBeenCalledTimes(4);
});

test("tapping update dialog controls preserves the dialog through pointerdown and delivers click", async () => {
  const { createStaffRemoteUpdateView } = await vi.importActual("../../frontend/src/remote/staff-remote-update-view.js");
  spies.view.mockImplementation(createStaffRemoteUpdateView);
  const refresh = vi.fn(), dismiss = vi.fn(), dispose = vi.fn();
  spies.reload.mockReturnValue({ dispose });
  spies.management.mockReturnValue({ dispose, noteHomeSuccess: vi.fn(), getIdentity: vi.fn(), reportDeviceBinding: vi.fn() });
  spies.updates.mockImplementation(({ getRefreshState }) => {
    let listener;
    const state = () => ({ mode: getRefreshState().refreshBlockReason === null ? "ready" : "reminder",
      registration: "registered", canRefresh: getRefreshState().refreshBlockReason === null });
    return { dispose, getState: state, refresh, dismiss, refreshStateChanged: () => listener?.(state()),
      subscribe: fn => { listener = fn; fn(state()); return () => {}; } };
  });
  const dataContext = { getManagementSocket: () => ({ getConnected: () => true }), isConnected: () => true,
    getExperienceState: () => ({ active_experience: "regular", revision: 1 }), getNarrativeState: () => ({ id: null }),
    getInvestigationClock: () => ({ phase: "idle" }), getProjectionSlideshow: () => null, subscribe: () => () => {} };
  const lifecycle = installRegularRemoteManagement({ dataContext, loadedBuildId: "loaded", window, document });
  const dialog = document.querySelector("dialog");
  for (const target of [dialog.querySelector("[data-update-refresh]"), dialog.querySelector("[data-update-dismiss]")]) {
    target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(dialog.open).toBe(true);
    expect(lifecycle.getRefreshState().refreshBlockReason).toBeNull();
    target.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })); target.click();
  }
  expect(refresh).toHaveBeenCalledOnce(); expect(dismiss).toHaveBeenCalledOnce(); lifecycle.dispose();
});
