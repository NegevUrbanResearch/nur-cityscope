// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { createLegendDomMotion } from "../../frontend/src/map/legend-dom-motion.js";

describe("DOM legend transitions", () => {
  test("preserves the projection compositor's hidden measurement source", () => {
    const element = document.createElement("div"), content = document.createElement("div");
    element.className = "map-legend-projection";
    element.style.visibility = "hidden";
    element.append(content);
    let time = 0, callback;
    const motion = createLegendDomMotion({ element, content, now: () => time,
      requestFrame: cb => { callback = cb; return 1; }, cancelFrame: () => {}, motionMode: () => "full" });
    motion.render('<div class="map-legend-item" data-legend-item-id="a">A</div>');
    time = 600; callback();
    expect(element.style.visibility).toBe("hidden");
    motion.dispose();
  });

  test("holds surviving RTL rows when the content origin changes during departure", () => {
    const element = document.createElement("div"), content = document.createElement("div");
    element.append(content);
    let time = 0, callback;
    const bounds = () => ({ left: 0, top: 0, width: Number.parseFloat(element.style.width) ||
      (content.querySelectorAll('.map-legend-item:not([style*="position: absolute"])').length > 1 ? 300 : 200), height: 30 });
    element.getBoundingClientRect = bounds;
    content.getBoundingClientRect = bounds;
    const motion = createLegendDomMotion({ element, content, now: () => time,
      requestFrame: cb => { callback = cb; return 1; }, cancelFrame: () => {}, motionMode: () => "full" });
    const html = ids => ids.map(id => `<div class="map-legend-item" data-legend-item-id="${id}">${id}</div>`).join("");
    motion.render(html(["a", "b"]));
    const b = content.querySelector('[data-legend-item-id="b"]');
    b.getBoundingClientRect = () => ({ left: element.style.width === "300px" ? 180 : 80, top: 0, width: 50, height: 20 });
    time = 600; callback();
    motion.render(html(["a", "b"]));
    time = 900; callback();
    motion.render(html(["b"]));
    // The held 300px panel puts the natural row at 180px; preserve its prior 80px position.
    expect(b.style.transform).toBe("translate(-100px, 0px) scale(1)");
    time = 1200; callback();
    motion.dispose();
  });

  test("keeps existing nodes and reverses departure without duplicating a row", () => {
    const element = document.createElement("div");
    const content = document.createElement("div");
    element.append(content);
    document.body.append(element);
    let time = 0, callback;
    const motion = createLegendDomMotion({ element, content, now: () => time,
      requestFrame: cb => { callback = cb; return 1; }, cancelFrame: () => {}, motionMode: () => "full" });
    const html = ids => ids.map(id => `<div class="map-legend-item" data-legend-item-id="${id}">${id}</div>`).join("");
    const advance = t => { time = t; const cb = callback; callback = null; cb?.(t); };
    motion.render(html(["a", "b"]));
    advance(600);
    const a = content.querySelector('[data-legend-item-id="a"]');
    const b = content.querySelector('[data-legend-item-id="b"]');
    motion.render(html(["b"]));
    advance(900);
    expect(content.querySelector('[data-legend-item-id="a"]')).toBe(a);
    expect(Number(a.style.opacity)).toBeCloseTo(0.5);
    expect(content.querySelector('[data-legend-item-id="b"]')).toBe(b);
    expect(Number(b.style.opacity)).toBe(1);
    motion.render(html(["a", "b"]));
    expect(content.querySelectorAll('[data-legend-item-id="a"]')).toHaveLength(1);
    expect(content.querySelector('[data-legend-item-id="a"]')).toBe(a);
    advance(1200);
    expect(Number(a.style.opacity || "1")).toBe(1);
    motion.dispose();
    expect(callback).toBeNull();
    element.remove();
  });
});
