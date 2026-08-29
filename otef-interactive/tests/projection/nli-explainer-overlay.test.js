import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import MapProjectionConfig from "../../frontend/src/shared/map-projection-config.js";
import {
  applyNliExplainerLayout,
  applyNliExplainerHostPresence,
  clampNliExplainerLayout,
  ensureNliExplainerHost,
  mergeNliExplainerLayout,
  nliExplainerBoxHitsOverlap,
  nliExplainerOverlapPageRect,
  nliExplainerRotatedPageAabb,
  nliExplainerShouldPaintOnSpan,
  nliExplainerSpanKey,
  nliExplainerContentOverflows,
  readNliExplainerLayoutStore,
  serializeNliExplainerLayoutMap,
  shouldIgnoreExplainerLayoutStore,
} from "../../frontend/src/projection/nli-explainer-overlay.js";

const fallback = MapProjectionConfig.NLI_EXPLAINER_LAYOUT.full;

describe("nli explainer layout", () => {
  it("span keys follow ?span=", () => {
    expect(nliExplainerSpanKey("")).toBe("full");
    expect(nliExplainerSpanKey("?span=left")).toBe("left");
    expect(nliExplainerSpanKey("?span=right")).toBe("right");
    expect(nliExplainerShouldPaintOnSpan("full")).toBe(true);
    expect(nliExplainerShouldPaintOnSpan("left")).toBe(true);
    expect(nliExplainerShouldPaintOnSpan("right")).toBe(false);
  });

  it("hides the host on span=right", () => {
    const host = { style: {} };
    applyNliExplainerHostPresence(host, "left");
    expect(host.style.display).toBe("");
    applyNliExplainerHostPresence(host, "right");
    expect(host.style.display).toBe("none");
    applyNliExplainerHostPresence(host, "full");
    expect(host.style.display).toBe("");
  });

  it("clamps box onto the page and rotateDeg", () => {
    const out = clampNliExplainerLayout(
      { leftPct: 90, topPct: 90, widthPct: 40, heightPct: 40, fontPx: 3, rotateDeg: 400 },
      fallback,
    );
    expect(out.widthPct).toBe(40);
    expect(out.leftPct).toBe(60);
    expect(out.heightPct).toBe(40);
    expect(out.topPct).toBe(60);
    expect(out.fontPx).toBe(8);
    expect(out.rotateDeg).toBe(180);
    expect(
      clampNliExplainerLayout(
        { ...fallback, fontPx: 10 },
        fallback,
      ).fontPx,
    ).toBe(10);
  });

  it("merges stored span over defaults", () => {
    const stored = { left: { leftPct: 10, topPct: 10, widthPct: 20, heightPct: 20, fontPx: 18 } };
    const layout = mergeNliExplainerLayout("left", stored, MapProjectionConfig.NLI_EXPLAINER_LAYOUT);
    expect(layout.leftPct).toBe(10);
    expect(layout.rotateDeg).toBe(0);
    expect(mergeNliExplainerLayout("full", stored, MapProjectionConfig.NLI_EXPLAINER_LAYOUT).leftPct).toBe(
      MapProjectionConfig.NLI_EXPLAINER_LAYOUT.full.leftPct,
    );
  });

  it("host is a sibling; uniform rotate is written; no skew or scale", () => {
    vi.stubGlobal("document", {
      createElement() {
        const el = {
          id: "",
          className: "",
          style: {},
          parentNode: null,
          children: [],
          querySelector(sel) {
            if (sel === ".nli-investigation-timeline-caption") {
              return this.children.find((c) => String(c.className).includes("nli-investigation-timeline-caption")) || null;
            }
            return null;
          },
          appendChild(child) {
            this.children.push(child);
            child.parentNode = this;
            return child;
          },
        };
        return el;
      },
    });
    const display = {
      id: "displayContainer",
      querySelector(sel) {
        return sel === "#nliExplainerHost" ? this._host : null;
      },
      appendChild(el) {
        this._host = el;
        el.parentNode = this;
      },
    };
    const map = { id: "projectionMap" };
    display.children = [map];
    const { host, captionEl } = ensureNliExplainerHost(display);
    expect(host.id).toBe("nliExplainerHost");
    expect(host.parentNode).toBe(display);
    expect(captionEl.className).toContain("nli-investigation-timeline-caption");
    applyNliExplainerLayout(host, fallback);
    expect(host.style.transform).toBe(`rotate(${fallback.rotateDeg}deg)`);
    expect(host.style.transform).not.toMatch(/skew/i);
    expect(host.style.transform).not.toMatch(/scale\(/i);
    expect(host.style.left).toBe(`${fallback.leftPct}%`);
    applyNliExplainerLayout(host, { ...fallback, rotateDeg: 50 });
    expect(host.style.transform).toMatch(/rotate\(50deg\)/);
    expect(host.style.transformOrigin).toMatch(/center/i);
  });

  it("committed URL ignores storage conceptually (flag helper)", () => {
    expect(shouldIgnoreExplainerLayoutStore("?nliExplainerLayout=committed")).toBe(true);
    expect(shouldIgnoreExplainerLayoutStore("")).toBe(false);
  });

  it("readNliExplainerLayoutStore ignores JSON arrays and non-objects", () => {
    expect(readNliExplainerLayoutStore("[]")).toEqual({});
    expect(readNliExplainerLayoutStore([])).toEqual({});
    expect(readNliExplainerLayoutStore("null")).toEqual({});
    expect(readNliExplainerLayoutStore("\"x\"")).toEqual({});
    expect(readNliExplainerLayoutStore("{")).toEqual({});
    expect(readNliExplainerLayoutStore('{"full":{"leftPct":9}}').full.leftPct).toBe(9);
  });

  it("projection-main and debug read storage through readNliExplainerLayoutStore", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const main = fs.readFileSync(
      path.resolve(here, "../../frontend/src/entries/projection-main.js"),
      "utf8",
    );
    const debug = fs.readFileSync(
      path.resolve(here, "../../frontend/src/projection/nli-explainer-debug.js"),
      "utf8",
    );
    expect(main).toMatch(/readNliExplainerLayoutStore\(/);
    expect(debug).toMatch(/readNliExplainerLayoutStore\(/);
    expect(main).toMatch(/applyNliExplainerHostPresence\(/);
    expect(debug).toMatch(/applyNliExplainerHostPresence\(/);
    expect(main).not.toMatch(/JSON\.parse\(\s*localStorage\.getItem/);
    expect(debug).not.toMatch(/JSON\.parse\(\s*localStorage\.getItem/);
  });

  it("serialize export has full/left/right and rotateDeg", () => {
    const raw = serializeNliExplainerLayoutMap(MapProjectionConfig.NLI_EXPLAINER_LAYOUT);
    const parsed = JSON.parse(raw);
    expect(parsed.full.rotateDeg).toBe(MapProjectionConfig.NLI_EXPLAINER_LAYOUT.full.rotateDeg);
    expect(parsed.left.leftPct).toBe(MapProjectionConfig.NLI_EXPLAINER_LAYOUT.left.leftPct);
    expect(parsed.left.fontPx).toBe(MapProjectionConfig.NLI_EXPLAINER_LAYOUT.left.fontPx);
    expect(parsed.right.leftPct).toBe(58);
  });

  it("overlap thirds come from PROJECTION_SPAN; defaults miss; bad boxes hit", () => {
    const span = MapProjectionConfig.PROJECTION_SPAN;
    const leftW = span.LEFT_X1 - span.LEFT_X0;
    const leftOverlap = nliExplainerOverlapPageRect("left");
    expect(leftOverlap.leftPct).toBeCloseTo((100 * (span.RIGHT_X0 - span.LEFT_X0)) / leftW);
    expect(leftOverlap.widthPct).toBeCloseTo((100 * (span.LEFT_X1 - span.RIGHT_X0)) / leftW);
    const rightW = span.RIGHT_X1 - span.RIGHT_X0;
    const rightOverlap = nliExplainerOverlapPageRect("right");
    expect(rightOverlap.leftPct).toBe(0);
    expect(rightOverlap.widthPct).toBeCloseTo((100 * (span.LEFT_X1 - span.RIGHT_X0)) / rightW);
    expect(nliExplainerOverlapPageRect("full")).toBe(null);

    const leftDef = MapProjectionConfig.NLI_EXPLAINER_LAYOUT.left;
    const rightDef = MapProjectionConfig.NLI_EXPLAINER_LAYOUT.right;
    expect(nliExplainerBoxHitsOverlap(leftDef, "left")).toBe(true);
    expect(nliExplainerBoxHitsOverlap(rightDef, "right")).toBe(false);
    expect(
      nliExplainerBoxHitsOverlap(
        { leftPct: 80, topPct: 0, widthPct: 20, heightPct: 10, fontPx: 22, rotateDeg: 0 },
        "left",
      ),
    ).toBe(true);
    expect(
      nliExplainerBoxHitsOverlap(
        { leftPct: 6, topPct: 68, widthPct: 42, heightPct: 26, fontPx: 22, rotateDeg: 0 },
        "right",
      ),
    ).toBe(true);
  });

  it("rotated AABB is larger than the unrotated box", () => {
    const layout = { leftPct: 40, topPct: 40, widthPct: 20, heightPct: 10, fontPx: 22, rotateDeg: 45 };
    const aabb = nliExplainerRotatedPageAabb(layout);
    expect(aabb.widthPct).toBeGreaterThan(layout.widthPct);
    expect(aabb.heightPct).toBeGreaterThan(layout.heightPct);
    expect(nliExplainerRotatedPageAabb({ ...layout, rotateDeg: 0 })).toEqual({
      leftPct: 40,
      topPct: 40,
      widthPct: 20,
      heightPct: 10,
    });
  });

  it("rotation can turn an overlap miss into a hit", () => {
    const near = { leftPct: 50, topPct: 40, widthPct: 16, heightPct: 10, fontPx: 22, rotateDeg: 0 };
    expect(nliExplainerBoxHitsOverlap(near, "left")).toBe(false);
    expect(nliExplainerBoxHitsOverlap({ ...near, rotateDeg: 45 }, "left")).toBe(true);
  });

  it("overflow uses unclamped clone height, not ellipsized scrollHeight", () => {
    const padL = 12;
    const padR = 12;
    const clientWidth = 220;
    const clone = { style: {}, scrollHeight: 120, remove() { this.removed = true; } };
    const caption = {
      clientHeight: 40,
      clientWidth,
      scrollHeight: 40,
      cloneNode() {
        return clone;
      },
      parentNode: { appendChild() {} },
    };
    vi.stubGlobal("window", {
      getComputedStyle(el) {
        if (el !== caption) return {};
        return {
          boxSizing: "content-box",
          paddingTop: "6px",
          paddingRight: `${padR}px`,
          paddingBottom: "6px",
          paddingLeft: `${padL}px`,
          fontSize: "22px",
          fontFamily: "Arial",
          lineHeight: "1.35",
          letterSpacing: "0.01em",
        };
      },
    });
    expect(nliExplainerContentOverflows(caption)).toBe(true);
    expect(clone.style.height).toBe("auto");
    expect(clone.style.boxSizing).toBe("border-box");
    expect(clone.style.width).toBe(`${clientWidth}px`);
    expect(clone.style.width).not.toBe(`${clientWidth + padL + padR}px`);
    expect(Number.parseFloat(clone.style.width)).toBeLessThanOrEqual(clientWidth);
    expect(clone.style.paddingLeft).toBe(`${padL}px`);
    expect(clone.style.fontSize).toBe("22px");
    expect(clone.style.webkitLineClamp === "unset" || clone.style.webkitLineClamp === "none").toBe(true);
    vi.unstubAllGlobals();
  });
});

it("styles.css chips wrap narrative; host overflow visible", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const css = fs.readFileSync(path.resolve(here, "../../frontend/css/styles.css"), "utf8");
  expect(css).toMatch(/\.nli-tl-chips\s*\{[^}]*overflow-wrap:\s*normal/);
  expect(css).toMatch(/\.nli-tl-chip\s*\{[^}]*white-space:\s*pre-wrap/);
  expect(css).not.toMatch(/\.nli-tl-chip\s*\{[^}]*white-space:\s*nowrap/);
  expect(css).toMatch(/#nliExplainerHost\s*\{[^}]*overflow:\s*visible/);
  expect(css).toMatch(/#nliExplainerHost \.nli-investigation-timeline-caption\s*\{[^}]*overflow:\s*hidden/);
  expect(css).toMatch(/#nliExplainerHost \.nli-investigation-timeline-caption\s*\{[^}]*font-size:\s*inherit/);
  expect(css).toMatch(/#nliExplainerHost \.nli-investigation-timeline-caption\s*\{[^}]*text-align:\s*start/);
  expect(css).toMatch(/#nliExplainerHost \.nli-investigation-timeline-caption\s*\{[^}]*left:\s*auto/);
  expect(css).toMatch(/#nliExplainerHost \.nli-investigation-timeline-caption\s*\{[^}]*max-width:\s*none/);
  expect(css).toMatch(/#nliExplainerHost \.nli-investigation-timeline-caption\s*\{[^}]*transform:\s*none/);
  expect(css).toMatch(/\.nli-tl-clock\s*\{[^}]*font-size:\s*1\.35em/);
  expect(css).not.toMatch(/\.nli-tl-chips\s*\{[^}]*overflow-wrap:\s*anywhere/);
  expect(css).not.toMatch(/\.nli-tl-chips\s*\{[^}]*overflow-wrap:\s*break-word/);
  expect(css).not.toMatch(/\.nli-investigation-timeline-caption\s+\.nli-tl-names/);
});
