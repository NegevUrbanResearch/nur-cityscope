import { expect, test } from "vitest";
import { createProjectionCaptionAdapter } from "../../frontend/src/projection/projection-caption-adapter.js";

function canvasHarness() {
  const canvases = [];
  const factory = () => {
    const calls = [];
    const stack = [];
    const context = {
      globalAlpha: 1, shadowBlur: 0, shadowOffsetY: 0, calls,
      save() { stack.push({ globalAlpha: this.globalAlpha }); },
      restore() { Object.assign(this, stack.pop()); },
      measureText(text) { return { width: text.length * 14, fontBoundingBoxAscent: 20, fontBoundingBoxDescent: 4 }; },
      fillText(text, x, y) { calls.push({ operation: "text", text, x, y, alpha: this.globalAlpha, shadowBlur: this.shadowBlur }); },
      drawImage(source, ...args) { calls.push({ operation: "image", source, args, shadowBlur: this.shadowBlur }); },
    };
    for (const operation of ["clearRect", "scale", "translate", "setTransform", "beginPath", "rect", "clip"]) {
      context[operation] = (...args) => calls.push({ operation, args });
    }
    const canvas = { width: 0, height: 0, getContext: () => context, context };
    canvases.push(canvas);
    return canvas;
  };
  return { factory, canvases };
}

const layout = { widthPct: 30, heightPct: 10, fontPx: 24 };
const movingSnapshot = (progress) => ({
  visible: true,
  model: { clockLabel: "06:30" },
  motion: { active: true, fromLabel: "06:29", toLabel: "06:30", progress },
});

test("canonical motion progress repaints the projection while identical poses reuse pixels", () => {
  const harness = canvasHarness();
  const adapter = createProjectionCaptionAdapter({ canvasFactory: harness.factory });
  adapter.sync({ layout, snapshot: movingSnapshot(0.2) });
  const first = adapter.draw();
  adapter.sync({ layout, snapshot: movingSnapshot(0.2) });
  expect(adapter.draw().contentVersion).toBe(first.contentVersion);
  adapter.sync({ layout, snapshot: movingSnapshot(0.3) });
  expect(adapter.draw().contentVersion).toBeGreaterThan(first.contentVersion);
});

test("only changing digits fold in a shadowless layer and receive a single assembled shadow", () => {
  const harness = canvasHarness();
  const adapter = createProjectionCaptionAdapter({ canvasFactory: harness.factory, rasterScale: 2 });
  adapter.sync({ layout, snapshot: movingSnapshot(0.25) });
  adapter.draw();
  const main = harness.canvases[0].context.calls;
  expect(main.filter(call => call.operation === "text").map(call => call.text)).toEqual(["0", "6", ":"]);
  expect(main.filter(call => call.operation === "image")).toHaveLength(2);
  expect(main.filter(call => call.operation === "image").every(call => call.shadowBlur === 16)).toBe(true);
  const halves = harness.canvases[1].context.calls.filter(call => call.operation === "text");
  expect(halves.map(call => call.text)).toEqual(["2", "2", "9", "9"]);
  expect(halves.every(call => call.shadowBlur === 0)).toBe(true);
});

test.each([[0.49, ["2", "9"]], [0.51, ["3", "0"]]])("edge-on moving halves vanish at progress %s", (progress, expected) => {
  const harness = canvasHarness();
  const adapter = createProjectionCaptionAdapter({ canvasFactory: harness.factory });
  adapter.sync({ layout, snapshot: movingSnapshot(progress) });
  adapter.draw();
  expect(harness.canvases[1]?.context.calls.filter(call => call.operation === "text").map(call => call.text)).toEqual(expected);
});

test("hidden projection clocks produce no motion layer", () => {
  const harness = canvasHarness();
  const adapter = createProjectionCaptionAdapter({ canvasFactory: harness.factory });
  adapter.sync({ layout, snapshot: { ...movingSnapshot(0.2), visible: false } });
  expect(adapter.draw()).toBeNull();
  expect(harness.canvases).toHaveLength(1);
});

test("resting and moving clock glyphs keep the same tabular positions and baseline", () => {
  const harness = canvasHarness();
  const adapter = createProjectionCaptionAdapter({ canvasFactory: harness.factory });
  adapter.sync({ layout, snapshot: { visible: true, model: { clockLabel: "06:29" } } });
  const initial = adapter.draw();
  const context = harness.canvases[0].context;
  const resting = context.calls.filter(call => call.operation === "text");
  expect(resting.map(call => call.text).join("")).toBe("06:29");
  [0.8, 17.36, 29.24, 41.12, 57.68].forEach((x, index) => expect(resting[index].x).toBeCloseTo(x));
  context.calls.length = 0;
  adapter.sync({ layout, snapshot: movingSnapshot(0.25) });
  adapter.draw();
  expect(context.calls.filter(call => call.operation === "text").map(({ x, y }) => ({ x, y })))
    .toEqual(resting.slice(0, 3).map(({ x, y }) => ({ x, y })));
  adapter.sync({ layout, snapshot: { visible: true, model: { clockLabel: "06:30" }, motion: { ...movingSnapshot(1).motion, active: false } } });
  const settled = adapter.draw();
  expect(settled.contentVersion).toBeGreaterThan(initial.contentVersion);
  const settledGlyphs = context.calls.filter(call => call.operation === "text").slice(-5);
  expect(settledGlyphs.map(call => call.text).join("")).toBe("06:30");
  expect(settledGlyphs.map(({ x, y }) => ({ x, y }))).toEqual(resting.map(({ x, y }) => ({ x, y })));
});
