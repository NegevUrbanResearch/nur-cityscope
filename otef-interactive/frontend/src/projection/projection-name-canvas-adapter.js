import { planeToOutputUv } from '../shared/projection-config-geometry.js';
import { nameRevealSchedule, NAME_FIELD_MOTION } from '../shared/nli-name-field-animation.js';

const WIDTH = 1920;
const HEIGHT = 1080;

/** A candidate becomes visible only after commit; visibility never repaints its glyphs. */
export function createProjectionNameCanvasAdapter({ document = globalThis.document, output } = {}) {
  if (!['left', 'right'].includes(output)) throw new Error('name adapter output must be left or right');
  let pending = null, active = null, previous = null, hasRollback = false, disposed = false;
  let opacity = 0, revealSeconds = 0, selectedPid = null;
  let presentation = { alphaFor: () => 1 }, version = 0;
  const paint = (entry) => {
    const { canvas, ctx, placements, matrix, fontPx, fontFamily, color } = entry;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    ctx.save();
    ctx.setTransform(...matrix);
    ctx.font = `${fontPx}px "${fontFamily}"`;
    ctx.fillStyle = color;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.direction = 'rtl';
    for (const name of placements) {
      const alpha = presentation.alphaFor?.(name.id, name) ?? 1;
      if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new Error('invalid Canvas name focus opacity');
      if (!alpha) continue;
      ctx.globalAlpha = alpha;
      ctx.strokeText?.(name.name, name.x, name.y);
      ctx.fillText(name.name, name.x, name.y);
    }
    ctx.restore();
    entry.contentVersion = ++version;
  };
  return {
    prepare({ config, placements, fontPx = 12, fontFamily = 'Guttman Hatzvi', color = '#fff', logicalPlane } = {}) {
      if (disposed) throw new Error('name adapter is disposed');
      if (!config || !Array.isArray(placements) || !Number.isFinite(logicalPlane?.heading) ||
          !Number.isFinite(logicalPlane?.planeScale)) throw new Error('incomplete name canvas candidate');
      const canvas = document?.createElement?.('canvas');
      if (!canvas) throw new Error('name canvas is unavailable');
      canvas.width = WIDTH; canvas.height = HEIGHT;
      const ctx = canvas.getContext?.('2d');
      if (!ctx) throw new Error('name canvas 2D context is unavailable');
      const origin = planeToOutputUv([0, 0], config, output, logicalPlane);
      const xUnit = planeToOutputUv([1, 0], config, output, logicalPlane);
      const yUnit = planeToOutputUv([0, 1], config, output, logicalPlane);
      const matrix = [(xUnit.u - origin.u) * WIDTH, (xUnit.v - origin.v) * HEIGHT,
        (yUnit.u - origin.u) * WIDTH, (yUnit.v - origin.v) * HEIGHT,
        origin.u * WIDTH, origin.v * HEIGHT];
      const own = placements.filter((item) => item.output === output);
      if (own.some((item) => !item.id || !item.name || ![item.x, item.y, item.width, item.height].every(Number.isFinite)))
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
      pending = { canvas, ctx, placements: own, matrix, fontPx, fontFamily, color,
        revealVertices: new Float32Array(vertices), indexByPid };
      paint(pending);
      return { source: canvas };
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
      if (!Number.isFinite(value) || value < 0 || value > (NAME_FIELD_MOTION.spreadMs + NAME_FIELD_MOTION.revealMs) / 1000)
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
    descriptor() { return active ? { source: active.canvas, opacity, contentVersion: active.contentVersion,
      revealVertices: active.revealVertices, revealSeconds,
      selectedIndex: active.indexByPid.get(selectedPid) ?? -1 } : null; },
    dispose() { disposed = true; pending = null; previous = null; hasRollback = false; active = null; },
  };
}
