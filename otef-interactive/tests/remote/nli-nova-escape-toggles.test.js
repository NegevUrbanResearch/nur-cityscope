import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));

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

function clickEvent(selector) {
  const match = /data-nli-nova-escape="([^"]+)"/.exec(selector);
  const kind = match?.[1] || "overlap";
  const element = {
    getAttribute: (name) => {
      if (name === "data-nli-nova-escape") return kind;
      if (name === "aria-pressed") return "false";
      return null;
    },
  };
  return {
    target: {
      closest: (asked) =>
        asked === "[data-nli-nova-escape]" || asked === selector ? element : null,
    },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

describe("remote Nova fleeing overlay toggles", () => {
  beforeEach(() => {
    vi.resetModules();
    installLocaleEnvironment();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("toggles render only for nova and lock fleeing copy", async () => {
    const { setLocale } = await import("../../frontend/src/remote/remote-locale.js");
    const { nliNovaEscapeTogglesHtml } = await import(
      "../../frontend/src/remote/nli-nova-escape-toggles.js"
    );
    setLocale("en", { force: true });
    const html = nliNovaEscapeTogglesHtml(
      { id: "nova", transition: "enter", revision: 1 },
      { individual: true, overlap: false },
    );
    expect(html).toContain('data-nli-nova-escape="individual"');
    expect(html).toContain('data-nli-nova-escape="overlap"');
    expect(html).toContain("Fleeing routes");
    expect(html).toContain("Fleeing density (overlap count)");
    expect(html).toContain("Test layers for routes from Nova, not survival paths");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toMatch(/data-nli-nova-escape="overlap"[^>]*aria-pressed="false"/);
    expect(html).not.toContain("data-nli-narrative");
    expect(html).not.toMatch(/\bEscape\b|survived|people count|COUNT_/);
    expect(nliNovaEscapeTogglesHtml({ id: "segev", transition: "enter", revision: 1 }, { individual: true })).toBe("");
    setLocale("he", { force: true });
    const he = nliNovaEscapeTogglesHtml(
      { id: "nova", transition: "enter", revision: 1 },
      { individual: true, overlap: false },
    );
    expect(he).toContain("צירי בריחה לפי צפיפות");
    const heCopy = [
      ...(he.matchAll(/aria-label="([^"]*)"/g)),
    ].map((match) => match[1]).join(" ") + he.replace(/<[^>]+>/g, " ");
    expect(heCopy).not.toMatch(/Escape|survived/i);
  });

  test("click PATCHes overlay and does not setNarrative", async () => {
    const { consumeNliNovaEscapeClick } = await import(
      "../../frontend/src/remote/nli-nova-escape-toggles.js"
    );
    const host = { setEscapeOverlay: vi.fn(), setNarrative: vi.fn() };
    const event = clickEvent('[data-nli-nova-escape="overlap"]');
    consumeNliNovaEscapeClick(event, host);
    expect(host.setEscapeOverlay).toHaveBeenCalledWith({ overlap: true });
    expect(host.setNarrative).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  test("timeline extras concatenate narrative then fleeing toggles then transport, in-flow", () => {
    const layerSheet = fs.readFileSync(
      path.resolve(here, "../../frontend/src/remote/layer-sheet-controller.js"),
      "utf8",
    );
    const extras = layerSheet.indexOf("`${narrativeSheet}${escapeToggles}${nliSheet}`");
    expect(extras).toBeGreaterThan(-1);
    expect(layerSheet.indexOf("${narrativeSheet}")).toBeLessThan(layerSheet.indexOf("${escapeToggles}"));
    expect(layerSheet.indexOf("${escapeToggles}")).toBeLessThan(layerSheet.indexOf("${nliSheet}"));
    expect(layerSheet.indexOf("consumeNliPackPaneClick(e, this)"))
      .toBeLessThan(layerSheet.indexOf("consumeNliNovaEscapeClick(e, this)"));
    expect(layerSheet.indexOf("consumeNliNovaEscapeClick(e, this)"))
      .toBeLessThan(layerSheet.indexOf("consumeNliNarrativeButtonClick(e, this)"));
    expect(layerSheet).toContain("setEscapeOverlay");
    expect(layerSheet).toContain('_subscribeDataContext("escapeOverlay"');

    const css = fs.readFileSync(
      path.resolve(here, "../../frontend/css/remote-styles.css"),
      "utf8",
    );
    const block = css.match(/\.nli-nova-escape-toggles\s*\{([^}]*)\}/s);
    expect(block, "Missing CSS block for .nli-nova-escape-toggles").toBeTruthy();
    expect(block[1]).not.toMatch(/position:\s*absolute/);
  });

  test("toggle labels wrap so shared fleeing prefixes stay distinguishable at 400px", () => {
    const css = fs.readFileSync(
      path.resolve(here, "../../frontend/css/remote-styles.css"),
      "utf8",
    );
    const toggle = css.match(/\.nli-nova-escape-toggle\s*\{([^}]*)\}/s);
    expect(toggle, "Missing CSS block for .nli-nova-escape-toggle").toBeTruthy();
    expect(toggle[1]).toMatch(/white-space:\s*normal/);
    expect(toggle[1]).not.toMatch(/white-space:\s*nowrap/);
    expect(toggle[1]).not.toMatch(/text-overflow:\s*ellipsis/);
    expect(toggle[1]).not.toMatch(/position:\s*absolute/);
  });
});
