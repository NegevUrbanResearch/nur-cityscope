import { describe, expect, it, vi } from "vitest";
import {
  buildLegendModel,
  shouldIncludeLayerInLegend,
} from "../../frontend/src/map/legend-model-builder.js";
import { shouldShowLayerOnGisMap } from "../../frontend/src/shared/gis-layer-filter.js";
import { mountMapLegend } from "../../frontend/src/map/map-legend.js";

it("keeps the complete projection legend on one page while editing without metadata commands", async () => {
  let count = 3;
  const element = { clientWidth: 200, clientHeight: 100, innerHTML: "", classList: { toggle() {} } };
  const legend = mountMapLegend({ element, surface: "projection", projectionSpan: "left",
    dataContext: { getLegendSettings: () => ({ language: "en" }) },
    buildModel: async () => ({ packs: Array.from({ length: count }, (_, index) => ({ id: `pack-${index}`, name: `Pack ${index}`,
      layers: [{ id: `layer-${index}`, items: [{ id: `item-${index}`, label: `Entry ${index}`, shape: "line" }] }] })) }) });
  legend.setEditing(true); await legend.refresh();
  expect(legend.setPage).toBeTypeOf("function");
  expect(legend.getRenderSnapshot().pages).toHaveLength(1);
  expect(legend.setPage(99)).toBe(0);
  expect(legend.getRenderSnapshot()).toMatchObject({ pageIndex: 0, editing: true });
  expect(element.innerHTML).toContain("Entry 2");
  count = 1; await legend.refresh();
  expect(legend.setPage(2)).toBe(0);
  expect(legend.getRenderSnapshot().pageIndex).toBe(0);
  legend.dispose();
});

it("keeps the newer legend model, page and snapshot when an older rebuild rejects", async () => {
  let rejectOld;
  const oldBuild = new Promise((_resolve, reject) => { rejectOld = reject; });
  const model = { packs: [{ id: "newer", name: "Newer", layers: [{ id: "newer-layer", items: [{ id: "newer-item", label: "Newer entry", shape: "line" }] }] }] };
  const onRenderSnapshot = vi.fn();
  const element = { clientWidth: 500, clientHeight: 100, innerHTML: "", classList: { toggle() {} } };
  const legend = mountMapLegend({ element, surface: "projection", projectionSpan: "left", onRenderSnapshot,
    buildModel: vi.fn().mockReturnValueOnce(oldBuild).mockResolvedValueOnce(model) });
  legend.setEditing(true);
  const pending = legend.refresh(); await legend.refresh();
  const latest = legend.getRenderSnapshot(); const snapshotCount = onRenderSnapshot.mock.calls.length;
  rejectOld(new Error("Superseded legend build failed")); await pending;
  expect(onRenderSnapshot).toHaveBeenCalledTimes(snapshotCount);
  expect(legend.getRenderSnapshot()).toMatchObject({ model, pages: latest.pages, pageIndex: latest.pageIndex, blocks: latest.blocks });
  expect(element.innerHTML).toContain("Newer entry");
  legend.dispose();
});

it("does not publish a late failure snapshot after the legend is disposed", async () => {
  let rejectBuild;
  const onRenderSnapshot = vi.fn();
  const element = { clientWidth: 500, clientHeight: 100, innerHTML: "", classList: { toggle() {} } };
  const legend = mountMapLegend({ element, surface: "projection", projectionSpan: "left", onRenderSnapshot,
    buildModel: () => new Promise((_resolve, reject) => { rejectBuild = reject; }) });
  legend.setEditing(true);
  const pending = legend.refresh(); legend.dispose();
  const snapshotCount = onRenderSnapshot.mock.calls.length;
  rejectBuild(new Error("Disposed legend build failed")); await pending;
  expect(onRenderSnapshot).toHaveBeenCalledTimes(snapshotCount);
  expect(element.innerHTML).toBe("");
});

describe("shouldIncludeLayerInLegend", () => {
  it("keeps only the two GIS projector-base layers in the allowlist", () => {
    expect(shouldShowLayerOnGisMap("projector_base", "Tkuma_Area_LIne")).toBe(true);
    expect(shouldShowLayerOnGisMap("projector_base", "ישובים")).toBe(true);
    expect(shouldShowLayerOnGisMap("projector_base", "שמות_יישובים")).toBe(false);
    expect(shouldShowLayerOnGisMap("projector_base", "Locations_Lines")).toBe(false);
    expect(shouldShowLayerOnGisMap("projector_base", "SEA")).toBe(false);
    expect(shouldIncludeLayerInLegend("projector_base", "שמות_יישובים", "gis")).toBe(false);
    expect(shouldIncludeLayerInLegend("projector_base", "Locations_Lines", "gis")).toBe(false);
    expect(shouldIncludeLayerInLegend("projector_base", "SEA", "gis")).toBe(false);
    expect(shouldIncludeLayerInLegend("projector_base", "שמות_יישובים", "projection")).toBe(false);
    expect(shouldIncludeLayerInLegend("projector_base", "Locations_Lines", "projection")).toBe(false);
    expect(shouldIncludeLayerInLegend("projector_base", "SEA", "projection")).toBe(false);
    expect(shouldIncludeLayerInLegend("nli", "investigation_polygons", "gis")).toBe(true);
    expect(shouldIncludeLayerInLegend("nli", "investigation_polygons", "projection")).toBe(true);
  });

  it("strips NLI narrative house outlines from both legend surfaces", () => {
    expect(shouldIncludeLayerInLegend("nli", "narrative_polygon", "gis")).toBe(false);
    expect(shouldIncludeLayerInLegend("nli", "narrative_polygon", "projection")).toBe(false);
  });

  it("strips Gaza roads from both legend surfaces", () => {
    expect(shouldIncludeLayerInLegend("gaza", "Gaza_Roads", "gis")).toBe(false);
    expect(shouldIncludeLayerInLegend("gaza", "Gaza_Roads", "projection")).toBe(false);
    expect(shouldIncludeLayerInLegend("gaza", "gaza_boundary", "gis")).toBe(true);
    expect(shouldIncludeLayerInLegend("gaza", "gaza_boundary", "projection")).toBe(true);
  });

  it("omits an enabled projector base pack from the built model", async () => {
    const style = {
      renderer: "simple",
      defaultSymbol: {
        symbolLayers: [{ type: "markerPoint", marker: { fillColor: "#123456", size: 12 } }],
      },
    };
    const group = {
      id: "projector_base",
      layers: [{ id: "שמות_יישובים", enabled: true }],
    };
    const model = await buildLegendModel({
      surface: "projection",
      dataContext: { getLayerGroups: () => [group] },
      registry: {
        _initialized: true,
        getGroups: () => [group],
        getLayerConfig: () => ({
          id: "שמות_יישובים",
          name: "שמות_יישובים",
          geometryType: "point",
          style,
        }),
        getPackStyleJsonForLayer: () => style,
      },
    });

    expect(model.packs).toEqual([]);
  });

  it("rejects unknown surfaces instead of silently changing the model", () => {
    expect(() => shouldIncludeLayerInLegend("nli", "people", "other")).toThrow(
      "unknown legend surface: other",
    );
    expect(() => shouldIncludeLayerInLegend("projector_base", "ישובים", "other")).toThrow(
      "unknown legend surface: other",
    );
  });
});
