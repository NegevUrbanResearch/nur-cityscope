import { DEFAULT_PROJECTION_CONFIG, validateProjectionConfig } from "../shared/projection-config-schema.js";
import { buildProjectionPatternGeometry } from "./projection-pattern.js";

const WIDTH = 1920;
const HEIGHT = 1080;
const DEFAULT_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

function canvasFor(factory) {
  const canvas = factory?.() || globalThis.document?.createElement?.("canvas");
  if (!canvas) throw new Error("projection pattern adapter requires canvas support");
  canvas.width = WIDTH; canvas.height = HEIGHT;
  return canvas;
}

export function createProjectionPatternAdapter({ spanId, canvasFactory, rasterScale = 1 } = {}) {
  const canvas = canvasFor(canvasFactory);
  canvas.width = WIDTH * rasterScale; canvas.height = HEIGHT * rasterScale;
  const context = canvas.getContext?.("2d");
  if (!context) throw new Error("projection pattern adapter requires a 2d canvas");
  let config = DEFAULT_PROJECTION_CONFIG;
  let command = null;
  let fontFamily = DEFAULT_FONT_FAMILY;
  let dirty = true;
  let disposed = false;
  let signature = null;
  let contentVersion = 0;
  const clear = () => { command = null; signature = null; dirty = true; context.clearRect(0, 0, canvas.width, canvas.height); };
  const sync = (next = {}) => {
    if (disposed) return;
    if (next.config && Object.keys(validateProjectionConfig(next.config)).length === 0) config = next.config;
    if (next.fontFamily) fontFamily = String(next.fontFamily);
    if (next.active === false || next.pattern === "off" || next.command?.pattern === "off") return clear();
    const incoming = next.command || next;
    if (!incoming?.pattern || !["grid", "output_id"].includes(incoming.pattern)) return;
    command = { pattern: incoming.pattern };
    const nextSignature = JSON.stringify([command, config, fontFamily]);
    if (nextSignature !== signature) { signature = nextSignature; dirty = true; }
  };
  const draw = () => {
    if (disposed || !command) return null;
    if (dirty) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      const geometry = buildProjectionPatternGeometry(command, config, spanId);
      context.save?.();
      context.scale?.(canvas.width, canvas.height);
      context.strokeStyle = "#fff"; context.fillStyle = "#fff"; context.textAlign = "center";
      for (const line of geometry?.lines || []) {
        context.beginPath();
        line.points.forEach((point, index) => { if (index) context.lineTo(point.u, point.v); else context.moveTo(point.u, point.v); });
        context.lineWidth = line.width;
        context.stroke();
      }
      if (geometry?.label) {
        context.font = `0.08px ${fontFamily}`;
        context.fillText(geometry.label.text, geometry.label.point.u, geometry.label.point.v);
      }
      context.restore?.();
      dirty = false;
      contentVersion += 1;
    }
    return { source: canvas, contentVersion };
  };
  return { canvas, sync, draw, dispose() { disposed = true; clear(); } };
}
