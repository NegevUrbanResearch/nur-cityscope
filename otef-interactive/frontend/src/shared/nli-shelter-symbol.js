/** One concrete shelter glyph for map sprites and both existing legends. */
import { NLI_VISUAL_TOKENS } from "./nli-investigation-theme.js";
export const SHELTER_BODY_WIDTH = 24;
export const SHELTER_BODY_RATIO = 0.78;

export function shelterImageSpec(pixelRatio = 2) {
  return {
    width: 28 * pixelRatio,
    height: 24 * pixelRatio,
    pixelRatio,
    logicalWidth: 28,
    logicalHeight: 24,
    bodyWidth: 24,
    bodyBounds: {
      x: 2,
      y: (24 - 24 * SHELTER_BODY_RATIO) / 2,
      width: 24,
      height: 24 * SHELTER_BODY_RATIO,
    },
    anchor: "center",
  };
}

export function paintShelterSymbol(
  ctx,
  {
    cx,
    cy,
    bodyWidthPx,
    bodyColor = NLI_VISUAL_TOKENS.annotationInk,
    separatorPx = 1,
  },
) {
  const w = bodyWidthPx,
    h = w * SHELTER_BODY_RATIO,
    left = cx - w / 2,
    top = cy - h / 2;
  const edge = Math.min(w * 0.09, separatorPx);
  ctx.fillStyle = NLI_VISUAL_TOKENS.annotationHalo;
  ctx.fillRect(left, top, w, w * 0.16);
  ctx.fillRect(left + w * 0.06, top + w * 0.12, w * 0.88, h - w * 0.12);
  ctx.fillStyle = bodyColor;
  ctx.fillRect(left + edge, top + edge, w - edge * 2, w * 0.16 - edge * 2);
  ctx.fillRect(
    left + w * 0.06 + edge,
    top + w * 0.16,
    w * 0.88 - edge * 2,
    h - w * 0.16 - edge,
  );
  ctx.fillStyle = NLI_VISUAL_TOKENS.annotationHalo;
  ctx.fillRect(cx - w * 0.15, top + h - w * 0.43, w * 0.3, w * 0.43);
}

export function shelterSymbolCanvas(
  bodyColor = NLI_VISUAL_TOKENS.annotationInk,
  pixelRatio = 2,
) {
  const spec = shelterImageSpec(pixelRatio),
    canvas = globalThis.document?.createElement?.("canvas");
  if (!canvas) throw new Error("Shelter symbols require canvas support");
  canvas.width = spec.width;
  canvas.height = spec.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Shelter symbols require a 2D context");
  ctx.scale(pixelRatio, pixelRatio);
  paintShelterSymbol(ctx, {
    cx: spec.logicalWidth / 2,
    cy: spec.logicalHeight / 2,
    bodyWidthPx: spec.bodyWidth,
    bodyColor,
    separatorPx: 1,
  });
  return canvas;
}

export function shelterSymbolImage(bodyColor) {
  const canvas = shelterSymbolCanvas(bodyColor),
    ctx = canvas.getContext("2d");
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

let legendDataUrl;
export function shelterSymbolDataUrl() {
  if (!legendDataUrl) legendDataUrl = shelterSymbolCanvas().toDataURL();
  return legendDataUrl;
}
