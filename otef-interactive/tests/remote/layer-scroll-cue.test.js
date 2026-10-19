// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { bindLayerScrollCue } from "../../frontend/src/remote/layer-scroll-cue.js";

let root, port, grid, more, contentHeight, availableHeight, callbacks, nextFrame;
let observers, finishFonts, fontsDescriptor, cleanups;

function flushFrames() {
  const pending = [...callbacks.values()];
  callbacks.clear();
  pending.forEach((callback) => callback(0));
}

function bind() {
  const cleanup = bindLayerScrollCue(root);
  cleanups.push(cleanup);
  return cleanup;
}

beforeEach(() => {
  document.body.innerHTML = `<section><div class="sheet-content">
    <div class="group-layers" tabindex="0"><div class="layer-tile-grid"></div></div>
    <button type="button" data-layers-more hidden style="margin-block-start:8px">More layers below</button>
  </div></section>`;
  root = document.querySelector(".sheet-content");
  port = root.querySelector(".group-layers");
  grid = port.firstElementChild;
  more = root.querySelector("button");
  availableHeight = 700;
  contentHeight = 1200;
  Object.defineProperties(port, {
    clientHeight: { configurable: true, get: () => availableHeight - (more.hidden ? 0 : 52) },
    scrollHeight: { configurable: true, get: () => Math.max(contentHeight, port.clientHeight) },
  });
  more.getBoundingClientRect = () => ({ height: 44 });
  port.scrollBy = vi.fn();
  callbacks = new Map();
  nextFrame = 0;
  cleanups = [];
  observers = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callbacks.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => callbacks.delete(id));
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback) {
      this.callback = callback;
      this.observe = vi.fn();
      this.disconnect = vi.fn();
      observers.push(this);
    }
  });
  fontsDescriptor = Object.getOwnPropertyDescriptor(document, "fonts");
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: new Promise((resolve) => { finishFonts = resolve; }) },
  });
});

afterEach(() => {
  cleanups.forEach((cleanup) => cleanup());
  if (fontsDescriptor) Object.defineProperty(document, "fonts", fontsDescriptor);
  else delete document.fonts;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("layer scroll cue", () => {
  test("shows for overflow, preserves its space at the end, and returns when scrolling up", () => {
    bind();
    expect(more.hidden).toBe(true);
    flushFrames();
    expect(more.hidden).toBe(false);
    expect(port.clientHeight).toBe(648);
    expect(more.classList.contains("is-at-end")).toBe(false);
    port.scrollTop = 552;
    port.dispatchEvent(new Event("scroll"));
    flushFrames();
    expect(more.hidden).toBe(false);
    expect(more.classList.contains("is-at-end")).toBe(true);
    expect(port.clientHeight).toBe(648);
    port.scrollTop = 100;
    port.dispatchEvent(new Event("scroll"));
    flushFrames();
    expect(more.classList.contains("is-at-end")).toBe(false);
    expect(port.classList.contains("is-scrolled")).toBe(true);
  });

  test("removes the strip for content that fits without it, including rounding tolerance", () => {
    bind();
    flushFrames();
    contentHeight = 701;
    window.dispatchEvent(new Event("resize"));
    flushFrames();
    expect(more.hidden).toBe(true);
    expect(port.clientHeight).toBe(700);
    contentHeight = 703;
    window.dispatchEvent(new Event("resize"));
    flushFrames();
    expect(more.hidden).toBe(false);
  });

  test("does not measure a hidden tab or a zero-height scrollport", () => {
    root.parentElement.hidden = true;
    bind();
    flushFrames();
    expect(more.hidden).toBe(true);
    root.parentElement.hidden = false;
    availableHeight = 0;
    window.dispatchEvent(new Event("resize"));
    flushFrames();
    expect(more.hidden).toBe(true);
    availableHeight = 700;
    window.dispatchEvent(new Event("resize"));
    flushFrames();
    expect(more.hidden).toBe(false);
  });

  test("scrolls only the layer viewport and honors reduced motion", () => {
    bind();
    flushFrames();
    more.click();
    expect(port.scrollBy).toHaveBeenLastCalledWith({ top: expect.closeTo(453.6, 3), behavior: "smooth" });
    window.matchMedia.mockReturnValue({ matches: true });
    availableHeight = 152;
    more.click();
    expect(port.scrollBy).toHaveBeenLastCalledWith({ top: 104, behavior: "instant" });
  });

  test.each(["end", "fit"])("moves focus to the scrollport when its focused cue disappears at %s", (reason) => {
    bind();
    flushFrames();
    more.focus();
    if (reason === "end") port.scrollTop = 552;
    else contentHeight = 400;
    port.dispatchEvent(new Event("scroll"));
    flushFrames();
    expect(document.activeElement).toBe(port);
  });

  test("remeasures when grid content or fonts change", async () => {
    contentHeight = 400;
    bind();
    flushFrames();
    expect(observers[0].observe.mock.calls.map(([target]) => target)).toEqual([port, grid]);
    contentHeight = 1200;
    observers[0].callback();
    flushFrames();
    expect(more.hidden).toBe(false);
    contentHeight = 400;
    finishFonts();
    await Promise.resolve();
    flushFrames();
    expect(more.hidden).toBe(true);
  });

  test("cleanup disconnects old bindings and ignores late font completion", async () => {
    const cleanup = bind();
    cleanup();
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    expect(callbacks.size).toBe(0);
    more.click();
    port.dispatchEvent(new Event("scroll"));
    window.dispatchEvent(new Event("resize"));
    observers[0].callback();
    finishFonts();
    await Promise.resolve();
    expect(port.scrollBy).not.toHaveBeenCalled();
    expect(callbacks.size).toBe(0);
    bind();
    flushFrames();
    more.click();
    expect(port.scrollBy).toHaveBeenCalledOnce();
  });

  test("accepts missing scroll elements and minimal DOM stubs", () => {
    expect(bindLayerScrollCue({ querySelector: () => null })).toBeTypeOf("function");
    expect(() => bindLayerScrollCue(null)()).not.toThrow();
  });
});
