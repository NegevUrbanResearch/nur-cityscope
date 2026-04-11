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

  test("POSTs route payload to Django compute-route proxy endpoint", async () => {
    const payload = {
      submission_id: "sub-123",
      route_name: "North path",
    };

    const api = createCurationApi();
    await api.computeRoute(payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/supabase/curated/compute-route/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  });
});
