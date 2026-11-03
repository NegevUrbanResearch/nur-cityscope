// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { createStaffRemoteUpdateView } from "../../frontend/src/remote/staff-remote-update-view.js";
import { setLocale } from "../../frontend/src/remote/remote-locale.js";

let view;
afterEach(() => { view?.dispose(); view = null; document.body.innerHTML = ""; setLocale("he", { persist: false, force: true }); });
function setup(options = {}) {
  document.body.innerHTML = '<div class="app"><button id="homeBtn">Home</button></div>';
  let listener;
  let state = { mode: "ready", registration: "registered", canRefresh: true, setupPending: false, error: null };
  const updates = { subscribe: fn => { listener = fn; fn(state); return () => {}; },
    getState: () => state, dismiss: vi.fn(() => { state = { ...state, mode: "reminder" }; listener(state); }),
    refresh: vi.fn(), reopen: vi.fn(), register: vi.fn() };
  view = createStaffRemoteUpdateView({ document, updates, ...options });
  return { updates, show(value) { state = { ...state, ...value }; listener(state); }, dialog: document.querySelector("dialog") };
}
test("ready dialog has no extra footer, focuses Later and Escape dismisses to a reachable reminder", () => {
  const s = setup();
  expect(s.dialog.open).toBe(true); expect(s.dialog.textContent).toContain("עדכון חדש זמין");
  expect(s.dialog.textContent).not.toContain("אפשר לרענן עכשיו");
  expect(document.activeElement.textContent).toBe("מאוחר יותר");
  s.dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(s.dialog.open).toBe(false); expect(s.updates.dismiss).toHaveBeenCalledOnce();
  expect(document.activeElement.textContent).toContain("עדכון זמין");
});
test("busy reminder keeps Home controls usable; success removes all update UI", () => {
  const s = setup(); s.show({ mode: "reminder", canRefresh: false });
  expect(s.dialog.open).toBe(false); expect(document.getElementById("homeBtn").inert).not.toBe(true);
  expect(document.querySelector("[data-update-reminder]").hidden).toBe(false);
  s.show({ mode: "hidden" }); expect(document.querySelector("[data-update-reminder]").hidden).toBe(true);
});
test("Checking leaves Continue focused and locale changes update the same dialog", () => {
  const s = setup(); s.show({ mode: "checking", canRefresh: false });
  expect(s.dialog.querySelector("[data-update-refresh]").disabled).toBe(true);
  expect(document.activeElement.textContent).toBe("המשך");
  setLocale("en", { persist: false, force: true });
  expect(s.dialog.dir).toBe("ltr"); expect(s.dialog.textContent).toContain("Checking");
  s.dialog.querySelector("[data-update-dismiss]").click(); expect(s.updates.dismiss).toHaveBeenCalledOnce();
});
test("a disabled busy reminder cannot receive focus after the dialog closes", () => {
  const s = setup(); s.show({ mode: "reminder", canRefresh: false });
  expect(document.activeElement).toBe(document.getElementById("homeBtn"));
});

test("regular remote reminder describes finishing active work without an NLI Home requirement", () => {
  setLocale("en", { persist: false, force: true });
  const s = setup({ busyReminderKey: "updateRegularBusyReminder" });
  s.show({ mode: "reminder", canRefresh: false });
  expect(document.querySelector("[data-update-reminder]").textContent).toContain("Finish active actions");
  expect(document.querySelector("[data-update-reminder]").textContent).not.toContain("Home");
});
