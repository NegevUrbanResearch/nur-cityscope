import { describe, expect, test } from "vitest";
import {
  REQUIRED_PACK_IDS,
  getPackDisplayLabel,
  normalizePackId,
} from "../../frontend/src/remote/layer-pack-display-names.js";

describe("layer-pack-display-names (contract)", () => {
  test("normalizePackId trims, lowercases, maps spaces and hyphens to underscore", () => {
    expect(normalizePackId("  Map-3 Future  ")).toBe("map_3_future");
    expect(normalizePackId("Municipality Transport")).toBe("municipality_transport");
  });

  test("getPackDisplayLabel matches PACK_LABELS after normalizePackId when direct key misses", () => {
    expect(getPackDisplayLabel("map-3 future", "en")).toBe("Map 3 — future");
    expect(getPackDisplayLabel("MUNICIPALITY transport", "he")).toBe("תחבורה מוניציפלית");
    // layers/layers-manifest.json pack id (distinct spelling)
    expect(getPackDisplayLabel("muniplicity_transport", "en")).toBe("Municipal transport");
    expect(getPackDisplayLabel("greens", "he")).toBe("ירוקים");
    expect(getPackDisplayLabel("projector_base", "he")).toBe("בסיס מקרן");
  });

  test("REQUIRED_PACK_IDS lists known packs", () => {
    expect(REQUIRED_PACK_IDS).toEqual([
      "october_7th",
      "projector_base",
      "map_3_future",
      "curated_moresht_axis",
      "future_development",
      "gaza",
      "greens",
      "land_use",
      "municipality_transport",
      "municpality_transport",
      "muniplicity_transport",
      "curated",
    ]);
  });

  for (const packId of REQUIRED_PACK_IDS) {
    if (packId === "curated") {
      test("curated: no static pack label; layer title is t(curatedGroupLabel) from remote-locale", () => {
        expect(getPackDisplayLabel("curated", "he")).toBeNull();
        expect(getPackDisplayLabel("curated", "en")).toBeNull();
      });
      continue;
    }
    test(`${packId} has non-empty he/en labels`, () => {
      const he = getPackDisplayLabel(packId, "he");
      const en = getPackDisplayLabel(packId, "en");
      expect(he).toBeTruthy();
      expect(String(he).trim().length).toBeGreaterThan(0);
      expect(en).toBeTruthy();
      expect(String(en).trim().length).toBeGreaterThan(0);
    });
  }
});
