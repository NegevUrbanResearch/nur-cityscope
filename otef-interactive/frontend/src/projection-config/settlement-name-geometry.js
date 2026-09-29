import { copyProjectionMesh, mapOutputToSourceUv, mapOverlayOutline } from "./clock-layout-geometry.js";

const REFERENCE_WIDTH = 1920;
const REFERENCE_HEIGHT = 1080;

export function settlementPointerToReference(mesh, outputPoint) {
  const uv = mapOutputToSourceUv(mesh, outputPoint);
  if (!uv) return null;
  return { x: uv.u * REFERENCE_WIDTH, y: uv.v * REFERENCE_HEIGHT };
}

export function settlementOutline(mesh, label) {
  const box = label?.inkBox;
  if (!box) return [];
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  return mapOverlayOutline(mesh, {
    leftPct: box.left / REFERENCE_WIDTH * 100,
    topPct: box.top / REFERENCE_HEIGHT * 100,
    widthPct: width / REFERENCE_WIDTH * 100,
    heightPct: height / REFERENCE_HEIGHT * 100,
    rotateDeg: label.rotateDeg || 0,
  });
}

function containsLabel(label, point) {
  const radians = -(label.rotateDeg || 0) * Math.PI / 180;
  const dx = point.x - label.x;
  const dy = point.y - label.y;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const x = label.x + dx * cos - dy * sin;
  const y = label.y + dx * sin + dy * cos;
  const box = label.inkBox;
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}

export function hitTestSettlementLabels(labels, point, selectedCitycode = null) {
  const hits = (labels || []).filter((label) => containsLabel(label, point));
  if (!hits.length) return null;
  if (selectedCitycode && hits.some((label) => label.citycode === selectedCitycode)) return selectedCitycode;
  return hits[0].citycode;
}

export function beginSettlementPointerGesture({ mesh, fit, position }) {
  const copied = copyProjectionMesh(mesh);
  if (!copied) throw new TypeError("settlement gesture requires a 1920x1080 mesh");
  return Object.freeze({
    mesh: copied,
    fit: Object.freeze({ ...fit }),
    start: Object.freeze({ x: position.x, y: position.y }),
  });
}

export function referencePointFromAnchor({
  anchor,
  offsetEm,
  fontPx,
  rotateDeg,
  bearingDeg = 0,
  cssSize,
  canvasSize,
  descriptor,
}) {
  const radians = (rotateDeg + bearingDeg) * Math.PI / 180;
  const ox = offsetEm[0] * fontPx;
  const oy = offsetEm[1] * fontPx;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const cssX = anchor.x + ox * cos - oy * sin;
  const cssY = anchor.y + oy * cos + ox * sin;
  const pixelX = cssX * canvasSize.width / cssSize.width;
  const pixelY = cssY * canvasSize.height / cssSize.height;
  const clip = descriptor.clip;
  const u = (pixelX / canvasSize.width - clip[0]) / (clip[2] - clip[0]);
  const v = (pixelY / canvasSize.height - clip[1]) / (clip[3] - clip[1]);
  const matrix = descriptor.matrix;
  const nu = matrix[0] * u + matrix[3] * v + matrix[6];
  const nv = matrix[1] * u + matrix[4] * v + matrix[7];
  return { x: nu * REFERENCE_WIDTH, y: nv * REFERENCE_HEIGHT };
}
