import { afterEach, expect, test, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

test("connecting reuses translated copy, keeps overlay visible and controls blocked", async () => {
  const element = () => ({ textContent: "", classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() }, setAttribute: vi.fn() });
  const message = element();
  const warning = { ...element(), querySelector: () => message };
  const indicator = element(), label = element(), control = { style: {} };
  const elements = { warningOverlay: warning, statusIndicator: indicator, statusText: label };
  vi.stubGlobal("document", {
    readyState: "loading", addEventListener: vi.fn(),
    getElementById: (id) => elements[id] || null,
    querySelectorAll: () => [control],
  });
  vi.stubGlobal("window", { addEventListener: vi.fn() });
  const { updateConnectionStatus } = await import("../../frontend/src/remote/remote-controller.js");
  const { t } = await import("../../frontend/src/remote/remote-locale.js");
  updateConnectionStatus("connecting");
  expect(label.textContent).toBe(t("statusConnecting"));
  expect(message.textContent).toBe(t("statusConnecting"));
  expect(message.setAttribute).toHaveBeenCalledWith("data-i18n", "statusConnecting");
  expect(warning.classList.toggle).toHaveBeenLastCalledWith("hidden", false);
  expect(indicator.classList.add).toHaveBeenLastCalledWith("connecting");
  expect(control.style.pointerEvents).toBe("none");
  updateConnectionStatus("connected");
  expect(warning.classList.toggle).toHaveBeenLastCalledWith("hidden", true);
  expect(control.style.pointerEvents).toBe("auto");
  updateConnectionStatus("disconnected");
  expect(message.textContent).toBe(t("warningControlsDisabled"));
});
