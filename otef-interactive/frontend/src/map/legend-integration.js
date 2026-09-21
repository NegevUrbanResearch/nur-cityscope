import { mountMapLegend } from "./map-legend.js";

const LEGEND_REFRESH_TOPICS = Object.freeze([
  "layerGroups",
  "narrativeState",
  "legendSettings",
]);

function createLegendStyleLoadRefresh(getLifecycle) {
  return () => getLifecycle?.()?.refresh?.();
}

function rectanglesIntersect(a, b) {
  return !!(
    a &&
    b &&
    a.left < b.right &&
    a.right > b.left &&
    a.top < b.bottom &&
    a.bottom > b.top
  );
}

function installMapLegendLifecycle({
  element,
  surface,
  projectionSpan,
  dataContext,
  registry,
  mount = mountMapLegend,
  onLegendSettings,
  onRenderSnapshot,
} = {}) {
  const mounted = mount({
    element,
    surface,
    projectionSpan,
    dataContext,
    registry,
    onRenderSnapshot,
  });
  const unsubscribers = [];
  let disposed = false;
  let refreshQueued = false;

  const scheduleRefresh = () => {
    if (disposed || refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      if (!disposed) void mounted.refresh();
    });
  };

  for (const topic of LEGEND_REFRESH_TOPICS) {
    const unsubscribe = dataContext?.subscribe?.(topic, (value) => {
      if (topic === "legendSettings") onLegendSettings?.(value);
      scheduleRefresh();
    });
    if (typeof unsubscribe === "function") unsubscribers.push(unsubscribe);
  }
  scheduleRefresh();

  return {
    refresh: scheduleRefresh,
    setEditing: (editing) => mounted.setEditing(editing),
    getRenderSnapshot: () => mounted.getRenderSnapshot?.() || null,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      mounted.dispose();
    },
  };
}

function computeGisLegendPlacement({
  legendRect,
  clockRect,
  viewport,
  left = 18,
  baseBottom = 20,
  gap = 12,
} = {}) {
  const width = Number(viewport?.width) || 0;
  const height = Number(viewport?.height) || 0;
  let bottom = baseBottom;
  let maxWidth = Math.max(1, width - left * 2);

  if (rectanglesIntersect(legendRect, clockRect)) {
    bottom = Math.max(baseBottom, height - clockRect.top + gap);
  }

  return { bottom, maxWidth };
}

function positionGisLegend({
  element,
  clockElement,
  viewport = typeof window !== "undefined"
    ? { width: window.innerWidth, height: window.innerHeight }
    : { width: 0, height: 0 },
} = {}) {
  if (!element?.getBoundingClientRect) return;
  element.style.bottom = "20px";
  element.style.maxWidth = `calc(100vw - ${viewport.width <= 720 ? 18 : 36}px)`;
  const placement = computeGisLegendPlacement({
    legendRect: element.getBoundingClientRect(),
    clockRect: clockElement?.getBoundingClientRect?.() || null,
    viewport,
    left: viewport.width <= 720 ? 9 : 18,
  });
  element.style.bottom = `${placement.bottom}px`;
  element.style.maxWidth = `${placement.maxWidth}px`;
}

export {
  LEGEND_REFRESH_TOPICS,
  computeGisLegendPlacement,
  createLegendStyleLoadRefresh,
  installMapLegendLifecycle,
  positionGisLegend,
  rectanglesIntersect,
};
