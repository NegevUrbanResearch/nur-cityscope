import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("startCuratedSupabaseHeartbeat", () => {
  /** @type {typeof import("../../frontend/src/shared/curated-supabase-heartbeat.js").startCuratedSupabaseHeartbeat} */
  let startCuratedSupabaseHeartbeat;

  beforeEach(async () => {
    vi.resetModules();
    ({ startCuratedSupabaseHeartbeat } = await import(
      "../../frontend/src/shared/curated-supabase-heartbeat.js"
    ));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Top-level (non-embed) page: no embed query, not in a nested frame. */
  function stubTopLevelWindow() {
    const topRef = {};
    return {
      current: {
        location: { search: "" },
        self: topRef,
        top: topRef,
      },
    };
  }

  it("does not poll when loaded as embedded curation (?embed=1 in iframe)", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const prevWindow = globalThis.window;
    globalThis.window = {
      location: { search: "?embed=1" },
      self: {},
      top: {},
    };
    let stop;
    try {
      stop = startCuratedSupabaseHeartbeat({
        table: "otef",
        intervalMs: 60_000,
        onUpdated: vi.fn(),
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      if (stop) stop();
      globalThis.window = prevWindow;
    }
  });

  it("requests pull-from-supabase and invokes onUpdated when updated is 1", async () => {
    const stub = stubTopLevelWindow();
    const prevWindow = globalThis.window;
    globalThis.window = stub.current;

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

    let stop;
    try {
      stop = startCuratedSupabaseHeartbeat({
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
    } finally {
      if (stop) stop();
      globalThis.window = prevWindow;
    }
  });

  it("merges listeners: one pull notifies every registered onUpdated", async () => {
    const stub = stubTopLevelWindow();
    const prevWindow = globalThis.window;
    globalThis.window = stub.current;

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

    let stopA;
    let stopB;
    try {
      stopA = startCuratedSupabaseHeartbeat({
        table: "otef",
        intervalMs: 60_000,
        onUpdated: onA,
      });
      stopB = startCuratedSupabaseHeartbeat({
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
    } finally {
      if (stopA) stopA();
      if (stopB) stopB();
      globalThis.window = prevWindow;
    }
  });
});
