import { describe, expect, test } from "vitest";
import { createProjectionLegendAdapter } from "../../frontend/src/projection/projection-legend-adapter.js";

describe("projection legend transitions", () => {
  test.each([3, 4])("keeps RTL glyphs inside the raster when %i rows shrink to two", (count) => {
    let time = 0, sx = 1, sy = 1, tx = 0, ty = 0;
    const stack = [], labels = [], circles = [];
    const context = new Proxy({
      save() { stack.push([sx, sy, tx, ty]); },
      restore() { [sx, sy, tx, ty] = stack.pop(); },
      scale(x, y) { sx *= x; sy *= y; },
      translate(x, y) { tx += x * sx; ty += y * sy; },
      measureText(text) { return { width: text.length * 16 }; },
      fillText(text, x, y) { labels.push({ text, x: tx + x * sx, y: ty + y * sy }); },
      arc(x, y, radius) { circles.push({ x: tx + x * sx, radius: radius * sx }); },
    }, { get: (target, key) => key in target ? target[key] : () => {} });
    const canvas = { getContext: () => context };
    const adapter = createProjectionLegendAdapter({ canvasFactory: () => canvas,
      now: () => time, motionMode: () => "full" });
    const snapshot = ids => ({ visible: true, spanId: "left", language: "he",
      layout: { leftPct: 10, topPct: 10, widthPct: 20, heightPct: 10, fontPx: 28, columns: 1, rotateDeg: 0 },
      blocks: [{ id: "nli", layers: [{ items: ids.map(id => ({ id, label: `שלום ${id}`, shape: "point", fill: "#fff" })) }] }],
    });
    adapter.sync(snapshot(["a", "b", "c", "d"].slice(0, count)));
    time = 600; adapter.draw();
    const initial = labels.find(label => label.text === "שלום a");
    labels.length = 0;
    adapter.sync(snapshot(["a", "b"]));
    time = 900; adapter.draw();
    const departing = labels.find(label => label.text === "שלום a");
    expect(departing.x).toBeCloseTo(initial.x);
    expect(departing.y).toBeCloseTo(initial.y);
    time = 1200; adapter.draw();
    time = 1350; labels.length = 0; circles.length = 0; adapter.draw();
    const midpoint = labels.find(label => label.text === "שלום a");
    expect(circles.every(circle => circle.x + circle.radius <= canvas.width + 0.01)).toBe(true);
    time = 1500; labels.length = 0; adapter.draw();
    const final = labels.find(label => label.text === "שלום a");
    expect(midpoint.x).toBeCloseTo((initial.x + final.x) / 2);
    expect(midpoint.y).toBeCloseTo((initial.y + final.y) / 2);
    adapter.dispose();
  });

  test("retains outgoing labels during a fade and rerasterizes each moving frame", () => {
    let time = 0;
    const labels = [];
    const context = new Proxy({ globalAlpha: 1, fillText(text) { labels.push(text); } }, {
      get: (target, key) => key in target ? target[key] : key === "measureText" ? () => ({ width: 25 }) : () => {},
    });
    const canvas = { width: 0, height: 0, getContext: () => context };
    const adapter = createProjectionLegendAdapter({ canvasFactory: () => canvas, now: () => time, motionMode: () => "full" });
    const snapshot = ids => ({ visible: ids.length > 0, spanId: "left", language: "en",
      layout: { leftPct: 10, topPct: 10, widthPct: 40, heightPct: 30, fontPx: 16, columns: 1, rotateDeg: 0 },
      blocks: [{ id: "nli", layers: [{ items: ids.map(id => ({ id, label: id, shape: "point", fill: "#fff" })) }] }],
    });
    adapter.sync(snapshot(["a", "b"]));
    time = 600; adapter.draw();
    adapter.sync(snapshot(["b"]));
    time = 900;
    labels.length = 0;
    const mid = adapter.draw();
    expect(labels).toContain("a");
    expect(labels).toContain("b");
    time = 950;
    expect(adapter.draw().contentVersion).toBeGreaterThan(mid.contentVersion);
    time = 1500;
    labels.length = 0; adapter.draw();
    expect(labels).toEqual(["b"]);
    adapter.sync(snapshot([]));
    time = 1800;
    expect(adapter.draw()).not.toBeNull();
    time = 2100;
    expect(adapter.draw()).toBeNull();
    adapter.dispose();
  });
});
