/**
 * Projection page lab shortcuts (H/A help, L labels, E clock, …).
 * Parsed independently of focus so clock-debug <input> fields cannot swallow them.
 */

export const PROJECTION_LAB_CHROME_Z_INDEX = 1100;

/**
 * @typedef {"help" | "fullscreen" | "bounds" | "rotation" | "renderDebug" | "labelDebug" | "explainerDebug"} ProjectionDisplayHotkeyAction
 */

/**
 * @param {KeyboardEvent | { key?: string, defaultPrevented?: boolean, repeat?: boolean, ctrlKey?: boolean, metaKey?: boolean, altKey?: boolean }} event
 * @returns {ProjectionDisplayHotkeyAction | null}
 */
export function readProjectionDisplayHotkey(event) {
  if (!event || event.defaultPrevented || event.repeat) return null;
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const key = String(event.key || "").toLowerCase();
  switch (key) {
    case "h":
    case "a":
      return "help";
    case "f":
      return "fullscreen";
    case "b":
      return "bounds";
    case "r":
      return "rotation";
    case "d":
      return "renderDebug";
    case "l":
      return "labelDebug";
    case "e":
      return "explainerDebug";
    default:
      return null;
  }
}

/**
 * @param {ProjectionDisplayHotkeyAction | null} action
 * @param {{
 *   toggleHelp?: () => void,
 *   toggleFullscreen?: () => void,
 *   toggleBounds?: () => void,
 *   toggleRotation?: () => void,
 *   toggleRenderDebug?: () => void,
 *   toggleLabelDebug?: () => void,
 *   toggleExplainerDebug?: () => void,
 * }} handlers
 * @returns {boolean}
 */
export function dispatchProjectionDisplayHotkey(action, handlers) {
  if (!action || !handlers) return false;
  switch (action) {
    case "help":
      handlers.toggleHelp?.();
      return true;
    case "fullscreen":
      handlers.toggleFullscreen?.();
      return true;
    case "bounds":
      handlers.toggleBounds?.();
      return true;
    case "rotation":
      handlers.toggleRotation?.();
      return true;
    case "renderDebug":
      handlers.toggleRenderDebug?.();
      return true;
    case "labelDebug":
      handlers.toggleLabelDebug?.();
      return true;
    case "explainerDebug":
      handlers.toggleExplainerDebug?.();
      return true;
    default: {
      const _exhaustive = action;
      void _exhaustive;
      return false;
    }
  }
}
