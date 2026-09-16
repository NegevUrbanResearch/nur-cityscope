import { describe, expect, it } from "vitest";
import { nameRectangleFits, placeNameField } from "../../frontend/src/shared/nli-name-field-layout.js";

describe("placeNameField", () => {
  it("keeps compact placement as the default", () => {
    const items = Array.from({ length: 6 }, (_, index) => ({
      id: "p-" + index, orderKey: String(index), x: 0, y: 0, width: 8, height: 4,
    }));
    const polygons = [[[0, 0], [40, 0], [40, 40], [0, 40]]];
    expect(placeNameField(items, { polygons, gap: 2, step: 2 }))
      .toEqual(placeNameField(items, {
        polygons, gap: 2, step: 2, verticalDistribution: "compact",
      }));
  });

  it("rejects an unknown vertical distribution", () => {
    expect(() => placeNameField([], {
      polygons: [], verticalDistribution: "stretched",
    })).toThrow(/verticalDistribution/);
  });

  it("spreads occupied rows to the southern usable scanline", () => {
    const items = Array.from({ length: 6 }, (_, index) => ({
      id: "p-" + index, orderKey: String(index), x: 0, y: 0, width: 8, height: 4,
    }));
    const polygons = [[[0, 0], [40, 0], [40, 40], [0, 40]]];
    const compact = placeNameField(items, {
      polygons, gap: 2, step: 2, readingOrder: "rtl",
    });
    const spread = placeNameField(items, {
      polygons, gap: 2, step: 2, readingOrder: "rtl",
      verticalDistribution: "full-height",
    });

    expect(Math.max(...spread.placements.map(({ y }) => y))).toBe(38);
    expect(Math.max(...compact.placements.map(({ y }) => y))).toBeLessThan(38);
    expect(spread.placements.map(({ id, x, width, height }) => ({ id, x, width, height })))
      .toEqual(compact.placements.map(({ id, x, width, height }) => ({ id, x, width, height })));
    expect(spread.placements.every(rect => nameRectangleFits(rect, polygons))).toBe(true);
    expectPairwiseGap(spread.placements, 2);
  });

  it("returns the compact baseline when only one row is occupied", () => {
    const items = [{ id: "a", x: 0, y: 0, width: 8, height: 4 }];
    const polygons = [[[0, 0], [40, 0], [40, 40], [0, 40]]];
    expect(placeNameField(items, {
      polygons, verticalDistribution: "full-height",
    })).toEqual(placeNameField(items, { polygons }));
  });

  it("selects the greatest tested lower scale when the target is blocked", () => {
    const items = Array.from({ length: 7 }, (_, index) => ({
      id: "p-" + index, orderKey: String(index), x: 0, y: 0, width: 8, height: 4,
    }));
    const polygons = [[[0, 0], [40, 0], [40, 40], [0, 40]]];
    const options = {
      polygons, gap: 2, step: 2, readingOrder: "rtl",
      verticalDistribution: "full-height",
      candidateFits: rect => rect.x >= 20 || rect.y <= 30,
    };
    const compact = placeNameField(items, { ...options, verticalDistribution: "compact" });
    const spread = placeNameField(items, options);
    const reversed = placeNameField([...items].reverse(), options);
    const compactMax = Math.max(...compact.placements.map(({ y }) => y));
    const spreadMax = Math.max(...spread.placements.map(({ y }) => y));
    const greatestValidScale = 6 - ((6 - 1) * 9) / (32 - 1);

    expect(spreadMax).toBeGreaterThan(compactMax);
    expect(spreadMax).toBeLessThan(38);
    expect(spreadMax).toBeLessThanOrEqual(30);
    expect(greatestValidScale).toBe(141 / 31);
    expect(spreadMax).toBeCloseTo(2 + (8 - 2) * greatestValidScale, 10);
    expect(new Map(reversed.placements.map(p => [p.id, p])))
      .toEqual(new Map(spread.placements.map(p => [p.id, p])));
    expect(spread.placements.every(rect => nameRectangleFits(rect, polygons))).toBe(true);
    expect(spread.placements.every(options.candidateFits)).toBe(true);
    expectPairwiseGap(spread.placements, 2);
  });

  it("returns the unchanged baseline when every stretch is blocked", () => {
    const items = Array.from({ length: 7 }, (_, index) => ({
      id: "p-" + index, orderKey: String(index), x: 0, y: 0, width: 8, height: 4,
    }));
    const polygons = [[[0, 0], [40, 0], [40, 40], [0, 40]]];
    const candidateFits = rect => rect.y <= 8 || rect.id === "p-0";
    const compact = placeNameField(items, {
      polygons, gap: 2, step: 2, readingOrder: "rtl", candidateFits,
    });
    const spread = placeNameField(items, {
      polygons, gap: 2, step: 2, readingOrder: "rtl", candidateFits,
      verticalDistribution: "full-height",
    });
    expect(spread).toEqual(compact);
    expectPairwiseGap(spread.placements, 2);
  });

  function expectPairwiseGap(placements, gap) {
    for (let i = 0; i < placements.length; i += 1) {
      for (let j = i + 1; j < placements.length; j += 1) {
        const a = placements[i]; const b = placements[j];
        const xGap = Math.abs(a.x - b.x) - (a.width + b.width) / 2;
        const yGap = Math.abs(a.y - b.y) - (a.height + b.height) / 2;
        expect(xGap >= gap || yGap >= gap).toBe(true);
      }
    }
  }

  it("bounds full-height candidate validation", () => {
    const items = Array.from({ length: 6 }, (_, index) => ({
      id: "p-" + index, orderKey: String(index), x: 0, y: 0, width: 8, height: 4,
    }));
    const polygons = [[[0, 0], [40, 0], [40, 40], [0, 40]]];
    const makeCounter = () => {
      let calls = 0;
      return { fit: () => { calls += 1; return true; }, calls: () => calls };
    };
    const compactCounter = makeCounter();
    const fullCounter = makeCounter();
    const compact = placeNameField(items, {
      polygons, gap: 2, step: 2, readingOrder: "rtl", candidateFits: compactCounter.fit,
    });
    const spread = placeNameField(items, {
      polygons, gap: 2, step: 2, readingOrder: "rtl",
      candidateFits: fullCounter.fit, verticalDistribution: "full-height",
    });
    const finiteShelfProbeAllowance = 40 * Math.ceil(40 / 6);
    expect(fullCounter.calls() - compactCounter.calls())
      .toBeLessThanOrEqual(finiteShelfProbeAllowance + 32 * spread.placements.length);
    expect(fullCounter.calls() - compactCounter.calls())
      .toBe(spread.placements.length + 1);
    expect(spread.unplaced).toEqual(compact.unplaced);

    const candidateFits = rect => rect.y <= 8 || rect.id === "p-0";
    const fallbackCompactCounter = makeCounter();
    const fallbackFullCounter = makeCounter();
    const fallbackItems = items.concat({
      id: "p-6", orderKey: "6", x: 0, y: 0, width: 8, height: 4,
    });
    const fallbackCompact = placeNameField(fallbackItems, {
      polygons, gap: 2, step: 2, readingOrder: "rtl",
      candidateFits: rect => { fallbackCompactCounter.fit(); return candidateFits(rect); },
    });
    const fallbackSpread = placeNameField(fallbackItems, {
      polygons, gap: 2, step: 2, readingOrder: "rtl",
      candidateFits: rect => { fallbackFullCounter.fit(); return candidateFits(rect); },
      verticalDistribution: "full-height",
    });
    expect(fallbackFullCounter.calls() - fallbackCompactCounter.calls())
      .toBeLessThanOrEqual(finiteShelfProbeAllowance + 32 * fallbackSpread.placements.length);
    expect(fallbackSpread.unplaced).toEqual(fallbackCompact.unplaced);
  });

  it("uses a narrow safe interval when a complete label fits", () => {
    const polygons = [
      [[0, 0], [12, 0], [12, 4], [0, 4]],
      [[100, 0], [118, 0], [118, 4], [100, 4]],
    ];
    const result = placeNameField(
      ["a", "b", "c"].map(id => ({ id, x: 5, y: 2, width: 8, height: 2 })),
      { polygons, minRowWidth: 24 },
    );
    expect(result.unplaced).toEqual([]);
    expect(result.placements.some(label => label.x < 12)).toBe(true);
    expect(result.placements.every(label => nameRectangleFits(label, polygons))).toBe(true);
  });

  it("skips a contained candidate rejected by projector fit", () => {
    const result = placeNameField([{ id: "x", x: 10, y: 5, width: 8, height: 4 }], {
      polygons: [[[0, 0], [20, 0], [20, 10], [0, 10]]],
      candidateFits: candidate => candidate.x < 8,
    });
    expect(result.unplaced).toEqual([]);
    expect(result.placements[0].x).toBeLessThan(8);
  });

  it("fills a Hebrew reading row right-to-left in alphabetical order", () => {
    const result = placeNameField([
      { id: "b", sortKey: "בית", x: 5, y: 5, width: 8, height: 4 },
      { id: "a", sortKey: "אור", x: 5, y: 5, width: 8, height: 4 },
      { id: "c", sortKey: "שלום", x: 5, y: 5, width: 8, height: 4 },
    ], { polygons: [[[0, 0], [20, 0], [20, 20], [0, 20]]], readingOrder: "rtl" });
    expect(result.unplaced).toEqual([]);
    const byId = new Map(result.placements.map((placement) => [placement.id, placement]));
    expect(byId.get("a").y).toBe(byId.get("b").y);
    expect(byId.get("a").x).toBeGreaterThan(byId.get("b").x);
    expect(byId.get("b").y).toBeLessThan(byId.get("c").y);
  });

  it("uses an explicit order key without guessing a surname", () => {
    const result = placeNameField([
      { id: "second", orderKey: "ב", x: 5, y: 5, width: 8, height: 4 },
      { id: "first", orderKey: "א", x: 5, y: 5, width: 8, height: 4 },
    ], { polygons: [[[0, 0], [30, 0], [30, 12], [0, 12]]], orderBy: "orderKey", readingOrder: "rtl" });
    const byId = new Map(result.placements.map((placement) => [placement.id, placement]));
    expect(byId.get("first").x).toBeGreaterThan(byId.get("second").x);
  });

  it("keeps variable-width labels in RTL reading order", () => {
    const result = placeNameField([
      { id: "a", orderKey: "א", x: 5, y: 5, width: 4, height: 4 },
      { id: "b", orderKey: "ב", x: 5, y: 5, width: 12, height: 4 },
      { id: "c", orderKey: "ג", x: 5, y: 5, width: 6, height: 4 },
    ], { polygons: [[[0, 0], [40, 0], [40, 12], [0, 12]]], orderBy: "orderKey", readingOrder: "rtl" });
    const byId = new Map(result.placements.map((placement) => [placement.id, placement]));
    expect(byId.get("a").x).toBeGreaterThan(byId.get("b").x);
    expect(byId.get("b").x).toBeGreaterThan(byId.get("c").x);
  });
  it("rejects a rectangle crossing a concave polygon notch", () => {
    const polygon = [[0, 0], [30, 0], [30, 30], [20, 30], [20, 10], [10, 10], [10, 30], [0, 30]];
    expect(nameRectangleFits({ x: 15, y: 15, width: 8, height: 12 }, [polygon])).toBe(false);
    expect(nameRectangleFits({ x: 5, y: 5, width: 6, height: 6 }, [polygon])).toBe(true);
  });

  it("places clustered anchors without overlap and keeps the requested gap", () => {
    const { placements, unplaced } = placeNameField(
      ["a", "b", "c", "d"].map((id) => ({ id, x: 10, y: 10, width: 8, height: 4 })),
      { polygons: [[[-20, -20], [40, -20], [40, 40], [-20, 40]]], gap: 2, step: 4 },
    );
    expect(unplaced).toEqual([]);
    for (let i = 0; i < placements.length; i += 1) {
      for (let j = i + 1; j < placements.length; j += 1) {
        const xGap = Math.abs(placements[i].x - placements[j].x) - (placements[i].width + placements[j].width) / 2;
        const yGap = Math.abs(placements[i].y - placements[j].y) - (placements[i].height + placements[j].height) / 2;
        expect(xGap >= 2 || yGap >= 2).toBe(true);
      }
    }
  });

  it("keeps every placed rectangle inside a polygon and preserves dimensions", () => {
    const polygon = [[0, 0], [30, 0], [30, 20], [0, 20]];
    const result = placeNameField([{ id: "x", x: 15, y: 10, width: 8, height: 4 }], { polygons: [polygon] });
    expect(result.unplaced).toEqual([]);
    expect(result.placements[0]).toMatchObject({ id: "x", width: 8, height: 4 });
    expect(nameRectangleFits(result.placements[0], [polygon])).toBe(true);
  });

  it("resolves dense nearby clusters globally and is independent of input order", () => {
    const items = Array.from({ length: 14 }, (_, i) => ({ id: `id-${i}`, x: 50 + (i % 3), y: 50 + Math.floor(i / 3), width: 7 + (i % 2), height: 3 }));
    const polygons = [[[-10, -10], [120, -10], [120, 120], [-10, 120]]];
    const first = placeNameField(items, { polygons, gap: 1, step: 3 });
    const second = placeNameField([...items].reverse(), { polygons, gap: 1, step: 3 });
    expect(new Map(first.placements.map((p) => [p.id, p]))).toEqual(new Map(second.placements.map((p) => [p.id, p])));
    expect(first.placements.length + first.unplaced.length).toBe(items.length);
  });

  it("reports every overflow item", () => {
    const result = placeNameField(
      [{ id: "z", x: 5, y: 5, width: 10, height: 10 }, { id: "a", x: 5, y: 5, width: 10, height: 10 }],
      { polygons: [[[0, 0], [10, 0], [10, 10], [0, 10]]] },
    );
    expect(result.placements).toHaveLength(1);
    expect(result.unplaced).toEqual(["z"]);
  });

  it("treats overlapping polygons as a union", () => {
    const result = placeNameField([{ id: "x", x: 15, y: 5, width: 8, height: 4 }], {
      polygons: [[[0, 0], [10, 0], [10, 10], [0, 10]], [[10, 0], [20, 0], [20, 10], [10, 10]]],
    });
    expect(result.unplaced).toEqual([]);
  });

  it("rejects invalid dimensions and nonfinite values", () => {
    expect(() => placeNameField([{ id: "x", x: 0, y: 0, width: 0, height: 2 }], { polygons: [] })).toThrow(/width/i);
    expect(() => placeNameField([{ id: "x", x: Infinity, y: 0, width: 2, height: 2 }], { polygons: [] })).toThrow(/finite/i);
    expect(() => placeNameField([{ id: 3, x: 0, y: 0, width: 2, height: 2 }], { polygons: [] })).toThrow(/string/i);
  });

  it("does not mutate input arrays", () => {
    const items = [{ id: "x", x: 5, y: 5, width: 2, height: 2 }];
    const polygons = [[[0, 0], [10, 0], [10, 10], [0, 10]]];
    const beforeItems = JSON.stringify(items);
    const beforePolygons = JSON.stringify(polygons);
    placeNameField(items, { polygons });
    expect(JSON.stringify(items)).toBe(beforeItems);
    expect(JSON.stringify(polygons)).toBe(beforePolygons);
  });

  it("accounts for a realistic 1400 item dataset", () => {
    const items = Array.from({ length: 1400 }, (_, i) => ({ id: `person-${i}`, x: (i % 70) * 12 + 5, y: Math.floor(i / 70) * 8 + 5, width: 8, height: 3 }));
    const polygons = [[[-5, -5], [850, -5], [850, 170], [-5, 170]]];
    const started = performance.now();
    const result = placeNameField(items, { polygons, gap: 1, step: 3 });
    const fullHeight = placeNameField(items, { polygons, gap: 1, step: 3, verticalDistribution: "full-height" });
    expect(performance.now() - started).toBeLessThan(7000);
    expect(result.placements.length + result.unplaced.length).toBe(1400);
    expect(fullHeight.placements.length + fullHeight.unplaced.length).toBe(1400);
  });

  it("handles a large shared-anchor cluster with neighboring clusters", () => {
    const items = [];
    for (let i = 0; i < 400; i += 1) items.push({ id: `shared-${i}`, x: 500, y: 500, width: 50 + (i % 10), height: 20 });
    for (const [prefix, x, count] of [["west", 127, 127], ["east", 653, 153], ["north", 500, 99]]) {
      for (let i = 0; i < count; i += 1) items.push({ id: `${prefix}-${i}`, x, y: 500, width: 50 + (i % 10), height: 20 });
    }
    const started = performance.now();
    const polygons = [[[0, 0], [1000, 0], [1000, 1000], [0, 1000]]];
    const result = placeNameField(items, { polygons, gap: 2, step: 4 });
    const fullHeight = placeNameField(items, { polygons, gap: 2, step: 4, verticalDistribution: "full-height" });
    expect(performance.now() - started).toBeLessThan(7000);
    expect(result.placements.length + result.unplaced.length).toBe(items.length);
    expect(fullHeight.placements.length + fullHeight.unplaced.length).toBe(items.length);
  }, 10000);
});
