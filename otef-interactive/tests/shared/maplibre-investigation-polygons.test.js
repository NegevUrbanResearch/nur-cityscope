import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createInvestigationPolygonRenderer } from "../../frontend/src/shared/maplibre-investigation-polygons.js";
import { NLI_DISPLAY_PROFILES } from "../../frontend/src/shared/nli-investigation-theme.js";
import { buildInvestigationSettlementIndexes } from "../../frontend/src/shared/nli-investigation-timeline-data.js";


const SETTLEMENTS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../public/processed/layers/nli/investigation_settlements.geojson",
);

function makeMap() {
  const layers = [
    { id: "nli__investigation_polygons__fill__0", type: "fill", source: "nli__investigation_polygons", layout: { visibility: "visible" } },
    { id: "nli__investigation_polygons__line__1", type: "line", source: "nli__investigation_polygons", layout: { visibility: "visible" } },
  ];
  const sources = new Map();
  const paints = new Map();
  return {
    layers,
    sources,
    paints,
    getStyle: vi.fn(() => ({ layers })),
    getSource: vi.fn((id) => sources.get(id) || null),
    getLayer: vi.fn((id) => layers.find((layer) => layer.id === id) || null),
    addSource: vi.fn((id, spec) => {
      if (sources.has(id)) throw new Error(`duplicate source ${id}`);
      sources.set(id, { ...spec, setData: vi.fn() });
    }),
    addLayer: vi.fn((layer, beforeId) => {
      if (layers.some((entry) => entry.id === layer.id)) throw new Error(`duplicate layer ${layer.id}`);
      const beforeIndex = beforeId ? layers.findIndex((entry) => entry.id === beforeId) : -1;
      if (beforeIndex >= 0) layers.splice(beforeIndex, 0, layer);
      else layers.push(layer);
    }),
    moveLayer: vi.fn((id, beforeId) => {
      const index = layers.findIndex((layer) => layer.id === id);
      if (index < 0) return;
      const [layer] = layers.splice(index, 1);
      const target = beforeId == null ? layers.length : layers.findIndex((item) => item.id === beforeId);
      layers.splice(target < 0 ? layers.length : target, 0, layer);
    }),
    removeSource: vi.fn((id) => sources.delete(id)),
    removeLayer: vi.fn((id) => {
      const index = layers.findIndex((layer) => layer.id === id);
      if (index >= 0) layers.splice(index, 1);
    }),
    setFilter: vi.fn(),
    getPaintProperty: vi.fn((id, key) => paints.get(`${id}:${key}`)),
    setPaintProperty: vi.fn((id, key, value) => paints.set(`${id}:${key}`, value)),
    getLayoutProperty: vi.fn((id, key) => {
      const layer = layers.find((entry) => entry.id === id);
      if (!layer) return undefined;
      return layer.layout?.[key] ?? (key === "visibility" ? "visible" : undefined);
    }),
    setLayoutProperty: vi.fn((id, key, value) => {
      const layer = layers.find((entry) => entry.id === id);
      if (layer) layer.layout = { ...layer.layout, [key]: value };
    }),
    on: vi.fn(),
  };
}

const polygon = (objectId, minutes, location = "עלומים", notes) => ({
  type: "Feature",
  properties: {
    OBJECTID: objectId,
    timeline_minutes: minutes,
    מיקום: location,
    ...(notes != null ? { Notes: notes } : {}),
  },
  geometry: { type: "Polygon", coordinates: [[[34, 31], [34.01, 31], [34.01, 31.01], [34, 31]]] },
});

function processedNotesStyle() {
  const fill = (color) => ({
    type: "fill",
    fillType: "gradient",
    interval: 1,
    resolvedColors: [color],
    resolvedOpacities: [0.55],
    opacity: 0.55,
  });
  const stroke = {
    type: "stroke",
    color: "#6e6e6e",
    width: 1.8,
    opacity: 0.95,
    lineCap: "round",
    lineJoin: "round",
  };
  return {
    renderer: "uniqueValue",
    uniqueValues: {
      field: "Notes",
      classes: [
        { value: "מרחב לחימה - קרב", symbol: { symbolLayers: [fill("#8e0912"), stroke] } },
        { value: "מוקד חטיפה", symbol: { symbolLayers: [fill("#ffff73"), stroke] } },
        { value: "שריפה", symbol: { symbolLayers: [fill("#7b5622"), stroke] } },
      ],
    },
  };
}

function processedOverlayData(features, extra = {}) {
  const list = Array.isArray(features) ? features : [features];
  return {
    polygonFeatures: list,
    polygonStyle: processedNotesStyle(),
    bufferedGradientFeatures: list.map((feature) => ({
      ...feature,
      properties: { ...feature.properties, __cim_gradient_band: 0 },
    })),
    bufferedGradientSidecarStatus: "ready",
    ...extra,
  };
}

const settlement = (outlineObjectId, coordinates = [[[34, 31], [34.02, 31], [34.02, 31.02], [34, 31]]]) => ({
  type: "Feature",
  id: `settlement-${outlineObjectId}`,
  properties: { OBJECTID: outlineObjectId, outlineObjectId },
  geometry: { type: "Polygon", coordinates },
});

const frame = (achievedPolygonBeats, extra = {}) => ({
  achievedPolygonBeats,
  narrative: { phase: "playing" },
  ...extra,
});

function rgbChannels(color) {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function evaluatePaintForTimeline(expression, timelineMinutes) {
  if (!Array.isArray(expression)) return expression;
  if (expression[0] === "case") {
    for (let index = 1; index < expression.length - 1; index += 2) {
      const condition = expression[index];
      if (condition?.[0] !== "==" || condition[1]?.[0] !== "to-number"
          || condition[1][1]?.[0] !== "get" || condition[1][1][1] !== "timeline_minutes") {
        continue;
      }
      if (Number(condition[2]) === Number(timelineMinutes)) {
        return evaluatePaintForTimeline(expression[index + 1], timelineMinutes);
      }
    }
    return evaluatePaintForTimeline(expression.at(-1), timelineMinutes);
  }
  if (expression[0] === "*") {
    return evaluatePaintForTimeline(expression[1], timelineMinutes)
      * evaluatePaintForTimeline(expression[2], timelineMinutes);
  }
  return expression;
}

function evaluateObjectIdOpacity(expression, objectId) {
  if (!Array.isArray(expression) || expression[0] !== "case") return Number(expression);
  for (let index = 1; index < expression.length - 1; index += 2) {
    const condition = expression[index];
    const ids = condition?.[0] === "in" && condition[1]?.[0] === "to-number"
      && condition[1][1]?.[0] === "get" && condition[1][1][1] === "OBJECTID"
      ? condition[2]?.[0] === "literal" ? condition[2][1] : []
      : [];
    if (!ids.map(Number).includes(Number(objectId))) continue;
    const value = expression[index + 1];
    return value?.[0] === "*" ? Number(value[1]) * Number(value[2]) : Number(value);
  }
  return Number(expression.at(-1));
}

describe("investigation polygon renderer", () => {
  it("keeps Nova polygon 100 in the processed beat fill source and preserves its context outline", () => {
    const map = makeMap();
    map.layers.push({ id: "nli-nova-site-outline", type: "line", source: "nli-nova-site-context" });
    const renderer = createInvestigationPolygonRenderer(map, {});
    const site = polygon(100, 483, "נובה", "מרחב לחימה - קרב");
    const bufferedSite = {
      ...site,
      properties: { ...site.properties, __cim_gradient_band: 0 },
    };
    renderer.render(frame([], {
      narrativeId: "nova",
      achievedPolygonObjectIds: [97, 100, 104],
      polygonObjectEntries: [{ objectIds: [97, 100, 104], progress: 0.5 }],
      motionMode: "full",
      nowMs: 100,
      correctedNowValid: true,
    }), {
      polygonFeatures: [site],
      bufferedGradientFeatures: [bufferedSite],
      bufferedGradientSidecarStatus: "ready",
      polygonStyle: processedNotesStyle(),
    });

    const gradient = map.sources.get("nli-investigation-polygon-buffered-gradient");
    expect(gradient.setData.mock.calls.at(-1)[0].features.map((feature) => feature.properties.OBJECTID))
      .toEqual([100]);
    expect(map.getLayer("nli-nova-site-outline")).toBeTruthy();
  });

  it("reveals a solid Nova fill from zero through intermediate opacity to its authored opacity", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const active = polygon(104, 9000, "נובה", "מוקד חטיפה");
    const style = processedNotesStyle();
    const kidnapClass = style.uniqueValues.classes.find(({ value }) => value === "מוקד חטיפה");
    kidnapClass.symbol.symbolLayers[0] = {
      type: "fill", fillType: "solid", color: "#ffff73", opacity: 0.55,
    };
    const data = {
      polygonFeatures: [active],
      polygonStyle: style,
      bufferedGradientSidecarStatus: "ready",
    };
    const renderProgress = (progress) => {
      renderer.render(frame([], {
        narrativeId: "nova",
        achievedPolygonObjectIds: [104],
        polygonObjectEntries: progress == null ? [] : [{ objectIds: [104], progress }],
        motionMode: "full",
        nowMs: 100,
        correctedNowValid: true,
      }), data);
      return evaluateObjectIdOpacity(
        map.getPaintProperty("nli-investigation-polygon-category-fill-kidnap", "fill-opacity"),
        104,
      );
    };

    expect(renderProgress(0)).toBe(0);
    expect(renderProgress(0.5)).toBeCloseTo(0.275);
    expect(renderProgress(1)).toBe(0.55);
    expect(renderProgress(null)).toBe(0.55);
  });

  it("reveals Nova category outlines with OBJECTID progress and keeps polygon 100 context outline separate", () => {
    const map = makeMap();
    map.layers.push({
      id: "nli-nova-site-outline",
      type: "line",
      source: "nli-nova-site-context",
      paint: { "line-opacity": 0.31 },
    });
    const renderer = createInvestigationPolygonRenderer(map, {});
    const site = polygon(100, 483, "נובה", "מרחב לחימה - קרב");
    const data = processedOverlayData([site]);
    const renderProgress = (progress) => {
      renderer.render(frame([], {
        narrativeId: "nova",
        achievedPolygonObjectIds: [100],
        polygonObjectEntries: [{ objectIds: [100], progress }],
        motionMode: "reduced",
      }), data);
      return evaluateObjectIdOpacity(
        map.getPaintProperty("nli-investigation-polygon-category-line-battle", "line-opacity"),
        100,
      );
    };

    expect(renderProgress(0)).toBe(0);
    expect(renderProgress(0.5)).toBeCloseTo(0.475);
    expect(renderProgress(1)).toBe(0.95);
    expect(map.getLayer("nli-nova-site-outline").paint["line-opacity"]).toBe(0.31);

    renderer.render(frame([], {
      narrativeId: "nova",
      achievedPolygonObjectIds: [100],
      polygonObjectEntries: [{ objectIds: [100], progress: 0.5 }],
      projectionNovaDim: true,
    }), data);
    const reveal = [
      "case",
      ["in", ["to-number", ["get", "OBJECTID"]], ["literal", [100]]],
      ["*", 0.95, 0.5],
      0.95,
    ];
    expect(map.getPaintProperty("nli-investigation-polygon-category-line-battle", "line-opacity"))
      .toEqual([
        "case",
        ["in", ["to-string", ["get", "OBJECTID"]], ["literal", []]],
        reveal,
        ["*", reveal, 0.28],
      ]);
  });

  it("selects Nova category polygons by OBJECTID rather than representative minutes", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const features = [
      polygon(97, 100, "נובה", "מרחב לחימה - קרב"),
      polygon(100, 200, "נובה", "מרחב לחימה - קרב"),
      polygon(104, 300, "נובה", "מוקד חטיפה"),
    ];
    renderer.render(frame([], {
      narrativeId: "nova",
      achievedPolygonObjectIds: [97, 100],
      polygonObjectEntries: [{ objectIds: [100], progress: 0.5 }],
      motionMode: "full",
      nowMs: 100,
      correctedNowValid: true,
    }), processedOverlayData(features));

    const overlay = map.sources.get("nli-investigation-polygon-category");
    expect(overlay.setData.mock.calls.at(-1)[0].features.map((feature) => feature.properties.OBJECTID))
      .toEqual([97, 100]);
    const opacity = map.getPaintProperty("nli-investigation-polygon-category-fill-battle", "fill-opacity");
    expect(JSON.stringify(opacity)).toContain('"OBJECTID"');
    expect(JSON.stringify(opacity)).not.toContain('"timeline_minutes"');
  });

  it("keeps Nova polygon 100 unfilled at idle while retaining its context outline", () => {
    const map = makeMap();
    map.layers.push({ id: "nli-nova-site-outline", type: "line", source: "nli-nova-site-context" });
    const renderer = createInvestigationPolygonRenderer(map, {});
    const site = polygon(100, 500, "נובה", "מרחב לחימה - קרב");
    renderer.render(frame([], {
      narrativeId: "nova",
      achievedPolygonObjectIds: [],
      polygonObjectEntries: [],
    }), processedOverlayData([site]));

    expect(map.sources.get("nli-investigation-polygon-category").setData.mock.calls.at(-1)[0].features)
      .toEqual([]);
    expect(map.getLayer("nli-nova-site-outline")).toBeTruthy();
  });

  it("restores a settled Nova OBJECTID selection after a renderer remount", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const features = [polygon(97, 100), polygon(98, 200)];
    const selected = frame([], {
      narrativeId: "nova",
      achievedPolygonObjectIds: [97],
      polygonObjectEntries: [],
      motionMode: "reduced",
    });
    const data = processedOverlayData(features);
    renderer.render(selected, data);
    renderer.reset({ preserveBasePaints: true });
    renderer.mount();
    renderer.render(selected, data);

    expect(map.sources.get("nli-investigation-polygon-category").setData.mock.calls.at(-1)[0].features)
      .toEqual([features[0]]);
  });

  it("animates processed gradient paints at valid full-motion timestamps", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const battle = polygon(1, 400, "עלומים", "מרחב לחימה - קרב");
    const bands = ["#111111", "#333333", "#555555"].map((color, ordinal) => ({
      ...battle,
      properties: { ...battle.properties, __cim_gradient_band: ordinal },
    }));
    const data = {
      polygonFeatures: [battle],
      bufferedGradientFeatures: bands,
      bufferedGradientSidecarStatus: "ready",
      polygonStyle: { renderer: "uniqueValue", uniqueValues: { field: "Notes", classes: [{
        value: "מרחב לחימה - קרב",
        symbol: { symbolLayers: [{
          type: "fill", fillType: "gradient", interval: 3,
          resolvedColors: ["#111111", "#333333", "#555555"],
          resolvedOpacities: [0.2, 0.4, 0.6], opacity: 0.2,
        }] },
      }] } },
    };
    renderer.render(frame([400], { motionMode: "full", nowMs: 0, correctedNowValid: true }), data);
    const firstColor = map.paints.get("nli-investigation-polygon-category-fill-battle:fill-color");
    renderer.render(frame([400], { motionMode: "full", nowMs: 3000, correctedNowValid: true }), data);
    const secondColor = map.paints.get("nli-investigation-polygon-category-fill-battle:fill-color");

    expect(secondColor).not.toEqual(firstColor);
  });

  it("shifts every processed palette inward by one fixed buffered geometry", () => {
    const makeData = (notes, colors, opacities) => {
      const feature = polygon(1, 400, "עלומים", notes);
      return {
        polygonFeatures: [feature],
        bufferedGradientFeatures: colors.map((_, ordinal) => ({
          ...feature,
          properties: { ...feature.properties, __cim_gradient_band: ordinal },
        })),
        bufferedGradientSidecarStatus: "ready",
        polygonStyle: { renderer: "uniqueValue", uniqueValues: { field: "Notes", classes: [{
          value: notes,
          symbol: { symbolLayers: [{
            type: "fill", fillType: "gradient", interval: colors.length,
            resolvedColors: colors, resolvedOpacities: opacities, opacity: opacities[0],
          }] },
        }] } },
      };
    };
    const cases = [
      ["battle", "מרחב לחימה - קרב", ["#000000", "#808080", "#ffffff"], [0.2, 0.4, 0.6]],
      ["fire", "שריפה", ["#202020", "#808080", "#d0d0d0"], [0.2, 0.4, 0.6]],
      ["kidnap", "מוקד חטיפה", ["#ffff73", "#ffff73", "#ffff73"], [0.1, 0.3, 0.8]],
    ];
    for (const [suffix, notes, colors, opacities] of cases) {
      const map = makeMap();
      const renderer = createInvestigationPolygonRenderer(map, {});
      const data = makeData(notes, colors, opacities);
      renderer.render(frame([400], { motionMode: "full", nowMs: 0, correctedNowValid: true }), data);
      renderer.render(frame([400], { motionMode: "full", nowMs: 2000, correctedNowValid: true }), data);
      colors.forEach((_, ordinal) => {
        const layerId = `nli-investigation-polygon-category-fill-${suffix}${ordinal === 0 ? "" : `-band-${ordinal}`}`;
        const sourceOrdinal = (ordinal - 1 + colors.length) % colors.length;
        expect(map.paints.get(`${layerId}:fill-color`)).toBe(colors[sourceOrdinal]);
        expect(map.paints.get(`${layerId}:fill-opacity`)).toBe(opacities[sourceOrdinal]);
      });
    }
  });

  it("keeps processed conveyor paint continuous across the phase wrap", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const battle = polygon(1, 400, "עלומים", "מרחב לחימה - קרב");
    const data = {
      polygonFeatures: [battle],
      bufferedGradientFeatures: [0, 1, 2].map((ordinal) => ({
        ...battle, properties: { ...battle.properties, __cim_gradient_band: ordinal },
      })),
      bufferedGradientSidecarStatus: "ready",
      polygonStyle: { renderer: "uniqueValue", uniqueValues: { field: "Notes", classes: [{
        value: "מרחב לחימה - קרב",
        symbol: { symbolLayers: [{ type: "fill", fillType: "gradient", interval: 3,
          resolvedColors: ["#111111", "#555555", "#999999"],
          resolvedOpacities: [0.2, 0.4, 0.6], opacity: 0.2 }] },
      }] } },
    };
    renderer.render(frame([400], { motionMode: "full", nowMs: 5999, correctedNowValid: true }), data);
    const before = rgbChannels(map.paints.get("nli-investigation-polygon-category-fill-battle:fill-color"));
    renderer.render(frame([400], { motionMode: "full", nowMs: 0, correctedNowValid: true }), data);
    const after = rgbChannels(map.paints.get("nli-investigation-polygon-category-fill-battle:fill-color"));
    expect(Math.max(...before.map((channel, index) => Math.abs(channel - after[index])))).toBeLessThanOrEqual(1);
  });

  it.each([
    ["reduced", { motionMode: "reduced", nowMs: 3000, correctedNowValid: true }],
    ["missing", { motionMode: "full", correctedNowValid: true }],
    ["null", { motionMode: "full", nowMs: null, correctedNowValid: true }],
    ["undefined", { motionMode: "full", nowMs: undefined, correctedNowValid: true }],
    ["NaN", { motionMode: "full", nowMs: NaN, correctedNowValid: true }],
    ["Infinity", { motionMode: "full", nowMs: Infinity, correctedNowValid: true }],
    ["negative", { motionMode: "full", nowMs: -1, correctedNowValid: true }],
    ["corrected-invalid", { motionMode: "full", nowMs: 3000, correctedNowValid: false }],
  ])("uses authored processed paint for %s motion time", (_, motion) => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const battle = polygon(1, 400, "עלומים", "מרחב לחימה - קרב");
    const data = {
      polygonFeatures: [battle],
      bufferedGradientFeatures: [0, 1, 2].map((ordinal) => ({
        ...battle, properties: { ...battle.properties, __cim_gradient_band: ordinal },
      })),
      bufferedGradientSidecarStatus: "ready",
      polygonStyle: { renderer: "uniqueValue", uniqueValues: { field: "Notes", classes: [{
        value: "מרחב לחימה - קרב",
        symbol: { symbolLayers: [{ type: "fill", fillType: "gradient", interval: 3,
          resolvedColors: ["#111111", "#333333", "#555555"],
          resolvedOpacities: [0.2, 0.4, 0.6], opacity: 0.2 }] },
      }] } },
    };
    renderer.render(frame([400], motion), data);
    expect(map.paints.get("nli-investigation-polygon-category-fill-battle:fill-color")).toBe("#111111");
    expect(map.paints.get("nli-investigation-polygon-category-fill-battle:fill-opacity")).toBe(0.2);
  });

  it("isolates one or more active entries from the ambient conveyor", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const battle = polygon(1, 400, "עלומים", "מרחב לחימה - קרב");
    const data = {
      polygonFeatures: [battle],
      bufferedGradientFeatures: [0, 1, 2].map((ordinal) => ({
        ...battle, properties: { ...battle.properties, __cim_gradient_band: ordinal },
      })),
      bufferedGradientSidecarStatus: "ready",
      polygonStyle: { renderer: "uniqueValue", uniqueValues: { field: "Notes", classes: [{
        value: "מרחב לחימה - קרב",
        symbol: { symbolLayers: [{ type: "fill", fillType: "gradient", interval: 3,
          resolvedColors: ["#111111", "#333333", "#555555"],
          resolvedOpacities: [0.2, 0.4, 0.6], opacity: 0.2 }] },
      }] } },
    };
    renderer.render(frame([400], {
      motionMode: "full", nowMs: 3000, correctedNowValid: true,
      polygonEntries: [{ beat: 400, progress: 0.2 }, { beat: 420, progress: 0 }],
    }), data);
    const color = map.paints.get("nli-investigation-polygon-category-fill-battle:fill-color");
    const opacity = map.paints.get("nli-investigation-polygon-category-fill-battle:fill-opacity");
    expect(color).toEqual(["case",
      ["==", ["to-number", ["get", "timeline_minutes"]], 400], "#444444",
      ["==", ["to-number", ["get", "timeline_minutes"]], 420], "#444444",
      expect.anything(),
    ]);
    expect(opacity[0]).toBe("case");
    expect(opacity[1]).toEqual(["==", ["to-number", ["get", "timeline_minutes"]], 400]);
    expect(opacity[3]).toEqual(["==", ["to-number", ["get", "timeline_minutes"]], 420]);
    expect(opacity[2]).toEqual(["*", 0.5, 0.6480000000000001]);
    expect(opacity[4]).toEqual(["*", 0.5, 0]);
  });

  it("returns an entry to the current conveyor paint when the entry completes", () => {
    const makeData = () => {
      const battle = polygon(1, 400, "עלומים", "מרחב לחימה - קרב");
      return {
        polygonFeatures: [battle],
        bufferedGradientFeatures: [0, 1, 2].map((ordinal) => ({
          ...battle, properties: { ...battle.properties, __cim_gradient_band: ordinal },
        })),
        bufferedGradientSidecarStatus: "ready",
        polygonStyle: { renderer: "uniqueValue", uniqueValues: { field: "Notes", classes: [{
          value: "מרחב לחימה - קרב",
          symbol: { symbolLayers: [{ type: "fill", fillType: "gradient", interval: 3,
            resolvedColors: ["#111111", "#555555", "#999999"], opacity: 0.2 }] },
        }] } },
      };
    };
    const entryMap = makeMap();
    const entryRenderer = createInvestigationPolygonRenderer(entryMap, {});
    const data = makeData();
    entryRenderer.render(frame([400], {
      motionMode: "full", nowMs: 1500, correctedNowValid: true,
      polygonEntries: [{ beat: 400, progress: 0.5 }],
    }), data);
    entryRenderer.render(frame([400], {
      motionMode: "full", nowMs: 1500, correctedNowValid: true,
      polygonEntries: [],
    }), data);

    const ambientMap = makeMap();
    const ambientRenderer = createInvestigationPolygonRenderer(ambientMap, {});
    ambientRenderer.render(frame([400], { motionMode: "full", nowMs: 1500, correctedNowValid: true }), makeData());
    expect(entryMap.paints.get("nli-investigation-polygon-category-fill-battle:fill-color"))
      .toBe(ambientMap.paints.get("nli-investigation-polygon-category-fill-battle:fill-color"));
    expect(entryMap.paints.get("nli-investigation-polygon-category-fill-battle:fill-opacity"))
      .toBe(ambientMap.paints.get("nli-investigation-polygon-category-fill-battle:fill-opacity"));
  });

  it.each([
    ["battle", "מרחב לחימה - קרב", ["#8e0912", "#c7171c", "#f14230", "#fb7a5a", "#fcad91", "#fdd1be"], [1, 1, 1, 1, 1, 1]],
    ["fire", "שריפה", ["#7b5622", "#a66b18", "#d07e0c", "#f99201", "#ffc400"], [1, 1, 1, 1, 1]],
    ["kidnap", "מוקד חטיפה", ["#ffff73", "#ffff73", "#ffff73", "#ffff73", "#ffff73"], [0.14, 0.27, 0.46, 0.68, 1]],
  ])("hands off %s entry paint to the current conveyor at completion", (suffix, notes, colors, opacities) => {
    const makeData = () => {
      const target = polygon(1, 400, "עלומים", notes);
      const unaffected = polygon(2, 420, "עלומים", notes);
      const bands = colors.flatMap((_, ordinal) => [target, unaffected].map((feature) => ({
        ...feature,
        properties: { ...feature.properties, __cim_gradient_band: ordinal },
      })));
      return {
        polygonFeatures: [target, unaffected],
        bufferedGradientFeatures: bands,
        bufferedGradientSidecarStatus: "ready",
        polygonStyle: { renderer: "uniqueValue", uniqueValues: { field: "Notes", classes: [{
          value: notes,
          symbol: { symbolLayers: [{
            type: "fill", fillType: "gradient", interval: colors.length,
            resolvedColors: colors, resolvedOpacities: opacities, opacity: opacities[0],
          }] },
        }] } },
      };
    };
    const motion = { motionMode: "full", nowMs: 1500, correctedNowValid: true };
    const ambientMap = makeMap();
    const ambientRenderer = createInvestigationPolygonRenderer(ambientMap, {});
    ambientRenderer.render(frame([400, 420], motion), makeData());
    const ambientColor = ambientMap.paints.get(`nli-investigation-polygon-category-fill-${suffix}:fill-color`);
    const ambientOpacity = ambientMap.paints.get(`nli-investigation-polygon-category-fill-${suffix}:fill-opacity`);

    const entryMap = makeMap();
    const entryRenderer = createInvestigationPolygonRenderer(entryMap, {});
    entryRenderer.render(frame([400, 420], {
      ...motion,
      polygonEntries: [{ beat: 400, progress: 1 - 1e-9 }],
    }), makeData());
    const entryColor = entryMap.paints.get(`nli-investigation-polygon-category-fill-${suffix}:fill-color`);
    const entryOpacity = entryMap.paints.get(`nli-investigation-polygon-category-fill-${suffix}:fill-opacity`);
    expect(evaluatePaintForTimeline(entryColor, 400)).toBe(ambientColor);
    expect(evaluatePaintForTimeline(entryOpacity, 400)).toBeCloseTo(ambientOpacity, 6);
    expect(evaluatePaintForTimeline(entryColor, 420)).toBe(ambientColor);
    expect(evaluatePaintForTimeline(entryOpacity, 420)).toBe(ambientOpacity);

    entryRenderer.render(frame([400, 420], motion), makeData());
    expect(entryMap.paints.get(`nli-investigation-polygon-category-fill-${suffix}:fill-color`)).toBe(ambientColor);
    expect(entryMap.paints.get(`nli-investigation-polygon-category-fill-${suffix}:fill-opacity`)).toBe(ambientOpacity);
  });

  it("updates only bounded fill paints on a changed conveyor tick", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const battle = polygon(1, 400, "עלומים", "מרחב לחימה - קרב");
    const data = {
      polygonFeatures: [battle],
      bufferedGradientFeatures: [0, 1].map((ordinal) => ({
        ...battle, properties: { ...battle.properties, __cim_gradient_band: ordinal },
      })),
      bufferedGradientSidecarStatus: "ready",
      polygonStyle: { renderer: "uniqueValue", uniqueValues: { field: "Notes", classes: [{
        value: "מרחב לחימה - קרב",
        symbol: { symbolLayers: [{ type: "fill", fillType: "gradient", interval: 2,
          resolvedColors: ["#111111", "#333333"], opacity: 0.3 },
          { type: "stroke", color: "#654321", opacity: 0.6 }] },
      }] } },
    };
    renderer.render(frame([400], { motionMode: "full", nowMs: 0, correctedNowValid: true }), data);
    const allSources = [...map.sources.values()];
    const setDataCalls = allSources.map((source) => source.setData.mock.calls.length);
    map.setPaintProperty.mockClear();
    map.setLayoutProperty.mockClear();
    map.setFilter.mockClear();
    map.addSource.mockClear();
    map.addLayer.mockClear();
    map.removeSource.mockClear();
    map.removeLayer.mockClear();
    renderer.render(frame([400], { motionMode: "full", nowMs: 3000, correctedNowValid: true }), data);
    expect(map.setPaintProperty.mock.calls).toHaveLength(4);
    expect(map.setPaintProperty.mock.calls.every(([, property]) => property === "fill-color" || property === "fill-opacity")).toBe(true);
    expect(map.setLayoutProperty).not.toHaveBeenCalled();
    expect(map.setFilter).not.toHaveBeenCalled();
    expect(map.addSource).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();
    expect(map.removeSource).not.toHaveBeenCalled();
    expect(map.removeLayer).not.toHaveBeenCalled();
    expect(allSources.every((source, index) => source.setData.mock.calls.length === setDataCalls[index])).toBe(true);
  });

  it("renders processed buffered bands outside-to-inside and uses original fire outlines", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {}, { dataVersion: "v1" });
    const battle = polygon(1, 400, "עלומים", "מרחב לחימה - קרב");
    const fire = polygon(2, 400, "עלומים", "שריפה");
    const style = {
      renderer: "uniqueValue",
      uniqueValues: { field: "Notes", classes: [
        { value: "מרחב לחימה - קרב", symbol: { symbolLayers: [
          { type: "fill", fillType: "gradient", interval: 2, resolvedColors: ["#111111", "#222222"], opacity: 0.5 },
          { type: "stroke", color: "#333333", width: 2, opacity: 0.7 },
        ] } },
        { value: "שריפה", symbol: { symbolLayers: [
          { type: "fill", fillType: "gradient", interval: 1, resolvedColors: ["#444444"], opacity: 0.6 },
          { type: "stroke", color: "#555555", width: 3, opacity: 0.8 },
        ] } },
      ] },
    };
    const band = { ...battle, properties: { ...battle.properties, __cim_gradient_band: 0 } };
    renderer.render(frame([400], { motionMode: "full" }), {
      polygonFeatures: [battle, fire],
      bufferedGradientFeatures: [band],
      polygonStyle: style,
      bufferedGradientSidecarStatus: "ready",
    });
    const fills = map.addLayer.mock.calls
      .map(([layer]) => layer)
      .filter((layer) => layer.type === "fill" && layer.id.includes("battle"));
    expect(fills[0].paint["fill-color"]).toBe("#111111");
    expect(fills[0].filter).toEqual(["all", ["==", ["get", "Notes"], "מרחב לחימה - קרב"], ["==", ["get", "__cim_gradient_band"], 0]]);
    const fireOutline = map.addLayer.mock.calls
      .map(([layer]) => layer)
      .find((layer) => layer.type === "line" && layer.id.includes("fire"));
    expect(fireOutline.paint["line-color"]).toBe("#555555");
    expect(fireOutline.source).toBe("nli-investigation-polygon-category-outline");
    expect(fireOutline.paint["line-gradient"]).toBeUndefined();
  });

  it("keeps kidnapping solid when a declared buffered sidecar fails", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const kidnap = polygon(1, 400, "עלומים", "מוקד חטיפה");
    renderer.render(frame([400]), {
      polygonFeatures: [kidnap],
      polygonStyle: { renderer: "uniqueValue", uniqueValues: { field: "Notes", classes: [
        { value: "מרחב לחימה - קרב", symbol: { symbolLayers: [{ type: "fill", fillType: "gradient", interval: 2, resolvedColors: ["#111111", "#222222"], opacity: 0.5 }] } },
        { value: "מוקד חטיפה", symbol: { symbolLayers: [{ type: "fill", fillType: "solid", color: "#ffff73", opacity: 0.55 }] } },
      ] } },
      bufferedGradientSidecarStatus: "failed",
    });
    const kidnapLayer = map.addLayer.mock.calls.map(([layer]) => layer)
      .find((layer) => layer.id === "nli-investigation-polygon-category-fill-kidnap");
    expect(kidnapLayer.paint["fill-color"]).toBe("#ffff73");
    expect(map.paints.get("nli-investigation-polygon-category-fill-battle:fill-opacity")).toBe(0);
  });

  it("composes projection dimming with processed authored opacity", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const battle = polygon(1, 400, "עלומים", "מרחב לחימה - קרב");
    renderer.render(frame([400], { projectionNovaDim: true }), {
      polygonFeatures: [battle],
      bufferedGradientFeatures: [{ ...battle, properties: { ...battle.properties, __cim_gradient_band: 0 } }],
      bufferedGradientSidecarStatus: "ready",
      polygonStyle: { renderer: "uniqueValue", uniqueValues: { field: "Notes", classes: [{
        value: "מרחב לחימה - קרב", symbol: { symbolLayers: [{
          type: "fill", fillType: "gradient", interval: 1, resolvedColors: ["#123456"], opacity: 0.5,
        }] },
      }] } },
    });
    expect(map.paints.get("nli-investigation-polygon-category-fill-battle:fill-opacity")).toEqual([
      "case",
      ["in", ["to-string", ["get", "OBJECTID"]], ["literal", []]],
      0.5,
      ["*", 0.5, 0.28],
    ]);
  });

  it("keeps failed battle and fire fills transparent during projection dimming", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const battle = polygon(1, 400, "עלומים", "מרחב לחימה - קרב");
    const fire = polygon(2, 400, "עלומים", "שריפה");
    const classes = ["מרחב לחימה - קרב", "שריפה"].map((value) => ({
      value,
      symbol: { symbolLayers: [{ type: "fill", fillType: "gradient", interval: 1, resolvedColors: ["#123456"], opacity: 0.5 }] },
    }));
    renderer.render(frame([400], { projectionNovaDim: true }), {
      polygonFeatures: [battle, fire],
      polygonStyle: { renderer: "uniqueValue", uniqueValues: { field: "Notes", classes } },
      bufferedGradientSidecarStatus: "failed",
    });
    expect(map.paints.get("nli-investigation-polygon-category-fill-battle:fill-opacity")).toBe(0);
    expect(map.paints.get("nli-investigation-polygon-category-fill-fire:fill-opacity")).toBe(0);
  });

  it("composes processed outline opacity with projection dimming", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const battle = polygon(1, 400, "עלומים", "מרחב לחימה - קרב");
    renderer.render(frame([400], { projectionNovaDim: true }), {
      polygonFeatures: [battle],
      bufferedGradientFeatures: [{ ...battle, properties: { ...battle.properties, __cim_gradient_band: 0 } }],
      bufferedGradientSidecarStatus: "ready",
      polygonStyle: { renderer: "uniqueValue", uniqueValues: { field: "Notes", classes: [{
        value: "מרחב לחימה - קרב", symbol: { symbolLayers: [
          { type: "fill", fillType: "gradient", interval: 1, resolvedColors: ["#123456"], opacity: 0.5 },
          { type: "stroke", color: "#654321", width: 2, opacity: 0.6 },
        ] },
      }] } },
    });
    expect(map.paints.get("nli-investigation-polygon-category-line-battle:line-opacity")).toEqual([
      "case",
      ["in", ["to-string", ["get", "OBJECTID"]], ["literal", []]],
      0.6,
      ["*", 0.6, 0.28],
    ]);
  });

  it("renders every processed hostage gradient band through sidecar geometry", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const kidnap = polygon(1, 400, "עלומים", "מוקד חטיפה");
    const resolvedOpacities = [0.14, 0.27, 0.46, 0.68, 1];
    renderer.render(frame([400]), {
      polygonFeatures: [kidnap],
      bufferedGradientFeatures: resolvedOpacities.map((_, ordinal) => ({
        ...kidnap,
        properties: { ...kidnap.properties, __cim_gradient_band: ordinal },
      })),
      bufferedGradientSidecarStatus: "ready",
      polygonStyle: { renderer: "uniqueValue", uniqueValues: { field: "Notes", classes: [{
        value: "מוקד חטיפה", symbol: { symbolLayers: [{
          type: "fill",
          fillType: "gradient",
          interval: 5,
          resolvedColors: Array(5).fill("#ffff73"),
          resolvedOpacities,
          opacity: 0.14,
        }] },
      }] } },
    });
    const hostageBandLayers = map.addLayer.mock.calls.map(([layer]) => layer)
      .filter((layer) => layer.type === "fill"
        && layer.source === "nli-investigation-polygon-buffered-gradient"
        && layer.id.includes("kidnap"));
    expect(hostageBandLayers).toHaveLength(5);
    expect(hostageBandLayers.map((layer) => layer.source)).toEqual(
      Array(5).fill("nli-investigation-polygon-buffered-gradient"),
    );
    expect(hostageBandLayers.map((layer) => layer.paint["fill-color"]))
      .toEqual(Array(5).fill("#ffff73"));
    expect(hostageBandLayers.map((layer) => layer.paint["fill-opacity"]))
      .toEqual(resolvedOpacities);
  });

  it("keeps every hostage gradient band transparent while the declared sidecar is loading", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const kidnap = polygon(1, 400, "עלומים", "מוקד חטיפה");
    renderer.render(frame([400]), {
      polygonFeatures: [kidnap],
      bufferedGradientSidecarStatus: "loading",
      polygonStyle: { renderer: "uniqueValue", uniqueValues: { field: "Notes", classes: [{
        value: "מוקד חטיפה", symbol: { symbolLayers: [{
          type: "fill", fillType: "gradient", interval: 5,
          resolvedColors: Array(5).fill("#ffff73"),
          resolvedOpacities: [0.14, 0.27, 0.46, 0.68, 1], opacity: 0.14,
        }] },
      }] } },
    });
    const hostageBandLayers = map.addLayer.mock.calls.map(([layer]) => layer)
      .filter((layer) => layer.type === "fill"
        && layer.source === "nli-investigation-polygon-buffered-gradient"
        && layer.id.includes("kidnap"));
    expect(hostageBandLayers.map((layer) => layer.paint["fill-opacity"]))
      .toEqual(Array(5).fill(0));
  });

  it("keeps every hostage gradient band transparent when the declared sidecar fails", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const kidnap = polygon(1, 400, "עלומים", "מוקד חטיפה");
    renderer.render(frame([400]), {
      polygonFeatures: [kidnap],
      bufferedGradientSidecarStatus: "failed",
      polygonStyle: { renderer: "uniqueValue", uniqueValues: { field: "Notes", classes: [{
        value: "מוקד חטיפה", symbol: { symbolLayers: [{
          type: "fill", fillType: "gradient", interval: 5,
          resolvedColors: Array(5).fill("#ffff73"),
          resolvedOpacities: [0.14, 0.27, 0.46, 0.68, 1], opacity: 0.14,
        }] },
      }] } },
    });
    const hostageBandLayers = map.addLayer.mock.calls.map(([layer]) => layer)
      .filter((layer) => layer.type === "fill"
        && layer.source === "nli-investigation-polygon-buffered-gradient"
        && layer.id.includes("kidnap"));
    expect(hostageBandLayers.map((layer) => layer.paint["fill-opacity"]))
      .toEqual(Array(5).fill(0));
  });

  it("composes projection dimming with each processed hostage band opacity", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const kidnap = polygon(1, 400, "עלומים", "מוקד חטיפה");
    const opacities = [0.14, 0.27, 0.46, 0.68, 1];
    renderer.render(frame([400], { projectionNovaDim: true }), {
      polygonFeatures: [kidnap],
      bufferedGradientFeatures: [0, 1, 2, 3, 4].map((ordinal) => ({
        ...kidnap,
        properties: { ...kidnap.properties, __cim_gradient_band: ordinal },
      })),
      bufferedGradientSidecarStatus: "ready",
      polygonStyle: { renderer: "uniqueValue", uniqueValues: { field: "Notes", classes: [{
        value: "מוקד חטיפה", symbol: { symbolLayers: [{
          type: "fill", fillType: "gradient", interval: 5,
          resolvedColors: Array(5).fill("#ffff73"),
          resolvedOpacities: opacities, opacity: 0.14,
        }] },
      }] } },
    });
    for (const [ordinal, opacity] of opacities.entries()) {
      const id = ordinal === 0
        ? "nli-investigation-polygon-category-fill-kidnap"
        : `nli-investigation-polygon-category-fill-kidnap-band-${ordinal}`;
      expect(map.paints.get(`${id}:fill-opacity`)).toEqual([
        "case",
        ["in", ["to-string", ["get", "OBJECTID"]], ["literal", []]],
        opacity,
        ["*", opacity, 0.28],
      ]);
    }
  });
  it("uses the same impact outline width on GIS and projection profiles", () => {
    const gisMap = makeMap();
    const projMap = makeMap();
    const gis = createInvestigationPolygonRenderer(gisMap, { lineWidthMultiplier: 1 });
    const proj = createInvestigationPolygonRenderer(projMap, { lineWidthMultiplier: 1.2 });
    const idleFrame = frame([]);
    gis.render(idleFrame, { polygonFeatures: [], settlementFeatures: [settlement(20)] });
    proj.render(idleFrame, { polygonFeatures: [], settlementFeatures: [settlement(20)] });
    const gisLayer = gisMap.getLayer("nli-investigation-settlement-impact-outline");
    const projLayer = projMap.getLayer("nli-investigation-settlement-impact-outline");
    expect(gisLayer.paint["line-color"]).toBe("#c31f4f");
    expect(projLayer.paint["line-color"]).toBe("#c31f4f");
    expect(gisLayer.paint["line-width"]).toBe(1.8);
    expect(projLayer.paint["line-width"]).toBe(1.8);
  });

  it("omits unachieved polygons from the overlay source", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, { lineWidthMultiplier: 1 });
    renderer.render(frame([400]), processedOverlayData([polygon(1, 400), polygon(2, 420)]));
    const overlay = map.sources.get("nli-investigation-polygon-category");
    const feats = overlay.setData.mock.calls.at(-1)[0].features;
    expect(feats.map((f) => f.properties.timeline_minutes)).toEqual([400]);
  });

  it("hides host pack polygon layers while overlay is mounted", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    renderer.render(frame([400]), { polygonFeatures: [polygon(1, 400)] });
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      "nli__investigation_polygons__fill__0",
      "visibility",
      "none",
    );
  });

  it("does not paint unprocessed category fills when polygonStyle is missing", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    renderer.render(frame([400]), {
      polygonFeatures: [polygon(1, 400, "עלומים", "מרחב לחימה - קרב")],
    });
    expect(map.addLayer.mock.calls.some(([layer]) => (
      typeof layer?.id === "string" && layer.id.includes("nli-investigation-polygon-category")
    ))).toBe(false);
    expect(map.getLayer("nli-investigation-polygon-category-fill-battle")).toBeNull();
  });

  it("remounts processed bands after reset without leaving a teal category fill", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const battle = polygon(1, 400, "עלומים", "מרחב לחימה - קרב");
    const style = {
      renderer: "uniqueValue",
      uniqueValues: { field: "Notes", classes: [{
        value: "מרחב לחימה - קרב",
        symbol: { symbolLayers: [{
          type: "fill", fillType: "gradient", interval: 2,
          resolvedColors: ["#111111", "#333333"],
          resolvedOpacities: [0.2, 0.8],
        }] },
      }] },
    };
    const data = {
      polygonFeatures: [battle],
      bufferedGradientFeatures: [0, 1].map((ordinal) => ({
        ...battle,
        properties: { ...battle.properties, __cim_gradient_band: ordinal },
      })),
      bufferedGradientSidecarStatus: "ready",
      polygonStyle: style,
    };
    renderer.render(frame([400]), data);
    renderer.reset({ preserveBasePaints: true });
    renderer.mount();
    renderer.render(frame([400]), data);
    const battleFill = map.getLayer("nli-investigation-polygon-category-fill-battle");
    expect(battleFill.source).toBe("nli-investigation-polygon-buffered-gradient");
    expect(battleFill.paint["fill-color"]).toBe("#111111");
    expect(map.getLayer("nli-investigation-polygon-category-fill-battle-band-1")).toBeTruthy();
    expect(map.addLayer.mock.calls.map(([layer]) => layer.paint?.["fill-color"]))
      .not.toContain("#3d9a8c");
  });

  it("filters category layers by Notes", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const battle = polygon(1, 400);
    battle.properties.Notes = "מרחב לחימה - קרב";
    renderer.render(frame([400]), processedOverlayData([battle]));
    const fill = map.addLayer.mock.calls.find(([layer]) => layer.id.includes("battle") && layer.type === "fill")[0];
    expect(fill.filter).toEqual(["all", ["==", ["get", "Notes"], "מרחב לחימה - קרב"], ["==", ["get", "__cim_gradient_band"], 0]]);
  });

  it("processed category outlines stay scalar during full motion", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const battle = polygon(1, 400, "עלומים", "מרחב לחימה - קרב");
    const kidnap = polygon(2, 400, "עלומים", "מוקד חטיפה");
    renderer.render(frame([400], { motionMode: "full", nowMs: 0, correctedNowValid: true }), processedOverlayData([battle, kidnap]));
    const outline = map.getLayer("nli-investigation-polygon-category-line-battle");
    expect(outline.paint["line-color"]).toBe("#6e6e6e");
    expect(outline.paint["line-width"]).toBe(1.8);
    expect(outline.paint["line-gradient"]).toBeUndefined();
  });

  it("composes Nova dimming with each processed fill opacity", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const features = [
      polygon(1, 400, "עלומים", "מרחב לחימה - קרב"),
      polygon(2, 400, "עלומים", "מוקד חטיפה"),
      polygon(3, 400, "עלומים", "שריפה"),
    ];
    renderer.render(frame([400], {
      motionMode: "reduced", projectionNovaDim: true,
    }), processedOverlayData(features));
    for (const suffix of ["battle", "kidnap", "fire"]) {
      expect(map.paints.get(`nli-investigation-polygon-category-fill-${suffix}:fill-opacity`)).toEqual([
        "case",
        ["in", ["to-string", ["get", "OBJECTID"]], ["literal", []]],
        0.55,
        ["*", 0.55, 0.28],
      ]);
    }
  });

  it("warns once and suppresses processed classes when the style is malformed", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const feature = polygon(1, 400, "עלומים", "מרחב לחימה - קרב");
    const data = {
      polygonFeatures: [feature],
      bufferedGradientFeatures: [feature],
      bufferedGradientSidecarStatus: "ready",
      polygonStyle: { renderer: "uniqueValue", uniqueValues: { field: "Notes", classes: [{
        value: "מרחב לחימה - קרב",
        symbol: { symbolLayers: [{
          type: "fill", fillType: "gradient", interval: 2,
          resolvedColors: ["#123456", "#12345"], resolvedOpacities: [0.5, 0.5],
        }] },
      }] } },
    };
    expect(() => renderer.render(frame([400]), data)).not.toThrow();
    renderer.render(frame([400]), data);
    expect(warn.mock.calls.filter(([message]) => String(message).includes("processed style is malformed"))).toHaveLength(1);
    expect(map.getLayoutProperty("nli__investigation_polygons__fill__0", "visibility")).toBe("none");
    expect(map.addLayer.mock.calls.some(([layer]) => layer.id.includes("category-fill-battle"))).toBe(false);
    warn.mockRestore();
  });

  it("writes closed LineString rings to the outline source with lineMetrics", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const open = polygon(1, 400, "עלומים", "מרחב לחימה - קרב");
    open.geometry.coordinates[0] = [[34, 31], [34.01, 31], [34.01, 31.01]];
    renderer.render(frame([400]), processedOverlayData([open]));
    const spec = map.addSource.mock.calls.find(([id]) => id === "nli-investigation-polygon-category-outline")[1];
    expect(spec.lineMetrics).toBe(true);
    const outline = map.sources.get("nli-investigation-polygon-category-outline");
    const feats = outline.setData.mock.calls.at(-1)[0].features;
    expect(feats[0].geometry.type).toBe("LineString");
    const coords = feats[0].geometry.coordinates;
    expect(coords[0]).toEqual(coords[coords.length - 1]);
  });

  it("writes polygon hole rings to the authored outline source", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const fire = polygon(1, 400, "עלומים", "שריפה");
    fire.geometry.coordinates.push([
      [34.002, 31.002], [34.008, 31.002], [34.008, 31.008], [34.002, 31.008], [34.002, 31.002],
    ]);
    renderer.render(frame([400]), processedOverlayData([fire]));
    const outline = map.sources.get("nli-investigation-polygon-category-outline");
    const feats = outline.setData.mock.calls.at(-1)[0].features;
    expect(feats).toHaveLength(2);
  });

  it("warns once per distinct unmatched Notes string", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unknownA = polygon(1, 400, "עלומים", "לא ידוע");
    const unknownB = polygon(2, 400, "עלומים", "לא ידוע");
    renderer.render(frame([400]), processedOverlayData([unknownA, unknownB]));
    expect(map.addLayer.mock.calls.find(([layer]) => layer.id.includes("fallback"))).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    renderer.render(frame([400]), processedOverlayData([unknownA, unknownB]));
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("keeps achieved polygons in the overlay and drops later achievements on backward seek", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const features = [polygon(1, 400), polygon(2, 420)];
    renderer.render(frame([400, 420]), processedOverlayData(features));
    renderer.render(frame([400]), processedOverlayData(features));
    const overlay = map.sources.get("nli-investigation-polygon-category");
    const feats = overlay.setData.mock.calls.at(-1)[0].features;
    expect(feats.map((f) => f.properties.timeline_minutes)).toEqual([400]);
  });

  it("deduplicates achieved settlement outlines and uses injected data without fetch", () => {
    const map = makeMap();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const renderer = createInvestigationPolygonRenderer(map, {}, {
      locationToOutlineObjectId: { עלומים: "20", "עלומים 2": "20", בארי: "21" },
      settlementFeatures: [settlement(20), settlement(21)],
    });
    const polygons = [polygon(1, 400, "עלומים"), polygon(2, 410, "עלומים 2"), polygon(3, 420, "בארי")];
    renderer.render(frame([400, 410]), { polygonFeatures: polygons });
    const outline = map.sources.get("nli-investigation-settlement-impact").setData.mock.calls.at(-1)[0];
    expect(outline.features.map((feature) => feature.properties.outlineObjectId)).toEqual([20]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("paints the narrative focus settlement outline white and leaves other impact outlines red", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    renderer.render({
      achievedPolygonBeats: [],
      achievedSettlementOutlineIds: [32, 20],
      narrativeFocusOutlineId: 32,
      narrative: { phase: "idle" },
    }, {
      settlementFeatures: [settlement(32), settlement(20)],
      settlementFeaturesByOutlineId: { 32: settlement(32), 20: settlement(20) },
    });
    expect(map.getPaintProperty("nli-investigation-settlement-impact-outline", "line-color")).toEqual([
      "case",
      [
        "any",
        ["==", ["to-string", ["get", "outlineObjectId"]], "32"],
        ["==", ["to-string", ["get", "OBJECTID"]], "32"],
      ],
      "#ffffff",
      "#c31f4f",
    ]);
  });

  it("defers settlement paint across the host-style remount gap", () => {
    const map = makeMap();
    const hostLayers = [
      ...map.layers.splice(0),
      { id: "people-labels", type: "symbol", source: "host" },
    ];
    const renderer = createInvestigationPolygonRenderer(map, { beforeId: "people-labels" });
    const focusedFrame = {
      achievedPolygonBeats: [],
      achievedSettlementOutlineIds: [32, 20],
      narrativeFocusOutlineId: 32,
      narrative: { phase: "idle" },
    };
    const data = {
      settlementFeatures: [settlement(32), settlement(20)],
      settlementFeaturesByOutlineId: { 32: settlement(32), 20: settlement(20) },
    };

    renderer.render(focusedFrame, data);
    expect(map.setPaintProperty).not.toHaveBeenCalledWith(
      "nli-investigation-settlement-impact-outline",
      "line-color",
      expect.anything(),
    );

    map.layers.push(...hostLayers);
    renderer.render(focusedFrame, data);
    expect(map.getLayer("nli-investigation-settlement-impact-outline")).toBeTruthy();
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      "nli-investigation-settlement-impact-outline",
      "line-color",
      expect.any(Array),
    );
  });

  it("restores red impact outlines when narrative focus outline is absent", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const data = {
      settlementFeatures: [settlement(32), settlement(20)],
      settlementFeaturesByOutlineId: { 32: settlement(32), 20: settlement(20) },
    };
    renderer.render({
      achievedPolygonBeats: [],
      achievedSettlementOutlineIds: [32, 20],
      narrativeFocusOutlineId: 32,
      narrative: { phase: "idle" },
    }, data);
    renderer.render({
      achievedPolygonBeats: [],
      achievedSettlementOutlineIds: [20],
      narrative: { phase: "idle" },
    }, data);
    expect(map.getPaintProperty("nli-investigation-settlement-impact-outline", "line-color")).toBe("#c31f4f");
  });

  it("renders settlement outlines from the inclusive OR of polygon and route triggers", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {}, {
      settlementFeatures: [settlement(20), settlement(21)],
      settlementFeaturesByOutlineId: { 20: settlement(20), 21: settlement(21) },
    });
    renderer.render({
      achievedPolygonBeats: [400],
      achievedSettlementOutlineIds: [20, 21],
      narrative: { phase: "playing" },
    }, {
      polygonFeatures: [polygon(1, 400)],
    });

    const outline = map.sources.get("nli-investigation-settlement-impact").setData.mock.calls.at(-1)[0];
    expect(outline.features.map((feature) => feature.properties.outlineObjectId).sort())
      .toEqual([20, 21]);
  });

  it("supports exact index entries supplied as Map and object records", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {}, {
      locationToOutlineObjectId: new Map([["בארי", 21]]),
      settlementFeaturesByOutlineId: { 21: settlement(21) },
    });
    renderer.render(frame([400]), { polygonFeatures: [polygon(3, 400, "בארי")] });
    expect(map.sources.get("nli-investigation-settlement-impact").setData.mock.calls.at(-1)[0].features)
      .toHaveLength(1);
  });

  it("lights Nova outline 100 in incident red without using Reim 18", () => {
    const sidecar = fs.existsSync(SETTLEMENTS_PATH)
      ? JSON.parse(fs.readFileSync(SETTLEMENTS_PATH, "utf8")).features || []
      : [];
    const novaSite = settlement(100, [[[34.468, 31.397], [34.471, 31.397], [34.471, 31.400], [34.468, 31.397]]]);
    novaSite.properties.locations = ["נובה"];
    const reim = settlement(18);
    reim.properties.locations = ["רעים"];
    const settlementFeatures = sidecar.length ? sidecar : [reim, novaSite];
    const indexes = buildInvestigationSettlementIndexes(settlementFeatures);
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {}, {
      locationToOutlineObjectId: indexes.locationToOutlineObjectId,
      settlementFeatures,
      settlementFeaturesByOutlineId: indexes.settlementFeaturesByOutlineId,
    });
    renderer.render(frame([500], { narrative: { phase: "idle" } }), {
      polygonFeatures: [polygon(100, 500, "נובה")],
    });
    const outline = map.sources.get("nli-investigation-settlement-impact").setData.mock.calls.at(-1)[0];
    const ids = outline.features.map((feature) => String(feature.properties.outlineObjectId));
    expect(ids).toContain("100");
    expect(ids).not.toContain("18");
    expect(map.getLayer("nli-investigation-settlement-impact-outline").paint["line-color"]).toBe("#c31f4f");
  });

  it("does not register duplicate handles when mount and render are repeated", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    renderer.mount();
    renderer.mount();
    renderer.render(frame([400]), { polygonFeatures: [polygon(1, 400)] });
    renderer.render(frame([400]), { polygonFeatures: [polygon(1, 400)] });
    expect(map.addSource.mock.calls.filter(([id]) => id === "nli-investigation-settlement-impact")).toHaveLength(1);
    expect(map.addLayer.mock.calls.filter(([layer]) => layer.id === "nli-investigation-settlement-impact-outline")).toHaveLength(1);
  });

  it("idle nova GIS does not clone battle polygon 100 as a white site outline", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, NLI_DISPLAY_PROFILES.gis, { surface: "gis" });
    const site = polygon(100, 500, "נובה", "מרחב לחימה - קרב");
    renderer.mount();
    renderer.render(frame([], { narrativeId: "nova", motionMode: "reduced" }), processedOverlayData([site]));
    expect(map.getLayer("nli-nova-site-outline")).toBeFalsy();
    const fills = map.sources.get("nli-investigation-polygon-category").setData.mock.calls.at(-1)[0].features;
    expect(fills).toEqual([]);
    expect(map.getLayer("nli-investigation-polygon-category-line-battle-nova-site")).toBeFalsy();
  });

  it("idle nova projection also leaves battle polygon 100 uncloned", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(
      map,
      NLI_DISPLAY_PROFILES.projection,
      { surface: "projection" },
    );
    const site = polygon(100, 500, "נובה", "מרחב לחימה - קרב");
    renderer.mount();
    renderer.render(frame([], { narrativeId: "nova", motionMode: "reduced" }), processedOverlayData([site]));
    expect(map.getLayer("nli-nova-site-outline")).toBeFalsy();
    expect(map.getLayer("nli-investigation-polygon-category-line-battle-nova-site")).toBeFalsy();
  });

  it("GIS nova play at minute 500 keeps 100 off category fill and outline", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, NLI_DISPLAY_PROFILES.gis, { surface: "gis" });
    const site = polygon(100, 500, "נובה", "מרחב לחימה - קרב");
    const west = polygon(107, 480, "שדות ממערב לנובה", "מרחב לחימה - קרב");
    renderer.mount();
    renderer.render(frame([480, 500], { narrativeId: "nova", motionMode: "reduced" }), processedOverlayData([site, west]));
    const fills = map.sources.get("nli-investigation-polygon-category")
      .setData.mock.calls.at(-1)[0].features
      .map((feature) => feature.properties.OBJECTID);
    const outlines = map.sources.get("nli-investigation-polygon-category-outline")
      .setData.mock.calls.at(-1)[0].features
      .map((feature) => feature.properties.OBJECTID);
    expect(fills).not.toContain(100);
    expect(fills).toContain(107);
    expect(outlines).not.toContain(100);
    expect(outlines).toContain(107);
    expect(map.getLayer("nli-nova-site-outline")).toBeFalsy();
    expect(map.paints.get("nli-investigation-polygon-category-fill-battle:fill-opacity")).toBe(0.55);
  });

  it("projection nova play at minute 500 keeps 100 off category fill without a white clone", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(
      map,
      NLI_DISPLAY_PROFILES.projection,
      { surface: "projection" },
    );
    const site = polygon(100, 500, "נובה", "מרחב לחימה - קרב");
    const west = polygon(107, 480, "שדות ממערב לנובה", "מרחב לחימה - קרב");
    renderer.mount();
    renderer.render(frame([480, 500], { narrativeId: "nova", motionMode: "reduced" }), processedOverlayData([site, west]));
    const fills = map.sources.get("nli-investigation-polygon-category")
      .setData.mock.calls.at(-1)[0].features
      .map((feature) => feature.properties.OBJECTID);
    const outlines = map.sources.get("nli-investigation-polygon-category-outline")
      .setData.mock.calls.at(-1)[0].features
      .map((feature) => feature.properties.OBJECTID);
    expect(fills).not.toContain(100);
    expect(fills).toContain(107);
    expect(outlines).not.toContain(100);
    expect(outlines).toContain(107);
    expect(map.getLayer("nli-nova-site-outline")).toBeFalsy();
    renderer.render(frame([480, 500], {
      narrativeId: "nova",
      motionMode: "reduced",
      projectionNovaDim: true,
      parallelImpactIds: new Set(["polygon:100"]),
    }), processedOverlayData([site, west]));
    expect(map.getLayer("nli-nova-site-outline")).toBeFalsy();
  });

  it("non-nova play still fills polygon 100", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, NLI_DISPLAY_PROFILES.gis, { surface: "gis" });
    const site = polygon(100, 500, "נובה", "מרחב לחימה - קרב");
    renderer.mount();
    renderer.render(frame([500], { motionMode: "reduced" }), processedOverlayData([site]));
    const fills = map.sources.get("nli-investigation-polygon-category")
      .setData.mock.calls.at(-1)[0].features
      .map((feature) => feature.properties.OBJECTID);
    expect(fills).toContain(100);
    expect(map.getLayer("nli-nova-site-outline")).toBeFalsy();
  });

  it("nova play at minute 500 fills kidnapping polygon 104 at token opacity", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, NLI_DISPLAY_PROFILES.gis, { surface: "gis" });
    const kidnapCallout = polygon(104, 500, "נובה", "מוקד חטיפה");
    const kidnapOther = polygon(200, 500, "נובה", "מוקד חטיפה");
    renderer.mount();
    renderer.render(frame([500], { narrativeId: "nova", motionMode: "reduced" }), processedOverlayData([kidnapCallout, kidnapOther]));
    const fills = map.sources.get("nli-investigation-polygon-category")
      .setData.mock.calls.at(-1)[0].features
      .map((feature) => feature.properties.OBJECTID);
    expect(fills).toContain(104);
    expect(fills).toContain(200);
    expect(map.paints.get("nli-investigation-polygon-category-fill-kidnap:fill-opacity")).toBe(0.55);
  });

  it("reduced-motion GIS category paint stays token opacity when nova narrative toggles", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, NLI_DISPLAY_PROFILES.gis, { surface: "gis" });
    const battle = polygon(100, 500, "נובה", "מרחב לחימה - קרב");
    const kidnap = polygon(104, 500, "נובה", "מוקד חטיפה");
    const data = processedOverlayData([battle, kidnap]);
    renderer.mount();
    renderer.render(frame([500], { motionMode: "reduced" }), data);
    expect(map.paints.get("nli-investigation-polygon-category-fill-battle:fill-opacity")).toBe(0.55);
    expect(map.paints.get("nli-investigation-polygon-category-fill-kidnap:fill-opacity")).toBe(0.55);
    renderer.render(frame([500], { narrativeId: "nova", motionMode: "reduced" }), data);
    expect(map.paints.get("nli-investigation-polygon-category-fill-battle:fill-opacity")).toBe(0.55);
    expect(map.paints.get("nli-investigation-polygon-category-fill-kidnap:fill-opacity")).toBe(0.55);
    renderer.render(frame([500], { motionMode: "reduced" }), data);
    expect(map.paints.get("nli-investigation-polygon-category-fill-battle:fill-opacity")).toBe(0.55);
    expect(map.paints.get("nli-investigation-polygon-category-fill-kidnap:fill-opacity")).toBe(0.55);
  });

  it("non-nova battle fill stays at static reduced-motion opacity", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const battle = polygon(100, 400, "נובה", "מרחב לחימה - קרב");
    renderer.render(frame([400], { motionMode: "reduced" }), processedOverlayData([battle]));
    expect(map.paints.get("nli-investigation-polygon-category-fill-battle:fill-opacity")).toBe(0.55);
  });

  it("does not register style reload listeners", () => {
    const map = makeMap();
    createInvestigationPolygonRenderer(map, {}).mount();
    expect(map.on).not.toHaveBeenCalled();
  });

  it("avoids overlay setData churn but notices in-place feature and index changes", () => {
    const map = makeMap();
    const polygons = [polygon(1, 400)];
    const index = { עלומים: 20 };
    const settlements = [settlement(20)];
    const renderer = createInvestigationPolygonRenderer(map, {}, {
      polygonFeatures: polygons,
      locationToOutlineObjectId: index,
      settlementFeatures: settlements,
    });
    renderer.render(frame([400]), { polygonFeatures: polygons });
    const source = map.sources.get("nli-investigation-settlement-impact");
    expect(source.setData).toHaveBeenCalledTimes(1);
    renderer.render(frame([400]), { polygonFeatures: polygons });
    expect(source.setData).toHaveBeenCalledTimes(1);
    settlements[0].geometry.coordinates[0][0][0] = 35;
    renderer.setData({ polygonFeatures: polygons, settlementFeatures: settlements, dataVersion: 1 });
    expect(source.setData).toHaveBeenCalledTimes(2);
    index.עלומים = 21;
    settlements.push(settlement(21));
    renderer.setData({ polygonFeatures: polygons, locationToOutlineObjectId: index, settlementFeatures: settlements, dataVersion: 2 });
    expect(source.setData).toHaveBeenCalledTimes(3);
  });

  it("replaces the settlement cache instead of retaining stale outline geometries", () => {
    const map = makeMap();
    const polygons = [polygon(1, 400), polygon(2, 410, "בארי")];
    const renderer = createInvestigationPolygonRenderer(map, {}, {
      locationToOutlineObjectId: { עלומים: 20, בארי: 21 },
      settlementFeatures: [settlement(20), settlement(21)],
    });
    renderer.render(frame([400, 410]), { polygonFeatures: polygons });
    renderer.render(frame([400, 410]), {
      polygonFeatures: polygons,
      locationToOutlineObjectId: { עלומים: 20, בארי: 21 },
      settlementFeatures: [settlement(21)],
    });
    const features = map.sources.get("nli-investigation-settlement-impact").setData.mock.calls.at(-1)[0].features;
    expect(features.map((feature) => feature.properties.outlineObjectId)).toEqual([21]);
  });

  it("does not fall back to retained settlement features for an explicit outline index", () => {
    const map = makeMap();
    const polygons = [polygon(1, 400), polygon(2, 410, "בארי")];
    const renderer = createInvestigationPolygonRenderer(map, {}, {
      locationToOutlineObjectId: { עלומים: 20, בארי: 21 },
      settlementFeatures: [settlement(20), settlement(21)],
      settlementFeaturesByOutlineId: { 20: settlement(20) },
    });
    renderer.render(frame([400, 410]), { polygonFeatures: polygons });
    renderer.render(frame([400, 410]), {
      polygonFeatures: polygons,
      locationToOutlineObjectId: { עלומים: 20, בארי: 21 },
      settlementFeatures: [settlement(20), settlement(21)],
      settlementFeaturesByOutlineId: { 20: settlement(20) },
    });
    const features = map.sources.get("nli-investigation-settlement-impact").setData.mock.calls.at(-1)[0].features;
    expect(features.map((feature) => feature.properties.outlineObjectId)).toEqual([20]);
  });

  it("resolves numeric and string keys in outline Maps", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {}, {
      locationToOutlineObjectId: new Map([["עלומים", 20]]),
      settlementFeaturesByOutlineId: new Map([[20, settlement(20)]]),
    });
    renderer.render(frame([400]), { polygonFeatures: [polygon(1, 400)] });
    expect(map.sources.get("nli-investigation-settlement-impact").setData.mock.calls.at(-1)[0].features)
      .toHaveLength(1);
    const stringMap = new Map([["20", settlement(20)]]);
    const secondMap = makeMap();
    const secondRenderer = createInvestigationPolygonRenderer(secondMap, {}, {
      locationToOutlineObjectId: new Map([["עלומים", 20]]),
      settlementFeaturesByOutlineId: stringMap,
    });
    secondRenderer.render(frame([400]), { polygonFeatures: [polygon(1, 400)] });
    expect(secondMap.sources.get("nli-investigation-settlement-impact").setData.mock.calls.at(-1)[0].features)
      .toHaveLength(1);
  });

  it("detects in-place Map index mutations through explicit setData", () => {
    const map = makeMap();
    const locationIndex = new Map([["עלומים", 20]]);
    const outlines = new Map([[20, settlement(20)], [21, settlement(21)]]);
    const renderer = createInvestigationPolygonRenderer(map, {}, {
      locationToOutlineObjectId: locationIndex,
      settlementFeaturesByOutlineId: outlines,
    });
    const features = [polygon(1, 400)];
    renderer.render(frame([400]), { polygonFeatures: features, dataVersion: 1 });
    const source = map.sources.get("nli-investigation-settlement-impact");
    expect(source.setData).toHaveBeenCalledTimes(1);
    renderer.render(frame([400]), { polygonFeatures: features });
    expect(source.setData).toHaveBeenCalledTimes(1);
    locationIndex.set("עלומים", 21);
    renderer.setData({ polygonFeatures: features, dataVersion: 2 });
    expect(source.setData).toHaveBeenCalledTimes(2);
  });

  it("rebuilds retained Map indexes when only the explicit dataVersion changes", () => {
    const map = makeMap();
    const locationIndex = new Map([["עלומים", 20]]);
    const outlines = new Map([[20, settlement(20)], [21, settlement(21)]]);
    const features = [polygon(1, 400)];
    const renderer = createInvestigationPolygonRenderer(map, {}, {
      polygonFeatures: features,
      locationToOutlineObjectId: locationIndex,
      settlementFeaturesByOutlineId: outlines,
    });
    renderer.render(frame([400]), { dataVersion: 1 });
    const source = map.sources.get("nli-investigation-settlement-impact");
    expect(source.setData.mock.calls.at(-1)[0].features[0].properties.outlineObjectId).toBe(20);
    locationIndex.set("עלומים", 21);
    renderer.render(frame([400]), { dataVersion: 2 });
    expect(source.setData.mock.calls.at(-1)[0].features[0].properties.outlineObjectId).toBe(21);
  });

  it("does not scan styles or repaint on an unchanged ambient frame", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const features = [polygon(1, 400)];
    renderer.render(frame([400]), { polygonFeatures: features });
    map.getStyle.mockClear();
    map.setPaintProperty.mockClear();
    const source = map.sources.get("nli-investigation-settlement-impact");
    source.setData.mockClear();
    renderer.render(frame([400]), { polygonFeatures: features });
    expect(map.getStyle).not.toHaveBeenCalled();
    expect(map.setPaintProperty).not.toHaveBeenCalled();
    expect(source.setData).not.toHaveBeenCalled();
  });

  it("does not reconcile unchanged full injected registries on ambient frames", () => {
    const map = makeMap();
    const features = [polygon(1, 400)];
    const locationIndex = { עלומים: 20 };
    const settlements = [settlement(20)];
    const data = {
      polygonFeatures: features,
      locationToOutlineObjectId: locationIndex,
      settlementFeatures: settlements,
    };
    const renderer = createInvestigationPolygonRenderer(map, {});
    renderer.render(frame([400]), data);
    const source = map.sources.get("nli-investigation-settlement-impact");
    source.setData.mockClear();
    map.getStyle.mockClear();
    map.setPaintProperty.mockClear();
    renderer.render(frame([400]), data);
    expect(source.setData).not.toHaveBeenCalled();
    expect(map.getStyle).not.toHaveBeenCalled();
    expect(map.setPaintProperty).not.toHaveBeenCalled();
  });

  it("reconciles an immutable registry only when its explicit dataVersion changes", () => {
    const map = makeMap();
    const features = [polygon(1, 400)];
    const renderer = createInvestigationPolygonRenderer(map, {}, {
      locationToOutlineObjectId: { עלומים: 20 },
      settlementFeatures: [settlement(20)],
    });
    renderer.render(frame([400]), { polygonFeatures: features, dataVersion: 1 });
    const source = map.sources.get("nli-investigation-settlement-impact");
    expect(source.setData).toHaveBeenCalledTimes(1);
    renderer.render(frame([400]), { polygonFeatures: features, dataVersion: 1 });
    expect(source.setData).toHaveBeenCalledTimes(1);
    renderer.render(frame([400]), { polygonFeatures: features, dataVersion: 2 });
    expect(source.setData).toHaveBeenCalledTimes(2);
  });

  it("uses a stable anchor and keeps impact outlines above base polygon layers", () => {
    const map = makeMap();
    map.layers.push({ id: "labels", type: "symbol", source: "labels" });
    const renderer = createInvestigationPolygonRenderer(map, {}, { beforeId: "labels" });
    renderer.render(frame([400]), { polygonFeatures: [polygon(1, 400)], settlementFeatures: [settlement(20)], locationToOutlineObjectId: { עלומים: 20 } });
    const impactIndex = map.layers.findIndex((layer) => layer.id === "nli-investigation-settlement-impact-outline");
    const baseIndex = map.layers.findIndex((layer) => layer.id.includes("investigation_polygons"));
    const labelsIndex = map.layers.findIndex((layer) => layer.id === "labels");
    expect(impactIndex).toBeGreaterThan(baseIndex);
    expect(impactIndex).toBeLessThan(labelsIndex);
    expect(map.addLayer.mock.calls.at(-1)[1]).toBe("labels");
  });

  it("keeps the settlement impact outline above category fills after lines-then-polygons mount", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const data = {
      ...processedOverlayData([polygon(1, 400, "עלומים", "מרחב לחימה - קרב")]),
      settlementFeatures: [settlement(20)],
      settlementFeaturesByOutlineId: { 20: settlement(20) },
    };
    renderer.renderSettlement(frame([], {
      achievedSettlementOutlineIds: [20],
    }), data);
    renderer.render(frame([400], { achievedSettlementOutlineIds: [20] }), data);
    const impactIndex = map.layers.findIndex((layer) => layer.id === "nli-investigation-settlement-impact-outline");
    const fillIndex = map.layers.findIndex((layer) => layer.id === "nli-investigation-polygon-category-fill-battle");
    expect(fillIndex).toBeGreaterThanOrEqual(0);
    expect(impactIndex).toBeGreaterThan(fillIndex);
  });

  it("re-raises owned overlays above a pack layer after an unchanged-frame render", () => {
    const map = makeMap();
    map.layers.push({ id: "projector_base__רקע_שחור__fill__0", type: "fill", source: "projector_base.רקע_שחור" });
    const renderer = createInvestigationPolygonRenderer(map, {});
    const data = {
      ...processedOverlayData([polygon(1, 400, "עלומים", "מרחב לחימה - קרב")]),
      settlementFeatures: [settlement(20)],
      settlementFeaturesByOutlineId: { 20: settlement(20) },
    };
    renderer.render(frame([400], { achievedSettlementOutlineIds: [20] }), data);
    map.moveLayer("projector_base__רקע_שחור__fill__0");
    const blackIndexAfterRaise = map.layers.findIndex((layer) => layer.id === "projector_base__רקע_שחור__fill__0");
    const impactBefore = map.layers.findIndex((layer) => layer.id === "nli-investigation-settlement-impact-outline");
    expect(blackIndexAfterRaise).toBeGreaterThan(impactBefore);
    renderer.render(frame([400], { achievedSettlementOutlineIds: [20] }), data);
    const impactAfter = map.layers.findIndex((layer) => layer.id === "nli-investigation-settlement-impact-outline");
    const fillAfter = map.layers.findIndex((layer) => layer.id === "nli-investigation-polygon-category-fill-battle");
    const blackAfter = map.layers.findIndex((layer) => layer.id === "projector_base__רקע_שחור__fill__0");
    expect(impactAfter).toBeGreaterThan(fillAfter);
    expect(impactAfter).toBeGreaterThan(blackAfter);
  });

  it("re-hides raw host polygons after an external retained-layer restore on an unchanged frame", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const currentFrame = frame([400]);
    const hostage = polygon(1, 400, "עלומים", "מוקד חטיפה");
    const data = processedOverlayData([hostage]);

    renderer.render(currentFrame, data);
    map.setLayoutProperty.mockClear();
    map.setLayoutProperty("nli__investigation_polygons__fill__0", "visibility", "visible");
    map.setLayoutProperty("nli__investigation_polygons__line__1", "visibility", "visible");

    renderer.render(currentFrame, data);

    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      "nli__investigation_polygons__fill__0", "visibility", "none",
    );
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      "nli__investigation_polygons__line__1", "visibility", "none",
    );
    expect(map.getLayoutProperty("nli__investigation_polygons__fill__0", "visibility")).toBe("none");
    expect(map.getLayoutProperty("nli__investigation_polygons__line__1", "visibility")).toBe("none");
    expect(map.getLayoutProperty("nli-investigation-polygon-category-fill-kidnap", "visibility")).toBe("visible");
  });

  it("reset removes owned state without restoring raw host visibility", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    renderer.mount();
    renderer.render(frame([400]), { polygonFeatures: [polygon(1, 400)] });
    map.setLayoutProperty.mockClear();
    renderer.reset();
    expect(map.setLayoutProperty).not.toHaveBeenCalledWith(
      "nli__investigation_polygons__fill__0", "visibility", "visible",
    );
    expect(map.setLayoutProperty).not.toHaveBeenCalledWith(
      "nli__investigation_polygons__line__1", "visibility", "visible",
    );
    expect(map.getLayoutProperty("nli__investigation_polygons__fill__0", "visibility")).toBe("none");
    expect(map.getLayoutProperty("nli__investigation_polygons__line__1", "visibility")).toBe("none");
    expect(map.paints.get("nli__investigation_polygons__fill__0:fill-color")).not.toBe("#f79009");
    expect(map.getSource("nli-investigation-settlement-impact")).toBeNull();
    expect(map.getSource("nli-investigation-polygon-category")).toBeNull();
  });

  it("dispose removes owned state without restoring raw host visibility", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    renderer.mount();
    renderer.render(frame([400]), { polygonFeatures: [polygon(1, 400)] });
    map.setLayoutProperty.mockClear();
    renderer.dispose();
    expect(map.setLayoutProperty).not.toHaveBeenCalledWith(
      "nli__investigation_polygons__fill__0", "visibility", "visible",
    );
    expect(map.setLayoutProperty).not.toHaveBeenCalledWith(
      "nli__investigation_polygons__line__1", "visibility", "visible",
    );
    expect(map.getLayoutProperty("nli__investigation_polygons__fill__0", "visibility")).toBe("none");
    expect(map.getLayoutProperty("nli__investigation_polygons__line__1", "visibility")).toBe("none");
    expect(map.getSource("nli-investigation-settlement-impact")).toBeNull();
    expect(map.getSource("nli-investigation-polygon-category")).toBeNull();
    expect(map.sources.size).toBe(0);
    expect(map.layers.map((layer) => layer.id)).toEqual([
      "nli__investigation_polygons__fill__0",
      "nli__investigation_polygons__line__1",
    ]);
  });

  it("preserves semantic host paints while removing the settlement overlay", () => {
    const map = makeMap();
    const data = processedOverlayData([polygon(1, 400)], {
      locationToOutlineObjectId: { עלומים: 20 },
      settlementFeatures: [settlement(20)],
    });
    const renderer = createInvestigationPolygonRenderer(map, {});
    renderer.render(frame([400]), data);
    map.setPaintProperty.mockClear();

    renderer.reset({ preserveBasePaints: true });

    expect(map.setPaintProperty).not.toHaveBeenCalled();
    expect(map.getSource("nli-investigation-settlement-impact")).toBeNull();
    renderer.render(frame([400]), data);
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      "nli__investigation_polygons__fill__0",
      "visibility",
      "none",
    );
    expect(map.getSource("nli-investigation-polygon-category")).not.toBeNull();
    expect(map.getSource("nli-investigation-settlement-impact")).not.toBeNull();
  });

  it("rehydrates the same injected registries after reset and replay", () => {
    const map = makeMap();
    const features = [polygon(1, 400)];
    const data = {
      polygonFeatures: features,
      locationToOutlineObjectId: { עלומים: 20 },
      settlementFeatures: [settlement(20)],
    };
    const renderer = createInvestigationPolygonRenderer(map, {});
    renderer.render(frame([400]), data);
    renderer.reset();
    renderer.render(frame([400]), data);
    expect(map.sources.get("nli-investigation-settlement-impact").setData.mock.calls.at(-1)[0].features)
      .toHaveLength(1);
  });

  it("makes reset a no-op before mount and after an already reset renderer", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    renderer.reset();
    renderer.reset();
    expect(map.getStyle).not.toHaveBeenCalled();
    expect(map.setPaintProperty).not.toHaveBeenCalled();
    expect(map.removeLayer).not.toHaveBeenCalled();
    expect(map.removeSource).not.toHaveBeenCalled();
  });
});
