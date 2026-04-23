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

  test("resolves runtime manifest id with hyphen (october_7th pack)", () => {
    expect(
      getLayerDisplayLabel(
        "october_7th.אזור_הרס-אזור",
        "en",
        "אזור_הרס-אזור",
        ["october_7th.אזור_הרס-אזור"],
      ),
    ).toBe("Destruction — area");
  });

  test("falls back to formatLayerLabelForDisplay when id unknown", () => {
    expect(
      getLayerDisplayLabel("unknown_pack.layer", "he", "foo_bar-baz", [
        "unknown_pack.layer",
      ]),
    ).toBe("foo bar baz");
  });

  test("glossary en for GIS pack layer tiles (land_use, greens, future dev, muni transport)", () => {
    expect(
      getLayerDisplayLabel("land_use.מגורים", "en", "מגורים", ["land_use.מגורים"]),
    ).toBe("Residential");
    expect(
      getLayerDisplayLabel("greens.גן_לאומי", "en", "גן לאומי", [
        "greens.גן_לאומי",
      ]),
    ).toBe("National park");
    expect(
      getLayerDisplayLabel("future_development.מימושים", "en", "מימושים", [
        "future_development.מימושים",
      ]),
    ).toBe("Zoning build-out");
    expect(
      getLayerDisplayLabel("muniplicity_transport.שבילי_אופניים", "en", "שבילי אופניים", [
        "muniplicity_transport.שבילי_אופניים",
      ]),
    ).toBe("Bicycle paths");
  });

  test("glossary en for runtime ids (muni outline, road exit, land_use fire zone underscore)", () => {
    expect(
      getLayerDisplayLabel(
        "muniplicity_transport.מועצות_אזוריות_מתאר",
        "en",
        "מועצות אזוריות מתאר",
        ["muniplicity_transport.מועצות_אזוריות_מתאר"],
      ),
    ).toBe("Regional councils (cartographic outline)");
    expect(
      getLayerDisplayLabel("future_development.יציאה_כביש", "en", "יציאה כביש", [
        "future_development.יציאה_כביש",
      ]),
    ).toBe("Road exit");
    expect(
      getLayerDisplayLabel("land_use.שטחי_אש_", "en", "שטחי אש", ["land_use.שטחי_אש_"]),
    ).toBe("Fire zones");
  });
});
