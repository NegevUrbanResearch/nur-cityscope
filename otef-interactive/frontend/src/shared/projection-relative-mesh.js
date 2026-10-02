const EPSILON = Number.EPSILON;

function area(a, b, c, xKey, yKey) {
  const abx = b[xKey] - a[xKey];
  const aby = b[yKey] - a[yKey];
  const acx = c[xKey] - a[xKey];
  const acy = c[yKey] - a[yKey];
  return { value: abx * acy - aby * acx, roundoff: 32 * EPSILON * (Math.abs(abx * acy) + Math.abs(aby * acx)) };
}

export function relativeTriangleError(a, b, c) {
  const source = area(a, b, c, 's', 't');
  const destination = area(a, b, c, 'x', 'y');
  if (!(source.value > source.roundoff)) return 'source';
  if (!(destination.value > destination.roundoff) || !(destination.value / source.value > 1e-9)) return 'destination';

  const toRenderPoint = (point) => [(Math.fround(2 * point.x - 1) + 1) / 2, (1 - Math.fround(1 - 2 * point.y)) / 2];
  const [A, B, C] = [a, b, c].map(toRenderPoint);
  const rendered = area(
    { x: A[0], y: A[1] }, { x: B[0], y: B[1] }, { x: C[0], y: C[1] }, 'x', 'y',
  );
  if (!(rendered.value > rendered.roundoff) || !(rendered.value / source.value > 1e-9)) return 'render';
  return null;
}

export function assertRelativeTriangle(a, b, c, { sourceError = 'source grid is numerically degenerate', destinationError = 'grid warp folds or collapses a triangle' } = {}) {
  const error = relativeTriangleError(a, b, c);
  if (error === 'source') throw new Error(sourceError);
  if (error === 'destination') throw new Error(destinationError);
  if (error === 'render') throw new Error('render precision collapses or inverts a grid triangle');
  return true;
}
