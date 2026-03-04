/**
 * Projection animation loop controller.
 *
 * Extracted from projection-layer-manager.js so that the layer manager can
 * focus on data loading and rendering orchestration.
 *
 * This module is intentionally small and depends only on:
 *  - a render callback (CanvasLayerRenderer instance) provided at runtime
 *  - global MapProjectionConfig / OTEFDataContext for configuration/state
 */

let animationLoopHandle = null;
let animationLastFrameMs = 0;
let currentRenderer = null;

/**
 * Configure the renderer used for animation-driven re-renders.
 * @param {{ _scheduleRender?: Function, render?: Function }|null} renderer
 */
function configureAnimationRenderer(renderer) {
  currentRenderer = renderer || null;
}

function hasEnabledAnimations() {
  if (
    typeof OTEFDataContext === "undefined" ||
    !OTEFDataContext ||
    typeof OTEFDataContext.getAnimations !== "function"
  ) {
    return false;
  }
  const animations = OTEFDataContext.getAnimations() || {};
  return Object.values(animations).some((v) => !!v);
}

/**
 * Start the projection animation loop.
 * Safe to call multiple times; subsequent calls are ignored while running.
 */
function startAnimationLoop() {
  if (!currentRenderer) return;
  if (animationLoopHandle) return;

  const projectionAnimCfg =
    typeof MapProjectionConfig !== "undefined" &&
    MapProjectionConfig.PROJECTION_LAYER_ANIMATIONS
      ? MapProjectionConfig.PROJECTION_LAYER_ANIMATIONS
      : null;
  const perfCfg =
    typeof MapProjectionConfig !== "undefined" && MapProjectionConfig.GIS_PERF
      ? MapProjectionConfig.GIS_PERF
      : {};
  const maxFps = Math.max(
    1,
    Number(
      (projectionAnimCfg && projectionAnimCfg.MAX_FPS) ||
        perfCfg.ANIMATION_MAX_FPS,
    ) || 30,
  );
  const minFrameMs = 1000 / maxFps;

  const tick = (nowMs) => {
    if (!hasEnabledAnimations() || !currentRenderer) {
      animationLoopHandle = null;
      return;
    }
    if (nowMs - animationLastFrameMs >= minFrameMs) {
      animationLastFrameMs = nowMs;
      if (typeof currentRenderer._scheduleRender === "function") {
        currentRenderer._scheduleRender();
      } else if (typeof currentRenderer.render === "function") {
        currentRenderer.render();
      }
    }
    animationLoopHandle = requestAnimationFrame(tick);
  };

  animationLoopHandle = requestAnimationFrame(tick);
}

/**
 * Stop the animation loop, if running.
 */
function stopAnimationLoop() {
  if (!animationLoopHandle) return;
  cancelAnimationFrame(animationLoopHandle);
  animationLoopHandle = null;
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", stopAnimationLoop);
}

export { configureAnimationRenderer, startAnimationLoop, stopAnimationLoop };

