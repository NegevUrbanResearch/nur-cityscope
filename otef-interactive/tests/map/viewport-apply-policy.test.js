const {
  getRemoteViewportSetViewOptions,
} = require("../../frontend/src/map/viewport-apply-policy");

describe("viewport-apply-policy", () => {
  test("uses non-animated setView by default", () => {
    const options = getRemoteViewportSetViewOptions({
      ANIMATE_REMOTE_VIEWPORT: false,
      PAN_ANIMATION_ENABLED: false,
      REMOTE_ANIMATION_DURATION_S: 0.25,
    });
    expect(options.animate).toBe(false);
    expect(options.duration).toBe(0.25);
  });

  test("falls back to safe duration default", () => {
    const options = getRemoteViewportSetViewOptions({
      ANIMATE_REMOTE_VIEWPORT: false,
      PAN_ANIMATION_ENABLED: false,
    });
    expect(options.duration).toBe(0.12);
  });
});

