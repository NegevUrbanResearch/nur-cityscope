import { expect, test, vi } from "vitest";
import { createProjectionDrawScheduler } from "../../frontend/src/projection/projection-draw-scheduler.js";

function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, delay) { const id = nextId++; timers.set(id, { callback, due: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) {
      const target = now + ms;
      while (true) {
        const next = [...timers.entries()].sort((a, b) => a[1].due - b[1].due)[0];
        if (!next || next[1].due > target) break;
        now = next[1].due; timers.delete(next[0]); next[1].callback();
      }
      now = target;
    },
    pending: () => timers.size,
  };
}

test("coalesces active playback requests and draws at a trailing deadline", () => {
  const clock = fakeTimers(); const drawnStates = []; let latestState = "initial";
  const draw = vi.fn(() => drawnStates.push(latestState));
  const scheduler = createProjectionDrawScheduler({ draw, now: clock.now, setTimeoutImpl: clock.setTimeout, clearTimeoutImpl: clock.clearTimeout, shouldThrottle: () => true, maxFps: 20 });
  scheduler.drawNow(); latestState = "first"; scheduler.requestDraw(); latestState = "second"; scheduler.requestDraw(); latestState = "latest"; scheduler.requestDraw();
  expect(draw).toHaveBeenCalledTimes(1);
  clock.advance(51);
  expect(draw).toHaveBeenCalledTimes(2);
  expect(drawnStates.at(-1)).toBe("latest");
  scheduler.dispose();
});

test.each([50, 60, 120])("limits sustained %i Hz requests to 20 draws per second", (inputHz) => {
  const clock = fakeTimers(); const draw = vi.fn();
  const scheduler = createProjectionDrawScheduler({ draw, now: clock.now, setTimeoutImpl: clock.setTimeout, clearTimeoutImpl: clock.clearTimeout, shouldThrottle: () => true, maxFps: 20 });
  scheduler.drawNow();
  const requestInterval = 1000 / inputHz;
  for (let elapsed = requestInterval; elapsed <= 3000; elapsed += requestInterval) {
    clock.advance(requestInterval);
    scheduler.requestDraw();
  }
  clock.advance(34);
  expect(draw.mock.calls.length).toBeLessThanOrEqual(62);
  expect(draw.mock.calls.length).toBeGreaterThanOrEqual(59);
  scheduler.dispose();
});

test("unthrottled requests draw immediately and dispose cancels trailing work", () => {
  const clock = fakeTimers(); const draw = vi.fn(); let throttled = true;
  const scheduler = createProjectionDrawScheduler({ draw, now: clock.now, setTimeoutImpl: clock.setTimeout, clearTimeoutImpl: clock.clearTimeout, shouldThrottle: () => throttled, maxFps: 20 });
  scheduler.drawNow(); scheduler.requestDraw();
  expect(clock.pending()).toBe(1);
  throttled = false; scheduler.requestDraw();
  expect(draw).toHaveBeenCalledTimes(2);
  throttled = true; scheduler.requestDraw(); expect(clock.pending()).toBe(1);
  scheduler.dispose(); clock.advance(100);
  expect(draw).toHaveBeenCalledTimes(2);
});

test("keeps one reentrant draw request for the trailing deadline", () => {
  const clock = fakeTimers(); let scheduler; let calls = 0;
  const draw = vi.fn(() => { calls += 1; if (calls === 1) scheduler.requestDraw(); });
  scheduler = createProjectionDrawScheduler({ draw, now: clock.now, setTimeoutImpl: clock.setTimeout, clearTimeoutImpl: clock.clearTimeout, shouldThrottle: () => true, maxFps: 20 });
  scheduler.drawNow();
  expect(draw).toHaveBeenCalledTimes(1);
  expect(clock.pending()).toBe(1);
  clock.advance(51);
  expect(draw).toHaveBeenCalledTimes(2);
  scheduler.dispose();
});
