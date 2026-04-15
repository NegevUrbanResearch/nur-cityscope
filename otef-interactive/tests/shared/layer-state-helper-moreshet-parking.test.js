import { afterEach, describe, expect, test } from "vitest";
import { getEffectiveLayerGroups } from "../../frontend/src/shared/layer-state-helper.js";
import { PINK_LINE_PARKING_LAYER_ID } from "../../frontend/src/map-utils/curated-pink-axis-state.js";

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
});
