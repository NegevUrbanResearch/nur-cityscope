import { effectiveSettlementPosition, SETTLEMENT_FONT_STACK, validateSettlementNameSettings } from "../shared/settlement-name-settings.js";

const WIDTH = 1920;
const HEIGHT = 1080;
const HALO_PX = 0.35;

function fontSpec(style) {
  return `${style.fontPx}px ${SETTLEMENT_FONT_STACK[style.fontFamily]}`;
}

function glyphExtents(context, text) {
  const metrics = context.measureText(text);
  const half = Number(metrics.width) / 2;
  const leftReach = Number(metrics.actualBoundingBoxLeft);
  const rightReach = Number(metrics.actualBoundingBoxRight);
  const ascent = Number(metrics.actualBoundingBoxAscent);
  const descent = Number(metrics.actualBoundingBoxDescent);
  return {
    left: Number.isFinite(leftReach) ? leftReach : half,
    right: Number.isFinite(rightReach) ? rightReach : half,
    ascent: Number.isFinite(ascent) ? ascent : styleFallback(context),
    descent: Number.isFinite(descent) ? descent : styleFallback(context) * 0.25,
  };
}

function measureInk(context, text, x, y) {
  const extents = glyphExtents(context, text);
  const width = extents.left + extents.right + HALO_PX * 2;
  const height = extents.ascent + extents.descent + HALO_PX * 2;
  return {
    left: x - width / 2,
    right: x + width / 2,
    top: y - height / 2,
    bottom: y + height / 2,
  };
}

function styleFallback(context) {
  return Number(String(context.font).match(/(\d+(?:\.\d+)?)px/)?.[1] || 14) * 0.7;
}

export function createProjectionSettlementNameAdapter({ document = globalThis.document, output } = {}) {
  if (!["left", "right"].includes(output)) throw new Error("settlement adapter output must be left or right");
  let generation = 0;
  let pending = null;
  let active = null;
  let disposed = false;

  const paint = (style, labels) => {
    const canvas = document?.createElement?.("canvas");
    if (!canvas) throw new Error("settlement canvas is unavailable");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext?.("2d");
    if (!context) throw new Error("settlement canvas 2D context is unavailable");
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.font = fontSpec(style);
    context.direction = "rtl";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#ffffff";
    context.strokeStyle = "#ffffff";
    context.lineWidth = HALO_PX * 2;
    context.lineJoin = "round";
    const painted = labels.map((label) => {
      const extents = glyphExtents(context, label.text);
      const biasX = (extents.right - extents.left) / 2;
      const biasY = (extents.descent - extents.ascent) / 2;
      context.save();
      context.translate(label.x, label.y);
      context.rotate(label.rotateDeg * Math.PI / 180);
      context.strokeText(label.text, -biasX, -biasY);
      context.fillText(label.text, -biasX, -biasY);
      context.restore();
      return { ...label, inkBox: measureInk(context, label.text, label.x, label.y) };
    });
    return {
      canvas,
      labels: painted,
      descriptor: { source: canvas, opacity: 1, contentVersion: generation, width: WIDTH, height: HEIGHT },
    };
  };

  return {
    async prepare({ catalog, settings, signal } = {}) {
      if (disposed) throw new Error("settlement adapter is disposed");
      const token = ++generation;
      const checked = validateSettlementNameSettings(settings);
      if (checked.errors.length) throw new TypeError(checked.errors.join(", "));
      const style = checked.value.style;
      if (signal?.aborted) return { stale: true };
      try {
        await document?.fonts?.load?.(fontSpec(style));
      } catch (error) {
        if (token !== generation || signal?.aborted) return { stale: true };
        throw new Error(`settlement font failed to load: ${error.message}`);
      }
      if (token !== generation || signal?.aborted) return { stale: true };
      const labels = [];
      for (const entry of catalog?.entries || []) {
        const position = effectiveSettlementPosition(checked.value, output, entry.citycode);
        if (!position) continue;
        labels.push({ citycode: entry.citycode, text: entry.text, x: position.x, y: position.y, rotateDeg: style.rotateDeg });
      }
      pending = paint(style, labels);
      pending.token = token;
      return { source: pending.canvas };
    },
    commit() {
      if (!pending) throw new Error("no prepared settlement canvas");
      active = pending;
      pending = null;
      return { source: active.canvas };
    },
    setVisible(visible) {
      if (!active) return;
      active.descriptor.opacity = visible ? 1 : 0;
    },
    descriptor() {
      return active ? active.descriptor : null;
    },
    getLabels() {
      return active ? active.labels.map((label) => ({ ...label, inkBox: { ...label.inkBox } })) : [];
    },
    dispose() {
      disposed = true;
      generation += 1;
      pending = null;
      active = null;
    },
  };
}
