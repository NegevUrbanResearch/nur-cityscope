import { createNameFieldGeometry } from './nli-name-field-geometry.js';
import { resolveNliLocation } from './nli-name-field-places.js';
import { nameWallRowSpans, rectCoveredByPieces, rectIntersectsPieces, ringContainsGuardedRect, validNameWallRing } from './nli-name-wall-coverage.js';
import { partitionNameWallCoverage } from './nli-name-wall-output-mask.js';
import { sha256Hex } from './sha256-hex.js';
import { inwardPageTravel } from './nli-name-wall-inward-travel.js';
import { modelNameTextBounds, MODEL_NAME_ANTIALIAS_GUARD } from './nli-name-wall-text-bounds.js';
import { nameTextStyle } from './nli-name-language.js';

const SIDES = ['left', 'right'];
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const round = (value) => Math.round(value * 1e6) / 1e6;
const compare = (a, b, language) => a.orderKey.localeCompare(b.orderKey, language, { sensitivity: 'base', numeric: true }) || a.pid.localeCompare(b.pid);
const keySort = (value) => Array.isArray(value) ? value.map(keySort) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, keySort(value[key])])) : value;
const boxOf = (pieces) => {
  const points = pieces.flatMap((piece) => piece.polygon);
  return { x0: Math.min(...points.map((p) => p[0])), x1: Math.max(...points.map((p) => p[0])),
    y0: Math.min(...points.map((p) => p[1])), y1: Math.max(...points.map((p) => p[1])) };
};

function metricRectangle(metric, size) {
  if (!metric || !['width', 'left', 'right', 'ascent', 'descent'].every((key) => finite(metric[key])) ||
      metric.width <= 0 || metric.ascent < 0 || metric.descent < 0) throw new Error(`invalid font metrics at ${size}px`);
  return { width: 2 * Math.max(metric.width / 2, metric.left, metric.right) + 6,
    height: 2 * Math.max(metric.ascent, metric.descent) + 4 };
}

function overlapCount(placements, sharedPlane = false) {
  let count = 0;
  const ordered = placements.slice().sort((a, b) => (sharedPlane ? 0 : a.output.localeCompare(b.output)) || a.y - b.y);
  for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length && (sharedPlane || ordered[j].output === ordered[i].output); j++) {
    const a = ordered[i], b = ordered[j];
    if (b.y - a.y > Math.max(a.height, b.height)) break;
    if (Math.abs(a.x - b.x) < (a.width + b.width) / 2 - 1e-7 && Math.abs(a.y - b.y) < (a.height + b.height) / 2 - 1e-7) count++;
  }
  return count;
}

const MODEL_ALGORITHM = 'union-justified-min-gap-adaptive-vertical-owned-mask-v6';
const MODEL_PITCH_SAMPLES = 24;
const MODEL_PITCH_REFINEMENTS = 12;
function modelScanSpans(dimensions, profile, coverage, ring, unionBox, rowPitch = null, direction = 'rtl') {
  const rowHeight = Math.max(...[...dimensions.values()].map((item) => item.height));
  const pitch = rowPitch ?? rowHeight + profile.spacingPx, result = [];
  const ringBox = boxOf([{ polygon: ring }]);
  const guard = MODEL_NAME_ANTIALIAS_GUARD;
  const rowOrigin = Math.max(unionBox.y0 + guard, ringBox.y0 + profile.edgeInsetPx + guard);
  const yLimit = Math.min(unionBox.y1 - guard, ringBox.y1 - profile.edgeInsetPx - guard);
  for (let y = rowOrigin + rowHeight / 2; y + rowHeight / 2 <= yLimit + 1e-7; y += pitch) {
    const spans = nameWallRowSpans(coverage, { outputs: SIDES, y0: y - rowHeight / 2, y1: y + rowHeight / 2,
      inset: guard, ringInset: profile.edgeInsetPx + guard, ring });
    for (const [left, right] of direction === 'ltr' ? spans : spans.slice().reverse()) result.push({ y, left, right });
  }
  return result;
}

function packModelStream(items, dimensions, profile, spans, ownedPieces, collect = true, direction = 'rtl') {
  const result = collect ? [] : null;
  let index = 0;
  let usedSpans = 0;
  let lastUsedY = null;
  for (const { y, left, right } of spans) {
    if (index === items.length) break;
    const budget = right - left;
    let used = 0, count = 0;
    const first = index;
    while (index < items.length) {
      const row = items[index], measure = dimensions.get(row.name);
      const next = measure.width + (count ? profile.spacingPx : 0);
      if (used + next > budget + 1e-7) break;
      used += next;
      count++; index++;
    }
    if (!count) continue;
    usedSpans++;
    lastUsedY = y;
    if (!collect) continue;
    const widthSum = used - profile.spacingPx * (count - 1);
    const gap = count > 1 ? (right - left - widthSum) / (count - 1) : 0;
    const step = direction === 'ltr' ? 1 : -1;
    let cursor = count === 1 ? (left + right - step * widthSum) / 2 : (step === 1 ? left : right);
    for (let i = 0; i < count; i++) {
      const row = items[first + i], measure = dimensions.get(row.name);
      const rect = { x: cursor + step * measure.width / 2, y, width: measure.width, height: measure.height };
      const outputs = SIDES.filter((side) => rectIntersectsPieces(rect, ownedPieces[side]));
      if (!outputs.length) return null;
      result.push({ id: row.pid, name: row.name, output: outputs[0], outputs, x: rect.x, y,
        width: measure.width, height: measure.height, textOffsetX: measure.textOffsetX, textOffsetY: measure.textOffsetY });
      cursor += step * (measure.width + gap);
    }
  }
  return index === items.length ? { placements: result, usedSpans, lastUsedY } : null;
}

/** Stretch row pitch while keeping greedy horizontal fit unchanged and checking actual coverage. */
function chooseModelPacking(items, dimensions, profile, coverage, ring, unionBox, ownedPieces, direction) {
  const rowHeight = Math.max(...[...dimensions.values()].map((item) => item.height));
  const minPitch = rowHeight + profile.spacingPx;
  const scan = (pitch) => {
    const spans = modelScanSpans(dimensions, profile, coverage, ring, unionBox, pitch, direction);
    const packed = packModelStream(items, dimensions, profile, spans, ownedPieces, false, direction);
    return packed && { ...packed, spans, pitch };
  };
  let best = scan(minPitch);
  if (!best) return null;
  const firstY = best.spans[0].y;
  const ringBox = boxOf([{ polygon: ring }]);
  const lastY = Math.min(unionBox.y1, ringBox.y1 - profile.edgeInsetPx) - MODEL_NAME_ANTIALIAS_GUARD - rowHeight / 2 - 1e-6;
  const height = Math.max(0, lastY - firstY);
  const widest = Math.max(...best.spans.map((span) => span.right - span.left));
  const total = items.reduce((sum, item) => sum + dimensions.get(item.name).width + profile.spacingPx, 0);
  const minimumRows = Math.max(2, Math.ceil(total / (widest + profile.spacingPx)));
  const maxPitch = Math.max(minPitch, height / (minimumRows - 1));
  const candidates = [{ pitch: minPitch, packed: best }];
  const consider = (candidate) => {
    if (candidate && (candidate.lastUsedY > best.lastUsedY + PAGE_EPS ||
      (Math.abs(candidate.lastUsedY - best.lastUsedY) <= PAGE_EPS && candidate.pitch > best.pitch))) best = candidate;
  };
  // Sample the whole bounded range: irregular polygons do not have strictly monotonic capacity.
  for (let step = 1; step <= MODEL_PITCH_SAMPLES; step++) {
    const pitch = minPitch * (maxPitch / minPitch) ** (step / MODEL_PITCH_SAMPLES);
    const packed = scan(pitch);
    candidates.push({ pitch, packed });
    consider(packed);
  }
  // Refine every feasible-to-infeasible boundary, retaining the known valid fallback throughout.
  for (let i = 1; i < candidates.length; i++) {
    if (!candidates[i - 1].packed || candidates[i].packed) continue;
    let low = candidates[i - 1].pitch, high = candidates[i].pitch;
    for (let step = 0; step < MODEL_PITCH_REFINEMENTS; step++) {
      const pitch = (low + high) / 2, packed = scan(pitch);
      if (packed) { low = pitch; consider(packed); } else high = pitch;
    }
  }
  return { safeSpans: best.spans.length, rowPitch: best.pitch,
    ...packModelStream(items, dimensions, profile, best.spans, ownedPieces, true, direction) };
}

const PAGE_ALGORITHM = 'fixed-pitch-page-minimax-inward-v2';
const PAGE_EPS = 1e-7;
function intersectPageSpans(a, b) {
  const result = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const left = Math.max(a[i][0], b[j][0]), right = Math.min(a[i][1], b[j][1]);
    if (right > left + PAGE_EPS) result.push([left, right]);
    if (a[i][1] < b[j][1]) i++; else j++;
  }
  return result;
}

function minimumRows(items, dimensions, width, spacing) {
  let rows = 0, index = 0;
  while (index < items.length) {
    let used = 0, count = 0;
    while (index < items.length) {
      const next = dimensions.get(items[index].name).width + (count ? spacing : 0);
      if (used + next > width + PAGE_EPS) break;
      used += next;
      count++; index++;
    }
    if (!count) return Infinity;
    rows++;
  }
  return rows;
}

function chooseRegularPage(items, output, dimensions, profile, coverage, origin, yLimit, rowHeight) {
  const pitch = rowHeight + profile.spacingPx;
  const bands = [];
  for (let y0 = origin; y0 + pitch <= yLimit + PAGE_EPS; y0 += pitch) {
    bands.push(nameWallRowSpans(coverage, { output, y0, y1: y0 + pitch, inset: profile.edgeInsetPx }));
  }
  const candidates = [];
  for (let first = 0; first < bands.length; first++) {
    let spans = bands[first];
    for (let last = first; last < bands.length && spans.length; last++) {
      if (last !== first) spans = intersectPageSpans(spans, bands[last]);
      const rows = last - first + 1, y0 = origin + first * pitch, y1 = origin + (last + 1) * pitch;
      for (const [left, right] of spans) {
        const width = right - left, area = width * (y1 - y0);
        const requiredRows = minimumRows(items, dimensions, width, profile.spacingPx);
        if (requiredRows > rows || (items.length > 1 && requiredRows > Math.floor(items.length / 2))) continue;
        candidates.push({ left, right, y0, y1, rows, first, width, area });
      }
    }
  }
  candidates.sort((a, b) => b.area - a.area || b.width - a.width || a.first - b.first || b.right - a.right);
  for (const candidate of candidates) {
    const lines = minimaxRegularLines(items, dimensions, candidate.width, profile.spacingPx, candidate.rows);
    if (!lines) continue;
    const rect = { x: (candidate.left + candidate.right) / 2, y: (candidate.y0 + candidate.y1) / 2,
      width: candidate.width, height: candidate.y1 - candidate.y0 };
    if (rectCoveredByPieces(rect, coverage.pieces[output])) return { ...candidate, lines };
  }
  return null;
}

function minimaxRegularLines(items, dimensions, width, spacing, availableRows) {
  if (items.length === 1) return [[0, 1]];
  const n = items.length, prefix = [0];
  for (const item of items) prefix.push(prefix.at(-1) + dimensions.get(item.name).width);
  const line = (i, j) => {
    const count = j - i, sum = prefix[j] - prefix[i];
    return count >= 2 && sum + spacing * (count - 1) <= width + PAGE_EPS
      ? (width - sum) / (count - 1) : Infinity;
  };
  const minRows = minimumRows(items, dimensions, width, spacing);
  const maxRows = Math.min(availableRows, Math.floor(n / 2));
  if (!Number.isFinite(minRows) || minRows > maxRows) return null;
  let previous = Array(n + 1).fill(Infinity);
  previous[0] = 0;
  const parents = [];
  for (let rows = 1; rows <= maxRows; rows++) {
    const current = Array(n + 1).fill(Infinity), parent = Array(n + 1).fill(-1);
    for (let j = rows * 2; j <= n; j++) {
      for (let i = j - 2; i >= (rows - 1) * 2; i--) {
        const gap = line(i, j);
        if (!Number.isFinite(gap)) break;
        if (!Number.isFinite(previous[i])) continue;
        const cost = Math.max(previous[i], gap);
        if (cost < current[j] - PAGE_EPS) { current[j] = cost; parent[j] = i; }
      }
    }
    parents.push(parent);
    if (rows >= minRows && Number.isFinite(current[n])) {
      const result = [];
      for (let r = rows, j = n; r > 0; r--) {
        const i = parents[r - 1][j];
        result.unshift([i, j]); j = i;
      }
      return result;
    }
    previous = current;
  }
  return null;
}

function placeRegularSide(items, output, dimensions, profile, coverage, origin, yLimit, mapping, direction = 'rtl') {
  if (!items.length) return { placements: [], page: null };
  const rowHeight = Math.max(...[...dimensions.values()].map((item) => item.height));
  const pitch = rowHeight + profile.spacingPx;
  const page = chooseRegularPage(items, output, dimensions, profile, coverage, origin, yLimit, rowHeight);
  if (!page) return null;
  const lines = page.lines;
  const travel = profile.inwardShiftPercent && mapping ? inwardPageTravel({ page, occupiedRows: lines.length,
    pitch, output, ...mapping }) : 0;
  let rowOrigin = page.y0 + travel * (profile.inwardShiftPercent || 0) / 100;
  const position = () => {
    const placements = [];
    for (let row = 0; row < lines.length; row++) {
    const [start, end] = lines[row], count = end - start;
    const sum = items.slice(start, end).reduce((total, item) => total + dimensions.get(item.name).width, 0);
    const gap = count > 1 ? (page.width - sum) / (count - 1) : 0;
    const step = direction === 'ltr' ? 1 : -1;
    let cursor = step === 1 ? page.left : page.right;
    for (let i = start; i < end; i++) {
      const item = items[i], measure = dimensions.get(item.name);
      placements.push({ id: item.pid, name: item.name, output, x: cursor + step * measure.width / 2,
        y: rowOrigin + row * pitch + rowHeight / 2, width: measure.width, height: measure.height });
      cursor += step * (measure.width + gap);
    }
    }
    return placements;
  };
  let placements = position();
  if (rowOrigin !== page.y0 && placements.some((item) => !rectCoveredByPieces({ ...item,
    width: item.width + 2 * profile.edgeInsetPx, height: item.height + 2 * profile.edgeInsetPx }, coverage.pieces[output]))) {
    rowOrigin = page.y0;
    placements = position();
  }
  return { placements, page: { left: page.left, right: page.right, y0: page.y0, y1: page.y1,
    rowOrigin, inwardTravel: travel, singleton: items.length === 1, rows: lines.length, worstGap: Math.max(...lines.map(([i, j]) => j - i > 1
      ? (page.width - items.slice(i, j).reduce((sum, item) => sum + dimensions.get(item.name).width, 0)) / (j - i - 1) : 0)) } };
}

function emptyResult(payload, diagnostics) {
  return { placements: [], logicalPlane: payload.logicalPlane, geojson: { type: 'FeatureCollection', features: [] },
    groupGeojson: { type: 'FeatureCollection', features: [] }, byPid: new Map(), fontSize: null,
    heading: payload.logicalPlane?.heading, referenceZoom: payload.referenceZoom, overviewBounds: payload.overviewBounds,
    datasetVersion: payload.datasetVersion, language: payload.language || 'he', textStyle: payload.textStyle || nameTextStyle(payload.language), digest: null, diagnostics };
}

/** Pack names into calibrated output coverage, sharing one logical plane in Model mode. */
export async function buildNamesWallLayout(payload) {
  const started = performance.now();
  const language = payload.language === 'en' ? 'en' : 'he', textStyle = payload.textStyle || nameTextStyle(language);
  const { records, coverage, namesWall, datasetVersion, ringHash = null } = payload;
  const mode = namesWall?.activeMode, profile = namesWall?.profiles?.[mode], logicalPlane = payload.logicalPlane;
  const diagnostics = { state: 'invalid', reason: null, expected: records?.length ?? 0, placed: 0,
    missing: records?.length ?? 0, extra: 0, duplicate: 0, overlap: 0, invalidCoverage: 0,
    requestedFontPx: profile?.requestedFontPx, effectiveFontPx: null, activeMode: mode,
    profile, datasetVersion, coverageIdentity: payload.coverageIdentity || coverage?.outputIdentities,
    left: 0, right: 0 };
  const fail = (reason) => { diagnostics.reason = reason; return emptyResult(payload, diagnostics); };
  if (!Array.isArray(records) || !records.length || !profile || !coverage?.pieces?.left?.length ||
      !coverage?.pieces?.right?.length || !finite(logicalPlane?.heading) || !finite(logicalPlane?.planeScale) ||
      logicalPlane.planeScale <= 0) return fail('invalid wall inputs');
  const ids = records.map((row) => row.pid);
  diagnostics.duplicate = ids.length - new Set(ids).size;
  if (diagnostics.duplicate || records.some((row) => !row.pid || !row.name || !row.sourceCoordinates?.every(finite)))
    return fail('invalid name records or duplicate PID');
  if (!Number.isInteger(profile.requestedFontPx) || profile.requestedFontPx < 1 || profile.requestedFontPx > 48 ||
      !Number.isInteger(profile.spacingPx) || profile.spacingPx < 0 || profile.spacingPx > 32 ||
      !Number.isInteger(profile.edgeInsetPx) || profile.edgeInsetPx < 0 || profile.edgeInsetPx > 256) return fail('invalid wall profile');
  const ordered = records.slice().sort((a, b) => compare(a, b, language)), half = Math.ceil(ordered.length / 2);
  const halves = { left: ordered.slice(0, half), right: ordered.slice(half) };
  const metricSets = new Map(payload.metrics?.map(([size, values]) => [size, new Map(values)]));
  const boxes = Object.fromEntries(SIDES.map((side) => [side, boxOf(coverage.pieces[side])]));
  const modelPieces = mode === 'model' ? SIDES.flatMap((side) => coverage.pieces[side]) : null;
  const ownedCoverage = mode === 'model' ? partitionNameWallCoverage(coverage) : null;
  const origin = Math.min(boxes.left.y0, boxes.right.y0) + profile.edgeInsetPx;
  let ring = null;
  if (mode === 'model') {
    if (!Array.isArray(payload.ring) || payload.ring.length < 4 || !ringHash) return fail('invalid Tkuma ring');
    const geometry = payload.geometry && createNameFieldGeometry({ ...payload.geometry, heading: logicalPlane.heading });
    ring = geometry ? payload.ring.map(geometry.project) : payload.ring;
    if (!validNameWallRing(ring)) return fail('invalid Tkuma ring');
  } else if (mode !== 'wall') return fail('invalid wall mode');
  let chosen = null, effective = null, chosenPages = null, chosenModel = null;
  for (let size = profile.requestedFontPx; size >= 1; size--) {
    const metrics = metricSets.get(size);
    if (!metrics || ordered.some((row) => !metrics.has(row.name))) return fail(`missing font metrics at ${size}px`);
    let dimensions;
    try { dimensions = new Map(ordered.map((row) => [row.name, mode === 'model'
      ? modelNameTextBounds(metrics.get(row.name), profile.strokeWidthPx ?? 2) : metricRectangle(metrics.get(row.name), size)])); }
    catch (error) { return fail(error.message); }
    let placed = [], pages = {}, model = null;
    if (mode === 'model') {
      model = chooseModelPacking(ordered, dimensions, profile, coverage, ring, boxOf(modelPieces), ownedCoverage.pieces, textStyle.direction);
      if (!model) continue;
      placed = model.placements;
    } else {
      let complete = true;
      for (const side of SIDES) {
        const regular = placeRegularSide(halves[side], side, dimensions, profile, coverage,
          origin, boxes[side].y1 - profile.edgeInsetPx, { config: payload.config || payload.geometry?.projectionConfig,
            mesh: payload.meshes?.[side], logicalPlane }, textStyle.direction);
        if (!regular) { complete = false; break; }
        pages[side] = regular.page;
        placed.push(...regular.placements);
      }
      if (!complete) continue;
    }
    const invalid = placed.some((p) => {
      const inset = mode === 'model' ? MODEL_NAME_ANTIALIAS_GUARD : profile.edgeInsetPx;
      const expanded = { ...p, width: p.width + 2 * inset, height: p.height + 2 * inset };
      return !rectCoveredByPieces(expanded, modelPieces || coverage.pieces[p.output]) ||
        (ring && !ringContainsGuardedRect(ring, p, profile.edgeInsetPx + inset));
    });
    if (invalid || overlapCount(placed, mode === 'model')) continue;
    chosen = placed; effective = size; chosenPages = mode === 'wall' ? pages : null;
    chosenModel = model; break;
  }
  diagnostics.packMs = performance.now() - started;
  if (!chosen) return fail('name field capacity or calibration at 1px');
  const placedIds = chosen.map((p) => p.id), actual = new Set(placedIds), expected = new Set(ids);
  diagnostics.placed = chosen.length; diagnostics.missing = ids.filter((id) => !actual.has(id)).length;
  diagnostics.extra = placedIds.filter((id) => !expected.has(id)).length;
  diagnostics.duplicate += chosen.length - actual.size;
  diagnostics.overlap = overlapCount(chosen, mode === 'model');
  diagnostics.invalidCoverage = chosen.filter((p) => !rectCoveredByPieces(p, modelPieces || coverage.pieces[p.output])).length;
  if (diagnostics.missing || diagnostics.extra || diagnostics.duplicate || diagnostics.overlap || diagnostics.invalidCoverage)
    return fail('layout validation failed');
  const positions = new Map(chosen.map((p) => [p.id, p]));
  const geometry = payload.geometry && createNameFieldGeometry({ ...payload.geometry, heading: logicalPlane.heading });
  const groups = new Map(), byPid = new Map();
  const geojson = { type: 'FeatureCollection', features: ordered.map((row) => {
    const p = positions.get(row.pid), place = resolveNliLocation(row.location || '', language);
    const groupId = place.groupId || `unknown-${row.pid}`;
    if (!groups.has(groupId)) groups.set(groupId, { ...place, id: groupId, rows: [] });
    groups.get(groupId).rows.push(row);
    const feature = { type: 'Feature', id: row.pid, properties: { pid: row.pid, name: row.name,
      location: row.location || '', group_id: groupId, visible_spans: p.outputs || [p.output] },
    geometry: { type: 'Point', coordinates: geometry ? geometry.unproject([p.x, p.y]) : [p.x, p.y] } };
    byPid.set(row.pid, { feature, sourceCoordinates: row.sourceCoordinates.slice() });
    return feature;
  }) };
  const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const groupGeojson = { type: 'FeatureCollection', features: [...groups.values()].map((group) => ({
    type: 'Feature', properties: { group_id: group.id, name: group.label, source_name: group.sourceName,
      place_ids: group.placeId ? [group.placeId] : [], visible_spans: [] }, geometry: { type: 'Point',
      coordinates: group.anchorCoordinates || [median(group.rows.map((row) => row.sourceCoordinates[0])),
        median(group.rows.map((row) => row.sourceCoordinates[1]))] } })) };
  const calibration = payload.geometry?.projectionConfig;
  const digestInput = keySort({ datasetVersion, language, textStyle, logicalPlane,
    calibration: calibration && { pre: calibration.pre, outputs: calibration.outputs },
    coverageIdentity: payload.coverageIdentity || coverage.outputIdentities, fontIdentity: payload.fontIdentity,
    mode, profile, innerEdgeInsetPx: namesWall.innerEdgeInsetPx, effective,
    ringHash: mode === 'model' ? ringHash : null,
    ...(mode === 'wall' ? { pageAlgorithm: PAGE_ALGORITHM, pages: chosenPages } : {
      modelAlgorithm: MODEL_ALGORITHM, outputMasks: ownedCoverage.pieces }),
    placements: chosen.map((p) => ({ ...p, x: round(p.x), y: round(p.y), width: round(p.width), height: round(p.height),
      ...(mode === 'model' ? { textOffsetX: round(p.textOffsetX), textOffsetY: round(p.textOffsetY) } : {}) })) });
  const digest = await sha256Hex(new TextEncoder().encode(JSON.stringify(digestInput)));
  diagnostics.state = 'valid'; diagnostics.reason = null; diagnostics.effectiveFontPx = effective;
  if (chosenModel) {
    diagnostics.modelSafeSpans = chosenModel.safeSpans;
    diagnostics.modelUsedSpans = chosenModel.usedSpans;
    diagnostics.modelRowPitch = chosenModel.rowPitch;
  }
  diagnostics.left = chosen.filter((p) => p.output === 'left').length;
  diagnostics.right = chosen.length - diagnostics.left;
  return { placements: chosen, ...(mode === 'wall' ? { pages: chosenPages } : {
    outputMasks: Object.fromEntries(SIDES.map((side) => [side, ownedCoverage.pieces[side].map((piece) => piece.polygon)])) }), logicalPlane, geojson, groupGeojson, byPid, fontSize: effective,
    heading: logicalPlane.heading, referenceZoom: payload.referenceZoom ?? geometry?.referenceZoom,
    overviewBounds: payload.overviewBounds ?? geometry?.overviewBounds, datasetVersion, language, textStyle, digest, diagnostics };
}
