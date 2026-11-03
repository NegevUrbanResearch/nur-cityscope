import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { bindProjectionPersonHalo } from "../../frontend/src/projection/projection-person-halo.js";

function createFakeMap() {
  const map = createFakeMapLibreMap({
    layers: [{ id: "nli__people__circle", type: "circle", source: "nli.people" }],
  });
  map.setPaintProperty("nli__people__circle", "circle-opacity", 1);
  map.flyTo = vi.fn();
  vi.spyOn(map, "addLayer");
  return map;
}

describe("bindProjectionPersonHalo", () => {
  it("subscribes, mounts and retires projection focus layers across style reload, and never flyTo", async () => {
    const map = createFakeMap();
    const resolve = vi.fn(() => ({ pid: "11", coordinates: [34.5, 31.4] }));
    let handler;
    const subscribe = vi.fn((topic, fn) => { handler = fn; return () => {}; });
    const dispose = bindProjectionPersonHalo({
      map,
      subscribe,
      loadPeopleRuntime: async () => ({ resolve }),
      motionMode: "full",
    });
    expect(subscribe).toHaveBeenCalledWith("personSelection", expect.any(Function));
    handler({ pid: "11" });
    await vi.waitFor(() => {
      expect(map.getPaintProperty("nli__people__circle", "circle-opacity")[0]).toBe("case");
    });
    const projectionFocusLayers = () => map.getStyle().layers.map((layer) => layer.id)
      .filter((id) => id.startsWith("nli-people-focus-"));
    expect(projectionFocusLayers()).toContain("nli-people-focus-begin");
    expect(projectionFocusLayers()).toContain("nli-people-focus-end");
    expect(projectionFocusLayers().some((id) => id.includes("copy-nli__people__circle"))).toBe(true);
    expect(map.getLayer("otef-person-selection-halo")).toBeNull();
    expect(map.getSource("otef-person-selection")).toBeNull();
    expect(map.flyTo).not.toHaveBeenCalled();
    map.emit("style.load");
    expect(projectionFocusLayers()).toContain("nli-people-focus-begin");
    expect(projectionFocusLayers()).toContain("nli-people-focus-end");
    expect(map.getLayer("otef-person-selection-halo")).toBeNull();
    expect(map.getSource("otef-person-selection")).toBeNull();
    expect(map.getPaintProperty("nli__people__circle", "circle-opacity")[0]).toBe("case");
    handler(null);
    expect(projectionFocusLayers()).toHaveLength(0);
    expect(map.getPaintProperty("nli__people__circle", "circle-opacity")).toBe(1);
    dispose();
  });

  it("projection-main constructs the binder and passes getPersonSelection into timeline sync", () => {
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../frontend/src/entries/projection-main.js"),
      "utf8",
    );
    expect(src).toMatch(/bindProjectionPersonHalo/);
    expect(src).toMatch(/getPersonSelection/);
    expect(src).toMatch(/wakeInvestigationTimelinePersonGlow/);
    expect(src).not.toMatch(/createGisPersonSelection|createGisPersonController/);
  });

  it("projection-main does not import the GIS Nova explainer overlay", () => {
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../frontend/src/entries/projection-main.js"),
      "utf8",
    );
    expect(src).not.toMatch(/nli-nova-explainer-overlay/);
    expect(src).not.toMatch(/nliNovaExplainerHost/);
  });
});
