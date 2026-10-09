import { paintSettlementOpacityGroup } from './settlement-opacity-group.js';

export function nearestSettlementBoundaryHit(rings, point) {
  let nearest = null, best = Infinity;
  for (const [ringIndex, ring] of (rings || []).entries()) {
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const length = dx * dx + dy * dy;
      const t = length ? Math.max(0, Math.min(1, ((point.x - a[0]) * dx + (point.y - a[1]) * dy) / length)) : 0;
      const candidate = { x: a[0] + t * dx, y: a[1] + t * dy };
      const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
      if (distance < best) { best = distance; nearest = { point: candidate, ringIndex, segmentIndex: i, fraction: t }; }
    }
  }
  return nearest;
}

export function nearestSettlementBoundaryPoint(rings, point) {
  return nearestSettlementBoundaryHit(rings, point)?.point || null;
}

function insideRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point.y) !== (b[1] > point.y) && point.x < (b[0] - a[0]) * (point.y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Connect the nearest exterior boundary to a rotated label's ink box, with a small text gap. */
export function settlementConnector(label, rings, inkBox, origin = null) {
  if (!origin && (rings || []).some(ring => insideRing(label, ring))) return null;
  const start = nearestSettlementBoundaryPoint(rings, origin || label);
  if (!start) return null;
  const radians = label.rotateDeg * Math.PI / 180;
  const cos = Math.cos(radians), sin = Math.sin(radians);
  const dx = start.x - label.x, dy = start.y - label.y;
  const localX = dx * cos + dy * sin, localY = -dx * sin + dy * cos;
  const reachX = localX < 0 ? label.x - inkBox.left + 2 : inkBox.right - label.x + 2;
  const reachY = localY < 0 ? label.y - inkBox.top + 2 : inkBox.bottom - label.y + 2;
  const t = Math.min(localX ? reachX / Math.abs(localX) : Infinity, localY ? reachY / Math.abs(localY) : Infinity);
  if (!Number.isFinite(t) || t >= 1) return null;
  return { start, end: { x: label.x + dx * t, y: label.y + dy * t } };
}

export function paintSettlementConnector(context, connector, style, alpha, { document, rasterScale = 1 } = {}) {
  if (!connector || alpha <= 0 || style.opacity <= 0) return;
  context.save();
  context.lineCap = 'round'; context.lineJoin = 'round';
  const strokes = [[style.widthPx, style.color]];
  if (style.outlineWidthPx > 0) strokes.unshift([style.widthPx + 2 * style.outlineWidthPx, style.outlineColor]);
  const padding = strokes[0][0] / 2 + 1;
  paintSettlementOpacityGroup(context, { document, rasterScale, alpha: alpha * style.opacity,
    bounds: { left: Math.min(connector.start.x, connector.end.x) - padding,
      right: Math.max(connector.start.x, connector.end.x) + padding,
      top: Math.min(connector.start.y, connector.end.y) - padding,
      bottom: Math.max(connector.start.y, connector.end.y) + padding },
    paint(lineContext) {
      for (const [width, color] of strokes) {
        lineContext.lineWidth = width; lineContext.strokeStyle = color;
        lineContext.beginPath(); lineContext.moveTo(connector.start.x, connector.start.y); lineContext.lineTo(connector.end.x, connector.end.y); lineContext.stroke();
      }
    },
  });
  context.restore();
}
