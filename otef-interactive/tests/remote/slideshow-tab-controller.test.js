import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSlideshow } = vi.hoisted(() => {
  const mockSlideshow = {
    excludedPresentationPackIds: ["projector_base", "gaza", "curated_moresht_axis"],
    packOrder: [],
  };
  return { mockSlideshow };
});

vi.mock("../../frontend/src/shared/map-projection-config.js", () => ({
  MapProjectionConfig: {
    get PROJECTION_SLIDESHOW() {
      return mockSlideshow;
    },
  },
}));

import {
  SlideshowTabController,
  filterExcludedPresentationPacks,
} from "../../frontend/src/remote/slideshow-tab-controller.js";

const EXCLUDED = ["projector_base", "gaza", "curated_moresht_axis"];

/**
 * Simulates merged registry/context groups that still contain excluded ids,
 * so `ensurePackOrder` must strip them from preferred order and from the `remaining` tail.
 */
class SlideshowTabControllerWithFakeSources extends SlideshowTabController {
  /**
   * @param {Array<{ id: string, label?: string }>} fakePacks
   * @param {ConstructorParameters<typeof SlideshowTabController>[0]} [options]
   */
  constructor(fakePacks, options) {
    super(options);
    this._fakePacks = fakePacks;
  }

  resolvePackSources() {
    return this._fakePacks;
  }
}

function assertPackOrderHasNoExcluded(packOrder) {
  for (const id of EXCLUDED) {
    expect(packOrder).not.toContain(id);
  }
}

describe("filterExcludedPresentationPacks", () => {
  it("removes packs whose id is in excludedPresentationPackIds", () => {
    const packs = [
      { id: "greens", label: "Greens" },
      { id: "gaza", label: "Gaza" },
      { id: "land_use", label: "Land" },
    ];
    const excluded = ["projector_base", "gaza", "curated_moresht_axis"];
    expect(filterExcludedPresentationPacks(packs, excluded)).toEqual([
      { id: "greens", label: "Greens" },
      { id: "land_use", label: "Land" },
    ]);
  });

  it("treats undefined excluded list as empty (no removal)", () => {
    const packs = [{ id: "a", label: "A" }];
    expect(filterExcludedPresentationPacks(packs, undefined)).toEqual(packs);
  });
});

describe("ensurePackOrder", () => {
  beforeEach(() => {
    mockSlideshow.excludedPresentationPackIds = [...EXCLUDED];
    mockSlideshow.packOrder = [];
  });

  it("strips excluded ids from configured packOrder and never appends them via remaining", () => {
    const packs = [
      { id: "land_use", label: "Land" },
      { id: "gaza", label: "Gaza" },
      { id: "greens", label: "Greens" },
      { id: "projector_base", label: "Base" },
      { id: "curated_moresht_axis", label: "Axis" },
    ];
    mockSlideshow.packOrder = [
      "gaza",
      "projector_base",
      "greens",
      "land_use",
      "curated_moresht_axis",
    ];

    const c = new SlideshowTabControllerWithFakeSources(packs);
    c.packOrder = [];
    c.ensurePackOrder();

    assertPackOrderHasNoExcluded(c.packOrder);
    expect(c.packOrder).toEqual(["greens", "land_use"]);
  });

  it("when preferred order is empty, remaining lists only non-excluded ids in source order", () => {
    const packs = [
      { id: "curated_moresht_axis", label: "Axis" },
      { id: "land_use", label: "Land" },
      { id: "gaza", label: "Gaza" },
      { id: "greens", label: "Greens" },
    ];
    mockSlideshow.packOrder = [];

    const c = new SlideshowTabControllerWithFakeSources(packs);
    c.packOrder = [];
    c.ensurePackOrder();

    assertPackOrderHasNoExcluded(c.packOrder);
    expect(c.packOrder).toEqual(["land_use", "greens"]);
  });
});
