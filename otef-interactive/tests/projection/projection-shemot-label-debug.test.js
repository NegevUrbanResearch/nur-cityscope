import { describe, expect, it } from "vitest";
import {
  applyShemotDebugOverridesToFeatureCollection,
  buildShemotDebugSeedMapFromFeatureCollection,
} from "../../frontend/src/projection/projection-shemot-label-debug.js";

function cloneFc(fc) {
  return JSON.parse(JSON.stringify(fc));
}

describe("Shemot label debug: pure merge/seed", () => {
  it("merges otef_* only for keys in overrides; preserves other features' props", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { citycode: "1", otef_label_offset_em_x: 7, otef_label_offset_em_y: 0 },
          geometry: { type: "Point", coordinates: [0, 0] },
        },
        {
          type: "Feature",
          properties: { citycode: "2", otef_label_rotate_deg: 90 },
          geometry: { type: "Point", coordinates: [1, 1] },
        },
      ],
    };
    const ov = new Map([["1", { rotateDeg: 30, offsetEm: [3, 4] }]]);
    const out = applyShemotDebugOverridesToFeatureCollection(cloneFc(fc), ov, "citycode");
    expect(out.features[0].properties.otef_label_rotate_deg).toBe(30);
    expect(out.features[0].properties.otef_label_offset_em_x).toBe(3);
    expect(out.features[0].properties.otef_label_offset_em_y).toBe(4);
    expect(out.features[0].properties.otef_map_text_offset_em).toEqual([3 / 14, 4 / 14]);
    expect(out.features[1].properties.otef_label_rotate_deg).toBe(90);
    expect(out.features[1].properties.otef_label_offset_em_x).toBeUndefined();
  });

  it("buildShemotDebugSeedMapFromFeatureCollection maps existing otef props by keyField", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { citycode: "5", otef_label_offset_em_x: 2, otef_label_offset_em_y: -1 },
          geometry: { type: "Point", coordinates: [0, 0] },
        },
        { type: "Feature", properties: { citycode: "6" }, geometry: { type: "Point", coordinates: [1, 1] } },
      ],
    };
    const m = buildShemotDebugSeedMapFromFeatureCollection(fc, "citycode");
    expect(m.size).toBe(1);
    expect(m.get("5").offsetEm).toEqual([2, -1]);
    expect(m.get("5").rotateDeg).toBe(0);
  });

  it("buildShemotDebugSeedMapFromFeatureCollection recovers numerators from otef_map_text_offset_em", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { citycode: "9", otef_map_text_offset_em: [1, -0.5] },
          geometry: { type: "Point", coordinates: [0, 0] },
        },
      ],
    };
    const m = buildShemotDebugSeedMapFromFeatureCollection(fc, "citycode");
    expect(m.get("9").offsetEm).toEqual([14, -7]);
    expect(m.get("9").rotateDeg).toBe(0);
  });
});
