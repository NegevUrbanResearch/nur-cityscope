import { formatPinkNodeLabel } from "../map-utils/advanced-style-drawing.js";
import { readPinkNodeOrder } from "../map-utils/pink-node-order.js";

function projectionLabelSizeScale() {
  if (
    typeof MapProjectionConfig !== "undefined" &&
    MapProjectionConfig &&
    typeof MapProjectionConfig.LABEL_SIZE_SCALE === "number"
  ) {
    return MapProjectionConfig.LABEL_SIZE_SCALE;
  }
  return 1;
}

/**
 * Visit-order integers on detour point markers (labels canvas).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<[string, object]>} aboveLayerEntries
 * @param {(coord: number[]) => { x: number; y: number }} coordToPixel
 */
export function drawPinkNodeOrderLabels(ctx, aboveLayerEntries, coordToPixel) {
  if (!ctx || typeof coordToPixel !== "function") return;
  const labelScale = projectionLabelSizeScale();
  const sizePx = Math.max(10, 44 * labelScale);
  ctx.save();
  ctx.font = `700 ${sizePx}px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const [, layer] of aboveLayerEntries) {
    if (!layer.visible || !layer.geojson?.features) continue;
    for (const feature of layer.geojson.features) {
      const geom = feature.geometry;
      if (!geom || geom.type !== "Point" || !Array.isArray(geom.coordinates)) continue;
      const ord = readPinkNodeOrder(feature.properties || {});
      if (ord == null) continue;
      const text = formatPinkNodeLabel(ord);
      if (!text) continue;
      const p = coordToPixel(geom.coordinates);
      ctx.lineWidth = Math.max(1.5, sizePx * 0.2);
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.strokeText(text, p.x, p.y);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(text, p.x, p.y);
    }
  }
  ctx.restore();
}
