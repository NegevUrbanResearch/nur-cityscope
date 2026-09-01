import { describe, expect, test, vi } from "vitest";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { installGisStyleReload } from "../../frontend/src/entries/map-main-style-lifecycle.js";

describe("map-main GIS style reload lifecycle", () => {
  test("reapplies ordinary layers before bringing the selected overlay to front", async () => {
    const map = createFakeMapLibreMap({ layers: [{ id: "otef-person-selection-halo" }] });
    const selected = { bringToFront: vi.fn(() => map.moveLayer("otef-person-selection-halo")) };
    const refreshLayers = vi.fn(async () => {
      map.addLayer({ id: "nli__people__circle", type: "circle" });
    });
    installGisStyleReload({ map, refreshLayers, personVisual: selected, getLayerGroups: () => [] });
    map.emit("style.load");
    await Promise.resolve();
    expect(refreshLayers).toHaveBeenCalledWith({ groupsOverride: [], syncFlow: false });
    expect(selected.bringToFront).toHaveBeenCalledTimes(1);
    expect(map.getStyle().layers.at(-1).id).toBe("otef-person-selection-halo");
  });
});
