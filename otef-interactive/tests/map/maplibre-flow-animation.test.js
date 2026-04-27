import { afterEach, describe, expect, it } from "vitest";
import {
  collectLineLayerIdsForFullLayer,
  fullLayerIdAnimationAliases,
  isFlowAnimationTargetLineLayer,
  usesRouteProgressOverlay,
} from "../../frontend/src/shared/maplibre-flow-animation.js";

describe("maplibre-flow-animation (layer id helpers)", () => {
  it("collectLineLayerIdsForFullLayer returns line ids matching slug prefix", () => {
    const layers = [
      { id: "greens__agri__0", type: "line", paint: {} },
      { id: "greens__agri__fill__1", type: "fill" },
    ];
    const map = { getStyle: () => ({ layers }) };
    expect(collectLineLayerIdsForFullLayer(map, "greens.agri")).toEqual(["greens__agri__0"]);
  });

  it("collectLineLayerIdsForFullLayer skips __leader and markerLineFallback", () => {
    const layers = [
      { id: "p__leader", type: "line", paint: {} },
      { id: "p__markerLineFallback__0", type: "line", paint: {} },
      { id: "p__stroke__0", type: "line", paint: {} },
    ];
    const map = { getStyle: () => ({ layers }) };
    expect(collectLineLayerIdsForFullLayer(map, "p.x")).toEqual([]);
  });

  it("collectLineLayerIdsForFullLayer matches oct7 axis id when animations use hyphen suffix", () => {
    const lineId = "october_7th__חדירה_לישוב_ציר__0";
    const layers = [{ id: lineId, type: "line", paint: {} }];
    const map = { getStyle: () => ({ layers }) };
    expect(
      collectLineLayerIdsForFullLayer(map, "october_7th.חדירה_לישוב-ציר").sort(),
    ).toEqual([lineId]);
  });

  it("fullLayerIdAnimationAliases links oct7 -ציר and _ציר spellings", () => {
    const a = fullLayerIdAnimationAliases("october_7th.חדירה_לישוב-ציר").sort();
    const b = fullLayerIdAnimationAliases("october_7th.חדירה_לישוב_ציר").sort();
    expect(a).toEqual(b);
    expect(a).toContain("october_7th.חדירה_לישוב-ציר");
    expect(a).toContain("october_7th.חדירה_לישוב_ציר");
  });

  it("isFlowAnimationTargetLineLayer", () => {
    expect(
      isFlowAnimationTargetLineLayer({
        id: "p__leader",
        type: "line",
      }),
    ).toBe(false);
    expect(
      isFlowAnimationTargetLineLayer({
        id: "p__stroke__0",
        type: "line",
      }),
    ).toBe(true);
  });

  describe("usesRouteProgressOverlay", () => {
    afterEach(() => {
      delete globalThis.MapProjectionConfig;
    });

    it("is true for MODE trail when ENABLE_FLOW is not false", () => {
      globalThis.MapProjectionConfig = {
        PROJECTION_LAYER_ANIMATIONS: {
          LAYER_OVERRIDES: {
            "pack.layer": { MODE: "trail" },
          },
        },
      };
      expect(usesRouteProgressOverlay("pack.layer")).toBe(true);
    });

    it("is false when ENABLE_FLOW is explicitly false", () => {
      globalThis.MapProjectionConfig = {
        PROJECTION_LAYER_ANIMATIONS: {
          LAYER_OVERRIDES: {
            "pack.layer": { ENABLE_FLOW: false, MODE: "trail" },
          },
        },
      };
      expect(usesRouteProgressOverlay("pack.layer")).toBe(false);
    });
  });
});
