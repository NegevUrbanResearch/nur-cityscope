import { expect, test } from 'vitest';
import { prepareMemorialNameRecords } from '../../frontend/src/shared/nli-name-field-data.js';

test('memorial eligibility and source coordinates remain fixed while names and sort keys follow language', () => {
  const properties = { pid: '1', status: 'Murdered', hebrew_name: 'יוסף', name: 'Éé', sort_name_he: 'שם משפחה', location: 'Nova', source_lon: 34.5, source_lat: 31.4 };
  const collection = { features: [{ properties, geometry: { type: 'Point', coordinates: [34.6,31.5] } }] };
  expect(prepareMemorialNameRecords(collection, 'en')[0]).toMatchObject({ pid: '1', name: 'Éé', orderKey: 'Éé', sourceCoordinates: [34.5,31.4] });
  expect(prepareMemorialNameRecords(collection, 'he')[0]).toMatchObject({ pid: '1', name: 'יוסף', orderKey: 'שם משפחה' });
});
