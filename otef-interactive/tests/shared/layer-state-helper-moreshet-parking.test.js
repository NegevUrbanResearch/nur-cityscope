import { afterEach, describe, expect, test } from "vitest";
import { getEffectiveLayerGroups } from "../../frontend/src/shared/layer-state-helper.js";
import {
  PINK_LINE_PARKING_LAYER_ID,
  PINK_LINE_ROUTE_LAYER_ID,
  computePinkLineBaseLayerVisible,
} from "../../frontend/src/map-utils/curated-pink-axis-state.js";

describe("getEffectiveLayerGroups: Moreshet pack + parking companion", () => {
  afterEach(() => {
    delete globalThis.OTEFDataContext;
    delete globalThis.layerRegistry;
  });

  test("injects parking toggle row after published layers", () => {
    globalThis.OTEFDataContext = {
      getLayerGroups: () => [
        {
          id: "curated_demo",
          enabled: true,
          layers: [{ id: "55", displayName: "Demo", enabled: true }],
        },
      ],
    };

    const groups = getEffectiveLayerGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("curated_moresht_axis");
    const ids = groups[0].layers.map((l) => l.id);
    expect(ids[0]).toBe("pink_line_route");
    expect(ids).toContain("55");
    expect(ids).toContain(PINK_LINE_PARKING_LAYER_ID);
  });

  test("omits Moreshet group when there are no published curated layers", () => {
    globalThis.OTEFDataContext = {
      getLayerGroups: () => [
        {
          id: "curated_moresht_axis",
          enabled: true,
          layers: [],
        },
      ],
    };

    const groups = getEffectiveLayerGroups();
    expect(groups.find((g) => g.id === "curated_moresht_axis")).toBeUndefined();
  });

  test("pink line stays visible when only the dedicated toggle is on", () => {
    globalThis.OTEFDataContext = {
      getLayerGroups: () => [
        {
          id: "curated_moresht_axis",
          enabled: true,
          layers: [
            { id: PINK_LINE_ROUTE_LAYER_ID, displayName: "Pink line", enabled: true },
            { id: "55", displayName: "Demo", enabled: false },
            { id: PINK_LINE_PARKING_LAYER_ID, displayName: "Parking lots", enabled: false },
          ],
        },
      ],
    };

    const groups = getEffectiveLayerGroups();
    expect(groups[0].layers[0].id).toBe(PINK_LINE_ROUTE_LAYER_ID);
    expect(groups[0].layers[0].enabled).toBe(true);
    expect(groups[0].layers.find((l) => l.id === "55").enabled).toBe(false);
    expect(computePinkLineBaseLayerVisible(groups)).toBe(true);
  });
});
