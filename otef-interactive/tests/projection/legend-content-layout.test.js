import { describe, expect, test } from "vitest";
import { layoutProjectionLegend, resolveLegendRasterSize } from "../../frontend/src/projection/legend-content-layout.js";

function metricFor(fontPx) {
  return (text) => {
    const width = [...String(text)].reduce((sum, character) => sum + (/[\u0590-\u08ff]/u.test(character) ? 9 : character === " " ? 4 : 8), 0) * fontPx / 16;
    return { width, actualBoundingBoxLeft: fontPx / 16, actualBoundingBoxRight: Math.max(0, width - fontPx / 16), actualBoundingBoxAscent: fontPx * 0.75, actualBoundingBoxDescent: fontPx * 0.25, fontBoundingBoxAscent: fontPx * 0.75, fontBoundingBoxDescent: fontPx * 0.25 };
  };
}

function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function paintedBounds(layout) {
  const edges = layout.placements.flatMap((placement) => {
    const label = placement.labelGeometry;
    const glyphs = label.metrics.map((metric, index) => {
      const offset = label.align === "right" ? -metric.width : 0;
      const baseline = label.y + label.lineHeight * index;
      return [label.x + offset - metric.left, baseline - metric.ascent,
        label.x + offset + metric.right, baseline + metric.descent];
    });
    const symbols = placement.symbolGeometry.components.map((part) => {
      const stroke = Math.max(1, Number(part.part.strokeWidth) || 1) / (part.part.shape === "diamond" ? Math.SQRT2 : 2);
      const radius = part.part.alarmShockwave ? Math.max(part.width, part.height) / 2 + 16 * 0.28 + 0.8 : 0;
      const halfWidth = Math.max(part.width / 2 + stroke, radius);
      const halfHeight = Math.max(part.height / 2 + stroke, radius);
      return [part.x - halfWidth, part.y - halfHeight, part.x + halfWidth, part.y + halfHeight];
    });
    return [...glyphs, ...symbols];
  });
  const x = Math.min(...edges.map((edge) => edge[0])) * layout.scale;
  const y = Math.min(...edges.map((edge) => edge[1])) * layout.scale;
  return { x, y, width: Math.max(...edges.map((edge) => edge[2])) * layout.scale - x,
    height: Math.max(...edges.map((edge) => edge[3])) * layout.scale - y };
}

function fixture() {
  return Array.from({ length: 12 }, (_, index) => ({
    id: `item-${index}`,
    label: ["ציר חדירה", "Unconfirmed approach", "North / south corridor", "אבגדהוזחטיכלמנסעפצקרשת"][index % 4],
    components: index % 3 === 0
      ? [{ shape: "line", strokeWidth: 2, dash: [4, 2] }, { shape: "point", fill: "#123456" }]
      : [{ shape: index % 2 ? "square" : "diamond", stroke: "#456789" }],
    packId: index < 6 ? "roads" : "rail",
  }));
}

describe("projection legend content layout", () => {
  test.each([1, 2, 3])("fixed %i columns covers items in contiguous balanced chunks", (columns) => {
    const blocks = [{ id: "roads", layers: [{ items: fixture() }] }];
    const original = structuredClone(blocks);
    deepFreeze(blocks);
    const measureText = metricFor(24);
    const settings = deepFreeze({ blocks, width: 720, height: 320, fontPx: 24, columns, language: "he", measureText });
    const layout = layoutProjectionLegend(settings);
    expect(layout.columns).toBe(columns);
    expect(layout.scale).toBeGreaterThan(0);
    expect(layout.scale).toBeLessThanOrEqual(1);
    expect(layout.effectiveFontPx).toBeLessThanOrEqual(24);
    expect(layout.placements.map(({ itemId }) => itemId)).toEqual(fixture().map(({ id }) => id));
    expect(layout.placements.every((placement) => Number.isFinite(placement.x + placement.y + placement.width + placement.height))).toBe(true);
    const widths = Array.from({ length: columns }, (_, column) => layout.placements.filter((p) => p.column === column));
    expect(widths.map((items) => items.length)).toEqual(Array.from({ length: columns }, (_, i) => Math.floor(12 / columns) + (i < 12 % columns ? 1 : 0)));
    expect(widths.flat().every((placement) => placement.width === widths[0][0].width && placement.x === widths[placement.column][0].x)).toBe(true);
    expect(layout.placements.some((placement) => placement.symbolGeometry.components.length > 1)).toBe(true);
    expect(layout.paintBounds.x).toBeGreaterThanOrEqual(-0.001);
    expect(layout.paintBounds.y).toBeGreaterThanOrEqual(-0.001);
    expect(layout.paintBounds.x + layout.paintBounds.width).toBeLessThanOrEqual(720.001);
    expect(layout.paintBounds.y + layout.paintBounds.height).toBeLessThanOrEqual(320.001);
    expect(blocks).toEqual(original);
    expect(Object.isFrozen(blocks[0].layers[0].items[0].components[0])).toBe(true);
  });

  test("Auto is deterministic, compares fixed layouts, and prefers fewer columns on ties", () => {
    const blocks = [{ id: "p", layers: [{ items: [{ id: "a", label: "A" }] }] }];
    const measureText = metricFor(20);
    const fixed = [1, 2, 3].map((columns) => layoutProjectionLegend({ blocks, width: 500, height: 200, fontPx: 20, columns, measureText }));
    const automatic = layoutProjectionLegend({ blocks, width: 500, height: 200, fontPx: 20, measureText });
    expect(automatic).toEqual(layoutProjectionLegend({ blocks, width: 500, height: 200, fontPx: 20, measureText }));
    expect(automatic.columns).toBe(1);
    expect(automatic.scale).toBe(Math.max(...fixed.map(({ scale }) => scale)));
  });

  test("shrinks to fit narrow and short boxes while a large box remains at scale one", () => {
    const blocks = [{ id: "p", layers: [{ items: fixture() }] }];
    const small = layoutProjectionLegend({ blocks, width: 38.4, height: 21.6, fontPx: 24, columns: 1, measureText: metricFor(24) });
    expect(small.scale).toBeGreaterThan(0);
    expect(small.scale).toBeLessThan(1);
    expect(small.paintBounds.x + small.paintBounds.width).toBeLessThanOrEqual(38.4 + 1e-7);
    expect(small.paintBounds.y + small.paintBounds.height).toBeLessThanOrEqual(21.6 + 1e-7);
    const large = layoutProjectionLegend({ blocks, width: 2000, height: 1000, fontPx: 24, columns: 1, measureText: metricFor(24) });
    expect(large.scale).toBe(1);
  });

  test("empty blocks and a fixed empty column still return finite bounds", () => {
    const empty = layoutProjectionLegend({ blocks: [], width: 200, height: 100, fontPx: 18, columns: 3, measureText: metricFor(18) });
    expect(empty.columns).toBe(3);
    expect(empty.placements).toEqual([]);
    expect(empty.paintBounds.width).toBeGreaterThanOrEqual(0);
    const one = layoutProjectionLegend({ blocks: [{ id: "p", layers: [{ items: [{ id: "a", label: "A" }] }] }], width: 200, height: 100, fontPx: 18, columns: 3, measureText: metricFor(18) });
    expect(one.placements).toHaveLength(1);
    expect(one.placements[0].column).toBe(0);
  });

  test("equal-width safe bound includes widest item in every column and pack boundaries", () => {
    const blocks = [{ id: "p1", layers: [{ items: [{ id: "wide", label: "W".repeat(12) }, { id: "narrow", label: "N" }] }] }, { id: "p2", layers: [{ items: [{ id: "last", label: "Z" }] }] }];
    const layout = layoutProjectionLegend({ blocks, width: 280, height: 120, fontPx: 16, columns: 2, measureText: (text) => ({ ...metricFor(16)(text), width: text === "W".repeat(12) ? 100 : 10 }) });
    expect(layout.scale).toBeGreaterThan(0);
    expect(layout.placements.map((p) => p.packId)).toEqual(["p1", "p1", "p2"]);
    expect(layout.placements[0].column).toBe(0);
    expect(layout.placements[1].column).toBe(0);
    expect(layout.placements[2].column).toBe(1);
    const separated = layoutProjectionLegend({
      blocks: [
        { id: "first", layers: [{ items: [{ id: "a", label: "A" }, { id: "b", label: "B" }] }] },
        { id: "second", layers: [{ items: [{ id: "c", label: "C" }, { id: "d", label: "D" }, { id: "e", label: "E" }] }] },
      ],
      width: 400, height: 200, fontPx: 16, columns: 2, measureText: metricFor(16),
    });
    expect(separated.placements[2].column).toBe(0);
    expect(separated.placements[2].y).toBeCloseTo(separated.placements[1].y + separated.placements[1].height + 16 * 1.0, 6);
  });

  test("uses first strong label direction and wraps without added letter spacing", () => {
    const blocks = [{ id: "p", layers: [{ items: [
      { id: "mixed", label: "123 (אב) English", components: [{ shape: "point" }] },
      { id: "english", label: "... 42 English", components: [{ shape: "point" }] },
    ] }] }];
    const layout = layoutProjectionLegend({ blocks, width: 190, height: 120, fontPx: 20, columns: 1, language: "he", measureText: metricFor(20) });
    expect(layout.placements[0].labelDirection).toBe("rtl");
    expect(layout.placements[1].labelDirection).toBe("ltr");
    expect(layout.placements.every((p) => p.labelLines.length >= 1)).toBe(true);
  });

  test.each([
    ["Москва דרך", "ltr"],
    ["Αθήνα שלום", "ltr"],
    ["... 42 Москва דרך", "ltr"],
    ["... 42 Αθήνα שלום", "ltr"],
    ["... 42 עברית English", "rtl"],
  ])("uses the first Unicode letter for direction in %s", (label, direction) => {
    const blocks = [{ id: "p", layers: [{ items: [{ id: "mixed", label }] }] }];
    const layout = layoutProjectionLegend({ blocks, width: 240, height: 120, fontPx: 20, columns: 1, language: "he", measureText: metricFor(20) });
    expect(layout.placements[0].labelDirection).toBe(direction);
  });

  test("wraps whitespace labels, preserves an unbroken word, and fits measured ink overhang", () => {
    const blocks = [{ id: "p", layers: [{ items: [
      { id: "wrapped", label: "Northbound railway approach route", components: [{ shape: "square", alarmShockwave: true }] },
      { id: "word", label: "Unbrokenword", components: [{ shape: "line", strokeWidth: 3 }] },
    ] }] }];
    const layout = layoutProjectionLegend({ blocks, width: 210, height: 160, fontPx: 18, columns: 1, measureText: metricFor(18) });
    expect(layout.placements[0].labelLines.length).toBeGreaterThan(1);
    expect(layout.placements[1].labelLines).toContain("Unbrokenword");
    expect(layout.placements[0].symbolGeometry.components[0].extent).toBeGreaterThan(0);
    expect(layout.placements[0].labelGeometry.metrics[0].right).toBeGreaterThan(0);
    const first = layout.placements[0];
    const symbolEdges = first.symbolGeometry.components.map((component) => [component.x - component.width / 2 - component.extent, component.x + component.width / 2 + component.extent]);
    expect(Math.min(...symbolEdges.map(([left]) => left))).toBeGreaterThanOrEqual(first.x - 1e-7);
    expect(Math.max(...symbolEdges.map(([, right]) => right))).toBeLessThanOrEqual(first.x + first.width + 1e-7);
  });

  test("uses Canvas text width once with zero letter spacing at the wrap threshold", () => {
    const blocks = [{ id: "p", layers: [{ items: [{ id: "threshold", label: "aa bb" }] }] }];
    const measureText = (text) => ({ width: text === "aa bb" ? 57.5 : 20, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text === "aa bb" ? 57.5 : 20, actualBoundingBoxAscent: 12, actualBoundingBoxDescent: 4 });
    const layout = layoutProjectionLegend({ blocks, width: 100, height: 100, fontPx: 16, columns: 1, measureText });
    expect(layout.placements[0].labelLines).toEqual(["aa bb"]);
  });

  test.each(["he", "en"])("compensates glyph overhang and reports the painted union in %s panels", (language) => {
    const blocks = deepFreeze([{ id: "p", layers: [{ items: [
      { id: "english", label: "English", components: [{ shape: "line", strokeWidth: 2, alarmShockwave: true }] },
      { id: "hebrew", label: "עברית", components: [{ shape: "square", strokeWidth: 2 }] },
    ] }] }]);
    const measureText = () => ({ width: 60, actualBoundingBoxLeft: 20, actualBoundingBoxRight: 80,
      actualBoundingBoxAscent: 35, actualBoundingBoxDescent: 12 });
    for (const [width, height] of [[240, 240], [100, 50], [38.4, 21.6]]) {
      const layout = layoutProjectionLegend({ blocks, width, height, fontPx: 16, columns: 1, language, measureText });
      const bounds = paintedBounds(layout);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1e-7);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(height + 1e-7);
      for (const key of ["x", "y", "width", "height"]) expect(layout.paintBounds[key]).toBeCloseTo(bounds[key], 7);
    }
  });

  test("uses saved percentages and canonical output dimensions for raster size", () => {
    expect(resolveLegendRasterSize(deepFreeze({ widthPct: 2, heightPct: 2 }))).toEqual({ width: 38, height: 21 });
    expect(resolveLegendRasterSize({ widthPct: 25, heightPct: 50, paintBounds: { width: 10, height: 5 } })).toEqual({ width: 480, height: 540 });
    expect(resolveLegendRasterSize({ widthPct: 0, heightPct: 0 })).toEqual({ width: 1, height: 1 });
    expect(resolveLegendRasterSize({ widthPct: 0.001, heightPct: 0.001 })).toEqual({ width: 1, height: 1 });
  });

  test("reuses measured text metrics across safe bounds and fitting trials", () => {
    const calls = new Map();
    const measureText = (text) => {
      calls.set(text, (calls.get(text) || 0) + 1);
      return metricFor(16)(text);
    };
    const blocks = deepFreeze([{ id: "p", layers: [{ items: [{ id: "a", label: "Longword" }] }] }]);
    const layout = layoutProjectionLegend({ blocks, width: 38.4, height: 21.6, fontPx: 16, measureText });
    expect(layout.scale).toBeLessThan(1);
    expect(calls.get("Longword")).toBe(1);
  });

  test.each([undefined, 50])("fits actual diamond miter corners with stroke width %s", (strokeWidth) => {
    const blocks = deepFreeze([{ id: "p", layers: [{ items: [
      { id: "diamond", label: "A", components: [{ shape: "diamond", strokeWidth, stroke: "#fff" }] },
    ] }] }]);
    for (const language of ["he", "en"]) {
      for (const columns of [1, 2, 3]) {
        for (const [width, height] of [[200, 100], [38.4, 21.6]]) {
          const layout = layoutProjectionLegend({ blocks, width, height, fontPx: 8, columns, language, measureText: metricFor(8) });
          const diamond = layout.placements[0].symbolGeometry.components[0];
          const miter = (strokeWidth || 1) / Math.SQRT2;
          const corners = [diamond.x - diamond.width / 2 - miter, diamond.y - diamond.height / 2 - miter,
            diamond.x + diamond.width / 2 + miter, diamond.y + diamond.height / 2 + miter].map((edge) => edge * layout.scale);
          expect(corners[0]).toBeGreaterThanOrEqual(0);
          expect(corners[1]).toBeGreaterThanOrEqual(0);
          expect(corners[2]).toBeLessThanOrEqual(width + 1e-7);
          expect(corners[3]).toBeLessThanOrEqual(height + 1e-7);
          const bounds = paintedBounds(layout);
          for (const key of ["x", "y", "width", "height"]) expect(layout.paintBounds[key]).toBeCloseTo(bounds[key], 7);
          expect(diamond.part).toBe(blocks[0].layers[0].items[0].components[0]);
        }
      }
    }
  });

});
