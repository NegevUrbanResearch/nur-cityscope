import { describe, expect, it, vi } from "vitest";
import {
  computeGisLegendPlacement,
  createLegendStyleLoadRefresh,
  installMapLegendLifecycle,
} from "../../frontend/src/map/legend-integration.js";

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("installMapLegendLifecycle", () => {
  it("mounts once and refreshes for legend inputs but not timeline ticks", async () => {
    const callbacks = new Map();
    const unsubscribers = [];
    const dataContext = {
      subscribe: vi.fn((topic, callback) => {
        callbacks.set(topic, callback);
        callback({});
        const unsubscribe = vi.fn();
        unsubscribers.push(unsubscribe);
        return unsubscribe;
      }),
    };
    const mounted = {
      refresh: vi.fn(() => Promise.resolve()),
      setEditing: vi.fn(),
      dispose: vi.fn(),
    };
    const mount = vi.fn(() => mounted);

    const lifecycle = installMapLegendLifecycle({
      element: {},
      surface: "gis",
      dataContext,
      registry: {},
      mount,
    });
    await flushMicrotasks();

    expect(mount).toHaveBeenCalledTimes(1);
    expect(mounted.refresh).toHaveBeenCalledTimes(1);
    expect([...callbacks.keys()]).toEqual([
      "layerGroups",
      "narrativeState",
      "escapeOverlay",
      "legendSettings",
      "gazaBorderVisibility",
    ]);
    expect(callbacks.has("investigationClock")).toBe(false);

    callbacks.get("layerGroups")();
    await flushMicrotasks();
    callbacks.get("narrativeState")();
    await flushMicrotasks();
    callbacks.get("escapeOverlay")();
    await flushMicrotasks();
    callbacks.get("legendSettings")();
    await flushMicrotasks();
    callbacks.get("gazaBorderVisibility")();
    await flushMicrotasks();
    expect(mounted.refresh).toHaveBeenCalledTimes(6);

    lifecycle.dispose();
    expect(mounted.dispose).toHaveBeenCalledTimes(1);
    expect(unsubscribers.every((unsubscribe) => unsubscribe.mock.calls.length === 1)).toBe(true);
  });

  it("refreshes after a style load without mounting a second legend", async () => {
    const mounted = {
      refresh: vi.fn(() => Promise.resolve()),
      setEditing: vi.fn(),
      dispose: vi.fn(),
    };
    const mount = vi.fn(() => mounted);
    const lifecycle = installMapLegendLifecycle({
      element: {},
      surface: "projection",
      dataContext: {},
      registry: {},
      mount,
    });
    await flushMicrotasks();
    mounted.refresh.mockClear();

    const onStyleLoad = createLegendStyleLoadRefresh(() => lifecycle);
    onStyleLoad();
    await flushMicrotasks();

    expect(mounted.refresh).toHaveBeenCalledTimes(1);
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it("passes the active projection span to the mounted renderer", () => {
    const mounted = {
      refresh: vi.fn(() => Promise.resolve()),
      setEditing: vi.fn(),
      dispose: vi.fn(),
    };
    const mount = vi.fn(() => mounted);
    const lifecycle = installMapLegendLifecycle({
      element: {},
      surface: "projection",
      projectionSpan: "left",
      dataContext: {},
      registry: {},
      mount,
    });

    expect(mount).toHaveBeenCalledWith(expect.objectContaining({
      surface: "projection",
      projectionSpan: "left",
    }));
    lifecycle.dispose();
  });
});

describe("computeGisLegendPlacement", () => {
  const viewport = { width: 1200, height: 800 };

  it("moves an intersecting legend immediately above the visible clock", () => {
    const placement = computeGisLegendPlacement({
      legendRect: { left: 18, right: 620, top: 650, bottom: 780 },
      clockRect: { left: 400, right: 700, top: 620, bottom: 760 },
      attributionRect: null,
      viewport,
    });

    expect(placement.bottom).toBe(192);
  });

  it("does not shrink the rail for map attribution", () => {
    const placement = computeGisLegendPlacement({
      legendRect: { left: 18, right: 1100, top: 650, bottom: 780 },
      clockRect: null,
      attributionRect: { left: 980, right: 1180, top: 760, bottom: 790 },
      viewport,
    });

    expect(placement.maxWidth).toBe(1164);
  });
});
