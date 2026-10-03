import { expect, test, vi } from "vitest";
import layerRegistry, { LayerRegistry } from "../../frontend/src/shared/layer-registry.js";

test("LayerRegistry uses its injected fetch for root, pack manifest, and styles", async () => {
  const fetchImpl = vi.fn(async (url) => {
    if (url.endsWith("layers-manifest.json")) return { ok: true, json: async () => ({ packs: ["pack-a"] }) };
    if (url.endsWith("/manifest.json")) return { ok: true, json: async () => ({ name: "Pack A", layers: [{ id: "roads", geometryType: "line" }] }) };
    if (url.endsWith("/styles.json")) return { ok: true, json: async () => ({ roads: { type: "line" } }) };
    throw new Error(`unexpected URL ${url}`);
  });
  const registry = new LayerRegistry({ fetchImpl });
  await registry.init();
  expect(fetchImpl).toHaveBeenCalledTimes(3);
  expect(registry.getGroups()).toEqual([{ id: "pack-a", name: "Pack A", layers: [{ id: "roads", geometryType: "line" }] }]);
  expect(registry.getLayerConfig("pack-a.roads").style).toEqual({ type: "line" });
  expect(layerRegistry).toBeDefined();
});
