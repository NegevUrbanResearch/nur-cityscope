import { UI_CONFIG } from "../../frontend/src/config/ui-config.js";

describe("ui-config curated color assignment", () => {
  test("uses the same color for revised layers of the same proposal family", () => {
    const layerDataV1 = {
      display_name: "Nahal Oz Memorial Alignment",
    };
    const layerDataV2 = {
      display_name: "Nahal Oz Memorial Alignment (rev 2)",
    };

    const colorV1 = UI_CONFIG.getCuratedColor("curated_moresht_axis.101", layerDataV1);
    const colorV2 = UI_CONFIG.getCuratedColor("curated_moresht_axis.202", layerDataV2);

    expect(colorV1).toBe(colorV2);
  });
});

