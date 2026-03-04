import { OTEF_API } from "../api-client.js";
import { OTEF_MESSAGE_TYPES } from "../message-protocol.js";
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

async function pan(ctx, direction, delta = 0.15) {
  if (!ctx._tableName || !ctx._isConnected || !direction) return;

  const currentViewport = ctx._viewport;
  let candidateViewport = null;
  if (currentViewport && currentViewport.bbox && currentViewport.bbox.length === 4) {
    candidateViewport = computePanViewport(currentViewport, direction, delta);
  }

  const insideBounds = !candidateViewport || ctx._isViewportInsideBounds(candidateViewport);
  if (candidateViewport && !insideBounds) return;

  try {
    ctx._currentInteractionSource = "remote";
    ctx._lastLocalStateTimestamp = Date.now();
    await OTEF_API.executeCommand(ctx._tableName, {
      action: "pan",
      direction,
      delta,
      sourceId: ctx._clientId,
      timestamp: ctx._lastLocalStateTimestamp,
      base_viewport: ctx._viewport,
    });
  } catch (err) {
    getLogger().error("[OTEFDataContext] Pan command failed:", err);
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
    const dt = Math.min(0.1, (now - ctx._lastVelocityUpdate) / 1000);
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

  try {
    ctx._currentInteractionSource = "remote";
    ctx._lastLocalStateTimestamp = Date.now();
    await OTEF_API.executeCommand(ctx._tableName, {
      action: "zoom",
      level: clampedZoom,
      sourceId: ctx._clientId,
      timestamp: ctx._lastLocalStateTimestamp,
      base_viewport: ctx._viewport,
    });
  } catch (err) {
    getLogger().error("[OTEFDataContext] Zoom command failed:", err);
  } finally {
    ctx._currentInteractionSource = null;
  }
}

function updateViewportFromUI(ctx, viewport, source = "gis") {
  if (!ctx._tableName || !viewport || !viewport.bbox || viewport.bbox.length !== 4) {
    return false;
  }

  if (source === "gis" && (ctx._velocityLoopActive || ctx._currentInteractionSource === "remote")) {
    return { accepted: false, reason: "interaction_guard" };
  }

  if (!ctx._isViewportInsideBounds(viewport)) {
    return { accepted: false, reason: "bounds" };
  }

  ctx._currentInteractionSource = source;
  try {
    const payload = { ...viewport, sourceId: ctx._clientId, timestamp: Date.now() };
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

async function toggleLayerInGroups(ctx, layerId, enabled) {
  const previous = JSON.parse(JSON.stringify(ctx._layerGroups || []));
  const next = previous.map((group) => ({
    ...group,
    layers: group.layers.map((layer) => {
      const fullId = `${group.id}.${layer.id}`;
      if (fullId === layerId) return { ...layer, enabled: !!enabled };
      return layer;
    }),
  }));

  ctx._setLayerGroups(next);
  try {
    await OTEF_API.updateLayerGroups(ctx._tableName, next);
    return { ok: true };
  } catch (err) {
    getLogger().error("[OTEFDataContext] Failed to update layer groups:", err);
    ctx._setLayerGroups(previous);
    return { ok: false, error: err };
  }
}

async function setLayersEnabled(ctx, fullLayerIds, enabled) {
  if (!ctx._tableName || !Array.isArray(fullLayerIds) || fullLayerIds.length === 0) {
    return { ok: true };
  }

  const idSet = new Set(fullLayerIds);
  const previous = JSON.parse(JSON.stringify(ctx._layerGroups || []));
  const next = previous.map((group) => ({
    ...group,
    layers: group.layers.map((layer) => {
      const fullId = `${group.id}.${layer.id}`;
      if (idSet.has(fullId)) return { ...layer, enabled: !!enabled };
      return layer;
    }),
  }));

  ctx._setLayerGroups(next);
  try {
    await OTEF_API.updateLayerGroups(ctx._tableName, next);
    return { ok: true };
  } catch (err) {
    getLogger().error("[OTEFDataContext] Failed to update layer groups:", err);
    ctx._setLayerGroups(previous);
    return { ok: false, error: err };
  }
}

async function toggleGroup(ctx, groupId, enabled) {
  if (!ctx._tableName || !groupId) return { ok: false, error: "Missing groupId" };
  if (!ctx._layerGroups) return { ok: false, error: "Layer groups not available" };

  const previous = JSON.parse(JSON.stringify(ctx._layerGroups || []));
  const next = previous.map((group) => {
    if (group.id !== groupId) return group;
    const layers = group.layers.map((layer) => ({ ...layer, enabled: !!enabled }));
    return { ...group, enabled: !!enabled, layers };
  });

  ctx._setLayerGroups(next);
  try {
    await OTEF_API.updateLayerGroups(ctx._tableName, next);
    return { ok: true };
  } catch (err) {
    getLogger().error("[OTEFDataContext] Failed to update layer groups:", err);
    ctx._setLayerGroups(previous);
    return { ok: false, error: err };
  }
}

async function toggleAnimation(ctx, layerId, enabled) {
  if (!ctx._tableName || !layerId) return { ok: false, error: "Missing layerId" };

  const previous = ctx._animations || {};
  const next = Object.assign({}, previous, { [layerId]: !!enabled });
  ctx._setAnimations(next);

  try {
    await OTEF_API.updateAnimations(ctx._tableName, next);
    return { ok: true };
  } catch (err) {
    getLogger().error("[OTEFDataContext] Failed to update animations:", err);
    ctx._setAnimations(previous);
    return { ok: false, error: err };
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

  try {
    await OTEF_API.updateAnimations(ctx._tableName, next);
    return { ok: true };
  } catch (err) {
    getLogger().error("[OTEFDataContext] Failed to update animations:", err);
    ctx._setAnimations(previous);
    return { ok: false, error: err };
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
