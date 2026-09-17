import { rotateViewerVectorToItm } from "../shared/orientation-transform.js";

const FORCE_DEADZONE = 0.15;
const VELOCITY_THROTTLE_MS = 100;
const DEFAULT_SIZE = 100;

export function getPanSpeedFactorForZoom(zoom) {
  if (!Number.isFinite(zoom)) return 0.32;
  if (zoom >= 18) return 0.16;
  if (zoom >= 17) return 0.2;
  if (zoom >= 16) return 0.24;
  if (zoom >= 15) return 0.28;
  return 0.32;
}

export const DPAD_DIRECTIONS = {
  panNorth: { vx: 0, vy: 1 },
  panSouth: { vx: 0, vy: -1 },
  panEast: { vx: 1, vy: 0 },
  panWest: { vx: -1, vy: 0 },
};

export function computeDpadPanVector({
  vx,
  vy,
  viewport,
  viewerAngleDeg = 0,
} = {}) {
  if (!viewport?.bbox) return { dx: 0, dy: 0 };
  const width = viewport.bbox[2] - viewport.bbox[0];
  const height = viewport.bbox[3] - viewport.bbox[1];
  const speed = getPanSpeedFactorForZoom(Number(viewport.zoom));
  return rotateViewerVectorToItm(
    {
      dx: Number(vx) * width * speed,
      dy: Number(vy) * height * speed,
    },
    -(Number(viewerAngleDeg) || 0),
  );
}

export function createRemoteDpadController({
  root,
  isConnected,
  getViewport,
  getViewerAngleDeg,
  sendVelocity,
  isBlocked,
} = {}) {
  let activeId = null;
  const cleanups = [];

  function connected() {
    return typeof isConnected !== "function" || isConnected();
  }

  function button(id) {
    if (root && typeof root.querySelector === "function") {
      return root.querySelector(`#${id}`);
    }
    return typeof document !== "undefined" ? document.getElementById(id) : null;
  }

  function setEnabled(enabled) {
    const buttons = root?.querySelectorAll?.(".dpad-button")
      || (typeof document !== "undefined" ? document.querySelectorAll(".dpad-button") : []);
    buttons.forEach((el) => {
      el.style.opacity = enabled ? "" : "0.3";
      el.style.pointerEvents = enabled ? "" : "none";
    });
  }

  function start(id, vector, event) {
    event?.preventDefault?.();
    if (!connected() || isBlocked?.() || activeId) return;
    const el = button(id);
    if (!el) return;
    activeId = id;
    el.classList.add("active");
    const viewport = typeof getViewport === "function" ? getViewport() : null;
    const rotated = computeDpadPanVector({
      vx: vector.vx,
      vy: vector.vy,
      viewport,
      viewerAngleDeg: typeof getViewerAngleDeg === "function" ? getViewerAngleDeg() : 0,
    });
    sendVelocity?.(rotated.dx, rotated.dy);
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(20);
  }

  function end() {
    if (!activeId) return;
    button(activeId)?.classList.remove("active");
    activeId = null;
    sendVelocity?.(0, 0);
  }

  function init() {
    destroy();
    Object.entries(DPAD_DIRECTIONS).forEach(([id, vector]) => {
      const el = button(id);
      if (!el) return;
      const onStart = (event) => start(id, vector, event);
      el.addEventListener("touchstart", onStart, { passive: false });
      el.addEventListener("touchend", end, { passive: false });
      el.addEventListener("mousedown", onStart);
      el.addEventListener("mouseup", end);
      el.addEventListener("mouseleave", end);
      cleanups.push(() => {
        el.removeEventListener("touchstart", onStart);
        el.removeEventListener("touchend", end);
        el.removeEventListener("mousedown", onStart);
        el.removeEventListener("mouseup", end);
        el.removeEventListener("mouseleave", end);
      });
    });
  }

  function destroy() {
    end();
    while (cleanups.length) cleanups.pop()?.();
  }

  return { init, destroy, setEnabled, end };
}

export function computeJoystickPanVector({
  force,
  angleRad,
  viewport,
  viewerAngleDeg = 0,
} = {}) {
  const capped = Math.min(Number(force) || 0, 1.5);
  if (capped < FORCE_DEADZONE || !viewport?.bbox) {
    return { dx: 0, dy: 0 };
  }
  const width = viewport.bbox[2] - viewport.bbox[0];
  const height = viewport.bbox[3] - viewport.bbox[1];
  const speed = getPanSpeedFactorForZoom(Number(viewport.zoom));
  return rotateViewerVectorToItm(
    {
      dx: Math.cos(angleRad) * capped * width * speed,
      dy: Math.sin(angleRad) * capped * height * speed,
    },
    -(Number(viewerAngleDeg) || 0),
  );
}

export function createRemoteJoystickController({
  zone,
  nipplejs: nipple,
  isConnected,
  getViewport,
  getViewerAngleDeg,
  sendVelocity,
  onStart,
  onEnd,
  size = DEFAULT_SIZE,
  color = "#1a1a1a",
  restOpacity = 0.6,
} = {}) {
  let manager = null;
  let throttleTimer = null;
  let throttlePending = false;
  let engaged = false;

  function connected() {
    return typeof isConnected !== "function" || isConnected();
  }

  function viewport() {
    return typeof getViewport === "function" ? getViewport() : null;
  }

  function stop(sendZero = false) {
    if (throttleTimer) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }
    throttlePending = false;
    if (sendZero && typeof sendVelocity === "function") sendVelocity(0, 0);
    engaged = false;
  }

  function handleStart() {
    if (!connected()) return;
    engaged = true;
    zone?.classList.add("active");
    onStart?.();
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(20);
    }
  }

  function handleMove(_evt, data) {
    if (!connected() || !data) return;
    const vector = computeJoystickPanVector({
      force: data.force,
      angleRad: data.angle?.radian,
      viewport: viewport(),
      viewerAngleDeg: typeof getViewerAngleDeg === "function" ? getViewerAngleDeg() : 0,
    });
    if (!throttlePending) {
      sendVelocity?.(vector.dx, vector.dy);
      throttlePending = true;
      throttleTimer = setTimeout(() => {
        throttleTimer = null;
        throttlePending = false;
      }, VELOCITY_THROTTLE_MS);
    }
  }

  function handleEnd() {
    zone?.classList.remove("active");
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate(15);
    }
    stop(true);
    onEnd?.();
  }

  function nippleLibrary() {
    return nipple || (typeof globalThis !== "undefined" ? globalThis.nipplejs : null) || null;
  }

  function zoneIsLaidOut() {
    if (typeof zone.getBoundingClientRect !== "function") return true;
    const box = zone.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  }

  function init() {
    const nippleLib = nippleLibrary();
    if (!zone || !nippleLib || typeof nippleLib.create !== "function") return null;
    if (!zoneIsLaidOut()) return null;
    destroy();
    const box = zone.getBoundingClientRect?.();
    const resolvedSize = box
      ? Math.max(40, Math.round(Math.min(box.width, box.height)))
      : size;
    manager = nippleLib.create({
      zone,
      mode: "static",
      position: { left: "50%", top: "50%" },
      color,
      size: resolvedSize,
      threshold: FORCE_DEADZONE,
      fadeTime: 200,
      restOpacity,
    });
    manager.on("start", handleStart);
    manager.on("move", handleMove);
    manager.on("end", handleEnd);
    return manager;
  }

  function destroy() {
    stop(engaged);
    zone?.classList.remove("active");
    if (manager) {
      manager.destroy();
      manager = null;
    }
  }

  return { init, destroy, stop };
}
