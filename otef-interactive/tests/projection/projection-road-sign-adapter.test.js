import { describe, expect, test, vi } from "vitest";
import { createProjectionRoadSignAdapter, reportRoadSignError } from "../../frontend/src/projection/projection-road-sign-adapter.js";
import { createProjectionBrowserSurface } from "../../frontend/src/projection/projection-browser-route.js";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";

function fakeContext() {
  const calls = [];
  return new Proxy({ calls }, { get(target, key) { if (key in target) return target[key]; return (...args) => calls.push([key, ...args]); },
    set(target, key, value) { target[key] = value; return true; } });
}
function harness() {
  const canvases = [];
  const images = [];
  const doc = { createElement(tag) {
    if (tag === "canvas") { const context = fakeContext(); const canvas = { width: 0, height: 0, context, getContext: () => context }; canvases.push(canvas); return canvas; }
    const image = { complete: true, naturalWidth: 0, naturalHeight: 0, set src(value) { this._src = value; this.complete = true; this.naturalWidth = 524; this.naturalHeight = 381; }, get src() { return this._src; }, decode: async function () { this.complete = true; this.naturalWidth = 524; this.naturalHeight = 381; } };
    images.push(image);
    return image;
  } };
  return { doc, canvases, images };
}
const settings = { version: 1, outputs: { left: [{ id: "11111111-1111-4111-8111-111111111111", x: 200, y: 300, scale: .7, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: false, x: 200, y: 300 } }], right: [{ id: "22222222-2222-4222-8222-222222222222", x: 1700, y: 700, scale: .7, rotateDeg: 0, theme: "original", visible: true, leader: { enabled: false, x: 1700, y: 700 } }] } };

describe("projection Road 232 adapter", () => {
  test("loads scalable light artwork without changing its calibrated footprint", async () => {
    const { doc, images } = harness();
    const adapter = createProjectionRoadSignAdapter({ document: doc, output: "right" });
    adapter.setState({ settings, eligible: true });
    await adapter.ready();
    const descriptor = adapter.descriptor();
    const draw = descriptor.source.context.calls.find(([name]) => name === "drawImage");
    expect(new URL(images[1].src).pathname).toMatch(/road-232-original\.svg$/);
    expect(draw[1]).toBe(images[1]);
    expect(draw.slice(2)).toEqual([-57, -114 * 381 / 524 / 2, 114, 114 * 381 / 524]);
    adapter.dispose();
  });

  test("uses per-output source ownership, identity placement, and stable cached contentVersion", async () => {
    const { doc, canvases } = harness();
    const adapter = createProjectionRoadSignAdapter({ document: doc, output: "right", rasterScale: 1, onInvalidate: vi.fn(), onError: vi.fn() });
    adapter.setState({ settings, eligible: true });
    await adapter.ready();
    const descriptor = adapter.descriptor();
    expect(descriptor.source).toBe(canvases[0]);
    expect(Number.isSafeInteger(descriptor.contentVersion)).toBe(true);
    expect(descriptor.matrix).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(descriptor.clip).toEqual([0, 0, 1, 1]);
    expect(canvases[0].context.calls).toContainEqual(["translate", 1700, 700]);
    const imageDraw = canvases[0].context.calls.find(([name]) => name === "drawImage");
    expect(imageDraw[2]).toBe(-57);
    expect(imageDraw[3]).toBeCloseTo(-41.4447, 3);
    expect(imageDraw[4]).toBe(114);
    expect(imageDraw[5]).toBeCloseTo(82.8893, 3);
    expect(adapter.descriptor().contentVersion).toBe(descriptor.contentVersion);
    const calls = canvases[0].context.calls.length;
    adapter.setState({ settings, eligible: true });
    expect(adapter.descriptor().contentVersion).toBe(descriptor.contentVersion);
    expect(canvases[0].context.calls).toHaveLength(calls);
    adapter.setState({ settings, eligible: false });
    expect(adapter.descriptor()).toBeNull();
    adapter.setState({ settings, eligible: true });
    expect(adapter.descriptor()).toEqual(descriptor);
    adapter.dispose();
  });

  test("hides disabled, ineligible, and missing artwork as null", async () => {
    const { doc } = harness();
    const adapter = createProjectionRoadSignAdapter({ document: doc, output: "left" });
    adapter.setState({ settings, eligible: false });
    await adapter.ready();
    expect(adapter.descriptor()).toBeNull();
    adapter.setState({ settings: { ...settings, outputs: { ...settings.outputs, left: settings.outputs.left.map(s => ({ ...s, visible: false })) } }, eligible: true });
    expect(adapter.descriptor()).toBeNull();
    adapter.dispose();
  });

  test("reports artwork load failure without emitting a descriptor", async () => {
    const errors = [];
    const doc = { createElement(tag) { if (tag === "canvas") return { width: 0, height: 0, getContext: () => fakeContext() }; return { set src(value) { this._src = value; }, get src() { return this._src; }, decode: async () => { throw new Error("missing artwork"); } }; } };
    const adapter = createProjectionRoadSignAdapter({ document: doc, output: "left", onError: error => errors.push(error) });
    adapter.setState({ settings, eligible: true });
    await adapter.ready();
    expect(adapter.descriptor()).toBeNull();
    expect(errors).toHaveLength(1);
    adapter.dispose();
  });

  test("optional artwork failure logs without masking the projection map", async () => {
    const errors = [];
    const draws = [];
    const hostChildren = [];
    const doc = { createElement(tag) {
      if (tag === "canvas") { const context = fakeContext(); return { width: 0, height: 0, getContext: () => context }; }
      return { onload: null, onerror: null, set src(value) { this._src = value; }, get src() { return this._src; }, decode: async () => { throw new Error("missing optional artwork"); } };
    } };
    const host = { ownerDocument: doc, appendChild(node) { hostChildren.push(node); } };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = createProjectionRoadSignAdapter({ document: doc, output: "left", onError: (error) => {
      errors.push(error);
      reportRoadSignError(error);
    } });
    adapter.setState({ settings, eligible: true });
    const surface = await createProjectionBrowserSurface({ host, spanId: "left",
      image: { complete: true, naturalWidth: 10, style: {} },
      initialConfig: structuredClone(DEFAULT_PROJECTION_CONFIG), fetchImpl: async () => ({ ok: false }),
      getScene: () => ({ map: { source: { width: 1920, height: 1080 }, contentVersion: 1 }, roadSigns: adapter.descriptor() }),
      rendererFactory: () => ({ draw: scene => draws.push(scene), isContextLost: () => false, dispose() {} }) });
    try {
      await adapter.ready();
      surface.draw();
      expect(errors).toHaveLength(1);
      expect(warn).toHaveBeenCalledOnce();
      expect(draws.at(-1).layers.map(layer => layer.id)).toEqual(["map"]);
      expect(hostChildren.some((node) => node.className === "projection-browser-error")).toBe(false);
    } finally {
      surface.dispose();
      adapter.dispose();
      warn.mockRestore();
    }
  });

  test("disposing during pending artwork loads releases handlers and ignores late errors", async () => {
    const images = [];
    const rejects = [];
    const errors = [];
    const doc = { createElement(tag) {
      if (tag === "canvas") return { width: 0, height: 0, getContext: () => fakeContext() };
      const image = { set src(value) { this._src = value; }, get src() { return this._src; },
        decode: () => new Promise((_resolve, reject) => rejects.push(reject)) };
      images.push(image);
      return image;
    } };
    const adapter = createProjectionRoadSignAdapter({ document: doc, output: "left", onError: error => errors.push(error) });
    const ready = adapter.ready();
    adapter.dispose();
    expect(images.every((image) => image.onload === null && image.onerror === null)).toBe(true);
    rejects.forEach((reject) => reject(new Error("late decode failure")));
    await ready;
    expect(errors).toEqual([]);
    expect(adapter.descriptor()).toBeNull();
  });

  test("requests redraw when settings or eligibility change", async () => {
    const { doc } = harness(); const onInvalidate = vi.fn();
    const adapter = createProjectionRoadSignAdapter({ document: doc, output: "left", onInvalidate });
    adapter.setState({ settings, eligible: true });
    await adapter.ready();
    const initial = onInvalidate.mock.calls.length;
    adapter.setState({ settings, eligible: false });
    expect(onInvalidate).toHaveBeenCalledTimes(initial + 1);
    adapter.dispose();
  });
});
