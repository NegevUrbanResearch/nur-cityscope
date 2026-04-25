import { describe, expect, test } from "vitest";
import { getEnabledMapFullLayerIds } from "../../frontend/src/map/maplibre-layer-manager.js";

describe("getEnabledMapFullLayerIds", () => {
  test("enables all fullLayerIds when a merged row is on", () => {
    const set = getEnabledMapFullLayerIds([
      {
        id: "projector_base",
        enabled: true,
        layers: [
          {
            id: "שמות_יישובים",
            enabled: true,
            fullLayerIds: [
              "projector_base.שמות_יישובים",
              "projector_base.Locations_Lines",
            ],
          },
        ],
      },
    ]);
    expect(set.has("projector_base.שמות_יישובים")).toBe(true);
    expect(set.has("projector_base.Locations_Lines")).toBe(true);
  });

  test("uses group.layer id when fullLayerIds is absent", () => {
    const set = getEnabledMapFullLayerIds([
      {
        id: "projector_base",
        enabled: true,
        layers: [{ id: "model_base", enabled: true }],
      },
    ]);
    expect(set.has("projector_base.model_base")).toBe(true);
  });
});
