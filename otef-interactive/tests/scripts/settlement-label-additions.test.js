import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

test('Ein Habesor is present in display data and connected to outline 12', () => {
  const base = new URL('../../public/processed/layers/projector_base/', import.meta.url);
  const names = JSON.parse(readFileSync(new URL('שמות_יישובים.geojson', base), 'utf8'));
  const map = JSON.parse(readFileSync(new URL('yeshuv-outline-map.json', base), 'utf8'));
  expect(names.features.find(f => f.properties.citycode === '1240')?.properties.cityname).toBe('עין הבשור');
  expect(map.matches.find(m => m.citycode === '1240')?.outlineObjectId).toBe(12);
  expect(names.features.find(f => f.properties.citycode === '1237')?.properties.cityname).toBe('תלמי יוסף');
  expect(map.matches.find(m => m.citycode === '1237')?.outlineObjectId).toBe(9);
  expect(names.features.find(f => f.properties.citycode === '0415')?.properties.cityname).toBe('שוקדה');
  expect(map.matches.find(m => m.citycode === '0415')?.outlineObjectId).toBe(22);
  expect(names.features.find(f => f.properties.citycode === '1095')?.properties.cityname).toBe('כפר מימון');
  expect(map.matches.find(m => m.citycode === '1095')?.outlineObjectId).toBe(23);
  expect(names.features.find(f => f.properties.citycode === '0342')?.properties.cityname).toBe('גברעם');
  expect(map.matches.find(m => m.citycode === '0342')?.outlineObjectId).toBe(33);
});
