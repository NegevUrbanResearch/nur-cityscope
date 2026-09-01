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

  test.each(["sw", "se", "nw", "ne"])(
    "notifies subscribers when the canonical %s corner changes with the same bbox and zoom",
    async (corner) => {
      const { default: OTEFDataContext } = await import(
        "../../frontend/src/shared/OTEFDataContext.js"
      );
      const callback = vi.fn();
      const baseViewport = {
        bbox: [100, 200, 300, 400],
        zoom: 12,
        corners: {
          sw: { x: 100, y: 200 },
          se: { x: 300, y: 200 },
          nw: { x: 100, y: 400 },
          ne: { x: 300, y: 400 },
        },
      };

      OTEFDataContext.subscribe("viewport", callback);
      OTEFDataContext._setViewport(baseViewport);
      OTEFDataContext._setViewport({
        ...baseViewport,
        corners: {
          ...baseViewport.corners,
          [corner]: { ...baseViewport.corners[corner], x: baseViewport.corners[corner].x + 1 },
        },
      });

      expect(callback).toHaveBeenCalledTimes(2);
      expect(OTEFDataContext.getViewport().corners[corner].x).toBe(
        baseViewport.corners[corner].x + 1,
      );
    },
  );

  test("ignores corner noise within the existing viewport tolerance", async () => {
    const { default: OTEFDataContext } = await import(
      "../../frontend/src/shared/OTEFDataContext.js"
    );
    const callback = vi.fn();
    const baseViewport = {
      bbox: [100, 200, 300, 400],
      zoom: 12,
      corners: {
        sw: { x: 100, y: 200 },
        se: { x: 300, y: 200 },
        nw: { x: 100, y: 400 },
        ne: { x: 300, y: 400 },
      },
    };

    OTEFDataContext.subscribe("viewport", callback);
    OTEFDataContext._setViewport(baseViewport);
    OTEFDataContext._setViewport({
      ...baseViewport,
      corners: {
        ...baseViewport.corners,
        sw: { ...baseViewport.corners.sw, x: baseViewport.corners.sw.x + 0.005 },
      },
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(OTEFDataContext.getViewport().corners.sw.x).toBe(baseViewport.corners.sw.x);
  });
});
