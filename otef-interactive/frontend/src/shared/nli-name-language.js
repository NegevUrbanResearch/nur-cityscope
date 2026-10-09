import catalog from './place-navigation/place-catalog.generated.js';

const places = new Map(catalog.entries.map(place => [place.citycode, place]));
const clean = value => typeof value === 'string' ? value.trim() : '';

export function nameTextStyle(language = 'he') {
  const english = language === 'en';
  return { language: english ? 'en' : 'he', direction: english ? 'ltr' : 'rtl',
    fontFamily: english ? 'Arial' : 'Guttman Hatzvi',
    canvasFontStack: english ? 'Arial, sans-serif' : '"Guttman Hatzvi", sans-serif',
    mapFontStack: english ? ['Arial'] : ['Guttman Hatzvi', 'Arial'] };
}

export function resolvePersonName(properties, language = 'he') {
  const name = clean(properties?.[language === 'en' ? 'name' : 'hebrew_name']);
  if (!name || name === 'לא ידוע') throw new Error(`Missing ${language} name for PID ${properties?.pid ?? ''}`);
  return name;
}

export function resolveSettlementName(citycode, language = 'he') {
  const name = clean(places.get(citycode)?.name?.[language === 'en' ? 'en' : 'he']);
  if (!name) throw new Error(`Missing ${language} settlement name for ${citycode}`);
  return name;
}

/** The generated index emits the canonical Hebrew and English forms before aliases. */
export function canonicalPersonNames(row) {
  const [hebrew = '', english = ''] = (row?.nameForms || []).slice(0, 2).map(clean);
  // Completeness and ordering are enforced before an index can be promoted.
  const validHebrewPosition = /[\u0590-\u05ff]/.test(hebrew);
  return { hebrew_name: validHebrewPosition && hebrew !== 'לא ידוע' ? hebrew : '',
    name: validHebrewPosition && !/[\u0590-\u05ff]/.test(english) ? english : '' };
}
