export const OTEF_MESSAGE_TYPES = {
  VIEWPORT_UPDATE: "otef_viewport_update",
  VIEWPORT_CONTROL: "otef_viewport_control",
  VELOCITY_UPDATE: "otef_velocity_update",
  LAYER_UPDATE: "otef_layer_update",
  ANIMATION_TOGGLE: "otef_animation_toggle",
  VIEWPORT_CHANGED: "otef_viewport_changed",
  LAYERS_CHANGED: "otef_layers_changed",
  ANIMATION_CHANGED: "otef_animation_changed",
  BOUNDS_CHANGED: "otef_bounds_changed",
  VELOCITY_SYNC: "otef_velocity_sync",
};

export const DEFAULT_LAYER_STATES = {
  model: false,
};

export function validateMessage(msg) {
  if (!msg || typeof msg !== "object") return false;
  if (!msg.type || !Object.values(OTEF_MESSAGE_TYPES).includes(msg.type)) return false;
  return true;
}

export function validateViewportControl(msg) {
  if (!validateMessage(msg)) return false;
  if (msg.type !== OTEF_MESSAGE_TYPES.VIEWPORT_CONTROL) return false;

  if (msg.pan && typeof msg.pan === "object") {
    if (typeof msg.pan.direction !== "string" || typeof msg.pan.delta !== "number") {
      return false;
    }
  } else if (typeof msg.zoom !== "number") {
    return false;
  }

  return true;
}

export function validateLayerUpdate(msg) {
  if (!validateMessage(msg)) return false;
  if (msg.type !== OTEF_MESSAGE_TYPES.LAYER_UPDATE) return false;
  if (!msg.layers || typeof msg.layers !== "object") return false;

  const validLayers = ["model"];
  for (const key in msg.layers) {
    if (!validLayers.includes(key)) return false;
    if (typeof msg.layers[key] !== "boolean") return false;
  }
  return true;
}

export function validateViewportUpdate(msg) {
  if (!validateMessage(msg)) return false;
  if (msg.type !== OTEF_MESSAGE_TYPES.VIEWPORT_UPDATE) return false;

  if (msg.bbox) {
    if (!Array.isArray(msg.bbox) || msg.bbox.length !== 4) return false;
  } else if (msg.corners) {
    if (typeof msg.corners !== "object") return false;
    const requiredCorners = ["sw", "se", "nw", "ne"];
    for (const corner of requiredCorners) {
      const p = msg.corners[corner];
      if (!p || typeof p.x !== "number" || typeof p.y !== "number") return false;
    }
  } else {
    return false;
  }

  if (msg.zoom !== undefined && typeof msg.zoom !== "number") return false;
  return true;
}

export function createPanControlMessage(direction, delta = 0.15, sourceId = null) {
  return {
    type: OTEF_MESSAGE_TYPES.VIEWPORT_CONTROL,
    pan: { direction, delta },
    sourceId,
    timestamp: Date.now(),
  };
}

export function createZoomControlMessage(zoom) {
  return {
    type: OTEF_MESSAGE_TYPES.VIEWPORT_CONTROL,
    zoom,
    timestamp: Date.now(),
  };
}

export function createLayerUpdateMessage(layers) {
  return {
    type: OTEF_MESSAGE_TYPES.LAYER_UPDATE,
    layers: { ...layers },
    timestamp: Date.now(),
  };
}

export function createVelocityUpdateMessage(velocity, sourceId = null) {
  return {
    type: OTEF_MESSAGE_TYPES.VELOCITY_UPDATE,
    vx: velocity.vx || 0,
    vy: velocity.vy || 0,
    sourceId,
    timestamp: Date.now(),
  };
}

export function createViewportUpdateMessage(viewport, sourceId = null) {
  return {
    type: OTEF_MESSAGE_TYPES.VIEWPORT_UPDATE,
    viewport: { ...viewport },
    sourceId,
    timestamp: Date.now(),
  };
}

export function validateAnimationToggle(msg) {
  if (!validateMessage(msg)) return false;
  if (msg.type !== OTEF_MESSAGE_TYPES.ANIMATION_TOGGLE) return false;
  if (typeof msg.layerId !== "string") return false;
  if (typeof msg.enabled !== "boolean") return false;
  return true;
}

export function createAnimationToggleMessage(layerId, enabled) {
  return {
    type: OTEF_MESSAGE_TYPES.ANIMATION_TOGGLE,
    layerId,
    enabled,
    timestamp: Date.now(),
  };
}

if (typeof window !== "undefined") {
  window.OTEF_MESSAGE_TYPES = OTEF_MESSAGE_TYPES;
  window.DEFAULT_LAYER_STATES = DEFAULT_LAYER_STATES;
}
