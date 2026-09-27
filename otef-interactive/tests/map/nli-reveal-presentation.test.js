// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import rawManifest from "../../public/presentation/nli-presentation-manifest.json";
import { validateNliPresentationManifest } from "../../frontend/src/shared/nli-presentation-manifest.js";
import { createNliRevealPresentation } from "../../frontend/src/map/nli-reveal-presentation.js";

const manifest = validateNliPresentationManifest(rawManifest);
const videoFirstManifest = {
  ...manifest,
  segments: [
    ...manifest.segments,
    { id: "clip", requiredNarrative: null, range: [2, 3] },
  ],
};

let root;
let sequence = 0;

class FakeReveal {
  constructor(element, options) {
    FakeReveal.lastInstance = this;
    this.element = element;
    this.options = options;
    this.index = 0;
    this.handlers = new Map();
  }
  markPresent(index) {
    const sections = [...this.element.querySelectorAll("section")];
    sections.forEach((section, number) => section.classList.toggle("present", number === index));
  }
  async initialize() { this.markPresent(0); }
  slide(index) {
    const previousSlide = this.element.querySelectorAll("section")[this.index];
    this.index = index;
    this.markPresent(index);
    this.handlers.get("slidechanged")?.({
      previousSlide, currentSlide: this.element.querySelectorAll("section")[index],
    });
  }
  getIndices() { return { h: this.index, v: 0 }; }
  on(name, handler) { this.handlers.set(name, handler); }
  destroy() { this.destroyed = true; }
  slideNumbers() {
    return [...this.element.querySelectorAll("section")]
      .map((section) => Number(section.dataset.slide));
  }
}

function command(presentationAction, overrides = {}) {
  const id = ++sequence;
  return {
    presentationAction,
    segmentId: "segev",
    presentationSessionId: "session-current",
    presentationGeneration: 10,
    sequence: id,
    requestId: `request-${id}`,
    ...overrides,
  };
}

function makeHarness() {
  const results = [];
  const correlation = {
    segmentId: "segev",
    presentationSessionId: "session-current",
    presentationGeneration: 10,
  };
  const viewer = createNliRevealPresentation(root, {
    manifest,
    RevealClass: FakeReveal,
    emitResult: (value) => results.push(value),
  });
  const start = (action, overrides = {}) => {
    if (action === "open") Object.assign(correlation, overrides);
    return viewer.handleCommand(command(action, { ...correlation, ...overrides }));
  };
  return {
    viewer,
    get reveal() { return FakeReveal.lastInstance; },
    results,
    start,
    async send(action, overrides = {}) {
      const pending = start(action, overrides);
      for (let attempt = 0; attempt < 12; attempt += 1) {
        root.querySelector("section.present img")?.dispatchEvent(new Event("load"));
        await Promise.resolve();
      }
      await new Promise((resolve) => { requestAnimationFrame(() => requestAnimationFrame(resolve)); });
      root.querySelector(".nli-reveal-overlay")?.dispatchEvent(
        new TransitionEvent("transitionend", { propertyName: "opacity", bubbles: true }),
      );
      return pending;
    },
    lastResult: () => results.at(-1),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  sequence = 0;
  FakeReveal.lastInstance = null;
  document.body.innerHTML = '<div id="map"></div>';
  root = document.querySelector("#map");
});

describe("GIS Reveal presentation", () => {
  test("opens the requested range and clamps at both boundaries", async () => {
    const h = makeHarness();
    await h.send("open", { segmentId: "nova_mor" });
    expect(h.reveal.slideNumbers()).toEqual([9, 10, 11]);
    const slide = vi.spyOn(h.reveal, "slide");
    await h.send("previous");
    expect(slide).not.toHaveBeenCalled();
    expect(h.lastResult()).toMatchObject({ outcome: "ready", slide: 9, range: [9, 11] });
    await h.send("next");
    await h.send("next");
    const reveal = h.reveal;
    await h.send("next");
    expect(h.lastResult().slide).toBe(11);
    expect(reveal.index).toBe(2);
    expect(slide).toHaveBeenCalledTimes(2);
  });

  test("rejects an older delayed open without replacing the active segment", async () => {
    const h = makeHarness();
    await h.send("open", { segmentId: "nova_mor", presentationGeneration: 20 });
    await h.send("open", {
      segmentId: "segev", presentationGeneration: 19, presentationSessionId: "delayed",
    });
    expect(h.reveal.slideNumbers()).toEqual([9, 10, 11]);
    expect(h.lastResult().outcome).toBe("ignored");
  });

  test("disables Reveal navigation and presentation transitions", async () => {
    const h = makeHarness();
    await h.send("open", { segmentId: "segev" });
    expect(h.reveal.options).toMatchObject({
      embedded: true, controls: false, progress: false, keyboard: false,
      touch: false, hash: false, transition: "none", backgroundTransition: "none",
      width: 960, height: 540, margin: 0,
    });
  });

  test("ignores mismatched sessions, generations, and non-increasing sequences", async () => {
    const h = makeHarness();
    await h.send("open", { segmentId: "segev" });
    const before = h.results.length;
    const slideIndex = h.reveal.index;
    await h.send("next", { presentationSessionId: "other" });
    await h.send("next", { presentationGeneration: 11 });
    await h.send("next", { segmentId: "nova_mor" });
    await h.send("next", { sequence: 1 });
    expect(h.results.slice(before).map((result) => result.outcome)).toEqual([
      "ignored", "ignored", "ignored", "ignored",
    ]);
    expect(h.reveal.index).toBe(slideIndex);
  });

  test("autoplays unmuted video, stays on completion, and rewinds it on leave", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const h = makeHarness();
    await h.send("open", { segmentId: "segev" });
    await h.send("next");
    const video = root.querySelector("section.present video");
    expect(video.muted).toBe(false);
    expect(video.play).toHaveBeenCalledOnce();
    video.dispatchEvent(new Event("ended"));
    expect(h.reveal.index).toBe(1);
    await h.send("previous");
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.currentTime).toBe(0);
  });

  test("keeps inactive segment videos ineligible for native autoplay", async () => {
    const h = makeHarness();
    await h.send("open", { segmentId: "shura" });
    const videos = [...root.querySelectorAll(".nli-reveal-overlay video")];
    expect(videos).toHaveLength(2);
    expect(videos.every((video) => !video.autoplay && !video.hasAttribute("autoplay"))).toBe(true);
    const firstPlayCall = HTMLMediaElement.prototype.play.mock.contexts.length;
    await h.send("next");
    const activatedVideos = HTMLMediaElement.prototype.play.mock.contexts.slice(firstPlayCall);
    expect(activatedVideos).toContain(videos[0]);
    expect(activatedVideos).not.toContain(videos[1]);
    expect(videos[1].autoplay).toBe(false);
  });

  test("close pauses and rewinds the active video", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const h = makeHarness();
    await h.send("open", { segmentId: "segev" });
    await h.send("next");
    const video = root.querySelector("section.present video");
    await h.send("close");
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.currentTime).toBe(0);
    expect(root.querySelector(".nli-reveal-overlay")).toBeNull();
  });

  test("tears down and reports an image load error", async () => {
    const h = makeHarness();
    const opening = h.start("open", { segmentId: "segev" });
    for (let attempt = 0; attempt < 12; attempt += 1) {
      root.querySelector("section.present img")?.dispatchEvent(new Event("error"));
      await Promise.resolve();
    }
    await opening;
    expect(h.lastResult().outcome).toBe("unavailable");
    expect(root.querySelector(".nli-reveal-overlay")).toBeNull();
  });

  test("tears down and reports rejected video playback", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error("NotAllowedError"));
    const h = makeHarness();
    await h.send("open", { segmentId: "segev" });
    await h.send("next");
    expect(h.lastResult().outcome).toBe("unavailable");
    expect(root.querySelector(".nli-reveal-overlay")).toBeNull();
  });

  test("an older rejected initialization cannot tear down a newer Open", async () => {
    let rejectFirstInitialization;
    let instanceCount = 0;
    class DeferredFirstReveal extends FakeReveal {
      async initialize() {
        instanceCount += 1;
        if (instanceCount === 1) {
          return new Promise((_, reject) => { rejectFirstInitialization = reject; });
        }
        return super.initialize();
      }
    }
    const results = [];
    const viewer = createNliRevealPresentation(root, {
      manifest,
      RevealClass: DeferredFirstReveal,
      emitResult: (result) => results.push(result),
    });
    const firstOpen = viewer.handleCommand(command("open", {
      segmentId: "segev", presentationSessionId: "first", presentationGeneration: 10,
    }));
    const newerOpen = viewer.handleCommand(command("open", {
      segmentId: "nova_mor", presentationSessionId: "newer", presentationGeneration: 11,
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    root.querySelector("section.present img")?.dispatchEvent(new Event("load"));
    await newerOpen;
    rejectFirstInitialization(new Error("superseded initialization failed"));
    await firstOpen;

    expect(root.querySelectorAll(".nli-reveal-overlay section")).toHaveLength(3);
    expect(root.querySelector(".nli-reveal-overlay section")?.dataset.slide).toBe("9");
    expect(results.map(({ outcome }) => outcome)).toEqual(["opened"]);
    viewer.dispose();
  });

  test("dispose removes the overlay and rewinds any video", async () => {
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const h = makeHarness();
    await h.send("open", { segmentId: "segev" });
    await h.send("next");
    const video = root.querySelector("section.present video");
    h.viewer.dispose();
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.currentTime).toBe(0);
    expect(root.querySelector(".nli-reveal-overlay")).toBeNull();
  });
});

function overlay() {
  return root.querySelector(".nli-reveal-overlay");
}

function endOpacityFade(node = overlay()) {
  node?.dispatchEvent(new TransitionEvent("transitionend", { propertyName: "opacity", bubbles: true }));
}

function deferDecode() {
  if (typeof HTMLImageElement.prototype.decode !== "function") {
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      configurable: true,
      writable: true,
      value() { return Promise.resolve(); },
    });
  }
  const gates = [];
  vi.spyOn(HTMLImageElement.prototype, "decode").mockImplementation(() => new Promise((resolve, reject) => {
    gates.push({ resolve, reject });
  }));
  return gates;
}

function reducedMotion() {
  vi.stubGlobal("matchMedia", (query) => ({
    matches: query === "(prefers-reduced-motion: reduce)",
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
}

describe("presentation open and close lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete HTMLImageElement.prototype.decode;
  });

  test("emits opened only after the first image decodes and the 600ms overlay fade", async () => {
    vi.useFakeTimers();
    const gates = deferDecode();
    const h = makeHarness();
    const opening = h.start("open", { segmentId: "segev" });
    await vi.advanceTimersByTimeAsync(0);
    expect(gates).toHaveLength(1);
    expect(overlay().style.opacity).toBe("0");
    expect(h.results).toEqual([]);
    gates[0].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(overlay().style.opacity).toBe("0");
    await vi.advanceTimersByTimeAsync(16);
    expect(overlay().style.opacity).toBe("1");
    expect(h.results).toEqual([]);
    await vi.advanceTimersByTimeAsync(599);
    expect(h.results).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await opening;
    expect(h.lastResult()).toMatchObject({ outcome: "opened", slide: 1 });
    expect(h.reveal.options.transition).toBe("none");
  });

  test("image decode failure or timeout removes the hidden viewer and does not emit opened", async () => {
    vi.useFakeTimers();
    const gates = deferDecode();
    const h = makeHarness();
    const timed = h.start("open", { segmentId: "segev", presentationGeneration: 10 });
    await vi.advanceTimersByTimeAsync(1499);
    expect(h.results).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.results.map((result) => result.outcome)).toEqual(["unavailable"]);
    expect(overlay()).toBeNull();
    await timed;

    const rejected = deferDecode();
    const failing = h.start("open", { segmentId: "segev", presentationGeneration: 11 });
    await vi.advanceTimersByTimeAsync(0);
    rejected[0].reject(new Error("decode failed"));
    await failing;
    expect(h.results.map((result) => result.outcome)).toEqual(["unavailable", "unavailable"]);
    expect(overlay()).toBeNull();
  });

  test("reduced motion snaps opacity on the frame after readiness without transitionend", async () => {
    vi.useFakeTimers();
    reducedMotion();
    const gates = deferDecode();
    const h = makeHarness();
    const opening = h.start("open", { segmentId: "segev" });
    await vi.advanceTimersByTimeAsync(0);
    gates[0].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.results).toEqual([]);
    await vi.advanceTimersByTimeAsync(16);
    await opening;
    expect(overlay().style.opacity).toBe("1");
    expect(h.lastResult().outcome).toBe("opened");
  });

  test("starts a first-slide video only after the fade and within 1500ms", async () => {
    vi.useFakeTimers();
    let resolvePlay;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => new Promise((resolve) => {
      resolvePlay = resolve;
    }));
    const gates = deferDecode();
    const results = [];
    const viewer = createNliRevealPresentation(root, {
      manifest: videoFirstManifest,
      RevealClass: FakeReveal,
      emitResult: (result) => results.push(result),
    });
    const opening = viewer.handleCommand(command("open", {
      segmentId: "clip", presentationGeneration: 12, presentationSessionId: "clip-session",
    }));
    await vi.advanceTimersByTimeAsync(0);
    gates[0].resolve();
    await vi.advanceTimersByTimeAsync(16);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    endOpacityFade();
    await vi.advanceTimersByTimeAsync(0);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    expect(results).toEqual([]);
    await vi.advanceTimersByTimeAsync(1499);
    expect(results).toEqual([]);
    resolvePlay();
    await opening;
    expect(results.map((result) => result.outcome)).toEqual(["opened"]);
  });

  test("first-slide video rejection or timeout emits unavailable instead of opened", async () => {
    vi.useFakeTimers();
    let rejectPlay;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => new Promise((_, reject) => {
      rejectPlay = reject;
    }));
    const gates = deferDecode();
    const results = [];
    const viewer = createNliRevealPresentation(root, {
      manifest: videoFirstManifest,
      RevealClass: FakeReveal,
      emitResult: (result) => results.push(result),
    });
    const opening = viewer.handleCommand(command("open", {
      segmentId: "clip", presentationGeneration: 12, presentationSessionId: "clip-session",
    }));
    await vi.advanceTimersByTimeAsync(0);
    gates[0].resolve();
    await vi.advanceTimersByTimeAsync(16);
    endOpacityFade();
    await vi.advanceTimersByTimeAsync(0);
    rejectPlay(new Error("NotAllowedError"));
    await opening;
    expect(results.map((result) => result.outcome)).toEqual(["unavailable"]);
    expect(overlay()).toBeNull();

    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => new Promise(() => {}));
    const slowGates = deferDecode();
    const slow = viewer.handleCommand(command("open", {
      segmentId: "clip", presentationGeneration: 13, presentationSessionId: "clip-session-2",
    }));
    await vi.advanceTimersByTimeAsync(0);
    slowGates.at(-1).resolve();
    await vi.advanceTimersByTimeAsync(16);
    endOpacityFade();
    await vi.advanceTimersByTimeAsync(1499);
    expect(results).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await slow;
    expect(results.at(-1).outcome).toBe("unavailable");
    expect(results.filter((result) => result.outcome === "opened")).toHaveLength(0);
  });

  test("bounds the entire local open, including Reveal initialization, to 4500ms", async () => {
    vi.useFakeTimers();
    class HungReveal extends FakeReveal {
      async initialize() { return new Promise(() => {}); }
    }
    const results = [];
    const viewer = createNliRevealPresentation(root, {
      manifest,
      RevealClass: HungReveal,
      emitResult: (result) => results.push(result),
    });
    const opening = viewer.handleCommand(command("open", { segmentId: "segev" }));
    await vi.advanceTimersByTimeAsync(4499);
    expect(results).toEqual([]);
    expect(overlay()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(results.map((result) => result.outcome)).toEqual(["unavailable"]);
    expect(overlay()).toBeNull();
    await opening;
  });

  test("transitionend and the fade fallback complete an open only once", async () => {
    vi.useFakeTimers();
    const gates = deferDecode();
    const h = makeHarness();
    const opening = h.start("open", { segmentId: "segev" });
    await vi.advanceTimersByTimeAsync(0);
    gates[0].resolve();
    await vi.advanceTimersByTimeAsync(16);
    overlay().dispatchEvent(new TransitionEvent("transitionend", { propertyName: "width", bubbles: true }));
    expect(h.results).toEqual([]);
    endOpacityFade();
    await vi.advanceTimersByTimeAsync(600);
    await opening;
    expect(h.results.map((result) => result.outcome)).toEqual(["opened"]);
  });

  test("close during image wait or open fade never emits opened", async () => {
    vi.useFakeTimers();
    const gates = deferDecode();
    const h = makeHarness();
    const opening = h.start("open", { segmentId: "segev" });
    await vi.advanceTimersByTimeAsync(0);
    const closing = h.viewer.handleCommand(command("close", { sequence: 50 }));
    expect(closing).toBeInstanceOf(Promise);
    gates[0].resolve();
    await vi.advanceTimersByTimeAsync(16);
    expect(h.results.map((result) => result.outcome)).not.toContain("opened");
    await vi.advanceTimersByTimeAsync(600);
    await closing;
    await opening;
    expect(h.results.map((result) => result.outcome)).toEqual(["closed"]);
    expect(overlay()).toBeNull();
  });

  test("public close fades and dispose during that fade removes the viewer immediately", async () => {
    vi.useFakeTimers();
    const gates = deferDecode();
    const h = makeHarness();
    const opening = h.start("open", { segmentId: "segev" });
    await vi.advanceTimersByTimeAsync(0);
    gates[0].resolve();
    await vi.advanceTimersByTimeAsync(16);
    endOpacityFade();
    await opening;
    const videoSlide = h.start("next");
    await vi.advanceTimersByTimeAsync(0);
    gates.at(-1).resolve();
    await videoSlide;
    const video = root.querySelector("section.present video");
    const closing = h.viewer.close();
    expect(closing).toBeInstanceOf(Promise);
    expect(video.pause).toHaveBeenCalled();
    expect(overlay()).not.toBeNull();
    h.viewer.dispose();
    expect(overlay()).toBeNull();
    await closing;
    await vi.advanceTimersByTimeAsync(600);
    expect(h.results.filter((result) => result.outcome === "closed")).toHaveLength(0);
  });

  test("a new open during close survives the old fade completion", async () => {
    vi.useFakeTimers();
    const gates = deferDecode();
    const h = makeHarness();
    const first = h.start("open", { segmentId: "segev", presentationGeneration: 10 });
    await vi.advanceTimersByTimeAsync(0);
    gates[0].resolve();
    await vi.advanceTimersByTimeAsync(16);
    endOpacityFade();
    await first;
    const closing = h.viewer.handleCommand(command("close", {
      presentationGeneration: 10, sequence: 40,
    }));
    await vi.advanceTimersByTimeAsync(16);
    const secondGates = deferDecode();
    const second = h.start("open", {
      segmentId: "nova_mor", presentationGeneration: 11, presentationSessionId: "newer",
    });
    await vi.advanceTimersByTimeAsync(0);
    endOpacityFade();
    await vi.advanceTimersByTimeAsync(600);
    await closing;
    secondGates.at(-1).resolve();
    await vi.advanceTimersByTimeAsync(16);
    endOpacityFade();
    await vi.advanceTimersByTimeAsync(600);
    await second;
    expect(h.reveal.slideNumbers()).toEqual([9, 10, 11]);
    expect(h.results.map((result) => result.outcome)).toEqual(["opened", "closed", "opened"]);
  });

  test("a stale next completion cannot emit ready or tear down a replacement", async () => {
    vi.useFakeTimers();
    const gates = deferDecode();
    const h = makeHarness();
    const opening = h.start("open", { segmentId: "segev" });
    await vi.advanceTimersByTimeAsync(0);
    gates[0].resolve();
    await vi.advanceTimersByTimeAsync(16);
    endOpacityFade();
    await opening;
    const moving = h.start("next");
    await vi.advanceTimersByTimeAsync(0);
    const replacement = h.start("open", {
      segmentId: "nova_mor", presentationGeneration: 11, presentationSessionId: "newer",
    });
    await vi.advanceTimersByTimeAsync(0);
    root.querySelector("section.present img")?.dispatchEvent(new Event("load"));
    gates.at(-1)?.resolve();
    await vi.advanceTimersByTimeAsync(16);
    endOpacityFade();
    await vi.advanceTimersByTimeAsync(600);
    await replacement;
    await moving;
    expect(h.results.map((result) => result.outcome)).toEqual(["opened", "opened"]);
    expect(h.reveal.slideNumbers()).toEqual([9, 10, 11]);
  });

  test("a late video rejection after replacement emits nothing and leaves the new viewer", async () => {
    vi.useFakeTimers();
    let rejectPlay;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => new Promise((_, reject) => {
      rejectPlay = reject;
    }));
    const gates = deferDecode();
    const results = [];
    const viewer = createNliRevealPresentation(root, {
      manifest: videoFirstManifest,
      RevealClass: FakeReveal,
      emitResult: (result) => results.push(result),
    });
    const first = viewer.handleCommand(command("open", {
      segmentId: "clip", presentationGeneration: 12, presentationSessionId: "first",
    }));
    await vi.advanceTimersByTimeAsync(0);
    gates[0].resolve();
    await vi.advanceTimersByTimeAsync(16);
    endOpacityFade();
    await vi.advanceTimersByTimeAsync(0);
    const rejectStalePlay = rejectPlay;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const secondGates = deferDecode();
    const second = viewer.handleCommand(command("open", {
      segmentId: "segev", presentationGeneration: 13, presentationSessionId: "second",
    }));
    await vi.advanceTimersByTimeAsync(0);
    secondGates.at(-1).resolve();
    await vi.advanceTimersByTimeAsync(16);
    endOpacityFade();
    await vi.advanceTimersByTimeAsync(600);
    await second;
    const count = results.length;
    rejectStalePlay(new Error("late playback rejection"));
    await first;
    await vi.advanceTimersByTimeAsync(1500);
    expect(results).toHaveLength(count);
    expect(results.at(-1)).toMatchObject({ outcome: "opened", presentationSessionId: "second" });
    expect(overlay()).not.toBeNull();
    viewer.dispose();
  });

  test("acknowledges a close with no matching viewer and rejects that generation later", async () => {
    const h = makeHarness();
    await h.viewer.handleCommand(command("close", {
      presentationGeneration: 7, presentationSessionId: "gone", sequence: 3,
    }));
    expect(h.lastResult()).toMatchObject({
      outcome: "closed", presentationGeneration: 7, presentationSessionId: "gone",
    });
    await h.send("open", { presentationGeneration: 7, presentationSessionId: "gone" });
    expect(h.lastResult().outcome).toBe("ignored");
    expect(overlay()).toBeNull();
    await h.viewer.handleCommand(command("close", {
      presentationGeneration: 4, presentationSessionId: "older", sequence: 1,
    }));
    await h.send("open", { presentationGeneration: 7, presentationSessionId: "gone" });
    expect(h.lastResult().outcome).toBe("ignored");
    await h.send("open", { presentationGeneration: 8, presentationSessionId: "revived" });
    expect(h.lastResult().outcome).toBe("opened");
  });

  test("a close for an absent session does not touch a newer viewer", async () => {
    const h = makeHarness();
    await h.send("open", {
      segmentId: "nova_mor", presentationGeneration: 20, presentationSessionId: "newer",
    });
    const current = overlay();
    await h.viewer.handleCommand(command("close", {
      segmentId: "segev", presentationGeneration: 15, presentationSessionId: "older", sequence: 2,
    }));
    expect(h.lastResult()).toMatchObject({ outcome: "closed", presentationSessionId: "older" });
    expect(overlay()).toBe(current);
    expect(h.reveal.slideNumbers()).toEqual([9, 10, 11]);
    await h.viewer.handleCommand(command("close", {
      segmentId: "nova_mor", presentationGeneration: 20, presentationSessionId: "newer", sequence: 1,
    }));
    expect(h.lastResult().outcome).toBe("ignored");
    expect(overlay()).toBe(current);
  });

  test("a repeated close after the viewer is gone is acknowledged again", async () => {
    const h = makeHarness();
    await h.send("open", { segmentId: "segev" });
    await h.send("close");
    await h.viewer.handleCommand(command("close", { sequence: 80 }));
    expect(h.lastResult().outcome).toBe("closed");
    expect(overlay()).toBeNull();
  });

  test("fresh narrative exits close any viewer once per revision, including Shura", async () => {
    const mod = await import("../../frontend/src/map/nli-reveal-presentation.js");
    expect(mod.nextHandledExitRevision).toEqual(expect.any(Function));
    const shura = { id: "shura", requiredNarrative: null };
    const first = mod.nextHandledExitRevision(0, { id: null, transition: "exit", revision: 5 });
    expect(first).toEqual({ handledExitRevision: 5, fresh: true });
    expect(mod.shouldCloseViewerForNarrative({
      handledExitRevision: 0,
      state: { id: null, transition: "exit", revision: 5 },
      segment: shura,
    })).toMatchObject({ close: true, handledExitRevision: 5 });
    const replay = mod.shouldCloseViewerForNarrative({
      handledExitRevision: 5,
      state: { id: null, transition: "exit", revision: 5 },
      segment: shura,
    });
    expect(replay).toMatchObject({ close: false, handledExitRevision: 5 });
    const older = mod.nextHandledExitRevision(5, { id: null, transition: "exit", revision: 4 });
    expect(older).toEqual({ handledExitRevision: 5, fresh: false });
    expect(mod.shouldCloseViewerForNarrative({
      handledExitRevision: 5,
      state: { id: "segev", transition: "enter", revision: 6 },
      segment: { id: "nova_mor", requiredNarrative: "nova" },
    })).toMatchObject({ close: true, handledExitRevision: 5 });
  });
});
