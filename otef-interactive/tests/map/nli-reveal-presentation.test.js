// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import rawManifest from "../../public/presentation/nli-presentation-manifest.json";
import { validateNliPresentationManifest } from "../../frontend/src/shared/nli-presentation-manifest.js";
import { createNliRevealPresentation } from "../../frontend/src/map/nli-reveal-presentation.js";

const manifest = validateNliPresentationManifest(rawManifest);

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
      queueMicrotask(() => root.querySelector("section.present img")?.dispatchEvent(new Event("load")));
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
    queueMicrotask(() => root.querySelector("section.present img").dispatchEvent(new Event("error")));
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
