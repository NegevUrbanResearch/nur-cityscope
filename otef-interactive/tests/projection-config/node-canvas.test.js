import { expect, test, vi } from "vitest";
import { createNodeCanvas, fitTransform, layoutNodePositions, zoomAt } from "../../frontend/src/projection-config/node-canvas.js";

const ids = ["content", "names-wall", "settlement-names", "road-signs", "clock-gis", "nova-explainers", "clock-projection", "pre", "left-crop", "right-crop", "left-fit", "right-fit", "left-keystone", "right-keystone", "left-grid", "right-grid", "left-output", "right-output"];

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

test("compact fit stays positive for small but nonzero viewports", () => {
  const { bounds } = layoutNodePositions(Object.fromEntries(ids.map((id) => [id, { width: 330, height: 300 }])));
  const phone = fitTransform(bounds, { width: 375, height: 220 });
  expect(phone.scale).toBeGreaterThan(0);
  expect(phone.scale).toBeLessThanOrEqual(1);
  const tiny = fitTransform(bounds, { width: 20, height: 30 });
  expect(tiny.scale).toBeGreaterThan(0);
  expect(Number.isFinite(tiny.x)).toBe(true);
  expect(Number.isFinite(tiny.y)).toBe(true);
});

test("Names wall sits beside Content without joining the transform path", () => {
  const sizes = Object.fromEntries(ids.map((id) => [id, { width: 330, height: 300 }]));
  const { positions } = layoutNodePositions(sizes);
  const content = positions.content;
  const names = positions["names-wall"];
  expect(names.x).toBe(content.x);
  expect(names.y).toBeGreaterThan(content.y);
  expect(names.y - (content.y + sizes.content.height)).toBeGreaterThanOrEqual(32);
  expect(positions.pre.x).toBeGreaterThan(content.x + sizes.content.width);
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
    closest() { return this.excluded ? this : null; },
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
  controls.zoomIn.emit("click");
  expect(readTransform(graph).scale).toBeCloseTo(1.2);
  controls.zoomOut.emit("click");
  expect(readTransform(graph).scale).toBeCloseTo(1);
  controls.zoomReset.emit("click");
  expect(readTransform(graph).scale).toBeLessThanOrEqual(1);
  canvas.dispose();
  expect(viewport.listeners.size).toBe(0);
  expect(nodeMap.get("pre").header.listeners.size).toBe(0);
  expect(controls.zoomReset.listeners.size).toBe(0);
});

test("Nova explainers stacks in the GIS clock overlays column without overlap or a projector edge", () => {
  const overlayIds = ["clock-gis", "nova-explainers", "clock-projection"];
  const sizes = Object.fromEntries([...ids, "nova-explainers"].map((id) => [id, { width: 330, height: id.includes("crop") ? 430 : 300 }]));
  const { positions } = layoutNodePositions(sizes);
  expect(positions["nova-explainers"]).toEqual(expect.objectContaining({ x: positions["clock-gis"].x }));
  expect(positions["nova-explainers"].y).toBeGreaterThanOrEqual(positions["clock-gis"].y + sizes["clock-gis"].height);
  expect(positions["clock-projection"].y).toBeGreaterThanOrEqual(positions["nova-explainers"].y + sizes["nova-explainers"].height);
  expect(positions["clock-gis"].x).toBe(positions["clock-projection"].x);
  for (const [index, a] of overlayIds.entries()) {
    for (const b of overlayIds.slice(index + 1)) {
      const left = positions[a];
      const right = positions[b];
      const overlap = left.x < right.x + sizes[b].width && left.x + sizes[a].width > right.x
        && left.y < right.y + sizes[b].height && left.y + sizes[a].height > right.y;
      expect(overlap, `${a} overlaps ${b}`).toBe(false);
    }
  }
  const document = fakeElement();
  const viewport = fakeElement(900, 560);
  viewport.clientWidth = 900;
  viewport.clientHeight = 560;
  const graph = fakeElement();
  const svg = fakeElement();
  const wire = fakeElement();
  const controls = { zoomIn: fakeElement(), zoomOut: fakeElement(), zoomReset: fakeElement(), zoomOne: fakeElement() };
  const nodeMap = new Map([...ids, "nova-explainers"].map((id) => {
    const card = fakeElement(330, 300);
    card.header = fakeElement();
    return [id, card];
  }));
  const canvas = createNodeCanvas({ document, viewport, graph, svg, wire, nodeMap, controls });
  canvas.mount();
  expect(wire.attributes.d.match(/M/g)).toHaveLength(11);
  canvas.dispose();
});

test("a second eligible touch transfers a node drag to canvas navigation", () => {
  const document = fakeElement();
  const viewport = fakeElement(900, 560);
  viewport.clientWidth = 900; viewport.clientHeight = 560;
  viewport.getBoundingClientRect = () => ({ left: 0, top: 0 });
  const graph = fakeElement(); const svg = fakeElement(); const wire = fakeElement();
  const controls = { zoomIn: fakeElement(), zoomOut: fakeElement(), zoomReset: fakeElement(), zoomOne: fakeElement() };
  const nodeMap = new Map(ids.map((id) => { const card = fakeElement(330); card.header = fakeElement(); return [id, card]; }));
  const canvas = createNodeCanvas({ document, viewport, graph, svg, wire, nodeMap, controls });
  canvas.mount();
  const pre = nodeMap.get("pre");
  const initialX = pre.offsetLeft;
  pre.header.emit("pointerdown", { pointerId: 22, pointerType: "touch", isPrimary: false, clientX: 100, clientY: 100 });
  document.emit("pointermove", { pointerId: 22, pointerType: "touch", isPrimary: false, clientX: 800, clientY: 100 });
  expect(pre.offsetLeft).toBe(initialX);
  document.emit("pointerup", { pointerId: 22, pointerType: "touch", isPrimary: false });
  pre.header.emit("pointerdown", { pointerId: 11, pointerType: "touch", isPrimary: true, clientX: 100, clientY: 100 });
  document.emit("pointermove", { pointerId: 11, pointerType: "touch", isPrimary: true, clientX: 130, clientY: 100 });
  expect(pre.offsetLeft).toBe(initialX + 30 / 0.8);
  pre.header.emit("pointerdown", { pointerId: 22, pointerType: "touch", isPrimary: false, clientX: 500, clientY: 100 });
  document.emit("pointermove", { pointerId: 11, pointerType: "touch", isPrimary: true, clientX: 150, clientY: 100 });
  expect(pre.offsetLeft).toBe(initialX + 30 / 0.8);
  document.emit("pointerup", { pointerId: 22, pointerType: "touch" });
  document.emit("pointermove", { pointerId: 11, pointerType: "touch", isPrimary: true, clientX: 180, clientY: 100 });
  expect(pre.offsetLeft).toBe(initialX + 30 / 0.8);
  document.emit("pointercancel", { pointerId: 11, pointerType: "touch" });
  document.emit("pointermove", { pointerId: 11, pointerType: "touch", isPrimary: true, clientX: 180, clientY: 100 });
  expect(pre.offsetLeft).toBe(initialX + 30 / 0.8);
  pre.header.emit("pointerdown", { pointerId: 33, clientX: 0, clientY: 0 });
  document.emit("pointermove", { pointerId: 33, clientX: 10, clientY: 0 });
  expect(pre.offsetLeft).toBeGreaterThan(initialX + 30 / 0.8);
  expect(document.listeners.has("pointermove")).toBe(true);
  canvas.dispose();
  expect(document.listeners.has("pointermove")).toBe(false);
  expect(document.listeners.has("pointerup")).toBe(false);
});

function makeTouchCanvas() {
  const document = fakeElement();
  const viewport = fakeElement(900, 560);
  viewport.clientWidth = 900; viewport.clientHeight = 560;
  viewport.getBoundingClientRect = () => ({ left: 40, top: 20 });
  const graph = fakeElement(); const svg = fakeElement(); const wire = fakeElement();
  const controls = { zoomIn: fakeElement(), zoomOut: fakeElement(), zoomReset: fakeElement(), zoomOne: fakeElement() };
  const nodeMap = new Map(ids.map((id) => { const card = fakeElement(330); card.header = fakeElement(); return [id, card]; }));
  const canvas = createNodeCanvas({ document, viewport, graph, svg, wire, nodeMap, controls });
  canvas.mount();
  return { document, viewport, graph, controls, nodeMap, canvas };
}

function readTransform(graph) {
  const [, x, y, scale] = graph.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/);
  return { x: Number(x), y: Number(y), scale: Number(scale) };
}

test("two eligible touches pinch around their moving centroid, including a nonprimary second touch", () => {
  const { document, viewport, graph, nodeMap, canvas } = makeTouchCanvas();
  const initial = readTransform(graph);
  viewport.emit("pointerdown", { pointerId: 41, pointerType: "touch", isPrimary: true, clientX: 140, clientY: 120 });
  viewport.emit("pointerdown", { target: nodeMap.get("content"), pointerId: 42, pointerType: "touch", isPrimary: false, clientX: 340, clientY: 120 });
  document.emit("pointermove", { pointerId: 41, pointerType: "touch", clientX: 160, clientY: 140 });
  document.emit("pointermove", { pointerId: 42, pointerType: "touch", clientX: 400, clientY: 140 });
  const after = readTransform(graph);
  const centroid = { x: 280 - 40, y: 140 - 20 };
  const beforeCentroid = { x: 240 - 40, y: 120 - 20 };
  expect(after.scale).toBeCloseTo(initial.scale * 1.2);
  expect((beforeCentroid.x - initial.x) / initial.scale).toBeCloseTo((centroid.x - after.x) / after.scale);
  expect((beforeCentroid.y - initial.y) / initial.scale).toBeCloseTo((centroid.y - after.y) / after.scale);
  canvas.dispose();
});

test("a second touch converts a header drag to canvas pinch and the leftover finger cannot resume node drag", () => {
  const { document, viewport, graph, nodeMap, canvas } = makeTouchCanvas();
  const pre = nodeMap.get("pre");
  const initialLeft = pre.offsetLeft;
  pre.header.emit("pointerdown", { pointerId: 51, pointerType: "touch", isPrimary: true, clientX: 140, clientY: 120 });
  document.emit("pointermove", { pointerId: 51, pointerType: "touch", clientX: 150, clientY: 120 });
  expect(pre.offsetLeft).toBe(initialLeft + 10 / 0.8);
  viewport.emit("pointerdown", { pointerId: 52, pointerType: "touch", isPrimary: false, clientX: 350, clientY: 120 });
  const afterPinchStart = graph.style.transform;
  document.emit("pointermove", { pointerId: 51, pointerType: "touch", clientX: 170, clientY: 120 });
  expect(pre.offsetLeft).toBe(initialLeft + 10 / 0.8);
  document.emit("pointerup", { pointerId: 52, pointerType: "touch" });
  document.emit("pointermove", { pointerId: 51, pointerType: "touch", clientX: 220, clientY: 120 });
  expect(pre.offsetLeft).toBe(initialLeft + 10 / 0.8);
  expect(graph.style.transform).not.toBe(afterPinchStart);
  canvas.dispose();
});

test("pinch clamps at both scale limits, ignores a third touch, reverses, and uses pointerup coordinates", () => {
  const { document, viewport, graph, canvas } = makeTouchCanvas();
  viewport.emit("pointerdown", { pointerId: 55, pointerType: "touch", isPrimary: true, clientX: 140, clientY: 120 });
  viewport.emit("pointerdown", { pointerId: 56, pointerType: "touch", isPrimary: false, clientX: 340, clientY: 120 });
  viewport.emit("pointerdown", { pointerId: 57, pointerType: "touch", isPrimary: false, clientX: 440, clientY: 120 });
  document.emit("pointermove", { pointerId: 56, pointerType: "touch", clientX: 940, clientY: 120 });
  expect(readTransform(graph).scale).toBe(2);
  document.emit("pointermove", { pointerId: 57, pointerType: "touch", clientX: 20, clientY: 400 });
  expect(readTransform(graph).scale).toBe(2);
  document.emit("pointermove", { pointerId: 56, pointerType: "touch", clientX: 141, clientY: 120 });
  expect(readTransform(graph).scale).toBe(0.18);
  document.emit("pointermove", { pointerId: 56, pointerType: "touch", clientX: 540, clientY: 120 });
  expect(readTransform(graph).scale).toBeCloseTo(1.6);
  document.emit("pointerup", { type: "pointerup", pointerId: 56, pointerType: "touch", clientX: 340, clientY: 120 });
  expect(readTransform(graph).scale).toBeCloseTo(0.8);
  document.emit("lostpointercapture", { pointerId: 55, pointerType: "touch" });
  document.emit("pointercancel", { pointerId: 57, pointerType: "touch" });
  expect(document.listeners.has("pointermove")).toBe(false);
  canvas.dispose();
});

test("zero-distance touches do not create an invalid pinch transform", () => {
  const { document, viewport, graph, canvas } = makeTouchCanvas();
  const initial = graph.style.transform;
  viewport.emit("pointerdown", { pointerId: 58, pointerType: "touch", isPrimary: true, clientX: 140, clientY: 120 });
  viewport.emit("pointerdown", { pointerId: 59, pointerType: "touch", isPrimary: false, clientX: 140, clientY: 120 });
  document.emit("pointermove", { pointerId: 59, pointerType: "touch", clientX: 240, clientY: 120 });
  expect(graph.style.transform).toBe(initial);
  document.emit("pointercancel", { pointerId: 58, pointerType: "touch" });
  document.emit("pointercancel", { pointerId: 59, pointerType: "touch" });
  canvas.dispose();
});

test("touch cancellation, excluded controls, blur, and dispose clean up gesture listeners", () => {
  const { document, viewport, graph, controls, nodeMap, canvas } = makeTouchCanvas();
  const control = fakeElement(); control.excluded = true;
  const pre = nodeMap.get("pre");
  const initialLeft = pre.offsetLeft;
  pre.header.emit("pointerdown", { target: control, pointerId: 60, pointerType: "touch", isPrimary: true, clientX: 100, clientY: 100 });
  document.emit("pointermove", { pointerId: 60, pointerType: "touch", clientX: 160, clientY: 100 });
  expect(pre.offsetLeft).toBe(initialLeft);
  viewport.emit("pointerdown", { target: control, pointerId: 61, pointerType: "touch", isPrimary: true, clientX: 100, clientY: 100 });
  viewport.emit("pointerdown", { pointerId: 62, pointerType: "touch", isPrimary: true, clientX: 200, clientY: 100 });
  document.emit("pointercancel", { pointerId: 62, pointerType: "touch" });
  document.emit("pointercancel", { pointerId: 61, pointerType: "touch" });
  expect(document.listeners.has("pointermove")).toBe(false);
  const labelTarget = fakeElement();
  labelTarget.closest = (selector) => selector.split(",").some((part) => part.trim() === "label") ? labelTarget : null;
  const beforeLabelTouch = graph.style.transform;
  viewport.emit("pointerdown", { target: labelTarget, pointerId: 65, pointerType: "touch", isPrimary: true, clientX: 100, clientY: 100 });
  viewport.emit("pointerdown", { target: nodeMap.get("content"), pointerId: 66, pointerType: "touch", isPrimary: false, clientX: 200, clientY: 100 });
  document.emit("pointermove", { pointerId: 66, pointerType: "touch", clientX: 300, clientY: 100 });
  document.emit("pointercancel", { pointerId: 65, pointerType: "touch" });
  document.emit("pointercancel", { pointerId: 66, pointerType: "touch" });
  expect(graph.style.transform).toBe(beforeLabelTouch);
  viewport.emit("pointerdown", { pointerId: 63, pointerType: "touch", isPrimary: true, clientX: 100, clientY: 100 });
  document.emit("blur");
  expect(document.listeners.has("pointermove")).toBe(false);
  document.visibilityState = "hidden";
  viewport.emit("pointerdown", { pointerId: 64, pointerType: "touch", isPrimary: true, clientX: 100, clientY: 100 });
  document.emit("visibilitychange");
  expect(document.listeners.has("pointermove")).toBe(false);
  canvas.dispose();
  expect(viewport.listeners.size).toBe(0);
  expect(controls.zoomIn.listeners.size).toBe(0);
});

test("focusNodes frames the union of existing target nodes and ignores missing IDs", () => {
  const document = fakeElement();
  const viewport = fakeElement(900, 560);
  viewport.clientWidth = 900; viewport.clientHeight = 560;
  const graph = fakeElement(); const svg = fakeElement(); const wire = fakeElement();
  const controls = { zoomIn: fakeElement(), zoomOut: fakeElement(), zoomReset: fakeElement(), zoomOne: fakeElement() };
  const nodeMap = new Map(ids.map((id) => { const card = fakeElement(330); card.header = fakeElement(); return [id, card]; }));
  const canvas = createNodeCanvas({ document, viewport, graph, svg, wire, nodeMap, controls });
  canvas.mount();
  expect(canvas.focusNodes(["missing", "left-crop", "left-grid"])).toBe(true);
  const crop = nodeMap.get("left-crop"); const grid = nodeMap.get("left-grid");
  const transform = graph.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/);
  const [, x, y, scale] = transform.map(Number);
  const left = Math.min(crop.offsetLeft, grid.offsetLeft);
  const top = Math.min(crop.offsetTop, grid.offsetTop);
  const right = Math.max(crop.offsetLeft + crop.offsetWidth, grid.offsetLeft + grid.offsetWidth);
  const bottom = Math.max(crop.offsetTop + crop.offsetHeight, grid.offsetTop + grid.offsetHeight);
  expect(Number(scale) * (right - left)).toBeLessThanOrEqual(900 - 56);
  expect(Number(scale) * (bottom - top)).toBeLessThanOrEqual(560 - 56);
  expect(Number(x) + (left + right) / 2 * Number(scale)).toBeCloseTo(450);
  expect(Number(y) + (top + bottom) / 2 * Number(scale)).toBeCloseTo(280);
  const previous = graph.style.transform;
  expect(canvas.focusNodes(["missing"])).toBe(false);
  expect(graph.style.transform).toBe(previous);
  canvas.dispose();
});

test("a focused group stays framed after node movement and viewport resize", () => {
  let resize;
  globalThis.ResizeObserver = class { constructor(callback) { resize = callback; } observe() {} disconnect() {} };
  const document = fakeElement();
  const viewport = fakeElement(900, 560);
  viewport.clientWidth = 900; viewport.clientHeight = 560;
  const graph = fakeElement(); const svg = fakeElement(); const wire = fakeElement();
  const controls = { zoomIn: fakeElement(), zoomOut: fakeElement(), zoomReset: fakeElement(), zoomOne: fakeElement() };
  const nodeMap = new Map(ids.map((id) => { const card = fakeElement(330); card.header = fakeElement(); return [id, card]; }));
  const canvas = createNodeCanvas({ document, viewport, graph, svg, wire, nodeMap, controls });
  canvas.mount();
  canvas.focusNodes(["clock-gis", "clock-projection"]);
  const clock = nodeMap.get("clock-gis");
  clock.style.left = `${clock.offsetLeft + 80}px`;
  viewport.clientWidth = 520; viewport.clientHeight = 720;
  resize();
  const [, x, y, scale] = graph.style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/).map(Number);
  const a = nodeMap.get("clock-gis"); const b = nodeMap.get("clock-projection");
  const left = Math.min(a.offsetLeft, b.offsetLeft); const right = Math.max(a.offsetLeft + a.offsetWidth, b.offsetLeft + b.offsetWidth);
  const top = Math.min(a.offsetTop, b.offsetTop); const bottom = Math.max(a.offsetTop + a.offsetHeight, b.offsetTop + b.offsetHeight);
  expect(Number(x) + (left + right) / 2 * Number(scale)).toBeCloseTo(260);
  expect(Number(y) + (top + bottom) / 2 * Number(scale)).toBeCloseTo(360);
  expect(Number(scale) * (right - left)).toBeLessThanOrEqual(520 - 56);
  canvas.dispose();
  delete globalThis.ResizeObserver;
});
