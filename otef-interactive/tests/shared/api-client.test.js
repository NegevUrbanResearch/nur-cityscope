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
});
