import { beforeEach, describe, expect, test, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  setLayerToggles: vi.fn().mockResolvedValue({}),
  updateLayerGroups: vi.fn().mockResolvedValue({}),
  updateAnimations: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../frontend/src/shared/api-client.js", () => ({
  OTEF_API: {
    setLayerToggles: (...args) => apiMocks.setLayerToggles(...args),
    updateLayerGroups: (...args) => apiMocks.updateLayerGroups(...args),
    updateAnimations: (...args) => apiMocks.updateAnimations(...args),
  },
}));

const G = "october_7th";
const L = "route_line_test";
const fullId = `${G}.${L}`;

let setLayersEnabled;

beforeEach(async () => {
  vi.resetModules();
  apiMocks.setLayerToggles.mockReset();
  apiMocks.setLayerToggles.mockImplementation(() =>
    Promise.resolve({
      layerGroups: [
        {
          id: G,
          enabled: true,
          layers: [{ id: L, displayName: "Route", enabled: false }],
        },
      ],
    }),
  );
  apiMocks.updateAnimations.mockReset();
  apiMocks.updateAnimations.mockResolvedValue({});
  const mod = await import(
    "../../frontend/src/shared/otef-data-context/OTEFDataContext-actions.js",
  );
  setLayersEnabled = mod.setLayersEnabled;
});

describe("setLayersEnabled animation sync", () => {
  test("turning a layer off clears persisted animation for matching full ids", async () => {
    const initialGroups = [
      {
        id: G,
        enabled: true,
        layers: [{ id: L, displayName: "Route", enabled: true }],
      },
    ];
    const ctx = {
      _tableName: "otef",
      _clientId: "test-client",
      _pendingLayerOps: 0,
      _layerOpGeneration: 0,
      _pendingAnimationOps: 0,
      _layerGroups: initialGroups,
      _animations: { [fullId]: true },
      _setActiveLayerTrace: vi.fn(),
      _clearActiveLayerTrace: vi.fn(),
    };
    ctx._setLayerGroups = vi.fn((next) => {
      if (Array.isArray(next)) ctx._layerGroups = next;
    });
    ctx._setAnimations = vi.fn((next) => {
      ctx._animations = next;
    });

    const res = await setLayersEnabled(ctx, [fullId], false);
    expect(res.ok).toBe(true);
    expect(ctx._animations[fullId]).toBe(false);
    expect(apiMocks.updateAnimations).toHaveBeenCalledTimes(1);
    const animPayload = apiMocks.updateAnimations.mock.calls[0][1];
    expect(animPayload[fullId]).toBe(false);
  });
});
