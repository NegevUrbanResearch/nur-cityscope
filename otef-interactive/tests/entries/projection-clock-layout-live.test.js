// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { createProjectionCaptionAdapter } from "../../frontend/src/projection/projection-caption-adapter.js";
import { projectionOverlayMatrix } from "../../frontend/src/projection/projection-overlay-placement.js";

vi.mock("../../frontend/src/projection/projection-clock-preview.js", () => ({ bootProjectionClockPreview: vi.fn(async () => {}) }));
let dispose;
afterEach(() => { dispose?.(); vi.restoreAllMocks(); });

test("production layout events and resize redraw the accepted idle clock and dispose the resize listener", async () => {
  window.history.replaceState({}, "", "/projection.html?clockPreview=1");
  window.fetch = vi.fn();
  window.maplibregl = { addProtocol: vi.fn() };
  window.pmtiles = { Protocol: class { tile() {} } };
  const entry = await import("../../frontend/src/entries/projection-main.js");
  expect(entry.bindProjectionClockLayout).toBeTypeOf("function");
  const context = new Proxy({ measureText: () => ({ width: 90 }) }, { get: (target, key) => target[key] || vi.fn() });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
  const adapter = createProjectionCaptionAdapter({});
  const first = { leftPct: 8, topPct: 8, widthPct: 35, heightPct: 28, fontPx: 22, rotateDeg: 0 };
  let saved = first;
  let onEvent;
  let currentLayout;
  let descriptor;
  const unsubscribe = vi.fn();
  const dataContext = { getNliClockLayout: () => ({ projection: { left: saved } }), subscribe: (topic, callback) => { expect(topic).toBe("nliClockLayout"); onEvent = callback; return unsubscribe; } };
  const surface = { requestDraw: vi.fn(() => {
    adapter.sync({ snapshot: { visible: true, model: { clockLabel: "06:29" } }, layout: currentLayout });
    descriptor = adapter.draw();
  }) };
  const host = document.createElement("div");
  dispose = entry.bindProjectionClockLayout({ dataContext, host, span: "left", onLayout: (layout) => { currentLayout = layout; }, getBrowserSurface: () => surface });
  surface.requestDraw.mockClear();
  saved = { ...first, leftPct: 40, fontPx: 30, rotateDeg: 20 };
  onEvent();
  expect(surface.requestDraw).toHaveBeenCalledOnce();
  expect(host.style.left).toBe("40%");
  expect(descriptor.matrix).toEqual(projectionOverlayMatrix(saved));
  surface.requestDraw.mockClear();
  host.style.left = "0%";
  window.dispatchEvent(new Event("resize"));
  expect(host.style.left).toBe("40%");
  expect(surface.requestDraw).toHaveBeenCalledOnce();
  dispose(); dispose = null; expect(unsubscribe).toHaveBeenCalledOnce();
  surface.requestDraw.mockClear(); host.style.left = "0%";
  window.dispatchEvent(new Event("resize"));
  expect(host.style.left).toBe("0%"); expect(surface.requestDraw).not.toHaveBeenCalled();
  adapter.dispose();
});
