/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import {
  ARCHIVE_PAGE_SCROLL_EVAL,
  chooseScrollTarget,
  pageAmount,
  runArchivePageScroll,
} from "../../frontend/src/shared/nli-archive-page-scroll.js";

// A static jsdom import fails in Vitest on @exodus/bytes. This environment already loaded JSDOM.
const JSDOM = window.jsdom.constructor;

function dom(html, url) {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {
    pretendToBeVisual: true,
    ...(url ? { url } : {}),
  });
}

function setBox(element, scrollHeight, clientHeight) {
  Object.defineProperty(element, "scrollHeight", { configurable: true, get: () => scrollHeight });
  Object.defineProperty(element, "clientHeight", { configurable: true, get: () => clientHeight });
}

function evalArchiveScroll(win, direction) {
  const fn = new Function(
    "direction",
    "window",
    "document",
    `return (${ARCHIVE_PAGE_SCROLL_EVAL});`,
  );
  return fn(direction, win, win.document);
}

describe("nli archive page scroll chooser", () => {
  test("down amount is +0.9 viewport, up is negative", () => {
    expect(pageAmount(1000, "down")).toBe(900);
    expect(pageAmount(1000, "up")).toBe(-900);
  });

  test("uses the document scroller when it overflows", () => {
    const { window } = dom(`<div id="short">x</div>`);
    Object.defineProperty(window.document.documentElement, "scrollHeight", { get: () => 4000 });
    Object.defineProperty(window.document.documentElement, "clientHeight", { get: () => 800 });
    window.document.scrollingElement = window.document.documentElement;
    expect(chooseScrollTarget(window.document, 800)).toBe(window.document.documentElement);
  });

  test("uses the largest inner overflow column when the document does not overflow", () => {
    const { window } = dom(`<main id="col" style="overflow-y:auto"></main>`);
    const col = window.document.getElementById("col");
    Object.defineProperty(window.document.documentElement, "scrollHeight", { get: () => 800 });
    Object.defineProperty(window.document.documentElement, "clientHeight", { get: () => 800 });
    window.document.scrollingElement = window.document.documentElement;
    Object.defineProperty(col, "scrollHeight", { get: () => 4000 });
    Object.defineProperty(col, "clientHeight", { get: () => 700 });
    window.getComputedStyle = () => ({ overflowY: "auto" });
    expect(chooseScrollTarget(window.document, 800)).toBe(col);
  });

  test("returns null when nothing overflows", () => {
    const { window } = dom(`<p>short</p>`);
    Object.defineProperty(window.document.documentElement, "scrollHeight", { get: () => 800 });
    Object.defineProperty(window.document.documentElement, "clientHeight", { get: () => 800 });
    window.document.scrollingElement = window.document.documentElement;
    window.getComputedStyle = () => ({ overflowY: "visible" });
    expect(chooseScrollTarget(window.document, 800)).toBeNull();
  });

  test("eval string is generated from runArchivePageScroll", () => {
    expect(ARCHIVE_PAGE_SCROLL_EVAL).toContain(runArchivePageScroll.toString());
    expect(ARCHIVE_PAGE_SCROLL_EVAL).toContain(pageAmount.toString());
    expect(ARCHIVE_PAGE_SCROLL_EVAL).toContain(chooseScrollTarget.toString());
  });

  test("eval no-ops when the hostname is not www.nli.org.il", () => {
    const { window } = dom(`<div id="short">x</div>`, "https://example.com/");
    const root = window.document.documentElement;
    setBox(root, 4000, 800);
    window.document.scrollingElement = root;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
    root.scrollBy = vi.fn();
    expect(evalArchiveScroll(window, "down")).toEqual({ scrolled: false });
    expect(root.scrollBy).not.toHaveBeenCalled();
    expect(runArchivePageScroll(window, "down")).toEqual({ scrolled: false });
    expect(root.scrollBy).not.toHaveBeenCalled();
  });

  test("eval no-ops when the protocol is not https", () => {
    const { window } = dom(`<div id="short">x</div>`, "http://www.nli.org.il/record");
    const root = window.document.documentElement;
    setBox(root, 4000, 800);
    window.document.scrollingElement = root;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
    root.scrollBy = vi.fn();
    expect(evalArchiveScroll(window, "down")).toEqual({ scrolled: false });
    expect(root.scrollBy).not.toHaveBeenCalled();
  });

  test("eval scrolls the overflowing document scroller by the signed amount on www.nli.org.il", () => {
    const { window } = dom(`<div id="short">x</div>`, "https://www.nli.org.il/record");
    const root = window.document.documentElement;
    setBox(root, 4000, 800);
    window.document.scrollingElement = root;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
    root.scrollBy = vi.fn();
    expect(evalArchiveScroll(window, "down")).toEqual({ scrolled: true });
    expect(root.scrollBy).toHaveBeenCalledWith({ top: 900, behavior: "auto" });
    expect(evalArchiveScroll(window, "up")).toEqual({ scrolled: true });
    expect(root.scrollBy).toHaveBeenLastCalledWith({ top: -900, behavior: "auto" });
  });

  test("eval scrolls the largest inner column when the document does not overflow", () => {
    const { window } = dom(
      `<main id="small"></main><main id="col"></main>`,
      "https://www.nli.org.il/record",
    );
    const root = window.document.documentElement;
    const small = window.document.getElementById("small");
    const col = window.document.getElementById("col");
    setBox(root, 800, 800);
    setBox(small, 3000, 400);
    setBox(col, 4000, 700);
    window.document.scrollingElement = root;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
    window.getComputedStyle = (el) => ({ overflowY: el === small || el === col ? "auto" : "visible" });
    small.scrollBy = vi.fn();
    col.scrollBy = vi.fn();
    root.scrollBy = vi.fn();
    expect(evalArchiveScroll(window, "down")).toEqual({ scrolled: true });
    expect(col.scrollBy).toHaveBeenCalledWith({ top: 900, behavior: "auto" });
    expect(small.scrollBy).not.toHaveBeenCalled();
    expect(root.scrollBy).not.toHaveBeenCalled();
  });

  test("eval does not scroll when nothing overflows", () => {
    const { window } = dom(`<p>short</p>`, "https://www.nli.org.il/record");
    const root = window.document.documentElement;
    setBox(root, 800, 800);
    window.document.scrollingElement = root;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1000 });
    window.getComputedStyle = () => ({ overflowY: "visible" });
    root.scrollBy = vi.fn();
    expect(evalArchiveScroll(window, "down")).toEqual({ scrolled: false });
    expect(root.scrollBy).not.toHaveBeenCalled();
  });
});
