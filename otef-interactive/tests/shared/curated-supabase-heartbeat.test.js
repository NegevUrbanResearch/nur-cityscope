import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("pullCuratedFromSupabaseOnce", () => {
  /** @type {typeof import("../../frontend/src/shared/curated-supabase-heartbeat.js").pullCuratedFromSupabaseOnce} */
  let pullCuratedFromSupabaseOnce;

  beforeEach(async () => {
    vi.resetModules();
    ({ pullCuratedFromSupabaseOnce } = await import(
      "../../frontend/src/shared/curated-supabase-heartbeat.js"
    ));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("requests pull-from-supabase and returns parsed data when ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        checked: 1,
        updated: 1,
        errors: [],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await pullCuratedFromSupabaseOnce({ table: "otef" });

    expect(out.ok).toBe(true);
    expect(out.status).toBe(200);
    expect(out.data && out.data.updated).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("pull-from-supabase");
    expect(url).toContain("table=otef");
  });

  it("returns ok false when response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({}),
      }),
    );

    const out = await pullCuratedFromSupabaseOnce({ table: "otef" });
    expect(out.ok).toBe(false);
    expect(out.status).toBe(502);
    expect(out.data).toBe(null);
  });

  it("returns ok false on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const out = await pullCuratedFromSupabaseOnce({ table: "otef" });
    expect(out.ok).toBe(false);
    expect(out.data).toBe(null);
  });
});
