import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startCuratedSupabaseHeartbeat } from "../../frontend/src/shared/curated-supabase-heartbeat.js";

describe("curated supabase heartbeat polls pull-from-supabase", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls pull-from-supabase on each interval tick", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        updated: 0,
        autopublished: 0,
        errors: [],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const onUpdated = vi.fn();
    const stop = startCuratedSupabaseHeartbeat({
      table: "otef",
      intervalMs: 5000,
      onUpdated,
    });
    await vi.runOnlyPendingTimersAsync();
    expect(fetchMock).toHaveBeenCalled();
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/api/supabase/curated/pull-from-supabase/");
    expect(url).toContain("table=");
    fetchMock.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalled();
    stop();
  });
});
