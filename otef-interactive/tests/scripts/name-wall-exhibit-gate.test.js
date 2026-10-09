import { expect, test } from 'vitest';
import { requireNameWallExhibitInputs } from '../../scripts/require-name-wall-exhibit-gate.mjs';

test('required exhibit gate fails clearly when either metric capture or current data is missing', () => {
  const present = (path) => !path.includes('people_names.geojson');
  const artifacts = 'C:/exhibit/acceptance';
  expect(() => requireNameWallExhibitInputs('C:/exhibit', present, artifacts)).toThrow(/people_names\.geojson/);
  expect(() => requireNameWallExhibitInputs('C:/exhibit', path => !path.includes('name-metrics-en-ltr'), artifacts)).toThrow(/name-metrics-en-ltr/);
  expect(() => requireNameWallExhibitInputs('C:/exhibit', path => !path.includes('Tkuma_Area'), artifacts)).toThrow(/Tkuma_Area/);
  expect(() => requireNameWallExhibitInputs('C:/exhibit', () => true, artifacts)).not.toThrow();
  expect(() => requireNameWallExhibitInputs('C:/exhibit', () => true, '')).toThrow(/ARTIFACT_DIR/);
});
