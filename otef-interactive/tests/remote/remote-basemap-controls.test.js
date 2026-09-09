import { describe, expect, test, vi } from "vitest";
import { createRemoteBasemapController } from "../../frontend/src/remote/remote-controller.js";

function fakeButton(id, basemap) {
  const attributes = new Map([["data-basemap", basemap], ["aria-pressed", "false"]]);
  const classes = new Set(["basemap-button"]);
  return {
    id,
    disabled: false,
    style: {},
    classList: {
      toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
      contains(name) { return classes.has(name); },
    },
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    closest(selector) { return selector === "[data-basemap]" ? this : null; },
    focus: vi.fn(),
  };
}

function fakeBasemapRoot() {
  const buttons = [
    fakeButton("basemapOsm", "osm"),
    fakeButton("basemapSatellite", "satellite"),
    fakeButton("satelliteColor", "satellite"),
    fakeButton("satelliteBw", "satellite_bw"),
    fakeButton("basemapDark", "dark"),
  ];
  const variants = { hidden: true };
  const listeners = new Map();
  const root = {
    buttons,
    variants,
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener: vi.fn((type, handler) => {
      if (listeners.get(type) === handler) listeners.delete(type);
    }),
    querySelectorAll(selector) { return selector === ".basemap-button[data-basemap]" ? buttons : []; },
    querySelector(selector) {
      if (selector === "#basemapSatellite") return buttons[1];
      if (selector === "#basemapSatelliteVariants") return variants;
      return null;
    },
    contains(element) { return buttons.includes(element); },
    click(target, detail = 1) { listeners.get("click")?.({ target, detail }); },
  };
  return root;
}

function fakeDocument() {
  const listeners = new Map();
  return {
    addEventListener: vi.fn((type, handler) => listeners.set(type, handler)),
    removeEventListener: vi.fn((type, handler) => {
      if (listeners.get(type) === handler) listeners.delete(type);
    }),
    dispatch(type, event = {}) { listeners.get(type)?.(event); },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe("remote basemap controller", () => {
  test("Satellite parent toggles an ephemeral menu without selecting a basemap", async () => {
    const root = fakeBasemapRoot();
    const document = fakeDocument();
    const setBasemap = vi.fn().mockResolvedValue(undefined);
    createRemoteBasemapController({
      root,
      document,
      initialBasemap: "osm",
      isConnected: () => true,
      isNarrativeActive: () => false,
      setBasemap,
    });

    root.click(root.buttons[1]);
    await Promise.resolve();
    expect(setBasemap).not.toHaveBeenCalled();
    expect(root.variants.hidden).toBe(false);
    expect(root.buttons[1].getAttribute("aria-expanded")).toBe("true");
    root.click(root.buttons[1]);
    expect(root.variants.hidden).toBe(true);
    expect(root.buttons[1].getAttribute("aria-expanded")).toBe("false");
  });

  test("variant selection sends one command and closes immediately", async () => {
    const root = fakeBasemapRoot();
    const document = fakeDocument();
    const setBasemap = vi.fn().mockResolvedValue(undefined);
    createRemoteBasemapController({
      root,
      document,
      initialBasemap: "osm",
      isConnected: () => true,
      isNarrativeActive: () => false,
      setBasemap,
    });
    root.click(root.buttons[1]);
    root.click(root.buttons[3]);
    await Promise.resolve();
    expect(setBasemap).toHaveBeenCalledTimes(1);
    expect(setBasemap).toHaveBeenCalledWith("satellite_bw");
    expect(root.variants.hidden).toBe(true);
    expect(root.buttons[1].getAttribute("aria-expanded")).toBe("false");
  });

  test("outside click, Escape, and tabbing away close an open menu", () => {
    const root = fakeBasemapRoot();
    const document = fakeDocument();
    createRemoteBasemapController({
      root,
      document,
      initialBasemap: "satellite",
      isConnected: () => true,
      isNarrativeActive: () => false,
      setBasemap: vi.fn(),
    });
    root.click(root.buttons[1]);
    document.dispatch("click", { target: fakeButton("outside", "dark") });
    expect(root.variants.hidden).toBe(true);
    root.click(root.buttons[1]);
    document.dispatch("keydown", { key: "Escape", target: root.buttons[3] });
    expect(root.variants.hidden).toBe(true);
    expect(root.buttons[1].focus).toHaveBeenCalledTimes(1);
    root.click(root.buttons[1]);
    document.dispatch("focusin", { target: fakeButton("outside", "dark") });
    expect(root.variants.hidden).toBe(true);
  });

  test("active satellite state never opens the menu, while disabling closes it and reconnect stays closed", () => {
    const root = fakeBasemapRoot();
    const document = fakeDocument();
    let connected = true;
    let narrativeActive = false;
    const controller = createRemoteBasemapController({
      root,
      document,
      initialBasemap: "satellite_bw",
      isConnected: () => connected,
      isNarrativeActive: () => narrativeActive,
      setBasemap: vi.fn(),
    });
    expect(root.variants.hidden).toBe(true);
    root.click(root.buttons[1]);
    connected = false;
    controller.render("satellite_bw");
    expect(root.variants.hidden).toBe(true);
    expect(root.buttons.every((button) => button.disabled)).toBe(true);
    connected = true;
    narrativeActive = true;
    controller.render("satellite_bw");
    expect(root.variants.hidden).toBe(true);
    narrativeActive = false;
    controller.render("satellite_bw");
    expect(root.variants.hidden).toBe(true);
  });

  test("destroy removes root and document listeners deterministically", () => {
    const root = fakeBasemapRoot();
    const document = fakeDocument();
    const controller = createRemoteBasemapController({ root, document, setBasemap: vi.fn() });
    controller.destroy();
    expect(root.removeEventListener).toHaveBeenCalledWith("click", expect.any(Function));
    expect(document.removeEventListener).toHaveBeenCalledWith("click", expect.any(Function));
    expect(document.removeEventListener).toHaveBeenCalledWith("keydown", expect.any(Function));
    expect(document.removeEventListener).toHaveBeenCalledWith("focusin", expect.any(Function));
  });

  test("a pending variant command locks alternate requests until it settles", async () => {
    const root = fakeBasemapRoot();
    const document = fakeDocument();
    const pending = deferred();
    const setBasemap = vi.fn(() => pending.promise);
    createRemoteBasemapController({
      root,
      document,
      initialBasemap: "osm",
      isConnected: () => true,
      isNarrativeActive: () => false,
      setBasemap,
    });

    root.click(root.buttons[1]);
    root.click(root.buttons[2]);
    await Promise.resolve();
    expect(setBasemap).toHaveBeenCalledWith("satellite");
    expect(root.buttons.every((button) => button.disabled)).toBe(true);
    expect(root.buttons.every((button) => button.style.pointerEvents === "none")).toBe(true);
    root.click(root.buttons[1]);
    root.click(root.buttons[3]);
    expect(setBasemap).toHaveBeenCalledTimes(1);

    pending.resolve({ ok: true });
    await vi.waitFor(() => {
      expect(root.buttons.every((button) => !button.disabled)).toBe(true);
    });
    expect(root.buttons.every((button) => button.style.pointerEvents === "auto")).toBe(true);
    expect(root.buttons.every((button) => button.style.opacity === "1")).toBe(true);
    expect(root.buttons[1].classList.contains("is-active")).toBe(true);
  });

  test("an optimistic basemap state echo keeps writes serialized until transport settles", async () => {
    const root = fakeBasemapRoot();
    const document = fakeDocument();
    const transport = deferred();
    let controller;
    const setBasemap = vi.fn((nextBasemap) => {
      controller.render(nextBasemap);
      return transport.promise;
    });
    controller = createRemoteBasemapController({
      root,
      document,
      initialBasemap: "osm",
      isConnected: () => true,
      isNarrativeActive: () => false,
      setBasemap,
    });

    root.click(root.buttons[1]);
    root.click(root.buttons[2]);

    await vi.waitFor(() => expect(setBasemap).toHaveBeenCalledWith("satellite"));
    expect(root.buttons.every((button) => button.disabled)).toBe(true);
    expect(root.buttons[1].classList.contains("is-active")).toBe(true);

    transport.resolve({ ok: true });
    await vi.waitFor(() => {
      expect(root.buttons.every((button) => !button.disabled)).toBe(true);
    });
  });

  test("resolved and rejected basemap failures restore the authoritative basemap", async () => {
    const root = fakeBasemapRoot();
    const document = fakeDocument();
    let authoritativeBasemap = "osm";
    const onError = vi.fn();
    const setBasemap = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: "offline" })
      .mockRejectedValueOnce(new Error("network"));
    createRemoteBasemapController({
      root,
      document,
      initialBasemap: "osm",
      getBasemap: () => authoritativeBasemap,
      isConnected: () => true,
      isNarrativeActive: () => false,
      setBasemap,
      onError,
    });

    root.click(root.buttons[1]);
    root.click(root.buttons[2]);
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith("offline");
    });
    expect(root.buttons[0].classList.contains("is-active")).toBe(true);
    expect(root.buttons[2].classList.contains("is-active")).toBe(false);

    root.click(root.buttons[1]);
    root.click(root.buttons[3]);
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });
    expect(root.buttons[0].classList.contains("is-active")).toBe(true);
    expect(root.buttons.every((button) => !button.disabled)).toBe(true);
  });
});
