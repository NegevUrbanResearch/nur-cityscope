import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("syncCuratedMapLayersAfterSupabasePull debounce merge", () => {
  /** @type {typeof import("../../frontend/src/map/map-curated-supabase-sync.js").syncCuratedMapLayersAfterSupabasePull} */
  let syncCuratedMapLayersAfterSupabasePull;

  async function loadFreshModule() {
    vi.resetModules();
    globalThis.OTEFDataContext = {
      refreshLayerGroupsFromApi: vi.fn().mockResolvedValue(undefined),
    };
    globalThis.LayerStateHelper = {
      getEffectiveLayerGroups: vi.fn().mockReturnValue([]),
    };
    ({ syncCuratedMapLayersAfterSupabasePull } = await import(
      "../../frontend/src/map/map-curated-supabase-sync.js"
    ));
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    await loadFreshModule();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.OTEFDataContext;
    delete globalThis.LayerStateHelper;
  });

  it("merges affected_curated_full_layer_ids from multiple calls within the debounce window", async () => {
    const reloadCuratedOnMap = vi.fn();
    const loadLayerFromRegistry = vi.fn().mockResolvedValue(undefined);

    const p1 = syncCuratedMapLayersAfterSupabasePull({
      reloadCuratedOnMap,
      loadLayerFromRegistry,
      pullPayload: { affected_curated_full_layer_ids: ["curated.x.a"] },
    });
    const p2 = syncCuratedMapLayersAfterSupabasePull({
      reloadCuratedOnMap,
      loadLayerFromRegistry,
      pullPayload: { affected_curated_full_layer_ids: ["curated.x.b"] },
    });

    await vi.advanceTimersByTimeAsync(400);
    await Promise.all([p1, p2]);

    expect(reloadCuratedOnMap).toHaveBeenCalledTimes(1);
    expect(reloadCuratedOnMap).toHaveBeenCalledWith({
      affectedCuratedFullLayerIds: expect.arrayContaining([
        "curated.x.a",
        "curated.x.b",
      ]),
    });
    expect(reloadCuratedOnMap.mock.calls[0][0].affectedCuratedFullLayerIds).toHaveLength(2);
  });

  it("forces a full curated reload when any batched call is non-selective (empty affected ids)", async () => {
    const reloadCuratedOnMap = vi.fn();
    const loadLayerFromRegistry = vi.fn().mockResolvedValue(undefined);

    const p1 = syncCuratedMapLayersAfterSupabasePull({
      reloadCuratedOnMap,
      loadLayerFromRegistry,
      pullPayload: { affected_curated_full_layer_ids: ["curated.x.a"] },
    });
    const p2 = syncCuratedMapLayersAfterSupabasePull({
      reloadCuratedOnMap,
      loadLayerFromRegistry,
      pullPayload: { affected_curated_full_layer_ids: [] },
    });

    await vi.advanceTimersByTimeAsync(400);
    await Promise.all([p1, p2]);

    expect(reloadCuratedOnMap).toHaveBeenCalledTimes(1);
    expect(reloadCuratedOnMap).toHaveBeenCalledWith();
  });

  it("forces a full curated reload when a later call omits affected ids", async () => {
    const reloadCuratedOnMap = vi.fn();
    const loadLayerFromRegistry = vi.fn().mockResolvedValue(undefined);

    const p1 = syncCuratedMapLayersAfterSupabasePull({
      reloadCuratedOnMap,
      loadLayerFromRegistry,
      pullPayload: { affected_curated_full_layer_ids: ["curated.x.a"] },
    });
    const p2 = syncCuratedMapLayersAfterSupabasePull({
      reloadCuratedOnMap,
      loadLayerFromRegistry,
      pullPayload: {},
    });

    await vi.advanceTimersByTimeAsync(400);
    await Promise.all([p1, p2]);

    expect(reloadCuratedOnMap).toHaveBeenCalledTimes(1);
    expect(reloadCuratedOnMap).toHaveBeenCalledWith();
  });
});
