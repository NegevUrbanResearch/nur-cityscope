import { describe, it, expect, vi } from "vitest";
import { pullCuratedFromSupabaseOnce } from "../../frontend/src/shared/curated-supabase-heartbeat.js";

describe("curated supabase pull (manual only, no interval)", () => {
  it("pullCuratedFromSupabaseOnce performs a single fetch (no timer-based polling)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        updated: 0,
        autopublished: 0,
        errors: [],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await pullCuratedFromSupabaseOnce({ table: "otef" });

    expect(out.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/api/supabase/curated/pull-from-supabase/");
    expect(url).toContain("table=");
  });
});
