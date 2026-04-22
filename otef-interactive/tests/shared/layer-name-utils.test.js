import { describe, expect, test } from "vitest";
import { formatLayerLabelForDisplay } from "../../frontend/src/shared/layer-name-utils.js";
import { getLayerDisplayLabel } from "../../frontend/src/shared/layer-display-glossary.js";

describe("formatLayerLabelForDisplay", () => {
  test("maps underscore and hyphen runs to single spaces", () => {
    expect(formatLayerLabelForDisplay("אירוע_נקודתי-רציחה_חטיפה")).toBe(
      "אירוע נקודתי רציחה חטיפה",
    );
  });

  test("collapses whitespace", () => {
    expect(formatLayerLabelForDisplay("  a__b  -c  ")).toBe("a b c");
  });

  test("returns empty for non-strings", () => {
    expect(formatLayerLabelForDisplay(null)).toBe("");
    expect(formatLayerLabelForDisplay(undefined)).toBe("");
  });
});

describe("getLayerDisplayLabel", () => {
  test("uses glossary for known full id and locale he", () => {
    const s = getLayerDisplayLabel("projector_base.sea", "he", "sea", [
      "projector_base.sea",
    ]);
    expect(s).toBe("ים");
  });

  test("uses glossary for en", () => {
    expect(
      getLayerDisplayLabel("map_3_future.greens", "en", "greens", [
        "map_3_future.greens",
      ]),
    ).toBe("Greens");
  });

  test("tries fullLayerIds in order; first match wins", () => {
    expect(
      getLayerDisplayLabel("october_7th.חדירה_לישוב-ציר", "en", "חדירה לישוב", [
        "october_7th.חדירה_לישוב-ציר",
        "october_7th.חדירה_לישוב-נקודה",
      ]),
    ).toBe("Infiltration into a community — axis");
  });

  test("falls back to formatLayerLabelForDisplay when id unknown", () => {
    expect(
      getLayerDisplayLabel("unknown_pack.layer", "he", "foo_bar-baz", [
        "unknown_pack.layer",
      ]),
    ).toBe("foo bar baz");
  });
});
