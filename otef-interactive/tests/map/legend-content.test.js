import { describe, expect, it } from "vitest";
import {
  buildLegendModel,
  legendLayerFromConfig,
} from "../../frontend/src/map/legend-model-builder.js";
import {
  LEGEND_CATEGORY_COPY,
  LEGEND_POLICY,
  getLegendCategoryCopy,
  getPackDisplayLabel,
} from "../../frontend/src/shared/legend-copy.js";

function pointSymbol(fillColor) {
  return {
    symbolLayers: [
      { type: "markerPoint", marker: { fillColor, size: 12 } },
    ],
  };
}

function registryFor({ config, groups = [] }) {
  return {
    _initialized: true,
    async init() {},
    getGroups: () => groups,
    getLayerConfig: () => config,
    getPackStyleJsonForLayer: () => config.style,
  };
}

describe("legend content model", () => {
  it("uses bilingual NLI copy before legacy English legendLabel strings", async () => {
    const layers = [
      { id: "ציר_232", enabled: true },
      { id: "lines", enabled: true },
      { id: "investigation_polygons", enabled: true },
    ];
    const lineStyle = {
      renderer: "simple",
      defaultSymbol: {
        symbolLayers: [{ type: "stroke", color: "#123456", width: 2 }],
      },
    };
    const investigationStyle = {
      renderer: "uniqueValue",
      uniqueValues: {
        field: "Notes",
        classes: [
          { value: "מרחב לחימה - קרב", symbol: { symbolLayers: [{ type: "fill", color: "#111111" }] } },
          { value: "שריפה", symbol: { symbolLayers: [{ type: "fill", color: "#222222" }] } },
          { value: "מוקד חטיפה", symbol: { symbolLayers: [{ type: "fill", color: "#333333" }] } },
        ],
      },
    };
    const configs = new Map([
      ["nli.ציר_232", {
        id: "ציר_232",
        name: "ציר_232",
        geometryType: "line",
        ui: { legendLabel: "Highway 232" },
        style: lineStyle,
      }],
      ["nli.lines", {
        id: "lines",
        name: "lines",
        geometryType: "line",
        ui: { legendLabel: "Infiltration routes" },
        style: lineStyle,
      }],
      ["nli.investigation_polygons", {
        id: "investigation_polygons",
        name: "investigation_polygons",
        geometryType: "polygon",
        ui: { legendLabel: "Investigation polygons" },
        style: investigationStyle,
      }],
    ]);
    const groups = [{ id: "nli", layers }];
    const registry = {
      _initialized: true,
      getGroups: () => groups,
      getLayerConfig: (id) => configs.get(id),
      getPackStyleJsonForLayer: (id) => configs.get(id)?.style,
    };
    const dataContext = { getLayerGroups: () => groups };

    const [he, en] = await Promise.all([
      buildLegendModel({ dataContext, registry, language: "he" }),
      buildLegendModel({ dataContext, registry, language: "en" }),
    ]);

    expect(he.packs[0].layers.map((layer) => layer.name)).toEqual([
      "כביש 232",
      "צירי חדירה",
      "פוליגונים מתחקירים",
    ]);
    expect(he.packs[0].layers[2].items.map((item) => item.label)).toEqual([
      "מוקד קרב/טבח",
      "מוקד שריפה",
      "מוקד חטיפה",
    ]);
    expect(en.packs[0].layers.map((layer) => layer.name)).toEqual([
      "Highway 232",
      "Infiltration routes",
      "Investigation polygons",
    ]);
  });

  it("uses inline bilingual NLI labels before glossary copy", () => {
    const layer = legendLayerFromConfig({
      id: "lines",
      name: "lines",
      geometryType: "line",
      ui: { legendLabel: "Infiltration routes" },
      legend: { label: { he: "צירים מותאמים", en: "Custom routes" } },
      style: {
        renderer: "simple",
        defaultSymbol: {
          symbolLayers: [{ type: "stroke", color: "#123456", width: 2 }],
        },
      },
    }, { id: "lines" }, { fullId: "nli.lines", language: "he" });

    expect(layer.name).toBe("צירים מותאמים");
  });

  it("draws infiltration routes as a static red carrier with the dash-walk overlay", () => {
    const layer = legendLayerFromConfig({
      id: "lines",
      name: "lines",
      geometryType: "line",
      style: {
        renderer: "simple",
        defaultSymbol: {
          symbolLayers: [{ type: "stroke", color: "#c31f4f", width: 2, opacity: 1 }],
        },
      },
    }, { id: "lines" }, { fullId: "nli.lines", language: "he", surface: "gis" });

    expect(layer.items).toHaveLength(1);
    expect(layer.items[0].carrier).toBe("#c31f4f");
    expect(layer.items[0].stroke).toBe("#000000");
    expect(layer.items[0].halo).toBe("#ffffff");
    expect(layer.items[0].dash.array).toEqual([24 * 0.45, 24 * 0.55]);

    const projection = legendLayerFromConfig({
      id: "lines",
      name: "lines",
      geometryType: "line",
      style: {
        renderer: "simple",
        defaultSymbol: {
          symbolLayers: [{ type: "stroke", color: "#c31f4f", width: 2, opacity: 1 }],
        },
      },
    }, { id: "lines" }, { fullId: "nli.lines", language: "he", surface: "projection" });
    expect(projection.items[0].halo).toBe("#ffffff");
  });

  it("draws alarms as a yellow marker with a static shockwave ring", () => {
    const config = {
      id: "alarms",
      name: "alarms",
      geometryType: "point",
      style: {
        renderer: "simple",
        defaultSymbol: {
          symbolLayers: [{
            type: "markerPoint",
            marker: { shape: "circle", fillColor: "#fbbf24", size: 8, strokeColor: "#ffffff" },
          }],
        },
      },
    };
    const layer = legendLayerFromConfig(config, { id: "alarms" }, {
      fullId: "nli.alarms",
      language: "he",
      surface: "gis",
    });
    expect(layer.items[0]).toMatchObject({
      fill: "#f5c542",
      fillOpacity: 0.3,
      stroke: "transparent",
      alarmShockwave: true,
      alarmShockwaveColor: "#f5c542",
    });

    const projection = legendLayerFromConfig(config, { id: "alarms" }, {
      fullId: "nli.alarms",
      language: "he",
      surface: "projection",
    });
    expect(projection.items[0].alarmShockwave).toBe(true);
    expect(projection.items[0].fillOpacity).toBe(0.3);

    const other = legendLayerFromConfig({
      ...config,
      id: "sites",
    }, { id: "sites" }, { fullId: "fixture.sites", language: "he", surface: "gis" });
    expect(other.items[0].alarmShockwave).toBeUndefined();
  });

  it("builds the real NLI pack path in both languages with stable category ids", async () => {
    const rawStyle = {
      renderer: "uniqueValue",
      uniqueValues: {
        field: "Notes",
        classes: [
          { value: "מרחב לחימה - קרב", symbol: { symbolLayers: [{ type: "fill", color: "#111111" }] } },
          { value: "שריפה", symbol: { symbolLayers: [{ type: "fill", color: "#222222" }] } },
          { value: "מוקד חטיפה", symbol: { symbolLayers: [{ type: "fill", color: "#333333" }] } },
        ],
      },
    };
    const groups = [{ id: "nli", layers: [{ id: "investigation_polygons", enabled: true }] }];
    const registry = {
      _initialized: true,
      getGroups: () => groups,
      getLayerConfig: () => ({ id: "investigation_polygons", name: "investigation_polygons", geometryType: "polygon", style: rawStyle }),
      getPackStyleJsonForLayer: () => rawStyle,
    };
    const dataContext = { getLayerGroups: () => groups };
    const [he, en] = await Promise.all([
      buildLegendModel({ dataContext, registry, language: "he" }),
      buildLegendModel({ dataContext, registry, language: "en" }),
    ]);
    expect(he.packs[0].name).toBe("7 באוקטובר");
    expect(en.packs[0].name).toBe("October 7th");
    expect(getPackDisplayLabel("nli", "he")).toBe("ספרייה לאומית");
    expect(getPackDisplayLabel("nli", "en")).toBe("National Library");
    expect(he.packs[0].layers[0].items.map((item) => item.id)).toEqual([
      "nli.investigation_polygons:מרחב לחימה - קרב",
      "nli.investigation_polygons:שריפה",
      "nli.investigation_polygons:מוקד חטיפה",
    ]);
    expect(en.packs[0].layers[0].items.map((item) => item.id)).toEqual(he.packs[0].layers[0].items.map((item) => item.id));
    expect(en.packs[0].layers[0].items.map((item) => item.label)).toEqual([
      "Battle or massacre site",
      "Fire site",
      "Kidnapping site",
    ]);
  });

  it("keeps line and marker symbol parts in one category item", () => {
    const layer = legendLayerFromConfig({
      id: "roads",
      name: "Roads",
      geometryType: "line",
      style: {
        renderer: "uniqueValue",
        uniqueValues: {
          field: "kind",
          classes: [{
            value: "main",
            label: "Main",
            symbol: {
              symbolLayers: [
                { type: "stroke", color: "#111111", width: 4 },
                { type: "markerLine", marker: { shape: "square", fillColor: "#222222" } },
              ],
            },
          }],
        },
      },
    }, { id: "roads" }, { fullId: "fixture.roads", language: "en" });
    expect(layer.items).toHaveLength(1);
    expect(layer.items[0].id).toBe("fixture.roads:main");
    expect(layer.items[0].components).toHaveLength(2);
    expect(layer.items[0].components.map((part) => part.shape)).toEqual(["line", "square"]);
  });

  it("applies the shared surface presentation rules to legend symbols", () => {
    const config = {
      id: "Gaza_Roads",
      name: "Gaza roads",
      geometryType: "line",
      style: {
        renderer: "simple",
        defaultSymbol: {
          symbolLayers: [{ type: "stroke", color: "#123456", width: 10, opacity: 0.8 }],
        },
      },
    };
    const gis = legendLayerFromConfig(config, { id: "Gaza_Roads" }, {
      fullId: "gaza.Gaza_Roads",
      language: "en",
      surface: "gis",
    });
    const projection = legendLayerFromConfig(config, { id: "Gaza_Roads" }, {
      fullId: "gaza.Gaza_Roads",
      language: "en",
      surface: "projection",
    });
    expect(gis.items[0].strokeWidth).toBe(10);
    expect(gis.items[0].strokeOpacity).toBeCloseTo(0.8 * 0.45);
    expect(projection.items[0].strokeWidth).toBeCloseTo(10 * 0.3);
    expect(projection.items[0].strokeOpacity).toBe(0.8);
  });

  it("preserves solid fill opacity and every distinct stroke", () => {
    const layer = legendLayerFromConfig({
      id: "surface",
      name: "Surface",
      geometryType: "polygon",
      style: {
        renderer: "simple",
        defaultSymbol: {
          symbolLayers: [
            { type: "fill", fillType: "solid", color: "#abcdef", opacity: 0.35 },
            { type: "stroke", color: "#111111", width: 6, opacity: 0.7, dash: { array: [2, 1] } },
            { type: "stroke", color: "#111111", width: 2, opacity: 0.9, dash: { array: [5, 3] } },
          ],
        },
      },
    }, { id: "surface" }, { fullId: "fixture.surface", language: "en", surface: "gis" });
    expect(layer.items[0].fillOpacity).toBe(0.35);
    expect(layer.items[0].strokeSwatches).toHaveLength(2);
    expect(layer.items[0].strokeSwatches.map((stroke) => stroke.width)).toEqual([6, 2]);
    expect(layer.items[0].strokeSwatches.map((stroke) => stroke.dash.array)).toEqual([[2, 1], [5, 3]]);
  });

  it("uses the checked-in Gaza policy for name and explicit summary", () => {
    const layer = legendLayerFromConfig({
      id: "Gaza_Roads",
      name: "Gaza_Roads",
      geometryType: "line",
      style: {
        renderer: "uniqueValue",
        uniqueValues: {
          field: "class",
          classes: [
            { value: "Main Road", symbol: { symbolLayers: [{ type: "stroke", color: "#111111" }] } },
            { value: "Local Road", symbol: { symbolLayers: [{ type: "stroke", color: "#222222" }] } },
          ],
        },
      },
    }, { id: "Gaza_Roads" }, { fullId: "gaza.Gaza_Roads", language: "en", surface: "gis" });
    expect(LEGEND_POLICY["gaza.Gaza_Roads"].summary.label.en).toBe("Gaza roads");
    expect(layer.name).toBe("Gaza roads");
    expect(layer.items).toHaveLength(1);
    expect(layer.items[0].label).toBe("Gaza roads");
    expect(layer.items[0].components.map((component) => component.stroke)).toEqual([
      "#111111",
      "#222222",
    ]);
  });

  it("uses the checked-in streams policy for one bilingual summary item", () => {
    const config = {
      id: "נחלים",
      name: "נחלים",
      geometryType: "line",
      style: {
        renderer: "uniqueValue",
        uniqueValues: {
          field: "class",
          classes: [
            { value: "<Null>", symbol: { symbolLayers: [{ type: "stroke", color: "#063970", width: 4, opacity: 1 }] } },
            { value: "משני", symbol: { symbolLayers: [{ type: "stroke", color: "#063970", width: 2, opacity: 1 }] } },
            { value: "ראשי", symbol: { symbolLayers: [{ type: "stroke", color: "#063970", width: 4, opacity: 1 }] } },
            { value: " ", symbol: { symbolLayers: [{ type: "stroke", color: "#063970", width: 8, opacity: 0 }] } },
          ],
        },
      },
    };
    const he = legendLayerFromConfig(config, { id: "נחלים" }, {
      fullId: "greens.נחלים",
      language: "he",
      surface: "gis",
    });
    const en = legendLayerFromConfig(config, { id: "נחלים" }, {
      fullId: "greens.נחלים",
      language: "en",
      surface: "gis",
    });

    expect(he.items).toHaveLength(1);
    expect(he.items[0].label).toBe("נחלים");
    expect(he.items[0].components).toHaveLength(1);
    expect(he.items[0].components[0]).toMatchObject({
      stroke: "#063970",
      strokeWidth: 4,
    });
    expect(he.items[0].components[0].strokeOpacity).toBeGreaterThan(0);
    expect(en.items).toHaveLength(1);
    expect(en.items[0].label).toBe("Streams");
  });

  it("sorts the NLI pack first without changing other pack order", async () => {
    const groups = ["greens", "gaza", "nli"].map((id) => ({
      id,
      layers: [{ id: "layer", enabled: true }],
    }));
    const style = {
      renderer: "simple",
      defaultSymbol: {
        symbolLayers: [{ type: "stroke", color: "#123456", width: 2 }],
      },
    };
    const model = await buildLegendModel({
      surface: "projection",
      language: "en",
      dataContext: { getLayerGroups: () => groups },
      registry: {
        _initialized: true,
        getGroups: () => groups,
        getLayerConfig: (fullId) => ({
          id: "layer",
          name: fullId,
          geometryType: "line",
          style,
        }),
        getPackStyleJsonForLayer: () => style,
      },
    });

    expect(model.packs.map((pack) => pack.id)).toEqual(["nli", "greens", "gaza"]);
  });

  it("orders layers inside a pack by marker type then keeps same-type order", async () => {
    const layers = [
      { id: "areas", enabled: true },
      { id: "routes", enabled: true },
      { id: "sites", enabled: true },
      { id: "roads", enabled: true },
    ];
    const groups = [{ id: "fixture", layers }];
    const configs = new Map([
      ["fixture.areas", {
        id: "areas",
        name: "Areas",
        geometryType: "polygon",
        style: { renderer: "simple", defaultSymbol: { symbolLayers: [{ type: "fill", color: "#111111" }] } },
      }],
      ["fixture.routes", {
        id: "routes",
        name: "Routes",
        geometryType: "line",
        style: { renderer: "simple", defaultSymbol: { symbolLayers: [{ type: "stroke", color: "#222222", width: 2 }] } },
      }],
      ["fixture.sites", {
        id: "sites",
        name: "Sites",
        geometryType: "point",
        style: { renderer: "simple", defaultSymbol: pointSymbol("#333333") },
      }],
      ["fixture.roads", {
        id: "roads",
        name: "Roads",
        geometryType: "line",
        style: { renderer: "simple", defaultSymbol: { symbolLayers: [{ type: "stroke", color: "#444444", width: 2 }] } },
      }],
    ]);
    const model = await buildLegendModel({
      surface: "gis",
      language: "en",
      dataContext: { getLayerGroups: () => groups },
      registry: {
        _initialized: true,
        getGroups: () => groups,
        getLayerConfig: (id) => configs.get(id),
        getPackStyleJsonForLayer: (id) => configs.get(id)?.style,
      },
    });

    expect(model.packs[0].layers.map((layer) => layer.name)).toEqual([
      "Sites",
      "Routes",
      "Roads",
      "Areas",
    ]);
  });

  it("covers every checked-in current categorized inventory value in both locales", () => {
    const inventory = [
      ["gaza.Gaza_Roads", ["Internal Road", "Local Road", "Main Road", "Regional Road"]],
      ["greens.נחלים", ["<Null>", "משני", "ראשי"]],
      ["nli.people", ["Murdered", "Killed on duty", "Kidnap survivor", "Murdered in captivity"]],
      ["nli.investigation_polygons", ["מרחב לחימה - קרב", "שריפה", "מוקד חטיפה"]],
    ];
    for (const [fullId, values] of inventory) {
      for (const value of values) {
        expect(getLegendCategoryCopy(fullId, value, "he"), `${fullId}:${value}:he`).toBeTruthy();
        expect(getLegendCategoryCopy(fullId, value, "en"), `${fullId}:${value}:en`).toBeTruthy();
      }
    }
    expect(getLegendCategoryCopy("nli.people", "Kidnap survivor", "he")).toBe("שורדי שבי");
    expect(getLegendCategoryCopy("nli.people", "Murdered in captivity", "he")).toBe("נרצחו בשבי");
    expect(Object.keys(LEGEND_CATEGORY_COPY)).toEqual(expect.arrayContaining(inventory.map(([id]) => id)));
    for (const [fullId, rows] of Object.entries(LEGEND_CATEGORY_COPY)) {
      for (const value of Object.keys(rows)) {
        expect(getLegendCategoryCopy(fullId, value, "he"), `${fullId}:${value}:he`).toBeTruthy();
        expect(getLegendCategoryCopy(fullId, value, "en"), `${fullId}:${value}:en`).toBeTruthy();
      }
    }
  });
  it("builds stable ids and labels from unknown simple and categorized layers", () => {
    const simple = legendLayerFromConfig(
      {
        id: "unknown_simple",
        name: "Unknown simple",
        geometryType: "point",
        style: { renderer: "simple", defaultSymbol: pointSymbol("#123456") },
      },
      { id: "unknown_simple" },
      { fullId: "fixture.unknown_simple", language: "en" },
    );
    expect(simple.id).toBe("fixture.unknown_simple");
    expect(simple.name).toBe("Unknown simple");
    expect(simple.items[0].id).toBe("fixture.unknown_simple");

    const categorized = legendLayerFromConfig(
      {
        id: "unknown_categorized",
        name: "Unknown categorized",
        geometryType: "point",
        style: {
          renderer: "uniqueValue",
          uniqueValues: {
            field: "kind",
            classes: [
              { value: "a", label: "Category A", symbol: pointSymbol("#111111") },
              { value: "b", label: "Category B", symbol: pointSymbol("#222222") },
            ],
          },
        },
      },
      { id: "unknown_categorized" },
      { fullId: "fixture.unknown_categorized", language: "en" },
    );
    expect(categorized.items.map((item) => item.id)).toEqual([
      "fixture.unknown_categorized:a",
      "fixture.unknown_categorized:b",
    ]);
    expect(categorized.items.map((item) => item.label)).toEqual([
      "Category A",
      "Category B",
    ]);
  });

  it("resolves inline translations before authored and glossary fallbacks", () => {
    const layer = legendLayerFromConfig(
      {
        id: "roads",
        name: "Roads authored",
        geometryType: "line",
        legend: { label: { he: "דרכים", en: "Roads inline" } },
        style: {
          renderer: "uniqueValue",
          uniqueValues: {
            field: "kind",
            classes: [
              {
                value: "main",
                label: "Main authored",
                legend: { label: { he: "ראשי", en: "Main inline" } },
                symbol: { symbolLayers: [{ type: "stroke", color: "#123456" }] },
              },
            ],
          },
        },
      },
      { id: "roads" },
      { fullId: "fixture.roads", language: "en" },
    );
    expect(layer.name).toBe("Roads inline");
    expect(layer.items[0].label).toBe("Main inline");
  });

  it("uses authored labels for missing copy and honors hide metadata", () => {
    const hidden = legendLayerFromConfig(
      { id: "hidden", name: "Hidden", legend: { hidden: true }, style: { renderer: "simple", defaultStyle: { fillColor: "#111111" } } },
      { id: "hidden" },
      { fullId: "fixture.hidden", language: "en" },
    );
    expect(hidden).toBeNull();

    const authored = legendLayerFromConfig(
      { id: "authored", name: "Authored fallback", geometryType: "point", style: { renderer: "uniqueValue", uniqueValues: { field: "kind", classes: [{ value: "x", symbol: pointSymbol("#333333") }] } } },
      { id: "authored" },
      { fullId: "fixture.authored", language: "en" },
    );
    expect(authored.name).toBe("Authored fallback");
    expect(authored.items[0].label).toBe("x");
  });

  it("allows an authored layer summary and preserves every distinct effective symbol", () => {
    const config = {
      id: "roads",
      name: "Roads",
      geometryType: "line",
      legend: { summary: { label: { he: "דרכים", en: "Gaza roads" } } },
      style: {
        renderer: "uniqueValue",
        uniqueValues: {
          field: "kind",
          classes: [
            { value: "main", label: "Main", symbol: { symbolLayers: [{ type: "stroke", color: "#111111" }] } },
            { value: "local", label: "Local", symbol: { symbolLayers: [{ type: "stroke", color: "#222222" }] } },
            { value: "duplicate", label: "Duplicate", symbol: { symbolLayers: [{ type: "stroke", color: "#111111" }] } },
          ],
        },
      },
    };
    const layer = legendLayerFromConfig(config, { id: "roads" }, {
      fullId: "gaza.roads",
      language: "en",
      summaryRequested: true,
    });
    expect(layer.name).toBe("Gaza roads");
    expect(layer.items).toHaveLength(1);
    expect(layer.items[0].components.map((component) => component.stroke)).toEqual([
      "#111111",
      "#222222",
    ]);
  });

  it("flattens composite categories into distinct renderable summary parts", () => {
    const layer = legendLayerFromConfig({
      id: "composite_roads",
      name: "Composite roads",
      geometryType: "line",
      legend: { summary: { label: { en: "Composite roads" } } },
      style: {
        renderer: "uniqueValue",
        uniqueValues: {
          field: "kind",
          classes: [
            {
              value: "main",
              symbol: {
                symbolLayers: [
                  { type: "stroke", color: "#111111", width: 4 },
                  { type: "stroke", color: "#222222", width: 2 },
                  { type: "markerLine", marker: { shape: "square", fillColor: "#333333" } },
                ],
              },
            },
            {
              value: "duplicate",
              symbol: {
                symbolLayers: [
                  { type: "stroke", color: "#111111", width: 4 },
                  { type: "markerLine", marker: { shape: "square", fillColor: "#333333" } },
                ],
              },
            },
          ],
        },
      },
    }, { id: "composite_roads" }, {
      fullId: "fixture.composite_roads",
      language: "en",
    });

    expect(layer.items).toHaveLength(1);
    expect(layer.items[0].label).toBe("Composite roads");
    expect(layer.items[0].components).toHaveLength(3);
    expect(layer.items[0].components.map((part) => ({
      shape: part.shape,
      stroke: part.stroke,
      fill: part.fill,
    }))).toEqual([
      { shape: "line", stroke: "#111111", fill: undefined },
      { shape: "line", stroke: "#222222", fill: undefined },
      { shape: "square", stroke: "#333333", fill: "#333333" },
    ]);
    expect(layer.items[0].components.every(
      (part) => part.components == null && part.strokeSwatches == null,
    )).toBe(true);
  });

  it("selects group summaries only for authored eligible groups", async () => {
    const config = {
      id: "roads",
      name: "Roads",
      geometryType: "line",
      legend: { summary: { label: { he: "דרכים", en: "Roads" } } },
      style: { renderer: "uniqueValue", uniqueValues: { field: "kind", classes: [{ value: "a", symbol: { symbolLayers: [{ type: "stroke", color: "#111111" }] } }] } },
    };
    const model = await buildLegendModel({
      surface: "gis",
      language: "en",
      summarizedGroupIds: ["fixture"],
      dataContext: { getLayerGroups: () => [{ id: "fixture", layers: [{ id: "roads", enabled: true }] }] },
      registry: registryFor({ config, groups: [{ id: "fixture", name: "Fixture", layers: [{ id: "roads" }] }] }),
    });
    expect(model.packs[0].layers[0].name).toBe("Roads");
    expect(model.packs[0].layers[0].items).toHaveLength(1);
  });

  it("does not turn NLI summary metadata into a collapsed row", () => {
    const layer = legendLayerFromConfig(
      {
        id: "investigation_polygons",
        name: "Investigations",
        geometryType: "polygon",
        legend: { summary: { label: { he: "תחקירים", en: "Investigations" } } },
        style: { renderer: "uniqueValue", uniqueValues: { field: "kind", classes: [{ value: "a", label: "A", symbol: { symbolLayers: [{ type: "fill", color: "#111111" }] } }, { value: "b", label: "B", symbol: { symbolLayers: [{ type: "fill", color: "#222222" }] } }] } },
      },
      { id: "investigation_polygons" },
      { fullId: "nli.investigation_polygons", language: "en", summaryRequested: true, rawStyle: null },
    );
    expect(layer.items.length).toBeGreaterThan(1);
  });

  it("omits absent and unsupported raw styles without fabricating gray entries", async () => {
    const groups = [{
      id: "fixture",
      layers: [
        { id: "missing", enabled: true },
        { id: "land", enabled: true },
      ],
    }];
    const configs = new Map([
      ["fixture.missing", { id: "missing", name: "Missing", geometryType: "polygon", style: { renderer: "simple" } }],
      ["fixture.land", { id: "land", name: "Land", geometryType: "polygon", style: { renderer: "landUse" } }],
    ]);
    const model = await buildLegendModel({
      dataContext: { getLayerGroups: () => groups },
      registry: {
        _initialized: true,
        getGroups: () => [{ id: "fixture", name: "Fixture", layers: groups[0].layers }],
        getLayerConfig: (id) => configs.get(id),
        getPackStyleJsonForLayer: (id) => id === "fixture.missing" ? null : configs.get(id).style,
      },
    });
    expect(model.packs).toEqual([]);
  });

  it("merges only explicit geometry families and the narrow suffix compatibility rule", async () => {
    const layers = [
      { id: "roads-area", name: "Roads-area", enabled: true },
      { id: "roads-point", name: "Roads-point", enabled: true },
      { id: "same-label-a", name: "Same label", enabled: true },
      { id: "same-label-b", name: "Same label", enabled: true },
    ];
    const style = (fill) => ({ renderer: "simple", defaultSymbol: pointSymbol(fill) });
    const configs = new Map([
      ["fixture.roads-area", { name: "כבישים-אזור", geometryType: "polygon", legend: { familyId: "roads" }, style: style("#111111") }],
      ["fixture.roads-point", { name: "כבישים-נקודה", geometryType: "point", legend: { familyId: "roads" }, style: style("#222222") }],
      ["fixture.same-label-a", { name: "Same label", geometryType: "point", style: style("#333333") }],
      ["fixture.same-label-b", { name: "Same label", geometryType: "point", style: style("#444444") }],
    ]);
    const model = await buildLegendModel({
      language: "en",
      dataContext: { getLayerGroups: () => [{ id: "fixture", layers }] },
      registry: {
        _initialized: true,
        getGroups: () => [{ id: "fixture", name: "Fixture", layers }],
        getLayerConfig: (id) => configs.get(id),
        getPackStyleJsonForLayer: (id) => configs.get(id)?.style,
      },
    });
    const outputLayers = model.packs[0].layers;
    expect(outputLayers.filter((layer) => layer.isComposite)).toHaveLength(1);
    expect(outputLayers).toHaveLength(3);
    expect(outputLayers.find((layer) => layer.isComposite).items).toHaveLength(2);
    expect(outputLayers.map((layer) => (layer.isComposite ? "family" : "point"))).toEqual([
      "point",
      "point",
      "family",
    ]);
  });

  it("keeps category labels when a family member has multiple categories", async () => {
    const layers = [
      { id: "roads-area", enabled: true },
      { id: "roads-point", enabled: true },
    ];
    const configs = new Map([
      ["fixture.roads-area", {
        name: "Roads area", geometryType: "polygon", legend: { familyId: "roads" },
        style: { renderer: "uniqueValue", uniqueValues: { field: "kind", classes: [
          { value: "a", label: "Area A", symbol: { symbolLayers: [{ type: "fill", color: "#111111" }] } },
          { value: "b", label: "Area B", symbol: { symbolLayers: [{ type: "fill", color: "#222222" }] } },
        ] } },
      }],
      ["fixture.roads-point", {
        name: "Roads point", geometryType: "point", legend: { familyId: "roads" },
        style: { renderer: "simple", defaultSymbol: pointSymbol("#333333") },
      }],
    ]);
    const model = await buildLegendModel({
      language: "en",
      dataContext: { getLayerGroups: () => [{ id: "fixture", layers }] },
      registry: {
        _initialized: true,
        getGroups: () => [{ id: "fixture", name: "Fixture", layers }],
        getLayerConfig: (id) => configs.get(id),
        getPackStyleJsonForLayer: (id) => configs.get(id)?.style,
      },
    });
    const family = model.packs[0].layers[0];
    expect(family.isComposite).toBe(false);
    expect(family.items.map((item) => item.label)).toEqual(["Area A", "Area B", "Roads point"]);
  });
});
