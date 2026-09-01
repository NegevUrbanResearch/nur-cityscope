import { describe, expect, it, vi } from "vitest";
import { createExpression, latest } from "@maplibre/maplibre-gl-style-spec";
import {
  createInvestigationLineRenderer,
  orientInvestigationLineFeature,
} from "../../frontend/src/shared/maplibre-investigation-lines.js";

function makeMap() {
  const layers = [];
  const sources = new Map();
  const paints = new Map();
  return {
    layers,
    sources,
    paints,
    getStyle: vi.fn(() => ({ layers })),
    getSource: vi.fn((id) => sources.get(id) || null),
    getLayer: vi.fn((id) => layers.find((layer) => layer.id === id) || null),
    addSource: vi.fn((id, spec) => sources.set(id, { ...spec, setData: vi.fn() })),
    addLayer: vi.fn((layer) => layers.push(layer)),
    removeSource: vi.fn((id) => sources.delete(id)),
    removeLayer: vi.fn((id) => {
      const index = layers.findIndex((layer) => layer.id === id);
      if (index >= 0) layers.splice(index, 1);
    }),
    setPaintProperty: vi.fn((id, key, value) => paints.set(`${id}:${key}`, value)),
    on: vi.fn(),
  };
}

const line = (objectId, timelineMinutes, coordinates, flow_direction = "forward") => ({
  type: "Feature",
  properties: { OBJECTID: objectId, timeline_minutes: timelineMinutes, flow_direction },
  geometry: { type: "LineString", coordinates },
});

describe("investigation line renderer", () => {
  it("mounts stable future, carrier, flowing line, active, and head overlays", () => {
    const map = makeMap();
    const renderer = createInvestigationLineRenderer(map, { lineWidthMultiplier: 1 });

    renderer.mount();

    expect(map.addSource.mock.calls.map(([id]) => id)).toEqual([
      "nli-investigation-line-future",
      "nli-investigation-line-completed-carrier",
      "nli-investigation-line-completed-motion",
      "nli-investigation-line-active",
      "nli-investigation-line-head",
    ]);
    const activeSource = map.addSource.mock.calls.find(([id]) => id === "nli-investigation-line-active");
    expect(activeSource[1].lineMetrics).toBe(true);
    const flowSource = map.addSource.mock.calls.find(([id]) => id === "nli-investigation-line-completed-motion");
    expect(flowSource[1].lineMetrics).toBe(true);
    const flowLayer = map.addLayer.mock.calls.find(([layer]) => layer.id === "nli-investigation-line-completed-motion-line")[0];
    expect(flowLayer.type).toBe("line");
    expect(flowLayer.paint["line-gradient"]).toEqual(expect.any(Array));
    const futureLayer = map.addLayer.mock.calls.find(([layer]) => layer.id === "nli-investigation-line-future-line")[0];
    expect(futureLayer.paint["line-color"]).toBe("#c31f4f");
    expect(map.addLayer.mock.calls.map(([layer]) => layer.id)).toEqual([
      "nli-investigation-line-future-line",
      "nli-investigation-line-completed-carrier-line",
      "nli-investigation-line-completed-motion-line",
      "nli-investigation-line-active-line",
      "nli-investigation-line-head-circle",
    ]);
  });

  it("emits a completed-motion gradient accepted by the installed MapLibre style spec", () => {
    const map = makeMap();
    const renderer = createInvestigationLineRenderer(map, "gis");

    renderer.mount();

    const flowLayer = map.addLayer.mock.calls
      .find(([layer]) => layer.id === "nli-investigation-line-completed-motion-line")[0];
    const parsed = createExpression(
      flowLayer.paint["line-gradient"],
      latest.paint_line["line-gradient"],
    );

    expect(parsed.result).toBe("success");
    expect(flowLayer.paint["line-gradient"]).toEqual([
      "case",
      ["<", ["%", ["+", ["*", ["line-progress"], 8], ["-", 1, 0]], 1], 0.45],
      "#000000",
      "rgba(0, 0, 0, 0)",
    ]);
  });

  it("does not register a style reload listener", () => {
    const map = makeMap();
    createInvestigationLineRenderer(map, {});
    expect(map.on).not.toHaveBeenCalled();
  });

  it("renders every route state in the red family and shares cached line geometry", () => {
    const map = makeMap();
    const renderer = createInvestigationLineRenderer(map, { lineWidthMultiplier: 1 });
    const future = [line(1, 400, [[34, 31], [35, 32]])];

    renderer.render(
      {
        activeProgress: 0,
        completedRouteFlow: { active: true, progress: 0.25 },
        motionMode: "full",
      },
      {
        futureFeatures: future,
        completedFeatures: [line(2, 420, [[34, 32], [35, 33]])],
        activeFeatures: [line(3, 440, [[34, 33], [35, 34]])],
      },
    );

    const futureData = map.sources.get("nli-investigation-line-future").setData.mock.calls.at(-1)[0];
    const carrierData = map.sources.get("nli-investigation-line-completed-carrier").setData.mock.calls.at(-1)[0];
    const flowData = map.sources.get("nli-investigation-line-completed-motion").setData.mock.calls.at(-1)[0];
    expect(futureData.features[0].geometry.coordinates).toEqual(future[0].geometry.coordinates);
    expect(carrierData.features[0].properties.OBJECTID).toBe(2);
    expect(flowData).toEqual(carrierData);
    expect(map.paints.get("nli-investigation-line-future-line:line-color")).toBe("#c31f4f");
    expect(map.paints.get("nli-investigation-line-completed-carrier-line:line-color")).toBe("#c31f4f");
    expect(map.paints.get("nli-investigation-line-active-line:line-gradient")).toEqual(expect.arrayContaining(["#c31f4f"]));
    expect(map.paints.get("nli-investigation-line-completed-motion-line:line-color")).toBe("#000000");
    expect(flowData.features.every((feature) => feature.geometry.type === "LineString")).toBe(true);
  });

  it("keeps a revealing route red and advances its head through 3.2 seconds", () => {
    const map = makeMap();
    const renderer = createInvestigationLineRenderer(map, {});
    const active = line(4, 410, [[0, 0], [10, 0]]);

    renderer.render(
      { activeProgress: 0.5, completedRouteFlow: { active: false, phase: 0 }, motionMode: "full" },
      { futureFeatures: [active], completedFeatures: [], activeFeatures: [active] },
    );

    const gradient = map.paints.get("nli-investigation-line-active-line:line-gradient");
    expect(JSON.stringify(gradient)).toContain("#c31f4f");
    expect(map.sources.get("nli-investigation-line-head").setData.mock.calls.at(-1)[0].features[0].geometry.coordinates).toEqual([5, 0]);
    expect(map.sources.get("nli-investigation-line-completed-carrier").setData.mock.calls.at(-1)[0].features).toEqual([]);
  });

  it("reverses only reviewed reverse geometry and uses static reduced-motion dashes", () => {
    const reverse = line(2, 420, [[35, 32], [34, 31]], "reverse");
    const forward = line(3, 420, [[35, 32], [34, 31]], "forward");
    expect(orientInvestigationLineFeature(reverse).geometry.coordinates).toEqual([[34, 31], [35, 32]]);
    expect(orientInvestigationLineFeature(forward).geometry.coordinates).toEqual([[35, 32], [34, 31]]);

    const map = makeMap();
    const renderer = createInvestigationLineRenderer(map, { lineWidthMultiplier: 1 });
    renderer.render(
      { activeProgress: 1, completedRouteFlow: { active: false, progress: 0 }, motionMode: "reduced" },
      { futureFeatures: [], completedFeatures: [reverse], activeFeatures: [] },
    );
    const firstGradient = map.paints.get("nli-investigation-line-completed-motion-line:line-gradient");
    const first = map.sources.get("nli-investigation-line-completed-motion").setData.mock.calls.at(-1)[0];
    renderer.render(
      { activeProgress: 1, completedRouteFlow: { active: false, progress: 0.8 }, motionMode: "reduced" },
      { futureFeatures: [], completedFeatures: [reverse], activeFeatures: [] },
    );
    const secondGradient = map.paints.get("nli-investigation-line-completed-motion-line:line-gradient");
    const second = map.sources.get("nli-investigation-line-completed-motion").setData.mock.calls.at(-1)[0];
    expect(second).toBe(first);
    expect(secondGradient).toEqual(firstGradient);
    expect(map.paints.get("nli-investigation-line-completed-carrier-line:line-color")).toBe("#c31f4f");
  });

  it("reverses multipart route parts and their order for reviewed reverse flow", () => {
    const feature = line(5, 420, [[35, 32], [34, 31]], "reverse");
    feature.geometry = {
      type: "MultiLineString",
      coordinates: [
        [[35, 32], [34, 31]],
        [[37, 34], [36, 33]],
      ],
    };
    expect(orientInvestigationLineFeature(feature).geometry.coordinates).toEqual([
      [[36, 33], [37, 34]],
      [[34, 31], [35, 32]],
    ]);

    const map = makeMap();
    const renderer = createInvestigationLineRenderer(map, {});
    const multipart = line(6, 420, [[0, 0], [1, 0]], "forward");
    multipart.geometry = {
      type: "MultiLineString",
      coordinates: [
        [[0, 0], [1, 0]],
        [[0, 0], [10, 0], [20, 0]],
      ],
    };
    renderer.render(
      { activeProgress: 0.5, completedRouteFlow: { active: false, phase: 0 }, motionMode: "full" },
      { futureFeatures: [], completedFeatures: [], activeFeatures: [multipart] },
    );
    expect(map.sources.get("nli-investigation-line-head").setData.mock.calls.at(-1)[0].features[0].geometry.coordinates)
      .toEqual([10, 0]);

    const completedMultipart = line(8, 420, [[0, 0], [1, 0]], "forward");
    completedMultipart.geometry = {
      type: "MultiLineString",
      coordinates: [
        [[0, 0], [10, 0]],
        [[0, 10], [10, 10]],
      ],
    };
    renderer.render(
      { activeProgress: 1, completedRouteFlow: { active: true, progress: 0.25 }, motionMode: "full" },
      { futureFeatures: [], completedFeatures: [completedMultipart], activeFeatures: [] },
    );
    const flowData = map.sources.get("nli-investigation-line-completed-motion").setData.mock.calls.at(-1)[0];
    expect(flowData.features).toHaveLength(1);
    expect(flowData.features[0].geometry.type).toBe("MultiLineString");
    renderer.dispose();
  });

  it("uses the shared renderer and reviewed multipart direction in both display profiles", () => {
    const reverse = line(11, 420, [[35, 32], [34, 31]], "reverse");
    reverse.geometry = {
      type: "MultiLineString",
      coordinates: [
        [[35, 32], [34, 31]],
        [[37, 34], [36, 33]],
      ],
    };
    const forward = line(12, 420, [[35, 32], [34, 31]], "forward");
    forward.geometry = {
      type: "MultiLineString",
      coordinates: [
        [[30, 30], [31, 30]],
        [[32, 32], [33, 32]],
      ],
    };

    const maps = ["gis", "projection"].map((profile) => {
      const map = makeMap();
      const renderer = createInvestigationLineRenderer(map, profile);
      renderer.render(
        { activeProgress: 1, completedRouteFlow: { active: true, progress: 0.25 }, motionMode: "full" },
        { futureFeatures: [], completedFeatures: [reverse, forward], activeFeatures: [] },
      );
      return map;
    });

    const gisFlow = maps[0].sources.get("nli-investigation-line-completed-motion").setData.mock.calls.at(-1)[0];
    const projectionFlow = maps[1].sources.get("nli-investigation-line-completed-motion").setData.mock.calls.at(-1)[0];
    expect(gisFlow.features.map((feature) => feature.geometry.coordinates)).toEqual([
      [[[36, 33], [37, 34]], [[34, 31], [35, 32]]],
      [[[30, 30], [31, 30]], [[32, 32], [33, 32]]],
    ]);
    expect(projectionFlow.features.map((feature) => feature.geometry.coordinates)).toEqual(
      gisFlow.features.map((feature) => feature.geometry.coordinates),
    );
    expect(maps[1].paints.get("nli-investigation-line-completed-motion-line:line-width"))
      .toBeGreaterThan(maps[0].paints.get("nli-investigation-line-completed-motion-line:line-width"));
  });

  it("invalidates geometry caches after an in-place mutation and data-version bump", () => {
    const map = makeMap();
    const renderer = createInvestigationLineRenderer(map, {});
    const mutated = line(10, 420, [[0, 0], [10, 0]], "forward");
    const frame = { activeProgress: 1, completedRouteFlow: { active: false, progress: 0 }, motionMode: "reduced" };
    renderer.render(frame, {
      dataVersion: "v1",
      futureFeatures: [], completedFeatures: [mutated], activeFeatures: [],
    });

    mutated.geometry.coordinates[1] = [20, 10];
    renderer.render(frame, {
      dataVersion: "v2",
      futureFeatures: [], completedFeatures: [mutated], activeFeatures: [],
    });

    const carrierUpdates = map.sources.get("nli-investigation-line-completed-carrier").setData.mock.calls;
    expect(carrierUpdates).toHaveLength(2);
    expect(carrierUpdates.at(-1)[0].features[0].geometry.coordinates).toEqual([[0, 0], [20, 10]]);
    const flowUpdates = map.sources.get("nli-investigation-line-completed-motion").setData.mock.calls;
    expect(flowUpdates).toHaveLength(2);
    expect(flowUpdates.at(-1)[0].features[0].geometry.coordinates).toEqual([[0, 0], [20, 10]]);
  });

  it("keeps carriers cached while paint-only dashes move through Pause and End", () => {
    const map = makeMap();
    const renderer = createInvestigationLineRenderer(map, {});
    const completed = [line(7, 400, [[34, 31], [35, 32]])];
    const frame = { narrative: { phase: "paused" }, activeProgress: 1, completedRouteFlow: { active: true, progress: 0 }, motionMode: "full" };
    renderer.render(frame, { futureFeatures: [], completedFeatures: completed, activeFeatures: [] });
    const paintCallsBeforeAmbient = map.setPaintProperty.mock.calls.length;
    renderer.render({ ...frame, narrative: { phase: "ended" }, completedRouteFlow: { active: true, progress: 0.25 } }, {
      futureFeatures: [], completedFeatures: completed, activeFeatures: [],
    });
    expect(map.sources.get("nli-investigation-line-completed-carrier").setData).toHaveBeenCalledTimes(1);
    expect(map.sources.get("nli-investigation-line-completed-motion").setData).toHaveBeenCalledTimes(1);
    expect(map.setPaintProperty.mock.calls.slice(paintCallsBeforeAmbient).map((call) => call[1])).toEqual([
      "line-gradient",
    ]);
  });

  it("does not normalize or stringify full route geometry on ambient frames", () => {
    const map = makeMap();
    const renderer = createInvestigationLineRenderer(map, {});
    const completed = [line(9, 400, [[34, 31], [35, 32]])];
    const frame = { activeProgress: 1, completedRouteFlow: { active: true, progress: 0 }, motionMode: "full" };
    renderer.render(frame, { futureFeatures: completed, completedFeatures: completed, activeFeatures: [] });
    const stringify = vi.spyOn(JSON, "stringify");
    renderer.render({ ...frame, completedRouteFlow: { active: true, progress: 0.25 } }, {
      futureFeatures: [...completed], completedFeatures: [...completed], activeFeatures: [],
    });
    expect(stringify).not.toHaveBeenCalled();
    stringify.mockRestore();
  });

  it("reset restores red base paint and dispose removes all owned handles", () => {
    const map = makeMap();
    const renderer = createInvestigationLineRenderer(map, {});
    renderer.mount();
    renderer.render({ activeProgress: 0.5 }, {
      futureFeatures: [line(1, 400, [[34, 31], [35, 32]])],
      completedFeatures: [], activeFeatures: [],
    });
    renderer.reset();
    expect(map.paints.get("nli-investigation-line-future-line:line-color")).toBe("#c31f4f");
    expect(map.getSource("nli-investigation-line-completed-carrier")).toBeNull();
    renderer.dispose();
    expect(map.sources.size).toBe(0);
    expect(map.layers).toHaveLength(0);
  });
});
