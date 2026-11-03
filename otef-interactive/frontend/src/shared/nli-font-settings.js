export const NLI_FONT_DEFAULTS = Object.freeze({ he: 'default', en: 'hadassah' });

const families = Object.freeze({
  guttman: 'Guttman Hatzvi',
  hadassah: 'Hadassah Friedlaender',
  narkiss: 'Narkiss Block',
  arial: 'Arial',
  belleza: 'Belleza',
  marcellus: 'Marcellus',
});

const allowed = Object.freeze({
  he: Object.freeze(['default', 'guttman', 'hadassah', 'narkiss', 'arial']),
  en: Object.freeze(['hadassah', 'narkiss', 'arial', 'belleza', 'marcellus']),
});

export const NLI_FONT_CATALOG = Object.freeze({
  he: allowed.he,
  en: allowed.en,
  families,
});

export function validateNliFontChoices(value) {
  const errors = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { he: 'Choose a supported Hebrew font.', en: 'Choose a supported English font.' };
  }
  for (const language of ['he', 'en']) {
    if (!allowed[language].includes(value[language])) {
      errors[language] = `Choose a supported ${language === 'he' ? 'Hebrew' : 'English'} font.`;
    }
  }
  return errors;
}

export function resolveNliFont(language, choices, baseline) {
  if (language !== 'he' && language !== 'en') throw new RangeError(`Unsupported NLI font language: ${language}`);
  const choice = choices?.[language];
  if (language === 'he' && choice === 'default') return baseline;
  if (!allowed[language].includes(choice)) throw new RangeError(`Unsupported ${language} NLI font choice: ${choice}`);
  const alias = `NLI Content ${families[choice]}`;
  return {
    ...baseline,
    fontFamily: alias,
    canvasFontStack: `"${alias}", sans-serif`,
    mapFontStack: [alias],
  };
}
