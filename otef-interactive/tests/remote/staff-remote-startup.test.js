// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });
function bootFallback() {
  const html = readFileSync("frontend/nli-staff-remote.html", "utf8");
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const fallback = parsed.getElementById("staffStartupFallback");
  const script = parsed.getElementById("staffStartupScript");
  expect(fallback, "Fallback must exist independently of modules").not.toBeNull();
  expect(script).not.toBeNull();
  document.body.append(document.importNode(fallback, true));
  const reload = vi.fn(); const win = { location: { reload } };
  new Function("window", "document", "setTimeout", "clearTimeout", script.textContent)(win, document, setTimeout, clearTimeout);
  return { win, reload, panel: document.getElementById("staffStartupFallback") };
}
test("failed or stalled modules expose one deliberate retry after thirty seconds", () => {
  vi.useFakeTimers(); const s = bootFallback(); expect(s.panel.hidden).toBe(true);
  vi.advanceTimersByTime(29999); expect(s.panel.hidden).toBe(true);
  vi.advanceTimersByTime(1); expect(s.panel.hidden).toBe(false);
  const retry = s.panel.querySelector("button"); retry.click(); retry.click();
  expect(s.reload).toHaveBeenCalledTimes(1); expect(retry.disabled).toBe(true);
});
test("successful initialization clears the deadline and hides a visible fallback", () => {
  vi.useFakeTimers(); const s = bootFallback(); vi.advanceTimersByTime(30000);
  s.win.otefStaffStartupReady(); expect(s.panel.hidden).toBe(true);
  vi.advanceTimersByTime(60000); expect(s.panel.hidden).toBe(true); expect(s.reload).not.toHaveBeenCalled();
});
