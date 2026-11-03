import { expect, test } from 'vitest';
import { partitionNameWallCoverage } from '../../frontend/src/shared/nli-name-wall-output-mask.js';
import { rectCoveredByPieces } from '../../frontend/src/shared/nli-name-wall-coverage.js';

const box = (x0, y0, x1, y1) => ({ polygon: [[x0,y0],[x1,y0],[x1,y1],[x0,y1]] });
const area = (p) => Math.abs(p.reduce((sum,a,i) => { const b=p[(i+1)%p.length]; return sum+a[0]*b[1]-b[0]*a[1]; },0)/2);

test('partition preserves partial overlap union and leaves the overlap on only the left output', () => {
  const coverage = { pieces: { left: [box(0,0,10,6)], right: [box(5,3,15,9)] } };
  const snapshot = JSON.stringify(coverage);
  const result = partitionNameWallCoverage(coverage);
  expect(result.pieces.left.reduce((n,p)=>n+area(p.polygon),0)).toBeCloseTo(60);
  expect(result.pieces.right.reduce((n,p)=>n+area(p.polygon),0)).toBeCloseTo(45);
  expect(rectCoveredByPieces({x:10,y:6,width:10,height:6}, [...result.pieces.left,...result.pieces.right])).toBe(true);
  expect(rectCoveredByPieces({x:7,y:4,width:1,height:1}, result.pieces.right)).toBe(false);
  expect(JSON.stringify(coverage)).toBe(snapshot);
});

test('a hole between calibrated left pieces remains assigned to the right projector', () => {
  const result = partitionNameWallCoverage({pieces:{left:[box(0,0,4,10),box(6,0,10,10)],right:[box(0,0,10,10)]}});
  expect(result.pieces.right.reduce((n,p)=>n+area(p.polygon),0)).toBeCloseTo(20);
  expect(rectCoveredByPieces({x:5,y:5,width:2,height:10},result.pieces.right)).toBe(true);
  expect(rectCoveredByPieces({x:5,y:5,width:10,height:10},[...result.pieces.left,...result.pieces.right])).toBe(true);
});

test('convex triangle subtraction supports reversed winding and preserves tiny positive remnants', () => {
  const triangle = {polygon:[[0,0],[0,10],[10,0]]};
  const result = partitionNameWallCoverage({pieces:{left:[triangle],right:[box(0,0,10,10)]}});
  expect(result.pieces.right.reduce((n,p)=>n+area(p.polygon),0)).toBeCloseTo(50);
  const tiny = partitionNameWallCoverage({pieces:{left:[box(0,0,1,1)],right:[box(1-1e-10,0,1+1e-10,1)]}});
  expect(tiny.pieces.right.reduce((n,p)=>n+area(p.polygon),0)).toBeGreaterThan(0);
});
