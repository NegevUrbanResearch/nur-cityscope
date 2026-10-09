import { expect, test } from 'vitest';
import { resolvePersonName, resolveSettlementName, nameTextStyle, canonicalPersonNames } from '../../frontend/src/shared/nli-name-language.js';
import { resolveNliLocation } from '../../frontend/src/shared/nli-name-field-places.js';

test('requested canonical names retain spelling and never fall back to the other language', () => {
  const person = { name: 'José O’Neil', hebrew_name: 'יוסף אוניל' };
  expect(resolvePersonName(person, 'en')).toBe('José O’Neil');
  expect(resolvePersonName(person, 'he')).toBe('יוסף אוניל');
  expect(() => resolvePersonName({ hebrew_name: 'יוסף' }, 'en')).toThrow(/name/i);
  expect(resolveSettlementName('1240', 'en')).toBe('Ein HaBesor');
  expect(resolveSettlementName('1240', 'he')).toBe('עין הבשור');
});

test('English names use an explicit Latin font and source group identity survives language changes', () => {
  expect(nameTextStyle('en')).toMatchObject({ language: 'en', direction: 'ltr', fontFamily: 'Arial', canvasFontStack: 'Arial, sans-serif', mapFontStack: ['Arial'] });
  for (const raw of ['Nova', 'Nahal Oz Base', 'Pri Gan', "Be'eri"]) {
    const he = resolveNliLocation(raw, 'he'), en = resolveNliLocation(raw, 'en');
    expect(en.groupId).toBe(he.groupId);
    expect(en.placeId).toBe(he.placeId);
    expect(en.anchorCoordinates).toEqual(he.anchorCoordinates);
    expect(en.label).not.toMatch(/[א-ת]/);
  }
  expect(resolveNliLocation('Nova', 'en').label).toBe('Nova');
  expect(resolveNliLocation('Pri Gan', 'he').label).toBe('פרי גן');
});

test('index canonical positions preserve accented Latin and do not recover aliases from malformed positions', () => {
  expect(canonicalPersonNames({ nameForms: ['יוסף', 'Éé', 'English Alias'] })).toEqual({ hebrew_name: 'יוסף', name: 'Éé' });
  expect(canonicalPersonNames({ nameForms: ['English Alias', 'Another Alias'] }).name).toBe('');
  expect(() => resolveNliLocation('מיקום חדש', 'en')).toThrow(/location/i);
  expect(() => resolveNliLocation('Unreviewed location', 'he')).toThrow(/location/i);
});
