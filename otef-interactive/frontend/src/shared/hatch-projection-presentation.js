/**
 * MapLibre hatch tuning for the projection display only.
 * Scales processed lyrx `separation` and `width` when building hatch raster tiles,
 * then snaps to the device pixel grid so strokes stay crisp (GIS / style source unchanged).
 */

/**
 * Keep projection denser than GIS, but not so dense that diagonal AA dominates.
 * Combined with integer snapping below, this yields cleaner lines on the fixed camera.
 */
export const PROJECTION_HATCH_SEPARATION_MULTIPLIER = 0.875;

/**
 * Thin projection hatch strokes to reduce blur/bleed from diagonal anti-aliasing.
 * We still snap to integer pixels for crisp rasterization.
 */
export const PROJECTION_HATCH_WIDTH_MULTIPLIER = 0.6;

/**
 * Render projection hatch tiles at higher internal density, then let MapLibre
 * display them at logical size via addImage({ pixelRatio }). This reduces
 * visible blockiness on the fixed projection camera.
 */
export const PROJECTION_HATCH_PIXEL_RATIO = 2;

/**
 * @param {number} scaledSeparation - after density multiplier, before quantize
 * @returns {number} whole px, >= 1
 */
export function quantizeProjectionHatchSeparation(scaledSeparation) {
  return Math.max(1, Math.round(scaledSeparation));
}

/**
 * @param {number} scaledWidth - after width multiplier, before quantize
 * @returns {number} whole px, >= 1
 */
export function quantizeProjectionHatchWidth(scaledWidth) {
  if (!Number.isFinite(scaledWidth)) return 1;
  return Math.max(1, Math.round(scaledWidth));
}

/**
 * Projection-only: density tuning + snap so MapLibre hatch rasters align to the pixel grid.
 *
 * @param {{ separation: number, width: number }} hatch
 * @returns {{ separation: number, width: number, pixelRatio: number }}
 */
export function projectionHatchRasterParams(hatch) {
  const sep0 = Math.max(1, Number(hatch.separation) || 1);
  const w0 =
    hatch.width != null && Number.isFinite(Number(hatch.width)) ? Number(hatch.width) : 1;
  const scaledSep = sep0 * PROJECTION_HATCH_SEPARATION_MULTIPLIER;
  const scaledW = w0 * PROJECTION_HATCH_WIDTH_MULTIPLIER;
  const logicalSeparation = quantizeProjectionHatchSeparation(scaledSep);
  const logicalWidth = quantizeProjectionHatchWidth(scaledW);
  return {
    separation: logicalSeparation * PROJECTION_HATCH_PIXEL_RATIO,
    width: logicalWidth * PROJECTION_HATCH_PIXEL_RATIO,
    pixelRatio: PROJECTION_HATCH_PIXEL_RATIO,
  };
}
