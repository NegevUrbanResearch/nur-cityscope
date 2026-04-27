import {
  beginSlideshowStage,
  commitSlideshowReveal,
  fadeOutAndRemoveEnabledFullIds,
  getEnabledMapFullLayerIds,
} from "../map/maplibre-layer-manager.js";
import MapProjectionConfig from "./map-projection-config.js";

/**
 * @param {import("./map-projection-config.js").MapProjectionConfig["PROJECTION_SLIDESHOW"] | {
 *   intervalMs?: number,
 *   crossfadeMs?: number,
 *   warmupLeadMs?: number,
 *   packOrder?: string[],
 *   excludedPresentationPackIds?: string[],
 * }} config
 * @param {Record<string, unknown>} [payload]
 */
function mergeSlideshowConfig(config, payload) {
  const base = { ...MapProjectionConfig.PROJECTION_SLIDESHOW, ...config };
  const p = payload && typeof payload === "object" ? payload : {};
  const {
    intervalMs: pi,
    crossfadeMs: pc,
    warmupLeadMs: pw,
    packOrder: pp,
  } = p;
  return {
    ...base,
    ...(typeof pi === "number" && Number.isFinite(pi) ? { intervalMs: Math.max(1, pi) } : {}),
    ...(typeof pc === "number" && Number.isFinite(pc) ? { crossfadeMs: Math.max(0, pc) } : {}),
    ...(typeof pw === "number" && Number.isFinite(pw) ? { warmupLeadMs: Math.max(0, pw) } : {}),
    ...(Object.prototype.hasOwnProperty.call(p, "packOrder")
      ? { packOrder: Array.isArray(pp) ? pp : [] }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(p, "excludedPresentationPackIds")
      ? {
          excludedPresentationPackIds: Array.isArray(p.excludedPresentationPackIds)
            ? p.excludedPresentationPackIds.map((id) => String(id)).filter(Boolean)
            : base.excludedPresentationPackIds,
        }
      : {}),
  };
}

/**
 * @param {unknown} value
 * @returns {Set<string>}
 */
function excludedPresentationPackIdSet(value) {
  if (!Array.isArray(value)) {
    return new Set();
  }
  return new Set(value.map((id) => String(id)).filter(Boolean));
}

/**
 * @param {Array<{ id: string }>} baseGroups
 * @param {string[]|undefined} packOrder
 * @param {string[]|undefined} excludedPackIds
 * @returns {string[]}
 */
function resolveOrderedPackIds(baseGroups, packOrder, excludedPackIds) {
  const excluded = excludedPresentationPackIdSet(excludedPackIds);
  const groups = Array.isArray(baseGroups) ? baseGroups : [];
  const available = groups
    .map((g) => (g && g.id ? String(g.id) : ""))
    .filter((id) => id && !excluded.has(id));
  const configured = (Array.isArray(packOrder) ? packOrder : [])
    .map((id) => String(id))
    .filter((id) => available.includes(id) && !excluded.has(id));
  const set = new Set(configured);
  const fallback = available.filter((id) => !set.has(id));
  return [...configured, ...fallback];
}

/**
 * @param {string} packId
 * @param {object[]} baseGroups
 * @returns {object[]}
 */
function buildSinglePackGroups(packId, baseGroups) {
  const want = String(packId);
  const groups = Array.isArray(baseGroups) ? baseGroups : [];
  return groups
    .filter((g) => g && g.id)
    .map((g) => {
      const layers = (g.layers || []).map((layer) => ({ ...layer }));
      if (g.id !== want) {
        for (const layer of layers) {
          if (layer) layer.enabled = false;
        }
      } else {
        // Presentation mode: show the whole pack even if API state had rows off.
        for (const layer of layers) {
          if (layer) layer.enabled = true;
        }
      }
      return { ...g, layers };
    });
}

/**
 * @param {object[]} incoming
 * @param {Set<string>} excluded
 * @returns {object[]}
 */
function forceDisableExcludedPackGroups(incoming, excluded) {
  if (!excluded || excluded.size === 0) {
    return incoming;
  }
  return incoming.map((g) => {
    if (!g || !g.id || !excluded.has(String(g.id))) {
      return g;
    }
    const layers = (g.layers || []).map((layer) => {
      if (!layer) {
        return layer;
      }
      return { ...layer, enabled: false };
    });
    return { ...g, layers };
  });
}

/**
 * @param {object|null} map
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
function waitForMapIdleOrTimeout(map, timeoutMs) {
  if (!map || !timeoutMs || timeoutMs <= 0) {
    return Promise.resolve();
  }
  const hasOnce = typeof map.once === "function";
  if (!hasOnce) {
    return new Promise((resolve) => {
      setTimeout(resolve, timeoutMs);
    });
  }
  return new Promise((resolve) => {
    const done = () => {
      if (t != null) {
        clearTimeout(t);
        t = null;
      }
      if (offIdle) {
        try {
          offIdle();
        } catch {
          // ignore
        }
        offIdle = null;
      }
      resolve();
    };
    let t = setTimeout(done, timeoutMs);
    let offIdle = null;
    try {
      const onIdle = () => {
        if (t != null) {
          clearTimeout(t);
          t = null;
        }
        done();
      };
      map.once("idle", onIdle);
      offIdle = () => {
        if (typeof map.off === "function") {
          map.off("idle", onIdle);
        }
      };
    } catch {
      if (t != null) {
        clearTimeout(t);
        t = null;
      }
      resolve();
    }
  });
}

/**
 * @param {{
 *   config?: import("./map-projection-config.js").MapProjectionConfig["PROJECTION_SLIDESHOW"] & { packOrder?: string[] },
 *   getEffectiveLayerGroups: (() => unknown) | (() => Promise<unknown>),
 *   syncProjectionLayers: (map: object|null, groups: object, options?: object) => unknown,
 *   applyProjectionRefresh?: ((opts?: {
 *     fromSlideshowTick?: boolean,
 *     groupsOverride?: unknown,
 *     affectedCuratedFullLayerIds?: string[],
 *   }) => unknown) | ((opts?: object) => Promise<unknown>),
 *   map?: object | null,
 * }} deps
 * @returns {{
 *   start: (payload?: object) => void,
 *   stop: () => Promise<void>,
 *   dispose: () => Promise<void>,
 *   isActive: () => boolean,
 *   shouldSuppressProjectionHighlight: () => boolean,
 *   getSessionEpoch: () => number,
 * }}
 */
export function createSlideshowPackRuntime(deps) {
  if (!deps || typeof deps !== "object") {
    throw new TypeError("createSlideshowPackRuntime: deps object is required");
  }
  const {
    config: baseConfig = {},
    getEffectiveLayerGroups,
    syncProjectionLayers,
    applyProjectionRefresh,
    map = null,
  } = deps;

  if (typeof getEffectiveLayerGroups !== "function") {
    throw new TypeError("createSlideshowPackRuntime: getEffectiveLayerGroups is required");
  }
  if (typeof syncProjectionLayers !== "function") {
    throw new TypeError("createSlideshowPackRuntime: syncProjectionLayers is required");
  }

  let active = false;
  let disposed = false;
  let timerId = null;
  let sessionEpoch = 0;
  let packIndex = 0;
  let queuedAfterCurrent = false;
  let inFlight = false;
  /** @type {Promise<void> | null} */
  let runningPromise = null;
  let startInProgress = false;
  /** @type {string | null} */
  let lastPresentationPackId = null;

  let merged = mergeSlideshowConfig(baseConfig, {});

  function clearTimer() {
    if (timerId != null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function effectiveTransitionOptions() {
    const crossfadeMs =
      typeof merged.crossfadeMs === "number" && Number.isFinite(merged.crossfadeMs)
        ? Math.max(0, merged.crossfadeMs)
        : 0;
    return {
      applyProjectionHatchPresentation: true,
      transition: { stageHidden: true, transitionMs: crossfadeMs },
    };
  }

  /**
   * @param {number} epochAtStart
   */
  async function runOneTick(epochAtStart) {
    if (!active || disposed || sessionEpoch !== epochAtStart) {
      return;
    }
    const base = await Promise.resolve(getEffectiveLayerGroups());
    if (!active || disposed || sessionEpoch !== epochAtStart) {
      return;
    }
    const baseGroups = Array.isArray(base) ? base : [];
    const excludedIds = merged.excludedPresentationPackIds;
    const excludedSet = excludedPresentationPackIdSet(excludedIds);
    const ordered = resolveOrderedPackIds(baseGroups, merged.packOrder, excludedIds);
    if (ordered.length === 0) {
      return;
    }
    const nextPackId = ordered[packIndex % ordered.length];
    const incoming = forceDisableExcludedPackGroups(
      buildSinglePackGroups(nextPackId, baseGroups),
      excludedSet,
    );

    const warmup =
      typeof merged.warmupLeadMs === "number" && Number.isFinite(merged.warmupLeadMs)
        ? Math.max(0, merged.warmupLeadMs)
        : 0;
    // One lead phase per tick: idle-or-timeout before staging (not a second delay after).
    await waitForMapIdleOrTimeout(map, warmup);

    if (!active || disposed || sessionEpoch !== epochAtStart) {
      return;
    }

    const crossfadeMs =
      typeof merged.crossfadeMs === "number" && Number.isFinite(merged.crossfadeMs)
        ? Math.max(0, merged.crossfadeMs)
        : 0;

    if (lastPresentationPackId != null) {
      const outgoingGroups = forceDisableExcludedPackGroups(
        buildSinglePackGroups(lastPresentationPackId, baseGroups),
        excludedSet,
      );
      const outgoingFullIds = Array.from(getEnabledMapFullLayerIds(outgoingGroups));
      await fadeOutAndRemoveEnabledFullIds(map, outgoingFullIds, crossfadeMs);
      if (!active || disposed || sessionEpoch !== epochAtStart) {
        return;
      }
    }

    // Full projection refresh (curated + WMTS + vector) must run while slideshow is active;
    // the default guard skips remote-driven refreshes — bypass only for this tick.
    if (typeof applyProjectionRefresh === "function") {
      await Promise.resolve(
        applyProjectionRefresh({ fromSlideshowTick: true, groupsOverride: incoming }),
      );
    }
    if (!active || disposed || sessionEpoch !== epochAtStart) {
      return;
    }

    const stageOpts = effectiveTransitionOptions();
    const staged = beginSlideshowStage(map, incoming, stageOpts);
    if (!active || disposed || sessionEpoch !== epochAtStart) {
      return;
    }
    commitSlideshowReveal(map, staged, crossfadeMs);
    if (!active || disposed || sessionEpoch !== epochAtStart) {
      return;
    }
    await Promise.resolve(
      syncProjectionLayers(map, incoming, { applyProjectionHatchPresentation: true }),
    );
    if (!active || disposed || sessionEpoch !== epochAtStart) {
      return;
    }
    if (ordered.length > 0) {
      packIndex = (packIndex + 1) % ordered.length;
      lastPresentationPackId = nextPackId;
    }
  }

  function runTickOrQueue() {
    if (inFlight) {
      queuedAfterCurrent = true;
      return;
    }
    const epoch = sessionEpoch;
    inFlight = true;
    const p = (async () => {
      try {
        await runOneTick(epoch);
      } finally {
        inFlight = false;
        if (active && !disposed && queuedAfterCurrent) {
          queuedAfterCurrent = false;
          runTickOrQueue();
        }
      }
    })();
    runningPromise = p;
    p.finally(() => {
      if (runningPromise === p) {
        runningPromise = null;
      }
    });
  }

  async function stopImpl() {
    sessionEpoch += 1;
    active = false;
    lastPresentationPackId = null;
    clearTimer();
    if (runningPromise) {
      await runningPromise;
    }
  }

  return {
    getSessionEpoch() {
      return sessionEpoch;
    },

    isActive() {
      return active && !disposed;
    },

    shouldSuppressProjectionHighlight() {
      return !disposed && (active || startInProgress);
    },

    start(payload) {
      if (disposed) {
        return;
      }
      if (active) {
        return;
      }
      if (startInProgress) {
        return;
      }
      startInProgress = true;
      merged = mergeSlideshowConfig(baseConfig, payload);
      void (async () => {
        try {
          if (disposed) {
            return;
          }
          const base = await Promise.resolve(getEffectiveLayerGroups());
          if (disposed) {
            return;
          }
          if (active) {
            return;
          }
          const baseGroups = Array.isArray(base) ? base : [];
          if (
            resolveOrderedPackIds(
              baseGroups,
              merged.packOrder,
              merged.excludedPresentationPackIds,
            ).length === 0
          ) {
            return;
          }
          active = true;
          packIndex = 0;
          lastPresentationPackId = null;
          const resolvedIntervalMs =
            typeof merged.intervalMs === "number" && Number.isFinite(merged.intervalMs)
              ? merged.intervalMs
              : 10000;
          const interval = Math.max(1, resolvedIntervalMs);
          runTickOrQueue();
          timerId = setInterval(() => {
            runTickOrQueue();
          }, interval);
        } finally {
          startInProgress = false;
        }
      })();
    },

    stop: stopImpl,

    async dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      await stopImpl();
    },
  };
}
