/** Display-space sizing/placement; never modifies source or contact geometry. */
import {
  mapSourceUvToOutput,
  mapOutputToSourceUv,
} from "../projection-config/clock-layout-geometry.js";
import {
  SHELTER_BODY_WIDTH,
  SHELTER_BODY_RATIO,
} from "./nli-shelter-symbol.js";
import { NLI_DISPLAY_PROFILES } from "./nli-investigation-theme.js";

const INPUT_MESH = {
  width: 1920,
  height: 1080,
  vertices: [
    { u: 0, v: 0, x: 0, y: 0 },
    { u: 1, v: 0, x: 1, y: 0 },
    { u: 1, v: 1, x: 1, y: 1 },
    { u: 0, v: 1, x: 0, y: 1 },
  ],
  triangles: [0, 1, 2, 0, 2, 3],
};

function matrixPoint(m, p) {
  const z = m[2] * p.x + m[5] * p.y + m[8];
  if (Math.abs(z) < 1e-12) return null;
  return {
    x: (m[0] * p.x + m[3] * p.y + m[6]) / z,
    y: (m[1] * p.x + m[4] * p.y + m[7]) / z,
  };
}
function inverseMatrix(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const adj = [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ];
  const det = a * adj[0] + d * adj[1] + g * adj[2];
  if (Math.abs(det) < 1e-12)
    throw new Error("Singular shelter projection matrix");
  return adj.map((v) => v / det);
}
function gisBodyWidth(zoom) {
  const stops = NLI_DISPLAY_PROFILES.gis.shelter.zoomBodyWidths;
  const value = Number.isFinite(zoom) ? zoom : 0;
  if (value <= stops[0][0]) return stops[0][1];
  for (let index = 1; index < stops.length; index++) {
    const [endZoom, endWidth] = stops[index];
    const [startZoom, startWidth] = stops[index - 1];
    if (value <= endZoom) {
      return (
        startWidth +
        ((endWidth - startWidth) * (value - startZoom)) / (endZoom - startZoom)
      );
    }
  }
  return stops.at(-1)[1];
}

function bounds(points) {
  if (points.some((p) => !p)) return null;
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y));
  return {
    x,
    y,
    width: Math.max(...points.map((p) => p.x)) - x,
    height: Math.max(...points.map((p) => p.y)) - y,
  };
}
function rotateVector(x, y, degrees) {
  const angle = (degrees * Math.PI) / 180;
  return [
    x * Math.cos(angle) - y * Math.sin(angle),
    x * Math.sin(angle) + y * Math.cos(angle),
  ];
}

export function resolveShelterPresentation({
  displayProfile = "gis",
  sourceDimensions,
  outputResolution,
  mapDescriptor,
  mesh,
  inputCapture = false,
  zoom = 0,
} = {}) {
  const projection = displayProfile === "projection";
  const rotationDeg = projection
    ? NLI_DISPLAY_PROFILES.projection.shelter.rotationDeg
    : 0;
  let forward = (p) => p,
    inverse = (p) => p;
  const target = projection
    ? (NLI_DISPLAY_PROFILES.projection.shelter.bodyWidth *
        (outputResolution?.width || 1920)) /
      1920
    : gisBodyWidth(zoom);
  if (inputCapture) mesh = INPUT_MESH;
  if (projection) {
    if (
      !mesh ||
      !(sourceDimensions?.width > 0) ||
      !(sourceDimensions?.height > 0) ||
      !(outputResolution?.width > 0) ||
      !(outputResolution?.height > 0)
    )
      throw new Error("Shelter projection mapping unavailable");
    const m = mapDescriptor?.matrix || [1, 0, 0, 0, 1, 0, 0, 0, 1],
      inv = inverseMatrix(m);
    forward = (p) => {
      const q = matrixPoint(m, {
        x: p.x / sourceDimensions.width,
        y: p.y / sourceDimensions.height,
      });
      const hit = q && mapSourceUvToOutput(mesh, { u: q.x, v: q.y });
      return hit
        ? {
            x: hit.x * outputResolution.width,
            y: hit.y * outputResolution.height,
          }
        : null;
    };
    inverse = (p) => {
      const uv = mapOutputToSourceUv(mesh, {
        x: p.x / outputResolution.width,
        y: p.y / outputResolution.height,
      });
      const hit = uv && matrixPoint(inv, { x: uv.u, y: uv.v });
      return hit
        ? {
            x: hit.x * sourceDimensions.width,
            y: hit.y * sourceDimensions.height,
          }
        : null;
    };
  }
  function bodyBounds(anchor, size) {
    const hw = (SHELTER_BODY_WIDTH * size) / 2,
      hh = hw * SHELTER_BODY_RATIO;
    return bounds(
      [
        [-hw, -hh],
        [hw, -hh],
        [hw, hh],
        [-hw, hh],
      ].map(([x, y]) => {
        const [dx, dy] = rotateVector(x, y, rotationDeg);
        return forward({ x: anchor.x + dx, y: anchor.y + dy });
      }),
    );
  }
  function at(anchor) {
    if (!forward(anchor)) return null; // Outside this output's accepted mesh footprint.
    let size = target / SHELTER_BODY_WIDTH;
    for (let i = 0; i < 3; i++) {
      const b = bodyBounds(anchor, size);
      if (!b || !(b.width > 0)) return null;
      size *= target / b.width;
    }
    const b = bodyBounds(anchor, size);
    return b
      ? {
          size,
          rotationDeg,
          bodyWidth: b.width,
          bodyHeight: b.height,
          bounds: b,
        }
      : null;
  }
  return {
    forward,
    inverse,
    at,
    bodyBounds,
    // MapLibre rotates icon-offset along with the glyph. Convert source-screen
    // displacement back to the icon's local axes before dividing by icon-size.
    offsetVector: (dx, dy) => rotateVector(dx, dy, -rotationDeg),
    allowNudges: !inputCapture,
    stage: inputCapture ? "input-capture" : "final-output",
  };
}

function overlaps(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function layoutShelterOffsets(anchors, presentation) {
  const result = new Map(),
    placed = [];
  for (const { id, anchor } of [...anchors].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    const base = presentation.at(anchor),
      center = presentation.forward(anchor);
    if (!base || !center) {
      result.set(id, { offset: [0, 0], size: 0, outsideFootprint: true });
      continue;
    }
    const hw = base.bodyWidth / 2,
      hh = base.bodyHeight / 2;
    const candidates =
      presentation.allowNudges === false
        ? [[0, 0]]
        : [
            [0, 0],
            [-hw, 0],
            [hw, 0],
            [0, -hh],
            [0, hh],
            [-hw, -hh],
            [hw, -hh],
            [-hw, hh],
            [hw, hh],
          ];
    let selected = null;
    for (const [dx, dy] of candidates) {
      const source =
        dx === 0 && dy === 0
          ? anchor
          : presentation.inverse({
              x: center.x + dx,
              y: center.y + dy,
            });
      if (!source) continue;
      const b = presentation.bodyBounds(source, base.size),
        actual = presentation.forward(source);
      if (
        !b ||
        !actual ||
        Math.abs(actual.x - center.x) > Math.min(hw, b.width / 2) + 1e-6 ||
        Math.abs(actual.y - center.y) > Math.min(hh, b.height / 2) + 1e-6
      )
        continue;
      const row = {
        ...base,
        bounds: b,
        displacement: { x: actual.x - center.x, y: actual.y - center.y },
        offset: presentation
          .offsetVector(source.x - anchor.x, source.y - anchor.y)
          .map((value) => value / base.size),
        unresolved: placed.some((other) => overlaps(b, other)),
      };
      if (!selected || !row.unresolved) selected = row;
      if (!row.unresolved) break;
    }
    if (!selected)
      selected = {
        ...base,
        displacement: { x: 0, y: 0 },
        offset: [0, 0],
        unresolved: true,
      };
    placed.push(selected.bounds);
    result.set(id, selected);
  }
  return result;
}
