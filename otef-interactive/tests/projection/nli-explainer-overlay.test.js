import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, test, vi } from "vitest";
import MapProjectionConfig from "../../frontend/src/shared/map-projection-config.js";
import {
  applyNliExplainerLayout,
  applyNliExplainerHostPresence,
  clampNliExplainerLayout,
  emptyNliClockLayout,
  ensureNliExplainerHost,
  gisClockLayoutSlotId,
  normalizeNliClockLayout,
  mergeGisClockLayout,
  mergeNliExplainerLayout,
  nliExplainerShouldPaintOnSpan,
  nliExplainerSpanKey,
  nliExplainerContentOverflows,
  NLI_GIS_CLOCK_DEFAULT_LAYOUT,
  readGisClockLayoutStore,
  readNliExplainerLayoutStore,
  serializeGisClockLayoutMap,
  serializeNliExplainerLayoutMap,
} from "../../frontend/src/projection/nli-explainer-overlay.js";

const fallback = MapProjectionConfig.NLI_EXPLAINER_LAYOUT.full;

describe("nli explainer layout", () => {
  it("span keys follow ?span=", () => {
    expect(nliExplainerSpanKey("")).toBe("full");
    expect(nliExplainerSpanKey("?span=left")).toBe("left");
    expect(nliExplainerSpanKey("?span=right")).toBe("right");
    expect(nliExplainerShouldPaintOnSpan("full")).toBe(false);
    expect(nliExplainerShouldPaintOnSpan("left")).toBe(true);
    expect(nliExplainerShouldPaintOnSpan("right")).toBe(false);
    expect(nliExplainerShouldPaintOnSpan(null)).toBe(false);
  });

  it("hides the host on span=right", () => {
    const host = { style: {} };
    applyNliExplainerHostPresence(host, "left");
    expect(host.style.display).toBe("");
    applyNliExplainerHostPresence(host, "right");
    expect(host.style.display).toBe("none");
    applyNliExplainerHostPresence(host, "full");
    expect(host.style.display).toBe("none");
    applyNliExplainerHostPresence(host, "left");
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

  it("clamps width and height down to 2 percent so the box can hug the clock", () => {
    const out = clampNliExplainerLayout(
      { leftPct: 40, topPct: 40, widthPct: 1, heightPct: 1, fontPx: 12, rotateDeg: 0 },
      fallback,
    );
    expect(out.widthPct).toBe(2);
    expect(out.heightPct).toBe(2);
  });

  it("merges stored span over defaults", () => {
    const stored = { left: { leftPct: 10, topPct: 10, widthPct: 20, heightPct: 20, fontPx: 18 } };
    const layout = mergeNliExplainerLayout("left", stored, MapProjectionConfig.NLI_EXPLAINER_LAYOUT);
    expect(layout.leftPct).toBe(10);
    expect(layout.rotateDeg).toBe(MapProjectionConfig.NLI_EXPLAINER_LAYOUT.left.rotateDeg);
    expect(mergeNliExplainerLayout("full", stored, MapProjectionConfig.NLI_EXPLAINER_LAYOUT).leftPct).toBe(
      MapProjectionConfig.NLI_EXPLAINER_LAYOUT.full.leftPct,
    );
  });

  it("uses the committed calibrated left layout without changing full or right", () => {
    expect(MapProjectionConfig.NLI_EXPLAINER_LAYOUT).toEqual({
      full: { leftPct: 31.83, topPct: 48.95, widthPct: 16.7, heightPct: 19.75, fontPx: 12, rotateDeg: -48.5 },
      left: {
        leftPct: 22.100834647739227,
        topPct: 31.61002744422372,
        widthPct: 8.886423224258024,
        heightPct: 8.323215088627478,
        fontPx: 56,
        rotateDeg: 91.18739188335852,
      },
      right: { leftPct: 58, topPct: 68, widthPct: 42, heightPct: 26, fontPx: 22, rotateDeg: 0 },
    });
  });

  test("GIS clock slot ids follow narrative id with start fallback", () => {
    expect(gisClockLayoutSlotId(null)).toBe("start");
    expect(gisClockLayoutSlotId("segev")).toBe("segev");
    expect(gisClockLayoutSlotId("nova")).toBe("nova");
    expect(gisClockLayoutSlotId("sderot")).toBe("sderot");
    expect(gisClockLayoutSlotId("hostages")).toBe("hostages");
    expect(mergeGisClockLayout("sderot", {}, NLI_GIS_CLOCK_DEFAULT_LAYOUT))
      .toEqual(NLI_GIS_CLOCK_DEFAULT_LAYOUT);
    expect(mergeGisClockLayout("hostages", {}, NLI_GIS_CLOCK_DEFAULT_LAYOUT))
      .toEqual(NLI_GIS_CLOCK_DEFAULT_LAYOUT);
    expect(gisClockLayoutSlotId("unknown-future")).toBe("start");
  });

  test("flat v2 GIS clock blob migrates into start and preserves unknown keys", () => {
    const migrated = readGisClockLayoutStore(JSON.stringify({
      leftPct: 12, topPct: 80, widthPct: 30, heightPct: 10, fontPx: 20, rotateDeg: 5,
    }));
    expect(migrated.start.leftPct).toBe(12);
    expect(migrated.start.topPct).toBe(80);
    const keyed = readGisClockLayoutStore(JSON.stringify({
      start: NLI_GIS_CLOCK_DEFAULT_LAYOUT,
      nova: { ...NLI_GIS_CLOCK_DEFAULT_LAYOUT, topPct: 10 },
      futureSlot: { ...NLI_GIS_CLOCK_DEFAULT_LAYOUT, leftPct: 1 },
    }));
    expect(keyed.nova.topPct).toBe(10);
    expect(keyed.futureSlot.leftPct).toBe(1);
    expect(mergeGisClockLayout("segev", keyed, NLI_GIS_CLOCK_DEFAULT_LAYOUT)).toEqual(
      NLI_GIS_CLOCK_DEFAULT_LAYOUT,
    );
    const roundTrip = JSON.parse(serializeGisClockLayoutMap(keyed));
    expect(roundTrip.futureSlot.leftPct).toBe(1);
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

  it("readNliExplainerLayoutStore ignores JSON arrays and non-objects", () => {
    expect(readNliExplainerLayoutStore("[]")).toEqual({});
    expect(readNliExplainerLayoutStore([])).toEqual({});
    expect(readNliExplainerLayoutStore("null")).toEqual({});
    expect(readNliExplainerLayoutStore("\"x\"")).toEqual({});
    expect(readNliExplainerLayoutStore("{")).toEqual({});
    expect(readNliExplainerLayoutStore('{"full":{"leftPct":9}}').full.leftPct).toBe(9);
  });

  it("projection runtime reads the acknowledged left clock slot and has no debug writer", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const main = fs.readFileSync(
      path.resolve(here, "../../frontend/src/entries/projection-main.js"),
      "utf8",
    );
    expect(main).toMatch(/getNliClockLayout/);
    expect(main).toMatch(/projection\?\.left/);
    expect(main).toMatch(/applyNliExplainerHostPresence\(/);
    expect(main).not.toMatch(/JSON\.parse\(\s*localStorage\.getItem/);
    expect(main).not.toMatch(/NliExplainerDebug|setNliClockLayout\(/);
  });

  it("serialize export has full/left/right and rotateDeg", () => {
    const raw = serializeNliExplainerLayoutMap(MapProjectionConfig.NLI_EXPLAINER_LAYOUT);
    const parsed = JSON.parse(raw);
    expect(parsed.full.rotateDeg).toBe(MapProjectionConfig.NLI_EXPLAINER_LAYOUT.full.rotateDeg);
    expect(parsed.left.leftPct).toBe(MapProjectionConfig.NLI_EXPLAINER_LAYOUT.left.leftPct);
    expect(parsed.left.fontPx).toBe(MapProjectionConfig.NLI_EXPLAINER_LAYOUT.left.fontPx);
    expect(parsed.right.leftPct).toBe(58);
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
  expect(css).toMatch(/#nliExplainerHost\s*\{[^}]*z-index:\s*12/);
  expect(css).toMatch(/#nliExplainerHost\s*\{[^}]*overflow:\s*visible/);
  expect(css).toMatch(/#nliGisClockHost\s*\{[^}]*z-index:\s*20/);
  expect(css).toMatch(/#nliExplainerHost \.nli-investigation-timeline-caption\s*\{[^}]*pointer-events:\s*auto/);
  expect(css).toMatch(/#nliGisClockHost \.nli-investigation-timeline-caption\s*\{[^}]*pointer-events:\s*auto/);
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

describe("nova explainer maps in the clock layout document", () => {
  test("empty layout includes independent close and wide maps", () => {
    expect(emptyNliClockLayout()).toEqual({
      gis: {},
      projection: {},
      gisOverlays: { novaExplainers: { close: {}, wide: {} } },
    });
  });

  test("normalize keeps clock slots and drops non-story explainer ids", () => {
    const raw = {
      gis: { start: { leftPct: 10, topPct: 80, widthPct: 20, heightPct: 8, fontPx: 22, rotateDeg: 0 } },
      projection: { left: { leftPct: 40, topPct: 20, widthPct: 10, heightPct: 8, fontPx: 40, rotateDeg: 90 } },
      gisOverlays: {
        novaExplainers: {
          close: { "100": { leftPct: 101, topPct: -1 }, "107": { leftPct: 1, topPct: 1 } },
          wide: { "104": { leftPct: 8, topPct: 18 } },
        },
      },
    };
    expect(normalizeNliClockLayout(raw)).toEqual({
      gis: { start: { leftPct: 10, topPct: 80, widthPct: 20, heightPct: 8, fontPx: 22, rotateDeg: 0 } },
      projection: { left: { leftPct: 40, topPct: 20, widthPct: 10, heightPct: 8, fontPx: 40, rotateDeg: 90 } },
      gisOverlays: {
        novaExplainers: {
          close: { "100": { leftPct: 100, topPct: 0 } },
          wide: { "104": { leftPct: 8, topPct: 18 } },
        },
      },
    });
    expect(raw.gisOverlays.novaExplainers.close["100"].leftPct).toBe(101);
  });

  test("missing overlay data normalizes to empty maps", () => {
    expect(normalizeNliClockLayout({ gis: {}, projection: {} }).gisOverlays).toEqual({
      novaExplainers: { close: {}, wide: {} },
    });
    expect(normalizeNliClockLayout(null).gisOverlays.novaExplainers).toEqual({ close: {}, wide: {} });
  });
});
