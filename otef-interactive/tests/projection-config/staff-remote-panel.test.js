// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { createStaffRemotePanel } from "../../frontend/src/projection-config/staff-remote-panel.js";

test("renders an always-visible summary and no-action empty state using text nodes", () => {
  const manager = { getState: () => ({ connectionStatus: "Connected", remotes: [] }), subscribe: () => () => {}, refresh: vi.fn() };
  const panel = createStaffRemotePanel({ document, manager });
  document.body.append(panel.element);
  expect(panel.summary.textContent).toMatch(/Tablet remote/);
  expect(panel.element.textContent).toMatch(/No tablet remote detected/);
  expect(panel.element.querySelector("button")).toBeNull();
  panel.dispose(); panel.element.remove();
});

test("shows each targeted row, Home-first guidance, disabled reasons, and version-unavailable copy", () => {
  let state = { connectionStatus: "Connected", remotes: [
    { remoteId: "remote-a", instanceId: "tab-a", sessionId: "remote-a · taba", status: "Online", version: null, ageMs: 3_500,
      actionStatus: "", actionEnabled: false, blockedReason: "not_home", archiveSettling: true },
    { remoteId: "remote-a", instanceId: "tab-b", sessionId: "remote-a · tabb", status: "Online", version: "frontend-0123456789abcdef", ageMs: 1_000,
      actionStatus: "", actionEnabled: true, blockedReason: null },
  ] };
  const listeners = new Set();
  const manager = { getState: () => state, subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); }, refresh: vi.fn(() => true) };
  const panel = createStaffRemotePanel({ document, manager });
  document.body.append(panel.element);
  expect(panel.element.textContent).toContain("Version unavailable");
  expect(panel.element.textContent).toContain("Return GIS/projection to Home, then reload this tablet.");
  expect(panel.element.textContent).toContain("The tablet may need a local tap to return to fullscreen.");
  expect(panel.element.textContent).toContain("Return GIS/projection to Home before refreshing");
  expect(panel.element.textContent).toContain("If an archive request is still settling, wait before refreshing.");
  expect(panel.element.querySelectorAll("button[aria-label^='Refresh tablet']")).toHaveLength(2);
  const buttons = panel.element.querySelectorAll("button");
  expect(buttons[0].getAttribute("aria-label")).not.toBe(buttons[1].getAttribute("aria-label"));
  expect(buttons[0].disabled).toBe(true); expect(buttons[1].disabled).toBe(false);
  expect(buttons[1].parentElement.textContent).not.toContain("Remote is not ready");
  buttons[1].focus(); buttons[1].click();
  expect(manager.refresh).toHaveBeenCalledWith(state.remotes[1]);
  panel.dispose(); panel.element.remove(); expect(listeners.size).toBe(0);
});

test("limits live announcements to status changes and refreshes only panel DOM on manager updates", () => {
  let listener;
  let state = { connectionStatus: "Connected", remotes: [{ remoteId: "remote-a", instanceId: "tab-a", sessionId: "ABCD", status: "Online",
    version: "frontend-0123456789abcdef", ageMs: 0, actionStatus: "", actionEnabled: true }] };
  const manager = { getState: () => state, subscribe: (next) => { listener = next; return () => { listener = null; }; }, refresh: vi.fn(() => true) };
  const panel = createStaffRemotePanel({ document, manager });
  document.body.append(panel.element);
  const live = panel.element.querySelector('[aria-live="polite"]');
  expect(live).not.toBeNull();
  const initialText = live.textContent;
  state = { ...state, remotes: [{ ...state.remotes[0], ageMs: 10_000 }] }; listener();
  expect(live.textContent).toBe(initialText);
  state = { ...state, remotes: [{ ...state.remotes[0], status: "Not responding", actionEnabled: false }] }; listener();
  expect(live.textContent).not.toBe(initialText);
  panel.dispose(); panel.element.remove();
});
