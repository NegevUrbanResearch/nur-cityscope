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
      { individual: true, overlap: true, mor: false, settled: false },
      ["individual"],
    );
    expect(html).toContain('data-nli-nova-escape="individual"');
    expect(html).not.toContain('data-nli-nova-escape="overlap"');
    expect(html).not.toContain('data-nli-nova-escape="mor"');
    expect(html).toContain("Fleeing routes");
    expect(html).not.toContain("Fleeing density (overlap count)");
    expect(html).toContain("Routes from Nova");
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain("data-nli-narrative");
    expect(html).not.toMatch(/\bEscape\b|survived|people count|COUNT_/);
    expect(nliNovaEscapeTogglesHtml(
      { id: "segev", transition: "enter", revision: 1 },
      { individual: true },
      ["individual"],
    )).toBe("");
    expect(nliNovaEscapeTogglesHtml(
      { id: "nova", transition: "enter", revision: 1 },
      { settled: true },
    )).toBe("");
    setLocale("he", { force: true });
    const he = nliNovaEscapeTogglesHtml(
      { id: "nova", transition: "enter", revision: 1 },
      { individual: true, overlap: false },
      ["individual"],
    );
    expect(he).toContain("צירי בריחה");
    expect(he).not.toContain("צירי בריחה לפי צפיפות");
    const heCopy = [
      ...(he.matchAll(/aria-label="([^"]*)"/g)),
    ].map((match) => match[1]).join(" ") + he.replace(/<[^>]+>/g, " ");
    expect(heCopy).not.toMatch(/Escape|survived/i);
  });

  test("explicit individual and Mor kinds render even when the live flag is off", async () => {
    const { setLocale } = await import("../../frontend/src/remote/remote-locale.js");
    const { materialIcon } = await import("../../frontend/src/remote/nli-staff-icons.js");
    const { nliNovaEscapeTogglesHtml } = await import(
      "../../frontend/src/remote/nli-nova-escape-toggles.js"
    );
    setLocale("en", { force: true });
    const individual = nliNovaEscapeTogglesHtml(
      { id: "nova", transition: "enter", revision: 1 },
      { individual: false, overlap: true, mor: true, settled: false },
      ["individual"],
    );
    expect(individual).toContain('data-nli-nova-escape="individual"');
    expect(individual).toContain('aria-pressed="false"');
    expect(individual).toContain("Start animation");
    expect(individual).toContain(materialIcon("play"));
    expect(individual).not.toContain("Fleeing density (overlap count)");
    expect(individual).not.toContain('data-nli-nova-escape="mor"');

    const mor = nliNovaEscapeTogglesHtml(
      { id: "nova", transition: "enter", revision: 1 },
      { individual: true, overlap: true, mor: false, settled: false },
      ["mor"],
    );
    expect(mor).toContain('data-nli-nova-escape="mor"');
    expect(mor).toContain("Mor Levy route");
    expect(mor).toContain("Start animation");
    expect(mor).toContain(materialIcon("play"));
    expect(mor).toContain('aria-pressed="false"');
    expect(mor).not.toContain('data-nli-nova-escape="individual"');
    expect(mor).not.toContain('data-nli-nova-escape="overlap"');
  });

  test("route controls name their start and stop action in Hebrew and English", async () => {
    const { setLocale } = await import("../../frontend/src/remote/remote-locale.js");
    const { materialIcon } = await import("../../frontend/src/remote/nli-staff-icons.js");
    const { nliNovaEscapeTogglesHtml } = await import(
      "../../frontend/src/remote/nli-nova-escape-toggles.js"
    );
    const state = { id: "nova", transition: "enter", revision: 1 };

    setLocale("en", { force: true });
    const stopped = nliNovaEscapeTogglesHtml(state, { individual: false, mor: false }, ["individual", "mor"]);
    expect(stopped.match(/Start animation/g)).toHaveLength(2);
    expect(stopped).toContain(materialIcon("play"));
    const running = nliNovaEscapeTogglesHtml(state, { individual: true, mor: true }, ["individual", "mor"]);
    expect(running.match(/Stop animation/g)).toHaveLength(2);
    expect(running).toContain(materialIcon("stop"));

    setLocale("he", { force: true });
    const stoppedHe = nliNovaEscapeTogglesHtml(state, { individual: false, mor: false }, ["individual", "mor"]);
    expect(stoppedHe.match(/הפעלת אנימציה/g)).toHaveLength(2);
    const runningHe = nliNovaEscapeTogglesHtml(state, { individual: true, mor: true }, ["individual", "mor"]);
    expect(runningHe.match(/עצירת אנימציה/g)).toHaveLength(2);
  });

  test("click PATCHes overlay and does not setNarrative", async () => {
    const { consumeNliNovaEscapeClick } = await import(
      "../../frontend/src/remote/nli-nova-escape-toggles.js"
    );
    const host = { setEscapeOverlay: vi.fn(), setNarrative: vi.fn() };
    const event = clickEvent('[data-nli-nova-escape="mor"]');
    consumeNliNovaEscapeClick(event, host);
    expect(host.setEscapeOverlay).toHaveBeenCalledWith({ mor: true });
    expect(host.setNarrative).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  test("staff remote keeps in-flow Nova escape toggles after the regular panel drops them", () => {
    const staffRemote = fs.readFileSync(
      path.resolve(here, "../../frontend/src/remote/nli-staff-remote.js"),
      "utf8",
    );
    const layerSheet = fs.readFileSync(
      path.resolve(here, "../../frontend/src/remote/layer-sheet-controller.js"),
      "utf8",
    );
    expect(staffRemote).toContain("nliNovaEscapeTogglesHtml(");
    expect(staffRemote).toContain("escapeKinds");
    expect(staffRemote).toContain("consumeNliNovaEscapeClick(");
    expect(layerSheet).not.toContain("nliNovaEscapeTogglesHtml(");
    expect(layerSheet).not.toContain("consumeNliNovaEscapeClick(");
    expect(layerSheet).not.toContain("setEscapeOverlay");

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
