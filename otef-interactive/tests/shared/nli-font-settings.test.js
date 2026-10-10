import { expect, test } from 'vitest';
import {
  NLI_FONT_DEFAULTS,
  resolveNliFont,
  validateNliFontChoices,
} from '../../frontend/src/shared/nli-font-settings.js';

const baseline = {
  fontFamily: 'Guttman Hatzvi',
  canvasFontStack: '"Guttman Hatzvi", sans-serif',
  mapFontStack: ['Guttman Hatzvi', 'Arial'],
};

test('hebrew_default_preserves_baseline', () => {
  expect(NLI_FONT_DEFAULTS).toEqual({ he: 'default', en: 'hadassah' });
  expect(resolveNliFont('he', NLI_FONT_DEFAULTS, baseline)).toBe(baseline);
  const popupBaseline = { ...baseline, fontFamily: 'Hadassah Friedlaender' };
  expect(resolveNliFont('he', NLI_FONT_DEFAULTS, popupBaseline)).toBe(popupBaseline);
});

test('english_initial_choice_is_hadassah', () => {
  const resolved = resolveNliFont('en', NLI_FONT_DEFAULTS, baseline);
  expect(resolved.fontFamily).toBe('NLI Content Hadassah Friedlaender');
  expect(resolved.canvasFontStack).toBe('"NLI Content Hadassah Friedlaender", sans-serif');
  expect(resolved.mapFontStack).toEqual(['NLI Content Hadassah Friedlaender']);
});

test('invalid_script_choice_is_rejected', () => {
  expect(validateNliFontChoices({ he: 'belleza', en: 'hadassah' })).toHaveProperty('he');
  expect(validateNliFontChoices({ he: 'default', en: 'default' })).toHaveProperty('en');
});
