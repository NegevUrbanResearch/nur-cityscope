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
