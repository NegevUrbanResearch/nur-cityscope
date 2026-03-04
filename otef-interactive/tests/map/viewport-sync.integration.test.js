const {
  createViewportApplyScheduler,
} = require("../../frontend/src/map/viewport-sync-scheduler");
const {
  getRemoteViewportSetViewOptions,
} = require("../../frontend/src/map/viewport-apply-policy");

describe("viewport sync integration", () => {
  test("applies latest viewport with non-animated policy", () => {
    const setViewCalls = [];
    const map = {
      setView: (center, zoom, options) =>
        setViewCalls.push({ center, zoom, options }),
    };
    const policy = getRemoteViewportSetViewOptions({
      ANIMATE_REMOTE_VIEWPORT: false,
      REMOTE_ANIMATION_DURATION_S: 0.12,
    });

    const rafQueue = [];
    const scheduler = createViewportApplyScheduler({
      minIntervalMs: 0,
      now: () => 1,
      raf: (cb) => rafQueue.push(cb),
      applyViewport: (v) => map.setView(v.center, v.zoom, policy),
    });

    scheduler.schedule({ center: [31.5, 34.6], zoom: 12 });
    scheduler.schedule({ center: [31.6, 34.7], zoom: 13 });
    rafQueue.shift()();

    expect(setViewCalls).toHaveLength(1);
    expect(setViewCalls[0].center).toEqual([31.6, 34.7]);
    expect(setViewCalls[0].zoom).toBe(13);
    expect(setViewCalls[0].options.animate).toBe(false);
  });

  test("animation-state sync is isolated from viewport scheduling", () => {
    const setViewCalls = [];
    const map = {
      setView: (center, zoom, options) =>
        setViewCalls.push({ center, zoom, options }),
    };
    const policy = getRemoteViewportSetViewOptions({
      ANIMATE_REMOTE_VIEWPORT: false,
      REMOTE_ANIMATION_DURATION_S: 0.12,
    });

    const rafQueue = [];
    const scheduler = createViewportApplyScheduler({
      minIntervalMs: 0,
      now: () => 1,
      raf: (cb) => rafQueue.push(cb),
      applyViewport: (v) => map.setView(v.center, v.zoom, policy),
    });

    scheduler.schedule({ center: [31.5, 34.6], zoom: 12 });
    rafQueue.shift()();

    const animationState = { "october_7th.חדירה_לישוב-ציר": true };
    expect(animationState["october_7th.חדירה_לישוב-ציר"]).toBe(true);
    expect(setViewCalls).toHaveLength(1);
  });
});

