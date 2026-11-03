import { resolveMotionMode } from "./reduced-motion.js";

const FADE_MS = 600;
const MOVE_MS = 300;
const clock = () => globalThis.performance?.now?.() ?? Date.now();
const mix = (from, to, fraction) => from + (to - from) * fraction;

function tween(value, target, time, duration) {
  return { from: value, value, target, start: time, duration: duration * Math.abs(target - value) };
}

function sampleTween(channel, time) {
  const fraction = channel.duration ? Math.min(1, Math.max(0, (time - channel.start) / channel.duration)) : 1;
  channel.value = mix(channel.from, channel.target, fraction);
  return fraction < 1;
}

/** Shared retained-row motion for DOM and canvas legends. Coordinates are CSS pixels. */
export function createLegendMotion({ now = clock, motionMode = resolveMotionMode, interpolateData } = {}) {
  const rows = new Map();
  let visibility = tween(0, 0, 0, 0);
  let initialized = false;
  let order = [];

  function move(row, time, duration) {
    const { x, y, scale } = row.destination;
    if (!row.geometryPending && row.position?.x === x && row.position?.y === y && row.position?.scale === scale) return;
    row.position = { fromX: row.x, fromY: row.y, fromScale: row.scale, fromData: row.data,
      toData: row.nextData, x, y, scale, start: time, duration };
    row.geometryPending = false;
  }

  function sample(time = now()) {
    const reduced = motionMode() === "reduced";
    if (reduced) visibility.duration = 0;
    let moving = sampleTween(visibility, time);
    for (const [id, row] of rows) {
      if (reduced) row.alpha.duration = 0;
      moving = sampleTween(row.alpha, time) || moving;
      if (!row.desired && row.alpha.value === 0) rows.delete(id);
    }
    const departing = [...rows.values()].some(row => !row.desired);
    for (const row of rows.values()) {
      if (row.desired && !departing) move(row, time, reduced ? 0 : MOVE_MS);
      if (!row.position) continue;
      if (reduced) row.position.duration = 0;
      const p = row.position;
      const fraction = p.duration ? Math.min(1, (time - p.start) / p.duration) : 1;
      const eased = fraction * fraction * (3 - 2 * fraction);
      row.x = mix(p.fromX, p.x, eased);
      row.y = mix(p.fromY, p.y, eased);
      row.scale = mix(p.fromScale, p.scale, eased);
      if (interpolateData) row.data = interpolateData(p.fromData, p.toData, eased);
      moving = fraction < 1 || moving;
    }
    if (visibility.value === 0 && visibility.target === 0) rows.clear();
    const ordered = [...new Set([...order, ...rows.keys()])].filter(id => rows.has(id));
    return {
      opacity: visibility.value,
      moving,
      rows: ordered.map(id => {
        const row = rows.get(id);
        return { id, x: row.x, y: row.y, scale: row.scale, opacity: row.alpha.value, data: row.data, departing: !row.desired };
      }),
    };
  }

  function update(entries, { visible = entries.length > 0, immediate = false } = {}) {
    const time = now();
    sample(time);
    const duration = immediate || motionMode() === "reduced" ? 0 : FADE_MS;
    const targetVisibility = visible ? 1 : 0;
    if (visibility.target !== targetVisibility) visibility = tween(visibility.value, targetVisibility, time, duration);
    const desired = new Set(entries.map(entry => entry.id));
    const appearing = !initialized || visibility.from === 0 && visibility.value === 0;
    for (const entry of entries) {
      const destination = { x: entry.x || 0, y: entry.y || 0, scale: entry.scale ?? 1 };
      let row = rows.get(entry.id);
      if (!row) {
        const alpha = appearing ? 1 : 0;
        row = { ...destination, data: entry.data, nextData: entry.data, desired: true,
          alpha: tween(alpha, 1, time, duration), destination };
        rows.set(entry.id, row);
      } else {
        if (interpolateData) {
          if (JSON.stringify(row.nextData) !== JSON.stringify(entry.data)) {
            row.nextData = entry.data;
            row.geometryPending = true;
          }
        } else { row.data = entry.data; row.nextData = entry.data; }
        row.destination = destination;
        row.desired = true;
        if (row.alpha.target !== 1) row.alpha = tween(row.alpha.value, 1, time, duration);
      }
    }
    for (const [id, row] of rows) {
      if (desired.has(id)) continue;
      // Whole-legend departure preserves the rows until the container fades away.
      if (!visible) continue;
      row.desired = false;
      if (row.alpha.target !== 0) row.alpha = tween(row.alpha.value, 0, time, duration);
    }
    order = entries.map(entry => entry.id);
    initialized = true;
    if (immediate) {
      visibility.duration = 0;
      for (const row of rows.values()) {
        row.alpha.duration = 0; row.data = row.nextData; row.geometryPending = false;
        Object.assign(row, row.destination);
        row.position = { ...row.destination, fromX: row.x, fromY: row.y, fromScale: row.scale,
          fromData: row.data, toData: row.data, start: time, duration: 0 };
      }
    }
    return sample(time);
  }

  return { update, sample, clear: () => { rows.clear(); visibility = tween(0, 0, now(), 0); } };
}
