// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { installSharedExperienceNavigation } from "../../frontend/src/remote/remote-experience-navigation.js";
import { setLocale } from "../../frontend/src/remote/remote-locale.js";

let dispose;
afterEach(() => { dispose?.(); dispose = null; document.body.innerHTML = ""; window.sessionStorage.clear(); vi.restoreAllMocks(); });

function mount(kind, initial) {
  document.body.innerHTML = '<div class="app"><main id="remoteMain" class="main"></main></div>';
  setLocale("he", { persist: false });
  let state = structuredClone(initial);
  const listeners = new Set();
  const ctx = {
    getExperienceState: () => structuredClone(state),
    refreshExperienceState: vi.fn(async () => ({ experience_state: state })),
    transitionExperience: vi.fn(async (stage, intent) => {
      if (stage === "abort") state.pending_transition = null;
      if (stage === "prepare") state.pending_transition = { request_id: intent.requestId, target: intent.target, from_experience: state.active_experience, expected_revision: state.revision, cleanup_confirmed: true };
      if (stage === "commit") state = { active_experience: intent.target, revision: state.revision + 1, pending_transition: null, last_transition: { request_id: intent.requestId, status: "committed" } };
      for (const listener of listeners) listener(state);
      return { experience_state: state };
    }),
    subscribe: (_topic, fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
  const staff = { hydrateExperience: vi.fn(), flushBookmark: vi.fn(), suspendForExperienceSwitch: vi.fn(async () => true), resumeAfterSwitchFailure: vi.fn() };
  const localTab = vi.fn();
  const win = { location: { href: `http://localhost/otef-interactive/${kind === "nli" ? "nli-staff-remote" : "remote-controller"}.html`, assign: vi.fn() }, sessionStorage: window.sessionStorage, addEventListener: window.addEventListener.bind(window), removeEventListener: window.removeEventListener.bind(window) };
  dispose = installSharedExperienceNavigation({ dataContext: ctx, staffRemote: staff, kind, onRegularTab: localTab, document, window: win });
  return { ctx, staff, localTab, win, update(next) { state = next; for (const listener of listeners) listener(state); } };
}
const tab = key => document.querySelector(`[data-remote-tab="${key}"]`);
const current = () => document.querySelector('[aria-current="page"]')?.dataset.remoteTab;

test("tapping the selected Library tab does not hydrate, reset history, or mutate output", async () => {
  const h = mount("nli", { active_experience: "nli", revision: 2, pending_transition: null });
  expect(current()).toBe("curation");
  expect(tab("curation").textContent).toContain("הספרייה הלאומית");
  tab("curation").click();
  await Promise.resolve();
  expect(h.staff.hydrateExperience).not.toHaveBeenCalled();
  expect(h.ctx.transitionExperience).not.toHaveBeenCalled();
  expect(h.staff.suspendForExperienceSwitch).not.toHaveBeenCalled();
});

test("opening inactive regular controls reads existing NLI state without activating regular", () => {
  const h = mount("regular", { active_experience: "nli", revision: 2, pending_transition: null });
  expect(document.getElementById("remoteMain").inert).toBe(true);
  expect(current()).toBe("curation");
  expect(h.ctx.transitionExperience).not.toHaveBeenCalled();
  expect(h.win.location.assign).not.toHaveBeenCalled();
});

test("regular tab changes stay local and maintain one selected destination", async () => {
  const h = mount("regular", { active_experience: "regular", revision: 3, pending_transition: null });
  tab("layers").click();
  await vi.waitFor(() => expect(current()).toBe("layers"));
  expect(h.localTab).toHaveBeenLastCalledWith("layers");
  expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  expect(h.ctx.transitionExperience).not.toHaveBeenCalled();
});

test("an explicit cancel can recover a hydrated pending switch from another document", async () => {
  const pending = { request_id: "old-document", target: "regular", from_experience: "nli", expected_revision: 2, cleanup_confirmed: false };
  const h = mount("nli", { active_experience: "nli", revision: 2, pending_transition: pending });
  expect(document.getElementById("remoteMain").inert).toBe(true);
  expect([...document.querySelectorAll("[data-remote-tab]")].every(button => button.disabled)).toBe(true);
  const cancel = document.querySelector(".experience-status__cancel");
  expect(cancel.hidden).toBe(false);
  cancel.click();
  await vi.waitFor(() => expect(h.ctx.transitionExperience).toHaveBeenCalledWith("abort", { target: "regular", expectedRevision: 2, requestId: "old-document" }));
  await vi.waitFor(() => expect(document.getElementById("remoteMain").inert).toBe(false));
  expect(h.staff.resumeAfterSwitchFailure).toHaveBeenCalledTimes(1);
  expect(h.ctx.transitionExperience.mock.calls.map(([stage]) => stage)).toEqual(["abort"]);
});

test("a Library document no longer highlights Library when another remote activates regular", () => {
  const h = mount("nli", { active_experience: "nli", revision: 2, pending_transition: null });
  h.update({ active_experience: "regular", revision: 3, pending_transition: null });
  expect(tab("curation").hasAttribute("aria-current")).toBe(false);
  expect(document.getElementById("remoteMain").inert).toBe(true);
  expect(h.ctx.transitionExperience).not.toHaveBeenCalled();
});

test("disconnected controls and destinations remain inert until hydration reconnects", () => {
  const initial = { active_experience: "regular", revision: 1, pending_transition: null };
  const app = mount("regular", initial);
  app.ctx.isConnected = () => false;
  app.update(initial);
  expect(document.querySelector("#remoteMain").inert).toBe(true);
  expect([...document.querySelectorAll("#remoteBottomNav button")].every(button => button.disabled)).toBe(true);
  app.ctx.isConnected = () => true;
  app.update(initial);
  expect(document.querySelector("#remoteMain").inert).toBe(false);
});

test("a failed NLI cleanup names the unfinished work and leaves the experience active", async () => {
  const app = mount("nli", { active_experience: "nli", revision: 1, pending_transition: null });
  app.staff.suspendForExperienceSwitch.mockResolvedValue(false);
  document.querySelector('[data-remote-tab="layers"]').click();
  await vi.waitFor(() => expect(document.querySelector(".experience-status").textContent).toContain("סגירת התוכן של הספרייה לא הושלמה"));
  expect(app.ctx.getExperienceState().active_experience).toBe("nli");
  expect(app.ctx.getExperienceState().pending_transition).toBeNull();
});
