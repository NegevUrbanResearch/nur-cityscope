import { beforeEach, describe, expect, test, vi } from "vitest";

describe("OTEFDataContext place navigation", () => {
  beforeEach(() => vi.resetModules());

  test("navigateToPlace sends a command without viewport geometry", async () => {
    const api = await import("../../frontend/src/shared/api-client.js");
    vi.spyOn(api.OTEF_API, "navigateToPlace").mockResolvedValue({
      command: { placeId: "yeshuv-0067" },
    });
    const { default: OTEFDataContext } = await import(
      "../../frontend/src/shared/OTEFDataContext.js"
    );
    OTEFDataContext._tableName = "otef";

    await OTEFDataContext.navigateToPlace({
      id: "yeshuv-0067",
      cameraHint: { center: { lng: 34.6, lat: 31.5 }, zoom: 15 },
    });

    const command = api.OTEF_API.navigateToPlace.mock.calls[0][1];
    expect(command.placeId).toBe("yeshuv-0067");
    expect(command.cameraHint).toBeTruthy();
    expect(command.traceId).toMatch(/^place-nav-/);
    expect(command.viewport).toBeUndefined();
    expect(command.bbox).toBeUndefined();
    expect(command.corners).toBeUndefined();
  });

  test("navigationCommand subscriptions do not replay stale state", async () => {
    const { default: OTEFDataContext } = await import(
      "../../frontend/src/shared/OTEFDataContext.js"
    );
    const callback = vi.fn();

    OTEFDataContext.subscribe("navigationCommand", callback);
    expect(callback).not.toHaveBeenCalled();

    OTEFDataContext._emitNavigationCommand({ id: "nav-1", placeId: "yeshuv-0067" });
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
