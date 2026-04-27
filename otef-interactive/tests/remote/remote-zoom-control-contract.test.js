import { describe, expect, it } from "vitest";
import { computeNextZoomFromLiveState } from "../../frontend/src/remote/remote-zoom-control-contract.js";

describe("remote zoom control contract", () => {
  it("normalizes live fractional zoom to integer and increments predictably", () => {
    const next = computeNextZoomFromLiveState({
      sliderValue: "11",
      liveViewportZoom: 15.8,
      stateZoom: undefined,
      delta: 1,
    });
    expect(next).toBe(17);
  });

  it("uses pending local intent as base to accumulate rapid taps under latency", () => {
    const next = computeNextZoomFromLiveState({
      sliderValue: "11",
      liveViewportZoom: 11.267,
      stateZoom: undefined,
      pendingZoom: 13,
      delta: 1,
    });
    expect(next).toBe(14);
  });

  it("falls back to slider integer level when live zoom is not finite", () => {
    expect(
      computeNextZoomFromLiveState({
        sliderValue: "14.4",
        liveViewportZoom: Number.NaN,
        stateZoom: 15,
        delta: 1,
      }),
    ).toBe(15);
  });

  it("returns normalized integer level for zero delta", () => {
    expect(
      computeNextZoomFromLiveState({
        sliderValue: "16.6",
        liveViewportZoom: Number.NaN,
        stateZoom: undefined,
        delta: 0,
      }),
    ).toBe(17);
  });

  it("clamps zoom to min/max bounds", () => {
    expect(
      computeNextZoomFromLiveState({
        sliderValue: "19",
        liveViewportZoom: 19,
        stateZoom: 19,
        delta: 1,
      }),
    ).toBe(19);

    expect(
      computeNextZoomFromLiveState({
        sliderValue: "10",
        liveViewportZoom: 10,
        stateZoom: 10,
        delta: -1,
      }),
    ).toBe(10);
  });
});
