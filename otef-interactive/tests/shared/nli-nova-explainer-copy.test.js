import { expect, test } from 'vitest';
import { NOVA_EXPLAINER_OBJECT_IDS } from '../../frontend/src/shared/nli-nova-explainer-layout.js';
import { novaExplainerName } from '../../frontend/src/shared/nli-nova-explainer-copy.js';

test('every Nova story polygon has a complete English explainer without Hebrew or number prefixes', () => {
  for (const id of NOVA_EXPLAINER_OBJECT_IDS) {
    const name = novaExplainerName({ OBJECTID: String(id), Name: 'טקסט מקור' }, 'en');
    expect(typeof name).toBe('string');
    expect(name.trim()).not.toBe('');
    expect(name).not.toMatch(/[\u0590-\u05ff]|Fighting \d+/);
  }
  expect(novaExplainerName({ OBJECTID: 106, Name: 'מקור' }, 'en')).toBe('Abduction of Eitan Mor, Rom Braslavski, and Moran Stella Yanai');
  for (const Name of [undefined, '', ' ', 123]) expect(novaExplainerName({ OBJECTID: 97, Name }, 'en')).toBeNull();
  expect(novaExplainerName({ OBJECTID: 107, Name: 'ללא תרגום' }, 'en')).toBeNull();
});

test('Hebrew keeps the current display cleanup and literal plain text', () => {
  expect(novaExplainerName({ OBJECTID: 97, Name: 'מוקד לחימה 1 - כביש 232' })).toBe('מוקד לחימה - כביש 232');
  expect(novaExplainerName({ OBJECTID: 100, Name: ' <b>שם</b> ' })).toBe(' <b>שם</b> ');
  expect(novaExplainerName({ OBJECTID: 106, Name: 'חטיפת איתן מור, רום ברסלבסקי ומורן סטלה ינאי (זמן משוער - ייתכן שנחטפו בזמנים שונים לאורך הצהריים)' })).toBe('חטיפת איתן מור, רום ברסלבסקי ומורן סטלה ינאי');
  expect(novaExplainerName({ OBJECTID: 97, Name: ' ' })).toBeNull();
});
