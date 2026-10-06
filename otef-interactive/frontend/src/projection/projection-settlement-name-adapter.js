import { effectiveSettlementPosition, SETTLEMENT_FONT_STACK, validateSettlementNameSettings } from "../shared/settlement-name-settings.js";
import { evaluateOpacityExpression } from "../shared/layer-opacity-expression.js";
import { mapSettlementPosition } from './settlement-name-framing.js';
import { DEFAULT_SETTLEMENT_LEADER_STYLE, EXCLUDED_SETTLEMENT_CODES, settlementTextLines } from '../shared/settlement-label-presentation.js';
import { settlementConnector, paintSettlementConnector } from './settlement-name-connectors.js';

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

function inkFitsCrop(label, box, clip) {
  if (!clip) return true;
  const radians = label.rotateDeg * Math.PI / 180;
  const cos = Math.cos(radians), sin = Math.sin(radians);
  return [[box.left, box.top], [box.right, box.top], [box.right, box.bottom], [box.left, box.bottom]].every(([x, y]) => {
    const dx = x - label.x, dy = y - label.y;
    const rotatedX = label.x + dx * cos - dy * sin;
    const rotatedY = label.y + dx * sin + dy * cos;
    return rotatedX >= clip[0] * WIDTH - 1e-7 && rotatedX <= clip[2] * WIDTH + 1e-7
      && rotatedY >= clip[1] * HEIGHT - 1e-7 && rotatedY <= clip[3] * HEIGHT + 1e-7;
  });
}

function styleFallback(context) {
  return Number(String(context.font).match(/(\d+(?:\.\d+)?)px/)?.[1] || 14) * 0.7;
}

function clampOpacity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(1, Math.max(0, numeric));
}

export function createProjectionSettlementNameAdapter({ document = globalThis.document, output, rasterScale = 1 } = {}) {
  if (!["left", "right"].includes(output)) throw new Error("settlement adapter output must be left or right");
  let generation = 0;
  let paintGeneration = 0;
  let pending = null;
  let active = null;
  let disposed = false;
  let scaledOpacity = 1;
  let framingProvider = null;

  const paint = (style, referenceLabels, framingContext = null, framing = framingProvider?.(framingContext) || null) => {
    const labels=referenceLabels.map(label=>({...label,...mapSettlementPosition(label,framing?.matrix)}));
    const canvas = document?.createElement?.("canvas");
    if (!canvas) throw new Error("settlement canvas is unavailable");
    canvas.width = WIDTH * rasterScale;
    canvas.height = HEIGHT * rasterScale;
    const context = canvas.getContext?.("2d");
    if (!context) throw new Error("settlement canvas 2D context is unavailable");
    context.clearRect(0, 0, WIDTH, HEIGHT);
    if (rasterScale !== 1) context.setTransform(rasterScale, 0, 0, rasterScale, 0, 0);
    context.font = fontSpec(style);
    context.direction = "rtl";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#ffffff";
    context.strokeStyle = "#ffffff";
    context.lineWidth = HALO_PX * 2;
    context.lineJoin = "round";
    const leaderStyle = { ...DEFAULT_SETTLEMENT_LEADER_STYLE, ...framingContext?.settings?.leaderStyle };
    const painted = labels.map((label) => {
      const lines = label.lines || [label.text];
      const lineHeight = style.fontPx * 1.2;
      const measured = lines.map((text, i) => {
        const dy = (i - (lines.length - 1) / 2) * lineHeight;
        return { text, dy, extents: glyphExtents(context, text), box: measureInk(context, text, label.x, label.y + dy) };
      });
      const inkBox = { left: Math.min(...measured.map(m => m.box.left)), right: Math.max(...measured.map(m => m.box.right)),
        top: Math.min(...measured.map(m => m.box.top)), bottom: Math.max(...measured.map(m => m.box.bottom)) };
      if (!inkFitsCrop(label, inkBox, framing?.clip)) return { ...label, inkBox, cropped: true };
      const alpha = clampOpacity(evaluateOpacityExpression(scaledOpacity, { cityname: label.text }));
      const connector = settlementConnector(label, framing?.outlines?.[label.citycode], inkBox, framing?.origins?.[label.citycode]);
      paintSettlementConnector(context, connector, leaderStyle, alpha);
      context.fillStyle = '#ffffff'; context.strokeStyle = '#ffffff'; context.lineWidth = HALO_PX * 2;
      context.save();
      context.globalAlpha = alpha;
      context.translate(label.x, label.y);
      context.rotate(label.rotateDeg * Math.PI / 180);
      for (const { text, dy, extents } of measured) {
        const biasX = (extents.right - extents.left) / 2;
        const biasY = (extents.descent - extents.ascent) / 2;
        context.strokeText(text, -biasX, dy - biasY);
        context.fillText(text, -biasX, dy - biasY);
      }
      context.restore();
      return { ...label, inkBox, connector, cropped: false };
    });
    return {
      canvas,
      style,
      labels: painted,
      referenceLabels, context:framingContext, framing, framingSignature: JSON.stringify(framing),
      descriptor: { source: canvas, opacity: 1, contentVersion: ++paintGeneration, width: WIDTH, height: HEIGHT, ...(framing ? {clip:framing.clip} : {}) },
    };
  };

  const refreshFraming = () => {
    if (!active || !framingProvider) return;
    const framing=framingProvider(active.context);
    if (JSON.stringify(framing)===active.framingSignature) return;
    const visibility=active.descriptor.opacity;
    active=paint(active.style,active.referenceLabels,active.context,framing);
    active.descriptor.opacity=visibility;
  };

  return {
    setFramingProvider(provider) { framingProvider=provider; },
    getFraming() { refreshFraming(); return active?.framing ? structuredClone(active.framing) : null; },
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
        if (EXCLUDED_SETTLEMENT_CODES.has(entry.citycode)) continue;
        const position = effectiveSettlementPosition(checked.value, output, entry.citycode);
        if (!position) continue;
        labels.push({ citycode: entry.citycode, text: entry.text, lines: settlementTextLines(entry.text, checked.value.lineBreaks?.[entry.citycode]), x: position.x, y: position.y, rotateDeg: style.rotateDeg });
      }
      pending = paint(style, labels, {catalog,settings:checked.value});
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
    applyScaledOpacity(value) {
      scaledOpacity = value;
      if (!active?.style) return;
      const visibility = active.descriptor.opacity;
      const labels = active.referenceLabels.map(label => ({ ...label }));
      active = paint(active.style, labels, active.context);
      active.descriptor.opacity = visibility;
    },
    descriptor() {
      refreshFraming();
      return active ? active.descriptor : null;
    },
    getLabels() {
      refreshFraming();
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
