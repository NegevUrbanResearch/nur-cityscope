import { expect, test, vi } from "vitest";
import { createSlideshowSettingsPersistence } from "../../frontend/src/remote/slideshow-settings-persistence.js";

test("serializes writes and coalesces pending edits while flush waits for the latest draft", async () => {
  const releases = [];
  const save = vi.fn(() => new Promise(resolve => releases.push(resolve)));
  const scope = { experience: "regular", experience_revision: 2 };
  const queue = createSlideshowSettingsPersistence({ save, captureScope: () => scope });
  queue.schedule({ intervalMs: 1 });
  await Promise.resolve();
  queue.schedule({ intervalMs: 2 });
  queue.schedule({ intervalMs: 3 });
  let flushed = false;
  const flush = queue.flush().then(() => { flushed = true; });
  expect(save).toHaveBeenCalledTimes(1);
  releases.shift()();
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1]).toEqual([{ intervalMs: 3 }, scope]);
  expect(flushed).toBe(false);
  releases.shift()();
  await flush;
  expect(queue.hasPending()).toBe(false);
});

test("retains a failed draft, reports its error, and rejects flush until deliberate retry", async () => {
  const error = new Error("offline"), onError = vi.fn();
  const save = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(undefined);
  const queue = createSlideshowSettingsPersistence({ save, onError });
  queue.schedule({ keepSettlementNames: false });
  await expect(queue.flush()).rejects.toBe(error);
  expect(onError).toHaveBeenCalledWith(error);
  expect(queue.hasPending()).toBe(true);
  await queue.retry();
  expect(save).toHaveBeenCalledTimes(2);
  expect(queue.hasPending()).toBe(false);
});

test("a queued edit keeps its original activation and is discarded after activation changes", async () => {
  let revision = 2, release;
  const save = vi.fn(() => new Promise(resolve => { release = resolve; }));
  const queue = createSlideshowSettingsPersistence({
    save, captureScope: () => ({ experience: "regular", experience_revision: revision }),
    isCurrent: scope => scope.experience_revision === revision,
  });
  queue.schedule({ intervalMs: 1 });
  await Promise.resolve();
  queue.schedule({ intervalMs: 2 });
  revision = 4;
  release();
  await expect(queue.flush()).rejects.toThrow("experience changed");
  expect(save).toHaveBeenCalledTimes(1);
  expect(queue.hasPending()).toBe(false);
});
