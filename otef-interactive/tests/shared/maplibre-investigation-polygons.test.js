import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createInvestigationPolygonRenderer } from "../../frontend/src/shared/maplibre-investigation-polygons.js";
import { deriveInvestigationFrame } from "../../frontend/src/shared/nli-investigation-visual-state.js";
import { idleNliClock } from "../../frontend/src/shared/nli-investigation-clock.js";
import { INVESTIGATION_POLYGONS_FULL_ID } from "../../frontend/src/shared/nli-investigation-beats.js";
import { NLI_DISPLAY_PROFILES } from "../../frontend/src/shared/nli-investigation-theme.js";
import { buildInvestigationSettlementIndexes } from "../../frontend/src/shared/nli-investigation-timeline-data.js";


const SETTLEMENTS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../public/processed/layers/nli/investigation_settlements.geojson",
);

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
    setLayoutProperty: vi.fn(),
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

describe("investigation polygon renderer", () => {
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
    renderer.render(frame([400]), {
      polygonFeatures: [polygon(1, 400), polygon(2, 420)],
    });
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

  it("filters category layers by Notes", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const battle = polygon(1, 400);
    battle.properties.Notes = "מרחב לחימה - קרב";
    renderer.render(frame([400]), { polygonFeatures: [battle] });
    const fill = map.addLayer.mock.calls.find(([layer]) => layer.id.includes("battle") && layer.type === "fill")[0];
    expect(fill.filter).toEqual(["==", ["get", "Notes"], "מרחב לחימה - קרב"]);
  });

  it("battle outline uses completed-route line-gradient phase-step, not dashoffset", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const battle = polygon(1, 400);
    battle.properties.Notes = "מרחב לחימה - קרב";
    renderer.render(frame([400], { motionMode: "full" }), { polygonFeatures: [battle] });
    const outline = map.addLayer.mock.calls.find(([layer]) => layer.id.includes("battle") && layer.type === "line")[0];
    expect(outline.source).toBe("nli-investigation-polygon-category-outline");
    expect(outline.paint["line-gradient"]).toBeTruthy();
    expect(outline.paint["line-dasharray"]).toBeUndefined();
    expect(JSON.stringify(outline.paint["line-gradient"])).toContain("line-progress");
  });

  it("advances battle fill-opacity and line-gradient when nowMs changes", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const battle = polygon(1, 400, "עלומים", "מרחב לחימה - קרב");
    const data = { polygonFeatures: [battle] };
    const options = { motionMode: "full", storyBeats: [400], polygonMotionActive: true };
    const at0 = deriveInvestigationFrame(idleNliClock(), 0, [INVESTIGATION_POLYGONS_FULL_ID], options);
    const atHalfPeriod = deriveInvestigationFrame(idleNliClock(), 2000, [INVESTIGATION_POLYGONS_FULL_ID], options);
    renderer.render(at0, data);
    const opacity0 = map.paints.get("nli-investigation-polygon-category-fill-battle:fill-opacity");
    const gradient0 = map.paints.get("nli-investigation-polygon-category-line-battle:line-gradient");
    renderer.render(atHalfPeriod, data);
    expect(map.paints.get("nli-investigation-polygon-category-fill-battle:fill-opacity")).not.toEqual(opacity0);
    expect(map.paints.get("nli-investigation-polygon-category-line-battle:line-gradient")).not.toEqual(gradient0);
  });

  it("writes closed LineString rings to the outline source with lineMetrics", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const open = polygon(1, 400, "עלומים", "מרחב לחימה - קרב");
    open.geometry.coordinates[0] = [[34, 31], [34.01, 31], [34.01, 31.01]];
    renderer.render(frame([400]), { polygonFeatures: [open] });
    const spec = map.addSource.mock.calls.find(([id]) => id === "nli-investigation-polygon-category-outline")[1];
    expect(spec.lineMetrics).toBe(true);
    const outline = map.sources.get("nli-investigation-polygon-category-outline");
    const feats = outline.setData.mock.calls.at(-1)[0].features;
    expect(feats[0].geometry.type).toBe("LineString");
    const coords = feats[0].geometry.coordinates;
    expect(coords[0]).toEqual(coords[coords.length - 1]);
  });

  it("warns once per distinct unmatched Notes string", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unknownA = polygon(1, 400, "עלומים", "לא ידוע");
    const unknownB = polygon(2, 400, "עלומים", "לא ידוע");
    renderer.render(frame([400]), { polygonFeatures: [unknownA, unknownB] });
    const fallback = map.addLayer.mock.calls.find(([layer]) => layer.id.includes("fallback") && layer.type === "fill")[0];
    expect(fallback.paint["fill-color"]).toBe("#9a9a9a");
    expect(warn).toHaveBeenCalledTimes(1);
    renderer.render(frame([400]), { polygonFeatures: [unknownA, unknownB] });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("keeps achieved polygons in the overlay and drops later achievements on backward seek", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const features = [polygon(1, 400), polygon(2, 420)];
    renderer.render(frame([400, 420]), { polygonFeatures: features });
    renderer.render(frame([400]), { polygonFeatures: features });
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

  it("lights Nova outline 100 in infiltration red without using Reim 18", () => {
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
    renderer.render(frame([], { narrativeId: "nova", motionMode: "reduced" }), {
      polygonFeatures: [site],
    });
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
    renderer.render(frame([], { narrativeId: "nova", motionMode: "reduced" }), {
      polygonFeatures: [site],
    });
    expect(map.getLayer("nli-nova-site-outline")).toBeFalsy();
    expect(map.getLayer("nli-investigation-polygon-category-line-battle-nova-site")).toBeFalsy();
  });

  it("GIS nova play at minute 500 keeps 100 off category fill and outline", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, NLI_DISPLAY_PROFILES.gis, { surface: "gis" });
    const site = polygon(100, 500, "נובה", "מרחב לחימה - קרב");
    const west = polygon(107, 480, "שדות ממערב לנובה", "מרחב לחימה - קרב");
    renderer.mount();
    renderer.render(frame([480, 500], { narrativeId: "nova", motionMode: "reduced" }), {
      polygonFeatures: [site, west],
    });
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
    renderer.render(frame([480, 500], { narrativeId: "nova", motionMode: "reduced" }), {
      polygonFeatures: [site, west],
    });
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
    }), { polygonFeatures: [site, west] });
    expect(map.getLayer("nli-nova-site-outline")).toBeFalsy();
  });

  it("non-nova play still fills polygon 100", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, NLI_DISPLAY_PROFILES.gis, { surface: "gis" });
    const site = polygon(100, 500, "נובה", "מרחב לחימה - קרב");
    renderer.mount();
    renderer.render(frame([500], { motionMode: "reduced" }), {
      polygonFeatures: [site],
    });
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
    renderer.render(frame([500], { narrativeId: "nova", motionMode: "reduced" }), {
      polygonFeatures: [kidnapCallout, kidnapOther],
    });
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
    const data = { polygonFeatures: [battle, kidnap] };
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

  it("non-nova battle fill stays a scalar oscillated opacity", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    const battle = polygon(100, 400, "נובה", "מרחב לחימה - קרב");
    renderer.render(frame([400], { motionMode: "reduced" }), { polygonFeatures: [battle] });
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

  it("reset restores host visibility without orange paints and dispose removes owned state", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    renderer.mount();
    renderer.render(frame([400]), { polygonFeatures: [polygon(1, 400)] });
    renderer.reset();
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      "nli__investigation_polygons__fill__0",
      "visibility",
      "visible",
    );
    expect(map.paints.get("nli__investigation_polygons__fill__0:fill-color")).not.toBe("#f79009");
    expect(map.getSource("nli-investigation-settlement-impact")).toBeNull();
    expect(map.getSource("nli-investigation-polygon-category")).toBeNull();
    renderer.dispose();
    expect(map.sources.size).toBe(0);
    expect(map.layers.map((layer) => layer.id)).toEqual([
      "nli__investigation_polygons__fill__0",
      "nli__investigation_polygons__line__1",
    ]);
  });

  it("keeps host pack hidden when reset is caused by the polygons row becoming disabled", () => {
    const map = makeMap();
    const renderer = createInvestigationPolygonRenderer(map, {});
    renderer.render(frame([400]), { polygonFeatures: [polygon(1, 400)] });
    map.setLayoutProperty.mockClear();
    renderer.reset({ restoreHostVisibility: false });
    expect(map.setLayoutProperty).not.toHaveBeenCalledWith(
      "nli__investigation_polygons__fill__0",
      "visibility",
      "visible",
    );
    expect(map.setLayoutProperty).not.toHaveBeenCalledWith(
      "nli__investigation_polygons__line__1",
      "visibility",
      "visible",
    );
    expect(map.getSource("nli-investigation-polygon-category")).toBeNull();
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
