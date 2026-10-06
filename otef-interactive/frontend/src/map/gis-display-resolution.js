/** Preserve the lab's logical scene layout; render extra pixels on larger screens. */
export function gisLogicalViewport(window = globalThis.window) {
  const scale = Number(window?.document?.body?.dataset.gisDisplayScale) || 1;
  return { width: (window?.innerWidth || 1920) / scale, height: (window?.innerHeight || 1080) / scale, scale };
}

export function mountGisDisplayResolution({ window = globalThis.window, document = globalThis.document } = {}) {
  const body = document?.body;
  if (!body || !window) return { pixelRatio: () => 1, bindMap() {}, dispose() {} };
  const previous = Object.fromEntries(['position', 'width', 'height', 'zoom'].map(key => [key, body.style[key]]));
  const previousScale = body.dataset.gisDisplayScale;
  let map = null;
  let ratio = 1;
  const update = () => {
    const width = window.innerWidth || 1920, height = window.innerHeight || 1080;
    const scale = Math.max(1, Math.min(width / 1920, height / 1080));
    body.dataset.gisDisplayScale = String(scale);
    Object.assign(body.style, { position: 'relative', width: `${width / scale}px`, height: `${height / scale}px`, zoom: String(scale) });
    const nextRatio = Math.min(2, scale * (window.devicePixelRatio || 1));
    if (map && Math.abs(nextRatio - ratio) > 0.001) map.setPixelRatio?.(nextRatio);
    ratio = nextRatio;
  };
  update();
  window.addEventListener('resize', update);
  return {
    pixelRatio: () => ratio,
    bindMap(next) { map = next; },
    dispose() {
      window.removeEventListener('resize', update);
      Object.assign(body.style, previous);
      if (previousScale === undefined) delete body.dataset.gisDisplayScale;
      else body.dataset.gisDisplayScale = previousScale;
      map = null;
    },
  };
}
