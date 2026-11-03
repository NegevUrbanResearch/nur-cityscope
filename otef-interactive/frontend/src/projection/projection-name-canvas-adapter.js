import { planeToOutputUv } from '../shared/projection-config-geometry.js';
import { nameRevealSchedule, NAME_FIELD_REVEAL_DURATION_MS } from '../shared/nli-name-field-animation.js';
import { getProjectionSpanClipRect } from './projection-span-view.js';
import { nameTextStyle } from '../shared/nli-name-language.js';

const WIDTH = 1920;
const HEIGHT = 1080;

/** A candidate becomes visible only after commit; visibility never repaints its glyphs. */
export function createProjectionNameCanvasAdapter({ document = globalThis.document, output, rasterScale = 1 } = {}) {
  if (!['left', 'right'].includes(output)) throw new Error('name adapter output must be left or right');
  let pending = null, active = null, previous = null, hasRollback = false, disposed = false;
  let opacity = 0, revealSeconds = 0, selectedPid = null;
  let presentation = { alphaFor: () => 1 }, version = 0;
  const paint = (entry) => {
    const { canvas, ctx, placements, matrix, fontPx, fontFamily, color, strokeWidthPx } = entry;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    ctx.save();
    if (entry.maskPolygons) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath();
      for (const polygon of entry.maskPolygons) {
        ctx.moveTo(polygon[0].u * canvas.width, polygon[0].v * canvas.height);
        for (const point of polygon.slice(1)) ctx.lineTo(point.u * canvas.width, point.v * canvas.height);
        ctx.closePath();
      }
      ctx.clip();
    }
    ctx.setTransform(...matrix);
    ctx.font = `${fontPx}px ${entry.textStyle.canvasFontStack}`;
    ctx.fillStyle = color;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = strokeWidthPx;
    ctx.lineJoin = 'round';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = entry.textStyle.direction;
    for (const name of placements) {
      const alpha = presentation.alphaFor?.(name.id, name) ?? 1;
      if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new Error('invalid Canvas name focus opacity');
      if (!alpha) continue;
      ctx.globalAlpha = alpha;
      const x = name.x + (name.textOffsetX ?? 0), y = name.y + (name.textOffsetY ?? 0);
      ctx.strokeText?.(name.name, x, y);
      ctx.fillText(name.name, x, y);
    }
    ctx.restore();
    entry.contentVersion = ++version;
  };
  const adapter = {
    prepare({ config, placements, fontPx = 12, fontFamily = 'Guttman Hatzvi', textStyle = { ...nameTextStyle(), fontFamily, canvasFontStack: `"${fontFamily}"` }, color = '#fff', logicalPlane, outputMasks } = {}) {
      if (disposed) throw new Error('name adapter is disposed');
      if (!config || !Array.isArray(placements) || !Number.isFinite(logicalPlane?.heading) ||
          !Number.isFinite(logicalPlane?.planeScale)) throw new Error('incomplete name canvas candidate');
      const canvas = document?.createElement?.('canvas');
      if (!canvas) throw new Error('name canvas is unavailable');
      canvas.width = WIDTH * rasterScale; canvas.height = HEIGHT * rasterScale;
      const ctx = canvas.getContext?.('2d');
      if (!ctx) throw new Error('name canvas 2D context is unavailable');
      const origin = planeToOutputUv([0, 0], config, output, logicalPlane);
      const xUnit = planeToOutputUv([1, 0], config, output, logicalPlane);
      const yUnit = planeToOutputUv([0, 1], config, output, logicalPlane);
      const matrix = [(xUnit.u - origin.u) * WIDTH, (xUnit.v - origin.v) * HEIGHT,
        (yUnit.u - origin.u) * WIDTH, (yUnit.v - origin.v) * HEIGHT,
        origin.u * WIDTH, origin.v * HEIGHT].map(value => value * rasterScale);
      const sides = ['left', 'right'];
      for (const item of placements) {
        const outputs = item.outputs ?? [item.output];
        if (!Array.isArray(outputs) || !outputs.length || !outputs.includes(item.output) ||
            outputs.some(side => !sides.includes(side)) ||
            outputs.join('|') !== sides.filter(side => outputs.includes(side)).join('|'))
          throw new Error('invalid name canvas output membership');
      }
      const own = placements.filter((item) => (item.outputs ?? [item.output]).includes(output));
      if (outputMasks != null && sides.some(side => !Array.isArray(outputMasks[side]) ||
          outputMasks[side].some(polygon => !Array.isArray(polygon) || polygon.length < 3 ||
            polygon.some(point => !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)))))
        throw new Error('invalid name canvas output mask');
      const maskPolygons = outputMasks?.[output].map(polygon => polygon.map(point => planeToOutputUv(point, config, output, logicalPlane)));
      const crop = getProjectionSpanClipRect(config, output);
      if (!crop) throw new Error('invalid name canvas output crop');
      if (own.some((item) => !item.id || !item.name || ![item.x, item.y, item.width, item.height].every(Number.isFinite) ||
          ['textOffsetX', 'textOffsetY'].some((key) => Object.hasOwn(item, key) && !Number.isFinite(item[key]))))
        throw new Error('invalid name canvas placement');
      const schedule = nameRevealSchedule(placements.map((item) => item.id));
      const vertices = [];
      const indexByPid = new Map();
      for (const item of own) {
        const identity = schedule.get(String(item.id));
        const left = item.x - item.width / 2, right = item.x + item.width / 2;
        const top = item.y - item.height / 2, bottom = item.y + item.height / 2;
        const corners = [[left, top], [right, top], [left, bottom], [right, bottom]]
          .map((point) => planeToOutputUv(point, config, output, logicalPlane));
        if (corners.some(({ u, v }) => !Number.isFinite(u) || !Number.isFinite(v)))
          throw new Error('invalid name canvas reveal quad');
        for (const corner of [0, 1, 2, 2, 1, 3]) {
          const { u, v } = corners[corner];
          vertices.push(u, v, identity.delayMs / 1000, identity.index);
        }
        indexByPid.set(String(item.id), identity.index);
      }
      const activeMode = config.namesWall?.activeMode;
      const strokeWidthPx = config.namesWall?.profiles?.[activeMode]?.strokeWidthPx ?? (activeMode === 'wall' ? 3 : 2);
      pending = { canvas, ctx, placements: own, allPlacements: placements, matrix, fontPx, fontFamily: textStyle.fontFamily, textStyle, color, strokeWidthPx,
        outputMasks, maskPolygons, clip: [crop.x0, crop.y0, crop.x1, crop.y1],
        revealVertices: new Float32Array(vertices), indexByPid };
      paint(pending);
      return { source: canvas };
    },
    applyGeometry({ config, logicalPlane } = {}) {
      if (disposed) throw new Error('name adapter is disposed');
      if (!active) return false;
      adapter.prepare({ config, placements: active.allPlacements, fontPx: active.fontPx,
        fontFamily: active.fontFamily, textStyle: active.textStyle, color: active.color, logicalPlane, outputMasks: active.outputMasks });
      adapter.commit();
      adapter.finalize();
      return true;
    },
    setPresentation(state) {
      if (disposed) return;
      presentation = state || { alphaFor: () => 1 };
      if (active) paint(active);
      if (pending) paint(pending);
    },
    setOpacity(value) {
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('invalid Canvas name opacity');
      opacity = value;
    },
    setRevealSeconds(value) {
      if (!Number.isFinite(value) || value < 0 || value > NAME_FIELD_REVEAL_DURATION_MS / 1000)
        throw new Error('invalid Canvas name reveal time');
      revealSeconds = value;
    },
    setSelectedPid(value) { selectedPid = value == null ? null : String(value); },
    commit() {
      if (!pending) throw new Error('no prepared name canvas');
      previous = active; hasRollback = true; active = pending; pending = null;
      return { source: active.canvas };
    },
    rollback() { if (hasRollback) { active = previous; previous = null; hasRollback = false; } else pending = null; },
    finalize() { previous = null; hasRollback = false; },
    descriptor() { return active ? { source: active.canvas, opacity, contentVersion: active.contentVersion, clip: active.clip,
      revealVertices: active.revealVertices, revealSeconds,
      selectedIndex: active.indexByPid.get(selectedPid) ?? -1 } : null; },
    dispose() { disposed = true; pending = null; previous = null; hasRollback = false; active = null; },
  };
  return adapter;
}
