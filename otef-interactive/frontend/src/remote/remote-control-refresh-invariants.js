/**
 * Full UI sync (viewport, connection, curated layer state) reapplies default styles on
 * pan/zoom/layer controls. When the joystick is active, the dpad is transiently
 * disabled — callers must re-apply that lock after any such refresh.
 *
 * @param {null | "dpad" | "joystick"} activeControl
 * @returns {boolean}
 */
export function shouldReapplyDpadAfterFullControlRefresh(activeControl) {
  return activeControl === "joystick";
}
