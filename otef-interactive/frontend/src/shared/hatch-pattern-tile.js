/**
 * MapLibre / canvas hatch: axis-aligned fill-pattern must be a valid torus (wrap at edges
 * with no phase break). For parallel lines of perpendicular spacing `separation` at angle
 * `rotation` (device canvas convention, same as processed `hatch.rotation` and
 * `DOMMatrix.rotateSelf`), the phase periods along +x and +y are
 *   T_x = separation / |sin(θ)|,  T_y = separation / |cos(θ)|,
 * (θ in radians) with branches when either denominator is near zero.
 *
 * The legacy MapLibre path drew horizontal lines in a rotated 2D context, which is
 * equivalent; this module only fixes the *tile pixel size* so S is a near-integer
 * multiple of both T_x and T_y on a square S×S bitmap.
 */

const EPS = 1e-4;
const TAU_MATCH = 0.04; // allow small rasterization slack at opposite edges
const MAX_TILE = 512;
const MIN_TILE = 16;

/**
 * @param {number} separation
 * @param {number} angleDeg
 * @returns {number} square edge length in device pixels, >= MIN_TILE
 */
export function computeHatchTilePixelSize(separation, angleDeg) {
  const d = Math.max(1, Number(separation) || 1);
  const rad = (Number(angleDeg) * Math.PI) / 180;
  const absSin = Math.abs(Math.sin(rad));
  const absCos = Math.abs(Math.cos(rad));

  if (absSin < EPS || absCos < EPS) {
    const k = Math.ceil(MIN_TILE / d);
    return Math.max(MIN_TILE, k * d);
  }

  const tX = d / absSin;
  const tY = d / absCos;

  for (let s = MIN_TILE; s <= MAX_TILE; s += 1) {
    const errX = periodMismatch(s, tX);
    const errY = periodMismatch(s, tY);
    if (errX < TAU_MATCH && errY < TAU_MATCH) {
      return s;
    }
  }
  return MAX_TILE;
}

function periodMismatch(s, t) {
  if (!Number.isFinite(t) || t <= 0) return 0;
  const n = s / t;
  const f = n - Math.floor(n);
  return Math.min(f, 1 - f);
}

/**
 * @param {object} spec
 * @param {number} [spec.separation]
 * @param {number} [spec.rotation]
 * @param {string} [spec.color]
 * @param {number} [spec.width]
 * @returns {ImageData}
 */
export function createHatchImageDataFromSpec(spec) {
  const separation = spec.separation ?? 8;
  const angleDeg = spec.rotation ?? 0;
  const angleRad = (angleDeg * Math.PI) / 180;
  const size = computeHatchTilePixelSize(separation, angleDeg);

  const ctx2d = createCanvas2DContext(size);
  if (!ctx2d) {
    throw new Error("[hatch-pattern-tile] Hatch patterns require a 2D canvas (browser only).");
  }
  const { ctx, getImageData } = ctx2d;

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(angleRad);
  ctx.strokeStyle = spec.color || "#808080";
  ctx.lineWidth = spec.width ?? 1;
  ctx.lineCap = "butt";

  const diagonal = size * Math.SQRT2;
  for (let offset = -diagonal; offset < diagonal; offset += separation) {
    ctx.beginPath();
    ctx.moveTo(-diagonal, offset);
    ctx.lineTo(diagonal, offset);
    ctx.stroke();
  }
  ctx.restore();

  return getImageData();
}

function createCanvas2DContext(size) {
  if (typeof document !== "undefined" && document.createElement) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    return {
      ctx,
      getImageData: () => ctx.getImageData(0, 0, size, size),
    };
  }
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    return {
      ctx,
      getImageData: () => ctx.getImageData(0, 0, size, size),
    };
  }
  return null;
}
