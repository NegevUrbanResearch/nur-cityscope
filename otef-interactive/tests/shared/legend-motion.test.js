import { describe, expect, test } from "vitest";
import { createLegendMotion } from "../../frontend/src/shared/legend-motion.js";

function setup(mode = "full") {
  let time = 0;
  const motion = createLegendMotion({ now: () => time, motionMode: () => mode });
  const row = (id, y = 0) => ({ id, x: 0, y, scale: 1, data: { label: id } });
  return { motion, row, at: value => { time = value; return motion.sample(); } };
}

describe("legend motion", () => {
  test("fades the whole legend over 600 ms and retains it while departing", () => {
    const { motion, row, at } = setup();
    motion.update([row("a")], { visible: true });
    expect(at(300).opacity).toBeCloseTo(0.5);
    expect(at(600).opacity).toBe(1);
    motion.update([], { visible: false });
    expect(at(900)).toMatchObject({ opacity: 0.5, moving: true });
    expect(at(900).rows).toHaveLength(1);
    expect(at(1200)).toMatchObject({ opacity: 0, rows: [], moving: false });
  });

  test("keeps an outgoing row and defers closing its gap until its fade finishes", () => {
    const { motion, row, at } = setup();
    motion.update([row("a"), row("b", 30)], { visible: true });
    at(600);
    motion.update([row("b")], { visible: true });
    const halfway = at(900);
    expect(halfway.rows.find(r => r.id === "a").opacity).toBeCloseTo(0.5);
    expect(halfway.rows.find(r => r.id === "b")).toMatchObject({ opacity: 1, y: 30 });
    expect(at(1200).rows.map(r => r.id)).toEqual(["b"]);
    expect(at(1350).rows[0].y).toBeCloseTo(15);
    expect(at(1500)).toMatchObject({ rows: [{ id: "b", y: 0 }], moving: false });
  });

  test("reverses a row fade from its sampled opacity without replacing its identity", () => {
    const { motion, row, at } = setup();
    motion.update([row("a")], { visible: true });
    at(600);
    motion.update([row("a"), row("b", 30)], { visible: true });
    expect(at(900).rows.find(r => r.id === "b").opacity).toBeCloseTo(0.5);
    motion.update([row("a")], { visible: true });
    expect(at(900).rows.find(r => r.id === "b").opacity).toBeCloseTo(0.5);
    expect(at(1050).rows.find(r => r.id === "b").opacity).toBeCloseTo(0.25);
    motion.update([row("a"), row("b", 30)], { visible: true });
    expect(at(1050).rows.find(r => r.id === "b").opacity).toBeCloseTo(0.25);
    expect(at(1500).rows.find(r => r.id === "b").opacity).toBe(1);
  });

  test("repeated identical updates do not restart a fade", () => {
    const { motion, row, at } = setup();
    motion.update([row("a")], { visible: true });
    at(300);
    motion.update([row("a")], { visible: true });
    expect(at(600)).toMatchObject({ opacity: 1, moving: false });
  });

  test("editing settles geometry without scheduling a movement tween", () => {
    const { motion, row, at } = setup();
    motion.update([row("a")], { visible: true });
    at(300);
    motion.update([row("a", 40)], { visible: true, immediate: true });
    expect(at(300)).toMatchObject({ opacity: 1, rows: [{ id: "a", y: 40 }], moving: false });
  });

  test("reduced motion immediately settles removals and placement", () => {
    const { motion, row, at } = setup("reduced");
    motion.update([row("a"), row("b", 30)], { visible: true });
    expect(at(0)).toMatchObject({ opacity: 1, moving: false });
    motion.update([row("b")], { visible: true });
    expect(at(0)).toMatchObject({ rows: [{ id: "b", y: 0, opacity: 1 }], moving: false });
  });

  test("retains relative geometry through departure and interpolates it during reflow", () => {
    let time = 0;
    const motion = createLegendMotion({ now: () => time, motionMode: () => "full",
      interpolateData: (from, to, fraction) => ({ labelX: from.labelX + (to.labelX - from.labelX) * fraction }) });
    motion.update([{ id: "a", scale: 0.5, data: { labelX: 100 } }, { id: "b", y: 30, data: { labelX: 100 } }]);
    time = 600; motion.sample();
    motion.update([{ id: "a", scale: 0.8, data: { labelX: 60 } }]);
    time = 900;
    expect(motion.sample().rows[0].data.labelX).toBe(100);
    time = 1200; motion.sample();
    time = 1350;
    expect(motion.sample().rows[0].data.labelX).toBeCloseTo(80);
    time = 1500;
    expect(motion.sample().rows[0].data.labelX).toBe(60);
  });
});
