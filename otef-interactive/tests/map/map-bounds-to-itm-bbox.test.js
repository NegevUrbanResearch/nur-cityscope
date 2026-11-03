import { describe, expect, it, vi } from "vitest";
import { itmAxisAlignedBboxFromLngLatBounds } from "../../frontend/src/map-utils/map-bounds-to-itm-bbox.js";

function createBounds(west, south, east, north) {
  return {
    getNorthWest: () => ({ lng: west, lat: north }),
    getNorthEast: () => ({ lng: east, lat: north }),
    getSouthWest: () => ({ lng: west, lat: south }),
    getSouthEast: () => ({ lng: east, lat: south }),
  };
}

describe("itmAxisAlignedBboxFromLngLatBounds", () => {
  it("uses all four corners to build ITM axis-aligned hull", () => {
    const bounds = createBounds(0, 0, 1, 1);
    const toItm = vi.fn((lng, lat) => {
      if (lng === 0 && lat === 0) return [10, 10]; // SW
      if (lng === 1 && lat === 1) return [20, 20]; // NE
      if (lng === 0 && lat === 1) return [5, 25]; // NW drives minE/maxN
      if (lng === 1 && lat === 0) return [30, 8]; // SE drives maxE/minN
      return null;
    });

    const bbox = itmAxisAlignedBboxFromLngLatBounds(bounds, toItm);

    expect(toItm).toHaveBeenCalledTimes(4);
    expect(bbox).toEqual([5, 8, 30, 25]);
    expect(bbox).not.toEqual([10, 10, 20, 20]);
  });

  it("returns null when any corner projection fails", () => {
    const bounds = createBounds(0, 0, 1, 1);
    const toItm = vi.fn((lng, lat) => {
      if (lng === 1 && lat === 0) return null;
      return [lng, lat];
    });
    expect(itmAxisAlignedBboxFromLngLatBounds(bounds, toItm)).toBeNull();
  });
});
