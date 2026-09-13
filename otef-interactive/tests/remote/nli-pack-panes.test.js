import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

function installLocaleEnvironment() {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: vi.fn(),
  });
  vi.stubGlobal("document", {
    documentElement: { setAttribute: vi.fn() },
    querySelectorAll: () => [],
    getElementById: () => null,
    title: "",
  });
  vi.stubGlobal("window", { dispatchEvent: vi.fn(), addEventListener: vi.fn() });
  vi.stubGlobal("CustomEvent", class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init?.detail; }
  });
}

describe("nli pack panes", () => {
  beforeEach(() => {
    vi.resetModules();
    installLocaleEnvironment();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("normalize defaults invalid values to layers", async () => {
    const { normalizeNliPackPane, NLI_PACK_PANE_DEFAULT } = await import(
      "../../frontend/src/remote/nli-pack-panes.js"
    );
    expect(NLI_PACK_PANE_DEFAULT).toBe("layers");
    expect(normalizeNliPackPane("timeline")).toBe("timeline");
    expect(normalizeNliPackPane("layers")).toBe("layers");
    expect(normalizeNliPackPane("dock")).toBe("layers");
    expect(normalizeNliPackPane(null)).toBe("layers");
  });

  test("switch HTML is empty for non-nli packs", async () => {
    const { nliPackPaneSwitchHtml } = await import(
      "../../frontend/src/remote/nli-pack-panes.js"
    );
    expect(nliPackPaneSwitchHtml({ id: "october_7th" }, "timeline")).toBe("");
    expect(nliPackPaneSwitchHtml(null, "layers")).toBe("");
  });

  test("switch HTML marks the active radio and uses radiogroup", async () => {
    const { nliPackPaneSwitchHtml } = await import(
      "../../frontend/src/remote/nli-pack-panes.js"
    );
    const layers = nliPackPaneSwitchHtml({ id: "nli" }, "layers");
    expect(layers).toContain('role="radiogroup"');
    expect(layers).not.toContain('role="tablist"');
    expect(layers).toContain('data-nli-pack-pane="layers"');
    expect(layers).toContain('data-nli-pack-pane="timeline"');
    expect(layers).toMatch(/data-nli-pack-pane="layers"[^>]*aria-checked="true"/);
    expect(layers).toMatch(/data-nli-pack-pane="timeline"[^>]*aria-checked="false"/);
    const timeline = nliPackPaneSwitchHtml({ id: "nli" }, "timeline");
    expect(timeline).toMatch(/data-nli-pack-pane="timeline"[^>]*aria-checked="true"/);
    expect(timeline).toContain("nli-pack-pane is-selected");
  });

  test("click consume calls setNliPackPane and stops when matching", async () => {
    const { consumeNliPackPaneClick } = await import(
      "../../frontend/src/remote/nli-pack-panes.js"
    );
    const host = { setNliPackPane: vi.fn() };
    const timelineBtn = {
      closest: (sel) => (sel === "[data-nli-pack-pane]" ? {
        getAttribute: () => "timeline",
      } : null),
    };
    const event = { target: timelineBtn, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    expect(consumeNliPackPaneClick(event, host)).toBe(true);
    expect(host.setNliPackPane).toHaveBeenCalledWith("timeline");
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(consumeNliPackPaneClick({ target: { closest: () => null } }, host)).toBe(false);
  });
});
