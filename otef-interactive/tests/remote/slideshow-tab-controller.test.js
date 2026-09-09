import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  resolveSlideshowPackLabel,
} from "../../frontend/src/remote/slideshow-tab-controller.js";
import OTEFDataContext from "../../frontend/src/shared/OTEFDataContext.js";
import { t } from "../../frontend/src/remote/remote-locale.js";

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

describe("slideshow timing fields markup", () => {
  beforeEach(() => {
    mockSlideshow.excludedPresentationPackIds = [...EXCLUDED];
    mockSlideshow.packOrder = [];
  });

  it("renders three side-by-side timing inputs with short labels and preserved ids", () => {
    const packs = [{ id: "greens", label: "Greens" }];
    const c = new SlideshowTabControllerWithFakeSources(packs);
    const root = { innerHTML: "" };
    c.root = root;
    c.packOrder = ["greens"];
    c.render();

    expect(root.innerHTML).toContain('id="slideshowIntervalSec"');
    expect(root.innerHTML).toContain('id="slideshowCrossfadeSec"');
    expect(root.innerHTML).toContain('id="slideshowWarmupLeadSec"');
    expect(root.innerHTML).toContain("slideshow-input-grid");
    expect(root.innerHTML).toContain("slideshow-field__label");
    expect(root.innerHTML).toContain("מרווח");
    expect(root.innerHTML).toContain("מיזוג");
    expect(root.innerHTML).toContain("הכנה");
    expect(root.innerHTML).toContain('data-i18n-aria="slideshowIntervalSecLabel"');
    expect(root.innerHTML).toContain('data-i18n-aria="slideshowCrossfadeSecLabel"');
    expect(root.innerHTML).toContain('data-i18n-aria="slideshowWarmupLeadSecLabel"');
    expect(root.innerHTML).toContain("data-slideshow-keep-settlement-names");
    expect(root.innerHTML).not.toContain("מרווח (שניות)</span>");
    expect(root.innerHTML).not.toContain("זמן הכנה (שניות)</span>");
  });
});

describe("resolveSlideshowPackLabel", () => {
  it("uses Hebrew pack titles for known ids", () => {
    expect(resolveSlideshowPackLabel("future_development", "future_development")).toBe(
      "פיתוח עתידי",
    );
    expect(resolveSlideshowPackLabel("october_7th")).toBe("7 באוקטובר");
    expect(resolveSlideshowPackLabel("greens")).toBe("ירוקים");
    expect(resolveSlideshowPackLabel("land_use")).toBe("שימושי קרקע");
    expect(resolveSlideshowPackLabel("muniplicity_transport")).toBe("תחבורה מוניציפלית");
  });

  it("falls back to the provided label when the pack is unknown", () => {
    expect(resolveSlideshowPackLabel("unknown_pack", "Custom Pack")).toBe("Custom Pack");
    expect(resolveSlideshowPackLabel("unknown_pack")).toBe("unknown_pack");
  });
});

describe("slideshow start stops NLI clock", () => {
  let patchClock;
  let patchSlideshow;

  beforeEach(() => {
    mockSlideshow.excludedPresentationPackIds = [...EXCLUDED];
    mockSlideshow.packOrder = [];
    patchClock = vi
      .spyOn(OTEFDataContext, "patchInvestigationClock")
      .mockResolvedValue(undefined);
    patchSlideshow = vi
      .spyOn(OTEFDataContext, "patchProjectionSlideshow")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function controllerWithPacks() {
    const packs = [{ id: "greens", label: "Greens" }];
    const c = new SlideshowTabControllerWithFakeSources(packs);
    c.packOrder = ["greens"];
    return c;
  }

  function expectIdleClockPatchedBeforeStart() {
    expect(patchClock).toHaveBeenCalledTimes(1);
    expect(patchClock.mock.calls[0][0].phase).toBe("idle");
    expect(patchSlideshow).toHaveBeenCalledTimes(1);
    expect(patchSlideshow.mock.calls[0][0].type).toBe("start");
    expect(patchClock.mock.invocationCallOrder[0]).toBeLessThan(
      patchSlideshow.mock.invocationCallOrder[0],
    );
  }

  it("handleStart patches idle clock before starting slideshow", async () => {
    const c = controllerWithPacks();
    await c.handleStart();
    expectIdleClockPatchedBeforeStart();
  });

  it("does not mark the slideshow running when its authoritative start command is rejected", async () => {
    patchSlideshow.mockRejectedValueOnce(Object.assign(
      new Error("narrative is active"),
      { status: 409, details: { reason: "narrative_active" } },
    ));
    const status = { textContent: "" };
    const c = controllerWithPacks();
    c.root = { querySelector: (selector) => selector === "[data-slideshow-status]" ? status : null };

    await c.handleStart();

    expect(c.running).toBe(false);
    expect(status.textContent).toBe(t("slideshowStartFailed"));
  });

  it("active narrative disables Start and prevents reciprocal slideshow ownership", async () => {
    vi.spyOn(OTEFDataContext, "getNarrativeState").mockReturnValue({
      id: "segev",
      transition: "enter",
      revision: 2,
    });
    const c = controllerWithPacks();
    c.root = { innerHTML: "" };
    c.render();
    expect(c.root.innerHTML).toMatch(/data-slideshow-start[^>]*disabled/);
    expect(c.root.innerHTML).toContain("\u05de\u05e6\u05d2\u05ea \u05d4\u05d4\u05e7\u05e8\u05e0\u05d4");
    await c.handleStart();
    expect(patchClock).not.toHaveBeenCalled();
    expect(patchSlideshow).not.toHaveBeenCalled();
  });

  it("handleKeepSettlementNamesChange patches idle clock before restarting slideshow", async () => {
    const c = controllerWithPacks();
    c.running = true;
    await c.handleKeepSettlementNamesChange();
    expectIdleClockPatchedBeforeStart();
  });

  it("active narrative blocks the keep-names restart even when local running is stale", async () => {
    vi.spyOn(OTEFDataContext, "getNarrativeState").mockReturnValue({
      id: "segev",
      transition: "enter",
      revision: 2,
    });
    const status = { textContent: "" };
    const c = controllerWithPacks();
    c.root = { querySelector: (selector) => selector === "[data-slideshow-status]" ? status : null };
    c.running = true;

    await c.handleKeepSettlementNamesChange();

    expect(patchClock).not.toHaveBeenCalled();
    expect(patchSlideshow).not.toHaveBeenCalled();
    expect(status.textContent).toBe(t("slideshowNarrativeDisabled"));
  });

  it("rechecks narrative ownership after stopping the clock before a restart", async () => {
    let narrativeActive = false;
    let releaseClock;
    vi.spyOn(OTEFDataContext, "getNarrativeState").mockImplementation(() => ({
      id: narrativeActive ? "segev" : null,
      transition: narrativeActive ? "enter" : "initial",
      revision: narrativeActive ? 2 : 0,
    }));
    patchClock.mockImplementationOnce(() => new Promise((resolve) => { releaseClock = resolve; }));
    const c = controllerWithPacks();
    c.running = true;
    const restarting = c.handleKeepSettlementNamesChange();
    narrativeActive = true;
    releaseClock();

    await restarting;

    expect(patchClock).toHaveBeenCalledTimes(1);
    expect(patchSlideshow).not.toHaveBeenCalled();
  });

  it("handles a rejected keep-names restart without an unhandled promise", async () => {
    patchSlideshow.mockRejectedValueOnce(new Error("restart rejected"));
    const status = { textContent: "" };
    const c = controllerWithPacks();
    c.root = { querySelector: (selector) => selector === "[data-slideshow-status]" ? status : null };
    c.running = true;

    await expect(c.handleKeepSettlementNamesChange()).resolves.toBeUndefined();

    expect(status.textContent).toBe(t("slideshowStartFailed"));
  });

  it("handleStop does not play NLI", async () => {
    const c = controllerWithPacks();
    c.running = true;
    await c.handleStop();
    expect(patchSlideshow).toHaveBeenCalledWith({ type: "stop", payload: {} });
    expect(patchClock).not.toHaveBeenCalled();
  });
});
