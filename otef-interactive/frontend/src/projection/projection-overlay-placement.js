const OUTPUT_WIDTH = 1920;
const OUTPUT_HEIGHT = 1080;

/**
 * Map a component-local normalized canvas into the fixed projector output.
 * The aspect terms preserve CSS rotate() around the box center when source
 * pixels and output pixels have different aspect ratios.
 */
export function projectionOverlayMatrix(layout = {}) {
  const left = Number(layout.leftPct || 0) / 100;
  const top = Number(layout.topPct || 0) / 100;
  const width = Number(layout.widthPct || 100) / 100;
  const height = Number(layout.heightPct || 100) / 100;
  const radians = Number(layout.rotateDeg || 0) * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const columnX = [width * cos, width * sin * OUTPUT_WIDTH / OUTPUT_HEIGHT, 0];
  const columnY = [-height * sin * OUTPUT_HEIGHT / OUTPUT_WIDTH, height * cos, 0];
  const centerX = left + width / 2;
  const centerY = top + height / 2;
  return [
    ...columnX,
    ...columnY,
    centerX - (columnX[0] + columnY[0]) / 2,
    centerY - (columnX[1] + columnY[1]) / 2,
    1,
  ];
}

export { OUTPUT_WIDTH, OUTPUT_HEIGHT };
