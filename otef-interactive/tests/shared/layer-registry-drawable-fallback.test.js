import { expect, test, vi } from "vitest";
import layerRegistry, { LayerRegistry } from "../../frontend/src/shared/layer-registry.js";
import { irToMapLibreLayers } from "../../frontend/src/shared/maplibre-style-bridge.js";
import { applyLayerGroupsToMap } from "../../frontend/src/map/maplibre-layer-manager.js";
import { getLayerLifecycleRuntime } from "../../frontend/src/shared/layer-lifecycle-fade.js";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";

async function registryWithoutStyles(layers) {
  const registry = new LayerRegistry({ fetchImpl: async url => ({
    ok: true,
    json: async () => url.endsWith("layers-manifest.json") ? { packs: ["future_development"] }
      : url.endsWith("/manifest.json") ? { layers } : {},
  }) });
  await registry.init();
  return registry;
}

test.each([
  ["line", "line", "line-width"],
  ["point", "circle", "circle-radius"],
  ["polygon", "fill", "fill-opacity"],
])("missing %s style produces drawable MapLibre IR while retaining legacy defaults", async (geometryType, type, opacity) => {
  const registry = await registryWithoutStyles([{ id: "unstyled", geometryType, file: "unstyled.geojson" }]);
  const config = registry.getLayerConfig("future_development.unstyled");
  const layers = irToMapLibreLayers(config.fullId, config.fullId, config);
  const drawable = layers.find(layer => layer.type === type);
  expect(drawable).toBeDefined();
  expect(drawable.paint[opacity]).toBeGreaterThan(0);
  expect(config.style.defaultStyle).toMatchObject({ fillColor: "#808080", strokeColor: "#000000", strokeWidth: 1 });
});

test("a pack containing an unstyled road reaches strict lifecycle readiness", async () => {
  const registry = await registryWithoutStyles([
    { id: "יציאה_כביש", geometryType: "line", file: "road.geojson" },
    { id: "district", geometryType: "polygon", file: "district.geojson" },
  ]);
  const lookup = vi.spyOn(layerRegistry, "getLayerConfig").mockImplementation(id => registry.getLayerConfig(id));
  const map = createFakeMapLibreMap();
  const runtime = getLayerLifecycleRuntime(map);
  try {
    const ids = ["future_development.יציאה_כביש", "future_development.district"];
    const batch = runtime.setDesiredIds(ids, { durationMs: 0, requiredIds: ids });
    const ready = runtime.waitForBatch(batch);
    applyLayerGroupsToMap(map, [{ id: "future_development", layers: [
      { id: "יציאה_כביש", enabled: true }, { id: "district", enabled: true },
    ] }], { lifecycle: { joinBatch: true } });
    runtime.commitBatch();
    await expect(ready).resolves.toMatchObject({ status: "ready" });
    expect(map.getStyle().layers.some(layer => layer.type === "line")).toBe(true);
    expect(map.getStyle().layers.some(layer => layer.type === "fill")).toBe(true);
  } finally {
    lookup.mockRestore();
    runtime.dispose();
    map.remove();
  }
});
