import { nliClockHalfOpacity } from "../shared/nli-clock-motion.js";

const OVERLAP = 0.75;
const PADDING = 2;

function drawHalf(context, char, width, half, scale, baseline, height, x) {
  const opacity = nliClockHalfOpacity(scale);
  if (opacity === 0) return;
  const hinge = height / 2;
  context.save();
  context.globalAlpha = opacity;
  context.translate(0, hinge);
  context.scale(1, scale);
  context.beginPath();
  context.rect(-PADDING, half === "top" ? -hinge : -OVERLAP, width + PADDING * 2, hinge + OVERLAP);
  context.clip();
  context.fillText(char, x, baseline - hinge);
  context.restore();
}

// Assemble each moving glyph without a shadow so the clipped halves cannot
// create a dark join. The output canvas applies the existing shadow once.
export function createProjectionClockMotionPainter({ canvasFactory } = {}) {
  let digitCanvas;
  let digitContext;
  return (context, motion, { fontPx, baseline, rasterScale }) => {
    const { fromLabel, toLabel } = motion;
    const progress = Math.max(0, Math.min(1, motion.progress));
    const height = fontPx * 1.35;
    context.letterSpacing = "0px";
    const spacing = fontPx * 0.04;
    let x = 0;
    for (let index = 0; index < toLabel.length; index += 1) {
      const from = fromLabel[index];
      const to = toLabel[index];
      const width = fontPx * (to === ":" ? 0.26 : 0.65);
      if (from === to || progress >= 1) {
        context.fillText(to, x + (width - context.measureText(to).width) / 2, baseline);
      } else {
        if (!digitCanvas) {
          digitCanvas = canvasFactory?.() || globalThis.document?.createElement?.("canvas");
          digitContext = digitCanvas?.getContext?.("2d");
          if (!digitContext) throw new Error("projection clock motion requires a 2d canvas");
        }
        digitCanvas.width = Math.ceil((width + PADDING * 2) * rasterScale);
        digitCanvas.height = Math.ceil(height * rasterScale);
        digitContext.setTransform(rasterScale, 0, 0, rasterScale, PADDING * rasterScale, 0);
        digitContext.clearRect(-PADDING, 0, digitCanvas.width / rasterScale, digitCanvas.height / rasterScale);
        digitContext.font = context.font;
        digitContext.fillStyle = context.fillStyle;
        digitContext.direction = "ltr";
        digitContext.textAlign = "start";
        digitContext.textBaseline = "alphabetic";
        digitContext.letterSpacing = "0px";
        digitContext.shadowBlur = 0;
        digitContext.globalAlpha = 1;
        const char = progress < 0.5 ? from : to;
        const glyphX = (width - context.measureText(char).width) / 2;
        if (progress < 0.5) {
          drawHalf(digitContext, char, width, "bottom", 1, baseline, height, glyphX);
          drawHalf(digitContext, char, width, "top", Math.cos(progress * Math.PI), baseline, height, glyphX);
        } else {
          drawHalf(digitContext, char, width, "top", 1, baseline, height, glyphX);
          drawHalf(digitContext, char, width, "bottom", Math.sin((progress - 0.5) * Math.PI), baseline, height, glyphX);
        }
        context.drawImage(digitCanvas, x - PADDING, 0, digitCanvas.width / rasterScale, digitCanvas.height / rasterScale);
      }
      x += width + spacing;
    }
  };
}
