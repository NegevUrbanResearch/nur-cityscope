import { describe, expect, test } from "vitest";
import {
  formatParkingLotPopupHtml,
  enrichParkingGeojsonForProjection,
  PINK_LINE_PARKING_ICON_URL,
} from "../../../frontend/src/map-utils/pink-line-parking.js";

describe("pink-line-parking", () => {
  test("formatParkingLotPopupHtml matches colab empty default", () => {
    expect(formatParkingLotPopupHtml({})).toBe("חניה פוטנציאלית");
    expect(formatParkingLotPopupHtml({ name: null, notes: null })).toBe(
      "חניה פוטנציאלית",
    );
  });

  test("formatParkingLotPopupHtml escapes and joins name + notes", () => {
    const html = formatParkingLotPopupHtml({
      name: 'A & B <test>',
      notes: 'Note "x"',
    });
    expect(html).toContain("&amp;");
    expect(html).toContain("&lt;");
    expect(html).toContain("&quot;");
    expect(html).toContain("<br/>");
    expect(html).toContain("<strong>");
  });

  test("enrichParkingGeojsonForProjection adds icon style to Point features only", () => {
    const input = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [34.5, 31.6] },
          properties: { name: "P1" },
        },
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: [] },
          properties: {},
        },
      ],
    };
    const out = enrichParkingGeojsonForProjection(input, "https://example.com/icon.png");
    expect(out.features).toHaveLength(1);
    expect(out.features[0].properties._curatedStyle).toEqual({
      _iconUrl: "https://example.com/icon.png",
      _iconSize: 36,
    });
    expect(out.features[0].geometry.coordinates).toEqual([34.5, 31.6]);
  });

  test("default icon URL path is under otef-interactive static img", () => {
    expect(PINK_LINE_PARKING_ICON_URL).toMatch(
      /^\/otef-interactive\/img\/pink-line-parking\/parking-icon\.png$/,
    );
  });
});
