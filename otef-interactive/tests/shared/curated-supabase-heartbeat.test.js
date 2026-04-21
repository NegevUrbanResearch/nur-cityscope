import { describe, it, expect, vi, afterEach } from "vitest";
import { startCuratedSupabaseHeartbeat } from "../../frontend/src/shared/curated-supabase-heartbeat.js";

describe("startCuratedSupabaseHeartbeat", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("requests pull-from-supabase and invokes onUpdated when updated is 1", async () => {
    const onUpdated = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        checked: 1,
        updated: 1,
        errors: [],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const stop = startCuratedSupabaseHeartbeat({
      table: "otef",
      intervalMs: 60_000,
      onUpdated,
    });

    await vi.waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1), {
      timeout: 3000,
    });

    expect(fetchMock).toHaveBeenCalled();
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("pull-from-supabase");

    stop();
  });

  it("merges listeners: one pull notifies every registered onUpdated", async () => {
    const onA = vi.fn();
    const onB = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        checked: 1,
        updated: 1,
        errors: [],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const stopA = startCuratedSupabaseHeartbeat({
      table: "otef",
      intervalMs: 60_000,
      onUpdated: onA,
    });
    const stopB = startCuratedSupabaseHeartbeat({
      table: "otef",
      intervalMs: 60_000,
      onUpdated: onB,
    });

    await vi.waitFor(
      () => {
        expect(onA).toHaveBeenCalledTimes(1);
        expect(onB).toHaveBeenCalledTimes(1);
      },
      { timeout: 3000 },
    );

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);

    stopA();
    stopB();
  });
});
