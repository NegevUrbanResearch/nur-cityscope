import { describe, expect, test } from "vitest";
import {
  getEnabledMapFullLayerIds,
  orderMapFullLayerIdsForAdd,
} from "../../frontend/src/map/maplibre-layer-manager.js";

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

describe("orderMapFullLayerIdsForAdd", () => {
  test("draws projector black ground under settlement outlines, names, and Highway 232", () => {
    expect(
      orderMapFullLayerIdsForAdd([
        "nli.ציר_232",
        "projector_base.ישובים",
        "projector_base.רקע_שחור",
        "projector_base.שמות_יישובים",
      ]),
    ).toEqual([
      "projector_base.רקע_שחור",
      "nli.ציר_232",
      "projector_base.ישובים",
      "projector_base.שמות_יישובים",
    ]);
  });
});
