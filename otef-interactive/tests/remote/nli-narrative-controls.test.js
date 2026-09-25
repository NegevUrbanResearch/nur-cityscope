import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

function installLocaleEnvironment() {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
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

describe("remote NLI narrative controls", () => {
  beforeEach(() => {
    vi.resetModules();
    installLocaleEnvironment();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("renders only for the NLI pack and keeps inactive state acknowledged", async () => {
    const { nliNarrativeControlsHtml } = await import(
      "../../frontend/src/remote/nli-narrative-controls.js"
    );
    expect(nliNarrativeControlsHtml({ id: "october_7th" }, null, null)).toBe("");
    const html = nliNarrativeControlsHtml({ id: "nli" }, null, null);
    expect(html).toContain('class="nli-narrative-sheet"');
    expect(html).toContain('data-nli-narrative="segev"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain("canva");
    expect(html).not.toContain("iframe");
  });

  test("pending transitions disable narrative buttons without changing selection", async () => {
    const { nliNarrativeControlsHtml } = await import(
      "../../frontend/src/remote/nli-narrative-controls.js"
    );
    const disabled = nliNarrativeControlsHtml({ id: "nli" }, null, "Slideshow owns presentation mode");
    expect(disabled).toMatch(/data-nli-narrative="segev"[^>]*disabled/);
    expect(disabled).toContain("Slideshow owns presentation mode");
    const pendingExit = nliNarrativeControlsHtml(
      { id: "nli" },
      { id: "segev", transition: "enter", revision: 2, transitionPending: true },
      null,
    );
    expect(pendingExit).toMatch(/data-nli-narrative="segev"[^>]*aria-pressed="true"[^>]*disabled/);
  });

  test("renders translated narrative labels in Hebrew and English", async () => {
    const { setLocale } = await import("../../frontend/src/remote/remote-locale.js");
    const { nliNarrativeControlsHtml } = await import(
      "../../frontend/src/remote/nli-narrative-controls.js"
    );
    setLocale("he", { force: true });
    const he = nliNarrativeControlsHtml(
      { id: "nli" },
      { id: "segev", transition: "enter", revision: 1 },
      null,
    );
    expect(he).toContain("משפחת שגב");
    expect(he).toMatch(/aria-label="[^"]+"/);
    setLocale("en", { force: true });
    const en = nliNarrativeControlsHtml(
      { id: "nli" },
      { id: "segev", transition: "enter", revision: 1 },
      null,
    );
    expect(en).toContain("Segev family");
    expect(en).not.toContain("presentation");
  });

  test("lists all narrative buttons and marks the active narrative", async () => {
    const { nliNarrativeControlsHtml } = await import(
      "../../frontend/src/remote/nli-narrative-controls.js"
    );
    const html = nliNarrativeControlsHtml(
      { id: "nli" },
      { id: "nova", transition: "enter", revision: 1 },
      null,
    );
    expect(html.indexOf('data-nli-narrative="segev"'))
      .toBeLessThan(html.indexOf('data-nli-narrative="nova"'));
    expect(html.indexOf('data-nli-narrative="nova"'))
      .toBeLessThan(html.indexOf('data-nli-narrative="sderot"'));
    expect(html.indexOf('data-nli-narrative="sderot"'))
      .toBeLessThan(html.indexOf('data-nli-narrative="hostages"'));
    expect(html).toMatch(/data-nli-narrative="nova"[^>]*aria-pressed="true"/);
    expect(html).not.toContain("data-nli-narrative-presentation");
  });

  test("hostages and Sderot use their own narrative copy", async () => {
    const { setLocale } = await import("../../frontend/src/remote/remote-locale.js");
    const { nliNarrativeControlsHtml } = await import(
      "../../frontend/src/remote/nli-narrative-controls.js"
    );
    setLocale("he", { force: true });
    const he = nliNarrativeControlsHtml(
      { id: "nli" },
      { id: "hostages", transition: "enter", revision: 1 },
      null,
    );
    expect(he).toContain("חטופים");
    expect(he).toContain("שדרות");
    expect(he).toContain("הפעלה או סיום של נרטיב חטופים");
    expect(he).toMatch(/data-nli-narrative="hostages"[^>]*aria-pressed="true"/);
  });

  test("delegates narrative selection to the host", async () => {
    const { consumeNliNarrativeButtonClick } = await import(
      "../../frontend/src/remote/nli-narrative-controls.js"
    );
    const host = { setNarrative: vi.fn() };
    const narrative = { getAttribute: () => "segev" };
    const event = {
      target: { closest: (selector) => selector === "[data-nli-narrative]" ? narrative : null },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    expect(consumeNliNarrativeButtonClick(event, host)).toBe(true);
    expect(host.setNarrative).toHaveBeenCalledWith("segev");
  });
});
