import { expect, test } from 'vitest';
import { snapSettlementOrigin } from '../../frontend/src/projection-config/settlement-origin-geometry.js';

test('snaps to the nearest outline segment and converts its fraction to geographic coordinates', () => {
  const projected = [[[100,100],[200,100],[200,200],[100,200]]];
  const world = [[[34,31],[35,31],[35,32],[34,32]]];
  expect(snapSettlementOrigin({ x: 170, y: 80 }, world, projected)).toEqual({ origin: { lng: 34.7, lat: 31 }, point: { x: 170, y: 100 } });
});

test('has no snap target without a mapped outline', () => {
  expect(snapSettlementOrigin({ x: 170, y: 80 }, [], [])).toBeNull();
});
