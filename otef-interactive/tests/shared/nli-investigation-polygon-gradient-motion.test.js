import { describe, expect, it } from "vitest";
import {
  polygonEntryBandFactor,
  polygonGradientBandPaint,
  polygonGradientPhase,
} from "../../frontend/src/shared/nli-investigation-polygon-gradient-motion.js";
import { NLI_VISUAL_TOKENS } from "../../frontend/src/shared/nli-investigation-theme.js";

const productionPalettes = [
  {
    name: "battle",
    bands: ["#8e0912", "#c7171c", "#f14230", "#fb7a5a", "#fcad91", "#fdd1be"]
      .map((color, ordinal) => ({ ordinal, color, opacity: 0.55 })),
  },
  {
    name: "fire",
    bands: ["#7b5622", "#a66b18", "#d07e0c", "#f99201", "#ffc400"]
      .map((color, ordinal) => ({ ordinal, color, opacity: 0.55 })),
  },
  {
    name: "hostage",
    bands: [0.14, 0.27, 0.46, 0.68, 1]
      .map((opacity, ordinal) => ({ ordinal, color: "#ffff73", opacity })),
  },
];

const invalidPalette = [
  { ordinal: 0, color: "#8e0912", opacity: 0.42 },
  { ordinal: 1, color: "not-a-color", opacity: 0.55 },
  { ordinal: 2, color: "#f14230", opacity: 0.68 },
];

function authoredPaint(band) {
  return { color: band.color, opacity: band.opacity };
}

function interpolatePaint(from, to, amount) {
  const parse = (color) => [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
  const fromRgb = parse(from.color);
  const toRgb = parse(to.color);
  const rgb = fromRgb.map((channel, index) => Math.round(
    channel + (toRgb[index] - channel) * amount,
  ));
  return {
    color: `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`,
    opacity: from.opacity + (to.opacity - from.opacity) * amount,
  };
}

describe("polygonGradientPhase", () => {
  it("normalizes a nonnegative timestamp across the cycle", () => {
    expect(polygonGradientPhase(0, 6000)).toBe(0);
    expect(polygonGradientPhase(3000, 6000)).toBe(0.5);
    expect(polygonGradientPhase(6000, 6000)).toBe(0);
    expect(polygonGradientPhase(7500, 6000)).toBe(0.25);
  });

  it("returns null for invalid time or cycle input", () => {
    for (const nowMs of [null, undefined, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(polygonGradientPhase(nowMs, 6000)).toBeNull();
    }
    for (const cycleMs of [null, undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(polygonGradientPhase(100, cycleMs)).toBeNull();
    }
  });

  it("uses the shared default cycle token", () => {
    expect(NLI_VISUAL_TOKENS.polygonGradientCycleMs).toBe(6000);
    expect(NLI_VISUAL_TOKENS).not.toHaveProperty("polygonGradientCrestWidthBands");
    expect(NLI_VISUAL_TOKENS).not.toHaveProperty("polygonGradientWakeStrength");
    expect(polygonGradientPhase(3000)).toBe(0.5);
  });
});

describe("polygonGradientBandPaint", () => {
  it.each(productionPalettes)("shifts the $name palette inward by one geometry at phase 1/N", ({ bands }) => {
    const phase = 1 / bands.length;
    const paints = bands.map((_, ordinal) => polygonGradientBandPaint(bands, ordinal, phase));

    expect(paints).toEqual(bands.map((_, ordinal) => authoredPaint(
      bands[(ordinal - 1 + bands.length) % bands.length],
    )));
  });

  it.each(productionPalettes)("linearly interpolates the $name palette halfway toward the inward shift", ({ bands }) => {
    const phase = 1 / (2 * bands.length);
    const paints = bands.map((_, ordinal) => polygonGradientBandPaint(bands, ordinal, phase));

    expect(paints).toEqual(bands.map((band, ordinal) => interpolatePaint(
      band,
      bands[(ordinal - 1 + bands.length) % bands.length],
      0.5,
    )));
  });

  it.each(productionPalettes)("returns to the authored palette after one full cycle", ({ bands }) => {
    const atStart = bands.map((_, ordinal) => polygonGradientBandPaint(bands, ordinal, 0));
    const atFullCycle = bands.map((_, ordinal) => polygonGradientBandPaint(bands, ordinal, 1));

    expect(atStart).toEqual(bands.map(authoredPaint));
    expect(atFullCycle).toEqual(atStart);
  });

  it.each(productionPalettes)("keeps authored paint in reduced motion", ({ bands }) => {
    expect(bands.map((_, ordinal) => polygonGradientBandPaint(
      bands,
      ordinal,
      0.37,
      { motionMode: "reduced" },
    ))).toEqual(bands.map(authoredPaint));
    expect(bands.map((_, ordinal) => polygonGradientBandPaint(
      bands,
      ordinal,
      0.37,
      { reducedMotion: true },
    ))).toEqual(bands.map(authoredPaint));
  });

  it("returns authored paint for a null phase and invalid neighboring metadata", () => {
    expect(polygonGradientBandPaint(invalidPalette, 0, 0.5)).toEqual(authoredPaint(invalidPalette[0]));
    expect(polygonGradientBandPaint(productionPalettes[0].bands, 1, null))
      .toEqual(authoredPaint(productionPalettes[0].bands[1]));
    expect(polygonGradientBandPaint(null, 0, 0.5)).toEqual({ color: "#000000", opacity: 0 });
    expect(polygonGradientBandPaint([], 0, 0.5)).toEqual({ color: "#000000", opacity: 0 });
    expect(polygonGradientBandPaint(productionPalettes[0].bands, 99, 0.5))
      .toEqual({ color: "#000000", opacity: 0 });
  });

  it("handles sparse invalid input without throwing", () => {
    const sparse = [productionPalettes[0].bands[0], , productionPalettes[0].bands[2]];
    expect(() => polygonGradientBandPaint(sparse, 0, 0.5)).not.toThrow();
    expect(polygonGradientBandPaint(sparse, 0, 0.5))
      .toEqual(authoredPaint(productionPalettes[0].bands[0]));
  });
});

describe("polygonEntryBandFactor", () => {
  it("reveals bands from the outside inward", () => {
    expect([0, 1, 2, 3, 4].map((ordinal) => polygonEntryBandFactor(ordinal, 5, 0)))
      .toEqual([0, 0, 0, 0, 0]);
    expect(polygonEntryBandFactor(0, 5, 0.2)).toBe(1);
    expect(polygonEntryBandFactor(4, 5, 0.2)).toBe(0);
    expect([0, 1, 2, 3, 4].map((ordinal) => polygonEntryBandFactor(ordinal, 5, 1)))
      .toEqual([1, 1, 1, 1, 1]);
  });

  it("clamps progress and safely rejects invalid ordinals or band counts", () => {
    expect(polygonEntryBandFactor(0, 5, -1)).toBe(0);
    expect(polygonEntryBandFactor(0, 5, 2)).toBe(1);
    expect(polygonEntryBandFactor(0, 0, 0.5)).toBe(0);
    expect(polygonEntryBandFactor(-1, 5, 0.5)).toBe(0);
    expect(polygonEntryBandFactor(5, 5, 0.5)).toBe(0);
    expect(polygonEntryBandFactor(0, 5, Number.NaN)).toBe(0);
  });

  it("handles every band at the start, just after the start, and just before completion", () => {
    const epsilon = 1e-6;
    expect([0, 1, 2, 3, 4].map((ordinal) => polygonEntryBandFactor(ordinal, 5, epsilon)))
      .toEqual([expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number)]);
    expect(polygonEntryBandFactor(0, 5, epsilon)).toBeGreaterThan(0);
    expect(polygonEntryBandFactor(4, 5, epsilon)).toBe(0);
    const nearComplete = [0, 1, 2, 3, 4]
      .map((ordinal) => polygonEntryBandFactor(ordinal, 5, 1 - epsilon));
    expect(nearComplete.every((factor) => factor > 0)).toBe(true);
    expect(nearComplete[4]).toBeLessThan(1);
  });
});
