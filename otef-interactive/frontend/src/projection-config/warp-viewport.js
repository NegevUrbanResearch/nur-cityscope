export const WARP_OUTPUT_WIDTH = 1920;
export const WARP_OUTPUT_HEIGHT = 1080;

export function fitWarpViewport(viewBox, width, height) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const scale = Math.min(safeWidth / viewBox.width, safeHeight / viewBox.height);
  const insetX = (safeWidth - viewBox.width * scale) / 2;
  const insetY = (safeHeight - viewBox.height * scale) / 2;
  return {
    scale,
    insetX,
    insetY,
    image: {
      left: insetX - viewBox.x * scale,
      top: insetY - viewBox.y * scale,
      width: WARP_OUTPUT_WIDTH * scale,
      height: WARP_OUTPUT_HEIGHT * scale,
    },
  };
}

export function warpPointFromClient(event, rect, viewBox) {
  const mapping = fitWarpViewport(viewBox, rect.width, rect.height);
  return {
    x: viewBox.x + (event.clientX - rect.left - mapping.insetX) / mapping.scale,
    y: viewBox.y + (event.clientY - rect.top - mapping.insetY) / mapping.scale,
  };
}

export function warpMarkerRadius(viewBox, width, height, screenRadius) {
  return screenRadius / fitWarpViewport(viewBox, width, height).scale;
}

export function transformWarpViewBox(viewBox, rect, { from, to = from, factor = 1 } = {}) {
  const finite = (value) => Number.isFinite(value);
  const validPoint = (point) => point && finite(point.clientX) && finite(point.clientY);
  if (
    !viewBox || !finite(viewBox.x) || !finite(viewBox.y) ||
    !finite(viewBox.width) || !finite(viewBox.height) || viewBox.width <= 0 || viewBox.height <= 0 ||
    !rect || !finite(rect.left) || !finite(rect.top) || !finite(rect.width) || !finite(rect.height) ||
    rect.width <= 0 || rect.height <= 0 || !validPoint(from) || !validPoint(to) ||
    !finite(factor) || factor <= 0
  ) return viewBox;

  const scaledView = {
    x: viewBox.x,
    y: viewBox.y,
    width: viewBox.width / factor,
    height: viewBox.height / factor,
  };
  if (!finite(scaledView.width) || !finite(scaledView.height) || scaledView.width <= 0 || scaledView.height <= 0) return viewBox;

  const anchor = warpPointFromClient(from, rect, viewBox);
  const moved = warpPointFromClient(to, rect, scaledView);
  const transformed = {
    ...scaledView,
    x: scaledView.x + anchor.x - moved.x,
    y: scaledView.y + anchor.y - moved.y,
  };
  return finite(transformed.x) && finite(transformed.y) ? transformed : viewBox;
}

export function clampWarpViewBox(viewBox, baseViewBox, { minZoom = 0.5, maxZoom = 8, anchor = null, rect = null } = {}) {
  if (!viewBox || !baseViewBox || !Number.isFinite(viewBox.width) || !Number.isFinite(viewBox.height) || viewBox.width <= 0 || viewBox.height <= 0) return viewBox;
  const zoom = Math.max(minZoom, Math.min(maxZoom, baseViewBox.width / viewBox.width));
  const width = baseViewBox.width / zoom;
  const height = baseViewBox.height / zoom;
  if (anchor && rect && [anchor.clientX, anchor.clientY, rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0) {
    const world = warpPointFromClient(anchor, rect, viewBox);
    const mapping = fitWarpViewport({ x: 0, y: 0, width, height }, rect.width, rect.height);
    return {
      x: world.x - (anchor.clientX - rect.left - mapping.insetX) / mapping.scale,
      y: world.y - (anchor.clientY - rect.top - mapping.insetY) / mapping.scale,
      width,
      height,
    };
  }
  const centerX = viewBox.x + viewBox.width / 2;
  const centerY = viewBox.y + viewBox.height / 2;
  return { x: centerX - width / 2, y: centerY - height / 2, width, height };
}
