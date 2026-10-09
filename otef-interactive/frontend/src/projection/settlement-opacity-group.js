const PAINT_PROPERTIES = ['font', 'direction', 'textAlign', 'textBaseline', 'fillStyle', 'strokeStyle', 'lineWidth', 'lineJoin', 'lineCap'];

/** Fade overlapping strokes as one image so their opacity cannot accumulate. */
export function paintSettlementOpacityGroup(context, { document, bounds, alpha, rasterScale = 1, paint }) {
  if (alpha <= 0) return;
  context.save();
  context.globalAlpha = alpha;
  if (alpha === 1) {
    paint(context);
  } else {
    const tile = document.createElement('canvas');
    const left = Math.floor(bounds.left * rasterScale) / rasterScale;
    const top = Math.floor(bounds.top * rasterScale) / rasterScale;
    tile.width = Math.max(1, Math.ceil((bounds.right - left) * rasterScale));
    tile.height = Math.max(1, Math.ceil((bounds.bottom - top) * rasterScale));
    const tileContext = tile.getContext('2d');
    if (!tileContext) throw new Error('Settlement opacity canvas 2D context is unavailable');
    for (const property of PAINT_PROPERTIES) tileContext[property] = context[property];
    tileContext.setTransform(rasterScale, 0, 0, rasterScale, -left * rasterScale, -top * rasterScale);
    paint(tileContext);
    context.drawImage(tile, left, top, tile.width / rasterScale, tile.height / rasterScale);
  }
  context.restore();
}
