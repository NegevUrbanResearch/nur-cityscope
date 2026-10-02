import { expect, test } from "vitest";
import { NLI_NOVA_STORY } from "../../frontend/src/shared/nli-nova-story.js";
import { NOVA_EXPLAINER_OBJECT_IDS, novaExplainerCamera,
  normalizeNovaExplainerMaps, polygonAnchorLngLat, clampCardBox,
} from "../../frontend/src/shared/nli-nova-explainer-layout.js";

test("ids come from the story", () => {
  expect(NOVA_EXPLAINER_OBJECT_IDS).toEqual([...new Set(
    NLI_NOVA_STORY.beats.flatMap(beat => beat.polygonObjectIds),
  )]);
  expect(NOVA_EXPLAINER_OBJECT_IDS).toHaveLength(14);
  expect(NOVA_EXPLAINER_OBJECT_IDS).not.toContain(107);
});
test.each([[0, "close"], [2, "close"], [3, "wide"], [4, "wide"]])(
  "beat %i uses %s", (novaBeatIndex, expected) => {
    expect(novaExplainerCamera({ narrativeId: "nova", phase: "playing", novaBeatIndex })).toBe(expected);
  },
);
test("evaluated end uses wide even without a current beat", () => {
  expect(novaExplainerCamera({ narrativeId: "nova", phase: "ended", novaBeatIndex: -1 })).toBe("wide");
});
test("normalization clamps, filters, and keeps cameras independent", () => {
  const raw = { close: { "100": { leftPct: 101, topPct: -1 },
    "107": { leftPct: 1, topPct: 1 }, "97": { leftPct: null, topPct: 1 } },
    wide: { "100": { leftPct: 8, topPct: 18 } } };
  expect(normalizeNovaExplainerMaps(raw)).toEqual({
    close: { "100": { leftPct: 100, topPct: 0 } },
    wide: { "100": { leftPct: 8, topPct: 18 } },
  });
  expect(raw.close["100"].leftPct).toBe(101);
});
test("anchor uses bbox center rather than vertex average", () => {
  expect(polygonAnchorLngLat({ geometry: { type: "Polygon", coordinates: [
    [[0, 0], [4, 0], [4, 2], [0, 2], [0, 0]],
  ] } })).toEqual([2, 1]);
  expect(polygonAnchorLngLat({ geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } })).toBeNull();
});
test("measured box fits at the inset", () => {
  expect(clampCardBox({ left: 800, top: -10, width: 280, height: 80,
    containerWidth: 800, containerHeight: 600 })).toEqual({ left: 516, top: 4 });
});

test("camera ignores zoom and does not coerce a string beat index", () => {
  expect(novaExplainerCamera({ narrativeId: "nova", phase: "playing", novaBeatIndex: 0, zoom: 22 })).toBe("close");
  expect(novaExplainerCamera({ narrativeId: "nova", phase: "playing", novaBeatIndex: "3", zoom: 1 })).toBe("close");
});

test("normalization drops non-finite, extra, and non-story entries without copying cameras", () => {
  const raw = {
    close: {
      "100": { leftPct: 12.5, topPct: 20, extra: 1 },
      "104": { leftPct: Number.POSITIVE_INFINITY, topPct: 1 },
      "98": { leftPct: true, topPct: 1 },
      "99": { leftPct: "4", topPct: 1 },
      "186": { leftPct: 3 },
      "105": [1, 2],
    },
  };
  expect(normalizeNovaExplainerMaps(raw)).toEqual({ close: {}, wide: {} });
  expect(normalizeNovaExplainerMaps(null)).toEqual({ close: {}, wide: {} });
});

test("anchor uses the first polygon outer ring, a point, and rejects non-numbers", () => {
  expect(polygonAnchorLngLat({ geometry: { type: "Polygon", coordinates: [
    [[0, 0], [10, 0], [2, 2], [0, 0]],
    [[1, 1], [2, 1], [2, 1.5], [1, 1]],
  ] } })).toEqual([5, 1]);
  expect(polygonAnchorLngLat({ geometry: { type: "MultiPolygon", coordinates: [
    [[[0, 0], [4, 0], [4, 2], [0, 2], [0, 0]]],
    [[[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]],
  ] } })).toEqual([2, 1]);
  expect(polygonAnchorLngLat({ geometry: { type: "Point", coordinates: [34.5, 31.25] } })).toEqual([34.5, 31.25]);
  expect(polygonAnchorLngLat({ geometry: { type: "Point", coordinates: ["34.5", 31.25] } })).toBeNull();
  expect(polygonAnchorLngLat({ geometry: { type: "Point", coordinates: [Number.NaN, 1] } })).toBeNull();
  expect(polygonAnchorLngLat({ geometry: { type: "Polygon", coordinates: [] } })).toBeNull();
  expect(polygonAnchorLngLat(null)).toBeNull();
});

test("small canvas clamp uses zero inside the insets", () => {
  expect(clampCardBox({ left: 40, top: -5, width: 280, height: 80,
    containerWidth: 100, containerHeight: 50 })).toEqual({ left: 0, top: 0 });
  expect(clampCardBox({ left: "800", top: 10, width: 280, height: 80,
    containerWidth: 800, containerHeight: 600 })).toEqual({ left: 0, top: 10 });
});
