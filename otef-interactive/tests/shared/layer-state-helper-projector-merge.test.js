import { afterEach, describe, expect, test } from "vitest";
import { getEffectiveLayerGroups } from "../../frontend/src/shared/layer-state-helper.js";

describe("getEffectiveLayerGroups: projector_base שמות + Locations_Lines row", () => {
  afterEach(() => {
    delete globalThis.OTEFDataContext;
    delete globalThis.layerRegistry;
  });

  test("merges into one layer row with fullLayerIds and ANDed enabled", () => {
    globalThis.layerRegistry = {
      _initialized: true,
      getGroups: () => [
        {
          id: "projector_base",
          name: "Projector",
          layers: [
            { id: "model_base", name: "Model" },
            { id: "שמות_יישובים", name: "שמות" },
            { id: "Locations_Lines", name: "Locations" },
          ],
        },
      ],
    };
    globalThis.OTEFDataContext = {
      getLayerGroups: () => [
        {
          id: "projector_base",
          enabled: true,
          layers: [
            { id: "model_base", enabled: true },
            {
              id: "שמות_יישובים",
              enabled: true,
              displayName: "שמות",
            },
            { id: "Locations_Lines", enabled: true, displayName: "Lines" },
          ],
        },
      ],
    };

    const groups = getEffectiveLayerGroups();
    const pb = groups.find((g) => g.id === "projector_base");
    expect(pb).toBeDefined();
    const layerIds = pb.layers.map((l) => l.id);
    expect(layerIds).toContain("model_base");
    expect(layerIds).toContain("שמות_יישובים");
    expect(layerIds).not.toContain("Locations_Lines");
    const shemot = pb.layers.find((l) => l.id === "שמות_יישובים");
    expect(shemot.fullLayerIds).toEqual([
      "projector_base.שמות_יישובים",
      "projector_base.Locations_Lines",
    ]);
    expect(shemot.enabled).toBe(true);
  });

  test("settlement row is off when either merged layer is off", () => {
    globalThis.layerRegistry = {
      _initialized: true,
      getGroups: () => [
        {
          id: "projector_base",
          name: "Projector",
          layers: [
            { id: "שמות_יישובים", name: "שמות" },
            { id: "Locations_Lines", name: "Locations" },
          ],
        },
      ],
    };
    globalThis.OTEFDataContext = {
      getLayerGroups: () => [
        {
          id: "projector_base",
          enabled: true,
          layers: [
            { id: "שמות_יישובים", enabled: true },
            { id: "Locations_Lines", enabled: false },
          ],
        },
      ],
    };

    const groups = getEffectiveLayerGroups();
    const shemot = groups
      .find((g) => g.id === "projector_base")
      ?.layers.find((l) => l.id === "שמות_יישובים");
    expect(shemot?.enabled).toBe(false);
  });

  test("registry has only שמות_יישובים (no Locations_Lines) — separate row, no merged fullLayerIds", () => {
    globalThis.layerRegistry = {
      _initialized: true,
      getGroups: () => [
        {
          id: "projector_base",
          name: "Projector",
          layers: [
            { id: "model_base", name: "Model" },
            { id: "שמות_יישובים", name: "שמות" },
          ],
        },
      ],
    };
    globalThis.OTEFDataContext = {
      getLayerGroups: () => [
        {
          id: "projector_base",
          enabled: true,
          layers: [
            { id: "model_base", enabled: true },
            {
              id: "שמות_יישובים",
              enabled: true,
              displayName: "שמות",
            },
          ],
        },
      ],
    };

    const groups = getEffectiveLayerGroups();
    const pb = groups.find((g) => g.id === "projector_base");
    expect(pb).toBeDefined();
    const layerIds = pb.layers.map((l) => l.id);
    expect(layerIds).toContain("model_base");
    expect(layerIds).toContain("שמות_יישובים");
    expect(layerIds).not.toContain("Locations_Lines");
    const shemot = pb.layers.find((l) => l.id === "שמות_יישובים");
    expect(shemot?.fullLayerIds).toBeUndefined();
  });

  test("registry has only Locations_Lines (no שמות) — no merge, standalone Locations row", () => {
    globalThis.layerRegistry = {
      _initialized: true,
      getGroups: () => [
        {
          id: "projector_base",
          name: "Projector",
          layers: [
            { id: "model_base", name: "Model" },
            { id: "Locations_Lines", name: "Locations" },
          ],
        },
      ],
    };
    globalThis.OTEFDataContext = {
      getLayerGroups: () => [
        {
          id: "projector_base",
          enabled: true,
          layers: [
            { id: "model_base", enabled: true },
            { id: "Locations_Lines", enabled: true, displayName: "Lines" },
          ],
        },
      ],
    };

    const groups = getEffectiveLayerGroups();
    const pb = groups.find((g) => g.id === "projector_base");
    expect(pb).toBeDefined();
    const layerIds = pb.layers.map((l) => l.id);
    expect(layerIds).toContain("model_base");
    expect(layerIds).toContain("Locations_Lines");
    expect(layerIds).not.toContain("שמות_יישובים");
    const loc = pb.layers.find((l) => l.id === "Locations_Lines");
    expect(loc?.fullLayerIds).toBeUndefined();
  });
});
