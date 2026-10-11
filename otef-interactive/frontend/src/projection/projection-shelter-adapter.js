import { evaluateOpacityExpression } from "../shared/layer-opacity-expression.js";
import { paintShelterArtwork } from "../shared/nli-shelter-artwork.js";
import { SHELTER_BODY_WIDTH, REIM_WEST_SHELTER_ID } from "../shared/nli-shelter-symbol.js";
import { getShelterProjectionFrame, SHELTER_LAYER_ID } from "../shared/maplibre-nli-shelters.js";

/** Draw the existing vector artwork at map texture density, before the shared warp. */
export function createProjectionShelterAdapter({ map, document = globalThis.document,
  getSnapshot = () => getShelterProjectionFrame(map) } = {}) {
  const canvas = document?.createElement?.("canvas");
  const context = canvas?.getContext?.("2d");
  const glyphCanvas = document?.createElement?.("canvas");
  const glyphContext = glyphCanvas?.getContext?.("2d");
  if (!context || !glyphContext) throw new Error("Shelter projection requires a 2D canvas");
  let disposed = false, signature = null, contentVersion = 0;
  function opacityFor(shelter) {
    const value = map.getPaintProperty?.(SHELTER_LAYER_ID, "icon-opacity") ?? 1;
    return evaluateOpacityExpression(value, { shelterId: shelter.id });
  }
  return {
    descriptor(mapDescriptor) {
      const snapshot = getSnapshot();
      const source = mapDescriptor?.source;
      const layer = map.getLayer?.(SHELTER_LAYER_ID);
      const visibility = map.getLayoutProperty?.(SHELTER_LAYER_ID, "visibility") ?? layer?.layout?.visibility;
      if (disposed || !source || !snapshot?.frame?.visible || !layer || visibility === "none") return null;
      const width = source.width, height = source.height;
      const logicalWidth = source.clientWidth || map.getContainer?.()?.clientWidth || width;
      const logicalHeight = source.clientHeight || map.getContainer?.()?.clientHeight || height;
      if (!(width > 0 && height > 0 && logicalWidth > 0 && logicalHeight > 0)) return null;
      const shelters = [...snapshot.frame.shelters].sort((a, b) =>
        Number(a.id === REIM_WEST_SHELTER_ID) - Number(b.id === REIM_WEST_SHELTER_ID));
      const rows = shelters.flatMap(shelter => {
        const placement = snapshot.layout?.get(shelter.id);
        const opacity = opacityFor(shelter);
        if (!(placement?.size > 0 && opacity > 0)) return [];
        const anchor = map.project(shelter.geometry.coordinates);
        const angle = placement.rotationDeg * Math.PI / 180;
        const [dx, dy] = placement.offset.map(value => value * placement.size);
        return [{ id: shelter.id, x: anchor.x + dx * Math.cos(angle) - dy * Math.sin(angle),
          y: anchor.y + dx * Math.sin(angle) + dy * Math.cos(angle),
          size: placement.size, angle, opacity,
          impact: snapshot.colors?.get(shelter.id) ?? Number(snapshot.frame.impactedIds?.has(shelter.id)) }];
      });
      if (!rows.length) return null;
      const nextSignature = JSON.stringify([width, height, logicalWidth, logicalHeight, rows]);
      if (nextSignature !== signature) {
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        context.clearRect(0, 0, width, height);
        context.save();
        const ratioX = width / logicalWidth, ratioY = height / logicalHeight;
        for (const row of rows) {
          // Rasterize after the final size and rotation. The integer-positioned
          // 1:1 copy applies opacity once to the complete icon without resampling.
          const cos = Math.abs(Math.cos(row.angle)), sin = Math.abs(Math.sin(row.angle));
          const halfWidth = row.size * (14 * cos + 12 * sin) * ratioX;
          const halfHeight = row.size * (14 * sin + 12 * cos) * ratioY;
          const left = Math.floor(row.x * ratioX - halfWidth);
          const top = Math.floor(row.y * ratioY - halfHeight);
          glyphCanvas.width = Math.max(1, Math.ceil(row.x * ratioX + halfWidth) - left);
          glyphCanvas.height = Math.max(1, Math.ceil(row.y * ratioY + halfHeight) - top);
          glyphContext.setTransform(ratioX, 0, 0, ratioY, -left, -top);
          glyphContext.globalAlpha = 1;
          glyphContext.translate(row.x, row.y);
          glyphContext.rotate(row.angle);
          glyphContext.scale(row.size, row.size);
          paintShelterArtwork(glyphContext, { cx: 0, cy: 0, bodyWidthPx: SHELTER_BODY_WIDTH,
            impactProgress: row.impact, variant: row.id === REIM_WEST_SHELTER_ID ? "mural" : "normal" });
          context.globalAlpha = row.opacity;
          context.drawImage(glyphCanvas, left, top);
        }
        context.restore();
        signature = nextSignature;
        contentVersion++;
      }
      return { source: canvas, contentVersion, matrix: mapDescriptor.matrix, clip: mapDescriptor.clip,
        opacity: mapDescriptor.opacity };
    },
    dispose() {
      disposed = true;
      context.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}
