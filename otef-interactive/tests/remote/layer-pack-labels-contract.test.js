import { describe, expect, test } from "vitest";
import {
  REQUIRED_PACK_IDS,
  getPackDisplayLabel,
} from "../../frontend/src/remote/layer-pack-display-names.js";

describe("layer-pack-display-names (contract)", () => {
  test("REQUIRED_PACK_IDS lists known packs", () => {
    expect(REQUIRED_PACK_IDS).toEqual([
      "october_7th",
      "projector_base",
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
