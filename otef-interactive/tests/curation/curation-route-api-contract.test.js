import { beforeEach, describe, expect, test, vi } from "vitest";
import { createCurationApi } from "../../frontend/src/curation/curation-api.js";

describe("curation API computeRoute", () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    globalThis.fetch = fetchMock;
  });

  test("POSTs route payload to Django compute-route proxy endpoint and returns dashed route outputs", async () => {
    const payload = {
      base_paths: [
        [[34.84, 31.41], [34.85, 31.42]],
      ],
      current_points: [{ id: "c-1", lng: 34.851, lat: 31.421 }],
      history_points: [{ id: "h-1", lng: 34.849, lat: 31.419 }],
    };
    const response = {
      current_dashed: [{ type: "FeatureCollection", features: [] }],
      history_dashed: [{ type: "FeatureCollection", features: [] }],
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => response,
    });

    const api = createCurationApi();
    const out = await api.computeRoute(payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/supabase/curated/compute-route/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect(out).toEqual(
      expect.objectContaining({
        current_dashed: expect.any(Array),
        history_dashed: expect.any(Array),
      }),
    );
  });

  test("throws backend message when route proxy returns non-OK response", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "invalid route payload" }),
    });

    await expect(createCurationApi().computeRoute()).rejects.toThrow("invalid route payload");
  });
});
