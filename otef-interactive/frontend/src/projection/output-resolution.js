export const PROJECTION_RESOLUTIONS = Object.freeze({
  '1080p': Object.freeze({ width: 1920, height: 1080, scale: 1 }),
  '4k': Object.freeze({ width: 3840, height: 2160, scale: 2 }),
});

export function resolveProjectionResolution(search = '') {
  const key = new URLSearchParams(search).get('outputResolution');
  return PROJECTION_RESOLUTIONS[key === '4k' ? '4k' : '1080p'];
}

/** Density for the actual source layout, including fullscreen and Windows scaling. */
export function projectionMapPixelRatio(resolution, container) {
  const width = Number(container?.clientWidth) || 1920;
  const height = Number(container?.clientHeight) || 1080;
  return Math.max(resolution.width / width, resolution.height / height);
}

export function bindProjectionMapResolution({ map, container, resolution, window = globalThis.window }) {
  const update = () => {
    const ratio = projectionMapPixelRatio(resolution, container);
    if (Math.abs((map.getPixelRatio?.() || 0) - ratio) > 0.001) map.setPixelRatio?.(ratio);
  };
  update();
  window?.addEventListener('resize', update);
  return () => window?.removeEventListener('resize', update);
}
