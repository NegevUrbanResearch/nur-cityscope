import { expect, test, vi } from "vitest";
import {
  createProjectionBrowserSurface,
  loadCapturedProjectionBaseline,
  resolveProjectionOutputMode,
} from "../../frontend/src/projection/projection-browser-route.js";
import { sha256Hex } from "../../frontend/src/shared/sha256-hex.js";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { createIdentityProjectionMesh } from "../../frontend/src/shared/projection-warp-geometry.js";
import { migrateProjectionConfigToV2 } from "../../frontend/src/shared/projection-warp-schema.js";
import { createProjectionImageDescriptor } from "../../frontend/src/projection/projection-span-view.js";

const framingConfig = {
  schemaVersion: 1,
  pre: { scale: 1, rotateDeg: 0, tx: 0, ty: 0 },
  outputs: {
    left: { crop: { x0: 0, x1: 1, y0: 0, y1: 1 }, post: { scale: 1, tx: 0, ty: 0 } },
    right: { crop: { x0: 0, x1: 1, y0: 0, y1: 1 }, post: { scale: 1, tx: 0, ty: 0 } },
  },
};

test("selects browser mode only for the explicit outputMode query", () => {
  expect(resolveProjectionOutputMode("?span=left")).toBe("td");
  expect(resolveProjectionOutputMode("?span=left&outputMode=browser")).toBe("browser");
});

test("uses geographic projective placement and viewport normalization for the image layer", () => {
  const map = {
    _otefProjectionImage: { corners: [[0, 0], [1, 0], [1, 1], [0, 1]], width: 800, height: 400 },
    project(point) {
      const x = point[0];
      const y = point[1];
      return {
        x: 100 + x * 1540 + y * 80 - x * y * 20,
        y: 80 + x * 40 + y * 820 - x * y * 10,
      };
    },
    getContainer() { return { clientWidth: 1920, clientHeight: 1080 }; },
  };
  const image = { style: { opacity: "0.5" } };
  const descriptor = createProjectionImageDescriptor({ map, imageEl: image, spanId: "left" });
  expect(descriptor.opacity).toBe(0.5);
  expect(descriptor.clip).toEqual([0, 0, 1, 1]);
  const mapSourceToOutput = (u, v) => {
    const m = descriptor.matrix;
    const denominator = m[2] * u + m[5] * v + m[8];
    return [
      (m[0] * u + m[3] * v + m[6]) / denominator,
      (m[1] * u + m[4] * v + m[7]) / denominator,
    ];
  };
  expect(mapSourceToOutput(0, 0)[0]).toBeCloseTo(100 / 1920);
  expect(mapSourceToOutput(0, 0)[1]).toBeCloseTo(80 / 1080);
  expect(mapSourceToOutput(1, 0)[0]).toBeCloseTo(1640 / 1920);
  expect(mapSourceToOutput(1, 0)[1]).toBeCloseTo(120 / 1080);
  expect(mapSourceToOutput(1, 1)[0]).toBeCloseTo(1700 / 1920);
  expect(mapSourceToOutput(1, 1)[1]).toBeCloseTo(930 / 1080);
  expect(mapSourceToOutput(0, 1)[0]).toBeCloseTo(180 / 1920);
  expect(mapSourceToOutput(0, 1)[1]).toBeCloseTo(900 / 1080);
});

test("loads the captured 1920x1080 asset for the requested span", async () => {
  const framing = new TextEncoder().encode(JSON.stringify(framingConfig));
  const mesh = new TextEncoder().encode(JSON.stringify({ width: 1920, height: 1080, vertices: [{ s: 0, t: 0, x: 0, y: 0, u: 0, v: 0 }, { s: 1, t: 0, x: 1, y: 0, u: 1, v: 0 }, { s: 0, t: 1, x: 0, y: 1, u: 0, v: 1 }], triangles: [0, 1, 2] }));
  const manifest = { width: 1920, height: 1080, assets: { left: { path: "left.json", sha256: await sha256Hex(mesh) } }, framing: { path: "../td-source-config.json", sha256: await sha256Hex(framing) } };
  const fetchImpl = vi.fn(async (url) => ({ ok: true, async arrayBuffer() { return url.endsWith("manifest.json") ? new TextEncoder().encode(JSON.stringify(manifest)).buffer : (url.endsWith("td-source-config.json") ? framing : mesh).buffer; } }));
  const result = await loadCapturedProjectionBaseline({ fetchImpl, spanId: "left", base: "/baseline/" });
  expect(result.manifest.width).toBe(1920); expect(fetchImpl).toHaveBeenLastCalledWith("/baseline/left.json");
});

test("verifies the manifest-selected mesh and pinned framing bytes", async () => {
  const framing = new TextEncoder().encode(JSON.stringify(framingConfig));
  const mesh = new TextEncoder().encode('{"width":1920,"height":1080}');
  const manifest = {
    width: 1920,
    height: 1080,
    assets: { left: { path: "left.json", sha256: await sha256Hex(mesh) } },
    framing: { path: "../td-source-config.json", sha256: await sha256Hex(framing) },
  };
  const fetchImpl = vi.fn(async (url) => ({
    ok: true,
    async arrayBuffer() {
      if (url.endsWith("manifest.json")) return new TextEncoder().encode(JSON.stringify(manifest)).buffer;
      return (url.endsWith("td-source-config.json") ? framing : mesh).buffer;
    },
  }));
  const result = await loadCapturedProjectionBaseline({ fetchImpl, spanId: "left", base: "/baseline/" });
  expect(result.framing).toEqual(framingConfig);
  expect(result.mesh).toEqual({ width: 1920, height: 1080 });
  expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
    "/baseline/manifest.json",
    "/td-source-config.json",
    "/baseline/left.json",
  ]);
});

test("rejects a stale mesh or framing digest before browser rendering", async () => {
  const fetchImpl = vi.fn(async (url) => ({
    ok: true,
    async arrayBuffer() {
      if (url.endsWith("manifest.json")) return new TextEncoder().encode(JSON.stringify({
        width: 1920,
        height: 1080,
        assets: { left: { path: "left.json", sha256: "stale" } },
        framing: { path: "../td-source-config.json", sha256: "stale" },
      })).buffer;
      return new TextEncoder().encode("{}").buffer;
    },
  }));
  await expect(loadCapturedProjectionBaseline({ fetchImpl, spanId: "left", base: "/baseline/" }))
    .rejects.toThrow(/hash mismatch|digest/i);
});

test("composes only actual scene descriptors and restores source visibility on dispose", async () => {
  const draws = [];
  const host = { children: [], appendChild(node) { this.children.push(node); node.parentElement = this; }, removeChild(node) { this.children = this.children.filter((item) => item !== node); } };
  const image = { complete: true, naturalWidth: 10, style: { visibility: "visible" } };
  const mapCanvas = { style: { visibility: "visible" } };
  const legend = { style: { visibility: "visible" } };
  const oldDocument = globalThis.document;
  globalThis.document = { createElement() { return { style: {}, setAttribute() {}, remove() { this.removed = true; } }; } };
  const surface = await createProjectionBrowserSurface({
    host,
    spanId: "left",
    image,
    mapCanvas,
    hideTargets: [image, mapCanvas, legend],
    fetchImpl: async (url) => ({
      ok: true,
      async arrayBuffer() {
        const framing = new TextEncoder().encode(JSON.stringify(framingConfig));
        const mesh = new TextEncoder().encode(JSON.stringify({ width: 1920, height: 1080, vertices: [{ s: 0, t: 0, x: 0, y: 0, u: 0, v: 0 }, { s: 1, t: 0, x: 1, y: 0, u: 1, v: 0 }, { s: 0, t: 1, x: 0, y: 1, u: 0, v: 1 }], triangles: [0, 1, 2] }));
        const manifest = { width: 1920, height: 1080, assets: { left: { path: "left.json", sha256: await sha256Hex(mesh) } }, framing: { path: "../td-source-config.json", sha256: await sha256Hex(framing) } };
        return (url.endsWith("manifest.json") ? new TextEncoder().encode(JSON.stringify(manifest)) : url.endsWith("td-source-config.json") ? framing : mesh).buffer;
      },
    }),
    rendererFactory: () => ({ draw(scene) { draws.push(scene); }, dispose() {} }),
    scene: { image: { source: image }, map: { source: mapCanvas }, caption: null, pattern: null, legend: { source: legend } },
  });
  expect(draws[0].layers.map((layer) => layer.id)).toEqual(["image", "map", "legend"]);
  expect(image.style.visibility).toBe("hidden");
  expect(mapCanvas.style.visibility).toBe("hidden");
  surface.dispose();
  expect(image.style.visibility).toBe("visible");
  expect(legend.style.visibility).toBe("visible");
  globalThis.document = oldDocument;
});

test("identity startup tolerates an unavailable optional TD mesh preload", async () => {
  const host = { children: [], appendChild(node) { this.children.push(node); }, removeChild() {} };
  const image = { complete: true, naturalWidth: 10, style: { visibility: "visible" } };
  const oldDocument = globalThis.document;
  globalThis.document = { createElement() { return { style: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, remove() {} }; } };
  const framing = new TextEncoder().encode(JSON.stringify(framingConfig));
  const manifest = { width: 1920, height: 1080, assets: { left: { path: "left.json", sha256: "a".repeat(64) } }, framing: { path: "../td-source-config.json", sha256: await sha256Hex(framing) } };
  let initialMesh;
  const fetchImpl = vi.fn(async (url) => ({ ok: !url.endsWith("left.json"), async arrayBuffer() { return url.endsWith("manifest.json") ? new TextEncoder().encode(JSON.stringify(manifest)).buffer : framing.buffer; } }));
  const surface = await createProjectionBrowserSurface({
    host, spanId: "left", image, initialConfig: framingConfig,
    fetchImpl,
    rendererFactory: ({ mesh }) => { initialMesh = mesh; return { draw: () => true, setMesh: vi.fn(), isContextLost: () => false, dispose() {} }; },
  });
  expect(initialMesh.vertices.length).toBe(49);
  expect(surface.getBaselineIdentity()).toEqual({ type: "identity" });
  expect(fetchImpl.mock.calls.some(([url]) => url.endsWith("left.json"))).toBe(true);
  surface.dispose();
  globalThis.document = oldDocument;
});

test("identity startup survives unavailable framing and manifest bytes", async () => {
  const host = { children: [], appendChild(node) { this.children.push(node); }, removeChild() {} };
  const image = { complete: true, naturalWidth: 10, style: { visibility: "visible" } };
  const oldDocument = globalThis.document;
  globalThis.document = { createElement() { return { style: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, remove() {} }; } };
  let initialMesh;
  const surface = await createProjectionBrowserSurface({
    host, spanId: "left", image, initialConfig: structuredClone(DEFAULT_PROJECTION_CONFIG),
    fetchImpl: async () => ({ ok: false }),
    rendererFactory: ({ mesh }) => { initialMesh = mesh; return { draw: () => true, setMesh: vi.fn(), isContextLost: () => false, dispose() {} }; },
  });
  expect(initialMesh.vertices).toHaveLength(49);
  expect(surface.getBaselineIdentity()).toEqual({ type: "identity" });
  surface.dispose();
  globalThis.document = oldDocument;
});

test("disabled warp evaluates a diagnostic quad when its optional TD preload fails", async () => {
  const host = { children: [], appendChild(node) { this.children.push(node); }, removeChild() {} };
  const image = { complete: true, naturalWidth: 10, style: { visibility: "visible" } };
  const oldDocument = globalThis.document;
  globalThis.document = { createElement() { return { style: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, remove() {} }; } };
  const framing = new TextEncoder().encode(JSON.stringify(framingConfig));
  const mesh = new TextEncoder().encode(JSON.stringify({ width: 1920, height: 1080, vertices: [{ s: 0, t: 0, x: 0, y: 0, u: 0, v: 0 }, { s: 1, t: 0, x: 1, y: 0, u: 1, v: 0 }, { s: 0, t: 1, x: 0, y: 1, u: 0, v: 1 }], triangles: [0, 1, 2] }));
  const manifest = { width: 1920, height: 1080, assets: { left: { path: "left.json", sha256: await sha256Hex(mesh) } }, framing: { path: "../td-source-config.json", sha256: await sha256Hex(framing) } };
  let appliedMesh;
  const disabled = structuredClone((await import("../../frontend/src/shared/projection-warp-schema.js")).migrateProjectionConfigToV2(framingConfig));
  disabled.outputs.left.warp.enabled = false;
  const fetchImpl = vi.fn(async (url) => ({ ok: true, async arrayBuffer() { return url.endsWith("manifest.json") ? new TextEncoder().encode(JSON.stringify(manifest)).buffer : url.endsWith("td-source-config.json") ? framing.buffer : mesh.buffer; } }));
  const surface = await createProjectionBrowserSurface({
    host, spanId: "left", image, initialConfig: disabled,
    fetchImpl,
    rendererFactory: ({ mesh: initial }) => ({ draw: () => true, setMesh: (next) => { appliedMesh = next; }, isContextLost: () => false, dispose() {} }),
  });
  surface.applyConfig(disabled);
  expect(appliedMesh.vertices).toHaveLength(4);
  expect(surface.getBaselineIdentity()).toEqual({ type: "identity" });
  expect(fetchImpl.mock.calls.some(([url]) => url.endsWith("left.json"))).toBe(true);
  surface.dispose();
  globalThis.document = oldDocument;
});

test("captured v1 startup preloads TD mesh for saved apply and disable/re-enable", async () => {
  const host = { children: [], appendChild(node) { this.children.push(node); }, removeChild() {} };
  const image = { complete: true, naturalWidth: 10, style: { visibility: "visible" } };
  const oldDocument = globalThis.document;
  globalThis.document = { createElement() { return { style: {}, setAttribute() {}, addEventListener() {}, removeEventListener() {}, remove() {} }; } };
  const framing = new TextEncoder().encode(JSON.stringify(framingConfig));
  const mesh = createIdentityProjectionMesh({ side: "left" });
  const meshBytes = new TextEncoder().encode(JSON.stringify(mesh));
  const asset = {
    path: "left.json",
    assetId: "fixture-left",
    sha256: await sha256Hex(meshBytes),
    logicalGrid: { columns: 7, rows: 7 },
  };
  const manifest = {
    width: 1920,
    height: 1080,
    assets: { left: asset },
    framing: { path: "../td-source-config.json", sha256: await sha256Hex(framing) },
  };
  const fetchImpl = vi.fn(async (url) => ({
    ok: true,
    async arrayBuffer() {
      return (url.endsWith("manifest.json")
        ? new TextEncoder().encode(JSON.stringify(manifest))
        : url.endsWith("td-source-config.json") ? framing : meshBytes).buffer;
    },
  }));
  const setMesh = vi.fn();
  const surface = await createProjectionBrowserSurface({
    host,
    spanId: "left",
    image,
    initialConfig: framingConfig,
    fetchImpl,
    rendererFactory: () => ({ draw: () => true, setMesh, isContextLost: () => false, dispose() {} }),
  });
  const tdMeshConfig = migrateProjectionConfigToV2(framingConfig, { left: asset });
  const disabledConfig = structuredClone(tdMeshConfig);
  disabledConfig.outputs.left.warp.enabled = false;

  surface.applyConfig(tdMeshConfig);
  expect(setMesh).toHaveBeenLastCalledWith(expect.objectContaining({ logicalGrid: { columns: 7, rows: 7 } }));
  surface.applyConfig(disabledConfig);
  expect(setMesh.mock.lastCall[0].vertices).toHaveLength(4);
  surface.applyConfig(tdMeshConfig);
  expect(setMesh.mock.lastCall[0].vertices).toHaveLength(49);
  expect(fetchImpl.mock.calls.filter(([url]) => url.endsWith("left.json"))).toHaveLength(1);
  surface.dispose();
  globalThis.document = oldDocument;
});

test("cancels pending baseline readiness before creating a browser surface", async () => {
  const controller = new AbortController();
  let resolveManifest;
  const manifestPending = new Promise((resolve) => { resolveManifest = resolve; });
  const fetchImpl = vi.fn(() => manifestPending);
  const createElement = vi.fn(() => ({ style: {}, setAttribute() {} }));
  const host = { ownerDocument: { createElement }, appendChild() {} };

  const pending = createProjectionBrowserSurface({
    host,
    spanId: "left",
    image: { complete: true, naturalWidth: 10 },
    fetchImpl,
    signal: controller.signal,
    rendererFactory: vi.fn(),
  });
  await Promise.resolve();
  expect(fetchImpl.mock.calls[0][1]).toEqual({ signal: controller.signal });
  controller.abort();
  resolveManifest({ ok: false });
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(createElement).not.toHaveBeenCalled();
});

test("cancels image decoding before creating a browser surface", async () => {
  const controller = new AbortController();
  let resolveImage;
  const image = {
    decode: () => new Promise((resolve) => { resolveImage = resolve; }),
  };
  const createElement = vi.fn(() => ({ style: {}, setAttribute() {} }));
  const host = { ownerDocument: { createElement }, appendChild() {} };
  const framing = new TextEncoder().encode(JSON.stringify(framingConfig));
  const mesh = new TextEncoder().encode('{"width":1920,"height":1080}');
  const manifest = {
    width: 1920,
    height: 1080,
    assets: { left: { path: "left.json", sha256: await sha256Hex(mesh) } },
    framing: { path: "../td-source-config.json", sha256: await sha256Hex(framing) },
  };
  const fetchImpl = vi.fn(async (url) => ({
    ok: true,
    async arrayBuffer() {
      if (url.endsWith("manifest.json")) return new TextEncoder().encode(JSON.stringify(manifest)).buffer;
      return (url.endsWith("td-source-config.json") ? framing : mesh).buffer;
    },
  }));
  const pending = createProjectionBrowserSurface({
    host,
    spanId: "left",
    image,
    fetchImpl,
    signal: controller.signal,
    rendererFactory: vi.fn(),
  });
  await Promise.resolve();
  controller.abort();
  resolveImage?.();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(createElement).not.toHaveBeenCalled();
});

test("surfaces baseline failures before a renderer or canvas exists", async () => {
  const children = [];
  const errorElement = { style: {}, setAttribute() {}, remove() {} };
  const host = {
    children,
    ownerDocument: { createElement: vi.fn(() => errorElement) },
    appendChild(node) { children.push(node); },
    querySelector() { return null; },
  };
  await expect(createProjectionBrowserSurface({
    host,
    spanId: "left",
    image: { complete: true, naturalWidth: 10 },
    fetchImpl: async () => ({ ok: false }),
    rendererFactory: vi.fn(),
  })).rejects.toThrow(/baseline manifest unavailable/i);
  expect(children).toContain(errorElement);
  expect(errorElement.className).toBe("projection-browser-error");
});
