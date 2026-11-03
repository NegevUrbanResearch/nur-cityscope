import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHatchImageDataFromSpec } from "../frontend/src/shared/hatch-pattern-tile.js";

/**
 * Node (Vitest) has no 2D canvas. Stub `document.createElement("canvas")` with a
 * minimal rasterizer: affine CTM = R(θ)·T(s/2,s/2) (pre-multiply per WHATWG) +
 * distance-to-segment stroke, sufficient for the hatch line fan in
 * `createHatchImageDataFromSpec`.
 */

const PRIMARY_SEPARATION_PX = 8;
const PRIMARY_ROTATION_DEG = 45;
const PRIMARY_STROKE_WIDTH_PX = 16 / 3;
const PRIMARY_H_SCAN_PERIOD_PX = 8 * Math.SQRT2;
const TOLERANCE = 2;
const pInt = Math.round(PRIMARY_H_SCAN_PERIOD_PX);

let prevDocument;

// x' = a*x + c*y + e,  y' = b*x + d*y + f
function multiplyAffine(m1, m2) {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

function translate(tx, ty) {
  return [1, 0, 0, 1, tx, ty];
}

function rotate(rad) {
  const c0 = Math.cos(rad);
  const s0 = Math.sin(rad);
  return [c0, s0, -s0, c0, 0, 0];
}

function applyAffine(m, x, y) {
  const [a, b, c, d, e, f] = m;
  return [a * x + c * y + e, b * x + d * y + f];
}

function parseStrokeStyle(style) {
  if (!style || typeof style !== "string" || !style.startsWith("#")) {
    return [128, 128, 128];
  }
  const hex = style.slice(1);
  if (hex.length === 3) {
    return [
      parseInt(hex[0] + hex[0], 16),
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
    ];
  }
  if (hex.length === 6) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  return [128, 128, 128];
}

function distPointToSeg(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-20) {
    return Math.hypot(px - x0, py - y0);
  }
  let t = ((px - x0) * dx + (py - y0) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

/**
 * @param {number} width
 * @param {number} height
 */
function buildCtx(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let x0, y0, x1, y1, hasPath;

  const o = {
    lineWidth: 1,
    strokeStyle: "#000000",
    lineCap: "butt",
    clearRect(x, y, w, h) {
      for (let j = 0; j < h; j += 1) {
        for (let i = 0; i < w; i += 1) {
          const ix = x + i;
          const iy = y + j;
          if (ix >= 0 && ix < width && iy >= 0 && iy < height) {
            const p = (iy * width + ix) * 4;
            data[p] = 0;
            data[p + 1] = 0;
            data[p + 2] = 0;
            data[p + 3] = 0;
          }
        }
      }
    },
    save() {
      stack.push([...ctm]);
    },
    restore() {
      ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    },
    translate(tx, ty) {
      ctm = multiplyAffine(translate(tx, ty), ctm);
    },
    rotate(rad) {
      ctm = multiplyAffine(rotate(rad), ctm);
    },
    beginPath() {
      hasPath = false;
    },
    moveTo(x, y) {
      [x0, y0] = applyAffine(ctm, x, y);
      hasPath = true;
    },
    lineTo(x, y) {
      if (!hasPath) {
        return;
      }
      [x1, y1] = applyAffine(ctm, x, y);
    },
    stroke() {
      if (!hasPath) {
        return;
      }
      const w = o.lineWidth;
      const half = w * 0.5;
      const [r, g, b] = parseStrokeStyle(o.strokeStyle);
      for (let iy = 0; iy < height; iy += 1) {
        for (let ix = 0; ix < width; ix += 1) {
          const dist = distPointToSeg(ix + 0.5, iy + 0.5, x0, y0, x1, y1);
          if (dist <= half) {
            const p = (iy * width + ix) * 4;
            data[p] = r;
            data[p + 1] = g;
            data[p + 2] = b;
            data[p + 3] = 255;
          }
        }
      }
    },
    getImageData(_x, _y, w, h) {
      if (w !== width || h !== height) {
        // hatch helper always uses full surface
        return { width, height, data, colorSpace: "srgb" };
      }
      return { width, height, data, colorSpace: "srgb" };
    },
  };
  return o;
}

beforeAll(() => {
  prevDocument = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      if (tag !== "canvas") {
        return {};
      }
      return {
        width: 0,
        height: 0,
        getContext(type) {
          if (type !== "2d") {
            return null;
          }
          const c = this;
          return buildCtx(c.width, c.height);
        },
      };
    },
  };
});

afterAll(() => {
  if (prevDocument === undefined) {
    delete globalThis.document;
  } else {
    globalThis.document = prevDocument;
  }
});

describe("hatch-pattern-tile (createHatchImageDataFromSpec)", () => {
  it("ImageData is square, size ≥ 16, center-row alpha ~ periodic at seam-relevant 45° spec", () => {
    const imageData = createHatchImageDataFromSpec({
      separation: PRIMARY_SEPARATION_PX,
      rotation: PRIMARY_ROTATION_DEG,
      width: PRIMARY_STROKE_WIDTH_PX,
    });
    const { width, data } = imageData;
    expect(data).toBeInstanceOf(Uint8ClampedArray);
    expect(width).toBeGreaterThanOrEqual(16);
    expect(imageData.width).toBe(imageData.height);
    const y = Math.floor(width / 2);
    for (let x = 0; x < width - pInt; x += 1) {
      const a = (y * width + x) * 4 + 3;
      const b = (y * width + x + pInt) * 4 + 3;
      expect(Math.abs(data[a] - data[b])).toBeLessThanOrEqual(TOLERANCE);
    }
  });

  it("0° baseline: center-row alpha periodic with separation 8 (optional axis-aligned check)", () => {
    const imageData = createHatchImageDataFromSpec({
      separation: 8,
      rotation: 0,
      width: 1,
    });
    const { width, data } = imageData;
    expect(width).toBeGreaterThanOrEqual(16);
    const y = Math.floor(width / 2);
    const period8 = 8;
    for (let x = 0; x < width - period8; x += 1) {
      const a = (y * width + x) * 4 + 3;
      const b = (y * width + x + period8) * 4 + 3;
      expect(Math.abs(data[a] - data[b])).toBeLessThanOrEqual(2);
    }
  });
});
