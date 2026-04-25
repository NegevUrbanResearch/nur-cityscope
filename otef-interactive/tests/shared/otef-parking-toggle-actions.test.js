import { beforeEach, describe, expect, test, vi } from "vitest";

import { PINK_LINE_PARKING_LAYER_ID } from "../../frontend/src/map-utils/curated-pink-axis-state.js";

const apiMocks = vi.hoisted(() => ({
  setLayerToggles: vi.fn().mockResolvedValue(undefined),
  setGroupEnabled: vi.fn().mockResolvedValue(undefined),
  updateLayerGroups: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../frontend/src/shared/api-client.js", () => ({
  OTEF_API: {
    setLayerToggles: (...args) => apiMocks.setLayerToggles(...args),
    setGroupEnabled: (...args) => apiMocks.setGroupEnabled(...args),
    updateLayerGroups: (...args) => apiMocks.updateLayerGroups(...args),
  },
}));

let toggleLayerInGroups;
let toggleGroup;

beforeEach(async () => {
  vi.resetModules();
  apiMocks.setLayerToggles.mockClear();
  apiMocks.setLayerToggles.mockResolvedValue(undefined);
  apiMocks.setGroupEnabled.mockClear();
  apiMocks.setGroupEnabled.mockResolvedValue(undefined);
  apiMocks.updateLayerGroups.mockClear();
  const mod = await import(
    "../../frontend/src/shared/otef-data-context/OTEFDataContext-actions.js"
  );
  toggleLayerInGroups = mod.toggleLayerInGroups;
  toggleGroup = mod.toggleGroup;
});

describe("toggleLayerInGroups + parking row", () => {
  test("persists pink_line_parking when row was missing from API-shaped layerGroups", async () => {
    const ctx = {
      _tableName: "otef",
      _clientId: "test-client",
      _pendingLayerOps: 0,
      _layerOpGeneration: 0,
      _layerGroups: [
        {
          id: "curated_moresht_axis",
          enabled: true,
          layers: [{ id: "101", displayName: "Demo", enabled: true }],
        },
      ],
      _setActiveLayerTrace: vi.fn(),
      _clearActiveLayerTrace: vi.fn(),
      _setLayerGroups(next) {
        if (Array.isArray(next)) this._layerGroups = next;
      },
    };

    const result = await toggleLayerInGroups(
      ctx,
      `curated_moresht_axis.${PINK_LINE_PARKING_LAYER_ID}`,
      false,
    );

    expect(result.ok).toBe(true);
    expect(apiMocks.setLayerToggles).toHaveBeenCalledTimes(1);
    expect(apiMocks.updateLayerGroups).not.toHaveBeenCalled();
    const payload = ctx._layerGroups;
    const axis = payload.find((g) => g.id === "curated_moresht_axis");
    const parking = axis.layers.find((l) => l.id === PINK_LINE_PARKING_LAYER_ID);
    expect(parking.enabled).toBe(false);
  });

  test("applies layerGroups from PATCH response when present", async () => {
    const serverGroups = [
      {
        id: "curated_moresht_axis",
        enabled: true,
        layers: [
          { id: "101", displayName: "Demo", enabled: true },
          { id: PINK_LINE_PARKING_LAYER_ID, displayName: "Parking lots", enabled: false },
        ],
      },
    ];
    apiMocks.setLayerToggles.mockResolvedValueOnce({ layerGroups: serverGroups });

    const ctx = {
      _tableName: "otef",
      _clientId: "test-client",
      _pendingLayerOps: 0,
      _layerOpGeneration: 0,
      _layerGroups: [
        {
          id: "curated_moresht_axis",
          enabled: true,
          layers: [{ id: "101", displayName: "Demo", enabled: true }],
        },
      ],
      _setActiveLayerTrace: vi.fn(),
      _clearActiveLayerTrace: vi.fn(),
      _setLayerGroups(next) {
        if (Array.isArray(next)) this._layerGroups = next;
      },
    };
    const setSpy = vi.spyOn(ctx, "_setLayerGroups");

    await toggleLayerInGroups(
      ctx,
      `curated_moresht_axis.${PINK_LINE_PARKING_LAYER_ID}`,
      false,
    );

    const last = setSpy.mock.calls.at(-1)[0];
    expect(last).toEqual(serverGroups);
  });
});

describe("toggleGroup + Moreshet parking row", () => {
  const axisId = "curated_moresht_axis";

  function makeCtx(layerGroups) {
    return {
      _tableName: "otef",
      _clientId: "test-client",
      _pendingLayerOps: 0,
      _layerOpGeneration: 0,
      _layerGroups: layerGroups,
      _setActiveLayerTrace: vi.fn(),
      _clearActiveLayerTrace: vi.fn(),
      _setLayerGroups(next) {
        if (Array.isArray(next)) this._layerGroups = next;
      },
    };
  }

  test("uses set_group_enabled so full server layer list and group.enabled stay aligned", async () => {
    apiMocks.setGroupEnabled.mockResolvedValueOnce({
      layerGroups: [
        {
          id: "map_3_future",
          enabled: true,
          layers: [
            { id: "a", enabled: true },
            { id: "b", enabled: true },
            { id: "only_on_server", enabled: true },
          ],
        },
      ],
    });
    const ctx = makeCtx([
      {
        id: "map_3_future",
        enabled: false,
        layers: [
          { id: "a", enabled: false },
          { id: "b", enabled: false },
        ],
      },
    ]);
    const result = await toggleGroup(ctx, "map_3_future", true);
    expect(result.ok).toBe(true);
    expect(apiMocks.setGroupEnabled).toHaveBeenCalledWith(
      "otef",
      "map_3_future",
      true,
      expect.objectContaining({ sourceId: "test-client" }),
    );
    expect(apiMocks.setLayerToggles).not.toHaveBeenCalled();
    const g = ctx._layerGroups.find((x) => x.id === "map_3_future");
    expect(g.enabled).toBe(true);
    expect(g.layers.find((l) => l.id === "only_on_server").enabled).toBe(true);
  });

  test("group off persists injected parking off with content layers disabled", async () => {
    const ctx = makeCtx([
      {
        id: axisId,
        enabled: true,
        layers: [{ id: "101", displayName: "Demo", enabled: true }],
      },
    ]);

    const result = await toggleGroup(ctx, axisId, false);

    expect(result.ok).toBe(true);
    const payload = ctx._layerGroups;
    const axis = payload.find((g) => g.id === axisId);
    expect(axis.layers.map((l) => l.id)).toContain(PINK_LINE_PARKING_LAYER_ID);
    expect(axis.layers.find((l) => l.id === "101").enabled).toBe(false);
    expect(axis.layers.find((l) => l.id === PINK_LINE_PARKING_LAYER_ID).enabled).toBe(
      false,
    );
  });

  test("group on/off/on without drift when parking row was never persisted", async () => {
    const ctx = makeCtx([
      {
        id: axisId,
        enabled: false,
        layers: [{ id: "101", displayName: "Demo", enabled: false }],
      },
    ]);

    await toggleGroup(ctx, axisId, true);
    let payload = ctx._layerGroups;
    let axis = payload.find((g) => g.id === axisId);
    expect(axis.layers.map((l) => l.id)).toContain(PINK_LINE_PARKING_LAYER_ID);
    expect(axis.layers.find((l) => l.id === "101").enabled).toBe(true);
    expect(axis.layers.find((l) => l.id === PINK_LINE_PARKING_LAYER_ID).enabled).toBe(
      true,
    );

    apiMocks.updateLayerGroups.mockClear();
    ctx._layerGroups = JSON.parse(JSON.stringify(payload));

    await toggleGroup(ctx, axisId, false);
    payload = ctx._layerGroups;
    axis = payload.find((g) => g.id === axisId);
    expect(axis.layers.find((l) => l.id === "101").enabled).toBe(false);
    expect(axis.layers.find((l) => l.id === PINK_LINE_PARKING_LAYER_ID).enabled).toBe(
      false,
    );

    apiMocks.updateLayerGroups.mockClear();
    ctx._layerGroups = JSON.parse(JSON.stringify(payload));

    await toggleGroup(ctx, axisId, true);
    payload = ctx._layerGroups;
    axis = payload.find((g) => g.id === axisId);
    expect(axis.layers.find((l) => l.id === "101").enabled).toBe(true);
    expect(axis.layers.find((l) => l.id === PINK_LINE_PARKING_LAYER_ID).enabled).toBe(
      true,
    );
  });

  test("group toggle rollback restores raw layerGroups without synthetic parking row", async () => {
    apiMocks.setGroupEnabled.mockRejectedValueOnce(new Error("network command"));
    apiMocks.updateLayerGroups.mockRejectedValueOnce(new Error("network patch"));
    const raw = [
      {
        id: axisId,
        enabled: true,
        layers: [{ id: "101", displayName: "Demo", enabled: true }],
      },
    ];
    const ctx = makeCtx(raw);
    const setSpy = vi.spyOn(ctx, "_setLayerGroups");

    const result = await toggleGroup(ctx, axisId, false);

    expect(result.ok).toBe(false);
    expect(setSpy).toHaveBeenCalled();
    const rollbackArg = setSpy.mock.calls.at(-1)[0];
    const axis = rollbackArg.find((g) => g.id === axisId);
    expect(axis.layers.some((l) => l.id === PINK_LINE_PARKING_LAYER_ID)).toBe(false);
  });
});
