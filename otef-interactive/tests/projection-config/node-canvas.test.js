import { expect, test, vi } from "vitest";
import { createNodeCanvas, fitTransform, layoutNodePositions, zoomAt } from "../../frontend/src/projection-config/node-canvas.js";

const ids = ["content", "pre", "left-crop", "right-crop", "left-fit", "right-fit", "left-keystone", "right-keystone", "left-grid", "right-grid", "left-output", "right-output"];

test("node layout separates every card and fit shows the complete graph", () => {
  const sizes = Object.fromEntries(ids.map((id) => [id, { width: 330, height: id.includes("crop") ? 430 : 300 }]));
  const { positions, bounds } = layoutNodePositions(sizes);
  for (const [index, a] of ids.entries()) {
    for (const b of ids.slice(index + 1)) {
      const left = positions[a]; const right = positions[b];
      const overlap = left.x < right.x + sizes[b].width && left.x + sizes[a].width > right.x
        && left.y < right.y + sizes[b].height && left.y + sizes[a].height > right.y;
      expect(overlap, `${a} overlaps ${b}`).toBe(false);
    }
  }
  const fitted = fitTransform(bounds, { width: 900, height: 560 });
  expect(fitted.x).toBeGreaterThanOrEqual(0);
  expect(fitted.y).toBeGreaterThanOrEqual(0);
  expect(fitted.x + bounds.width * fitted.scale).toBeLessThanOrEqual(900);
  expect(fitted.y + bounds.height * fitted.scale).toBeLessThanOrEqual(560);
});

test("zoom stays anchored at the cursor and does not pan when scale is clamped", () => {
  const before = { x: -120, y: 30, scale: 1 };
  const anchor = { x: 280, y: 140 };
  const after = zoomAt(before, 1.4, anchor);
  expect((anchor.x - before.x) / before.scale).toBeCloseTo((anchor.x - after.x) / after.scale);
  expect((anchor.y - before.y) / before.scale).toBeCloseTo((anchor.y - after.y) / after.scale);
  expect(zoomAt({ x: 20, y: 40, scale: 2 }, 1.2, anchor)).toEqual({ x: 20, y: 40, scale: 2 });
});

function fakeElement(width = 330, height = 300) {
  return {
    style: {}, attributes: {}, listeners: new Map(), offsetWidth: width, offsetHeight: height,
    get offsetLeft() { return Number.parseFloat(this.style.left) || 0; },
    get offsetTop() { return Number.parseFloat(this.style.top) || 0; },
    addEventListener(type, handler) { this.listeners.set(type, handler); },
    removeEventListener(type) { this.listeners.delete(type); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    querySelector() { return this.header; },
    emit(type, event = {}) { this.listeners.get(type)?.({ target: this, button: 0, clientX: 0, clientY: 0, stopPropagation() {}, preventDefault() {}, ...event }); },
  };
}

test("mounted cards produce pixel wires; drag moves ports and dispose removes listeners", () => {
  const document = fakeElement();
  const viewport = fakeElement(900, 560);
  viewport.clientWidth = 900; viewport.clientHeight = 560;
  viewport.getBoundingClientRect = () => ({ left: 0, top: 0 });
  const graph = fakeElement();
  const svg = fakeElement();
  const wire = fakeElement();
  const controls = { zoomIn: fakeElement(), zoomOut: fakeElement(), zoomReset: fakeElement(), zoomOne: fakeElement() };
  const nodeMap = new Map(ids.map((id) => {
    const card = fakeElement(330, id.includes("crop") ? 430 : 300);
    card.header = fakeElement();
    return [id, card];
  }));
  const canvas = createNodeCanvas({ document, viewport, graph, svg, wire, nodeMap, controls });
  canvas.mount();
  expect(graph.style.transform).toMatch(/scale\(0\.8\)/);
  const initialX = Number(graph.style.transform.match(/translate\(([-\d.]+)px/)[1]);
  expect(initialX + nodeMap.get("content").offsetLeft * 0.8).toBeCloseTo(40);
  expect(Number(svg.attributes.width)).toBeGreaterThan(1500);
  expect(svg.attributes.viewBox).toMatch(/^0 0 \d+ \d+$/);
  expect(wire.attributes.d).toMatch(/M\d/);
  const initialWire = wire.attributes.d;
  nodeMap.get("pre").header.emit("pointerdown", { clientX: 100, clientY: 100 });
  document.emit("pointermove", { clientX: 130, clientY: 120 });
  expect(wire.attributes.d).not.toBe(initialWire);
  document.emit("pointerup");
  expect(document.listeners.has("pointermove")).toBe(false);
  viewport.emit("pointerdown", { clientX: 200, clientY: 100 });
  document.emit("pointermove", { clientX: 230, clientY: 100 });
  document.emit("pointerup");
  expect(graph.style.transform).toMatch(/translate\(/);
  for (let index = 0; index < 40; index += 1) viewport.emit("wheel", { clientX: 280, clientY: 140, deltaY: -1 });
  const atLimit = graph.style.transform;
  viewport.emit("wheel", { clientX: 280, clientY: 140, deltaY: -1 });
  expect(graph.style.transform).toBe(atLimit);
  canvas.setSelected("right-fit");
  controls.zoomOne.emit("click");
  const rightFit = nodeMap.get("right-fit");
  const expectedX = viewport.clientWidth / 2 - rightFit.offsetLeft - rightFit.offsetWidth / 2;
  const expectedY = viewport.clientHeight / 2 - rightFit.offsetTop - rightFit.offsetHeight / 2;
  expect(graph.style.transform).toBe(`translate(${expectedX}px, ${expectedY}px) scale(1)`);
  canvas.dispose();
  expect(viewport.listeners.size).toBe(0);
  expect(nodeMap.get("pre").header.listeners.size).toBe(0);
  expect(controls.zoomReset.listeners.size).toBe(0);
});
