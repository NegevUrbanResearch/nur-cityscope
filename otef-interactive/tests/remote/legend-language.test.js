import { beforeEach, describe, expect, test, vi } from "vitest";

function env() {
  const store = {};
  vi.stubGlobal("localStorage", { getItem: (key) => store[key] ?? null, setItem: (key, value) => { store[key] = String(value); } });
  vi.stubGlobal("document", { documentElement: { setAttribute: vi.fn() }, querySelectorAll: () => [], querySelector: () => null, title: "" });
  vi.stubGlobal("window", { dispatchEvent: vi.fn(), addEventListener: vi.fn() });
}

function button() {
  const listeners = new Map();
  return {
    classList: { toggle: vi.fn() },
    setAttribute: vi.fn(),
    addEventListener: vi.fn((type, callback) => listeners.set(type, callback)),
    click() { return listeners.get("click")?.(); },
  };
}

describe("shared remote language intent", () => {
  beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); env(); });

  test("user intent sends one command while server hydration sends none", async () => {
    const { setLocaleFromUserIntent, applyServerLocale } = await import("../../frontend/src/remote/remote-locale.js");
    const dataContext = { setLegendSettings: vi.fn().mockResolvedValue({ legendSettings: { language: "en" } }) };
    await setLocaleFromUserIntent("en", dataContext);
    expect(dataContext.setLegendSettings).toHaveBeenCalledTimes(1);
    applyServerLocale("he");
    expect(dataContext.setLegendSettings).toHaveBeenCalledTimes(1);
  });

  test("confirmed server language ignores stale storage events after initLocale binds a listener", async () => {
    const { applyServerLocale, getLocale, initLocale, LOCALE_STORAGE_KEY } = await import("../../frontend/src/remote/remote-locale.js");
    initLocale();
    const listener = window.addEventListener.mock.calls.find(([name]) => name === "storage")?.[1];
    expect(listener).toEqual(expect.any(Function));
    applyServerLocale("en");
    listener({ key: LOCALE_STORAGE_KEY, newValue: "he" });
    expect(getLocale()).toBe("en");
  });

  test("a stale opening adopts server language and separate storage context cannot replace it", async () => {
    const staleStore = { "otef.remote.locale": "en" };
    const otherPhoneStore = { "otef.remote.locale": "he" };
    vi.stubGlobal("localStorage", {
      getItem: (key) => staleStore[key] ?? null,
      setItem: (key, value) => { staleStore[key] = String(value); },
    });
    const storageListeners = [];
    vi.stubGlobal("window", {
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn((name, callback) => { if (name === "storage") storageListeners.push(callback); }),
    });
    const { applyServerLocale, getLocale, initLocale, LOCALE_STORAGE_KEY } = await import("../../frontend/src/remote/remote-locale.js");
    initLocale();
    expect(getLocale()).toBe("en");
    expect(storageListeners).toHaveLength(1);

    applyServerLocale("he");
    storageListeners[0]({ key: LOCALE_STORAGE_KEY, newValue: otherPhoneStore[LOCALE_STORAGE_KEY], storageArea: otherPhoneStore });
    expect(getLocale()).toBe("he");
    expect(staleStore[LOCALE_STORAGE_KEY]).toBe("en");
  });

  test.each([
    ["ok:false", () => Promise.resolve({ ok: false, reason: "rejected" })],
    ["rejection", () => Promise.reject(new Error("network"))],
  ])("standard remote button rolls back and reports a %s language command failure", async (_kind, failure) => {
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("window", undefined);
    const { initRemoteLocaleControls } = await import("../../frontend/src/remote/remote-controller.js");
    const he = button();
    const en = button();
    const statusIndicator = { classList: { remove: vi.fn(), add: vi.fn() } };
    const statusText = { classList: { remove: vi.fn(), add: vi.fn() }, textContent: "" };
    vi.stubGlobal("document", {
      documentElement: { setAttribute: vi.fn() },
      title: "",
      getElementById: (id) => new Map([
        ["remoteLocaleHe", he], ["remoteLocaleEn", en],
        ["statusIndicator", statusIndicator], ["statusText", statusText],
      ]).get(id) || null,
      querySelectorAll: () => [],
      querySelector: () => null,
    });
    vi.stubGlobal("window", { addEventListener: vi.fn(), dispatchEvent: vi.fn() });
    const dataContext = {
      getLegendSettings: () => ({ language: "he" }),
      setLegendSettings: vi.fn(failure),
    };
    initRemoteLocaleControls(dataContext);

    await en.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(dataContext.setLegendSettings).toHaveBeenCalledTimes(1);
    expect(dataContext.setLegendSettings).toHaveBeenCalledWith({ language: "en" });
    const { getLocale } = await import("../../frontend/src/remote/remote-locale.js");
    expect(getLocale()).toBe("he");
    expect(statusText.textContent).toBe("שגיאה");
    expect(statusIndicator.classList.add).toHaveBeenCalledWith("disconnected");
  });

  test.each([
    ["ok:false", () => Promise.resolve({ ok: false, reason: "rejected" })],
    ["rejection", () => Promise.reject(new Error("network"))],
  ])("staff remote button rolls back and reports a %s language command failure", async (_kind, failure) => {
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("window", undefined);
    const { initNliStaffLocaleControls } = await import("../../frontend/src/remote/nli-staff-remote.js");
    const he = button();
    const en = button();
    const freeStatus = { textContent: "", classList: { toggle: vi.fn() } };
    vi.stubGlobal("document", {
      documentElement: { setAttribute: vi.fn() },
      title: "",
      getElementById: (id) => new Map([["localeHe", he], ["localeEn", en], ["freeStatus", freeStatus]]).get(id) || null,
      querySelectorAll: () => [],
      querySelector: () => null,
    });
    vi.stubGlobal("window", { addEventListener: vi.fn(), dispatchEvent: vi.fn() });
    const dataContext = {
      getLegendSettings: () => ({ language: "he" }),
      setLegendSettings: vi.fn(failure),
    };
    initNliStaffLocaleControls(dataContext, {
      onFailure: () => { freeStatus.textContent = "שגיאה"; },
    });

    await en.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(dataContext.setLegendSettings).toHaveBeenCalledTimes(1);
    expect(dataContext.setLegendSettings).toHaveBeenCalledWith({ language: "en" });
    const { getLocale } = await import("../../frontend/src/remote/remote-locale.js");
    expect(getLocale()).toBe("he");
    expect(freeStatus.textContent).toBe("שגיאה");
  });
});
