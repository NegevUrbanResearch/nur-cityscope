import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { applyProjectionLegendLayout, mountMapLegend } from "../../frontend/src/map/map-legend.js";
import { createProjectionLegendAdapter } from "../../frontend/src/projection/projection-legend-adapter.js";

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
  it("applies saved reference-plane geometry and hides only the right DOM legend", () => {
    const element = { style: {} };
    const parent = { getBoundingClientRect: () => ({ width: 1920, height: 1080 }) };
    const layout = { leftPct: 10, topPct: 20, widthPct: 30, heightPct: 14, fontPx: 24, rotateDeg: 15 };
    applyProjectionLegendLayout(element, layout, { span: "left", referenceElement: parent });
    expect(element.style).toMatchObject({
      left: "192px", top: "216px", width: "576px", height: "151.2px",
      fontSize: "24px", transform: "rotate(15deg)", display: "",
    });
    applyProjectionLegendLayout(element, layout, { span: "right", referenceElement: parent });
    expect(element.style.display).toBe("none");
    applyProjectionLegendLayout(element, layout, { span: "full", referenceElement: parent });
    expect(element.style.display).toBe("");
  });

  it("fits projection content from saved left geometry and refreshes metadata without placement writes", async () => {
    const { element } = setupWithDocument();
    const settings = {
      language: "he",
      summarizedGroupIds: [],
      projection: { left: { leftPct: 5, topPct: 10, widthPct: 15, heightPct: 45, fontPx: 14, rotateDeg: 0 } },
    };
    const setPlacement = vi.fn();
    element.parentElement = { getBoundingClientRect: () => ({ width: 1920, height: 1080 }) };
    Object.defineProperty(element, "clientWidth", { configurable: true, get: () => Number.parseFloat(element.style.width) || 500 });
    Object.defineProperty(element, "clientHeight", { configurable: true, get: () => Number.parseFloat(element.style.height) || 400 });
    const mounted = mountMapLegend({
      element,
      surface: "projection",
      projectionSpan: "left",
      dataContext: { getLegendSettings: () => settings, setLegendLayout: setPlacement },
      buildModel: async () => groupedModel(),
    });
    await mounted.refresh();
    expect(mounted.getRenderSnapshot().pages).toHaveLength(1);
    expect(element.style.width).toBe("288px");
    expect(element.style.fontSize).toBe("14px");
    settings.language = "en";
    settings.summarizedGroupIds = ["investigation"];
    settings.projection.left = { ...settings.projection.left, widthPct: 75, fontPx: 20 };
    await mounted.refresh();
    expect(element.style.width).toBe("1440px");
    expect(element.style.fontSize).toBe("20px");
    expect(mounted.getRenderSnapshot().language).toBe("en");
    expect(mounted.getRenderSnapshot().pages).toHaveLength(1);
    expect(setPlacement).not.toHaveBeenCalled();
    mounted.dispose();
  });

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
    expect(current.pages).toEqual([current.blocks.map((block) => block.id)]);
    expect(current.pageIndex).toBe(0);
    expect(current.contentLayout).toMatchObject({ columns: expect.any(Number), scale: expect.any(Number), placements: expect.any(Array) });
    expect(current.fontRevision).toBe(0);
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

    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failedSnapshots = [];
    const failed = mountMapLegend({
      element: setup().element,
      surface: "projection",
      buildModel: async () => { throw new Error("fixture failure"); },
      onRenderSnapshot: (snapshot) => failedSnapshots.push(snapshot),
    });
    try {
      await failed.refresh();
      expect(warning).toHaveBeenCalledExactlyOnceWith("[MapLegend] build failed", expect.objectContaining({ message: "fixture failure" }));
    } finally {
      warning.mockRestore();
    }
    expect(failedSnapshots.at(-1).visible).toBe(false);
    expect(failedSnapshots.at(-1).blocks).toEqual([]);
    failed.dispose();
  });

  it("keeps every oversized projection item in one fitted snapshot page while GIS still paginates", async () => {
    const packs = Array.from({ length: 5 }, (_, packIndex) => ({
      id: `pack-${packIndex}`,
      name: `Pack ${packIndex}`,
      layers: [{
        id: `layer-${packIndex}`,
        items: Array.from({ length: 8 }, (_, itemIndex) => ({
          id: `item-${packIndex}-${itemIndex}`,
          label: `Legend item ${packIndex} ${itemIndex}`,
          shape: "line",
          stroke: "#123456",
        })),
      }],
    }));
    const oversizedModel = { packs };
    const { element } = setupWithDocument();
    element.clientWidth = 180;
    element.clientHeight = 72;
    const projection = mountMapLegend({ element, surface: "projection", buildModel: async () => oversizedModel,
      measureText: (text) => ({ width: text.length * 7, actualBoundingBoxRight: text.length * 7, actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 4 }) });
    await projection.refresh();
    const snapshot = projection.getRenderSnapshot();
    expect(snapshot.blocks.flatMap((block) => block.layers.flatMap((layer) => layer.items)).map((item) => item.id)).toHaveLength(40);
    expect(snapshot.pages).toEqual([snapshot.blocks.map((block) => block.id)]);
    expect(snapshot.pageIndex).toBe(0);
    expect(projection.setPage(99)).toBe(0);
    projection.dispose();

    const gis = mountMapLegend({ element: setupWithDocument().element, surface: "gis", buildModel: async () => oversizedModel });
    await gis.refresh();
    expect(gis.getRenderSnapshot().pages.length).toBeGreaterThan(1);
    gis.dispose();
  });

  it("uses identical fitted multiline placements in projection DOM and canvas", async () => {
    const { element, content } = setupWithDocument();
    element.parentElement = { getBoundingClientRect: () => ({ width: 1920, height: 1080 }) };
    const layout = { leftPct: 4, topPct: 5, widthPct: 2.05, heightPct: 20, fontPx: 16, columns: 1, rotateDeg: 0 };
    const metrics = (text) => ({ width: [...text].length * 5, actualBoundingBoxLeft: 0, actualBoundingBoxRight: [...text].length * 5,
      actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 4 });
    const mounted = mountMapLegend({ element, surface: "projection", projectionSpan: "left", dataContext: { getLegendSettings: () => ({ language: "en", projection: { left: layout } }) },
      buildModel: async () => ({ packs: [{ id: "mixed", layers: [{ id: "mixed.labels", items: [
        { id: "latin-first", label: "North & South Hebrew שלום", shape: "line", stroke: "#123456" },
        { id: "hebrew-first", label: "דרך South line", shape: "point", fill: "#fff" },
      ] }] }] }), measureText: metrics });
    await mounted.refresh();
    const snapshot = mounted.getRenderSnapshot();
    const domLines = [...content().innerHTML.matchAll(/class="map-legend-label map-legend-projection-line"[^>]*>(.*?)<\/text>/g)].map((match) => match[1]);
    const planLines = snapshot.contentLayout.placements.flatMap((placement) => placement.labelLines.map((line) => line.replaceAll("&", "&amp;")));
    expect(domLines).toEqual(planLines);
    expect(snapshot.contentLayout.placements.map((placement) => placement.labelDirection)).toEqual(["ltr", "rtl"]);
    expect(content().style.width).toBe("39px");
    expect(Number.parseFloat(content().style.left)).toBeCloseTo(0.18, 6);
    expect(content().style.transformOrigin).toBe("top left");

    const calls = [];
    const context = new Proxy({ measureText: metrics }, { get(target, key) { return key in target ? target[key] : (...args) => calls.push([key, ...args]); },
      set(target, key, value) { target[key] = value; return true; } });
    const canvas = { width: 0, height: 0, getContext: () => context };
    const adapter = createProjectionLegendAdapter({ canvasFactory: () => canvas });
    adapter.sync(snapshot);
    adapter.draw();
    expect(calls.filter(([name]) => name === "fillText").map(([, line]) => line)).toEqual(snapshot.contentLayout.placements.flatMap((placement) => placement.labelLines));
    expect(calls.some(([name, x, y]) => name === "scale" && x === snapshot.contentLayout.scale && y === snapshot.contentLayout.scale)).toBe(true);
    adapter.dispose();
    mounted.dispose();
  });

  it("increments fontRevision after font loading even when fitted metrics stay identical", async () => {
    const { element } = setupWithDocument();
    let loadingDone;
    element.ownerDocument.fonts = { addEventListener: (_name, callback) => { loadingDone = callback; }, removeEventListener() {} };
    vi.stubGlobal("document", element.ownerDocument);
    const measureText = (text) => ({ width: text.length * 6, actualBoundingBoxRight: text.length * 6, actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 4 });
    const mounted = mountMapLegend({ element, surface: "projection", buildModel: async () => model(), measureText });
    await mounted.refresh();
    const before = mounted.getRenderSnapshot();
    loadingDone();
    await vi.waitFor(() => expect(mounted.getRenderSnapshot().fontRevision).toBe(1));
    const after = mounted.getRenderSnapshot();
    expect(after.contentLayout).toEqual(before.contentLayout);
    mounted.dispose();
    vi.unstubAllGlobals();
  });

  it("renders same-pack GIS layers in one group without layer subtitles", async () => {
    const { element } = setup();
    element.clientWidth = 80;
    vi.stubGlobal("window", { innerWidth: 800 });
    const mounted = mountMapLegend({ element, surface: "gis", buildModel: async () => groupedModel() });
    await mounted.refresh();
    expect(element.innerHTML.match(/class="map-legend-group"/g)).toHaveLength(1);
    expect(element.innerHTML.match(/class="map-legend-group-title"/g)).toBeNull();
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

  it("renders projection pack layers as planner-positioned items without headings", async () => {
    const { element } = setup();
    const mounted = mountMapLegend({ element, surface: "projection", buildModel: async () => groupedModel() });
    await mounted.refresh();
    expect(element.innerHTML.match(/class="map-legend-item map-legend-projection-item"/g)).toHaveLength(6);
    expect(element.innerHTML.match(/class="map-legend-group-title"/g)).toBeNull();
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

  it("uses non-breaking labels, absolute projection placements, and Guttman type", () => {
    const css = readFileSync(new URL("../../frontend/css/styles.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.map-legend\s*\{[^}]*font(?:-family|):\s*"Guttman Hatzvi",\s*"Noto Sans Hebrew",\s*Arial,\s*sans-serif/s);
    expect(css).toMatch(/\.map-legend-label\s*\{[^}]*overflow-wrap:\s*normal[^}]*word-break:\s*keep-all/s);
    expect(css).toMatch(/\.map-legend-projection \.map-legend-content\s*\{[^}]*position:\s*absolute[^}]*padding:\s*0/s);
    expect(css).toMatch(/\.map-legend-projection \.map-legend-item\s*\{[^}]*display:\s*block/s);
    expect(css).toMatch(/\.map-legend-gis \.map-legend-layers\s*\{[^}]*display:\s*flex[^}]*flex-flow:\s*row wrap/s);
    expect(css).toMatch(/\.map-legend-symbol--line\s*\{[^}]*box-shadow:\s*0 0 0 1px color-mix\(\s*in srgb,\s*var\(--legend-halo,\s*transparent\) 35%,\s*transparent\s*\)/s);
    expect(css).toMatch(/\.map-legend-symbol--alarm-shockwave::after\s*\{[^}]*border:\s*1(?:\.6)?px solid color-mix\(\s*in srgb,\s*var\(--legend-alarm-shockwave,\s*transparent\) 40%,\s*transparent\s*\)/s);
    expect(css).toMatch(/\.map-legend-symbol::before\s*\{[^}]*border-radius:\s*inherit/s);
    expect(css).toMatch(/\.map-legend-symbol--point\s*\{[^}]*border-radius:\s*50%/s);
  });

  it("renders all projection content without a page count or paging timer", async () => {
    vi.useFakeTimers();
    const { element, pager } = setupWithDocument();
    element.clientWidth = 240;
    element.clientHeight = 80;
    const mounted = mountMapLegend({
      element,
      surface: "projection",
      buildModel: async () => groupedModel(),
    });
    const interval = vi.spyOn(globalThis, "setInterval");
    await mounted.refresh();
    expect(mounted.getRenderSnapshot().pages).toHaveLength(1);
    expect(pager().innerHTML).toBe("");
    expect(interval).not.toHaveBeenCalled();
    interval.mockRestore();
    mounted.dispose();
    vi.useRealTimers();
  });

  it("keeps Hebrew placement direction independent of the one-page snapshot", async () => {
    const { element } = setupWithDocument();
    element.clientWidth = 240;
    element.clientHeight = 80;
    const mounted = mountMapLegend({
      element,
      surface: "projection",
      dataContext: { getLegendSettings: () => ({ language: "he" }) },
      buildModel: async () => groupedModel(),
    });
    await mounted.refresh();
    expect(element.dir).toBe("rtl");
    expect(mounted.getRenderSnapshot().pages).toHaveLength(1);
    mounted.dispose();
  });

  it("does not schedule projection paging after fitting a one-page snapshot", async () => {
    vi.useFakeTimers();
    const { element, content } = setupWithDocument();
    element.parentElement = { getBoundingClientRect: () => ({ width: 500, height: 571.428571 }) };
    element.clientWidth = 240;
    element.clientHeight = 80;
    const interval = vi.spyOn(globalThis, "setInterval");
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
    expect(interval).not.toHaveBeenCalled();
    interval.mockRestore();
    mounted.dispose();
    vi.useRealTimers();
  });

  it("auto-advances GIS pages on the same dwell as projection", async () => {
    vi.useFakeTimers();
    const { element, content, pager } = setupWithDocument();
    vi.stubGlobal("window", { innerWidth: 300 });
    const interval = vi.spyOn(globalThis, "setInterval");
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
    vi.advanceTimersByTime(4000);
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 4000);
    interval.mockRestore();
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
    element.clientWidth = 240;
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
    element.clientWidth = 240;
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

  it("measures projection labels through the injected canonical metrics callback", async () => {
    const { element } = setupWithDocument();
    const measureText = vi.fn((text) => ({ width: text.length * 7, actualBoundingBoxRight: text.length * 7, actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 4 }));
    const mounted = mountMapLegend({
      element,
      surface: "projection",
      buildModel: async () => model(),
      measureText,
    });
    await mounted.refresh();
    expect(measureText).toHaveBeenCalledWith("A very long label that wraps");
    expect(mounted.getRenderSnapshot().contentLayout.effectiveFontPx).toBeLessThanOrEqual(22);
    mounted.dispose();
  });

  it("omits the pack heading for NLI on GIS and projection", async () => {
    const nliModel = {
      packs: [{
        id: "nli",
        name: "October 7th",
        layers: [{ id: "nli.people", name: "People", items: [{ id: "nli.people:a", label: "Murdered", shape: "point", fill: "#123" }] }],
      }],
    };
    for (const surface of ["gis", "projection"]) {
      const { element } = setup();
      const mounted = mountMapLegend({ element, surface, buildModel: async () => nliModel });
      await mounted.refresh();
      expect(element.innerHTML).toContain("Murdered");
      expect(element.innerHTML).toContain('data-legend-pack-id="nli"');
      expect(element.innerHTML.match(/class="map-legend-group-title"/g)).toBeNull();
      expect(element.innerHTML).not.toContain("map-legend-group-title");
      mounted.dispose();
    }
  });

  it("keeps a six-item projection NLI pack on one page in a short wide rail", async () => {
    const { element, pager } = setupWithDocument();
    element.clientWidth = 800;
    element.clientHeight = 80;
    const items = Array.from({ length: 6 }, (_, index) => ({
      id: `nli:${index}`,
      label: `Class ${index}`,
      shape: "point",
      fill: "#123456",
    }));
    const mounted = mountMapLegend({
      element,
      surface: "projection",
      buildModel: async () => ({
        packs: [{ id: "nli", name: "October 7th", layers: [{ id: "nli.people", name: "People", items }] }],
      }),
    });
    await mounted.refresh();
    expect(pager().hidden).toBe(true);
    expect(element.innerHTML.match(/class="map-legend-group-title"/g)).toBeNull();
    mounted.dispose();
  });

  it("omits pack headings for every pack, including land use on GIS and projection", async () => {
    const mixed = {
      packs: [
        { id: "nli", name: "October 7th", layers: [{ id: "nli.route", name: "Route", items: [{ id: "nli.route:a", label: "232", shape: "line", stroke: "#000" }] }] },
        { id: "land_use", name: "Land use", layers: [{ id: "land_use.open", name: "Open", items: [{ id: "land_use.open:a", label: "Open space", shape: "polygon", fill: "#0f0" }] }] },
      ],
    };
    for (const surface of ["gis", "projection"]) {
      const { element } = setup();
      const mounted = mountMapLegend({ element, surface, buildModel: async () => mixed });
      await mounted.refresh();
      expect(element.innerHTML).toContain("Open space");
      expect(element.innerHTML).toContain("232");
      expect(element.innerHTML.match(/class="map-legend-group-title"/g)).toBeNull();
      expect(element.innerHTML).not.toContain(">Land use<");
      expect(element.innerHTML).not.toContain(">October 7th<");
      mounted.dispose();
    }
  });
});

// Parse the emitted DOM without a browser: inspect coordinates and CSS paint bounds,
// rather than comparing serialized text or merely observing a canvas scale call.
describe("projection legend paint geometry", () => {
  const decode = (value) => value.replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  const parse = (html) => ({
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      return [...html.matchAll(/<(div|span|svg|text)\b([^>]*)>/g)].flatMap((match) => {
        const attrs = Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map((attr) => [attr[1], decode(attr[2])]));
        const matches = selector === "svg text" ? match[1] === "text"
          : selector.startsWith(".") ? (attrs.class || "").split(" ").includes(selector.slice(1))
          : attrs["data-legend-item-id"] === selector.match(/data-legend-item-id="([^"]*)"/)?.[1];
        if (!matches) return [];
        const start = match.index + match[0].length;
        const inner = html.slice(start, html.indexOf(`</${match[1]}>`, start));
        const style = Object.fromEntries((attrs.style || "").split(";").filter(Boolean).map((entry) => {
          const colon = entry.indexOf(":");
          return [entry.startsWith("--") ? entry.slice(0, colon) : entry.slice(0, colon).replace(/-([a-z])/g, (_match, char) => char.toUpperCase()), entry.slice(colon + 1)];
        }));
        style.cssText = attrs.style || "";
        return [{ ...parse(inner), style, textContent: decode(inner), getAttribute: (key) => attrs[key] ?? null }];
      });
    },
  });
  const number = (node, key) => Number.parseFloat(node.style[key]);
  const metrics = (text) => ({ width: [...text].length * 6, actualBoundingBoxLeft: 2, actualBoundingBoxRight: [...text].length * 6 + 3,
    actualBoundingBoxAscent: text.includes("g") ? 7 : 13, actualBoundingBoxDescent: text.includes("g") ? 6 : 1 });
  const fixture = (items) => ({ packs: [{ id: "geometry", layers: [{ id: "geometry.layer", items }] }] });
  const mount = async (items, layout = {}) => {
    const setup = setupWithDocument();
    const legend = mountMapLegend({ element: setup.element, surface: "projection", projectionSpan: "left", measureText: metrics,
      dataContext: { getLegendSettings: () => ({ language: "en", projection: { left: { widthPct: 18, heightPct: 20, fontPx: 24, columns: 1, ...layout } } }) },
      buildModel: async () => fixture(items) });
    await legend.refresh();
    return { ...setup, legend, snapshot: legend.getRenderSnapshot(), dom: parse(setup.content().innerHTML) };
  };

  it("keeps every GIS component in normal flow", async () => {
    const { element } = setup();
    const legend = mountMapLegend({ element, buildModel: async () => model() });
    await legend.refresh();
    const symbols = [...parse(element.innerHTML).querySelectorAll(".map-legend-symbol")];
    expect(symbols).toHaveLength(3);
    expect(symbols.map((node) => node.style.position || "")).toEqual(["", "", ""]);
    expect(symbols.every((node) => !/NaN|undefined/.test(node.style.cssText))).toBe(true);
    legend.dispose();
  });

  it("allows unscaled final items to reach the outer fitted clip", async () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ id: `item-${i}`, label: `Legend item ${i}`, shape: "line", stroke: "#fff" }));
    const { element, content, legend, snapshot, dom } = await mount(items, { widthPct: 9.375, heightPct: 6.667 });
    const plan = snapshot.contentLayout;
    const last = dom.querySelector('[data-legend-item-id="item-39"]');
    expect(plan.scale).toBeLessThan(1);
    expect(number(last, "top")).toBeGreaterThan(number(content(), "height"));
    expect(content().style.overflow).toBe("visible");
    expect(element.style.overflow).toBe("hidden");
    expect((number(last, "top") + number(last, "height")) * plan.scale).toBeLessThanOrEqual(number(content(), "height"));
    expect(plan.paintBounds.y + plan.paintBounds.height).toBeLessThanOrEqual(number(content(), "height"));
    legend.dispose();
  });

  it("paints multiline mixed-script labels at the planner alphabetic baselines", async () => {
    const { legend, snapshot, dom } = await mount([
      { id: "latin", label: "North gggg South Hebrew שלום", shape: "line", stroke: "#fff" },
      { id: "hebrew", label: "דרך gggg South line", shape: "point", fill: "#fff" },
    ], { widthPct: 5, heightPct: 35 });
    const calls = [];
    const context = new Proxy({}, { get: (target, key) => key in target ? target[key] : (...args) => calls.push([key, ...args]) });
    const adapter = createProjectionLegendAdapter({ canvasFactory: () => ({ getContext: () => context }) });
    adapter.sync(snapshot); adapter.draw();
    const painted = calls.filter(([name]) => name === "fillText");
    let offset = 0;
    for (const placement of snapshot.contentLayout.placements) {
      const item = dom.querySelector(`[data-legend-item-id="${placement.itemId}"]`);
      const lines = [...item.querySelectorAll("svg text")];
      expect(item.querySelector(".map-legend-projection-labels").style.overflow).toBe("visible");
      expect(placement.labelLines.length).toBeGreaterThan(1);
      expect(lines).toHaveLength(placement.labelLines.length);
      lines.forEach((line, index) => {
        const x = number(item, "left") + Number(line.getAttribute("x"));
        const y = number(item, "top") + Number(line.getAttribute("y"));
        expect(line.textContent).toBe(placement.labelLines[index]);
        expect(line.getAttribute("dominant-baseline")).toBe("alphabetic");
        expect(line.getAttribute("direction")).toBe(placement.labelDirection);
        expect(line.getAttribute("text-anchor")).toBe("start");
        const physicalAlign = line.getAttribute("direction") === "rtl" ? "right" : "left";
        expect(physicalAlign).toBe(placement.labelGeometry.align);
        expect(line.style.letterSpacing).toBe("0px");
        expect([line.textContent, x, y]).toEqual(painted[offset++].slice(1));
        expect(y).toBe(placement.labelGeometry.y + index * placement.labelGeometry.lineHeight);
      });
    }
    adapter.dispose(); legend.dispose();
  });

  it("matches planner and canvas dimensions for ordinary symbols and a stroked decorated diamond", async () => {
    const parts = [
      { shape: "diamond", fill: "#abc", stroke: "#fff", strokeWidth: 4, alarmShockwave: true, alarmShockwaveColor: "#f00" },
      { shape: "point", fill: "#abc", stroke: "#fff", strokeWidth: 3 },
      { shape: "square", fill: "#abc", stroke: "#fff", strokeWidth: 2 },
      { shape: "polygon", fill: "#abc", stroke: "#fff", strokeWidth: 0.5 },
      { shape: "line", stroke: "#000", carrier: "#f00", strokeWidth: 3, dash: [4, 2] },
    ];
    const { legend, snapshot, dom } = await mount(parts.map((part, i) => ({ id: `shape-${i}`, label: "A", ...part })), { widthPct: 40, heightPct: 40 });
    const calls = [];
    const context = new Proxy({}, { get: (target, key) => key in target ? target[key] : (...args) => calls.push([key, ...args]) });
    const adapter = createProjectionLegendAdapter({ canvasFactory: () => ({ getContext: () => context }) });
    adapter.sync(snapshot); adapter.draw();
    snapshot.contentLayout.placements.forEach((placement, index) => {
      const component = placement.symbolGeometry.components[0];
      const item = dom.querySelector(`[data-legend-item-id="${placement.itemId}"]`);
      const symbol = item.querySelector(".map-legend-symbol");
      const diamond = parts[index].shape === "diamond";
      const outerWidth = number(symbol, "width") * (diamond ? Math.SQRT2 : 1);
      const outerHeight = number(symbol, "height") * (diamond ? Math.SQRT2 : 1);
      const stroke = parts[index].strokeWidth;
      expect(outerWidth).toBeCloseTo(component.width + (diamond ? Math.SQRT2 * stroke : parts[index].shape === "line" ? 0 : stroke));
      expect(outerHeight).toBeCloseTo(component.height + (diamond ? Math.SQRT2 * stroke : parts[index].shape === "line" ? 2 : stroke));
      expect(number(item, "left") + number(symbol, "left") + number(symbol, "width") / 2).toBeCloseTo(component.x);
      expect(number(item, "top") + number(symbol, "top") + number(symbol, "height") / 2).toBeCloseTo(component.y);
      if (diamond) {
        expect(symbol.style.borderRadius).toBe("0px");
        const ring = item.querySelector(".map-legend-projection-shockwave");
        expect(ring).not.toBeNull();
        const radius = Math.max(component.width, component.height) / 2 + snapshot.layout.fontPx * 0.28;
        expect(number(ring, "width")).toBeCloseTo(2 * radius + 1.6);
        expect(number(ring, "height")).toBeCloseTo(2 * radius + 1.6);
        expect(calls.some(([name, x, y, r]) => name === "arc" && x === component.x && y === component.y && r === radius)).toBe(true);
        expect(outerWidth / 2).toBeLessThanOrEqual(component.width / 2 + component.extentX);
        expect(number(ring, "width") / 2).toBeCloseTo(component.width / 2 + component.extentX);
        expect(calls).toContainEqual(["moveTo", component.x, component.y - component.height / 2]);
        expect(calls).toContainEqual(["lineTo", component.x + component.width / 2, component.y]);
      } else if (parts[index].shape === "point") {
        expect(calls).toContainEqual(["arc", component.x, component.y, component.width / 2, 0, Math.PI * 2]);
      } else if (parts[index].shape === "line") {
        const overlay = item.querySelector(".map-legend-projection-line-stroke");
        expect(overlay).not.toBeNull();
        expect(number(overlay, "height")).toBe(component.height);
        expect(number(overlay, "top") + number(overlay, "height") / 2).toBeCloseTo(number(symbol, "height") / 2);
        expect(symbol.style["--legend-fill"]).toBe(parts[index].carrier);
      } else {
        expect(calls).toContainEqual(["rect", component.x - component.width / 2, component.y - component.height / 2, component.width, component.height]);
      }
    });
    adapter.dispose(); legend.dispose();
  });
  it("uses the GIS full-height segmented carrier on projection without a thicker carrier overlay", async () => {
    const { legend, snapshot, dom } = await mount([{ id: "confirmed", label: "A", shape: "line", stroke: "#000000", carrier: "#c31f4f", halo: "#ffffff", strokeWidth: 0.6, dash: [10.8, 13.2], segmentedCarrier: true, gisLineSwatch: true }], { fontPx: 22 * 0.68 });
    const item = dom.querySelector('[data-legend-item-id="confirmed"]');
    const symbol = item.querySelector(".map-legend-symbol");
    expect(number(symbol, "height")).toBe(2);
    expect(number(symbol, "width")).toBeCloseTo(22 * 1.23);
    expect(item.querySelector(".map-legend-projection-line-stroke")).toBeNull();
    expect(symbol.style["--legend-fill"]).toContain("#000000 5px");
    expect(symbol.style["--legend-fill"]).toContain("linear-gradient(#c31f4f, #c31f4f)");
    expect(symbol.style["--legend-halo"]).toBe("#ffffff");
    expect(snapshot.contentLayout.placements[0].symbolGeometry.components[0].extentY).toBeGreaterThanOrEqual(1);
    legend.dispose();
  });

  it.each([
    ["default", undefined, 3],
    ["fractional", 0.5, 2.5],
  ])("matches the canvas carrier and overlay widths for a %s narrow stroke", async (_name, strokeWidth, carrierHeight) => {
    const { legend, snapshot, dom } = await mount([{ id: "narrow", label: "A", shape: "line", stroke: "#000", carrier: "#f00", strokeWidth, dash: [4, 2] }]);
    const strokes = [];
    const context = new Proxy({}, { get: (target, key) => {
      if (key === "stroke") return () => strokes.push(target.lineWidth);
      return key in target ? target[key] : () => {};
    } });
    const adapter = createProjectionLegendAdapter({ canvasFactory: () => ({ getContext: () => context }) });
    adapter.sync(snapshot); adapter.draw();
    expect(strokes).toEqual([carrierHeight, 2]);
    const placement = snapshot.contentLayout.placements[0];
    const component = placement.symbolGeometry.components[0];
    const item = dom.querySelector('[data-legend-item-id="narrow"]');
    const symbol = item.querySelector(".map-legend-symbol");
    const overlay = item.querySelector(".map-legend-projection-line-stroke");
    expect(number(symbol, "height")).toBe(strokes[0]);
    expect(number(overlay, "height")).toBe(strokes[1]);
    expect(number(overlay, "top") + number(overlay, "height") / 2).toBe(number(symbol, "height") / 2);
    expect(number(item, "top") + number(symbol, "top") + number(symbol, "height") / 2).toBe(component.y);
    expect(strokes[0] / 2).toBeLessThanOrEqual(component.height / 2 + component.extentY);
    adapter.dispose(); legend.dispose();
  });
});
