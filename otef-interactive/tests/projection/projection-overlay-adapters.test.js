import { describe, expect, test } from "vitest";
import { createProjectionCaptionAdapter, drawProjectionCaptionForSpan } from "../../frontend/src/projection/projection-caption-adapter.js";
import { createProjectionLegendAdapter } from "../../frontend/src/projection/projection-legend-adapter.js";
import { createProjectionPatternAdapter } from "../../frontend/src/projection/projection-pattern-adapter.js";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";

function canvasFactory() {
  const calls = [];
  const context = new Proxy({ calls }, { get(target, key) { if (key === "calls") return calls; if (key in target) return target[key]; if (key === "measureText") return () => ({ width: 12, actualBoundingBoxAscent: 18, actualBoundingBoxDescent: 5, fontBoundingBoxAscent: 12, fontBoundingBoxDescent: 3 }); if (key === "createPattern") return () => ({}); if (key === "fill") return () => calls.push([key, target.fillStyle, target.globalAlpha]); return (...args) => calls.push([key, ...args]); } });
  return { width: 0, height: 0, context, getContext: () => context };
}

const layout = { leftPct: 10, topPct: 20, widthPct: 30, heightPct: 10, fontPx: 24, rotateDeg: 12 };

describe("projection overlay adapters", () => {
  test("only left output emits a browser clock descriptor", () => {
    const descriptor = { source: {}, matrix: [] };
    const adapter = { draw: vi.fn(() => descriptor) };
    expect(drawProjectionCaptionForSpan(adapter, "left")).toBe(descriptor);
    expect(drawProjectionCaptionForSpan(adapter, "right")).toBe(null);
    expect(drawProjectionCaptionForSpan(adapter, null)).toBe(null);
    expect(adapter.draw).toHaveBeenCalledTimes(1);
  });

  test("caption paints canonical clock text and returns placement", () => {
    const c = canvasFactory(); const adapter = createProjectionCaptionAdapter({ canvasFactory: () => c });
    adapter.sync({ layout, snapshot: { visible: true, model: { clockLabel: "07:05", rows: [] } } });
    const descriptor = adapter.draw();
    expect(descriptor.source).toBe(c); expect(descriptor.matrix).toHaveLength(9);
    expect(c.context.calls.some(([name, value]) => name === "fillText" && value === "07:05")).toBe(true);
    expect(c.context.font).toContain("800");
    expect(c.context.textAlign).toBe("start");
    expect(c.context.textBaseline).toBe("alphabetic");
    expect(descriptor.matrix[1]).toBeCloseTo(Math.sin(Math.PI / 15) * 0.3 * (1920 / 1080));
    expect(descriptor.matrix[4]).toBeCloseTo(Math.cos(Math.PI / 15) * 0.1);
  });

  test("caption rerasterizes successive canonical timeline snapshots without another sync event", () => {
    const c = canvasFactory(); const adapter = createProjectionCaptionAdapter({ canvasFactory: () => c });
    const layoutForTest = { ...layout, rotateDeg: 0 };
    adapter.sync({ layout: layoutForTest, snapshot: { visible: true, model: { clockLabel: "06:29", rows: [] } } });
    adapter.draw();
    const first = c.context.calls.filter(([name, value]) => name === "fillText" && value === "06:29").length;
    adapter.sync({ layout: layoutForTest, snapshot: { visible: true, model: { clockLabel: "06:36", rows: [] } } });
    adapter.draw();
    expect(c.context.calls.filter(([name, value]) => name === "fillText" && value === "06:29").length).toBe(first);
    expect(c.context.calls.some(([name, value]) => name === "fillText" && value === "06:36")).toBe(true);
  });

  test("legend lays out a wrapping row with direction and CSS symbol semantics", () => {
    const c = canvasFactory(); const adapter = createProjectionLegendAdapter({ canvasFactory: () => c });
    adapter.sync({
      layout: { ...layout, widthPct: 40, heightPct: 40, fontPx: 16 }, language: "he", spanId: "left", visible: true,
      pages: [["pack"]], pageIndex: 0, blocks: [{ id: "pack", pack: { id: "roads", name: "קבוצה" }, layers: [{ items: [
        { label: "תווית ארוכה נעטפת", components: [{ shape: "line", stroke: "#fff", dash: [4, 2], carrier: "#000", strokeWidth: 2 }] },
        { label: "ריבוע", components: [{ shape: "square", fill: "#123456", fillOpacity: 0.4, stroke: "#fff", strokeOpacity: 0.6 }] },
        { label: "יהלום", components: [{ shape: "diamond", fill: "#654321", hatchStyle: "repeating-linear-gradient(45deg, #fff, #fff 1px, transparent 1px, transparent 8px)" }] },
      ] }] }] });
    expect(adapter.draw(500).source).toBe(c);
    expect(c.context.calls.some(([name, value]) => name === "fillText" && value === "קבוצה")).toBe(false);
    expect(c.context.calls.some(([name, value]) => name === "fillText" && value === "תווית ארוכה נעטפת")).toBe(true);
    expect(c.context.calls.some(([name]) => name === "setLineDash")).toBe(true);
    expect(c.context.calls.some(([name]) => name === "clip")).toBe(true);
    expect(c.context.direction).toBe("rtl");
    const callCount = c.context.calls.length;
    expect(adapter.draw(501).source).toBe(adapter.draw(502).source);
    expect(c.context.calls.length).toBe(callCount);
    adapter.sync({ visible: false });
    expect(adapter.draw()).toBeNull();
  });

  test("legend allocates CSS outer symbol slots and intrinsic mixed-direction labels", () => {
    const c = canvasFactory();
    const adapter = createProjectionLegendAdapter({ canvasFactory: () => c });
    adapter.sync({
      layout: { ...layout, widthPct: 40, heightPct: 40, fontPx: 28, rotateDeg: 0 },
      language: "en",
      spanId: "left",
      visible: true,
      pages: [["pack"]],
      pageIndex: 0,
      blocks: [{ id: "pack", pack: { id: "roads", name: "Group" }, layers: [{ items: [
        { label: "אב", components: [{ shape: "point", fill: "#123456" }] },
        { label: "Square", components: [{ shape: "square", fill: "#123456" }] },
      ] }] }],
    });
    adapter.draw();
    const point = c.context.calls.find(([name]) => name === "arc");
    const square = c.context.calls.find(([name]) => name === "rect");
    const label = c.context.calls.find(([name, value]) => name === "fillText" && value === "אב");
    const padding = 28 * 0.5;
    const canvasWidth = 1920 * 0.4;
    const expectedPointCenter = padding + 28 * 0.32 + 28 * 0.55 / 2;
    const itemGap = 28 * 18 / 16;
    const firstWidth = Math.max(28 * 1.23, 28 * 0.55 + 28 * 0.32 * 2) + 28 * 0.36
      + (12 + Math.max(0, "אב".length - 1) * 28 * 0.01);
    const squareCenterX = square[1] + square[3] / 2;
    expect(point?.[1]).toBeCloseTo(expectedPointCenter, 3);
    expect(label?.[2]).toBeGreaterThan(point?.[1]);
    expect(c.context.calls.some(([name, value]) => name === "fillText" && value === "Group")).toBe(false);
    expect(squareCenterX).toBeGreaterThan(point[1]);
    expect(squareCenterX).toBeCloseTo(padding + firstWidth + itemGap + 28 * 0.32 + 28 * 0.55 / 2, 1);
    expect(square[1]).toBeLessThan(canvasWidth / 2);
  });

  test("legend places the first RTL item at inline-start", () => {
    const c = canvasFactory();
    const adapter = createProjectionLegendAdapter({ canvasFactory: () => c });
    adapter.sync({
      layout: { ...layout, widthPct: 40, heightPct: 40, fontPx: 28, rotateDeg: 0 },
      language: "he",
      spanId: "left",
      visible: true,
      pages: [["pack"]],
      pageIndex: 0,
      blocks: [{ id: "pack", pack: { id: "roads", name: "קבוצה" }, layers: [{ items: [
        { label: "א", components: [{ shape: "point", fill: "#123456" }] },
        { label: "ב", components: [{ shape: "square", fill: "#123456" }] },
      ] }] }],
    });
    adapter.draw();
    const point = c.context.calls.find(([name]) => name === "arc");
    const square = c.context.calls.find(([name]) => name === "rect");
    const canvasWidth = 1920 * 0.4;
    const squareCenterX = square[1] + square[3] / 2;
    const squareCenterY = square[2] + square[4] / 2;
    expect(point?.[1]).toBeGreaterThan(canvasWidth / 2);
    expect(squareCenterX).toBeLessThan(point[1]);
    expect(point[1] - squareCenterX).toBeLessThan(canvasWidth / 2);
    expect(squareCenterY).toBeCloseTo(point[2], 0);
  });

  test("legend renders structured gradient bands as nested canvas fills", () => {
    const c = canvasFactory(); const adapter = createProjectionLegendAdapter({ canvasFactory: () => c });
    adapter.sync({
      layout: { ...layout, widthPct: 40, heightPct: 40, fontPx: 16, rotateDeg: 0 }, language: "en", spanId: "left", visible: true,
      pages: [["pack"]], pageIndex: 0, blocks: [{ id: "pack", pack: { name: "Group" }, layers: [{ items: [
        { label: "Gradient", components: [{ shape: "polygon", bands: [
          { color: "#111111", size: 1, opacity: 0.8 }, { color: "#222222", size: 0.5, opacity: 0.4 },
        ] }] },
      ] }] }] });
    adapter.draw();
    const fills = c.context.calls.filter(([name]) => name === "fill");
    expect(fills.length).toBeGreaterThanOrEqual(2);
    expect(fills.some(([, color, alpha]) => color === "#111111" && alpha === 0.8)).toBe(true);
    expect(fills.some(([, color, alpha]) => color === "#222222" && alpha === 0.4)).toBe(true);
  });

  test("pattern shares producer active/off state and draws transformed lines", () => {
    const c = canvasFactory(); const adapter = createProjectionPatternAdapter({ spanId: "left", canvasFactory: () => c });
    adapter.sync({ active: true, pattern: "grid", config: DEFAULT_PROJECTION_CONFIG });
    expect(adapter.draw().source).toBe(c); expect(c.context.calls.filter(([name]) => name === "stroke").length).toBeGreaterThan(5);
    adapter.sync({ active: false }); expect(adapter.draw()).toBeNull();
  });

  test("pattern uses normalized SVG font and stroke semantics", () => {
    const c = canvasFactory(); const adapter = createProjectionPatternAdapter({ spanId: "left", canvasFactory: () => c });
    adapter.sync({ active: true, pattern: "output_id", config: DEFAULT_PROJECTION_CONFIG });
    adapter.draw();
    expect(c.context.font).toContain('0.08px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif');
    expect(c.context.lineWidth).toBeCloseTo(0.003);
  });

  test("caption revisions follow painted pixels, not placement", () => {
    const c = canvasFactory(); const adapter = createProjectionCaptionAdapter({ canvasFactory: () => c });
    const snapshot = { visible: true, model: { clockLabel: "07:05" } };
    adapter.sync({ snapshot, layout });
    const first = adapter.draw();
    expect(first.contentVersion).toBeGreaterThan(0);
    expect(adapter.draw().contentVersion).toBe(first.contentVersion);
    adapter.sync({ snapshot, layout: { ...layout, leftPct: 20, rotateDeg: 0 } });
    const placed = adapter.draw();
    expect(placed.contentVersion).toBe(first.contentVersion);
    expect(placed.matrix).not.toEqual(first.matrix);
    adapter.sync({ snapshot: { visible: true, model: { clockLabel: "07:06" } }, layout });
    expect(adapter.draw().contentVersion).toBeGreaterThan(first.contentVersion);
    adapter.sync({ snapshot, layout: { ...layout, widthPct: 40 } });
    expect(adapter.draw().contentVersion).toBeGreaterThan(placed.contentVersion);
  });

  test("legend revisions follow painted content and local size", () => {
    const c = canvasFactory(); const adapter = createProjectionLegendAdapter({ canvasFactory: () => c });
    const base = { layout, language: "en", spanId: "left", visible: true, blocks: [] };
    adapter.sync(base);
    const first = adapter.draw();
    expect(first.contentVersion).toBeGreaterThan(0);
    adapter.sync({ ...base, layout: { ...layout, leftPct: 25 } });
    const placed = adapter.draw();
    expect(placed.contentVersion).toBe(first.contentVersion);
    expect(placed.matrix).not.toEqual(first.matrix);
    adapter.sync({ ...base, blocks: [{ id: "x", pack: { name: "Changed" }, layers: [] }] });
    const changed = adapter.draw();
    expect(changed.contentVersion).toBeGreaterThan(first.contentVersion);
    expect(adapter.draw().contentVersion).toBe(changed.contentVersion);
    adapter.sync({ ...base, layout: { ...layout, heightPct: 20 } });
    expect(adapter.draw().contentVersion).toBeGreaterThan(changed.contentVersion);
  });

  test("pattern revisions stay stable across repeated syncs and change after painting", () => {
    const c = canvasFactory(); const adapter = createProjectionPatternAdapter({ spanId: "left", canvasFactory: () => c });
    adapter.sync({ active: true, pattern: "grid", config: DEFAULT_PROJECTION_CONFIG });
    const first = adapter.draw();
    expect(first.contentVersion).toBeGreaterThan(0);
    adapter.sync({ active: true, pattern: "grid", config: DEFAULT_PROJECTION_CONFIG });
    expect(adapter.draw().contentVersion).toBe(first.contentVersion);
    adapter.sync({ active: true, pattern: "output_id", config: DEFAULT_PROJECTION_CONFIG });
    const changed = adapter.draw();
    expect(changed.contentVersion).toBeGreaterThan(first.contentVersion);
    expect(adapter.draw().contentVersion).toBe(changed.contentVersion);
  });

  test("legend omits pack titles on the canvas, including land use", () => {
    const c = canvasFactory();
    const adapter = createProjectionLegendAdapter({ canvasFactory: () => c });
    adapter.sync({
      layout: { ...layout, widthPct: 40, heightPct: 40, fontPx: 16 },
      language: "he",
      spanId: "left",
      visible: true,
      pages: [["nli", "land_use"]],
      pageIndex: 0,
      blocks: [
        {
          id: "nli",
          pack: { id: "nli", name: "October 7th" },
          layers: [{ items: [{ label: "Murdered", components: [{ shape: "point", fill: "#123456" }] }] }],
        },
        {
          id: "land_use",
          pack: { id: "land_use", name: "שימושי קרקע" },
          layers: [{ items: [{ label: "שטחים פתוחים", components: [{ shape: "polygon", fill: "#bfff00" }] }] }],
        },
      ],
    });
    adapter.draw();
    expect(c.context.calls.some(([name, value]) => name === "fillText" && value === "Murdered")).toBe(true);
    expect(c.context.calls.some(([name, value]) => name === "fillText" && value === "שטחים פתוחים")).toBe(true);
    expect(c.context.calls.some(([name, value]) => name === "fillText" && value === "October 7th")).toBe(false);
    expect(c.context.calls.some(([name, value]) => name === "fillText" && value === "שימושי קרקע")).toBe(false);
  });
});
