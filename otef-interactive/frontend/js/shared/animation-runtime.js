function defaultNowProvider() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function createAnimationRuntime(nowProvider = defaultNowProvider) {
  const speeds = new Map();
  let now = nowProvider;

  return {
    setSpeed(layerId, pxPerSec) {
      speeds.set(layerId, Number(pxPerSec) || 0);
    },
    getPhasePx(layerId) {
      const speed = speeds.get(layerId) || 0;
      return (now() / 1000) * speed;
    },
    _setNowProvider(nextProvider) {
      now = nextProvider || defaultNowProvider;
    },
  };
}

const animationRuntime = createAnimationRuntime();

if (typeof window !== "undefined") {
  window.AnimationRuntime = animationRuntime;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createAnimationRuntime,
    animationRuntime,
  };
}
