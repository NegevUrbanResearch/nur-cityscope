import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NLI_NARRATIVES } from "../../frontend/src/shared/nli-narratives.js";

function createElement(tagName) {
  return {
    tagName,
    className: "",
    style: {},
    attributes: {},
    children: [],
    parentNode: null,
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    remove() { this.parentNode?.removeChild?.(this); },
    querySelector(selector) {
      if (selector === this.tagName) return this;
      for (const child of this.children) {
        const match = child.querySelector?.(selector);
        if (match) return match;
      }
      return null;
    },
  };
}

function installDom() {
  const listeners = new Map();
  vi.stubGlobal("document", {
    createElement,
    addEventListener: vi.fn((type, handler) => listeners.set(type, handler)),
    removeEventListener: vi.fn((type, handler) => {
      if (listeners.get(type) === handler) listeners.delete(type);
    }),
  });
  return listeners;
}

describe("NLI Canva narrative presentation", () => {
  let container;
  let listeners;

  beforeEach(() => {
    vi.resetModules();
    container = {
      children: [],
      appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
      removeChild(child) { this.children = this.children.filter((item) => item !== child); child.parentNode = null; },
      querySelector(selector) {
        for (const child of this.children) {
          const match = child.querySelector?.(selector);
          if (match) return match;
        }
        return null;
      },
    };
    listeners = installDom();
  });

  afterEach(() => vi.unstubAllGlobals());

  test("mounts only the exact trusted Canva design as a full-viewport iframe", async () => {
    const { createNarrativePresentation } = await import("../../frontend/src/map/nli-narrative-presentation.js");
    const presentation = createNarrativePresentation(container);
    expect(presentation.open({ ...NLI_NARRATIVES.segev, presentationUrl: "https://www.canva.com/design/other/view?embed" })).toBe(false);
    expect(presentation.open({ ...NLI_NARRATIVES.segev, presentationUrl: "https://example.test/design/DAHUaRcI6lI/Of1TuYlj0yaPV-r3UDQOKw/view?embed" })).toBe(false);
    expect(presentation.open(NLI_NARRATIVES.segev)).toBe(true);

    const overlay = container.children[0];
    const frame = overlay.children[0];
    expect(overlay.className).toBe("nli-narrative-presentation");
    expect(frame.tagName).toBe("iframe");
    expect(frame.title).toBe("סיפורה של משפחת שגב – קיבוץ בארי");
    expect(frame.src).toBe(NLI_NARRATIVES.segev.presentationUrl);
    expect(frame.getAttribute("allow")).toBe("fullscreen");
    expect(frame.getAttribute("allowfullscreen")).toBe("");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  test("is idempotent and closes or disposes without invoking scene APIs", async () => {
    const { createNarrativePresentation } = await import("../../frontend/src/map/nli-narrative-presentation.js");
    const scene = { flyTo: vi.fn(), stop: vi.fn(), setBasemap: vi.fn(), setMarker: vi.fn(), setNarrative: vi.fn() };
    const presentation = createNarrativePresentation(container, scene);
    presentation.open(NLI_NARRATIVES.segev);
    const first = container.children[0];
    presentation.open(NLI_NARRATIVES.segev);
    expect(container.children).toEqual([first]);
    expect(presentation.isOpen()).toBe(true);
    expect(presentation.close()).toBe(true);
    expect(presentation.isOpen()).toBe(false);
    presentation.dispose();
    expect(scene.flyTo).not.toHaveBeenCalled();
    expect(scene.stop).not.toHaveBeenCalled();
    expect(scene.setBasemap).not.toHaveBeenCalled();
    expect(scene.setMarker).not.toHaveBeenCalled();
    expect(scene.setNarrative).not.toHaveBeenCalled();
  });

  test("Escape closes an active correlated presentation command", async () => {
    const { createNarrativePresentation } = await import("../../frontend/src/map/nli-narrative-presentation.js");
    const onResult = vi.fn();
    const presentation = createNarrativePresentation(container, { onResult });
    presentation.open(NLI_NARRATIVES.segev, { requestId: "open-7", sourceId: "remote" });
    listeners.get("keydown")({ key: "Escape", preventDefault: vi.fn() });
    expect(onResult).toHaveBeenCalledWith({ outcome: "closed", narrativeId: "segev", requestId: "open-7", sourceId: "remote" });
    expect(presentation.isOpen()).toBe(false);
  });

  test("a reload-closed presentation acknowledges an idempotent close and can reopen", async () => {
    const { createNarrativePresentation } = await import("../../frontend/src/map/nli-narrative-presentation.js");
    const onResult = vi.fn();
    const presentation = createNarrativePresentation(container, { onResult });
    expect(presentation.close({ emitResult: true, command: { narrativeId: "segev", requestId: "close-after-reload" } })).toBe(true);
    expect(onResult).toHaveBeenCalledWith({
      outcome: "closed", narrativeId: "segev", requestId: "close-after-reload", sourceId: null,
    });
    expect(presentation.open(NLI_NARRATIVES.segev, { requestId: "reopen" })).toBe(true);
    expect(presentation.isOpen()).toBe(true);
  });

  test("the production command bridge reports closed after reload instead of leaving the remote open", async () => {
    const { createNarrativePresentation, handleNarrativePresentationCommand } = await import(
      "../../frontend/src/map/nli-narrative-presentation.js"
    );
    const results = [];
    const presentation = createNarrativePresentation(container, { onResult: (result) => results.push(result) });
    const command = { presentationAction: "close", narrativeId: "segev", requestId: "close-reloaded", sourceId: "remote" };
    expect(handleNarrativePresentationCommand({
      command,
      definition: NLI_NARRATIVES.segev,
      presentation,
      emitUnavailable: vi.fn(),
    })).toBe(true);
    expect(results).toEqual([{
      outcome: "closed", narrativeId: "segev", requestId: "close-reloaded", sourceId: "remote",
    }]);
    expect(presentation.open(NLI_NARRATIVES.segev, { requestId: "open-after-reload" })).toBe(true);
  });

  test("Nova open returns false and never assigns an empty iframe src", async () => {
    const { createNarrativePresentation } = await import("../../frontend/src/map/nli-narrative-presentation.js");
    const presentation = createNarrativePresentation(container);
    expect(presentation.open(NLI_NARRATIVES.nova)).toBe(false);
    expect(container.querySelector("iframe")).toBeNull();
  });

  test("close without emitResult still reports the overlay closed", async () => {
    const { createNarrativePresentation } = await import("../../frontend/src/map/nli-narrative-presentation.js");
    const onResult = vi.fn();
    const onOpenChange = vi.fn();
    const presentation = createNarrativePresentation(container, { onResult, onOpenChange });
    expect(presentation.open(NLI_NARRATIVES.segev, { narrativeId: "segev", requestId: "open-1" })).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(presentation.close()).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onResult).not.toHaveBeenCalledWith(expect.objectContaining({ outcome: "closed" }));
    presentation.dispose();
  });
});
