/** Build a chronological rail from the occupied hours in a presenter window. */
export function buildPresenterRail(beats, {
  height: requestedHeight, padding = 8, minSegment = 22, gap = 18, labelHeight = 16, browseKey = null,
} = {}) {
  const height = finiteNonnegative(requestedHeight);
  const empty = { height, points: [], segments: [], breaks: [], marks: [] };
  if (!Array.isArray(beats) || beats.length === 0) return empty;

  const chronological = beats
    .filter((beat) => beat && typeof beat.key === "string" && Number.isFinite(beat.minute))
    .map((beat, index) => ({ ...beat, index }))
    .sort((a, b) => a.minute - b.minute || a.index - b.index);
  if (!chronological.length) return empty;

  const groups = [];
  for (const beat of chronological) {
    const hour = Math.floor(beat.minute / 60);
    let group = groups.at(-1);
    if (!group || group.hour !== hour) groups.push(group = { hour, beats: [] });
    group.beats.push(beat);
  }

  const gapAfter = groups.slice(0, -1).map((group, index) => groups[index + 1].hour - group.hour > 1);
  const breakCount = gapAfter.filter(Boolean).length;
  const wantedPadding = finiteNonnegative(padding);
  const wantedGap = finiteNonnegative(gap);
  // Keep segment space positive, even when a short rail cannot fit nominal gaps and padding.
  const segmentBudget = height === 0 ? 0 : Math.max(Math.min(height, 1), height - 2 * wantedPadding - breakCount * wantedGap);
  const overheadBudget = Math.max(0, height - segmentBudget);
  const overheadWanted = 2 * wantedPadding + breakCount * wantedGap;
  const overheadScale = overheadWanted > 0 ? overheadBudget / overheadWanted : 0;
  const fittedPadding = wantedPadding * overheadScale;
  const fittedGap = wantedGap * overheadScale;
  const usableHeight = segmentBudget;
  const minimum = Math.min(finiteNonnegative(minSegment), groups.length ? usableHeight / groups.length : 0);
  const remaining = Math.max(0, usableHeight - minimum * groups.length);
  const totalBeats = chronological.length;
  const labelSize = finitePositive(labelHeight, 16);
  const rail = { ...empty, points: [], segments: [], breaks: [], marks: [] };

  if (height === 0) {
    rail.segments = groups.map((group) => ({ hour: group.hour, start: 0, end: 0, count: group.beats.length }));
    rail.points = chronological.map((beat) => ({ key: beat.key, minute: beat.minute, y: 0 }));
    rail.marks = groups.map((group) => ({ y: 0, label: null, kind: "hour" }));
    return rail;
  }

  if (chronological.length === 1) {
    const beat = chronological[0];
    const hour = Math.floor(beat.minute / 60);
    const y = height / 2;
    rail.segments = [{ hour, start: 0, end: height, count: 1 }];
    rail.points = [{ key: beat.key, minute: beat.minute, y }];
    rail.marks = [{ y: 0, label: hourLabel(hour), kind: "hour" }];
    return rail;
  }

  let cursor = fittedPadding;
  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    const length = minimum + remaining * group.beats.length / totalBeats;
    const start = cursor;
    const end = start + length;
    rail.segments.push({ hour: group.hour, start, end, count: group.beats.length });
    rail.marks.push({ y: start, label: hourLabel(group.hour), kind: "hour", hour: group.hour, labelY: start });
    const firstMinute = group.beats[0].minute;
    const lastMinute = group.beats.at(-1).minute;
    const firstY = yFor(firstMinute, firstMinute, lastMinute, start, end);
    const lastY = yFor(lastMinute, firstMinute, lastMinute, start, end);
    let previousQuarterY = null;
    for (const quarter of [15, 30, 45]) {
      const minute = group.hour * 60 + quarter;
      if (minute <= firstMinute || minute >= lastMinute) continue;
      const y = yFor(minute, firstMinute, lastMinute, start, end);
      if (Math.min(Math.abs(y - firstY), Math.abs(lastY - y)) < 8) continue;
      if (previousQuarterY !== null && y - previousQuarterY < 8) continue;
      rail.marks.push({ y, label: null, kind: "quarter", hour: group.hour, minute });
      previousQuarterY = y;
    }
    for (const beat of group.beats) rail.points.push({ key: beat.key, minute: beat.minute, y: yFor(beat.minute, firstMinute, lastMinute, start, end) });
    cursor = end;
    if (i < groups.length - 1 && gapAfter[i]) {
      const next = groups[i + 1];
      const breakStart = cursor;
      const breakEnd = cursor + fittedGap;
      rail.breaks.push({ start: breakStart, end: breakEnd,
        beforeKey: group.beats.at(-1).key, afterKey: next.beats[0].key,
        omittedStartHour: group.hour + 1, omittedEndHour: next.hour - 1 });
      rail.marks.push({ y: (breakStart + breakEnd) / 2, label: null, kind: "break" });
      cursor = breakEnd;
    }
  }

  // Keep ticks at their allocated positions while suppressing labels that collide.
  const hours = rail.marks.filter((mark) => mark.kind === "hour");
  const first = hours[0];
  const last = hours.at(-1);
  if (height >= labelSize * 2 + 8) {
    const firstBeat = chronological[0];
    const lastBeat = chronological.at(-1);
    const firstPoint = rail.points.find((item) => item.key === firstBeat.key);
    const lastPoint = rail.points.find((item) => item.key === lastBeat.key);
    const addEndpoint = (beat, point) => {
      rail.marks.push({ y: point.y, labelY: point.y, label: timeLabel(beat.minute), kind: "endpoint", minute: beat.minute, lane: "minute" });
    };
    if (lastBeat.minute !== firstBeat.minute && Math.abs(lastPoint.y - firstPoint.y) >= labelSize + 4) {
      addEndpoint(firstBeat, firstPoint);
      addEndpoint(lastBeat, lastPoint);
    }
  }
  const browseHour = chronological.find((beat) => beat.key === browseKey);
  const browseTick = browseHour ? hours.find((mark) => mark.hour === Math.floor(browseHour.minute / 60)) : null;
  if (first && last) {
    first.labelY = Math.min(Math.max(first.y, labelSize / 2), height - labelSize / 2);
    last.labelY = Math.min(Math.max(last.y, labelSize / 2), height - labelSize / 2);
    if (first === last) first.labelY = first.y;
    else if (Math.abs(last.labelY - first.labelY) < labelSize + 4) {
      first.lane = "start";
      last.lane = "end";
    }
  }
  const selected = new Set([first, last].filter(Boolean));
  if (browseTick && browseTick !== first && browseTick !== last) selected.add(browseTick);
  // Browse copy uses its own side lane, so it can remain visible when static labels crowd it.
  if (browseTick) browseTick.lane = "browse";
  const visible = hours.filter((mark) => selected.has(mark) && mark.label);
  const spacing = labelSize + 4;
  for (const mark of hours) {
    if (selected.has(mark)) continue;
    if (visible.some((item) => (item.lane ?? "static") === "static" && Math.abs((item.labelY ?? item.y) - mark.labelY) < spacing)) mark.label = null;
    else visible.push(mark);
  }
  return rail;
}

export function presenterRailY(rail, key) {
  return rail?.points?.find((point) => point.key === key)?.y ?? null;
}

export function presenterRailKeyAtY(rail, y) {
  const points = rail?.points ?? [];
  if (!points.length) return null;
  const height = finiteNonnegative(rail.height);
  const clamped = Math.max(0, Math.min(height, Number.isFinite(y) ? y : 0));
  let best = points[0];
  for (const point of points.slice(1)) {
    if (Math.abs(point.y - clamped) < Math.abs(best.y - clamped) - 1e-9) best = point;
  }
  return best.key;
}

function yFor(minute, first, last, start, end) {
  if (first === last) return (start + end) / 2;
  return start + (end - start) * (0.01 + 0.98 * ((minute - first) / (last - first)));
}
function hourLabel(hour) { return String(hour).padStart(2, "0"); }
function timeLabel(minute) { return `${hourLabel(Math.floor(minute / 60))}:${String(minute % 60).padStart(2, "0")}`; }
function finiteNonnegative(value) { return Number.isFinite(value) ? Math.max(0, value) : 0; }
function finitePositive(value, fallback) { return Number.isFinite(value) && value > 0 ? value : fallback; }
