import { describe, expect, it } from "vitest";
import { nameRectangleFits, placeNameField } from "../../frontend/src/shared/nli-name-field-layout.js";

describe("placeNameField", () => {
  it("skips disconnected narrow edge slivers without omitting their names", () => {
    const polygons = [
      [[0, 0], [12, 0], [12, 20], [0, 20]],
      [[100, 0], [180, 0], [180, 20], [100, 20]],
    ];
    const result = placeNameField(
      ["a", "b", "c"].map(id => ({ id, x: 5, y: 5, width: 8, height: 4 })),
      { polygons, minRowWidth: 24 },
    );
    expect(result.unplaced).toEqual([]);
    expect(result.placements.every(label => label.x > 100)).toBe(true);
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
    const started = performance.now();
    const result = placeNameField(items, { polygons: [[[-5, -5], [850, -5], [850, 170], [-5, 170]]], gap: 1, step: 3 });
    expect(performance.now() - started).toBeLessThan(7000);
    expect(result.placements.length + result.unplaced.length).toBe(1400);
  });

  it("handles a large shared-anchor cluster with neighboring clusters", () => {
    const items = [];
    for (let i = 0; i < 400; i += 1) items.push({ id: `shared-${i}`, x: 500, y: 500, width: 50 + (i % 10), height: 20 });
    for (const [prefix, x, count] of [["west", 127, 127], ["east", 653, 153], ["north", 500, 99]]) {
      for (let i = 0; i < count; i += 1) items.push({ id: `${prefix}-${i}`, x, y: 500, width: 50 + (i % 10), height: 20 });
    }
    const started = performance.now();
    const result = placeNameField(items, { polygons: [[[0, 0], [1000, 0], [1000, 1000], [0, 1000]]], gap: 2, step: 4 });
    expect(performance.now() - started).toBeLessThan(7000);
    expect(result.placements.length + result.unplaced.length).toBe(items.length);
  }, 10000);
});
