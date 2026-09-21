import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { mountMapLegend } from "../../frontend/src/map/map-legend.js";

function model() {
  return { packs: [{ id: "roads", name: "Roads", layers: [{
    id: "roads.main", name: "Roads", items: [
      { id: "roads.main:a", label: "A very long label that wraps", shape: "line", stroke: "#123456", components: [{ shape: "line", stroke: "#123456" }, { shape: "point", fill: "#fff" }] },
      { id: "roads.main:b", label: "B", shape: "polygon", fill: "#abcdef", stroke: "#111" },
    ],
  }] }] };
}

function groupedModel() {
  const item = (id) => ({ id, label: id, shape: "line", stroke: "#123456" });
  return { packs: [{ id: "investigation", name: "Investigation", layers: [
    { id: "highway", name: "Highway 232", items: [item("highway:a")] },
    { id: "routes", name: "Infiltration routes", items: [item("routes:a"), item("routes:b")] },
    { id: "polygons", name: "Investigation polygons", items: [item("polygons:a"), item("polygons:b"), item("polygons:c")] },
  ] }] };
}

function setup() {
  const element = {
    clientHeight: 400,
    clientWidth: 500,
    innerHTML: "",
    classList: { toggle() {} },
  };
  return { element, surface: {} };
}

function setupWithDocument() {
  let document;
  const measurementStyles = [];
  const makeElement = () => {
    const node = {
      ownerDocument: document,
      className: "",
      innerHTML: "",
      style: {},
      dataset: {},
      children: [],
      clientHeight: 0,
      clientWidth: 500,
      classList: { add() {}, toggle() {} },
      appendChild(child) { this.children.push(child); },
      querySelector(selector) {
        if (selector === ".map-legend-content") return this.children.find((child) => child.className === "map-legend-content") || null;
        if (selector === ".map-legend-pager") return this.children.find((child) => child.className === "map-legend-pager") || null;
        return null;
      },
      addEventListener() {},
      removeEventListener() {},
      getBoundingClientRect() {
        if (this.className.includes("map-legend-measurement")) {
          measurementStyles.push({ ...this.style });
        }
        const width = this.style.width === "max-content"
          ? 264
          : Number.parseFloat(this.style.width) || 420;
        return { height: Math.max(28, (this.innerHTML.match(/class="map-legend-item"/g) || []).length * 28 + 28), width };
      },
      get scrollWidth() {
        const constrainedWidth = Number.parseFloat(this.style.width);
        const layerCount = (this.innerHTML.match(/class="map-legend-layer"/g) || []).length;
        const itemCount = (this.innerHTML.match(/class="map-legend-item"/g) || []).length;
        return Math.max(Number.isFinite(constrainedWidth) ? constrainedWidth : 0, 200, layerCount * 40, itemCount * 100);
      },
      remove() {},
    };
    return node;
  };
  document = { createElement: makeElement, body: { appendChild() {} } };
  const element = makeElement();
  element.clientHeight = 400;
  return {
    element,
    content: () => element.querySelector(".map-legend-content"),
    pager: () => element.querySelector(".map-legend-pager"),
    measurementStyles,
  };
}

describe("mountMapLegend", () => {
  it("renders one labeled row per item and keeps components together", async () => {
    const { element, surface } = setup();
    const build = vi.fn(async () => model());
    const mounted = mountMapLegend({ element, surface, buildModel: build });
    await mounted.refresh();
    expect((element.innerHTML.match(/class="map-legend-item"/g) || [])).toHaveLength(2);
    expect(element.innerHTML).toContain("A very long label that wraps");
    expect((element.innerHTML.match(/class="map-legend-symbol /g) || [])).toHaveLength(3);
    mounted.dispose();
  });

  it("paints infiltration routes as a red carrier with a static dash-walk overlay", async () => {
    const { element } = setup();
    const mounted = mountMapLegend({
      element,
      surface: "gis",
      buildModel: async () => ({
        packs: [{
          id: "nli",
          name: "NLI",
          layers: [{
            id: "nli.lines",
            name: "Infiltration routes",
            items: [{
              id: "nli.lines:main",
              label: "צירי חדירה",
              shape: "line",
              stroke: "#000000",
              dash: { array: [10.8, 13.2] },
              carrier: "#c31f4f",
              halo: "#ffffff",
            }],
          }],
        }],
      }),
    });
    await mounted.refresh();
    expect(element.innerHTML).toContain("#c31f4f");
    expect(element.innerHTML).toContain("#000000");
    expect(element.innerHTML).toContain("repeating-linear-gradient");
    expect(element.innerHTML).toContain("linear-gradient(#c31f4f, #c31f4f)");
    expect(element.innerHTML).toContain("--legend-halo:#ffffff");
    mounted.dispose();
  });

  it("does not paint a white halo on ordinary line chips", async () => {
    const { element } = setup();
    const mounted = mountMapLegend({
      element,
      surface: "gis",
      buildModel: async () => ({
        packs: [{
          id: "roads",
          name: "Roads",
          layers: [{
            id: "roads.main",
            name: "Roads",
            items: [{ id: "roads.main:a", label: "232", shape: "line", stroke: "#873e23" }],
          }],
        }],
      }),
    });
    await mounted.refresh();
    expect(element.innerHTML).not.toContain("--legend-halo:#ffffff");
    expect(element.innerHTML).not.toContain("map-legend-symbol--alarm-shockwave");
    mounted.dispose();
  });

  it("paints alarms with a static shockwave ring and leaves other points alone", async () => {
    const { element } = setup();
    const mounted = mountMapLegend({
      element,
      surface: "gis",
      buildModel: async () => ({
        packs: [{
          id: "nli",
          name: "NLI",
          layers: [{
            id: "nli.alarms",
            name: "Alarms",
            items: [{
              id: "nli.alarms:main",
              label: "אזעקות",
              shape: "point",
              fill: "#f5c542",
              stroke: "#f5c542",
              alarmShockwave: true,
              alarmShockwaveColor: "#f5c542",
            }, {
              id: "fixture.sites:main",
              label: "Site",
              shape: "point",
              fill: "#333333",
            }],
          }],
        }],
      }),
    });
    await mounted.refresh();
    expect((element.innerHTML.match(/map-legend-symbol--alarm-shockwave/g) || [])).toHaveLength(1);
    expect(element.innerHTML).toContain("--legend-alarm-shockwave:#f5c542");
    expect(element.innerHTML).toContain("אזעקות");
    mounted.dispose();
  });

  it("discards stale asynchronous builds and disposes listeners", async () => {
    const { element, surface } = setup();
    let resolveOld;
    const old = new Promise((resolve) => { resolveOld = resolve; });
    const build = vi.fn().mockReturnValueOnce(old).mockResolvedValueOnce(model());
    const mounted = mountMapLegend({ element, surface, buildModel: build });
    const first = mounted.refresh();
    await mounted.refresh();
    resolveOld({ packs: [{ id: "old", name: "Old", layers: [] }] });
    await first;
    expect(element.innerHTML).not.toContain("Old");
    mounted.dispose();
    expect(() => mounted.refresh()).not.toThrow();
  });

  it("updates direction from the server language while preserving stable rows", async () => {
    const { element, surface } = setup();
    let language = "en";
    const mounted = mountMapLegend({
      element,
      surface,
      dataContext: { getLegendSettings: () => ({ language }) },
      buildModel: async () => model(),
    });
    await mounted.refresh();
    expect(element.dir).toBe("ltr");
    expect(element.innerHTML.match(/data-legend-item-id=/g)).toHaveLength(2);
    language = "he";
    await mounted.refresh();
    expect(element.dir).toBe("rtl");
    expect(element.innerHTML.match(/data-legend-item-id=/g)).toHaveLength(2);
    mounted.dispose();
  });

  it("publishes a complete projection page snapshot and clears it for right span or producer failure", async () => {
    const { element } = setupWithDocument();
    const snapshots = [];
    const mounted = mountMapLegend({
      element,
      surface: "projection",
      projectionSpan: "left",
      dataContext: { getLegendSettings: () => ({ language: "en", projection: { left: { fontPx: 16 } } }) },
      buildModel: async () => model(),
      onRenderSnapshot: (snapshot) => snapshots.push(snapshot),
    });
    await mounted.refresh();
    const current = mounted.getRenderSnapshot();
    expect(current.language).toBe("en");
    expect(current.spanId).toBe("left");
    expect(current.visible).toBe(true);
    expect(current.blocks).toHaveLength(1);
    expect(snapshots.at(-1).blocks).toEqual(current.blocks);
    mounted.dispose();
    expect(snapshots.at(-1).visible).toBe(false);
    expect(snapshots.at(-1).blocks).toEqual([]);

    const rightSnapshots = [];
    const right = mountMapLegend({
      element: setup().element,
      surface: "projection",
      projectionSpan: "right",
      buildModel: async () => model(),
      onRenderSnapshot: (snapshot) => rightSnapshots.push(snapshot),
    });
    await right.refresh();
    expect(rightSnapshots.at(-1).visible).toBe(false);
    right.dispose();

    const failedSnapshots = [];
    const failed = mountMapLegend({
      element: setup().element,
      surface: "projection",
      buildModel: async () => { throw new Error("fixture failure"); },
      onRenderSnapshot: (snapshot) => failedSnapshots.push(snapshot),
    });
    await failed.refresh();
    expect(failedSnapshots.at(-1).visible).toBe(false);
    expect(failedSnapshots.at(-1).blocks).toEqual([]);
    failed.dispose();
  });

  it("renders same-pack GIS layers in one group without layer subtitles", async () => {
    const { element } = setup();
    element.clientWidth = 80;
    vi.stubGlobal("window", { innerWidth: 800 });
    const mounted = mountMapLegend({ element, surface: "gis", buildModel: async () => groupedModel() });
    await mounted.refresh();
    expect(element.innerHTML.match(/class="map-legend-group"/g)).toHaveLength(1);
    expect(element.innerHTML.match(/class="map-legend-group-title"/g)).toHaveLength(1);
    expect(element.innerHTML).not.toContain("map-legend-layer-title");
    expect(element.innerHTML.match(/data-legend-item-id=/g)).toHaveLength(6);
    expect(element.innerHTML).not.toContain("Investigation polygons");
    expect(element.innerHTML).not.toContain(">Highway 232<");
    expect(element.innerHTML).not.toContain(">Infiltration routes<");
    mounted.dispose();
    vi.unstubAllGlobals();
  });

  it("keeps one-item layers as sibling items in one GIS wrap group", async () => {
    const { element } = setup();
    const mounted = mountMapLegend({
      element,
      surface: "gis",
      buildModel: async () => ({
        packs: [{ id: "roads", name: "Roads", layers: [
          { id: "highway", name: "Highway 232", items: [{ id: "highway:a", label: "232" }] },
          { id: "routes", name: "Infiltration routes", items: [{ id: "routes:a", label: "Route" }] },
        ] }],
      }),
    });
    await mounted.refresh();
    const layers = element.innerHTML.match(/<div class="map-legend-layers">([\s\S]+)<\/div><\/section>/)?.[1] || "";
    expect(layers.match(/class="map-legend-item"/g)).toHaveLength(2);
    expect(layers).not.toContain("map-legend-layer-title");
    mounted.dispose();
  });

  it("keeps a fitting multi-layer GIS pack on one page", async () => {
    const { element, content, pager } = setupWithDocument();
    vi.stubGlobal("window", { innerWidth: 800 });
    const mounted = mountMapLegend({
      element,
      surface: "gis",
      dataContext: { getLegendSettings: () => ({ language: "en" }) },
      buildModel: async () => groupedModel(),
    });
    await mounted.refresh();
    expect(content().innerHTML.match(/class="map-legend-group"/g)).toHaveLength(1);
    expect(content().innerHTML.match(/data-legend-item-id=/g)).toHaveLength(6);
    expect(pager().hidden).toBe(true);
    expect(pager().innerHTML).toBe("");
    mounted.dispose();
    vi.unstubAllGlobals();
  });

  it("uses a quiet compact pager when GIS packs exceed the viewport strip", async () => {
    const { element, pager } = setupWithDocument();
    vi.stubGlobal("window", { innerWidth: 300 });
    const mounted = mountMapLegend({
      element,
      surface: "gis",
      dataContext: { getLegendSettings: () => ({ language: "en" }) },
      buildModel: async () => groupedModel(),
    });
    await mounted.refresh();
    expect(pager().hidden).toBe(false);
    expect(pager().innerHTML).not.toContain("More in the legend");
    expect(pager().innerHTML).not.toContain("עוד במקרא");
    expect(pager().innerHTML).toMatch(/1 \/ [2-9]/);
    expect(pager().innerHTML).toContain("data-legend-next");
    mounted.dispose();
    vi.unstubAllGlobals();
  });

  it("keeps two small GIS packs on one two-row rail", async () => {
    const { element, content, pager } = setupWithDocument();
    vi.stubGlobal("window", { innerWidth: 1200 });
    const item = (id) => ({ id, label: id, shape: "line", stroke: "#123456" });
    const mounted = mountMapLegend({
      element,
      surface: "gis",
      dataContext: { getLegendSettings: () => ({ language: "en" }) },
      buildModel: async () => ({
        packs: [
          { id: "roads", name: "Roads", layers: [{ id: "roads.main", name: "Roads", items: [item("roads:a")] }] },
          { id: "parks", name: "Parks", layers: [{ id: "parks.main", name: "Parks", items: [item("parks:a")] }] },
        ],
      }),
    });
    await mounted.refresh();
    expect(content().innerHTML.match(/class="map-legend-group"/g)).toHaveLength(2);
    expect(pager().hidden).toBe(true);
    mounted.dispose();
    vi.unstubAllGlobals();
  });

  it("fragments one oversized GIS pack into pager-addressable two-row wraps", async () => {
    const { element, pager } = setupWithDocument();
    vi.stubGlobal("window", { innerWidth: 300 });
    const items = Array.from({ length: 7 }, (_, index) => ({
      id: `areas:${index}`,
      label: `Area ${index}`,
      shape: "polygon",
      fill: "#abcdef",
    }));
    const mounted = mountMapLegend({
      element,
      surface: "gis",
      dataContext: { getLegendSettings: () => ({ language: "en" }) },
      buildModel: async () => ({
        packs: [{ id: "areas", name: "Areas", layers: [{ id: "areas.main", name: "Areas", items }] }],
      }),
    });
    await mounted.refresh();
    expect(pager().dataset.legendOverflow).toBe("false");
    expect(pager().innerHTML).toMatch(/1 \/ [2-9]/);
    mounted.dispose();
    vi.unstubAllGlobals();
  });

  it("shares one projection pack heading across consecutive layers on a page", async () => {
    const { element } = setup();
    const mounted = mountMapLegend({ element, surface: "projection", buildModel: async () => groupedModel() });
    await mounted.refresh();
    expect(element.innerHTML.match(/class="map-legend-group-title"/g)).toHaveLength(1);
    mounted.dispose();
  });

  it("keeps a fitting six-item projection pack on one page across layers", async () => {
    const { element, content, pager } = setupWithDocument();
    element.clientHeight = 300;
    const item = (id) => ({ id, label: id, shape: "line", stroke: "#123456" });
    const mounted = mountMapLegend({
      element,
      surface: "projection",
      buildModel: async () => ({
        packs: [{
          id: "nli",
          name: "NLI",
          layers: Array.from({ length: 6 }, (_, index) => ({
            id: `nli.layer-${index}`,
            name: `Layer ${index}`,
            items: [item(`nli:item-${index}`)],
          })),
        }],
      }),
    });
    await mounted.refresh();
    expect(content().innerHTML.match(/data-legend-item-id=/g)).toHaveLength(6);
    expect(pager().hidden).toBe(true);
    expect(pager().innerHTML).toBe("");
    mounted.dispose();
  });

  it("uses non-breaking legend labels, pack-level projection columns, and Guttman type", () => {
    const css = readFileSync(new URL("../../frontend/css/styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.map-legend\s*\{[^}]*font(?:-family|):\s*"Guttman Hatzvi",\s*"Noto Sans Hebrew",\s*Arial,\s*sans-serif/s);
    expect(css).toMatch(/\.map-legend-label\s*\{[^}]*overflow-wrap:\s*normal[^}]*word-break:\s*keep-all/s);
    expect(css).toMatch(/\.map-legend-projection \.map-legend-layers\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s);
    expect(css).toMatch(/\.map-legend-projection \.map-legend-layer\s*\{[^}]*display:\s*contents/s);
    expect(css).toMatch(/\.map-legend-symbol--line\s*\{[^}]*box-shadow:\s*0 0 0 1px color-mix\(\s*in srgb,\s*var\(--legend-halo,\s*transparent\) 35%,\s*transparent\s*\)/s);
    expect(css).toMatch(/\.map-legend-symbol--alarm-shockwave::after\s*\{[^}]*border:\s*1(?:\.6)?px solid color-mix\(\s*in srgb,\s*var\(--legend-alarm-shockwave,\s*transparent\) 40%,\s*transparent\s*\)/s);
    expect(css).toMatch(/\.map-legend-symbol::before\s*\{[^}]*border-radius:\s*inherit/s);
    expect(css).toMatch(/\.map-legend-symbol--point\s*\{[^}]*border-radius:\s*50%/s);
  });

  it("renders only a quiet page count for multi-page projection legends", async () => {
    vi.useFakeTimers();
    const { element, pager } = setupWithDocument();
    element.clientHeight = 80;
    const mounted = mountMapLegend({
      element,
      surface: "projection",
      buildModel: async () => groupedModel(),
    });
    await mounted.refresh();
    expect(pager().innerHTML).toMatch(/1 \/ [2-9]/);
    expect(pager().innerHTML).not.toContain("More in the legend");
    expect(pager().innerHTML).not.toContain("does not fit");
    expect(pager().innerHTML).not.toContain("data-legend-prev");
    expect(pager().innerHTML).not.toContain("data-legend-next");
    mounted.dispose();
    vi.useRealTimers();
  });

  it("isolates page counts from RTL ordering", async () => {
    vi.useFakeTimers();
    const { element, pager } = setupWithDocument();
    element.clientHeight = 80;
    const mounted = mountMapLegend({
      element,
      surface: "projection",
      dataContext: { getLegendSettings: () => ({ language: "he" }) },
      buildModel: async () => groupedModel(),
    });
    await mounted.refresh();
    expect(pager().innerHTML).toMatch(/<span dir="ltr" data-legend-count>1 \/ [2-9]<\/span>/);
    mounted.dispose();
    vi.useRealTimers();
  });

  it("uses the active projection span dwell before the full-span fallback", async () => {
    vi.useFakeTimers();
    const { element, content } = setupWithDocument();
    element.clientHeight = 80;
    const mounted = mountMapLegend({
      element,
      surface: "projection",
      projectionSpan: "left",
      dataContext: {
        getLegendSettings: () => ({
          language: "en",
          projection: {
            left: { dwellSeconds: 3 },
            full: { dwellSeconds: 20 },
          },
        }),
      },
      buildModel: async () => groupedModel(),
    });
    await mounted.refresh();
    const firstPage = content().innerHTML;
    vi.advanceTimersByTime(3000);
    expect(content().innerHTML).not.toBe(firstPage);
    mounted.dispose();
    vi.useRealTimers();
  });

  it("auto-advances GIS pages on the same dwell as projection", async () => {
    vi.useFakeTimers();
    const { element, content, pager } = setupWithDocument();
    vi.stubGlobal("window", { innerWidth: 300 });
    const mounted = mountMapLegend({
      element,
      surface: "gis",
      dataContext: {
        getLegendSettings: () => ({
          language: "en",
          projection: { full: { dwellSeconds: 3 } },
        }),
      },
      buildModel: async () => groupedModel(),
    });
    await mounted.refresh();
    expect(pager().hidden).toBe(false);
    expect(pager().innerHTML).toContain("data-legend-prev");
    expect(pager().innerHTML).toContain("data-legend-next");
    const firstPage = content().innerHTML;
    vi.advanceTimersByTime(3000);
    expect(content().innerHTML).not.toBe(firstPage);
    expect(pager().innerHTML).toContain("data-legend-next");
    mounted.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders polygon fill and stroke opacity independently", async () => {
    const { element } = setup();
    const mounted = mountMapLegend({
      element,
      surface: "gis",
      buildModel: async () => ({
        packs: [{ id: "areas", name: "Areas", layers: [{
          id: "areas.main",
          name: "Areas",
          items: [{
            id: "areas.main:a",
            label: "Translucent area",
            shape: "polygon",
            fill: "#abcdef",
            fillOpacity: 0.35,
            stroke: "#111111",
            strokeOpacity: 0.7,
          }],
        }] }],
      }),
    });
    await mounted.refresh();
    expect(element.innerHTML).toContain("--legend-fill-opacity:0.35");
    expect(element.innerHTML).toContain("--legend-stroke-opacity:0.7");
    mounted.dispose();
  });

  it("renders oversized projection content without a fit warning", async () => {
    const { element, content, pager } = setupWithDocument();
    element.clientHeight = 80;
    const mounted = mountMapLegend({
      element,
      surface: "projection",
      dataContext: { getLegendSettings: () => ({ language: "en" }) },
      buildModel: async () => model(),
    });
    await mounted.refresh();
    expect(content().innerHTML).toContain("A very long label that wraps");
    expect(pager().innerHTML).not.toContain("does not fit");
    mounted.dispose();
  });

  it("omits layer titles from split projection fragments", async () => {
    vi.useFakeTimers();
    const { element, content } = setupWithDocument();
    element.clientHeight = 80;
    const mounted = mountMapLegend({
      element,
      surface: "projection",
      dataContext: { getLegendSettings: () => ({ language: "en" }) },
      buildModel: async () => ({ packs: [{ id: "areas", name: "Areas", layers: [{
        id: "areas.polygons",
        name: "Investigation polygons",
        items: groupedModel().packs[0].layers[2].items,
      }] }] }),
    });
    await mounted.refresh();
    expect(content().innerHTML).not.toContain("Investigation polygons");
    expect(content().innerHTML).not.toContain("map-legend-layer-title");
    expect(content().innerHTML).not.toContain("continued");
    vi.advanceTimersByTime(8000);
    expect(content().innerHTML).not.toContain("Investigation polygons");
    expect(content().innerHTML).not.toContain("map-legend-layer-title");
    expect(content().innerHTML).not.toContain("continued");
    mounted.dispose();
    vi.useRealTimers();
  });

  it("omits Hebrew continuation markers from projection fragments", async () => {
    vi.useFakeTimers();
    const { element, content } = setupWithDocument();
    element.clientHeight = 80;
    const mounted = mountMapLegend({
      element,
      surface: "projection",
      dataContext: { getLegendSettings: () => ({ language: "he" }) },
      buildModel: async () => ({ packs: [{ id: "areas", name: "Areas", layers: [{
        id: "areas.polygons",
        name: "Investigation polygons",
        items: groupedModel().packs[0].layers[2].items,
      }] }] }),
    });
    await mounted.refresh();
    vi.advanceTimersByTime(8000);
    expect(content().innerHTML).not.toContain("· המשך");
    expect(content().innerHTML).not.toContain("map-legend-layer-title");
    expect(content().innerHTML).not.toContain("continued");
    mounted.dispose();
    vi.useRealTimers();
  });

  it("measures projection content with the live panel font", async () => {
    const { element, measurementStyles } = setupWithDocument();
    vi.stubGlobal("getComputedStyle", () => ({
      fontSize: "12px",
      fontFamily: "Projection Sans",
    }));
    const mounted = mountMapLegend({
      element,
      surface: "projection",
      buildModel: async () => model(),
    });
    await mounted.refresh();
    expect(measurementStyles).not.toHaveLength(0);
    expect(measurementStyles.every((style) => style.fontSize === "12px")).toBe(true);
    expect(measurementStyles.every((style) => style.fontFamily === "Projection Sans")).toBe(true);
    mounted.dispose();
    vi.unstubAllGlobals();
  });
});
