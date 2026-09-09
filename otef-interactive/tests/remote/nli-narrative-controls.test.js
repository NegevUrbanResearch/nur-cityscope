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
    expect(html).not.toContain("data-nli-narrative-presentation");
  });

  test("active closed and open states expose the matching presentation action", async () => {
    const { nliNarrativeControlsHtml } = await import(
      "../../frontend/src/remote/nli-narrative-controls.js"
    );
    const active = { id: "segev", transition: "enter", revision: 1 };
    const closed = nliNarrativeControlsHtml({ id: "nli" }, { ...active, presentationPhase: "closed" }, null);
    expect(closed).toContain('aria-pressed="true"');
    expect(closed).toContain('data-nli-narrative-presentation="open"');
    const open = nliNarrativeControlsHtml({ id: "nli" }, { ...active, presentationPhase: "open" }, null);
    expect(open).toContain('data-nli-narrative-presentation="close"');
    expect(open).not.toContain('data-nli-narrative-presentation="open"');
  });

  test("slideshow and pending transitions disable controls without changing acknowledged selection", async () => {
    const { nliNarrativeControlsHtml } = await import(
      "../../frontend/src/remote/nli-narrative-controls.js"
    );
    const disabled = nliNarrativeControlsHtml({ id: "nli" }, null, "Slideshow owns presentation mode");
    expect(disabled).toMatch(/data-nli-narrative="segev"[^>]*disabled/);
    expect(disabled).toContain("Slideshow owns presentation mode");
    const activeDisabled = nliNarrativeControlsHtml(
      { id: "nli" },
      { id: "segev", transition: "enter", revision: 2, presentationPhase: "closed" },
      "Slideshow owns presentation mode",
    );
    expect(activeDisabled).toMatch(/data-nli-narrative-presentation="open"[^>]*disabled/);
    const pendingExit = nliNarrativeControlsHtml(
      { id: "nli" },
      { id: "segev", transition: "enter", revision: 2, transitionPending: true },
      null,
    );
    expect(pendingExit).toMatch(/data-nli-narrative="segev"[^>]*aria-pressed="true"[^>]*disabled/);
  });

  test("renders translated visible and accessible labels in Hebrew and English", async () => {
    const { setLocale } = await import("../../frontend/src/remote/remote-locale.js");
    const { nliNarrativeControlsHtml } = await import(
      "../../frontend/src/remote/nli-narrative-controls.js"
    );
    setLocale("he", { force: true });
    const he = nliNarrativeControlsHtml(
      { id: "nli" },
      { id: "segev", transition: "enter", revision: 1, presentationPhase: "open" },
      null,
    );
    expect(he).toContain("\u05de\u05e9\u05e4\u05d7\u05ea \u05e9\u05d2\u05d1");
    expect(he).toContain("\u05e1\u05d2\u05d5\u05e8 \u05de\u05e6\u05d2\u05ea");
    expect(he).toMatch(/aria-label="[^"]+"/);
    setLocale("en", { force: true });
    const en = nliNarrativeControlsHtml(
      { id: "nli" },
      { id: "segev", transition: "enter", revision: 1, presentationPhase: "closed" },
      null,
    );
    expect(en).toContain("Segev family");
    expect(en).toContain("Open presentation");
    expect(en).toContain('aria-label="Open Segev family presentation"');
  });

  test("delegates narrative and presentation buttons to the host", async () => {
    const { consumeNliNarrativeButtonClick } = await import(
      "../../frontend/src/remote/nli-narrative-controls.js"
    );
    const host = { setNarrative: vi.fn(), runNarrativePresentation: vi.fn() };
    const event = (selector, element) => ({
      target: { closest: (asked) => asked === selector ? element : null },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });
    const narrative = { getAttribute: () => "segev", getAttributeNames: () => [] };
    const narrativeEvent = event("[data-nli-narrative]", narrative);
    expect(consumeNliNarrativeButtonClick(narrativeEvent, host)).toBe(true);
    expect(host.setNarrative).toHaveBeenCalledWith("segev");

    const presentation = {
      getAttribute: (name) => name === "data-nli-narrative-presentation" ? "open" : "segev",
    };
    const presentationEvent = event("[data-nli-narrative-presentation]", presentation);
    expect(consumeNliNarrativeButtonClick(presentationEvent, host)).toBe(true);
    expect(host.runNarrativePresentation).toHaveBeenCalledWith("open", "segev");
  });

  test("presentation state changes only after a correlated result", async () => {
    const { createNliNarrativePresentationController } = await import(
      "../../frontend/src/remote/nli-narrative-controls.js"
    );
    let resultListener;
    const dataContext = {
      subscribe: vi.fn((topic, listener) => {
        if (topic === "narrativePresentationResult") resultListener = listener;
        return vi.fn();
      }),
      narrativePresentationCommand: vi.fn().mockResolvedValue({ acknowledged: true }),
    };
    const states = [];
    const controller = createNliNarrativePresentationController({
      dataContext,
      requestId: () => "narrative-1",
      onStateChange: (state) => states.push(state),
    });
    const opening = controller.run("open", "segev");
    await Promise.resolve();
    expect(controller.getState().phase).toBe("opening");
    resultListener({ outcome: "opened", narrativeId: "segev", requestId: "other" });
    expect(controller.getState().phase).toBe("opening");
    resultListener({ outcome: "opened", narrativeId: "segev", requestId: "narrative-1" });
    await expect(opening).resolves.toMatchObject({ outcome: "opened" });
    expect(controller.getState().phase).toBe("open");
    expect(states.at(-1).phase).toBe("open");
  });

  test("close result, unavailable, timeout, and command failure preserve non-optimistic rollback", async () => {
    vi.useFakeTimers();
    const { createNliNarrativePresentationController } = await import(
      "../../frontend/src/remote/nli-narrative-controls.js"
    );
    let resultListener;
    let request = 0;
    const dataContext = {
      subscribe: vi.fn((topic, listener) => {
        if (topic === "narrativePresentationResult") resultListener = listener;
        return vi.fn();
      }),
      narrativePresentationCommand: vi.fn().mockResolvedValue({ acknowledged: true }),
    };
    const controller = createNliNarrativePresentationController({
      dataContext,
      timeoutMs: 10,
      requestId: () => `request-${++request}`,
    });

    const opening = controller.run("open", "segev");
    await Promise.resolve();
    resultListener({ outcome: "opened", narrativeId: "segev", requestId: "request-1" });
    await opening;
    const closing = controller.run("close", "segev");
    await Promise.resolve();
    expect(controller.getState().phase).toBe("closing");
    resultListener({ outcome: "closed", narrativeId: "segev", requestId: "request-2" });
    await expect(closing).resolves.toMatchObject({ outcome: "closed" });
    expect(controller.getState().phase).toBe("closed");

    const unavailable = controller.run("open", "segev");
    await Promise.resolve();
    resultListener({ outcome: "unavailable", narrativeId: "segev", requestId: "request-3" });
    await expect(unavailable).resolves.toMatchObject({ outcome: "unavailable" });
    expect(controller.getState()).toMatchObject({ phase: "closed", error: "unavailable" });

    const timedOut = controller.run("open", "segev");
    await vi.advanceTimersByTimeAsync(11);
    await expect(timedOut).resolves.toMatchObject({ outcome: "unavailable" });
    expect(controller.getState()).toMatchObject({ phase: "closed", error: "unavailable" });

    const failedCloseSeed = controller.run("open", "segev");
    await Promise.resolve();
    resultListener({ outcome: "opened", narrativeId: "segev", requestId: "request-5" });
    await failedCloseSeed;
    dataContext.narrativePresentationCommand.mockRejectedValueOnce(new Error("network"));
    await expect(controller.run("close", "segev")).resolves.toMatchObject({ outcome: "unavailable" });
    expect(controller.getState()).toMatchObject({ phase: "open", error: "unavailable" });
  });

  test("reset closes presentation state when the acknowledged narrative id changes", async () => {
    const { createNliNarrativePresentationController } = await import(
      "../../frontend/src/remote/nli-narrative-controls.js"
    );
    let resultListener;
    const dataContext = {
      subscribe: vi.fn((_topic, listener) => { resultListener = listener; return vi.fn(); }),
      narrativePresentationCommand: vi.fn().mockResolvedValue({ acknowledged: true }),
    };
    const controller = createNliNarrativePresentationController({
      dataContext,
      requestId: () => "request-reset",
    });
    const opening = controller.run("open", "segev");
    await Promise.resolve();
    resultListener({ outcome: "opened", narrativeId: "segev", requestId: "request-reset" });
    await opening;

    controller.reset("future-narrative");

    expect(controller.getState()).toMatchObject({ phase: "closed", id: null, requestId: null });
  });

  test("accepts a GIS close after reload only when it correlates to the acknowledged open request", async () => {
    const { createNliNarrativePresentationController } = await import(
      "../../frontend/src/remote/nli-narrative-controls.js"
    );
    let resultListener;
    const controller = createNliNarrativePresentationController({
      dataContext: {
        subscribe: vi.fn((_topic, listener) => { resultListener = listener; return vi.fn(); }),
        narrativePresentationCommand: vi.fn().mockResolvedValue({ acknowledged: true }),
      },
      requestId: () => "open-request",
    });
    const opening = controller.run("open", "segev");
    await Promise.resolve();
    resultListener({ outcome: "opened", narrativeId: "segev", requestId: "open-request" });
    await opening;

    expect(controller.handleResult({ outcome: "closed", narrativeId: "segev", requestId: "spoofed" })).toBe(false);
    expect(controller.getState()).toMatchObject({ phase: "open", id: "segev" });
    expect(controller.handleResult({ outcome: "closed", narrativeId: "segev", requestId: "open-request" })).toBe(true);
    expect(controller.getState()).toMatchObject({ phase: "closed", id: null, requestId: null });
  });

  test("destroying a pending presentation never notifies a stale sheet observer", async () => {
    const { createNliNarrativePresentationController } = await import(
      "../../frontend/src/remote/nli-narrative-controls.js"
    );
    const onStateChange = vi.fn();
    const controller = createNliNarrativePresentationController({
      dataContext: {
        subscribe: vi.fn(() => vi.fn()),
        narrativePresentationCommand: vi.fn(() => new Promise(() => {})),
      },
      requestId: () => "pending-request",
      onStateChange,
    });
    void controller.run("open", "segev");
    await Promise.resolve();
    onStateChange.mockClear();

    controller.destroy();

    expect(onStateChange).not.toHaveBeenCalled();
  });
});
