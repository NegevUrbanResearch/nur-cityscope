import { expect, test, vi } from "vitest";
import { createProjectionSettlementNameAdapter } from "../../frontend/src/projection/projection-settlement-name-adapter.js";
import { bindProjectionSettlementNames } from "../../frontend/src/projection/projection-settlement-name-runtime.js";
import { resolveProjectionSceneLayers } from "../../frontend/src/projection/projection-surface-compositor.js";

const catalog = { entries: [{ citycode: "0067", text: "נירים", lng: 34.4, lat: 31.3 }, { citycode: "0424", text: "מחוץ", lng: 34.2, lat: 31.2 }] };

function settingsFixture() {
  return {
    baseline: {
      captureId: "fixture-settlement-name", captureDigest: "a".repeat(64), sourceDigest: "b".repeat(64), catalogDigest: "c".repeat(64),
      predecessor: { revision: 1, configDigest: "d".repeat(64) }, successor: { revision: 2, configDigest: "e".repeat(64) },
      outputs: { left: { "0067": { x: 510, y: 350 } }, right: { "0067": { x: 1200, y: 360 } } },
    },
    style: { fontFamily: "Guttman Hatzvi", fontPx: 14, rotateDeg: 35 },
    outputs: { left: {}, right: { "0067": { x: 1200, y: 360 } } },
  };
}

function fakeCanvasDocument() {
  const paints = [];
  const document = {
    paints,
    fonts: { load: async (spec) => { if (document.fonts.fail) throw new Error("font failed"); return [spec]; } },
    createElement() {
      const canvas = { width: 8, height: 8, getContext() {
        const context = {
          font: "", globalAlpha: 1,
          measureText: () => ({ width: 12, actualBoundingBoxLeft: 6, actualBoundingBoxRight: 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
          clearRect() {}, translate() {}, rotate() {}, drawImage() {}, save() {}, restore() {},
          getImageData: () => ({ data: new Uint8ClampedArray(64) }),
          strokeText() {},
          fillText(text) { paints.push({ op: "fill", text, globalAlpha: context.globalAlpha, canvasWidth: canvas.width }); },
        };
        return context;
      } };
      return canvas;
    },
  };
  return document;
}

function contextFor(settings) {
  const listeners = { settlementNames: new Set(), layerGroups: new Set() };
  const state = { settings: structuredClone(settings), revision: 3, error: settings ? null : "Initialization required", groups: [{ id: "projector_base", enabled: true, layers: [{ id: "שמות_יישובים", enabled: true }] }] };
  return {
    state,
    getSettlementNameSettings: () => state.settings,
    getSettlementNameRevision: () => state.revision,
    getSettlementNameError: () => state.error,
    subscribe(key, listener) {
      listeners[key]?.add(listener);
      if (key === "settlementNames") listener({ settings: state.settings, revision: state.revision, error: state.error });
      if (key === "layerGroups") listener(state.groups);
      return () => listeners[key]?.delete(listener);
    },
    emit(key) {
      const payload = key === "layerGroups" ? state.groups : { settings: state.settings, revision: state.revision, error: state.error };
      for (const listener of listeners[key] || []) listener(payload);
    },
  };
}

test("one accepted position redraws settlements without touching the other output or people names", async () => {
  const doc = fakeCanvasDocument();
  const left = createProjectionSettlementNameAdapter({ document: doc, output: "left" });
  const right = createProjectionSettlementNameAdapter({ document: doc, output: "right" });
  const people = { prepare: vi.fn(), commit: vi.fn() };
  const draws = [];
  const data = contextFor(settingsFixture());
  const disposeLeft = bindProjectionSettlementNames({ dataContext: data, adapter: left, catalog, getGroups: () => data.state.groups, onDraw: () => draws.push("left"), onError: vi.fn() });
  const disposeRight = bindProjectionSettlementNames({ dataContext: data, adapter: right, catalog, getGroups: () => data.state.groups, onDraw: () => draws.push("right"), onError: vi.fn() });
  await vi.waitFor(() => expect(left.getLabels().find((item) => item.citycode === "0067")?.x).toBe(510));
  draws.length = 0;
  data.state.settings.outputs.left["0067"] = { x: 20, y: 30 };
  data.state.revision += 1;
  data.emit("settlementNames");
  await vi.waitFor(() => expect(left.getLabels().find((item) => item.citycode === "0067")).toMatchObject({ x: 20, y: 30 }));
  expect(right.getLabels().find((item) => item.citycode === "0067")).toMatchObject({ x: 1200, y: 360 });
  expect(draws.every((draw) => draw === "left" || draw === "right")).toBe(true);
  expect(people.prepare).not.toHaveBeenCalled();
  expect(people.commit).not.toHaveBeenCalled();
  expect(resolveProjectionSceneLayers({ image: {}, map: {}, settlements: left.descriptor(), names: { source: {} }, caption: {}, pattern: {}, legend: {} }).map((layer) => layer.id))
    .toEqual(["image", "map", "settlements", "names", "caption", "pattern", "legend"]);
  disposeLeft();
  disposeRight();
});

test("context style updates both outputs and wall rotation does not overwrite it", async () => {
  const doc = fakeCanvasDocument();
  const left = createProjectionSettlementNameAdapter({ document: doc, output: "left" });
  const right = createProjectionSettlementNameAdapter({ document: doc, output: "right" });
  const data = contextFor(settingsFixture());
  data.namesWall = { rotateDeg: 35 };
  const disposeLeft = bindProjectionSettlementNames({ dataContext: data, adapter: left, catalog, getGroups: () => data.state.groups, onDraw: () => {}, onError: vi.fn() });
  const disposeRight = bindProjectionSettlementNames({ dataContext: data, adapter: right, catalog, getGroups: () => data.state.groups, onDraw: () => {}, onError: vi.fn() });
  await vi.waitFor(() => expect(left.getLabels()[0].rotateDeg).toBe(35));
  data.namesWall.rotateDeg = 70;
  data.emit("settlementNames");
  await vi.waitFor(() => expect(left.getLabels()[0].rotateDeg).toBe(35));
  expect(right.getLabels()[0].rotateDeg).toBe(35);
  data.state.settings.style = { ...data.state.settings.style, fontPx: 24, rotateDeg: -20 };
  data.state.revision += 1;
  data.emit("settlementNames");
  await vi.waitFor(() => expect(left.getLabels().find((item) => item.citycode === "0067")).toMatchObject({ x: 510, y: 350, rotateDeg: -20 }));
  expect(right.getLabels().find((item) => item.citycode === "0067")).toMatchObject({ x: 1200, y: 360, rotateDeg: -20 });
  data.state.settings.style = { ...data.state.settings.style, rotateDeg: 12 };
  data.state.revision += 1;
  data.emit("settlementNames");
  await vi.waitFor(() => expect(left.getLabels().find((item) => item.citycode === "0067")).toMatchObject({ x: 510, y: 350, rotateDeg: 12 }));
  expect(right.getLabels().find((item) => item.citycode === "0067")).toMatchObject({ x: 1200, y: 360, rotateDeg: 12 });
  disposeLeft();
  disposeRight();
});

test("layer visibility never discards stored positions", async () => {
  const doc = fakeCanvasDocument();
  const adapter = createProjectionSettlementNameAdapter({ document: doc, output: "left" });
  const data = contextFor(settingsFixture());
  const dispose = bindProjectionSettlementNames({ dataContext: data, adapter, catalog, getGroups: () => data.state.groups, onDraw: () => {}, onError: vi.fn() });
  await vi.waitFor(() => expect(adapter.getLabels()).toHaveLength(1));
  data.state.groups[0].layers[0].enabled = false;
  data.emit("layerGroups");
  expect(adapter.descriptor().opacity).toBe(0);
  expect(adapter.getLabels()[0]).toMatchObject({ citycode: "0067", x: 510, y: 350 });
  expect(data.state.settings.outputs.left).toEqual({});
  dispose();
});

test("adopts the current lifecycle text-opacity when binding after the first write", async () => {
  const doc = fakeCanvasDocument();
  const adapter = createProjectionSettlementNameAdapter({ document: doc, output: "left" });
  const data = contextFor(settingsFixture());
  data.state.settings.baseline.outputs.left["0424"] = { x: 40, y: 80 };
  const map = {
    getPaintProperty(id, property) {
      if (id === "projector_base__שמות_יישובים__labels" && property === "text-opacity") {
        return ["case", ["in", ["get", "cityname"], ["literal", ["נירים"]]], 1, 0.08];
      }
      return undefined;
    },
  };
  const dispose = bindProjectionSettlementNames({
    dataContext: data, adapter, catalog, map, getGroups: () => data.state.groups, onDraw: () => {}, onError: vi.fn(),
  });
  await vi.waitFor(() => expect(adapter.getLabels()).toHaveLength(2));
  const fills = doc.paints.filter((paint) => paint.op === "fill");
  expect(fills.filter((paint) => paint.text === "נירים").at(-1).globalAlpha).toBe(1);
  expect(fills.filter((paint) => paint.text === "מחוץ").at(-1).globalAlpha).toBeCloseTo(0.08);
  dispose();
});

test("hides canvas names when the pack is off even if the layer flag stays on", async () => {
  const doc = fakeCanvasDocument();
  const adapter = createProjectionSettlementNameAdapter({ document: doc, output: "left" });
  const data = contextFor(settingsFixture());
  data.state.groups[0].enabled = false;
  data.state.groups[0].layers[0].enabled = true;
  const dispose = bindProjectionSettlementNames({ dataContext: data, adapter, catalog, getGroups: () => data.state.groups, onDraw: () => {}, onError: vi.fn() });
  await vi.waitFor(() => expect(adapter.getLabels()[0]).toMatchObject({ citycode: "0067", x: 510, y: 350 }));
  expect(adapter.descriptor()?.opacity).toBe(0);
  dispose();
});

test("fonts fail visibly without fallback coordinates", async () => {
  const doc = fakeCanvasDocument();
  doc.fonts.fail = true;
  const adapter = createProjectionSettlementNameAdapter({ document: doc, output: "right" });
  const onError = vi.fn();
  const data = contextFor(settingsFixture());
  const dispose = bindProjectionSettlementNames({ dataContext: data, adapter, catalog, getGroups: () => data.state.groups, onDraw: vi.fn(), onError });
  await vi.waitFor(() => expect(onError).toHaveBeenCalled());
  expect(String(onError.mock.calls[0][0].message)).toMatch(/font/i);
  expect(adapter.getLabels()).toEqual([]);
  expect(data.state.settings.outputs.right["0067"]).toEqual({ x: 1200, y: 360 });
  dispose();
});

test("missing initialized settings disables labels with a setup error", async () => {
  const doc = fakeCanvasDocument();
  const adapter = createProjectionSettlementNameAdapter({ document: doc, output: "left" });
  const onError = vi.fn();
  const data = contextFor(null);
  data.state.revision = 0;
  const dispose = bindProjectionSettlementNames({ dataContext: data, adapter, catalog, getGroups: () => data.state.groups, onDraw: vi.fn(), onError });
  await vi.waitFor(() => expect(onError).toHaveBeenCalled());
  expect(String(onError.mock.calls[0][0].message)).toMatch(/Initialization required/);
  expect(adapter.getLabels()).toEqual([]);
  dispose();
});

test("a later missing initialization hides labels already on screen and shows the setup error", async () => {
  const doc = fakeCanvasDocument();
  const adapter = createProjectionSettlementNameAdapter({ document: doc, output: "left" });
  const alert = { className: "", style: {}, textContent: "", setAttribute() {}, remove() { host.child = null; } };
  const host = {
    child: null,
    querySelector(selector) { return selector === ".projection-browser-error" ? this.child : null; },
    appendChild(node) { this.child = node; },
    ownerDocument: { createElement: () => alert },
  };
  const onDraw = vi.fn();
  const onError = vi.fn();
  const data = contextFor(settingsFixture());
  const dispose = bindProjectionSettlementNames({ dataContext: data, adapter, catalog, host, getGroups: () => data.state.groups, onDraw, onError });
  await vi.waitFor(() => expect(adapter.descriptor()?.opacity).toBe(1));
  data.state.settings = null;
  data.state.revision = 0;
  data.state.error = "Initialization required";
  data.emit("settlementNames");
  await vi.waitFor(() => expect(onError).toHaveBeenCalled());
  expect(adapter.descriptor().opacity).toBe(0);
  expect(host.child?.textContent || "").toMatch(/Initialization required/);
  expect(onDraw).toHaveBeenCalled();
  dispose();
});

test("recovering settings removes only the settlement setup alert", async () => {
  const doc = fakeCanvasDocument();
  const adapter = createProjectionSettlementNameAdapter({ document: doc, output: "left" });
  const unrelated = {
    className: "projection-browser-error",
    textContent: "Browser projection unavailable: WebGL context lost",
    removed: false,
    remove() { this.removed = true; },
  };
  const setup = {
    className: "", style: {}, textContent: "", dataset: {}, removed: false,
    setAttribute() {},
    remove() { this.removed = true; host.alerts = host.alerts.filter((node) => node !== setup); },
  };
  const host = {
    alerts: [],
    querySelector(selector) {
      if (selector !== ".projection-browser-error") return null;
      return this.alerts.find((node) => String(node.className).split(/\s+/).includes("projection-browser-error")) || null;
    },
    appendChild(node) { this.alerts.push(node); },
    ownerDocument: { createElement: () => setup },
  };
  const data = contextFor(null);
  data.state.revision = 0;
  const dispose = bindProjectionSettlementNames({ dataContext: data, adapter, catalog, host, getGroups: () => data.state.groups, onDraw: vi.fn(), onError: vi.fn() });
  await vi.waitFor(() => expect(setup.textContent).toMatch(/Initialization required/));
  host.alerts.unshift(unrelated);
  data.state.settings = settingsFixture();
  data.state.revision = 3;
  data.state.error = null;
  data.emit("settlementNames");
  await vi.waitFor(() => expect(adapter.descriptor()?.opacity).toBe(1));
  expect(setup.removed).toBe(true);
  expect(unrelated.removed).toBe(false);
  dispose();
});
