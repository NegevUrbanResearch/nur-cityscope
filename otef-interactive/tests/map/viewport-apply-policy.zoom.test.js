const {
  getRemoteViewportSetViewOptions,
} = require("../../frontend/js/map/viewport-apply-policy");

describe("viewport-apply-policy zoom behavior", () => {
  const cfg = {
    ZOOM_ANIMATION_ENABLED: true,
    PAN_ANIMATION_ENABLED: false,
    ZOOM_ANIMATION_DURATION_S: 0.12,
    REMOTE_ANIMATION_DURATION_S: 0.25,
  };

  test("keeps pan-only updates non-animated", () => {
    const panOnly = getRemoteViewportSetViewOptions(cfg, {
      zoomDiff: 0,
      centerDiff: 0.005,
    });
    expect(panOnly.animate).toBe(false);
    expect(panOnly.duration).toBe(0.25);
  });

  test("animates discrete zoom changes", () => {
    const zoomChange = getRemoteViewportSetViewOptions(cfg, {
      zoomDiff: 1,
      centerDiff: 0,
    });
    expect(zoomChange.animate).toBe(true);
    expect(zoomChange.duration).toBe(0.12);
  });
});
