import { describe, expect, it, vi } from "vitest";
import { createInvestigationPolygonRenderer } from "../../frontend/src/shared/maplibre-investigation-polygons.js";

function makeMap() {
  const layers = [
    { id: "nli__investigation_polygons__fill__0", type: "fill", source: "nli__investigation_polygons" },
    { id: "nli__investigation_polygons__line__1", type: "line", source: "nli__investigation_polygons" },
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
    removeSource: vi.fn((id) => sources.delete(id)),
    removeLayer: vi.fn((id) => {
      const index = layers.findIndex((layer) => layer.id === id);
      if (index >= 0) layers.splice(index, 1);
    }),
    getPaintProperty: vi.fn((id, key) => paints.get(`${id}:${key}`)),
    setPaintProperty: vi.fn((id, key, value) => paints.set(`${id}:${key}`, value)),
    on: vi.fn(),
  };
}

const polygon = (objectId, minutes, location = "עלומים") => ({
  type: "Feature",
  properties: { OBJECTID: objectId, timeline_minutes: minutes, מיקום: location },
  geometry: { type: "Polygon", coordinates: [[[34, 31], [34.01, 31], [34.01, 31.01], [34, 31]]] },
});

const settlement = (outlineObjectId, coordinates = [[[34, 31], [34.02, 31], [34.02, 31.02], [34, 31]]]) => ({
  type: "Feature",
  id: `settlement-${outlineObjectId}`,
  properties: { OBJECTID: outlineObjectId, outlineObjectId },
  geometry: { type: "Polygon", coordinates },
});

const frame = (achievedPolygonBeats) => ({ achievedPolygonBeats, narrative: { phase: "playing" } });

describe("investigation polygon renderer", () => {
  it("renders future polygons orange and turns polygons red at beat start", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, { lineWidthMultiplier: 1 });
    const features = [polygon(1, 400), polygon(2, 420)];

    renderer.render(frame([]), { polygonFeatures: features });
    expect(JSON.stringify(map.paints.get("nli__investigation_polygons__fill__0:fill-color"))).toContain("#f79009");

    renderer.render(frame([400]), { polygonFeatures: features });
    const activeColor = map.paints.get("nli__investigation_polygons__fill__0:fill-color");
    expect(JSON.stringify(activeColor)).toContain("#c31f4f");
  });

  it("keeps achieved polygons red and removes later achievements on backward seek", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const features = [polygon(1, 400), polygon(2, 420)];
    renderer.render(frame([400, 420]), { polygonFeatures: features });
    renderer.render(frame([400]), { polygonFeatures: features });
    expect(JSON.stringify(map.paints.get("nli__investigation_polygons__fill__0:fill-color")))
      .toContain("400");
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

  it("reset restores explicit orange styles and dispose removes owned state", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    renderer.mount();
    renderer.render(frame([400]), { polygonFeatures: [polygon(1, 400)] });
    renderer.reset();
    expect(map.paints.get("nli__investigation_polygons__fill__0:fill-color")).toBe("#f79009");
    expect(map.getSource("nli-investigation-settlement-impact")).toBeNull();
    renderer.dispose();
    expect(map.sources.size).toBe(0);
    expect(map.layers.map((layer) => layer.id)).toEqual([
      "nli__investigation_polygons__fill__0",
      "nli__investigation_polygons__line__1",
    ]);
  });

  it("preserves semantic host paints while removing the settlement overlay", () => {
    const map = makeMap();
    const data = {
      polygonFeatures: [polygon(1, 400)],
      locationToOutlineObjectId: { עלומים: 20 },
      settlementFeatures: [settlement(20)],
    };
    const renderer = createInvestigationPolygonRenderer(map, {});
    renderer.render(frame([400]), data);
    map.setPaintProperty.mockClear();

    renderer.reset({ preserveBasePaints: true });

    expect(map.setPaintProperty).not.toHaveBeenCalled();
    expect(map.getSource("nli-investigation-settlement-impact")).toBeNull();
    renderer.render(frame([400]), data);
    expect(JSON.stringify(map.paints.get("nli__investigation_polygons__fill__0:fill-color"))).toContain("#c31f4f");
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
