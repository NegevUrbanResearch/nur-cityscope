import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupViewportSync } from "../../frontend/src/map/maplibre-viewport-sync.js";

function createBounds(west, south, east, north) {
  return {
    getWest: () => west,
    getSouth: () => south,
    getEast: () => east,
    getNorth: () => north,
    getSouthWest: () => ({ lng: west, lat: south }),
    getNorthEast: () => ({ lng: east, lat: north }),
  };
}

function createMapMock({ bounds, zoom, fitBoundsZoom }) {
  let currentBounds = createBounds(bounds[0], bounds[1], bounds[2], bounds[3]);
  let currentZoom = zoom;
  const listeners = new Map();
  const fitBoundsCalls = [];
  const setZoomCalls = [];

  const addListener = (eventName, handler, once) => {
    const eventListeners = listeners.get(eventName) || [];
    eventListeners.push({ handler, once });
    listeners.set(eventName, eventListeners);
  };

  return {
    fitBoundsCalls,
    setZoomCalls,
    getBounds: () => currentBounds,
    getZoom: () => currentZoom,
    fitBounds: (targetBounds, options) => {
      fitBoundsCalls.push({ targetBounds, options });
      const [[west, south], [east, north]] = targetBounds;
      currentBounds = createBounds(west, south, east, north);
      if (Number.isFinite(fitBoundsZoom)) {
        currentZoom = fitBoundsZoom;
      }
    },
    setZoom: (targetZoom, options) => {
      setZoomCalls.push({ zoom: targetZoom, options });
      currentZoom = targetZoom;
    },
    on: (eventName, handler) => {
      addListener(eventName, handler, false);
    },
    once: (eventName, handler) => {
      addListener(eventName, handler, true);
    },
    off: (eventName, handler) => {
      const eventListeners = listeners.get(eventName) || [];
      listeners.set(
        eventName,
        eventListeners.filter((entry) => entry.handler !== handler)
      );
    },
    emit: (eventName) => {
      const eventListeners = listeners.get(eventName) || [];
      if (!eventListeners.length) return;
      for (const entry of [...eventListeners]) {
        entry.handler();
      }
      listeners.set(
        eventName,
        (listeners.get(eventName) || []).filter((entry) => !entry.once)
      );
    },
    listenerCount: (eventName) => (listeners.get(eventName) || []).length,
  };
}

function createDataContextMock() {
  const subscriptions = new Map();
  const unsubscribeViewportSpy = vi.fn();
  return {
    updateViewportFromUI: vi.fn(),
    subscribe: (topic, handler) => {
      subscriptions.set(topic, handler);
      return () => {
        subscriptions.delete(topic);
        unsubscribeViewportSpy();
      };
    },
    emitViewport: (viewport) => {
      const handler = subscriptions.get("viewport");
      if (handler) handler(viewport);
    },
    unsubscribeViewportSpy,
  };
}

describe("maplibre-viewport-sync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.proj4 = vi.fn((from, to, point) => {
      void from;
      void to;
      return point;
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    delete globalThis.proj4;
  });

  it("applies remote zoom when bounds are unchanged", () => {
    const map = createMapMock({ bounds: [0, 0, 10, 10], zoom: 6 });
    const dataContext = createDataContextMock();
    const cleanup = setupViewportSync(map, dataContext);

    dataContext.emitViewport({
      bbox: [0, 0, 10, 10],
      zoom: 9,
    });

    expect(map.fitBoundsCalls).toHaveLength(0);
    expect(map.setZoomCalls).toEqual([{ zoom: 9, options: { animate: false } }]);

    cleanup();
  });

  it("re-applies explicit zoom after fitBounds changes zoom", () => {
    const map = createMapMock({ bounds: [0, 0, 10, 10], zoom: 8, fitBoundsZoom: 5 });
    const dataContext = createDataContextMock();
    const cleanup = setupViewportSync(map, dataContext);

    dataContext.emitViewport({
      bbox: [2, 2, 12, 12],
      zoom: 8,
    });

    expect(map.fitBoundsCalls).toHaveLength(1);
    expect(map.setZoomCalls).toEqual([{ zoom: 8, options: { animate: false } }]);

    cleanup();
  });

  it("suppresses UI to context updates while remote apply lock is active", () => {
    const map = createMapMock({ bounds: [0, 0, 10, 10], zoom: 6 });
    const dataContext = createDataContextMock();
    const cleanup = setupViewportSync(map, dataContext);

    dataContext.emitViewport({
      bbox: [2, 2, 12, 12],
      zoom: 8,
    });

    map.emit("moveend");
    map.emit("zoomend");
    vi.runOnlyPendingTimers();

    expect(dataContext.updateViewportFromUI).not.toHaveBeenCalled();

    map.emit("idle");
    map.emit("moveend");
    vi.runOnlyPendingTimers();

    expect(dataContext.updateViewportFromUI).toHaveBeenCalledTimes(1);
    expect(dataContext.updateViewportFromUI).toHaveBeenCalledWith(
      expect.objectContaining({
        bbox: [2, 2, 12, 12],
        zoom: 8,
      }),
      "gis"
    );

    cleanup();
  });

  it("cleans up map listeners and viewport subscription", () => {
    const map = createMapMock({ bounds: [0, 0, 10, 10], zoom: 6 });
    const dataContext = createDataContextMock();
    const cleanup = setupViewportSync(map, dataContext);

    dataContext.emitViewport({
      bbox: [1, 1, 11, 11],
      zoom: 7,
    });

    expect(map.listenerCount("idle")).toBeGreaterThan(0);
    expect(map.listenerCount("moveend")).toBeGreaterThan(0);
    expect(map.listenerCount("zoomend")).toBeGreaterThan(0);

    cleanup();

    expect(dataContext.unsubscribeViewportSpy).toHaveBeenCalledTimes(1);
    expect(map.listenerCount("idle")).toBe(0);
    expect(map.listenerCount("moveend")).toBe(0);
    expect(map.listenerCount("zoomend")).toBe(0);

    dataContext.emitViewport({
      bbox: [5, 5, 15, 15],
      zoom: 9,
    });
    map.emit("moveend");
    map.emit("zoomend");
    vi.runOnlyPendingTimers();

    expect(map.fitBoundsCalls).toHaveLength(1);
    expect(map.setZoomCalls).toHaveLength(1);
    expect(dataContext.updateViewportFromUI).not.toHaveBeenCalled();
  });
});
