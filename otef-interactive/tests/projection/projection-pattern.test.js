import { describe, expect, test, vi } from "vitest";
import { createProjectionPattern } from "../../frontend/src/projection/projection-pattern.js";

function host() {
  const children = [];
  return {
    children,
    appendChild(node) { children.push(node); node.parentElement = this; return node; },
    removeChild(node) { const i = children.indexOf(node); if (i >= 0) children.splice(i, 1); },
  };
}

describe("projection patterns", () => {
  test("renders grid in source coordinates without blacking out output", () => {
    const h = host();
    const p = createProjectionPattern({ host: h, spanId: "left" });
    p.receive({ type: "otef_projection_pattern", table: "otef", output: "left", pattern: "grid", sourceId: "11111111-1111-4111-8111-111111111111" });
    expect(h.children).toHaveLength(1);
    expect(h.children[0].viewBox).toBe("0 0 1 1");
    expect(h.children[0].dataset.pattern).toBe("grid");
    expect(h.children[0].style.background).not.toBe("black");
  });

  test("expires after three seconds and renewal extends the deadline", () => {
    let now = 0;
    const timers = [];
    const h = host();
    const p = createProjectionPattern({ host: h, spanId: "left", clock: {
      now: () => now,
      setTimeout: (fn, delay) => { const timer = { fn, at: now + delay }; timers.push(timer); return timer; },
      clearTimeout: (timer) => { timer.cancelled = true; },
    } });
    const command = { type: "otef_projection_pattern", table: "otef", output: "left", pattern: "output_id", sourceId: "11111111-1111-4111-8111-111111111111" };
    p.receive(command);
    now = 1000; p.receive(command);
    now = 1500; p.setConfig({ schemaVersion: 1, pre: { scale: 1, rotateDeg: 0, tx: 0, ty: 0 }, outputs: { left: { crop: { x0: 0, x1: 1, y0: 0, y1: 1 }, post: { scale: 1, tx: 0, ty: 0 } }, right: { crop: { x0: 0, x1: 1, y0: 0, y1: 1 }, post: { scale: 1, tx: 0, ty: 0 } } } });
    now = 3500; timers.filter((timer) => !timer.cancelled && timer.at <= now).forEach((timer) => timer.fn());
    expect(h.children).toHaveLength(1);
    now = 4100; timers.filter((timer) => !timer.cancelled && timer.at <= now).forEach((timer) => timer.fn());
    expect(h.children).toHaveLength(0);
  });

  test("clear and dispose remove the overlay immediately", () => {
    const h = host();
    const p = createProjectionPattern({ host: h, spanId: "right" });
    p.receive({ type: "otef_projection_pattern", table: "otef", output: "right", pattern: "grid", sourceId: "11111111-1111-4111-8111-111111111111" });
    p.clear();
    expect(h.children).toHaveLength(0);
    p.dispose();
    expect(() => p.receive({})).not.toThrow();
  });

  test("full output pattern instances stay inert", () => {
    const h = host();
    const p = createProjectionPattern({ host: h, spanId: null });
    expect(p.receive({ type: "otef_projection_pattern", table: "otef", output: null, pattern: "grid", sourceId: "11111111-1111-4111-8111-111111111111" })).toBe(false);
    expect(h.children).toHaveLength(0);
  });

  test("pre translation changes source marks before crop and post mapping", () => {
    const h = host();
    const p = createProjectionPattern({ host: h, spanId: "left" });
    const command = { type: "otef_projection_pattern", table: "otef", output: "left", pattern: "grid", sourceId: "11111111-1111-4111-8111-111111111111" };
    p.setConfig({
      schemaVersion: 1,
      pre: { scale: 1, rotateDeg: 0, tx: 0.2, ty: 0 },
      outputs: { left: { crop: { x0: 0, x1: 1, y0: 0, y1: 1 }, post: { scale: 1, tx: 0, ty: 0 } }, right: { crop: { x0: 0, x1: 1, y0: 0, y1: 1 }, post: { scale: 1, tx: 0, ty: 0 } } },
    });
    p.receive(command);
    const gridPath = h.children[0].children.find((child) => String(child.getAttribute?.("d") || child.d).includes("0.7"));
    expect(gridPath).toBeTruthy();
  });

  test("output ID follows the transformed source center", () => {
    const h = host();
    const p = createProjectionPattern({ host: h, spanId: "left" });
    p.setConfig({ schemaVersion: 1, pre: { scale: 1, rotateDeg: 0, tx: 0.1, ty: 0 }, outputs: { left: { crop: { x0: 0, x1: 1, y0: 0, y1: 1 }, post: { scale: 1, tx: 0, ty: 0 } }, right: { crop: { x0: 0, x1: 1, y0: 0, y1: 1 }, post: { scale: 1, tx: 0, ty: 0 } } } });
    p.receive({ type: "otef_projection_pattern", table: "otef", output: "left", pattern: "output_id", sourceId: "11111111-1111-4111-8111-111111111111" });
    const label = h.children[0].children.at(-1);
    expect(Number(label.x ?? label.getAttribute?.("x"))).toBeCloseTo(0.6, 6);
  });

  test("publishes the effective inherited pattern font without a second expiry field", () => {
    const h = host();
    const snapshots = [];
    vi.stubGlobal("getComputedStyle", () => ({ fontFamily: '"Measured Sans", sans-serif' }));
    const p = createProjectionPattern({ host: h, spanId: "left", onRenderSnapshot: (snapshot) => snapshots.push(snapshot) });
    p.receive({ type: "otef_projection_pattern", table: "otef", output: "left", pattern: "output_id", sourceId: "11111111-1111-4111-8111-111111111111" });
    expect(snapshots.at(-1).fontFamily).toBe('"Measured Sans", sans-serif');
    expect(snapshots.at(-1)).not.toHaveProperty("expiresAt");
    vi.unstubAllGlobals();
  });
});
