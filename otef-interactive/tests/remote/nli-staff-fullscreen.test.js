/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createStaffFullscreenControl } from "../../frontend/src/remote/nli-staff-fullscreen.js";

describe("staff remote fullscreen control", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    delete document.fullscreenElement;
  });

  test("requests and exits fullscreen only through its explicit button", async () => {
    document.body.innerHTML = '<main id="app"></main><button id="toggle" aria-pressed="false"><svg></svg><span data-fullscreen-label></span></button><p id="status"></p>';
    const root = document.getElementById("app");
    const button = document.getElementById("toggle");
    const status = document.getElementById("status");
    root.requestFullscreen = vi.fn(async () => {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: root });
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    document.exitFullscreen = vi.fn(async () => {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    const control = createStaffFullscreenControl({ root, button, status, labels: { enter: "Enter", exit: "Exit", unavailable: "Unavailable" } });

    expect(root.requestFullscreen).not.toHaveBeenCalled();
    expect(button.querySelector("[data-fullscreen-label]").textContent).toBe("Enter");
    button.click();
    await vi.waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));
    expect(root.requestFullscreen).toHaveBeenCalledOnce();
    expect(button.getAttribute("aria-label")).toBe("Exit");
    expect(button.querySelector("[data-fullscreen-label]").textContent).toBe("Exit");
    button.click();
    await vi.waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("false"));
    expect(document.exitFullscreen).toHaveBeenCalledOnce();
    expect(button.getAttribute("aria-label")).toBe("Enter");
    expect(button.querySelector("[data-fullscreen-label]").textContent).toBe("Enter");
    expect(button.querySelector("svg")).not.toBeNull();
    control.destroy();
  });

  test("reports rejected and unsupported fullscreen requests without throwing", async () => {
    document.body.innerHTML = '<main id="app"></main><button id="toggle"></button><p id="status"></p>';
    const root = document.getElementById("app");
    const button = document.getElementById("toggle");
    const status = document.getElementById("status");
    root.requestFullscreen = vi.fn(async () => { throw new Error("denied"); });
    const control = createStaffFullscreenControl({ root, button, status, labels: { enter: "Enter", exit: "Exit", unavailable: "Unavailable" } });
    button.click();
    await vi.waitFor(() => expect(status.textContent).toBe("Unavailable"));
    expect(button.getAttribute("aria-pressed")).toBe("false");
    control.destroy();

    document.body.innerHTML = '<main id="app"></main><button id="toggle"></button><p id="status"></p>';
    const unsupported = createStaffFullscreenControl({
      root: document.getElementById("app"), button: document.getElementById("toggle"), status: document.getElementById("status"),
      labels: { enter: "Enter", exit: "Exit", unavailable: "Unavailable" },
    });
    expect(document.getElementById("status").textContent).toBe("Unavailable");
    expect(document.getElementById("toggle").disabled).toBe(true);
    unsupported.destroy();
  });

  test("keeps fullscreen state active and reports a rejected exit", async () => {
    document.body.innerHTML = '<main id="app"></main><button id="toggle"></button><p id="status"></p>';
    const root = document.getElementById("app");
    const button = document.getElementById("toggle");
    const status = document.getElementById("status");
    root.requestFullscreen = vi.fn(async () => {
      Object.defineProperty(document, "fullscreenElement", { configurable: true, value: root });
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    document.exitFullscreen = vi.fn(async () => { throw new Error("denied"); });
    const control = createStaffFullscreenControl({ root, button, status, labels: { enter: "Enter", exit: "Exit", unavailable: "Unavailable" } });
    button.click();
    await vi.waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));
    button.click();
    await vi.waitFor(() => expect(status.textContent).toBe("Unavailable"));
    expect(button.getAttribute("aria-pressed")).toBe("true");
    control.destroy();
  });

  test("relocalizes a visible rejected fullscreen status without adding normal status text", async () => {
    document.body.innerHTML = '<main id="app"></main><button id="toggle"></button><p id="status" hidden></p>';
    const root = document.getElementById("app");
    const button = document.getElementById("toggle");
    const status = document.getElementById("status");
    const labels = { enter: "Enter", exit: "Exit", unavailable: "Unavailable" };
    root.requestFullscreen = vi.fn(async () => { throw new Error("denied"); });
    const control = createStaffFullscreenControl({ root, button, status, labels });

    expect(status.hidden).toBe(true);
    expect(status.textContent).toBe("");
    button.click();
    await vi.waitFor(() => expect(status.textContent).toBe("Unavailable"));
    expect(status.hidden).toBe(false);

    labels.unavailable = "לא זמין";
    control.render();
    expect(status.textContent).toBe("לא זמין");
    expect(status.hidden).toBe(false);
    control.destroy();
  });
});
