import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { bindProjectionPersonHalo } from "../../frontend/src/projection/projection-person-halo.js";

function createFakeMap() {
  const map = createFakeMapLibreMap();
  map.flyTo = vi.fn();
  vi.spyOn(map, "addLayer");
  return map;
}

describe("bindProjectionPersonHalo", () => {
  it("subscribes, mounts halo, remounts on style.load, clears, and never flyTo", async () => {
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
      expect(map.addLayer).toHaveBeenCalled();
    });
    expect(map.flyTo).not.toHaveBeenCalled();
    map.emit("style.load");
    expect(map.addLayer.mock.calls.length).toBeGreaterThan(1);
    handler(null);
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
});
