import { OUTPUT_HEIGHT, OUTPUT_WIDTH, projectionOverlayMatrix } from "./projection-overlay-placement.js";
import { createProjectionClockMotionPainter } from "./projection-clock-motion-painter.js";

const FONT = '"Guttman Hatzvi", "Noto Sans Hebrew", Arial, sans-serif';

function makeCanvas(factory) {
  const canvas = factory?.() || globalThis.document?.createElement?.("canvas");
  if (!canvas) throw new Error("projection caption adapter requires canvas support");
  canvas.width = OUTPUT_WIDTH; canvas.height = OUTPUT_HEIGHT;
  return canvas;
}

function localSize(layout) {
  return {
    width: Math.max(1, Math.round(OUTPUT_WIDTH * (Number(layout?.widthPct) || 100) / 100)),
    height: Math.max(1, Math.round(OUTPUT_HEIGHT * (Number(layout?.heightPct) || 100) / 100)),
  };
}

function drawClock(context, text, fontPx, width, height, rasterScale, motion, paintMotion) {
  context.save?.();
  context.beginPath?.();
  context.rect?.(0, 0, width, height);
  context.clip?.();
  context.font = `800 ${fontPx}px ${FONT}`;
  context.fillStyle = "white";
  context.direction = "ltr";
  context.textAlign = "start";
  context.textBaseline = "alphabetic";
  context.letterSpacing = `${fontPx * 0.04}px`;
  context.lineHeight = fontPx * 1.35;
  context.shadowColor = "rgba(0, 0, 0, 0.85)";
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 2 * rasterScale;
  context.shadowBlur = 8 * rasterScale;
  const metrics = context.measureText?.(text) || {};
  const actualAscent = Number(metrics.actualBoundingBoxAscent) || fontPx * 0.8;
  const fontAscent = Number(metrics.fontBoundingBoxAscent) || actualAscent;
  const fontDescent = Number(metrics.fontBoundingBoxDescent) || Number(metrics.actualBoundingBoxDescent) || fontPx * 0.2;
  const baseline = (fontPx * 1.35 - fontAscent - fontDescent) / 2 + fontAscent;
  if (motion?.active && motion.fromLabel?.length === text.length && motion.toLabel?.length === text.length) {
    paintMotion(context, motion, { fontPx, baseline, rasterScale });
  } else {
    paintMotion(context, { fromLabel: text, toLabel: text, progress: 1 }, { fontPx, baseline, rasterScale });
  }
  context.restore?.();
}

export function createProjectionCaptionAdapter({ canvasFactory, rasterScale = 1 } = {}) {
  const canvas = makeCanvas(canvasFactory); const context = canvas.getContext?.("2d");
  if (!context) throw new Error("projection caption adapter requires a 2d canvas");
  const paintMotion = createProjectionClockMotionPainter({ canvasFactory });
  let snapshot = null; let layout = {}; let signature = null; let dirty = true; let disposed = false; let contentVersion = 0;
  const sync = (next = {}) => {
    if (disposed) return;
    const nextSnapshot = next.snapshot || next;
    const nextLayout = next.layout || layout;
    const size = localSize(nextLayout);
    const motion = nextSnapshot?.motion;
    const nextSignature = JSON.stringify([nextSnapshot?.model?.clockLabel || "", Number(nextLayout.fontPx) || 22, size.width, size.height,
      motion?.active ? [motion.fromLabel, motion.toLabel, motion.progress] : null]);
    snapshot = nextSnapshot;
    layout = nextLayout;
    if (nextSignature === signature) return;
    signature = nextSignature;
    if (canvas.width !== size.width * rasterScale || canvas.height !== size.height * rasterScale) {
      canvas.width = size.width * rasterScale;
      canvas.height = size.height * rasterScale;
    }
    dirty = true;
  };
  const draw = () => {
    if (disposed || !snapshot?.visible || !snapshot.model) return null;
    if (dirty) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.save();
      context.scale(rasterScale, rasterScale);
      drawClock(context, snapshot.model.clockLabel || "", Number(layout.fontPx) || 22, canvas.width / rasterScale, canvas.height / rasterScale, rasterScale, snapshot.motion, paintMotion);
      context.restore();
      dirty = false;
      contentVersion += 1;
    }
    return { source: canvas, contentVersion, matrix: projectionOverlayMatrix(layout) };
  };
  return { canvas, sync, draw, dispose() { disposed = true; context.clearRect(0, 0, canvas.width, canvas.height); snapshot = null; signature = null; } };
}

export function drawProjectionCaptionForSpan(adapter, span) {
  return span === "left" ? adapter?.draw?.() ?? null : null;
}

export { projectionOverlayMatrix as matrixFor };
