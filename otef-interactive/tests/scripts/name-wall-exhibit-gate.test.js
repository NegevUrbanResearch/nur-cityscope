import { expect, test } from 'vitest';
import { requireNameWallExhibitInputs } from '../../scripts/require-name-wall-exhibit-gate.mjs';

test('required exhibit gate fails clearly when either metric capture or current data is missing', () => {
  const present = (path) => !path.includes('people_names.geojson');
  expect(() => requireNameWallExhibitInputs('C:/exhibit', present)).toThrow(/people_names\.geojson/);
  expect(() => requireNameWallExhibitInputs('C:/exhibit', (path) => !path.includes('metrics-4-8'))).toThrow(/metrics-4-8/);
  expect(() => requireNameWallExhibitInputs('C:/exhibit', (path) => !path.includes('Tkuma_Area'))).toThrow(/Tkuma_Area/);
  expect(() => requireNameWallExhibitInputs('C:/exhibit', () => true)).not.toThrow();
});
