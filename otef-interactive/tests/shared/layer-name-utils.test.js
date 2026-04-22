import { describe, expect, test } from "vitest";
import { formatLayerLabelForDisplay } from "../../frontend/src/shared/layer-name-utils.js";

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
