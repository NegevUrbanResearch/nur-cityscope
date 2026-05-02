import { OTEF_API } from "../api-client.js";
import { OTEF_MESSAGE_TYPES } from "../message-protocol.js";
import {
  applyMoreshetParkingCoherenceToLayerGroups,
  ensurePinkLineParkingRowInMoreshetAxisGroup,
} from "../../map-utils/curated-pink-axis-state.js";
import { generateTraceId, recordTraceEvent } from "../otef-trace.js";
import { OTEFDataContextInternals } from "./index.js";

function fallbackLogger() {
  return {
    debug: () => {},
    info: () => {},
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };
}

const getLogger = OTEFDataContextInternals.getLogger || fallbackLogger;
const VELOCITY_STOP_EPSILON = 1e-3;

function layerGroupsEqual(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ga = a[i],
      gb = b[i];
    if (ga === gb) continue;
    if (ga.id !== gb.id || ga.enabled !== gb.enabled) return false;
    const la = ga.layers || [],
      lb = gb.layers || [];
    if (la.length !== lb.length) return false;
    for (let j = 0; j < la.length; j++) {
      if (la[j].id !== lb[j].id || la[j].enabled !== lb[j].enabled) return false;
    }
  }
  return true;
}

function ensureLayerPatchBaseline(ctx) {
  if (ctx._layerPatchLastAcked == null && Array.isArray(ctx._layerGroups)) {
    ctx._layerPatchLastAcked = JSON.parse(JSON.stringify(ctx._layerGroups));
  }
}

function flattenLayerEnabledByFullId(layerGroups) {
  const out = new Map();
  if (!Array.isArray(layerGroups)) return out;
  for (const group of layerGroups) {
    if (!group || typeof group.id !== "string" || !Array.isArray(group.layers)) continue;
    for (const layer of group.layers) {
      if (!layer || (typeof layer.id !== "string" && typeof layer.id !== "number")) continue;
      out.set(`${group.id}.${String(layer.id)}`, !!layer.enabled);
    }
  }
  return out;
}

function buildLayerToggleChanges(previousGroups, nextGroups) {
  const previous = flattenLayerEnabledByFullId(previousGroups);
  const next = flattenLayerEnabledByFullId(nextGroups);
  const changes = [];
  for (const [fullLayerId, enabled] of next.entries()) {
    if (!previous.has(fullLayerId) || previous.get(fullLayerId) !== enabled) {
      changes.push({ full_layer_id: fullLayerId, enabled });
    }
  }
  return changes;
}

async function withLayerPatchMutex(ctx, fn) {
  const prev = ctx._layerPatchMutex || Promise.resolve();
  let releaseNext;
  const gate = new Promise((r) => {
    releaseNext = r;
  });
  ctx._layerPatchMutex = prev.then(() => gate);
  await prev;
  try {
    return await fn();
  } finally {
    releaseNext();
  }
}

/**
 * Sends at most one PATCH at a time; loops while optimistic ctx._layerGroups differs from last ack.
 * Drops stale HTTP results when ctx._layerOpGeneration advanced during the request.
 * If a response is stale, forces another round so we never skip sending the latest intent when the
 * client snapshot happens to shallow-match lastAcked while server state may differ.
 */
async function flushLayerGroupsPatchQueue(ctx) {
  let forceAnotherRound = false;
  while (!layerGroupsEqual(ctx._layerGroups, ctx._layerPatchLastAcked) || forceAnotherRound) {
    forceAnotherRound = false;
    const payload = JSON.parse(JSON.stringify(ctx._layerGroups));
    const changes = buildLayerToggleChanges(ctx._layerPatchLastAcked, payload);
    const sendGen = ctx._layerOpGeneration;
    const traceId = generateTraceId("layer");
    if (changes.length === 0) {
      ctx._layerPatchLastAcked = JSON.parse(JSON.stringify(payload));
      continue;
    }
    try {
      const updated = await OTEF_API.setLayerToggles(ctx._tableName, changes, {
        sourceId: ctx._clientId,
        timestamp: Date.now(),
        traceId,
      });
      if (sendGen !== ctx._layerOpGeneration) {
        forceAnotherRound = true;
        continue;
      }
      if (updated && Array.isArray(updated.layerGroups)) {
        ctx._setLayerGroups(updated.layerGroups);
        ctx._layerPatchLastAcked = JSON.parse(JSON.stringify(updated.layerGroups));
      } else {
        ctx._layerPatchLastAcked = JSON.parse(JSON.stringify(payload));
      }
    } catch (err) {
      getLogger().warn(
        "[OTEFDataContext] Layer command failed; falling back to full layerGroups PATCH",
        err,
      );
      try {
        const updated = await OTEF_API.updateLayerGroups(ctx._tableName, payload, {
          sourceId: ctx._clientId,
          timestamp: Date.now(),
          traceId,
        });
        if (sendGen !== ctx._layerOpGeneration) {
          forceAnotherRound = true;
          continue;
        }
        if (updated && Array.isArray(updated.layerGroups)) {
          ctx._setLayerGroups(updated.layerGroups);
          ctx._layerPatchLastAcked = JSON.parse(JSON.stringify(updated.layerGroups));
        } else {
          ctx._layerPatchLastAcked = JSON.parse(JSON.stringify(payload));
        }
      } catch (fallbackErr) {
        if (sendGen === ctx._layerOpGeneration) {
          ctx._setLayerGroups(JSON.parse(JSON.stringify(ctx._layerPatchLastAcked)));
        }
        throw fallbackErr;
      }
    }
  }
}

async function enqueueLayerGroupsCoalescedFlush(ctx) {
  return withLayerPatchMutex(ctx, () => flushLayerGroupsPatchQueue(ctx));
}

/**
 * Group pack "toggle all" uses the server's set_group_enabled expansion (all layers the API
 * lists for the group) instead of a client-only change diff, so group.enabled and LayerState
 * stay aligned after _recompute_group_enabled_from_states_bulk. Coalesced set_layer_toggles
 * from the diff path can miss extra LayerState/reconciled members and caused flip-back on
 * the bulk checkbox after the first request returned.
 */
async function flushGroupEnabledCommand(ctx, groupId, enabled, traceId) {
  return withLayerPatchMutex(ctx, async () => {
    const sendGen = ctx._layerOpGeneration;
    try {
      const updated = await OTEF_API.setGroupEnabled(ctx._tableName, groupId, enabled, {
        sourceId: ctx._clientId,
        timestamp: Date.now(),
        traceId,
      });
      if (sendGen !== ctx._layerOpGeneration) {
        return;
      }
      if (updated && Array.isArray(updated.layerGroups)) {
        ctx._setLayerGroups(updated.layerGroups);
        ctx._layerPatchLastAcked = JSON.parse(JSON.stringify(updated.layerGroups));
        return;
      }
      const payload = JSON.parse(JSON.stringify(ctx._layerGroups));
      ctx._layerPatchLastAcked = JSON.parse(JSON.stringify(payload));
    } catch (err) {
      getLogger().warn(
        "[OTEFDataContext] set_group_enabled failed; falling back to full layerGroups PATCH",
        err,
      );
      try {
        const updated = await OTEF_API.updateLayerGroups(ctx._tableName, ctx._layerGroups, {
          sourceId: ctx._clientId,
          timestamp: Date.now(),
          traceId,
        });
        if (sendGen !== ctx._layerOpGeneration) {
          return;
        }
        if (updated && Array.isArray(updated.layerGroups)) {
          ctx._setLayerGroups(updated.layerGroups);
          ctx._layerPatchLastAcked = JSON.parse(JSON.stringify(updated.layerGroups));
        } else {
          const payload = JSON.parse(JSON.stringify(ctx._layerGroups));
          ctx._layerPatchLastAcked = JSON.parse(JSON.stringify(payload));
        }
      } catch (fallbackErr) {
        if (sendGen === ctx._layerOpGeneration) {
          ctx._setLayerGroups(JSON.parse(JSON.stringify(ctx._layerPatchLastAcked || [])));
        }
        throw fallbackErr;
      }
    }
  });
}

/** Bump and return generation for this layer-mutation await; stale if later !== ctx._layerOpGeneration after await. */
function nextLayerOpGeneration(ctx) {
  if (typeof ctx._layerOpGeneration !== "number") ctx._layerOpGeneration = 0;
  return ++ctx._layerOpGeneration;
}
const VELOCITY_STALE_MS = 120;

function isVelocityEffectivelyMoving(ctx) {
  if (!ctx || !ctx._velocity) return false;
  const vx = Number(ctx._velocity.vx) || 0;
  const vy = Number(ctx._velocity.vy) || 0;
  const speed = Math.hypot(vx, vy);
  if (speed <= VELOCITY_STOP_EPSILON) return false;

  const ageMs =
    typeof ctx._lastVelocityUpdate === "number"
      ? Date.now() - ctx._lastVelocityUpdate
      : 0;
  return ageMs <= VELOCITY_STALE_MS;
}

// Step 2b: Overlapping rapid remote pan/zoom can interleave awaits; a future mutex may serialize.
async function pan(ctx, direction, delta = 0.15) {
  if (!ctx._tableName || !ctx._isConnected || !direction) return;

  const currentViewport = ctx._viewport;
  let candidateViewport = null;
  if (currentViewport && currentViewport.bbox && currentViewport.bbox.length === 4) {
    candidateViewport = computePanViewport(currentViewport, direction, delta);
  }

  const insideBounds = !candidateViewport || ctx._isViewportInsideBounds(candidateViewport);
  if (candidateViewport && !insideBounds) return;

  let previousViewport;
  try {
    const traceId = generateTraceId("viewport-pan");
    recordTraceEvent(traceId, "remote.pan.start", { direction, delta });
    ctx._currentInteractionSource = "remote";
    ctx._lastLocalStateTimestamp = Date.now();
    previousViewport = ctx._viewport;
    if (candidateViewport) {
      ctx._setViewport({
        ...candidateViewport,
        sourceId: ctx._clientId,
        timestamp: ctx._lastLocalStateTimestamp,
      });
    }
    const result = await OTEF_API.executeCommand(ctx._tableName, {
      action: "pan",
      direction,
      delta,
      sourceId: ctx._clientId,
      timestamp: ctx._lastLocalStateTimestamp,
      base_viewport: previousViewport,
      traceId,
    });
    if (result && result.viewport && result.viewport.bbox && result.viewport.bbox.length === 4) {
      ctx._setViewport({
        ...result.viewport,
        sourceId: ctx._clientId,
        timestamp: ctx._lastLocalStateTimestamp,
      });
    } else if (previousViewport) {
      ctx._setViewport(previousViewport);
    }
  } catch (err) {
    getLogger().error("[OTEFDataContext] Pan command failed:", err);
    if (previousViewport) ctx._setViewport(previousViewport);
  } finally {
    ctx._currentInteractionSource = null;
  }
}

function sendVelocity(ctx, vx, vy) {
  if (!ctx._tableName || !ctx._wsClient || !ctx._wsClient.getConnected()) return;

  const wasMoving = ctx._velocity && (ctx._velocity.vx !== 0 || ctx._velocity.vy !== 0);
  ctx._velocity = { vx, vy };
  const isMoving = vx !== 0 || vy !== 0;

  if (isMoving && !wasMoving) {
    ctx._lastVelocityUpdate = Date.now();
    startVelocityLoop(ctx);
  }
  ctx._lastLocalStateTimestamp = Date.now();

  try {
    ctx._wsClient.send({
      type: OTEF_MESSAGE_TYPES.VELOCITY_UPDATE,
      vx,
      vy,
      sourceId: ctx._clientId,
      timestamp: ctx._lastLocalStateTimestamp,
    });
  } catch (err) {
    getLogger().error("[OTEFDataContext] Velocity update failed:", err);
  }
}

function startVelocityLoop(ctx) {
  if (ctx._velocityLoopActive) return;
  ctx._velocityLoopActive = true;

  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => setTimeout(fn, 16);

  const step = () => {
    if (!ctx._velocity || (ctx._velocity.vx === 0 && ctx._velocity.vy === 0)) {
      ctx._velocityLoopActive = false;
      return;
    }

    const now = Date.now();
    const dt = Math.min(0.05, (now - ctx._lastVelocityUpdate) / 1000);
    ctx._lastVelocityUpdate = now;

    if (ctx._viewport && ctx._viewport.bbox) {
      const [minX, minY, maxX, maxY] = ctx._viewport.bbox;
      const dx = ctx._velocity.vx * dt;
      const dy = ctx._velocity.vy * dt;

      let finalDx = dx;
      let finalDy = dy;
      let canMove = false;

      const fullBbox = [minX + dx, minY + dy, maxX + dx, maxY + dy];
      if (ctx._isViewportInsideBounds({ ...ctx._viewport, bbox: fullBbox })) {
        canMove = true;
      } else {
        const xOnlyBbox = [minX + dx, minY, maxX + dx, maxY];
        if (ctx._isViewportInsideBounds({ ...ctx._viewport, bbox: xOnlyBbox })) {
          finalDy = 0;
          canMove = true;
        } else {
          const yOnlyBbox = [minX, minY + dy, maxX, maxY + dy];
          if (ctx._isViewportInsideBounds({ ...ctx._viewport, bbox: yOnlyBbox })) {
            finalDx = 0;
            canMove = true;
          }
        }
      }

      if (canMove) {
        const finalBbox = [minX + finalDx, minY + finalDy, maxX + finalDx, maxY + finalDy];
        ctx._setViewport({
          ...ctx._viewport,
          bbox: finalBbox,
          corners: {
            sw: { x: finalBbox[0], y: finalBbox[1] },
            se: { x: finalBbox[2], y: finalBbox[1] },
            nw: { x: finalBbox[0], y: finalBbox[3] },
            ne: { x: finalBbox[2], y: finalBbox[3] },
          },
        });
      } else {
        ctx._velocity = { vx: 0, vy: 0 };
        ctx._velocityLoopActive = false;
        return;
      }
    }

    raf(step);
  };

  raf(step);
}

async function zoom(ctx, newZoom) {
  if (!ctx._tableName || !ctx._isConnected || typeof newZoom !== "number") return;

  const clampedZoom = Math.max(10, Math.min(19, newZoom));
  const currentViewport = ctx._viewport;
  let candidateViewport = null;

  if (currentViewport && currentViewport.bbox && currentViewport.bbox.length === 4) {
    candidateViewport = computeZoomViewport(currentViewport, clampedZoom);
  }

  if (candidateViewport && !ctx._isViewportInsideBounds(candidateViewport)) return;

  let previousViewport;
  try {
    const traceId = generateTraceId("viewport-zoom");
    recordTraceEvent(traceId, "remote.zoom.start", { level: clampedZoom });
    ctx._currentInteractionSource = "remote";
    ctx._lastLocalStateTimestamp = Date.now();
    previousViewport = ctx._viewport;
    if (candidateViewport) {
      ctx._setViewport({
        ...candidateViewport,
        sourceId: ctx._clientId,
        timestamp: ctx._lastLocalStateTimestamp,
      });
    }
    const result = await OTEF_API.executeCommand(ctx._tableName, {
      action: "zoom",
      level: clampedZoom,
      sourceId: ctx._clientId,
      timestamp: ctx._lastLocalStateTimestamp,
      base_viewport: previousViewport,
      traceId,
    });
    if (result && result.viewport && result.viewport.bbox && result.viewport.bbox.length === 4) {
      ctx._setViewport({
        ...result.viewport,
        sourceId: ctx._clientId,
        timestamp: ctx._lastLocalStateTimestamp,
      });
    } else if (previousViewport) {
      ctx._setViewport(previousViewport);
    }
  } catch (err) {
    getLogger().error("[OTEFDataContext] Zoom command failed:", err);
    if (previousViewport) ctx._setViewport(previousViewport);
  } finally {
    ctx._currentInteractionSource = null;
  }
}

function updateViewportFromUI(ctx, viewport, source = "gis") {
  if (!ctx._tableName || !viewport || !viewport.bbox || viewport.bbox.length !== 4) {
    return false;
  }

  const remoteInteractionActive = ctx._currentInteractionSource === "remote";
  const movingNow = isVelocityEffectivelyMoving(ctx);
  if (source === "gis" && (remoteInteractionActive || movingNow)) {
    return { accepted: false, reason: "interaction_guard" };
  }

  if (!ctx._isViewportInsideBounds(viewport)) {
    return { accepted: false, reason: "bounds" };
  }

  ctx._currentInteractionSource = source;
  try {
    const now = Date.now();
    const nextViewport = { ...viewport, sourceId: ctx._clientId, timestamp: now };
    const appliedViewport = ctx._setViewport(nextViewport) || ctx._viewport || nextViewport;
    ctx._lastLocalStateTimestamp = now;
    const payload = appliedViewport;
    if (typeof OTEF_API.updateViewportDebounced === "function") {
      OTEF_API.updateViewportDebounced(ctx._tableName, payload);
    } else {
      OTEF_API.updateViewport(ctx._tableName, payload);
    }
    return { accepted: true };
  } catch (err) {
    getLogger().error("[OTEFDataContext] Failed to send viewport update:", err);
  } finally {
    ctx._currentInteractionSource = null;
  }
  return true;
}

async function toggleLayer(ctx, layerId, enabled) {
  if (!ctx._tableName || !layerId) return { ok: false, error: "Missing layerId" };
  const fullLayerId = layerId === "model" ? "projector_base.model_base" : layerId;
  return toggleLayerInGroups(ctx, fullLayerId, enabled);
}

async function toggleLayerInGroups(ctx, layerId, enabled, options = {}) {
  ensureLayerPatchBaseline(ctx);
  const previous = ensurePinkLineParkingRowInMoreshetAxisGroup(
    JSON.parse(JSON.stringify(ctx._layerGroups || [])),
  );
  let next = previous.map((group) => ({
    ...group,
    layers: group.layers.map((layer) => {
      const fullId = `${group.id}.${layer.id}`;
      if (fullId === layerId) return { ...layer, enabled: !!enabled };
      return layer;
    }),
  }));
  next = applyMoreshetParkingCoherenceToLayerGroups(next);

  const traceId =
    options && typeof options.traceId === "string"
      ? options.traceId
      : generateTraceId("layer");
  ctx._setActiveLayerTrace({
    traceId,
    source: "toggleLayerInGroups",
    fullLayerIds: [layerId],
  });
  recordTraceEvent(traceId, "context.layer.optimistic_set", {
    fullLayerIds: [layerId],
    enabled: !!enabled,
  });
  ctx._setLayerGroups(next);
  ctx._pendingLayerOps++;
  const callGen = nextLayerOpGeneration(ctx);
  try {
    await enqueueLayerGroupsCoalescedFlush(ctx);
    if (callGen !== ctx._layerOpGeneration) {
      return { ok: true, stale: true };
    }
    return { ok: true };
  } catch (err) {
    if (callGen !== ctx._layerOpGeneration) {
      return { ok: false, error: err, stale: true };
    }
    getLogger().error("[OTEFDataContext] Failed to update layer groups:", err);
    return { ok: false, error: err };
  } finally {
    ctx._pendingLayerOps--;
    if (typeof ctx._clearActiveLayerTrace === "function") {
      setTimeout(() => ctx._clearActiveLayerTrace(traceId), 1200);
    }
  }
}

/**
 * When layers are turned off, clear persisted animation flags so the remote play
 * button and MapLibre flow state stay aligned with visibility.
 * @param {object} ctx
 * @param {string[]} fullLayerIds
 */
async function clearAnimationsForDisabledLayerIds(ctx, fullLayerIds) {
  const prevAnims = ctx._animations || {};
  let changed = false;
  const nextAnims = Object.assign({}, prevAnims);
  for (const fid of fullLayerIds) {
    if (nextAnims[fid]) {
      nextAnims[fid] = false;
      changed = true;
    }
  }
  if (!changed) return;
  ctx._setAnimations(nextAnims);
  ctx._pendingAnimationOps++;
  try {
    await OTEF_API.updateAnimations(ctx._tableName, nextAnims);
  } catch (err) {
    getLogger().error("[OTEFDataContext] Failed to clear animations after layer hide:", err);
    ctx._setAnimations(prevAnims);
  } finally {
    ctx._pendingAnimationOps--;
  }
}

async function setLayersEnabled(ctx, fullLayerIds, enabled, options = {}) {
  if (!ctx._tableName || !Array.isArray(fullLayerIds) || fullLayerIds.length === 0) {
    return { ok: true };
  }

  ensureLayerPatchBaseline(ctx);
  const idSet = new Set(fullLayerIds);
  const previous = ensurePinkLineParkingRowInMoreshetAxisGroup(
    JSON.parse(JSON.stringify(ctx._layerGroups || [])),
  );
  let next = previous.map((group) => ({
    ...group,
    layers: group.layers.map((layer) => {
      const fullId = `${group.id}.${layer.id}`;
      if (idSet.has(fullId)) return { ...layer, enabled: !!enabled };
      return layer;
    }),
  }));
  next = applyMoreshetParkingCoherenceToLayerGroups(next);

  const traceId =
    options && typeof options.traceId === "string"
      ? options.traceId
      : generateTraceId("layer");
  ctx._setActiveLayerTrace({
    traceId,
    source: "setLayersEnabled",
    fullLayerIds,
  });
  recordTraceEvent(traceId, "context.layer.optimistic_set", {
    fullLayerIds,
    enabled: !!enabled,
  });
  ctx._setLayerGroups(next);
  ctx._pendingLayerOps++;
  const callGen = nextLayerOpGeneration(ctx);
  try {
    await enqueueLayerGroupsCoalescedFlush(ctx);
    if (callGen !== ctx._layerOpGeneration) {
      return { ok: true, stale: true };
    }
    if (!enabled) {
      await clearAnimationsForDisabledLayerIds(ctx, fullLayerIds);
    }
    return { ok: true };
  } catch (err) {
    if (callGen !== ctx._layerOpGeneration) {
      return { ok: false, error: err, stale: true };
    }
    getLogger().error("[OTEFDataContext] Failed to update layer groups:", err);
    return { ok: false, error: err };
  } finally {
    ctx._pendingLayerOps--;
    if (typeof ctx._clearActiveLayerTrace === "function") {
      setTimeout(() => ctx._clearActiveLayerTrace(traceId), 1200);
    }
  }
}

async function toggleGroup(ctx, groupId, enabled) {
  if (!ctx._tableName || !groupId) return { ok: false, error: "Missing groupId" };
  if (!ctx._layerGroups) return { ok: false, error: "Layer groups not available" };

  ensureLayerPatchBaseline(ctx);
  const previous = ensurePinkLineParkingRowInMoreshetAxisGroup(
    JSON.parse(JSON.stringify(ctx._layerGroups || [])),
  );
  let next = previous.map((group) => {
    if (group.id !== groupId) return group;
    const layers = group.layers.map((layer) => ({ ...layer, enabled: !!enabled }));
    return { ...group, enabled: !!enabled, layers };
  });
  next = applyMoreshetParkingCoherenceToLayerGroups(next);

  const traceId = generateTraceId("group");
  ctx._setActiveLayerTrace({
    traceId,
    source: "toggleGroup",
    fullLayerIds: [`${groupId}.*`],
  });
  recordTraceEvent(traceId, "context.group.optimistic_set", {
    groupId,
    enabled: !!enabled,
  });
  ctx._setLayerGroups(next);
  ctx._pendingLayerOps++;
  const callGen = nextLayerOpGeneration(ctx);
  try {
    await flushGroupEnabledCommand(ctx, groupId, enabled, traceId);
    if (callGen !== ctx._layerOpGeneration) {
      return { ok: true, stale: true };
    }
    return { ok: true };
  } catch (err) {
    if (callGen !== ctx._layerOpGeneration) {
      return { ok: false, error: err, stale: true };
    }
    getLogger().error("[OTEFDataContext] Failed to update layer groups:", err);
    return { ok: false, error: err };
  } finally {
    ctx._pendingLayerOps--;
    if (typeof ctx._clearActiveLayerTrace === "function") {
      setTimeout(() => ctx._clearActiveLayerTrace(traceId), 1200);
    }
  }
}

async function toggleAnimation(ctx, layerId, enabled) {
  if (!ctx._tableName || !layerId) return { ok: false, error: "Missing layerId" };

  const previous = ctx._animations || {};
  const next = Object.assign({}, previous, { [layerId]: !!enabled });
  ctx._setAnimations(next);

  ctx._pendingAnimationOps++;
  try {
    await OTEF_API.updateAnimations(ctx._tableName, next);
    return { ok: true };
  } catch (err) {
    getLogger().error("[OTEFDataContext] Failed to update animations:", err);
    ctx._setAnimations(previous);
    return { ok: false, error: err };
  } finally {
    ctx._pendingAnimationOps--;
  }
}

async function setLayerAnimations(ctx, fullLayerIds, enabled) {
  if (!ctx._tableName || !Array.isArray(fullLayerIds) || fullLayerIds.length === 0) {
    return { ok: true };
  }

  const previous = Object.assign({}, ctx._animations || {});
  const next = Object.assign({}, previous);
  for (const id of fullLayerIds) next[id] = !!enabled;
  ctx._setAnimations(next);

  ctx._pendingAnimationOps++;
  try {
    await OTEF_API.updateAnimations(ctx._tableName, next);
    return { ok: true };
  } catch (err) {
    getLogger().error("[OTEFDataContext] Failed to update animations:", err);
    ctx._setAnimations(previous);
    return { ok: false, error: err };
  } finally {
    ctx._pendingAnimationOps--;
  }
}

function understandDirection(direction, delta, width, height) {
  let dx = 0;
  let dy = 0;
  if (direction.indexOf("north") !== -1) dy = height * delta;
  if (direction.indexOf("south") !== -1) dy = -height * delta;
  if (direction.indexOf("east") !== -1) dx = width * delta;
  if (direction.indexOf("west") !== -1) dx = -width * delta;
  return { dx, dy };
}

function computePanViewport(viewport, direction, delta) {
  const bbox = viewport && viewport.bbox;
  if (!bbox || bbox.length !== 4) return viewport;

  const [minX, minY, maxX, maxY] = bbox;
  const width = maxX - minX;
  const height = maxY - minY;
  const { dx, dy } = understandDirection(direction, delta, width, height);
  const newBbox = [minX + dx, minY + dy, maxX + dx, maxY + dy];

  return {
    ...viewport,
    bbox: newBbox,
    corners: {
      sw: { x: newBbox[0], y: newBbox[1] },
      se: { x: newBbox[2], y: newBbox[1] },
      nw: { x: newBbox[0], y: newBbox[3] },
      ne: { x: newBbox[2], y: newBbox[3] },
    },
  };
}

function computeZoomViewport(viewport, newZoom) {
  const bbox = viewport && viewport.bbox;
  const currentZoom = (viewport && viewport.zoom) || 15;

  if (!bbox || bbox.length !== 4) {
    return { ...viewport, zoom: newZoom };
  }

  const [minX, minY, maxX, maxY] = bbox;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const zoomDiff = newZoom - currentZoom;
  const scaleFactor = Math.pow(2, -zoomDiff);
  const halfWidth = ((maxX - minX) / 2) * scaleFactor;
  const halfHeight = ((maxY - minY) / 2) * scaleFactor;

  const newBbox = [
    centerX - halfWidth,
    centerY - halfHeight,
    centerX + halfWidth,
    centerY + halfHeight,
  ];

  return {
    ...viewport,
    bbox: newBbox,
    zoom: newZoom,
    corners: {
      sw: { x: newBbox[0], y: newBbox[1] },
      se: { x: newBbox[2], y: newBbox[1] },
      nw: { x: newBbox[0], y: newBbox[3] },
      ne: { x: newBbox[2], y: newBbox[3] },
    },
  };
}

OTEFDataContextInternals.actions = {
  pan,
  sendVelocity,
  startVelocityLoop,
  zoom,
  updateViewportFromUI,
  toggleLayer,
  toggleLayerInGroups,
  setLayersEnabled,
  toggleGroup,
  toggleAnimation,
  setLayerAnimations,
  computePanViewport,
  computeZoomViewport,
};

export {
  pan,
  sendVelocity,
  startVelocityLoop,
  zoom,
  updateViewportFromUI,
  toggleLayer,
  toggleLayerInGroups,
  setLayersEnabled,
  toggleGroup,
  toggleAnimation,
  setLayerAnimations,
  computePanViewport,
  computeZoomViewport,
};
