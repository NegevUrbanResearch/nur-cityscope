const {
  createViewportApplyScheduler,
} = require("../../frontend/js/map/viewport-sync-scheduler");

describe("viewport-sync scheduler", () => {
  test("coalesces rapid updates and applies latest viewport once", () => {
    const applied = [];
    const rafQueue = [];

    const scheduler = createViewportApplyScheduler({
      applyViewport: (viewport) => applied.push(viewport),
      minIntervalMs: 33,
      now: () => 1000,
      raf: (cb) => rafQueue.push(cb),
    });

    scheduler.schedule({ id: 1 });
    scheduler.schedule({ id: 2 });
    scheduler.schedule({ id: 3 });

    expect(rafQueue.length).toBe(1);
    rafQueue.shift()();

    expect(applied).toEqual([{ id: 3 }]);
  });

  test("respects apply interval limit", () => {
    const applied = [];
    const rafQueue = [];
    let clock = 100;

    const scheduler = createViewportApplyScheduler({
      applyViewport: (viewport) => applied.push(viewport),
      minIntervalMs: 33,
      now: () => clock,
      raf: (cb) => rafQueue.push(cb),
    });

    scheduler.schedule({ id: 1 });
    rafQueue.shift()();
    expect(applied).toEqual([{ id: 1 }]);

    scheduler.schedule({ id: 2 });
    // No time advanced; first frame should defer.
    rafQueue.shift()();
    expect(applied).toEqual([{ id: 1 }]);

    clock = 140;
    rafQueue.shift()();
    expect(applied).toEqual([{ id: 1 }, { id: 2 }]);
  });
});
