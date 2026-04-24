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

  it("retries GIS report once after interaction_guard (coalesced, no storm)", () => {
    let calls = 0;
    const map = createMapMock({ bounds: [0, 0, 10, 10], zoom: 6 });
    const dataContext = createDataContextMock();
    dataContext.updateViewportFromUI = vi.fn(() => {
      calls += 1;
      if (calls === 1) return { accepted: false, reason: "interaction_guard" };
      return { accepted: true };
    });
    const cleanup = setupViewportSync(map, dataContext);

    map.emit("moveend");
    vi.runOnlyPendingTimers();
    vi.runOnlyPendingTimers();

    expect(dataContext.updateViewportFromUI).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it("does not loop when interaction_guard persists on the single reconcile attempt", () => {
    const map = createMapMock({ bounds: [0, 0, 10, 10], zoom: 6 });
    const dataContext = createDataContextMock();
    dataContext.updateViewportFromUI = vi.fn(() => ({
      accepted: false,
      reason: "interaction_guard",
    }));
    const cleanup = setupViewportSync(map, dataContext);

    map.emit("moveend");
    vi.runOnlyPendingTimers();
    vi.runOnlyPendingTimers();

    expect(dataContext.updateViewportFromUI).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it("flushes one pending GIS reconcile when remote apply unlocks (idle)", () => {
    let calls = 0;
    const map = createMapMock({ bounds: [0, 0, 10, 10], zoom: 6 });
    const dataContext = createDataContextMock();
    dataContext.updateViewportFromUI = vi.fn(() => {
      calls += 1;
      if (calls === 1) return { accepted: false, reason: "interaction_guard" };
      return { accepted: true };
    });
    const cleanup = setupViewportSync(map, dataContext);

    map.emit("moveend");
    vi.runOnlyPendingTimers();
    expect(calls).toBe(1);

    dataContext.emitViewport({
      bbox: [2, 2, 12, 12],
      zoom: 8,
      seq: 10,
    });
    expect(map.listenerCount("idle")).toBeGreaterThan(0);

    map.emit("idle");
    expect(calls).toBe(2);

    vi.runOnlyPendingTimers();

    cleanup();
  });

  it("does not call updateViewportFromUI after cleanup (straggling coalesced report)", () => {
    const map = createMapMock({ bounds: [0, 0, 10, 10], zoom: 6 });
    const dataContext = createDataContextMock();
    const cleanup = setupViewportSync(map, dataContext);

    map.emit("moveend");
    cleanup();
    vi.runAllTimers();

    expect(dataContext.updateViewportFromUI).not.toHaveBeenCalled();
  });

  it("accepts viewport after large seq rollback (reconnect) by resetting applied cursor", () => {
    const map = createMapMock({ bounds: [0, 0, 10, 10], zoom: 6 });
    const dataContext = createDataContextMock();
    const cleanup = setupViewportSync(map, dataContext);

    dataContext.emitViewport({
      bbox: [2, 2, 12, 12],
      zoom: 7,
      seq: 100,
    });
    const afterFirst = map.fitBoundsCalls.length;
    expect(afterFirst).toBeGreaterThan(0);

    dataContext.emitViewport({
      bbox: [4, 4, 14, 14],
      zoom: 8,
      seq: 5,
    });
    expect(map.fitBoundsCalls.length).toBeGreaterThan(afterFirst);
    const last = map.fitBoundsCalls[map.fitBoundsCalls.length - 1];
    const [[w, s], [e, n]] = last.targetBounds;
    expect(w).toBe(4);
    expect(s).toBe(4);
    expect(e).toBe(14);
    expect(n).toBe(14);

    cleanup();
  });

  it("ignores stale viewport notifications by monotonic seq", () => {
    const map = createMapMock({ bounds: [0, 0, 10, 10], zoom: 6 });
    const dataContext = createDataContextMock();
    const cleanup = setupViewportSync(map, dataContext);

    dataContext.emitViewport({
      bbox: [2, 2, 12, 12],
      zoom: 7,
      seq: 5,
    });
    const n = map.fitBoundsCalls.length;

    dataContext.emitViewport({
      bbox: [2, 2, 12, 12],
      zoom: 7,
      seq: 5,
    });
    expect(map.fitBoundsCalls).toHaveLength(n);

    dataContext.emitViewport({
      bbox: [4, 4, 14, 14],
      zoom: 8,
      seq: 6,
    });
    expect(map.fitBoundsCalls.length).toBeGreaterThan(n);

    cleanup();
  });

  it("does not consume seq for invalid viewport payloads", () => {
    const map = createMapMock({ bounds: [0, 0, 10, 10], zoom: 6 });
    const dataContext = createDataContextMock();
    const cleanup = setupViewportSync(map, dataContext);

    dataContext.emitViewport({
      bbox: [2, 2, Number.NaN, 12],
      zoom: 7,
      seq: 20,
    });

    const before = map.fitBoundsCalls.length;
    dataContext.emitViewport({
      bbox: [2, 2, 12, 12],
      zoom: 7,
      seq: 20,
    });

    expect(map.fitBoundsCalls.length).toBeGreaterThan(before);
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

  it("unlocks remote apply lock after timeout when idle never fires, allowing GIS report", () => {
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

    vi.advanceTimersByTime(500);
    vi.runOnlyPendingTimers();

    map.emit("moveend");
    vi.runOnlyPendingTimers();

    expect(dataContext.updateViewportFromUI).toHaveBeenCalledTimes(1);
    expect(dataContext.updateViewportFromUI).toHaveBeenCalledWith(
      expect.objectContaining({
        bbox: [2, 2, 12, 12],
        zoom: 8,
      }),
      "gis",
    );

    cleanup();
  });

});
