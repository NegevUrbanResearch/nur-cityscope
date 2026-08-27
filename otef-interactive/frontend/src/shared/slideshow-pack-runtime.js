import {
  beginSlideshowStage,
  commitSlideshowReveal,
  fadeOutAndRemoveEnabledFullIds,
  getEnabledMapFullLayerIds,
} from "../map/maplibre-layer-manager.js";
import {
  INVESTIGATION_ALARMS_FULL_ID,
  INVESTIGATION_LINES_FULL_ID,
  INVESTIGATION_POLYGONS_FULL_ID,
} from "./maplibre-investigation-timeline.js";
import MapProjectionConfig from "./map-projection-config.js";

const SLIDESHOW_RETAINED_SOURCE_LIMIT = 2;

const SETTLEMENT_NAME_LAYER_IDS = new Set(["שמות_יישובים", "Locations_Lines", "ישובים"]);
const SETTLEMENT_NAME_FULL_IDS = new Set([
  "projector_base.שמות_יישובים",
  "projector_base.Locations_Lines",
  "projector_base.ישובים",
]);

/**
 * @param {import("./map-projection-config.js").MapProjectionConfig["PROJECTION_SLIDESHOW"] | {
 *   intervalMs?: number,
 *   crossfadeMs?: number,
 *   warmupLeadMs?: number,
 *   packOrder?: string[],
 *   excludedPresentationPackIds?: string[],
 *   keepSettlementNames?: boolean,
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
    keepSettlementNames: Object.prototype.hasOwnProperty.call(p, "keepSettlementNames")
      ? p.keepSettlementNames === true
      : base.keepSettlementNames === true,
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
 * @param {object | null | undefined} layer
 * @returns {boolean}
 */
function layerIsSettlementName(layer) {
  if (!layer) {
    return false;
  }
  if (SETTLEMENT_NAME_LAYER_IDS.has(String(layer.id))) {
    return true;
  }
  const extras = Array.isArray(layer.fullLayerIds) ? layer.fullLayerIds : [];
  return extras.some((id) => SETTLEMENT_NAME_FULL_IDS.has(String(id)));
}

/**
 * Re-enables (or keeps off) settlement names and outlines after excluded packs are force-disabled.
 * Other `projector_base` layers stay off.
 *
 * @param {object[]} incoming
 * @param {boolean} keepOn
 * @returns {object[]}
 */
function applySettlementNamesVisibility(incoming, keepOn) {
  const enabled = keepOn === true;
  const groups = Array.isArray(incoming) ? incoming : [];
  return groups.map((g) => {
    if (!g || String(g.id) !== "projector_base") {
      return g;
    }
    const layers = (g.layers || []).map((layer) => {
      if (!layerIsSettlementName(layer)) {
        return layer;
      }
      return { ...layer, enabled };
    });
    return { ...g, layers };
  });
}

/**
 * Build the layer-group payload for one slideshow tick.
 * Empty/unknown `packId` disables every pack layer, then re-applies keep-on overlays.
 *
 * @param {string} packId
 * @param {object[]} baseGroups
 * @param {{
 *   excludedPresentationPackIds?: string[],
 *   keepSettlementNames?: boolean,
 * }} [options]
 * @returns {object[]}
 */
export function buildSlideshowIncomingGroups(packId, baseGroups, options = {}) {
  const excludedSet = excludedPresentationPackIdSet(options.excludedPresentationPackIds);
  return applySettlementNamesVisibility(
    forceDisableExcludedPackGroups(buildSinglePackGroups(packId, baseGroups), excludedSet),
    options.keepSettlementNames === true,
  );
}

/**
 * Overlay controllers (investigation timeline, route progress) must not read live GIS
 * state while presentation is active — that is how NLI/alarms leak through other packs.
 *
 * @param {{
 *   presentationActive?: boolean,
 *   incomingGroups?: object[] | null,
 *   liveGroups?: unknown,
 *   keepSettlementNames?: boolean,
 *   excludedPresentationPackIds?: string[],
 * }} [opts]
 * @returns {object[]}
 */
export function resolvePresentationOverlayVisibility({
  presentationActive,
  incomingGroups,
  liveGroups,
  keepSettlementNames,
  excludedPresentationPackIds,
} = {}) {
  const live = Array.isArray(liveGroups)
    ? liveGroups
    : liveGroups && typeof liveGroups === "object"
      ? Object.values(liveGroups)
      : [];
  if (!presentationActive) {
    return live;
  }
  if (Array.isArray(incomingGroups)) {
    return incomingGroups;
  }
  return buildSlideshowIncomingGroups("", live, {
    keepSettlementNames,
    excludedPresentationPackIds,
  });
}

/**
 * Presentation shows NLI as a static/idle pack. Timeline playback stays off for every tick.
 *
 * @param {Record<string, unknown> | null | undefined} animState
 * @param {boolean} shouldSuppress
 * @returns {Record<string, unknown>}
 */
export function suppressInvestigationPlayback(animState, shouldSuppress) {
  const next = animState && typeof animState === "object" ? { ...animState } : {};
  if (!shouldSuppress) {
    return next;
  }
  next[INVESTIGATION_POLYGONS_FULL_ID] = false;
  next[INVESTIGATION_LINES_FULL_ID] = false;
  next[INVESTIGATION_ALARMS_FULL_ID] = false;
  return next;
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
 *     layerStyleOptions?: object,
 *   }) => unknown) | ((opts?: object) => Promise<unknown>),
 *   syncPresentationOverlays?: (groups: object[]) => unknown,
 *   map?: object | null,
 * }} deps
 * @returns {{
 *   start: (payload?: object) => void,
 *   stop: () => Promise<void>,
 *   dispose: () => Promise<void>,
 *   isActive: () => boolean,
 *   shouldSuppressProjectionHighlight: () => boolean,
 *   getLastIncomingGroups: () => object[] | null,
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
    syncPresentationOverlays,
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
  /** @type {object[] | null} */
  let lastIncomingGroups = null;

  let merged = mergeSlideshowConfig(baseConfig, {});

  function rememberIncomingGroups(groups) {
    lastIncomingGroups = groups;
    if (typeof syncPresentationOverlays === "function") {
      try {
        void Promise.resolve(syncPresentationOverlays(groups));
      } catch {
        // Overlay sync must not break pack rotation.
      }
    }
  }

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
      lifecycle: {
        retainDisabled: true,
        maxRetainedSources: SLIDESHOW_RETAINED_SOURCE_LIMIT,
      },
      transition: { stageHidden: true, transitionMs: crossfadeMs },
    };
  }

  function effectiveRefreshLayerStyleOptions() {
    const { transition: _transition, ...refreshOptions } = effectiveTransitionOptions();
    return refreshOptions;
  }

  /**
   * @param {string} packId
   * @param {object[]} baseGroups
   * @returns {object[]}
   */
  function buildIncomingGroups(packId, baseGroups) {
    return buildSlideshowIncomingGroups(packId, baseGroups, {
      excludedPresentationPackIds: merged.excludedPresentationPackIds,
      keepSettlementNames: merged.keepSettlementNames === true,
    });
  }

  /**
   * Apply keep-settlement-names (or pack options) to the currently visible pack
   * without advancing the slideshow.
   * @param {number} epochAtStart
   */
  async function refreshVisiblePack(epochAtStart) {
    if (!active || disposed || sessionEpoch !== epochAtStart || lastPresentationPackId == null) {
      return;
    }
    const base = await Promise.resolve(getEffectiveLayerGroups());
    if (!active || disposed || sessionEpoch !== epochAtStart || lastPresentationPackId == null) {
      return;
    }
    const baseGroups = Array.isArray(base) ? base : [];
    const incoming = buildIncomingGroups(lastPresentationPackId, baseGroups);
    rememberIncomingGroups(incoming);
    if (typeof applyProjectionRefresh === "function") {
      await Promise.resolve(
        applyProjectionRefresh({
          fromSlideshowTick: true,
          groupsOverride: incoming,
          affectedCuratedFullLayerIds: Array.from(getEnabledMapFullLayerIds(incoming)).filter(
            (id) => id.startsWith("curated"),
          ),
          layerStyleOptions: effectiveRefreshLayerStyleOptions(),
        }),
      );
    } else {
      await Promise.resolve(
        syncProjectionLayers(map, incoming, effectiveRefreshLayerStyleOptions()),
      );
    }
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
    const incoming = buildIncomingGroups(nextPackId, baseGroups);
    rememberIncomingGroups(incoming);

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
      await fadeOutAndRemoveEnabledFullIds(
        map,
        outgoingFullIds,
        crossfadeMs,
        effectiveRefreshLayerStyleOptions(),
      );
      if (!active || disposed || sessionEpoch !== epochAtStart) {
        return;
      }
    }

    const stageOpts = effectiveTransitionOptions();
    const staged = beginSlideshowStage(map, incoming, stageOpts);
    if (!active || disposed || sessionEpoch !== epochAtStart) {
      return;
    }
    // Refresh while staged layers are still hidden so reveal is the final visible step.
    if (typeof applyProjectionRefresh === "function") {
      await Promise.resolve(
        applyProjectionRefresh({
          fromSlideshowTick: true,
          groupsOverride: incoming,
          affectedCuratedFullLayerIds: Array.from(getEnabledMapFullLayerIds(incoming)).filter(
            (id) => id.startsWith("curated"),
          ),
          layerStyleOptions: effectiveRefreshLayerStyleOptions(),
        }),
      );
    } else {
      await Promise.resolve(
        syncProjectionLayers(map, incoming, effectiveRefreshLayerStyleOptions()),
      );
    }
    if (!active || disposed || sessionEpoch !== epochAtStart) {
      return;
    }
    commitSlideshowReveal(map, staged, crossfadeMs);
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
    lastIncomingGroups = null;
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

    getLastIncomingGroups() {
      return lastIncomingGroups;
    },

    start(payload) {
      if (disposed) {
        return;
      }
      merged = mergeSlideshowConfig(baseConfig, payload);
      if (active) {
        if (!inFlight && lastPresentationPackId) {
          const epoch = sessionEpoch;
          void refreshVisiblePack(epoch);
        }
        return;
      }
      if (startInProgress) {
        return;
      }
      startInProgress = true;
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
          rememberIncomingGroups(buildIncomingGroups("", baseGroups));
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
