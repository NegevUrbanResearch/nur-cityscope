/** One concrete shelter glyph for map sprites and both existing legends. */
import { NLI_VISUAL_TOKENS } from "./nli-investigation-theme.js";
import { paintShelterArtwork } from "./nli-shelter-artwork.js";
export const REIM_WEST_SHELTER_ID = "nli-shelter-reim-west";
export const SHELTER_BODY_WIDTH = 24;
export const SHELTER_BODY_RATIO = 97 / 116 * .86;

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
    variant = "normal",
  },
) {
  paintShelterArtwork(ctx, { cx, cy, bodyWidthPx, bodyColor, variant });
}

export function shelterSymbolCanvas(
  bodyColor = NLI_VISUAL_TOKENS.annotationInk,
  pixelRatio = 2,
  variant = "normal",
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
    variant,
  });
  return canvas;
}

export function shelterSymbolImage(bodyColor, variant = "normal") {
  const canvas = shelterSymbolCanvas(bodyColor, 2, variant),
    ctx = canvas.getContext("2d");
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

let legendDataUrl;
export function shelterSymbolDataUrl() {
  if (!legendDataUrl) legendDataUrl = shelterSymbolCanvas().toDataURL();
  return legendDataUrl;
}
