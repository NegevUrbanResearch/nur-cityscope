import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

function installLocaleTestEnv(storeInit = {}) {
  const store = { ...storeInit };
  const ls = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
  };
  const root = {
    setAttribute: vi.fn(function (name, value) {
      this[name] = value;
    }),
    getAttribute: vi.fn(function (name) {
      return this[name] ?? null;
    }),
  };
  const doc = {
    documentElement: root,
    querySelectorAll: () => [],
    get title() {
      return this._title ?? "";
    },
    set title(v) {
      this._title = v;
    },
  };
  vi.stubGlobal("localStorage", ls);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", {
    dispatchEvent: vi.fn(),
  });
  return { store, root, doc };
}

describe("remote-locale", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("setLocale(en) sets LTR and en on document root", async () => {
    installLocaleTestEnv();
    const { setLocale, LOCALE_STORAGE_KEY, LOCALE_EVENT } = await import(
      "../../frontend/src/remote/remote-locale.js"
    );
    expect(LOCALE_EVENT).toBe("otef:locale");
    setLocale("en", { force: true });
    const { document } = globalThis;
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith("dir", "ltr");
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith("lang", "en");
    expect(globalThis.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
  });

  test("setLocale(he) sets RTL and he on document root", async () => {
    installLocaleTestEnv();
    const { setLocale } = await import("../../frontend/src/remote/remote-locale.js");
    setLocale("he", { force: true });
    const { document } = globalThis;
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith("dir", "rtl");
    expect(document.documentElement.setAttribute).toHaveBeenCalledWith("lang", "he");
  });

  test("initLocale reads persisted value from localStorage", async () => {
    const key = "otef.remote.locale";
    const preset = { [key]: "en" };
    installLocaleTestEnv(preset);
    vi.resetModules();
    vi.unstubAllGlobals();
    installLocaleTestEnv(preset);
    const { initLocale, getLocale, LOCALE_STORAGE_KEY } = await import(
      "../../frontend/src/remote/remote-locale.js"
    );
    expect(LOCALE_STORAGE_KEY).toBe(key);
    initLocale();
    expect(getLocale()).toBe("en");
  });

  test("t() returns the correct string for the active locale", async () => {
    installLocaleTestEnv();
    const { t, setLocale } = await import("../../frontend/src/remote/remote-locale.js");
    setLocale("he", { force: true });
    expect(t("navLayers")).toBe("שכבות");
    setLocale("en", { force: true });
    expect(t("navLayers")).toBe("Layers");
  });

  test("t(curatedGroupLabel) localizes the curated pack fallback title", async () => {
    installLocaleTestEnv();
    const { t, setLocale } = await import("../../frontend/src/remote/remote-locale.js");
    setLocale("he", { force: true });
    expect(t("curatedGroupLabel")).toBe("אסופה");
    setLocale("en", { force: true });
    expect(t("curatedGroupLabel")).toBe("Curated");
  });

  test("setLocale dispatches otef:locale with detail.locale after apply", async () => {
    installLocaleTestEnv();
    const { setLocale, LOCALE_EVENT } = await import(
      "../../frontend/src/remote/remote-locale.js"
    );
    setLocale("en", { force: true });
    expect(globalThis.window.dispatchEvent).toHaveBeenCalled();
    const ev = globalThis.window.dispatchEvent.mock.calls.at(-1)?.[0];
    expect(ev).toBeDefined();
    expect(ev.type).toBe(LOCALE_EVENT);
    expect(ev.detail).toEqual({ locale: "en" });
  });

  test("initLocale dispatches otef:locale when storage matches in-memory default", async () => {
    installLocaleTestEnv();
    const { initLocale, LOCALE_EVENT } = await import(
      "../../frontend/src/remote/remote-locale.js"
    );
    initLocale();
    const ev = globalThis.window.dispatchEvent.mock.calls.at(-1)?.[0];
    expect(ev?.type).toBe(LOCALE_EVENT);
    expect(ev?.detail?.locale).toBe("he");
  });
});
