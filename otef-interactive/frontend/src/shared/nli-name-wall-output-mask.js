const area = (polygon) => polygon.reduce((sum, a, i) => {
  const b = polygon[(i + 1) % polygon.length];
  return sum + a[0] * b[1] - b[0] * a[1];
}, 0) / 2;
const boundsOf = (polygon) => ({ x0: Math.min(...polygon.map(p => p[0])),
  x1: Math.max(...polygon.map(p => p[0])), y0: Math.min(...polygon.map(p => p[1])),
  y1: Math.max(...polygon.map(p => p[1])) });
const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

function pieceOf(value, output) {
  const polygon = (value.polygon || value).map(p => [...p]);
  if (polygon.length < 3 || polygon.some(p => p.length !== 2 || !p.every(Number.isFinite)) || !area(polygon))
    throw new Error('invalid names output mask polygon');
  if (area(polygon) < 0) polygon.reverse();
  return { output, polygon, bounds: boundsOf(polygon) };
}

function halfPlane(polygon, distance, inside) {
  const result = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const da = distance(a), db = distance(b);
    if (inside ? da >= 0 : da <= 0) result.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      result.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  // Keep every positive-area remnant; small calibrated regions are real coverage.
  return result.length >= 3 && Math.abs(area(result)) > 0 ? result : [];
}

/** Subtract a convex calibrated polygon, retaining disjoint convex remnants. */
function subtract(subject, clip) {
  let remainder = subject;
  const outside = [];
  for (let i = 0; i < clip.length && remainder.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const distance = p => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const fragment = halfPlane(remainder, distance, false);
    if (fragment.length) outside.push(fragment);
    remainder = halfPlane(remainder, distance, true);
  }
  return outside;
}

function spatialIndex(pieces) {
  const bins = new Map();
  const cells = function* (box) {
    for (let x = Math.floor(box.x0 / 64); x <= Math.floor(box.x1 / 64); x++)
      for (let y = Math.floor(box.y0 / 64); y <= Math.floor(box.y1 / 64); y++) yield `${x}:${y}`;
  };
  for (const piece of pieces) for (const key of cells(piece.bounds)) {
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(piece);
  }
  return box => {
    const found = new Set();
    for (const key of cells(box)) for (const piece of bins.get(key) || [])
      if (overlaps(piece.bounds, box)) found.add(piece);
    return found;
  };
}

/** Left owns shared calibrated coverage; right fills the remaining original union. */
export function partitionNameWallCoverage(coverage) {
  if (!Array.isArray(coverage?.pieces?.left) || !Array.isArray(coverage?.pieces?.right))
    throw new Error('missing names output mask coverage');
  const left = coverage.pieces.left.map(piece => pieceOf(piece, 'left'));
  const candidates = spatialIndex(left);
  const right = [];
  for (const value of coverage.pieces.right) {
    const source = pieceOf(value, 'right');
    let fragments = [source.polygon];
    for (const clip of candidates(source.bounds)) {
      fragments = fragments.flatMap(polygon => overlaps(boundsOf(polygon), clip.bounds)
        ? subtract(polygon, clip.polygon) : [polygon]);
      if (!fragments.length) break;
    }
    right.push(...fragments.map(polygon => pieceOf(polygon, 'right')));
  }
  return { pieces: { left, right } };
}
