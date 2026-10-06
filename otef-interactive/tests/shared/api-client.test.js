import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

describe("OTEF_API viewport updates", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    vi.resetModules();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
  });

  test("promotes viewport source metadata to the PATCH body", async () => {
    const { OTEF_API } = await import("../../frontend/src/shared/api-client.js");

    await OTEF_API.updateViewport("otef", {
      bbox: [1, 2, 3, 4],
      zoom: 13,
      sourceId: "gis-client",
      timestamp: 1234,
      traceId: "place-nav-test",
    });

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.viewport.bbox).toEqual([1, 2, 3, 4]);
    expect(body.sourceId).toBe("gis-client");
    expect(body.timestamp).toBe(1234);
    expect(body.traceId).toBe("place-nav-test");
  });

  test("serializes immediate viewport writes and coalesces queued travel snapshots", async () => {
    const responses = [];
    global.fetch = vi.fn(() => new Promise((resolve) => responses.push(resolve)));
    const { OTEF_API } = await import("../../frontend/src/shared/api-client.js");

    const first = OTEF_API.updateViewportImmediate("otef", {
      bbox: [0, 0, 10, 10], zoom: 13, timestamp: 100,
    });
    const superseded = OTEF_API.updateViewportImmediate("otef", {
      bbox: [1, 1, 9, 9], zoom: 14, timestamp: 200,
    });
    const final = OTEF_API.updateViewportImmediate("otef", {
      bbox: [2, 2, 8, 8], zoom: 15, timestamp: 300,
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    responses.shift()({ ok: true, status: 200, json: async () => ({ revision: 1 }) });
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

    const secondBody = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(secondBody.viewport.timestamp).toBe(300);
    expect(secondBody.viewport.bbox).toEqual([2, 2, 8, 8]);

    responses.shift()({ ok: true, status: 200, json: async () => ({ revision: 2 }) });
    await expect(Promise.all([first, superseded, final])).resolves.toEqual([
      { revision: 1 },
      { revision: 2 },
      { revision: 2 },
    ]);
  });

  test("owns a rejected debounced viewport write and recovers the immediate queue", async () => {
    vi.useFakeTimers();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const { OTEF_API } = await import("../../frontend/src/shared/api-client.js");
    OTEF_API.updateViewportDebounced("otef", { bbox: [1, 2, 3, 4] });
    await vi.advanceTimersByTimeAsync(120);
    expect(errorLog).toHaveBeenCalledWith("[OTEF API] Error updating state:", expect.objectContaining({ message: "Failed to update state: 500" }));
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(OTEF_API._viewportDebounce).toBeNull();
    expect(OTEF_API._viewportImmediateQueues.size).toBe(0);
    await expect(OTEF_API.updateViewportImmediate("otef", { bbox: [2, 3, 4, 5] })).resolves.toEqual({});
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});


test("presentation transport forwards cancellation without serializing it", async () => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  const { OTEF_API } = await import("../../frontend/src/shared/api-client.js");
  const controller = new AbortController();
  await OTEF_API.narrativePresentationCommand("otef", { presentationAction: "close" }, { signal: controller.signal });
  expect(global.fetch.mock.calls[0][1].signal).toBe(controller.signal);
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).not.toHaveProperty("signal");
});


test("presentation retries abort stalled HTTP requests before dispatching replacements", async () => {
  vi.useFakeTimers();
  const signals = [];
  const originalFetch = global.fetch;
  global.fetch = vi.fn((_url, options) => {
    signals.push(options.signal);
    return new Promise(() => {});
  });
  const { OTEF_API } = await import("../../frontend/src/shared/api-client.js");
  const { createNliStaffPresentationController } = await import("../../frontend/src/remote/nli-staff-presentation.js");
  const controller = createNliStaffPresentationController({ dataContext: {
    subscribe: () => () => {},
    narrativePresentationCommand: (command, options) => OTEF_API.narrativePresentationCommand("otef", command, options),
  } });
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const request = attempt === 0 ? controller.run("open", "nova_mor") : controller.recoverOpen("nova_mor");
      expect(signals.filter(signal => !signal.aborted)).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(6000);
      expect(await request).toBe(false);
      expect(signals.every(signal => signal.aborted)).toBe(true);
    }
    const request = controller.recoverOpen("nova_mor");
    controller.destroy();
    expect(await request).toBe(false);
    expect(signals.every(signal => signal.aborted)).toBe(true);
  } finally {
    controller.destroy();
    global.fetch = originalFetch;
    vi.useRealTimers();
  }
});


test("intentional caller abort stays quiet while unexpected aborts and real failures are logged", async () => {
  const logError = vi.spyOn(console, "error").mockImplementation(() => {});
  const { OTEF_API } = await import("../../frontend/src/shared/api-client.js");
  const controller = new AbortController();
  controller.abort();
  const abortError = Object.assign(new Error("cancelled"), { name: "AbortError" });
  global.fetch = vi.fn().mockRejectedValue(abortError);
  try {
    await expect(OTEF_API.executeCommand("otef", { action: "narrative_presentation" }, { signal: controller.signal })).rejects.toBe(abortError);
    expect(logError).not.toHaveBeenCalled();
    await expect(OTEF_API.executeCommand("otef", {})).rejects.toBe(abortError);
    expect(logError).toHaveBeenCalledTimes(1);
    const failure = new Error("network failure");
    global.fetch.mockRejectedValue(failure);
    await expect(OTEF_API.executeCommand("otef", {}, { signal: controller.signal })).rejects.toBe(failure);
    expect(logError).toHaveBeenCalledTimes(2);
  } finally {
    logError.mockRestore();
  }
});
