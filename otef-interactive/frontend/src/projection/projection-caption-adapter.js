import { OUTPUT_HEIGHT, OUTPUT_WIDTH, projectionOverlayMatrix } from "./projection-overlay-placement.js";

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

function drawClock(context, text, fontPx, width, height) {
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
  context.shadowOffsetY = 2;
  context.shadowBlur = 8;
  const metrics = context.measureText?.(text) || {};
  const actualAscent = Number(metrics.actualBoundingBoxAscent) || fontPx * 0.8;
  const fontAscent = Number(metrics.fontBoundingBoxAscent) || actualAscent;
  const fontDescent = Number(metrics.fontBoundingBoxDescent) || Number(metrics.actualBoundingBoxDescent) || fontPx * 0.2;
  const baseline = (fontPx * 1.35 - fontAscent - fontDescent) / 2 + fontAscent;
  context.fillText(text, 0, baseline);
  context.restore?.();
}

export function createProjectionCaptionAdapter({ canvasFactory } = {}) {
  const canvas = makeCanvas(canvasFactory); const context = canvas.getContext?.("2d");
  if (!context) throw new Error("projection caption adapter requires a 2d canvas");
  let snapshot = null; let layout = {}; let signature = null; let dirty = true; let disposed = false;
  const sync = (next = {}) => {
    if (disposed) return;
    const nextSnapshot = next.snapshot || next;
    const nextLayout = next.layout || layout;
    const nextSignature = JSON.stringify([nextSnapshot, nextLayout]);
    if (nextSignature === signature) return;
    signature = nextSignature;
    snapshot = nextSnapshot;
    layout = nextLayout;
    const size = localSize(layout);
    if (canvas.width !== size.width || canvas.height !== size.height) {
      canvas.width = size.width;
      canvas.height = size.height;
    }
    dirty = true;
  };
  const draw = () => {
    if (disposed || !snapshot?.visible || !snapshot.model) return null;
    if (dirty) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      drawClock(context, snapshot.model.clockLabel || "", Number(layout.fontPx) || 22, canvas.width, canvas.height);
      dirty = false;
    }
    return { source: canvas, matrix: projectionOverlayMatrix(layout) };
  };
  return { canvas, sync, draw, dispose() { disposed = true; context.clearRect(0, 0, canvas.width, canvas.height); snapshot = null; signature = null; } };
}

export { projectionOverlayMatrix as matrixFor };
