import { describe, expect, test, vi } from "vitest";
import { createElement } from "./remote-navigation-fixtures.js";
import { createRemoteZoomController } from "../../frontend/src/remote/remote-zoom-controls.js";

function button(id) {
  return createElement(id);
}

describe("remote zoom controller", () => {
  test("binds +/- without a slider and queues integer zoom commands", async () => {
    const zoomIn = button("zoomIn");
    const zoomOut = button("zoomOut");
    const zoomValue = button("zoomValue");
    const zoom = vi.fn().mockResolvedValue(undefined);
    const controller = createRemoteZoomController({
      zoomIn,
      zoomOut,
      zoomValue,
      getViewport: () => ({ zoom: 15 }),
      zoom,
      isConnected: () => true,
    });

    controller.init();
    expect(zoomValue.textContent).toBe("15");

    zoomIn.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(zoom).toHaveBeenCalledWith(16);
    expect(zoomValue.textContent).toBe("16");
  });

  test("accumulates rapid taps against in-flight local intent", async () => {
    const zoomIn = button("zoomIn");
    const zoomOut = button("zoomOut");
    const zoomValue = button("zoomValue");
    let release;
    const zoom = vi.fn().mockImplementation(
      () => new Promise((resolve) => { release = resolve; }),
    );
    const controller = createRemoteZoomController({
      zoomIn,
      zoomOut,
      zoomValue,
      getViewport: () => ({ zoom: 12 }),
      zoom,
      isConnected: () => true,
    });

    controller.init();
    zoomIn.click();
    zoomIn.click();
    await Promise.resolve();
    expect(zoom).toHaveBeenCalledTimes(1);
    expect(zoom).toHaveBeenCalledWith(13);

    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(zoom).toHaveBeenCalledTimes(2);
    expect(zoom).toHaveBeenLastCalledWith(14);
  });

  test("binds +/- without a numeric readout", async () => {
    const zoomIn = button("zoomIn");
    const zoomOut = button("zoomOut");
    const zoom = vi.fn().mockResolvedValue(undefined);
    const controller = createRemoteZoomController({
      zoomIn,
      zoomOut,
      getViewport: () => ({ zoom: 15 }),
      zoom,
      isConnected: () => true,
    });

    controller.init();
    zoomIn.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(zoom).toHaveBeenCalledWith(16);
  });
});
