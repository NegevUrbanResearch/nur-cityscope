import { describe, expect, test } from "vitest";
import {
  leafletStyleToMapLibre,
  maplibreLineDashFromLeafletPx,
  maplibreLineDashWithLeafletOffset,
} from "../../frontend/src/map/maplibre-curated-layer-loader.js";
import {
  pinkProjectionFallbackLineStyle,
  routeLineStylesForDisplayColor,
} from "../../frontend/src/map-utils/pink-route-map-styles.js";
import { planPinkCuratedOverlayLayers } from "../../frontend/src/map/pink-curated-overlay-plan.js";

function parseDashString(dashArray) {
  if (!dashArray) return null;
  const parts = String(dashArray)
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  return parts.length >= 2 ? parts : null;
}

describe("maplibreLineDashWithLeafletOffset (Colab dual proposed)", () => {
  test("applies no transform when offset is 0 or missing", () => {
    expect(maplibreLineDashWithLeafletOffset([10, 8], 0)).toEqual([10, 8]);
  });

  test("10/8 pattern + offset 9 interleaves vs base (one period, even-length dasharray)", () => {
    const out = maplibreLineDashWithLeafletOffset([10, 8], 9);
    expect(out).toEqual([1, 8, 9, 0]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(18);
    expect(out).not.toEqual([10, 8]);
  });

  test("round-trips to same line-space period length as the base pattern", () => {
    const base = [10, 8];
    const T = 18;
    const o = maplibreLineDashWithLeafletOffset(base, 9);
    expect(o.reduce((a, b) => a + b, 0)).toBe(T);
  });
});

function expectNumberArrayClose(actual, expected) {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i]).toBeCloseTo(expected[i], 10);
  }
}

describe("maplibreLineDashFromLeafletPx (px → line-width–unit parity)", () => {
  test("scales Colab proposed dash + offset the same as leafletStyleToMapLibre (weight 6)", () => {
    const w = 6;
    const parts = [10, 8];
    const o = 9;
    const fromHelper = maplibreLineDashFromLeafletPx(w, parts, o);
    const { paint } = leafletStyleToMapLibre({
      weight: w,
      dashArray: "10 8",
      dashOffset: "9",
    });
    expectNumberArrayClose(fromHelper, paint["line-dasharray"]);
  });

  test("no offset: offroad 6 10 at weight 4 matches px/w normalization", () => {
    const w = 4;
    const { paint } = leafletStyleToMapLibre({
      weight: w,
      dashArray: "6 10",
    });
    expectNumberArrayClose(paint["line-dasharray"], [6 / w, 10 / w]);
  });

  test("scaled dasharray keeps primary vs secondary interleave: same w, same M/L period", () => {
    const w = 6;
    const sec = maplibreLineDashFromLeafletPx(w, [10, 8], null);
    const pri = maplibreLineDashFromLeafletPx(w, [10, 8], 9);
    expect(sec.length).toBe(2);
    expect(pri.length).toBe(4);
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    expect(sum(pri)).toBeCloseTo(sum(sec), 10);
  });
});

describe("proposed line vs proposedSecondary paint (palette dual stack)", () => {
  test("primary dasharray differs from secondary after offset; same effective period", () => {
    const styles = routeLineStylesForDisplayColor("#16A34A");
    expect(styles.proposedSecondary).toBeDefined();
    const sec = parseDashString(styles.proposedSecondary.dashArray);
    const priBase = parseDashString(styles.proposedLine.dashArray);
    const offset = Number(styles.proposedLine.dashOffset);
    expect(sec).toEqual([10, 8]);
    expect(priBase).toEqual([10, 8]);
    expect(offset).toBe(9);
    const pri = maplibreLineDashWithLeafletOffset(priBase, offset);
    expect(pri).not.toEqual(sec);
    expect(pri.reduce((a, b) => a + b, 0)).toBe(sec.reduce((a, b) => a + b, 0));
  });

  test("leafletStyleToMapLibre: secondary is unphased; primary encodes Colab dash offset (line-width units)", () => {
    const styles = routeLineStylesForDisplayColor("#16A34A");
    const w = styles.proposedLine.weight;
    const { paint: secP } = leafletStyleToMapLibre(styles.proposedSecondary);
    const { paint: priP } = leafletStyleToMapLibre(styles.proposedLine);
    expectNumberArrayClose(secP["line-dasharray"], [10 / w, 8 / w]);
    expectNumberArrayClose(
      priP["line-dasharray"],
      maplibreLineDashFromLeafletPx(w, [10, 8], 9),
    );
    expect(secP["line-color"]).not.toEqual(priP["line-color"]);
  });
});

describe("pink projection fallback stroke (MapLibre)", () => {
  test("uses Colab proposed dash tokens normalized like default proposed line", () => {
    const s = pinkProjectionFallbackLineStyle("#00d4ff");
    const w = s.weight;
    const { paint } = leafletStyleToMapLibre(s);
    expect(paint["line-width"]).toBe(w);
    expect(paint["line-color"]).toBe("#00d4ff");
    expectNumberArrayClose(paint["line-dasharray"], [10 / w, 8 / w]);
  });
});

describe("curated polyline op order: halo → secondary → primary", () => {
  test("planPinkCuratedOverlayLayers emits proposed styleKeys before primary so Map groups draw secondary under primary", () => {
    const ops = planPinkCuratedOverlayLayers({
      hasDetourPoints: true,
      hasStoredPinkRoute: true,
      includeProposedSecondary: true,
      solid: [[[-1, 0], [0, 0]]],
      removed: [
        [
          [0, 0],
          [0, 1],
        ],
      ],
      proposedPathsLatLng: [
        [
          [1, 1],
          [2, 2],
        ],
      ],
    });

    const styleKeys = [];
    /** @type {Map<string, true>} */
    const seen = new Map();
    for (const op of ops) {
      if (op.kind !== "polyline") continue;
      if (!seen.has(op.styleKey)) {
        seen.set(op.styleKey, true);
        styleKeys.push(op.styleKey);
      }
    }

    const iHalo = styleKeys.indexOf("proposedHalo");
    const iSec = styleKeys.indexOf("proposedSecondary");
    const iPri = styleKeys.indexOf("proposedLine");
    expect(iHalo).toBeGreaterThanOrEqual(0);
    expect(iSec).toBeGreaterThanOrEqual(0);
    expect(iPri).toBeGreaterThanOrEqual(0);
    expect(iHalo).toBeLessThan(iSec);
    expect(iSec).toBeLessThan(iPri);
  });
});
