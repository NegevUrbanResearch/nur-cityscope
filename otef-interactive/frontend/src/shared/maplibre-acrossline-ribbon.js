/**
 * AcrossLine ribbon tessellator and MapLibre custom layer.
 * Color mixes across width (v); taper and reveal run along path (u).
 */

import { NLI_DISPLAY_PROFILES } from "./nli-investigation-theme.js";

const FROM_COLOR = "#f5f500";
const TO_COLOR = "#f50000";
const GRADIENT_SIZE = 0.75;
const PT_TO_PX = 96 / 72;
const STAGGER_STEP_MS = 300;
const STAGGER_MOD = 8;
const REVEAL_MIN_MS = 4000;
const REVEAL_MAX_MS = 5000;
const REVEAL_REF_METERS = 20000;
const CAP_SEGMENTS = 8;
const MITER_LIMIT = 4;
const DEPTH_ID_SCALE = 1e-6;
const FEATHER_PX = 1.5;
const MIN_CORE_HALF_PX = 0.75;
const OVERLAP_CLASS_BREAKS = Object.freeze([
  Object.freeze([13, 0.5]),
  Object.freeze([39, 1.375]),
  Object.freeze([100, 2.25]),
  Object.freeze([146, 3.125]),
  Object.freeze([235, 4]),
]);

export const TESSELLATION_STRIDE = 7;

export const NOVA_RIBBON_DISPLAY_PROFILES = Object.freeze({
  gis: Object.freeze({ lineWidthMultiplier: 6, routeScale: 1 }),
  projection: Object.freeze({ lineWidthMultiplier: 6, routeScale: 1 }),
});

export const RIBBON_COLOR_DEPTH_FUNC = "LEQUAL";

export function ribbonColorDepthFunc(gl) {
  return gl?.[RIBBON_COLOR_DEPTH_FUNC] ?? gl?.LEQUAL;
}

export function mixAcrossLineColor(v, ir = {}) {
  const from = hexToRgb01(ir.fromColor || FROM_COLOR);
  const to = hexToRgb01(ir.toColor || TO_COLOR);
  const gradientSize = Number.isFinite(Number(ir.gradientSize))
    ? Number(ir.gradientSize)
    : GRADIENT_SIZE;
  const band = (1 - gradientSize) / 2;
  const t = clamp01(v);
  if (t <= band) return from;
  if (t >= 1 - band) return to;
  const rampT = (t - band) / gradientSize;
  return [
    lerp(from[0], to[0], rampT),
    lerp(from[1], to[1], rampT),
    lerp(from[2], to[2], rampT),
  ];
}

export function overlapClassWidthPt(count) {
  const value = Number(count);
  const numeric = Number.isFinite(value) ? value : 0;
  for (const [maxCount, widthPt] of OVERLAP_CLASS_BREAKS) {
    if (numeric <= maxCount) return widthPt;
  }
  return OVERLAP_CLASS_BREAKS[OVERLAP_CLASS_BREAKS.length - 1][1];
}

export function staggerDelayMs(objectId) {
  return (Number(objectId) % STAGGER_MOD) * STAGGER_STEP_MS;
}

export function revealDurationMs(geodesicMeters) {
  const t = clamp01(Number(geodesicMeters) / REVEAL_REF_METERS);
  return lerp(REVEAL_MIN_MS, REVEAL_MAX_MS, t);
}

export function ribbonWidthPx(widthPt, profile) {
  const resolved = resolveDisplayProfile(profile);
  return Number(widthPt) * PT_TO_PX * resolved.lineWidthMultiplier * resolved.routeScale;
}

export function taperedWidthPt(u, ir = {}) {
  const fromPt = Number(ir.taperFromWidthPt);
  const toPt = Number(ir.taperToWidthPt);
  const start = Number.isFinite(fromPt) ? fromPt : Number(ir.widthPt) || 0;
  const end = Number.isFinite(toPt) ? toPt : 0;
  return lerp(start, end, clamp01(u));
}

export function taperedHalfWidthPx(u, ir = {}, profile) {
  return ribbonWidthPx(taperedWidthPt(u, ir), profile) / 2;
}

export function inflatedHalfWidthPx(geometricHalfPx, featherPx = FEATHER_PX, minCoreHalfPx = MIN_CORE_HALF_PX) {
  const geometric = Math.max(0, Number(geometricHalfPx) || 0);
  const feather = Number.isFinite(Number(featherPx)) ? Number(featherPx) : FEATHER_PX;
  const minCore = Number.isFinite(Number(minCoreHalfPx)) ? Number(minCoreHalfPx) : MIN_CORE_HALF_PX;
  return Math.max(geometric, minCore) + Math.max(0, feather);
}

export function ribbonFeatherCoverage(dist, aa = 0, coreRatio = 1) {
  const d = Number(dist);
  if (!Number.isFinite(d) || d >= 1) return 0;
  if (d <= 0) return 1;
  const core = clamp01(Number.isFinite(Number(coreRatio)) ? Number(coreRatio) : 1);
  if (d < core) return 1;
  const width = Number(aa);
  const aaWidth = Number.isFinite(width) && width > 0 ? width : 0;
  return 1 - smoothstep01(Math.max(core - aaWidth, 0), 1, d);
}

function smoothstep01(edge0, edge1, x) {
  if (!(edge1 > edge0)) return x >= edge1 ? 1 : 0;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function tessellateRibbon(lineOrFeature, options = {}) {
  const ir = resolveRibbonIr(lineOrFeature, options);
  const coords = extractLineCoordinates(lineOrFeature);
  const profile = resolveDisplayProfile(options.profile ?? ir.profile);
  const unitsPerPx = Number.isFinite(Number(options.unitsPerPx)) ? Number(options.unitsPerPx) : 1;
  const path = buildPath(coords);
  const clipped = clipPath(path, 1);
  const mesh = extrudePath(clipped, ir, profile, unitsPerPx, {
    suppressStartCap: options.suppressStartCap === true,
    hub: options.hub,
    id: options.id ?? ir.id ?? 0,
  });
  mesh.dashed = false;
  mesh.taperFromWidthPt = ir.taperFromWidthPt;
  mesh.taperToWidthPt = ir.taperToWidthPt;
  mesh.profile = profile;
  mesh.progress = 1;
  mesh.blendedFragmentCount = 0;
  return mesh;
}

export function tessellateHub(fixture, options = {}) {
  const hub = fixture?.hub ? [...fixture.hub] : [0, 0];
  const lines = fixture?.lines || [];
  const strips = [];
  const centerlines = [];
  const hubVertices = [];
  let capCountAtHub = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const id = line.id ?? i;
    const coordinates = line.coordinates || line;
    const strip = tessellateRibbon(coordinates, {
      ...options,
      id,
      suppressStartCap: true,
      hub,
    });
    capCountAtHub += Number(strip.capCountAtHub) || 0;
    for (const vertex of strip.hubVertices) hubVertices.push(vertex);
    strips.push(strip);
    centerlines.push({ id, coordinates });
  }
  return {
    strips,
    centerlines,
    hub,
    hubVertices,
    capCountAtHub,
    blendedFragmentCount: 0,
    dashed: false,
  };
}

export function hubEnvelopeWidth(mesh) {
  const hub = mesh?.hub || [0, 0];
  const vertices = mesh?.hubVertices || [];
  let maxR = 0;
  for (const vertex of vertices) {
    const radius = Math.hypot(vertex[0] - hub[0], vertex[1] - hub[1]);
    if (radius > maxR) maxR = radius;
  }
  return 2 * maxR;
}

export function sampleWinningCenterlineIdsAroundHub(mesh, { radiusPx = 2, samples = 16 } = {}) {
  const hub = mesh?.hub || [0, 0];
  const centerlines = mesh?.centerlines || [];
  const winners = [];
  for (let i = 0; i < samples; i += 1) {
    const angle = (2 * Math.PI * i) / samples;
    const point = [
      hub[0] + radiusPx * Math.cos(angle),
      hub[1] + radiusPx * Math.sin(angle),
    ];
    let bestDist = Infinity;
    const tied = [];
    for (const centerline of centerlines) {
      const dist = distanceToPolyline(point, centerline.coordinates);
      if (dist < bestDist - 1e-9) {
        bestDist = dist;
        tied.length = 0;
        tied.push(centerline.id);
      } else if (Math.abs(dist - bestDist) <= 1e-9) {
        tied.push(centerline.id);
      }
    }
    tied.sort((a, b) => a - b);
    winners.push(tied.slice(0, 1));
  }
  return winners;
}

export function localWidthPtAt(mesh, u) {
  const profile = resolveDisplayProfile(mesh?.profile);
  const left = sampleSide(mesh?.left, u);
  const right = sampleSide(mesh?.right, u);
  if (!left || !right) return 0;
  const widthPx = Math.hypot(left[0] - right[0], left[1] - right[1]);
  const divisor = PT_TO_PX * profile.lineWidthMultiplier * profile.routeScale;
  return divisor === 0 ? 0 : widthPx / divisor;
}

export function encodeRibbonFragDepth(dist, objectId) {
  const depth = Number(dist) + ribbonIdBias(objectId);
  if (!Number.isFinite(depth) || depth <= 0) return 0;
  if (depth >= 1) return 1;
  return depth;
}

export function ribbonFrameAtProgress(progress) {
  return {
    layerType: "custom",
    usesLineGradient: false,
    progress: clamp01(progress),
    roundCapFront: true,
  };
}

export function buildRibbonVertexData(features, options = {}) {
  const list = Array.isArray(features) ? features : [];
  const resolvedProfile = resolveDisplayProfile(options.profile);
  const unitsPerPx = Number.isFinite(Number(options.unitsPerPx)) ? Number(options.unitsPerPx) : 1;
  const cache = options.cache instanceof Map ? options.cache : null;
  const projected = list.map((feature) => projectLineToMercator(extractLineCoordinates(feature)));
  const startCounts = countSharedStarts(projected);
  const profileKey = displayProfileKey(resolvedProfile);
  const suppressStartCaps = projected.map((coords) => (startCounts.get(startKey(coords)) || 0) > 1);
  const featureKeys = list.map((feature, index) => (
    featureTessellationKey(feature, index, projected[index], unitsPerPx, profileKey, suppressStartCaps[index])
  ));
  const aggKey = orderedAggregateKey(featureKeys, unitsPerPx, profileKey);
  const cachedAggregate = cache?.get(aggKey);
  if (cachedAggregate) {
    return {
      tessellationData: cachedAggregate.tessellationData,
      progressData: fillProgressData(list, cachedAggregate.featureVertexCounts, options),
      rebuiltCount: 0,
      vertexCount: cachedAggregate.vertexCount,
    };
  }
  if (cache) {
    const keep = new Set(featureKeys);
    for (const key of Array.from(cache.keys())) {
      if (!keep.has(key)) cache.delete(key);
    }
  }

  const parts = [];
  const featureVertexCounts = [];
  let rebuiltCount = 0;
  for (let i = 0; i < list.length; i += 1) {
    const feature = list[i];
    const id = featureId(feature, i);
    const featureKey = featureKeys[i];
    const cachedFeature = cache?.get(featureKey);
    if (cachedFeature) {
      parts.push(cachedFeature.vertexData);
      featureVertexCounts.push(cachedFeature.vertexCount);
      continue;
    }
    const coords = projected[i];
    if (!coords || coords.length < 2) {
      featureVertexCounts.push(0);
      continue;
    }
    rebuiltCount += 1;
    const mesh = tessellateRibbon(coords, {
      ...ribbonOptionsFromFeature(feature),
      profile: resolvedProfile,
      unitsPerPx,
      progress: 1,
      id,
      suppressStartCap: suppressStartCaps[i],
    });
    const vertexData = mesh.vertexData instanceof Float32Array
      ? mesh.vertexData
      : Float32Array.from(mesh.vertexData);
    const vertexCount = vertexData.length / TESSELLATION_STRIDE;
    if (cache) cache.set(featureKey, { vertexData, vertexCount });
    parts.push(vertexData);
    featureVertexCounts.push(vertexCount);
  }

  let totalFloats = 0;
  for (const part of parts) totalFloats += part.length;
  const tessellationData = new Float32Array(totalFloats);
  let offset = 0;
  for (const part of parts) {
    tessellationData.set(part, offset);
    offset += part.length;
  }
  const vertexCount = totalFloats / TESSELLATION_STRIDE;
  if (cache) {
    cache.set(aggKey, { tessellationData, vertexCount, featureVertexCounts });
  }
  return {
    tessellationData,
    progressData: fillProgressData(list, featureVertexCounts, options),
    rebuiltCount,
    vertexCount,
  };
}

export function createAcrossLineRibbonLayer({ id, profile, getFrame, onDrawable }) {
  const resolvedProfile = resolveDisplayProfile(profile);
  const layer = {
    id,
    type: "custom",
    renderingMode: "2d",
    onAdd(map, gl) {
      this.map = map;
      this.program = compileRibbonProgram(gl);
      this.buffer = gl.createBuffer();
      this.progressBuffer = gl.createBuffer();
      this._ribbonCache = new Map();
      this._tessellationData = undefined;
      this._progressCount = undefined;
      this.locations = this.program
        ? {
            matrix: gl.getUniformLocation(this.program, "u_matrix"),
            opacity: gl.getUniformLocation(this.program, "u_opacity"),
            pos: gl.getAttribLocation(this.program, "a_pos"),
            uv: gl.getAttribLocation(this.program, "a_uv"),
            radial: gl.getAttribLocation(this.program, "a_radial"),
            coreRatio: gl.getAttribLocation(this.program, "a_coreRatio"),
            idBias: gl.getAttribLocation(this.program, "a_idBias"),
            revealUntil: gl.getAttribLocation(this.program, "a_revealUntil"),
          }
        : null;
    },
    render(gl, matrix) {
      const frame = typeof getFrame === "function" ? getFrame() || {} : {};
      const projection = readProjectionMatrix(matrix);
      const features = listFrameFeatures(frame);
      const unitsPerPx = mercatorUnitsPerPixel(this.map);
      if (!this._ribbonCache) this._ribbonCache = new Map();
      const builtOptions = {
        unitsPerPx,
        featureProgress: (feature, index) => featureProgress(frame, feature, index),
        profile: resolvedProfile,
        cache: this._ribbonCache,
      };
      let built = buildRibbonVertexData(features, builtOptions);
      const resetOrigin = built.vertexCount > 0
        && typeof onDrawable === "function"
        && onDrawable() === true;
      if (resetOrigin) built = buildRibbonVertexData(features, builtOptions);
      drawRibbonVertices(gl, this, projection, built, frame.opacity);
      if (resetOrigin || progressIsRevealing(built.progressData)) requestRenderFrame(this.map);
    },
    onRemove(map, gl) {
      if (this.buffer) gl.deleteBuffer(this.buffer);
      if (this.progressBuffer) gl.deleteBuffer(this.progressBuffer);
      if (this.program) gl.deleteProgram(this.program);
      this.buffer = null;
      this.progressBuffer = null;
      this.program = null;
      this.map = null;
      this._ribbonCache = null;
      this._tessellationData = undefined;
      this._progressCount = undefined;
    },
  };
  return layer;
}

function fillProgressData(list, featureVertexCounts, options) {
  let vertexCount = 0;
  for (const count of featureVertexCounts) vertexCount += count;
  const progressData = new Float32Array(vertexCount);
  let offset = 0;
  for (let i = 0; i < list.length; i += 1) {
    const count = featureVertexCounts[i] || 0;
    const progress = typeof options.featureProgress === "function"
      ? clamp01(options.featureProgress(list[i], i))
      : clamp01(options.progress == null ? 1 : options.progress);
    if (count > 0) progressData.fill(progress, offset, offset + count);
    offset += count;
  }
  return progressData;
}

function displayProfileKey(profile) {
  return `${profile.lineWidthMultiplier}:${profile.routeScale}`;
}

function featureTessellationKey(feature, index, coords, unitsPerPx, profileKey, suppressStartCap) {
  const id = featureId(feature, index);
  return `${id}@${unitsPerPx}@${profileKey}@${geometrySignature(coords)}@${widthSignature(feature)}@${suppressStartCap ? 1 : 0}`;
}

function orderedAggregateKey(featureKeys, unitsPerPx, profileKey) {
  return `agg:${featureKeys.join("|")}@${unitsPerPx}@${profileKey}`;
}

function geometrySignature(coords) {
  if (!coords || coords.length === 0) return "0";
  let signature = String(coords.length);
  for (let i = 0; i < coords.length; i += 1) {
    signature += `:${coords[i][0]},${coords[i][1]}`;
  }
  return signature;
}

function widthSignature(feature) {
  const props = featureProperties(feature);
  const across = props.acrossLine && typeof props.acrossLine === "object" ? props.acrossLine : {};
  const count = across.count ?? props.COUNT_ ?? props.count ?? "";
  return `${count}:${across.taperFromWidthPt ?? ""}:${across.taperToWidthPt ?? ""}:${across.widthPt ?? ""}`;
}

function progressIsRevealing(progressData) {
  if (!progressData) return false;
  for (let i = 0; i < progressData.length; i += 1) {
    if (progressData[i] < 1) return true;
  }
  return false;
}

function ribbonIdBias(objectId) {
  const raw = Number(objectId);
  const id = Number.isFinite(raw) ? ((raw % 2048) + 2048) % 2048 : 0;
  return id * DEPTH_ID_SCALE;
}

function hexToRgb01(hex) {
  const n = Number.parseInt(String(hex).slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function resolveDisplayProfile(profile) {
  if (typeof profile === "string") {
    return NLI_DISPLAY_PROFILES[profile] || NLI_DISPLAY_PROFILES.gis;
  }
  if (profile && typeof profile === "object") {
    return {
      lineWidthMultiplier: Number(profile.lineWidthMultiplier) || 1,
      routeScale: Number(profile.routeScale) || 1,
    };
  }
  return NLI_DISPLAY_PROFILES.gis;
}

function resolveRibbonIr(lineOrFeature, options = {}) {
  const props = featureProperties(lineOrFeature);
  const across = props.acrossLine && typeof props.acrossLine === "object" ? props.acrossLine : {};
  const merged = { ...across, ...options };
  const count = merged.count ?? props.COUNT_ ?? props.count;
  let taperFromWidthPt = merged.taperFromWidthPt;
  let taperToWidthPt = merged.taperToWidthPt;
  if (taperFromWidthPt == null && count != null) {
    taperFromWidthPt = overlapClassWidthPt(count);
  }
  if (taperFromWidthPt == null) {
    taperFromWidthPt = merged.widthPt == null ? 1 : merged.widthPt;
  }
  if (taperToWidthPt == null) taperToWidthPt = 0;
  return {
    ...merged,
    count,
    taperFromWidthPt: Number(taperFromWidthPt),
    taperToWidthPt: Number(taperToWidthPt),
    fromColor: merged.fromColor || FROM_COLOR,
    toColor: merged.toColor || TO_COLOR,
    gradientSize: merged.gradientSize == null ? GRADIENT_SIZE : merged.gradientSize,
    id: merged.id ?? props.OBJECTID,
  };
}

function featureProperties(lineOrFeature) {
  if (!lineOrFeature || Array.isArray(lineOrFeature)) return {};
  if (lineOrFeature.properties && typeof lineOrFeature.properties === "object") {
    return lineOrFeature.properties;
  }
  return {};
}

function extractLineCoordinates(lineOrFeature) {
  if (Array.isArray(lineOrFeature)) {
    if (isCoord(lineOrFeature[0])) return lineOrFeature.filter(isCoord);
    if (Array.isArray(lineOrFeature[0]) && isCoord(lineOrFeature[0][0])) {
      return lineOrFeature[0].filter(isCoord);
    }
    if (lineOrFeature.coordinates) return extractLineCoordinates(lineOrFeature.coordinates);
    return [];
  }
  if (!lineOrFeature || typeof lineOrFeature !== "object") return [];
  if (lineOrFeature.type === "Feature") return extractLineCoordinates(lineOrFeature.geometry);
  if (lineOrFeature.type === "LineString") return (lineOrFeature.coordinates || []).filter(isCoord);
  if (lineOrFeature.type === "MultiLineString") {
    const parts = lineOrFeature.coordinates || [];
    const first = parts.find((part) => Array.isArray(part) && part.filter(isCoord).length > 1);
    return first ? first.filter(isCoord) : [];
  }
  if (Array.isArray(lineOrFeature.coordinates)) return extractLineCoordinates(lineOrFeature.coordinates);
  if (lineOrFeature.geometry) return extractLineCoordinates(lineOrFeature.geometry);
  return [];
}

function isCoord(value) {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]));
}

function buildPath(coords) {
  const points = [];
  for (const coord of coords) {
    const next = [Number(coord[0]), Number(coord[1])];
    const prev = points[points.length - 1];
    if (prev && prev[0] === next[0] && prev[1] === next[1]) continue;
    points.push(next);
  }
  const cumulative = [0];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    cumulative.push(total);
  }
  const vertices = points.map((point, index) => ({
    x: point[0],
    y: point[1],
    u: total > 0 ? cumulative[index] / total : 0,
  }));
  return { vertices, total };
}

function clipPath(path, progress) {
  const vertices = path.vertices || [];
  if (vertices.length === 0) return { vertices: [], total: 0 };
  if (progress >= 1) return path;
  if (progress <= 0) {
    const first = vertices[0];
    return { vertices: [{ x: first.x, y: first.y, u: 0 }], total: 0 };
  }
  const clipped = [];
  for (let i = 0; i < vertices.length; i += 1) {
    const vertex = vertices[i];
    if (vertex.u <= progress) {
      clipped.push(vertex);
      continue;
    }
    const prev = vertices[i - 1];
    if (!prev) break;
    const span = vertex.u - prev.u;
    const t = span === 0 ? 0 : (progress - prev.u) / span;
    clipped.push({
      x: lerp(prev.x, vertex.x, t),
      y: lerp(prev.y, vertex.y, t),
      u: progress,
    });
    break;
  }
  return { vertices: clipped, total: path.total * progress };
}

function extrudePath(path, ir, profile, unitsPerPx, options) {
  const vertices = path.vertices || [];
  const left = [];
  const right = [];
  const hubVertices = [];
  const gpu = [];
  const hub = options.hub;
  const id = Number(options.id) || 0;
  const idBias = ribbonIdBias(id);
  let capCountAtHub = 0;

  if (vertices.length === 0) {
    return emptyMesh(ir, profile);
  }

  if (vertices.length === 1 || path.total === 0) {
    const point = vertices[0];
    const half = taperedHalfWidthPx(point.u, ir, profile) * unitsPerPx;
    left.push([point.x, point.y + half, point.u]);
    right.push([point.x, point.y - half, point.u]);
    if (isHubPoint(point, hub)) {
      hubVertices.push([point.x, point.y + half], [point.x, point.y - half]);
    }
    return {
      left,
      right,
      hubVertices,
      hub: hub ? [...hub] : null,
      capCountAtHub: 0,
      blendedFragmentCount: 0,
      vertexData: gpu,
      centerlines: [{ id, coordinates: [[point.x, point.y]] }],
    };
  }

  const offsets = vertices.map((vertex, index) => {
    const geometricHalfPx = taperedHalfWidthPx(vertex.u, ir, profile);
    const tessHalfPx = inflatedHalfWidthPx(geometricHalfPx);
    const geometricHalf = geometricHalfPx * unitsPerPx;
    const tessHalf = tessHalfPx * unitsPerPx;
    const normal = joinNormal(vertices, index);
    return {
      lx: vertex.x + normal[0] * geometricHalf,
      ly: vertex.y + normal[1] * geometricHalf,
      rx: vertex.x - normal[0] * geometricHalf,
      ry: vertex.y - normal[1] * geometricHalf,
      gpuLx: vertex.x + normal[0] * tessHalf,
      gpuLy: vertex.y + normal[1] * tessHalf,
      gpuRx: vertex.x - normal[0] * tessHalf,
      gpuRy: vertex.y - normal[1] * tessHalf,
      half: tessHalf,
      coreRatio: tessHalfPx > 0 ? geometricHalfPx / tessHalfPx : 0,
      u: vertex.u,
      x: vertex.x,
      y: vertex.y,
      normal,
    };
  });

  for (const offset of offsets) {
    left.push([offset.lx, offset.ly, offset.u]);
    right.push([offset.rx, offset.ry, offset.u]);
  }
  emitStripTriangles(gpu, offsets, idBias);

  const start = offsets[0];
  if (isHubPoint(start, hub)) {
    hubVertices.push([start.lx, start.ly], [start.rx, start.ry]);
  }

  const startDir = direction(vertices[0], vertices[1]);
  const endDir = direction(vertices[vertices.length - 2], vertices[vertices.length - 1]);
  const end = offsets[offsets.length - 1];

  if (!options.suppressStartCap && start.half > 0) {
    addRoundCap(gpu, start, startDir, true, idBias);
    if (isHubPoint(start, hub)) {
      capCountAtHub += 1;
      for (let i = 0; i <= CAP_SEGMENTS; i += 1) {
        const angle = (Math.PI * i) / CAP_SEGMENTS;
        hubVertices.push(capPoint(start, startDir, true, angle));
      }
    }
  }

  if (end.half > 0) {
    addRoundCap(gpu, end, endDir, false, idBias);
  }

  return {
    left,
    right,
    hubVertices,
    hub: hub ? [...hub] : null,
    capCountAtHub,
    blendedFragmentCount: 0,
    vertexData: gpu,
    centerlines: [{
      id,
      coordinates: vertices.map((vertex) => [vertex.x, vertex.y]),
    }],
  };
}

function emptyMesh(ir, profile) {
  return {
    left: [],
    right: [],
    hubVertices: [],
    hub: null,
    capCountAtHub: 0,
    blendedFragmentCount: 0,
    vertexData: [],
    centerlines: [],
    dashed: false,
    taperFromWidthPt: ir.taperFromWidthPt,
    taperToWidthPt: ir.taperToWidthPt,
    profile,
  };
}

function joinNormal(vertices, index) {
  if (index === 0) return perp(direction(vertices[0], vertices[1]));
  if (index === vertices.length - 1) {
    return perp(direction(vertices[index - 1], vertices[index]));
  }
  const n0 = perp(direction(vertices[index - 1], vertices[index]));
  const n1 = perp(direction(vertices[index], vertices[index + 1]));
  const summed = [n0[0] + n1[0], n0[1] + n1[1]];
  const len = Math.hypot(summed[0], summed[1]);
  if (len < 1e-9) return n0;
  const averaged = [summed[0] / len, summed[1] / len];
  const denom = averaged[0] * n0[0] + averaged[1] * n0[1];
  const miter = Math.abs(denom) < 1 / MITER_LIMIT ? MITER_LIMIT : Math.min(MITER_LIMIT, 1 / denom);
  return [averaged[0] * miter, averaged[1] * miter];
}

function direction(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return [1, 0];
  return [dx / len, dy / len];
}

function perp(dir) {
  return [-dir[1], dir[0]];
}

function emitStripTriangles(gpu, offsets, idBias) {
  for (let i = 0; i < offsets.length - 1; i += 1) {
    const a = offsets[i];
    const b = offsets[i + 1];
    pushGpu(gpu, a.gpuLx, a.gpuLy, a.u, 0, -1, a.coreRatio, idBias);
    pushGpu(gpu, a.gpuRx, a.gpuRy, a.u, 1, -1, a.coreRatio, idBias);
    pushGpu(gpu, b.gpuLx, b.gpuLy, b.u, 0, -1, b.coreRatio, idBias);
    pushGpu(gpu, a.gpuRx, a.gpuRy, a.u, 1, -1, a.coreRatio, idBias);
    pushGpu(gpu, b.gpuRx, b.gpuRy, b.u, 1, -1, b.coreRatio, idBias);
    pushGpu(gpu, b.gpuLx, b.gpuLy, b.u, 0, -1, b.coreRatio, idBias);
  }
}

function addRoundCap(gpu, offset, dir, atStart, idBias) {
  const prev = capPoint(offset, dir, atStart, 0);
  let prevV = 0;
  for (let i = 1; i <= CAP_SEGMENTS; i += 1) {
    const angle = (Math.PI * i) / CAP_SEGMENTS;
    const next = capPoint(offset, dir, atStart, angle);
    const nextV = i / CAP_SEGMENTS;
    pushGpu(gpu, offset.x, offset.y, offset.u, 0.5, 0, offset.coreRatio, idBias);
    pushGpu(gpu, prev[0], prev[1], offset.u, prevV, 1, offset.coreRatio, idBias);
    pushGpu(gpu, next[0], next[1], offset.u, nextV, 1, offset.coreRatio, idBias);
    prev[0] = next[0];
    prev[1] = next[1];
    prevV = nextV;
  }
}

function capPoint(offset, dir, atStart, angle) {
  const nx = -dir[1];
  const ny = dir[0];
  const sign = atStart ? 1 : -1;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const radius = offset.half;
  return [
    offset.x + radius * (nx * cosA + sign * dir[0] * sinA),
    offset.y + radius * (ny * cosA + sign * dir[1] * sinA),
  ];
}

function pushGpu(gpu, x, y, u, v, radial, coreRatio, idBias) {
  gpu.push(x, y, u, v, radial, coreRatio, idBias);
}

function isHubPoint(point, hub) {
  if (!hub) return false;
  return Math.hypot(point.x - hub[0], point.y - hub[1]) <= 1e-6;
}

function sampleSide(side, u) {
  if (!Array.isArray(side) || side.length === 0) return null;
  const t = clamp01(u);
  if (t <= side[0][2]) return side[0];
  const last = side[side.length - 1];
  if (t >= last[2]) return last;
  for (let i = 1; i < side.length; i += 1) {
    if (t <= side[i][2]) {
      const a = side[i - 1];
      const b = side[i];
      const span = b[2] - a[2];
      const s = span === 0 ? 0 : (t - a[2]) / span;
      return [lerp(a[0], b[0], s), lerp(a[1], b[1], s), t];
    }
  }
  return last;
}

function distanceToPolyline(point, coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return Infinity;
  if (coordinates.length === 1) {
    return Math.hypot(point[0] - coordinates[0][0], point[1] - coordinates[0][1]);
  }
  let min = Infinity;
  for (let i = 1; i < coordinates.length; i += 1) {
    const dist = distanceToSegment(point, coordinates[i - 1], coordinates[i]);
    if (dist < min) min = dist;
  }
  return min;
}

function distanceToSegment(point, a, b) {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const apx = point[0] - a[0];
  const apy = point[1] - a[1];
  const len2 = abx * abx + aby * aby;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / len2));
  return Math.hypot(point[0] - (a[0] + abx * t), point[1] - (a[1] + aby * t));
}

function listFrameFeatures(frame) {
  if (!frame) return [];
  if (Array.isArray(frame.features)) return frame.features;
  if (frame.type === "FeatureCollection") return frame.features || [];
  if (frame.type === "Feature") return [frame];
  return [];
}

function featureProgress(frame, feature, index) {
  if (typeof frame.featureProgress === "function") {
    return clamp01(frame.featureProgress(feature, index));
  }
  if (Number.isFinite(Number(frame.progress))) return clamp01(frame.progress);
  return 1;
}

function featureId(feature, index) {
  const props = featureProperties(feature);
  const value = props.OBJECTID ?? props.objectId ?? index;
  return Number(value);
}

function ribbonOptionsFromFeature(feature) {
  const props = featureProperties(feature);
  const across = props.acrossLine && typeof props.acrossLine === "object" ? props.acrossLine : {};
  return {
    ...across,
    count: across.count ?? props.COUNT_,
  };
}

function startKey(coords) {
  if (!coords || coords.length === 0) return "";
  return `${coords[0][0].toFixed(6)},${coords[0][1].toFixed(6)}`;
}

function countSharedStarts(projected) {
  const counts = new Map();
  for (const coords of projected) {
    const key = startKey(coords);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function projectLineToMercator(coords) {
  return coords.map((coord) => lngLatToMercator(coord[0], coord[1]));
}

function lngLatToMercator(lng, lat) {
  const x = (Number(lng) + 180) / 360;
  const sinLat = Math.sin((Number(lat) * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
  return [x, y];
}

function mercatorUnitsPerPixel(map) {
  const worldSize = map?.transform?.worldSize;
  if (Number.isFinite(worldSize) && worldSize > 0) return 1 / worldSize;
  const scale = map?.transform?.scale;
  if (Number.isFinite(scale) && scale > 0) return 1 / (512 * scale);
  return 1;
}

function readProjectionMatrix(matrix) {
  if (matrix && matrix.defaultProjectionData && matrix.defaultProjectionData.mainMatrix) {
    return matrix.defaultProjectionData.mainMatrix;
  }
  return matrix;
}

function requestRenderFrame(map) {
  if (map && typeof map.triggerRepaint === "function") map.triggerRepaint();
}

function compileRibbonProgram(gl) {
  if (!gl) return null;
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function drawRibbonVertices(gl, layer, projection, built, opacity) {
  const tessellation = built?.tessellationData;
  const progress = built?.progressData;
  const vertexCount = built?.vertexCount || 0;
  if (!gl || !layer.program || !layer.buffer || !layer.progressBuffer || !projection || vertexCount < 3) {
    return;
  }
  const alpha = Number.isFinite(Number(opacity)) ? Number(opacity) : 0.6;
  const tessData = tessellation instanceof Float32Array
    ? tessellation
    : new Float32Array(tessellation || []);
  const progressData = progress instanceof Float32Array
    ? progress
    : new Float32Array(progress || []);

  gl.useProgram(layer.program);
  if (layer._tessellationData !== tessData) {
    gl.bindBuffer(gl.ARRAY_BUFFER, layer.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, tessData, gl.DYNAMIC_DRAW);
    layer._tessellationData = tessData;
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, layer.progressBuffer);
  if (layer._progressCount !== vertexCount) {
    gl.bufferData(gl.ARRAY_BUFFER, progressData, gl.DYNAMIC_DRAW);
    layer._progressCount = vertexCount;
  } else {
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, progressData);
  }

  gl.uniformMatrix4fv(layer.locations.matrix, false, projection);
  gl.uniform1f(layer.locations.opacity, alpha);

  const tessStride = TESSELLATION_STRIDE * 4;
  gl.bindBuffer(gl.ARRAY_BUFFER, layer.buffer);
  enableAttrib(gl, layer.locations.pos, 2, tessStride, 0);
  enableAttrib(gl, layer.locations.uv, 2, tessStride, 8);
  enableAttrib(gl, layer.locations.radial, 1, tessStride, 16);
  enableAttrib(gl, layer.locations.coreRatio, 1, tessStride, 20);
  enableAttrib(gl, layer.locations.idBias, 1, tessStride, 24);

  gl.bindBuffer(gl.ARRAY_BUFFER, layer.progressBuffer);
  enableAttrib(gl, layer.locations.revealUntil, 1, 4, 0);

  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LESS);
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.clearDepth(1);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.colorMask(false, false, false, false);
  gl.drawArrays(gl.TRIANGLES, 0, vertexCount);

  gl.colorMask(true, true, true, true);
  gl.depthFunc(ribbonColorDepthFunc(gl) ?? gl.LEQUAL);
  gl.depthMask(false);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.uniform1f(layer.locations.opacity, alpha);
  gl.drawArrays(gl.TRIANGLES, 0, vertexCount);

  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(true);
  gl.depthFunc(gl.LESS);
}

function enableAttrib(gl, location, size, strideBytes, offsetBytes) {
  if (location < 0) return;
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, strideBytes, offsetBytes);
}

const VERTEX_SHADER = `#version 300 es
uniform mat4 u_matrix;
in vec2 a_pos;
in vec2 a_uv;
in float a_radial;
in float a_coreRatio;
in float a_idBias;
in float a_revealUntil;
out vec2 v_uv;
out float v_radial;
out float v_coreRatio;
out float v_idBias;
out float v_revealUntil;
void main() {
  v_uv = a_uv;
  v_radial = a_radial;
  v_coreRatio = a_coreRatio;
  v_idBias = a_idBias;
  v_revealUntil = a_revealUntil;
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform float u_opacity;
in vec2 v_uv;
in float v_radial;
in float v_coreRatio;
in float v_idBias;
in float v_revealUntil;
out vec4 fragColor;

vec3 mixAcrossLineColor(float v) {
  vec3 fromColor = vec3(245.0, 245.0, 0.0) / 255.0;
  vec3 toColor = vec3(245.0, 0.0, 0.0) / 255.0;
  float band = 0.125;
  if (v <= band) return fromColor;
  if (v >= 1.0 - band) return toColor;
  float t = (v - band) / 0.75;
  return mix(fromColor, toColor, t);
}

void main() {
  if (v_uv.x > v_revealUntil + 1.0e-3) discard;
  float dist = v_radial < 0.0 ? abs(v_uv.y - 0.5) * 2.0 : abs(v_radial);
  float core = clamp(v_coreRatio, 0.0, 1.0);
  float aa = max(fwidth(dist), 1.0e-6);
  float coverage = 1.0 - smoothstep(max(core - aa, 0.0), 1.0, dist);
  coverage *= 1.0 - smoothstep(v_revealUntil - 0.004, v_revealUntil, v_uv.x);
  gl_FragDepth = dist <= core ? clamp(dist + v_idBias, 0.0, 1.0) : 1.0;
  vec3 color = mixAcrossLineColor(v_uv.y);
  fragColor = vec4(color, u_opacity * coverage);
}`;
