import { describe, expect, test, vi } from "vitest";
import { reloadProjectionCuratedLayersFromSupabase } from "../../frontend/src/projection/projection-curated-layer-load.js";
import {
  MORESHET_AXIS_GROUP_ID,
  isPinkLineParkingLayerId,
} from "../../frontend/src/map-utils/curated-pink-axis-state.js";
import {
  leafletStyleToMapLibre,
  maplibreLineDashWithLeafletOffset,
  parseLeafletDashOffsetPx,
} from "../../frontend/src/map/maplibre-curated-layer-loader.js";
import { routeLineStylesForDisplayColor } from "../../frontend/src/map-utils/pink-route-map-styles.js";

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
      updateLayerVisibility: vi.fn(),
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
  });

  test("selective reload refreshes API first, removes only affected curated ids, reloads those enabled", async () => {
    const refresh = vi.fn().mockResolvedValue();
    const removeLayer = vi.fn();
    const loadedLayers = {
      "curated_moresht_axis.a": {},
      "curated_moresht_axis.b": {},
    };
    const loadProjectionLayerFromRegistry = vi.fn().mockResolvedValue();
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
        updateLayerVisibility: vi.fn(),
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
  });

  test("empty affectedCuratedFullLayerIds is treated as selective no-op", async () => {
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

    expect(Object.keys(loadedLayers)).toEqual(["curated_moresht_axis.a"]);
    expect(loadProjectionLayerFromRegistry).not.toHaveBeenCalled();
  });

  test('malformed affectedCuratedFullLayerIds [""] is treated as selective no-op', async () => {
    const refresh = vi.fn().mockResolvedValue();
    const removeLayer = vi.fn();
    const loadedLayers = {
      "curated_moresht_axis.a": {},
      "curated_moresht_axis.b": {},
    };
    const loadProjectionLayerFromRegistry = vi.fn().mockResolvedValue();
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
        updateLayerVisibility: vi.fn(),
        getLayerGroups,
        MORESHET_AXIS_GROUP_ID,
        isPinkLineParkingLayerId,
        refreshLayerGroupsBeforeReload: refresh,
      },
      { affectedCuratedFullLayerIds: [""] },
    );

    expect(refresh).not.toHaveBeenCalled();
    expect(removeLayer).not.toHaveBeenCalled();
    expect(Object.keys(loadedLayers).sort()).toEqual([
      "curated_moresht_axis.a",
      "curated_moresht_axis.b",
    ]);
    expect(loadProjectionLayerFromRegistry).not.toHaveBeenCalled();
  });

  test('malformed non-empty affectedCuratedFullLayerIds ["foo", "curated_only_group"] is treated as selective no-op', async () => {
    const refresh = vi.fn().mockResolvedValue();
    const removeLayer = vi.fn();
    const loadedLayers = {
      "curated_moresht_axis.a": {},
      "curated_moresht_axis.b": {},
    };
    const loadProjectionLayerFromRegistry = vi.fn().mockResolvedValue();
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
        updateLayerVisibility: vi.fn(),
        getLayerGroups,
        MORESHET_AXIS_GROUP_ID,
        isPinkLineParkingLayerId,
        refreshLayerGroupsBeforeReload: refresh,
      },
      { affectedCuratedFullLayerIds: ["foo", "curated_only_group"] },
    );

    expect(refresh).not.toHaveBeenCalled();
    expect(removeLayer).not.toHaveBeenCalled();
    expect(Object.keys(loadedLayers).sort()).toEqual([
      "curated_moresht_axis.a",
      "curated_moresht_axis.b",
    ]);
    expect(loadProjectionLayerFromRegistry).not.toHaveBeenCalled();
  });

  test('whitespace-only affectedCuratedFullLayerIds ["   "] is treated as selective no-op', async () => {
    const refresh = vi.fn().mockResolvedValue();
    const removeLayer = vi.fn();
    const loadedLayers = {
      "curated_moresht_axis.a": {},
      "curated_moresht_axis.b": {},
    };
    const loadProjectionLayerFromRegistry = vi.fn().mockResolvedValue();
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
        updateLayerVisibility: vi.fn(),
        getLayerGroups,
        MORESHET_AXIS_GROUP_ID,
        isPinkLineParkingLayerId,
        refreshLayerGroupsBeforeReload: refresh,
      },
      { affectedCuratedFullLayerIds: ["   "] },
    );

    expect(refresh).not.toHaveBeenCalled();
    expect(removeLayer).not.toHaveBeenCalled();
    expect(Object.keys(loadedLayers).sort()).toEqual([
      "curated_moresht_axis.a",
      "curated_moresht_axis.b",
    ]);
    expect(loadProjectionLayerFromRegistry).not.toHaveBeenCalled();
  });
});

/** Task 6: projection/GIS share curated dash translation; reload path must stay aligned with MapLibre helpers. */
describe("projection curated reload — Task 6 dash parity (MapLibre helpers)", () => {
  test("parseLeafletDashOffsetPx accepts px-suffixed strings (e.g. Leaflet/CSS style)", () => {
    expect(parseLeafletDashOffsetPx("9px")).toBe(9);
    expect(parseLeafletDashOffsetPx(" 12px ")).toBe(12);
    expect(parseLeafletDashOffsetPx("0px")).toBe(0);
    expect(parseLeafletDashOffsetPx("9PX")).toBe(9);
    expect(parseLeafletDashOffsetPx("not-a-number")).toBeNull();
  });

  test("leafletStyleToMapLibre: dashOffset '9px' matches numeric offset for dual proposed stack", () => {
    const styles = routeLineStylesForDisplayColor("#16A34A");
    const { paint: numericPaint } = leafletStyleToMapLibre({
      ...styles.proposedLine,
      dashOffset: Number(styles.proposedLine.dashOffset),
    });
    const { paint: pxPaint } = leafletStyleToMapLibre({
      ...styles.proposedLine,
      dashOffset: `${styles.proposedLine.dashOffset}px`,
    });
    expect(pxPaint["line-dasharray"]).toEqual(numericPaint["line-dasharray"]);
    expect(pxPaint["line-dasharray"]).toEqual(
      maplibreLineDashWithLeafletOffset([10, 8], 9),
    );
  });
});
