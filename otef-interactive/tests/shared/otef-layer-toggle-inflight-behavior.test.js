import { beforeEach, describe, expect, test, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  setLayerToggles: vi.fn().mockResolvedValue(undefined),
  updateLayerGroups: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../frontend/src/shared/api-client.js", () => ({
  OTEF_API: {
    setLayerToggles: (...args) => apiMocks.setLayerToggles(...args),
    updateLayerGroups: (...args) => apiMocks.updateLayerGroups(...args),
  },
}));

const AXIS = "curated_moresht_axis";
const LAYER = "101";
const fullId = `${AXIS}.${LAYER}`;

function makeDeferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function isLayerEnabled(layerGroups) {
  const g = layerGroups.find((x) => x.id === AXIS);
  return g?.layers.find((l) => l.id === LAYER)?.enabled;
}

let setLayersEnabled;

beforeEach(async () => {
  vi.resetModules();
  apiMocks.setLayerToggles.mockReset();
  apiMocks.setLayerToggles.mockResolvedValue(undefined);
  apiMocks.updateLayerGroups.mockReset();
  apiMocks.updateLayerGroups.mockResolvedValue(undefined);
  const mod = await import(
    "../../frontend/src/shared/otef-data-context/OTEFDataContext-actions.js"
  );
  setLayersEnabled = mod.setLayersEnabled;
});

describe("otef layer toggle inflight behavior", () => {
  test("rapid toggles coalesce to one command; final optimistic intent wins", async () => {
    apiMocks.setLayerToggles.mockImplementation((_table, changes) =>
      Promise.resolve({
        layerGroups: [
          {
            id: AXIS,
            enabled: true,
            layers: [{ id: LAYER, displayName: "Demo", enabled: !!changes[0]?.enabled }],
          },
        ],
      }),
    );
    apiMocks.updateLayerGroups.mockImplementation((_table, next) =>
      Promise.resolve({ layerGroups: JSON.parse(JSON.stringify(next)) }),
    );

    const initialGroups = [
      {
        id: AXIS,
        enabled: true,
        layers: [{ id: LAYER, displayName: "Demo", enabled: false }],
      },
    ];

    const ctx = {
      _tableName: "otef",
      _clientId: "test-client",
      _pendingLayerOps: 0,
      _layerOpGeneration: 0,
      _layerGroups: initialGroups,
      _setActiveLayerTrace: vi.fn(),
      _clearActiveLayerTrace: vi.fn(),
    };
    ctx._setLayerGroups = vi.fn((next) => {
      if (Array.isArray(next)) ctx._layerGroups = next;
    });

    const p0 = setLayersEnabled(ctx, [fullId], true);
    const p1 = setLayersEnabled(ctx, [fullId], false);
    const p2 = setLayersEnabled(ctx, [fullId], true);
    await Promise.all([p0, p1, p2]);

    expect(apiMocks.setLayerToggles).toHaveBeenCalledTimes(1);
    expect(apiMocks.updateLayerGroups).not.toHaveBeenCalled();
    const firstChanges = apiMocks.setLayerToggles.mock.calls[0][1];
    expect(firstChanges).toContainEqual({ full_layer_id: fullId, enabled: true });

    const lastGroups = ctx._setLayerGroups.mock.calls.at(-1)[0];
    expect(isLayerEnabled(lastGroups)).toBe(true);
  });

  test("stale command result ignored: newer intent triggers second round; last intent wins", async () => {
    const d0 = makeDeferred();
    let call = 0;
    apiMocks.setLayerToggles.mockImplementation((_table, changes) => {
      const i = call++;
      const enabled = !!changes[0]?.enabled;
      if (i === 0) {
        return d0.promise.then(() => ({
          layerGroups: [
            { id: AXIS, enabled: true, layers: [{ id: LAYER, displayName: "Demo", enabled }] },
          ],
        }));
      }
      return Promise.resolve({
        layerGroups: [{ id: AXIS, enabled: true, layers: [{ id: LAYER, displayName: "Demo", enabled }] }],
      });
    });

    const ctx = {
      _tableName: "otef",
      _clientId: "test-client",
      _pendingLayerOps: 0,
      _layerOpGeneration: 0,
      _layerGroups: [
        {
          id: AXIS,
          enabled: true,
          layers: [{ id: LAYER, displayName: "Demo", enabled: false }],
        },
      ],
      _setActiveLayerTrace: vi.fn(),
      _clearActiveLayerTrace: vi.fn(),
    };
    ctx._setLayerGroups = vi.fn((next) => {
      if (Array.isArray(next)) ctx._layerGroups = next;
    });

    const p0 = setLayersEnabled(ctx, [fullId], true);
    await Promise.resolve();
    const p1 = setLayersEnabled(ctx, [fullId], false);
    d0.resolve();
    await Promise.all([p0, p1]);

    expect(apiMocks.setLayerToggles).toHaveBeenCalledTimes(2);
    expect(apiMocks.updateLayerGroups).not.toHaveBeenCalled();
    const lastGroups = ctx._setLayerGroups.mock.calls.at(-1)[0];
    expect(isLayerEnabled(lastGroups)).toBe(false);
  });

  test("falls back to full PATCH when command path fails", async () => {
    apiMocks.setLayerToggles.mockRejectedValueOnce(new Error("command failed"));
    apiMocks.updateLayerGroups.mockImplementation((_table, next) =>
      Promise.resolve({ layerGroups: JSON.parse(JSON.stringify(next)) }),
    );

    const initialGroups = [
      {
        id: AXIS,
        enabled: true,
        layers: [{ id: LAYER, displayName: "Demo", enabled: false }],
      },
    ];
    const ctx = {
      _tableName: "otef",
      _clientId: "test-client",
      _pendingLayerOps: 0,
      _layerOpGeneration: 0,
      _layerGroups: initialGroups,
      _setActiveLayerTrace: vi.fn(),
      _clearActiveLayerTrace: vi.fn(),
    };
    ctx._setLayerGroups = vi.fn((next) => {
      if (Array.isArray(next)) ctx._layerGroups = next;
    });

    const res = await setLayersEnabled(ctx, [fullId], true);
    expect(res.ok).toBe(true);
    expect(apiMocks.setLayerToggles).toHaveBeenCalledTimes(1);
    expect(apiMocks.updateLayerGroups).toHaveBeenCalledTimes(1);
    expect(isLayerEnabled(apiMocks.updateLayerGroups.mock.calls[0][1])).toBe(true);
  });
});
