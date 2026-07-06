import { describe, expect, test } from "vitest";
import catalog, {
  searchPlaces,
} from "../../frontend/src/shared/place-navigation/place-catalog.js";

describe("place catalog", () => {
  test("entries expose camera hints without canonical viewport rectangles", () => {
    expect(catalog.entries.length).toBeGreaterThan(0);
    const entry = catalog.entries.find((item) => item.type === "yeshuv");
    expect(entry).toBeTruthy();
    expect(entry.cameraHint).toEqual({
      center: {
        lng: expect.any(Number),
        lat: expect.any(Number),
      },
      centerItm: {
        x: expect.any(Number),
        y: expect.any(Number),
      },
      zoom: expect.any(Number),
    });
    expect(entry.target).toBeUndefined();
    expect(entry.bbox).toBeUndefined();
    expect(entry.corners).toBeUndefined();
    expect(entry.outlineRef).toBeUndefined();
  });

  test("searchPlaces finds aliases and filters by live navigation guard", () => {
    const results = searchPlaces("nir", {
      limit: 10,
      canNavigateToPlace: (place) => place.id !== "yeshuv-0069",
    });
    expect(results.some((place) => place.id === "yeshuv-0069")).toBe(false);
    expect(results.every((place) => place.selectable)).toBe(true);
  });

  test("starter suggestions are explicit and bounded", () => {
    expect(searchPlaces("", { includeStarter: false })).toEqual([]);
    const starters = searchPlaces("", { includeStarter: true, limit: 5 });
    expect(starters.length).toBeGreaterThan(0);
    expect(starters.length).toBeLessThanOrEqual(5);
  });
});
