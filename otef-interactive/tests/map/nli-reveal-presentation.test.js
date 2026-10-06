// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import rawManifest from "../../public/presentation/nli-presentation-manifest.json";
import { validateNliPresentationManifest } from "../../frontend/src/shared/nli-presentation-manifest.js";
import { createNliRevealPresentation } from "../../frontend/src/map/nli-reveal-presentation.js";

const manifest = validateNliPresentationManifest(rawManifest);
const assetVersion = manifest.deck.assetVersion ?? manifest.deck.pdfSha256;
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

function makeHarness(overrideManifest = manifest) {
  const results = [];
  const correlation = {
    segmentId: "segev",
    presentationSessionId: "session-current",
    presentationGeneration: 10,
  };
  const viewer = createNliRevealPresentation(root, {
    manifest: overrideManifest,
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
  test("uses the rendered asset version so a 4K upgrade bypasses cached slides", async () => {
    const h = makeHarness({ ...manifest, deck: { ...manifest.deck, assetVersion: "4k-photo-release" } });
    await h.send("open");
    expect(root.querySelector("section.present img").getAttribute("src"))
      .toBe("/otef-interactive/public/local/presentations/nli/slides/slide-01.png?v=4k-photo-release");
  });

  test("legacy manifests still version slide images by their approved PDF", async () => {
    const deck = { ...manifest.deck };
    delete deck.assetVersion;
    const h = makeHarness({ ...manifest, deck });
    await h.send("open");
    expect(root.querySelector("section.present img").getAttribute("src"))
      .toBe(`/otef-interactive/public/local/presentations/nli/slides/slide-01.png?v=${deck.pdfSha256}`);
  });

  test("names wall uses the same versioned high-resolution background as added slides", async () => {
    const h = makeHarness({ ...manifest, deck: { ...manifest.deck, assetVersion: "4k-photo-release" } });
    await h.send("open", { segmentId: "names_wall" });
    expect(root.querySelector(".nli-reveal-overlay--blackout").style.backgroundImage)
      .toContain("/otef-interactive/public/local/presentations/nli/supplements/slide-background.png?v=4k-photo-release");
    expect(root.textContent).toContain("מאגר הזהויות");
  });

  test.each([
    ["segev", 8, "gelem-first-9s-fade.mp4", "תיעוד תלת־ממדי של בארי, 17 באוקטובר 2023", "צילם ברק ברינקר"],
    ["nova_memorial", 0, "nova-first-12s-fade.mp4", "תיעוד תלת־ממדי של הנובה, 10 באוקטובר 2023", null],
    ["shura", 7, "reim-first-10s-fade.mp4", "המיגונית ברעים, 1 בפברואר 2024", "צילם יוסי סודרי"],
  ])("%s includes its credited added video at the requested position with NLI styling and active autoplay", async (segmentId, index, filename, title, photographer) => {
    const h = makeHarness();
    await h.send("open", { segmentId });
    for (let step = 0; step < index; step += 1) await h.send("next");
    const section = root.querySelector("section.present");
    const video = section.querySelector("video");
    expect(video?.getAttribute("src")).toBe(`/otef-interactive/public/local/presentations/nli/supplements/${filename}`);
    expect(section.querySelector("img").getAttribute("src"))
      .toBe(`/otef-interactive/public/local/presentations/nli/supplements/slide-background.png?v=${assetVersion}`);
    expect(section.querySelector(".nli-presentation-title")?.textContent).toBe(title);
    const credit = section.querySelector(".nli-presentation-credit");
    expect(credit?.getAttribute("lang")).toBe("he");
    expect(credit?.getAttribute("dir")).toBe("rtl");
    expect(credit?.querySelector("strong")?.textContent).toBe("רשות העתיקות");
    expect(credit?.querySelector("span")?.textContent ?? null).toBe(photographer);
    expect(video.muted).toBe(false);
    expect(video.controls).toBe(false);
    expect(video.playsInline).toBe(true);
    expect(video.style.objectFit).toBe("contain");
    expect(video.style.width).toBe("68%");
    expect(video.style.height).toBe(segmentId === "nova_memorial" ? "68.5%" : "68%");
    expect(HTMLMediaElement.prototype.play.mock.contexts.at(-1)).toBe(video);
    video.currentTime = 5;
    await h.send("close");
    expect(video.currentTime).toBe(0);
    expect(HTMLMediaElement.prototype.pause.mock.contexts).toContain(video);
  });

  test("memorial starts with Nova and retains the previous first slide as its second slide", async () => {
    const h = makeHarness();
    await h.send("open", { segmentId: "nova_memorial" });
    const nova = root.querySelector("section.present video");
    expect(nova).not.toBeNull();
    await h.send("next");
    expect(root.querySelector("section.present img").getAttribute("src"))
      .toBe(`/otef-interactive/public/local/presentations/nli/slides/slide-12.png?v=${assetVersion}`);
    expect(root.querySelector("section.present video")).toBeNull();
    expect(root.querySelector("section.present .nli-presentation-credit")).toBeNull();
    expect(nova.currentTime).toBe(0);
    await h.send("previous");
    expect(root.querySelector("section.present video")).toBe(nova);
    expect(HTMLMediaElement.prototype.play.mock.contexts.filter((video) => video === nova)).toHaveLength(2);
  });

  test("credits opens only the final source slide on the overview and clamps navigation", async () => {
    const h = makeHarness();
    await h.send("open", { segmentId: "credits" });
    expect(h.lastResult()).toMatchObject({ outcome: "opened", slide: 37, range: [37, 37] });
    expect(h.reveal.slideNumbers()).toEqual([37]);
    expect(root.querySelector("section.present img").getAttribute("src"))
      .toBe(`/otef-interactive/public/local/presentations/nli/slides/slide-34.png?v=${assetVersion}`);
    await h.send("previous");
    await h.send("next");
    expect(h.lastResult()).toMatchObject({ outcome: "ready", slide: 37 });
    await h.send("close");
    expect(root.querySelector(".nli-reveal-overlay")).toBeNull();
  });

  test("Hostages keeps its five original slides without showing the credits", async () => {
    const h = makeHarness();
    await h.send("open", { segmentId: "hostages" });
    expect(h.reveal.slideNumbers()).toEqual([32, 33, 34, 35, 36]);
    for (let index = 0; index < 5; index += 1) await h.send("next");
    expect(h.lastResult()).toMatchObject({ outcome: "ready", slide: 36, range: [32, 36] });
  });

  test("opens the requested range and clamps at both boundaries", async () => {
    const h = makeHarness();
    await h.send("open", { segmentId: "nova_mor" });
    expect(h.reveal.slideNumbers()).toEqual([10, 11, 12]);
    const slide = vi.spyOn(h.reveal, "slide");
    await h.send("previous");
    expect(slide).not.toHaveBeenCalled();
    expect(h.lastResult()).toMatchObject({ outcome: "ready", slide: 10, range: [10, 12] });
    await h.send("next");
    await h.send("next");
    const reveal = h.reveal;
    await h.send("next");
    expect(h.lastResult().slide).toBe(12);
    expect(reveal.index).toBe(2);
    expect(slide).toHaveBeenCalledTimes(2);
  });

  test("rejects an older delayed open without replacing the active segment", async () => {
    const h = makeHarness();
    await h.send("open", { segmentId: "nova_mor", presentationGeneration: 20 });
    await h.send("open", {
      segmentId: "segev", presentationGeneration: 19, presentationSessionId: "delayed",
    });
    expect(h.reveal.slideNumbers()).toEqual([10, 11, 12]);
    expect(h.lastResult().outcome).toBe("ignored");
  });

  test("supports full 4K scaling and disables Reveal navigation and presentation transitions", async () => {
    const h = makeHarness();
    await h.send("open", { segmentId: "segev" });
    expect(h.reveal.options).toMatchObject({
      maxScale: 4,
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
    expect(videos).toHaveLength(3);
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
    expect(video.pause.mock.contexts.filter((media) => media === video)).toHaveLength(1);
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
    expect(root.querySelector(".nli-reveal-overlay section")?.dataset.slide).toBe("10");
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
    expect(video.pause.mock.contexts.filter((media) => media === video)).toHaveLength(1);
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

async function openUntilFadeArmed(startOpen, { decodeGates = null } = {}) {
  const opening = startOpen();
  await vi.advanceTimersByTimeAsync(0);
  decodeGates?.[0]?.resolve();
  await vi.advanceTimersByTimeAsync(0);
  return { opening };
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
    const playback = [];
    const viewer = createNliRevealPresentation(root, {
      manifest: videoFirstManifest,
      RevealClass: FakeReveal,
      emitResult: (result) => results.push(result),
      onVideoPlaybackChange: (active) => playback.push(active),
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
    const playback = [];
    const viewer = createNliRevealPresentation(root, {
      manifest: videoFirstManifest,
      RevealClass: FakeReveal,
      emitResult: (result) => results.push(result),
      onVideoPlaybackChange: (active) => playback.push(active),
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
    expect(playback).toEqual([true, false]);

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
    expect(playback).toEqual([true, false, true, false]);
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

  test("keeps playback active through startup and buffering, then follows pause, resume, end, and close", async () => {
    vi.useFakeTimers();
    const playback = [];
    const order = [];
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function play() {
      Object.defineProperty(this, "paused", { configurable: true, value: false });
      order.push("play");
      return Promise.resolve();
    });
    const gates = deferDecode();
    const viewer = createNliRevealPresentation(root, {
      manifest: videoFirstManifest,
      RevealClass: FakeReveal,
      emitResult: () => {},
      onVideoPlaybackChange: (active) => { playback.push(active); order.push(`active:${active}`); },
    });
    const opening = viewer.handleCommand(command("open", {
      segmentId: "clip", presentationGeneration: 12, presentationSessionId: "clip-session",
    }));
    await vi.advanceTimersByTimeAsync(0);
    gates[0].resolve();
    await vi.advanceTimersByTimeAsync(16);
    endOpacityFade();
    await vi.advanceTimersByTimeAsync(0);
    const video = overlay().querySelector("video");
    expect(order).toEqual(["active:true", "play"]);
    for (const type of ["waiting", "stalled", "seeking"]) video.dispatchEvent(new Event(type));
    expect(playback).toEqual([true]);
    await opening;
    Object.defineProperty(video, "paused", { configurable: true, value: true });
    video.dispatchEvent(new Event("pause"));
    expect(playback).toEqual([true, false]);
    video.dispatchEvent(new Event("playing"));
    expect(playback).toEqual([true, false]);
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    video.dispatchEvent(new Event("play"));
    expect(playback).toEqual([true, false, true]);
    Object.defineProperty(video, "ended", { configurable: true, value: true });
    video.dispatchEvent(new Event("ended"));
    expect(playback).toEqual([true, false, true, false]);
    video.dispatchEvent(new Event("playing"));
    expect(playback).toEqual([true, false, true, false]);
    const closing = viewer.close();
    await vi.advanceTimersByTimeAsync(700);
    await closing;
    expect(playback.at(-1)).toBe(false);
    viewer.dispose();
  });

  test("a clamped slide command leaves the active video lifecycle listener connected", async () => {
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function play() {
      Object.defineProperty(this, "paused", { configurable: true, value: false });
      return Promise.resolve();
    });
    const oneVideoSlide = {
      ...videoFirstManifest,
      segments: videoFirstManifest.segments.map((segment) => segment.id === "clip" ? { ...segment, range: [2, 2] } : segment),
    };
    const gates = deferDecode();
    const playback = [];
    const viewer = createNliRevealPresentation(root, {
      manifest: oneVideoSlide,
      RevealClass: FakeReveal,
      onVideoPlaybackChange: (active) => playback.push(active),
    });
    const opening = viewer.handleCommand(command("open", {
      segmentId: "clip", presentationGeneration: 12, presentationSessionId: "clip-session",
    }));
    await vi.advanceTimersByTimeAsync(0);
    gates[0].resolve();
    await vi.advanceTimersByTimeAsync(16);
    endOpacityFade();
    await vi.advanceTimersByTimeAsync(0);
    const video = overlay().querySelector("video");
    await viewer.handleCommand(command("next", {
      segmentId: "clip", presentationGeneration: 12, presentationSessionId: "clip-session", sequence: 2,
    }));
    Object.defineProperty(video, "ended", { configurable: true, value: true });
    video.dispatchEvent(new Event("ended"));
    expect(playback).toEqual([true, false]);
    viewer.dispose();
    await opening;
  });

  test("departure and close release pending playback, and stale play resolutions cannot affect a later activation", async () => {
    vi.useFakeTimers();
    const playResolvers = [];
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function play() {
      Object.defineProperty(this, "paused", { configurable: true, value: false });
      return new Promise((resolve) => { playResolvers.push(resolve); });
    });
    const gates = deferDecode();
    const playback = [];
    const viewer = createNliRevealPresentation(root, {
      manifest: videoFirstManifest,
      RevealClass: FakeReveal,
      onVideoPlaybackChange: (active) => playback.push(active),
    });
    const opening = viewer.handleCommand(command("open", {
      segmentId: "clip", presentationGeneration: 12, presentationSessionId: "clip-session",
    }));
    await vi.advanceTimersByTimeAsync(0);
    gates[0].resolve();
    await vi.advanceTimersByTimeAsync(16);
    endOpacityFade();
    await vi.advanceTimersByTimeAsync(0);
    expect(playback).toEqual([true]);

    const moving = viewer.handleCommand(command("next", {
      segmentId: "clip", presentationGeneration: 12, presentationSessionId: "clip-session", sequence: 2,
    }));
    await vi.advanceTimersByTimeAsync(0);
    gates[1].resolve();
    await moving;
    await opening;
    expect(playback).toEqual([true, false]);

    const returning = viewer.handleCommand(command("previous", {
      segmentId: "clip", presentationGeneration: 12, presentationSessionId: "clip-session", sequence: 3,
    }));
    await vi.advanceTimersByTimeAsync(0);
    gates[2].resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(playResolvers).toHaveLength(2);
    expect(playback).toEqual([true, false, true]);
    playResolvers[0]();
    await Promise.resolve();
    await Promise.resolve();
    expect(playback).toEqual([true, false, true]);

    const closing = viewer.close();
    await vi.advanceTimersByTimeAsync(700);
    await closing;
    await returning;
    expect(playback).toEqual([true, false, true, false]);
    playResolvers[1]();
    await Promise.resolve();
    await Promise.resolve();
    expect(playback).toEqual([true, false, true, false]);
    viewer.dispose();
  });

  test("public close owns teardown through the fade and ignores later slide commands", async () => {
    vi.useFakeTimers();
    const gates = deferDecode();
    const h = makeHarness();
    const opening = h.start("open", {
      segmentId: "shura", presentationSessionId: "shura-session", presentationGeneration: 10, sequence: 1,
    });
    await vi.advanceTimersByTimeAsync(0);
    gates[0].resolve();
    await vi.advanceTimersByTimeAsync(16);
    endOpacityFade();
    await opening;

    const advancing = h.start("next", { segmentId: "shura", presentationSessionId: "shura-session", sequence: 2 });
    await vi.advanceTimersByTimeAsync(0);
    gates.at(-1).resolve();
    await advancing;
    const video = root.querySelector("section.present video");
    expect(video).not.toBeNull();
    const readyBeforeClose = h.results.filter((result) => result.outcome === "ready").length;

    const closing = h.viewer.close();
    expect(h.viewer.close()).toBe(closing);
    expect(video.pause).toHaveBeenCalled();
    const lateNext = h.start("next", { segmentId: "shura", presentationSessionId: "shura-session", sequence: 3 });
    const latePrevious = h.start("previous", { segmentId: "shura", presentationSessionId: "shura-session", sequence: 4 });
    const matchingClose = h.start("close", { segmentId: "shura", presentationSessionId: "shura-session", sequence: 5 });
    await vi.advanceTimersByTimeAsync(16);
    await vi.advanceTimersByTimeAsync(600);
    await Promise.all([closing, lateNext, latePrevious, matchingClose]);

    expect(overlay()).toBeNull();
    expect(h.results.filter((result) => result.outcome === "ready")).toHaveLength(readyBeforeClose);
    expect(h.results.filter((result) => result.outcome === "closed")).toHaveLength(1);
    expect(h.reveal.destroyed).toBe(true);
  });

  test("a newer Open survives completion of a public close", async () => {
    vi.useFakeTimers();
    const gates = deferDecode();
    const h = makeHarness();
    const first = h.start("open", { segmentId: "shura", presentationGeneration: 10, sequence: 1 });
    await vi.advanceTimersByTimeAsync(0);
    gates[0].resolve();
    await vi.advanceTimersByTimeAsync(16);
    endOpacityFade();
    await first;

    const closing = h.viewer.close();
    await vi.advanceTimersByTimeAsync(16);
    const newerGates = deferDecode();
    const newer = h.start("open", {
      segmentId: "nova_memorial", presentationSessionId: "newer", presentationGeneration: 11, sequence: 1,
    });
    await vi.advanceTimersByTimeAsync(0);
    endOpacityFade();
    await vi.advanceTimersByTimeAsync(600);
    await closing;
    newerGates.at(-1).resolve();
    await vi.advanceTimersByTimeAsync(16);
    endOpacityFade();
    await vi.advanceTimersByTimeAsync(600);
    await newer;

    expect(overlay()).not.toBeNull();
    expect(h.reveal.slideNumbers()).toEqual([13, 14, 15, 16, 17, 18]);
    expect(h.results.map((result) => result.outcome)).toEqual(["opened", "opened"]);
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
    expect(h.reveal.slideNumbers()).toEqual([10, 11, 12]);
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
    expect(h.reveal.slideNumbers()).toEqual([10, 11, 12]);
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
    expect(h.reveal.slideNumbers()).toEqual([10, 11, 12]);
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

  test("opens names_wall with Hebrew archive copy without slide images and emits opened then ready", async () => {
    vi.useFakeTimers();
    if (typeof HTMLImageElement.prototype.decode !== "function") {
      Object.defineProperty(HTMLImageElement.prototype, "decode", {
        configurable: true,
        writable: true,
        value() { return Promise.resolve(); },
      });
    }
    const decode = vi.spyOn(HTMLImageElement.prototype, "decode").mockResolvedValue();
    const blackoutManifest = {
      ...manifest,
      segments: [
        ...manifest.segments.filter((segment) => segment.id !== "names_wall"),
        { id: "names_wall", requiredNarrative: null, kind: "blackout", range: [0, 0] },
      ],
    };
    const results = [];
    const viewer = createNliRevealPresentation(root, {
      manifest: blackoutManifest,
      RevealClass: FakeReveal,
      emitResult: (result) => results.push(result),
    });
    const opening = viewer.handleCommand(command("open", {
      segmentId: "names_wall", presentationGeneration: 10, presentationSessionId: "wall",
    }));
    await vi.advanceTimersByTimeAsync(0);
    expect(overlay()).not.toBeNull();
    expect(overlay().querySelector("img")).toBeNull();
    expect(overlay().querySelector(".nli-blackout-title")?.textContent).toBe("מאגר הזהויות");
    expect(overlay().querySelector(".nli-blackout-title")?.dir).toBe("rtl");
    expect(overlay().querySelector(".nli-blackout-date")?.textContent).toBe("ארכיון 7 באוקטובר");
    expect(overlay().querySelector(".nli-blackout-date")?.dir).toBe("rtl");
    expect(overlay().querySelector(".nli-blackout-date")?.lang).toBe("he");
    expect(results).toEqual([]);
    await vi.advanceTimersByTimeAsync(16);
    expect(overlay().style.opacity).toBe("1");
    endOpacityFade();
    await vi.advanceTimersByTimeAsync(600);
    await opening;
    expect(results.map((result) => result.outcome)).toEqual(["opened", "ready"]);
    expect(decode).not.toHaveBeenCalled();
    viewer.dispose();
  });

  test("names_wall fade-in holds opacity 0 with transition none until the next frame", async () => {
    vi.useFakeTimers();
    const h = makeHarness();
    const { opening } = await openUntilFadeArmed(() => h.start("open", {
      segmentId: "names_wall", presentationSessionId: "wall",
    }));
    expect(overlay().style.opacity).toBe("0");
    expect(overlay().style.transition).toBe("none");
    await vi.advanceTimersByTimeAsync(16);
    expect(overlay().style.opacity).toBe("1");
    expect(overlay().style.transition).toBe("");
    endOpacityFade();
    await opening;
    expect(h.results.map((result) => result.outcome)).toEqual(["opened", "ready"]);
    h.viewer.dispose();
  });

  test.each(
    manifest.segments.filter((segment) => segment.kind !== "blackout").map((segment) => segment.id),
  )("%s fade-in holds opacity 0 with transition none until the next frame", async (segmentId) => {
    vi.useFakeTimers();
    const gates = deferDecode();
    const h = makeHarness();
    const { opening } = await openUntilFadeArmed(() => h.start("open", { segmentId }), { decodeGates: gates });
    expect(overlay().style.opacity).toBe("0");
    expect(overlay().style.transition).toBe("none");
    await vi.advanceTimersByTimeAsync(16);
    expect(overlay().style.opacity).toBe("1");
    expect(overlay().style.transition).toBe("");
    endOpacityFade();
    await opening;
    expect(h.lastResult()).toMatchObject({ outcome: "opened", segmentId });
    h.viewer.dispose();
  });

  test("names_wall fade-out holds opacity 1 with transition none until the next frame", async () => {
    vi.useFakeTimers();
    const h = makeHarness();
    const { opening } = await openUntilFadeArmed(() => h.start("open", {
      segmentId: "names_wall", presentationSessionId: "wall",
    }));
    await vi.advanceTimersByTimeAsync(16);
    endOpacityFade();
    await opening;
    const closing = h.viewer.handleCommand(command("close", {
      segmentId: "names_wall", presentationSessionId: "wall", sequence: 50,
    }));
    await vi.advanceTimersByTimeAsync(0);
    expect(overlay().style.opacity).toBe("1");
    expect(overlay().style.transition).toBe("none");
    await vi.advanceTimersByTimeAsync(16);
    expect(overlay().style.opacity).toBe("0");
    expect(overlay().style.transition).toBe("");
    endOpacityFade();
    await closing;
    expect(h.lastResult().outcome).toBe("closed");
    expect(overlay()).toBeNull();
  });

  test("image-deck fade-out holds opacity 1 with transition none until the next frame", async () => {
    vi.useFakeTimers();
    const gates = deferDecode();
    const h = makeHarness();
    const { opening } = await openUntilFadeArmed(() => h.start("open", { segmentId: "segev" }), { decodeGates: gates });
    await vi.advanceTimersByTimeAsync(16);
    endOpacityFade();
    await opening;
    const closing = h.viewer.handleCommand(command("close", { sequence: 50 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(overlay().style.opacity).toBe("1");
    expect(overlay().style.transition).toBe("none");
    await vi.advanceTimersByTimeAsync(16);
    expect(overlay().style.opacity).toBe("0");
    expect(overlay().style.transition).toBe("");
    endOpacityFade();
    await closing;
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
