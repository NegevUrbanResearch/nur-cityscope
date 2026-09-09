import { beforeEach, describe, expect, test, vi } from "vitest";

describe("OTEF_API viewport updates", () => {
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
});
