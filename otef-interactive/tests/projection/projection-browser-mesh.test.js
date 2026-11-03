import { expect, test, vi } from "vitest";
import { createProjectionBrowserSurface } from "../../frontend/src/projection/projection-browser-route.js";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";

test("browser surface returns a defensive copy of its active evaluated mesh", async () => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElement() { return { style: {}, setAttribute() {}, addEventListener() {}, removeEventListener: vi.fn(), remove() {} }; } };
  try {
    const surface = await createProjectionBrowserSurface({
      host: { appendChild() {} }, spanId: "left", search: "?outputMode=browser",
      image: { complete: true, naturalWidth: 10, style: {} },
      initialConfig: structuredClone(DEFAULT_PROJECTION_CONFIG), fetchImpl: async () => ({ ok: false }),
      rendererFactory: () => ({ draw() { return true; }, setMesh() {}, isContextLost: () => false, dispose() {} }),
    });
    const copied = surface.getMesh();
    expect(copied).not.toBeNull();
    expect(copied).not.toBe(surface.renderer.getMesh?.());
    expect(Object.isFrozen(copied.vertices)).toBe(true);
    expect(Object.isFrozen(copied.vertices[0])).toBe(true);
    expect(() => { copied.vertices[0].x = 0.5; }).toThrow();
    expect(surface.getMesh().vertices[0].x).not.toBe(0.5);

    const candidateConfig = structuredClone(DEFAULT_PROJECTION_CONFIG);
    candidateConfig.outputs.left.warp.grid.offsets[0] = [0.01, 0];
    surface.applyConfig(candidateConfig);
    const appliedMesh = surface.getMesh();
    expect(appliedMesh.vertices[0].x).not.toBe(copied.vertices[0].x);

    const prepared = { config: { marker: "pair" }, mesh: {
      ...appliedMesh,
      vertices: appliedMesh.vertices.map((vertex, index) => ({ ...vertex, x: index === 0 ? vertex.x + 0.02 : vertex.x })),
      triangles: [...appliedMesh.triangles],
    } };
    surface.commitPair(prepared);
    expect(surface.getMesh().vertices[0].x).toBeCloseTo(prepared.mesh.vertices[0].x, 7);
    surface.rollbackPair(prepared);
    expect(surface.getMesh().vertices[0].x).toBeCloseTo(appliedMesh.vertices[0].x, 7);
    surface.dispose();
  } finally { globalThis.document = oldDocument; }
});
