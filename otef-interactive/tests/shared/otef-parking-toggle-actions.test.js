import { beforeEach, describe, expect, test, vi } from "vitest";

import { PINK_LINE_PARKING_LAYER_ID } from "../../frontend/src/map-utils/curated-pink-axis-state.js";

const apiMocks = vi.hoisted(() => ({
  updateLayerGroups: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../frontend/src/shared/api-client.js", () => ({
  OTEF_API: {
    updateLayerGroups: (...args) => apiMocks.updateLayerGroups(...args),
  },
}));

let toggleLayerInGroups;
let toggleGroup;

beforeEach(async () => {
  vi.resetModules();
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
      _layerGroups: [
        {
          id: "curated_moresht_axis",
          enabled: true,
          layers: [{ id: "101", displayName: "Demo", enabled: true }],
        },
      ],
      _setLayerGroups: vi.fn(),
    };

    const result = await toggleLayerInGroups(
      ctx,
      `curated_moresht_axis.${PINK_LINE_PARKING_LAYER_ID}`,
      false,
    );

    expect(result.ok).toBe(true);
    expect(apiMocks.updateLayerGroups).toHaveBeenCalledTimes(1);
    const payload = apiMocks.updateLayerGroups.mock.calls[0][1];
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
    apiMocks.updateLayerGroups.mockResolvedValueOnce({ layerGroups: serverGroups });

    const ctx = {
      _tableName: "otef",
      _layerGroups: [
        {
          id: "curated_moresht_axis",
          enabled: true,
          layers: [{ id: "101", displayName: "Demo", enabled: true }],
        },
      ],
      _setLayerGroups: vi.fn(),
    };

    await toggleLayerInGroups(
      ctx,
      `curated_moresht_axis.${PINK_LINE_PARKING_LAYER_ID}`,
      false,
    );

    const last = ctx._setLayerGroups.mock.calls.at(-1)[0];
    expect(last).toEqual(serverGroups);
  });
});

describe("toggleGroup + Moreshet parking row", () => {
  const axisId = "curated_moresht_axis";

  function makeCtx(layerGroups) {
    return {
      _tableName: "otef",
      _layerGroups: layerGroups,
      _setLayerGroups: vi.fn(),
    };
  }

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
    const payload = apiMocks.updateLayerGroups.mock.calls[0][1];
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
    let payload = apiMocks.updateLayerGroups.mock.calls[0][1];
    let axis = payload.find((g) => g.id === axisId);
    expect(axis.layers.map((l) => l.id)).toContain(PINK_LINE_PARKING_LAYER_ID);
    expect(axis.layers.find((l) => l.id === "101").enabled).toBe(true);
    expect(axis.layers.find((l) => l.id === PINK_LINE_PARKING_LAYER_ID).enabled).toBe(
      true,
    );

    apiMocks.updateLayerGroups.mockClear();
    ctx._layerGroups = JSON.parse(JSON.stringify(payload));

    await toggleGroup(ctx, axisId, false);
    payload = apiMocks.updateLayerGroups.mock.calls[0][1];
    axis = payload.find((g) => g.id === axisId);
    expect(axis.layers.find((l) => l.id === "101").enabled).toBe(false);
    expect(axis.layers.find((l) => l.id === PINK_LINE_PARKING_LAYER_ID).enabled).toBe(
      false,
    );

    apiMocks.updateLayerGroups.mockClear();
    ctx._layerGroups = JSON.parse(JSON.stringify(payload));

    await toggleGroup(ctx, axisId, true);
    payload = apiMocks.updateLayerGroups.mock.calls[0][1];
    axis = payload.find((g) => g.id === axisId);
    expect(axis.layers.find((l) => l.id === "101").enabled).toBe(true);
    expect(axis.layers.find((l) => l.id === PINK_LINE_PARKING_LAYER_ID).enabled).toBe(
      true,
    );
  });

  test("group toggle rollback restores raw layerGroups without synthetic parking row", async () => {
    apiMocks.updateLayerGroups.mockRejectedValueOnce(new Error("network"));
    const raw = [
      {
        id: axisId,
        enabled: true,
        layers: [{ id: "101", displayName: "Demo", enabled: true }],
      },
    ];
    const ctx = makeCtx(raw);

    const result = await toggleGroup(ctx, axisId, false);

    expect(result.ok).toBe(false);
    expect(ctx._setLayerGroups).toHaveBeenCalled();
    const rollbackArg = ctx._setLayerGroups.mock.calls.at(-1)[0];
    const axis = rollbackArg.find((g) => g.id === axisId);
    expect(axis.layers.some((l) => l.id === PINK_LINE_PARKING_LAYER_ID)).toBe(false);
  });
});
