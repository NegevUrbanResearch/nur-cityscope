import { afterEach, expect, test, vi } from "vitest";
import { createProjectionShelterAdapter } from "../../frontend/src/projection/projection-shelter-adapter.js";
import { SHELTER_LAYER_ID } from "../../frontend/src/shared/maplibre-nli-shelters.js";

afterEach(() => vi.unstubAllGlobals());

function harness() {
  vi.stubGlobal("Path2D", class { constructor(data) { this.data = data; } });
  const fills = [], transforms = [], draws = [];
  const ctx = { save() {}, restore() {}, clearRect() {}, stroke() {},
    setTransform(...args) { transforms.push(["setTransform", ...args]); },
    translate(...args) { transforms.push(["translate", ...args]); },
    rotate(...args) { transforms.push(["rotate", ...args]); },
    scale(...args) { transforms.push(["scale", ...args]); },
    fill(path) { fills.push({ color: this.fillStyle, path: path.data, opacity: this.globalAlpha }); },
    drawImage(...args) { draws.push({ args, opacity: this.globalAlpha }); },
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const glyph = { width: 0, height: 0, getContext: () => ctx };
  let canvasCount = 0;
  const map = { project: ([x, y]) => ({ x, y }), getZoom: () => 12,
    getLayer: id => id === SHELTER_LAYER_ID ? { layout: { visibility: "visible" } } : null,
    getPaintProperty: () => 0.4,
  };
  const shelter = { id: "a", geometry: { coordinates: [200, 300] }, properties: {} };
  const snapshot = { frame: { visible: true, shelters: [shelter], impactedIds: new Set(["a"]) },
    layout: new Map([["a", { size: 0.25, offset: [2, 0], rotationDeg: 85 }]]), colors: new Map([["a", 0.5]]) };
  const adapter = createProjectionShelterAdapter({ map, document: { createElement: () => canvasCount++ ? glyph : canvas }, getSnapshot: () => snapshot });
  const descriptor = { source: { width: 3840, height: 2160, clientWidth: 1920, clientHeight: 1080 },
    matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], clip: [0, 0, 1, 1] };
  return { adapter, descriptor, map, snapshot, fills, transforms, canvas, glyph, draws };
}

test("draws shelter vectors at map output density with existing rotation, offset, and palette", () => {
  const h = harness();
  const result = h.adapter.descriptor(h.descriptor);
  expect([h.canvas.width, h.canvas.height]).toEqual([3840, 2160]);
  expect(result.matrix).toEqual(h.descriptor.matrix);
  expect(result.clip).toEqual(h.descriptor.clip);
  expect(h.transforms.some(([op, x, , , y]) => op === "setTransform" && x === 2 && y === 2)).toBe(true);
  expect(h.transforms).toContainEqual(["rotate", 85 * Math.PI / 180]);
  expect(h.transforms).toContainEqual(["scale", 0.25, 0.25]);
  const translation = h.transforms.find(([op]) => op === "translate");
  expect(translation[1]).toBeCloseTo(200 + 0.5 * Math.cos(85 * Math.PI / 180));
  expect(translation[2]).toBeCloseTo(300 + 0.5 * Math.sin(85 * Math.PI / 180));
  expect(h.fills[0]).toMatchObject({ color: "#a5757a", opacity: 1 });
  expect(h.draws[0].opacity).toBe(0.4);
  expect(h.draws[0].args[0]).toBe(h.glyph);
  expect(h.draws[0].args).toHaveLength(3);
  expect(h.glyph.width).toBeLessThan(30);
  expect(h.glyph.height).toBeLessThan(30);
  expect(h.adapter.descriptor(h.descriptor).contentVersion).toBe(result.contentVersion);
  h.adapter.dispose();
  expect(h.adapter.descriptor(h.descriptor)).toBeNull();
});

test("follows lifecycle focus expressions, color frames, and visibility", () => {
  const h = harness();
  h.map.getPaintProperty = () => ["case", ["in", ["get", "shelterId"], ["literal", ["a"]]], 0.3, 0];
  const first = h.adapter.descriptor(h.descriptor);
  expect(h.draws[0].opacity).toBe(0.3);
  h.snapshot.colors.set("a", 1);
  expect(h.adapter.descriptor(h.descriptor).contentVersion).toBeGreaterThan(first.contentVersion);
  expect(h.fills.at(-1).color).toBe("#ed829e");
  h.map.getPaintProperty = () => 0;
  expect(h.adapter.descriptor(h.descriptor)).toBeNull();
  h.map.getPaintProperty = () => 1;
  h.snapshot.frame.visible = false;
  expect(h.adapter.descriptor(h.descriptor)).toBeNull();
});
