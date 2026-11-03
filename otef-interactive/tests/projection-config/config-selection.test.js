import { expect, test } from 'vitest';
import { singlePointSelection } from '../../frontend/src/projection-config/config-selection.js';

test('inserted lines and restored groups resolve to one visible grid point', () => {
  expect(singlePointSelection({ mode: 'grid', kind: 'row', index: 2 }, { columns: 7, rows: 8 })).toEqual({ mode: 'grid', kind: 'point', index: 14 });
  expect(singlePointSelection({ mode: 'grid', kind: 'column', index: 3 }, { columns: 9, rows: 7 })).toEqual({ mode: 'grid', kind: 'point', index: 3 });
  expect(singlePointSelection({ mode: 'grid', kind: 'point', index: 13 }, { columns: 7, rows: 7 })).toEqual({ mode: 'grid', kind: 'point', index: 13 });
  expect(singlePointSelection({ mode: 'keystone', kind: 'edge', index: 2, indices: [1, 3] })).toEqual({ mode: 'keystone', kind: 'corner', index: 1 });
});
