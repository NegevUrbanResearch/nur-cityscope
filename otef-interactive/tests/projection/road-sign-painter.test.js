import { describe, expect, test, vi } from "vitest";
import { paintRoadSigns } from "../../frontend/src/projection/road-sign-painter.js";

function canvasContext() {
  const calls = [];
  const context = new Proxy({ calls }, { get(target, key) {
    if (key in target) return target[key];
    return (...args) => calls.push([key, ...args]);
  }, set(target, key, value) { target[key] = value; return true; } });
  return context;
}

const sign = (overrides = {}) => ({ id: "road-sign-1", x: 960, y: 540, scale: .7, rotateDeg: 0,
  theme: "dark", visible: true, leader: { enabled: false, x: 800, y: 500 }, ...overrides });

describe("Road 232 sign painter", () => {
  test("uses source-plane center rotation and uniform scale for artwork", () => {
    const ctx = canvasContext();
    const artwork = { dark: { width: 524, height: 381 }, original: { width: 524, height: 381 } };
    const bounds = paintRoadSigns(ctx, { signs: [sign({ rotateDeg: 30 })], artwork, rasterScale: 1 });
    expect(ctx.calls).toContainEqual(["translate", 960, 540]);
    expect(ctx.calls).toContainEqual(["rotate", Math.PI / 6]);
    expect(ctx.calls).toContainEqual(["scale", .7, .7]);
    expect(bounds).toHaveLength(1);
    expect(bounds[0]).toMatchObject({ id: "road-sign-1", x: 960, y: 540, width: 114 * .7 });
  });

  test("paints connector behind sign and draws a one percent sign", () => {
    const ctx = canvasContext();
    paintRoadSigns(ctx, { signs: [sign({ scale: .01, leader: { enabled: true, x: 500, y: 400 } })], artwork: { dark: {}, original: {} }, rasterScale: 1 });
    const stroke = ctx.calls.findIndex(([name]) => name === "stroke");
    const draw = ctx.calls.findIndex(([name]) => name === "drawImage");
    expect(stroke).toBeGreaterThanOrEqual(0);
    expect(stroke).toBeLessThan(draw);
    expect(ctx.calls).toContainEqual(["scale", .01, .01]);
    expect(ctx.strokeStyle).toBe("#d4e5da");
  });

  test("paints every connector before any sign artwork", () => {
    const ctx = canvasContext();
    const signs = [
      sign({ id: "first", x: 960, leader: { enabled: true, x: 700, y: 540 } }),
      sign({ id: "second", x: 1200, leader: { enabled: true, x: 900, y: 540 } }),
    ];
    paintRoadSigns(ctx, { signs, artwork: { dark: {}, original: {} }, rasterScale: 1 });
    const strokes = ctx.calls.flatMap((call, index) => call[0] === "stroke" ? [index] : []);
    const artwork = ctx.calls.flatMap((call, index) => call[0] === "drawImage" ? [index] : []);
    expect(strokes).toHaveLength(2);
    expect(artwork).toHaveLength(2);
    expect(Math.max(...strokes)).toBeLessThan(Math.min(...artwork));
  });

  test("leaves transparent canvas clear and skips hidden or unavailable artwork", () => {
    const ctx = canvasContext();
    paintRoadSigns(ctx, { signs: [sign(), sign({ id: "hidden", visible: false })], artwork: { dark: null, original: null }, rasterScale: 1 });
    expect(ctx.calls).toContainEqual(["clearRect", 0, 0, 1920, 1080]);
    expect(ctx.calls.some(([name]) => name === "drawImage")).toBe(false);
  });

  test("clips original artwork to the shared rounded outer silhouette", () => {
    const ctx = canvasContext();
    paintRoadSigns(ctx, { signs: [sign({ theme: "original" })], artwork: { original: { width: 524, height: 381 } }, rasterScale: 1 });
    const clipIndex = ctx.calls.findIndex(([name]) => name === "clip");
    const imageIndex = ctx.calls.findIndex(([name]) => name === "drawImage");
    expect(clipIndex).toBeGreaterThanOrEqual(0);
    expect(clipIndex).toBeLessThan(imageIndex);
    expect(ctx.calls.some(([name]) => name === "roundRect")).toBe(false);
    expect(ctx.calls.some(([name]) => name === "quadraticCurveTo")).toBe(true);
  });
});
