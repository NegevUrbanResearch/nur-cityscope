import { describe, expect, test, vi } from "vitest";
import { reloadProjectionCuratedLayersFromSupabase } from "../../frontend/src/projection/projection-curated-layer-load.js";
import {
  MORESHET_AXIS_GROUP_ID,
  isPinkLineParkingLayerId,
} from "../../frontend/src/map-utils/curated-pink-axis-state.js";

describe("reloadProjectionCuratedLayersFromSupabase", () => {
  test("full reload clears every curated pack in loadedLayers and reloads all enabled", async () => {
    const refresh = vi.fn().mockResolvedValue();
    const removeLayer = vi.fn();
    const loadedLayers = {
      "curated_moresht_axis.a": {},
      "curated_moresht_axis.b": {},
      "curated.legacy": {},
      "map_3_future.x": {},
    };
    const loadProjectionLayerFromRegistry = vi.fn().mockResolvedValue();
    const updateLayerVisibility = vi.fn();
    const getLayerGroups = () => [
      {
        id: "curated_moresht_axis",
        layers: [
          { id: "a", enabled: true },
          { id: "b", enabled: true },
        ],
      },
    ];

    await reloadProjectionCuratedLayersFromSupabase({
      loadedLayers,
      inFlightLayerLoads: { "curated_moresht_axis.a": Promise.resolve() },
      canvasRenderer: { removeLayer },
      loadProjectionLayerFromRegistry,
      updateLayerVisibility,
      getLayerGroups,
      MORESHET_AXIS_GROUP_ID,
      isPinkLineParkingLayerId,
      refreshLayerGroupsBeforeReload: refresh,
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(removeLayer.mock.calls.map((c) => c[0]).sort()).toEqual([
      "curated.legacy",
      "curated_moresht_axis.a",
      "curated_moresht_axis.b",
    ]);
    expect(loadedLayers).toEqual({ "map_3_future.x": {} });
    expect(loadProjectionLayerFromRegistry.mock.calls.map((c) => c[0]).sort()).toEqual([
      "curated_moresht_axis.a",
      "curated_moresht_axis.b",
    ]);
    expect(updateLayerVisibility.mock.calls).toEqual([
      ["curated_moresht_axis.a", true],
      ["curated_moresht_axis.b", true],
    ]);
  });

  test("selective reload refreshes API first, removes only affected curated ids, reloads those enabled", async () => {
    const refresh = vi.fn().mockResolvedValue();
    const removeLayer = vi.fn();
    const loadedLayers = {
      "curated_moresht_axis.a": {},
      "curated_moresht_axis.b": {},
    };
    const loadProjectionLayerFromRegistry = vi.fn().mockResolvedValue();
    const updateLayerVisibility = vi.fn();
    const getLayerGroups = () => [
      {
        id: "curated_moresht_axis",
        layers: [
          { id: "a", enabled: true },
          { id: "b", enabled: true },
        ],
      },
    ];

    await reloadProjectionCuratedLayersFromSupabase(
      {
        loadedLayers,
        inFlightLayerLoads: {},
        canvasRenderer: { removeLayer },
        loadProjectionLayerFromRegistry,
        updateLayerVisibility,
        getLayerGroups,
        MORESHET_AXIS_GROUP_ID,
        isPinkLineParkingLayerId,
        refreshLayerGroupsBeforeReload: refresh,
      },
      { affectedCuratedFullLayerIds: ["curated_moresht_axis.a"] },
    );

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(
      removeLayer.mock.invocationCallOrder[0],
    );
    expect(removeLayer).toHaveBeenCalledTimes(1);
    expect(removeLayer).toHaveBeenCalledWith("curated_moresht_axis.a");
    expect(loadedLayers).toEqual({ "curated_moresht_axis.b": {} });
    expect(loadProjectionLayerFromRegistry).toHaveBeenCalledTimes(1);
    expect(loadProjectionLayerFromRegistry).toHaveBeenCalledWith(
      "curated_moresht_axis.a",
    );
    expect(updateLayerVisibility).toHaveBeenCalledWith(
      "curated_moresht_axis.a",
      true,
    );
  });

  test("empty affectedCuratedFullLayerIds falls back to full wipe", async () => {
    const refresh = vi.fn().mockResolvedValue();
    const loadedLayers = { "curated_moresht_axis.a": {} };
    const loadProjectionLayerFromRegistry = vi.fn().mockResolvedValue();
    const getLayerGroups = () => [
      {
        id: "curated_moresht_axis",
        layers: [{ id: "a", enabled: true }],
      },
    ];

    await reloadProjectionCuratedLayersFromSupabase(
      {
        loadedLayers,
        inFlightLayerLoads: {},
        canvasRenderer: { removeLayer: vi.fn() },
        loadProjectionLayerFromRegistry,
        updateLayerVisibility: vi.fn(),
        getLayerGroups,
        MORESHET_AXIS_GROUP_ID,
        isPinkLineParkingLayerId,
        refreshLayerGroupsBeforeReload: refresh,
      },
      { affectedCuratedFullLayerIds: [] },
    );

    expect(Object.keys(loadedLayers)).toEqual([]);
    expect(loadProjectionLayerFromRegistry).toHaveBeenCalledWith(
      "curated_moresht_axis.a",
    );
  });
});
